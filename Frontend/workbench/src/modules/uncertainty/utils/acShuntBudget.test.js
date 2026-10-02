import { describe, expect, it } from 'vitest';
import { buildAcShuntBudget } from './acShuntBudget';
import { readerSpec, readerContribution } from './acShuntReaderSpecs';
import { resolvePointBudgetComponents } from './resolvePointBudgetComponents';
import { computeUncertaintyForPoint } from './riskCompute';

export const fixture = (model='Y5020',shared=false) => ({id:10,name:'Saved run',createdAt:'2026-10-02T00:00:00Z',
  instruments:{test_instrument_model:model,test_instrument_serial:'UUT',standard_instrument_model:model,
    standard_instrument_serial:'REF',standard_reader_model:model==='A40B'?'34420A':'5790B',
    test_reader_model:model==='A40B'?'34420A':'5790B',standard_reader_serial:'R1',test_reader_serial:shared?'R1':'R2',
    standard_tvc_serial:'T1',test_tvc_serial:'T2'},
  points:[{sourcePointIds:[1,2],current:10,frequency:1000,analytics:{pair_type_a_uncertainty_ppm:2,n_pairs_used:4,pair_delta_uut_ppm:3},
    shuntSources:[{expandedPpm:4,report:{selection:'saved test-point report'}}],
    tvcs:{std:{expandedPpm:6},ti:{expandedPpm:8}},
    readerPoints:['Forward','Reverse'].map(direction=>({direction,rangeMode:'.22',eta_std:1,eta_ti:1,
      phases:Object.fromEntries(['std','ti'].flatMap(side=>['ac_open','ac_close','dc_pos','dc_neg'].map(p=>[`${side}_${p}`,.2])))}))}]});

describe('AC-shunt budget import',()=>{
  it('creates Electrical points with finite Type A dof and a calculable budget',()=>{
    const {session}=buildAcShuntBudget(fixture());
    expect(session.tmdes).toHaveLength(3);
    const point=session.testPoints[0];
    expect(point.testPointInfo).toMatchObject({measurementArea:'Electrical',parameter:{value:10,unit:'A'},qualifier:{value:1000,unit:'Hz'}});
    const rows=resolvePointBudgetComponents(point,session);
    expect(rows[0]).toMatchObject({type:'A',value:2,dof:3});
    expect(rows[0].value_native).toBeCloseTo(.00002,12);
    expect(rows[1].value).toBe(2);
    expect(rows).toHaveLength(4);
    const uncertainty=computeUncertaintyForPoint(point,session);
    expect(uncertainty).not.toBeNull();
    expect(uncertainty.combined_uncertainty_absolute_base).toBeGreaterThan(.00002);
    expect(session.tmdes[1].instrument.functions[0].ranges[0].tolerances.reading.high).toBe(38);
  });
  it('uses both TVC certificates only for A40B',()=>{
    const {session}=buildAcShuntBudget(fixture('A40B'),{rocK:2});
    expect(session.tmdes).toHaveLength(5);
    expect(session.testPoints[0].components.filter(c=>c.name.includes('TVC')).map(c=>c.value)).toEqual([3,4]);
  });
  it('does not reduce uncertainty for a shared reader or duplicate its identity',()=>{
    const {session}=buildAcShuntBudget(fixture('Y5020',true));
    expect(session.tmdes).toHaveLength(2);
    const rows=session.testPoints[0].components.filter(c=>c.name.startsWith('Reader'));
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBeCloseTo(4*(38+1.5/.2)/2.58);
  });
  it('retains missing sources as incomplete rows through calculation',()=>{
    const source=fixture();source.points[0].shuntSources=[null];
    source.points[0].analytics.n_pairs_used=1;
    const {session,warnings}=buildAcShuntBudget(source);
    expect(warnings.length).toBeGreaterThan(0);
    expect(resolvePointBudgetComponents(session.testPoints[0],session).filter(c=>c.pendingReason)).toHaveLength(2);
    expect(computeUncertaintyForPoint(session.testPoints[0],session)).toBeNull();
  });
  it('preserves a real zero Type A value and rejects unsupported topology',()=>{
    const source=fixture();source.points[0].analytics.pair_type_a_uncertainty_ppm=0;
    const {session}=buildAcShuntBudget(source);
    expect(resolvePointBudgetComponents(session.testPoints[0],session)[0]).toMatchObject({value:0,dof:3});
    expect(()=>buildAcShuntBudget(fixture('Other'))).toThrow(/supports A40B/);
  });
});
describe('reader specifications and propagation',()=>{
  it('chooses physical ranges from voltage and respects a saved larger range',()=>{
    expect(readerSpec('5790B',.069,1000,'AUTO').range).toBe(.07);
    expect(readerSpec('5790B',.2,1000,'AUTO').range).toBe(.22);
    expect(readerSpec('5790B',.069,1000,'2.2').range).toBe(2.2);
    expect(readerSpec('5790B',.069,1000,'.07',true).range).toBe(.22);
    expect(readerSpec('5790B',.069,1000,'AUTO').limitVolts).toBeCloseTo(65e-6*.069+1.5e-6,12);
  });
  it('uses conservative frequency endpoints and rejects invalid inputs',()=>{
    expect(readerSpec('5790B',.2,20000,'.22').readingPpm).toBe(69);
    expect(()=>readerSpec('5790A',.2,1000,'.22')).toThrow(/No verified/);
    expect(()=>readerSpec('5790B',.2,1000,'.07')).toThrow(/exceeds/);
    expect(()=>readerSpec('5790B',.2,1,'.22')).toThrow(/Frequency/);
    expect(()=>readerSpec('5790B',.2,1000,null)).toThrow(/range/);
  });
  it('uses the 34420A 1 V reading-plus-range spec and actual eta',()=>{
    expect(readerSpec('34420A',.1,1000,null).limitVolts).toBeCloseTo(7.5e-6,12);
    const p=fixture().points[0].readerPoints[0];
    const one=readerContribution('34420A','std',p,1000).standardPpm;
    expect(readerContribution('34420A','std',{...p,eta_std:2},1000).standardPpm).toBeCloseTo(one/2);
    const filtered=readerContribution('34420A','std',{...p,analogFilterRequested:true},20);
    expect(filtered.specs[0].readingPpm).toBe(55);
    expect(filtered.specs[2].readingPpm).toBe(35);
    expect(filtered.standardPpm).toBeGreaterThan(one);
  });
});
