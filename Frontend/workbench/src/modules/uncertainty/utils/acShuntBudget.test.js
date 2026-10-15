import { describe, expect, it } from 'vitest';
import { formatRangeLabel } from './rangeFormatting';
import { buildAcShuntBudget } from './acShuntBudget';
import { readerSpec, readerContribution } from './acShuntReaderSpecs';
import { resolvePointBudgetComponents } from './resolvePointBudgetComponents';
import { computeUncertaintyForPoint, computePointRiskMetrics } from './riskCompute';
import { acShuntUutSpec } from './acShuntUutSpecs';
import { syncPointTolerances } from './pointToleranceSync';
import { getBudgetRangeWarnings } from './pointDiagnostics';
import { reconcileImportedInstruments } from './importedInstrumentLibrary';
import { computeSyncState } from './instrumentSync';
import { getUutBiasDefault } from './measurementBias';
import { calculateDerivedUncertainty, correlationKey } from './uncertaintyMath';
import { renderHook, waitFor } from '@testing-library/react';
import { useUncertaintyCalculation } from '../features/analysis/hooks/useUncertaintyCalculation';

export const fixture = (model='Y5020',shared=false) => ({id:10,name:'Saved run',createdAt:'2026-10-02T00:00:00Z',
  instruments:{test_instrument_model:model,test_instrument_serial:'UUT',standard_instrument_model:model,
    standard_instrument_serial:'REF',standard_reader_model:model==='A40B'?'34420A':'5790B',
    test_reader_model:model==='A40B'?'34420A':'5790B',standard_reader_serial:'R1',test_reader_serial:shared?'R1':'R2',
    standard_tvc_serial:'T1',test_tvc_serial:'T2'},
  points:[{sourcePointIds:[1,2],current:10,frequency:1000,analytics:{pair_type_a_uncertainty_ppm:2,n_pairs_used:4,pair_delta_uut_ppm:3},
    shuntSources:[{expandedPpm:4,report:{selection:'saved test-point report'}}],
    tvcs:{std:{expandedPpm:6,testVoltage:1},ti:{expandedPpm:8,testVoltage:1}},
    readerPoints:['Forward','Reverse'].map(direction=>({direction,rangeMode:'.22',eta_std:1,eta_ti:1,
      phases:Object.fromEntries(['std','ti'].flatMap(side=>['ac_open','ac_close','dc_pos','dc_neg'].map(p=>[`${side}_${p}`,.2])))}))}]});

const derivedResult=(point,session)=>calculateDerivedUncertainty(point.equationString,point.variableMappings,[],
  {...point.testPointInfo.parameter,variableNominals:point.variableNominals},
  resolvePointBudgetComponents(point,session).filter(row=>row.variableSymbol),{strictUnitValidation:true});

describe('native AC-shunt derived workflow',()=>{
  it.each(['Y5020','A40B'])('keeps %s voltage sources in native input budgets and propagates dimensionally valid sensitivities',model=>{
    const {session}=buildAcShuntBudget(fixture(model));
    const point=JSON.parse(JSON.stringify(session.testPoints[0]));
    expect(point.measurementType).toBe('derived');
    expect(point.components.every(row=>!row.tmdeTransferSources)).toBe(true);
    const result=derivedResult(point,session);
    expect(result.error).toBeNull();
    expect(result.nominalResult).toBeCloseTo(10,12);
    expect(result.breakdown.find(row=>row.variable==='Vstd11')).toMatchObject({unit:'V',ci:12.5});
    expect(result.breakdown.find(row=>row.variable==='Vstd13').ci).toBeCloseTo(-12.5,12);
    expect(result.breakdown.find(row=>row.variable==='Vti21')).toMatchObject({unit:'V',ci:-12.5});
    const phaseRows=point.components.filter(row=>row.variableSymbol==='Vstd11');
    expect(phaseRows).toHaveLength(2);
    expect(phaseRows.every(row=>row.unit_native==='V')).toBe(true);
    if(model==='Y5020') {
      expect(phaseRows.find(row=>!row.isResolution).value_native).toBeCloseTo(9.1e-6/2.58,12);
      const phaseU=Math.hypot(9.1e-6/2.58,1e-7/Math.sqrt(12));
      expect(computeUncertaintyForPoint(point,session).combined_uncertainty_absolute_base).toBeCloseTo(Math.hypot(100*phaseU,100*phaseU,2e-5,2e-5),10);
    } else {
      expect(result.breakdown.find(row=>row.variable==='Tstd')).toMatchObject({unit:'V',ci:10});
      expect(result.breakdown.find(row=>row.variable==='Tti')).toMatchObject({unit:'V',ci:-10});
    }
  });
  it('uses actual unequal phase voltages and eta in the editable equation after persistence',()=>{
    const source=fixture();
    source.points[0].readerPoints[0]={...source.points[0].readerPoints[0],eta_std:2,
      phases:{...source.points[0].readerPoints[0].phases,std_ac_open:.19,std_ac_close:.21,std_dc_pos:.18,std_dc_neg:-.20}};
    const session=JSON.parse(JSON.stringify(buildAcShuntBudget(source).session));
    const point=session.testPoints[0];
    const result=derivedResult(point,session);
    expect(result.error).toBeNull();
    expect(result.nominalResult).toBeCloseTo(10,12);
    expect(result.breakdown.find(row=>row.variable==='Vstd11').ci).toBeCloseTo(10/2/2/.38,10);
    expect(result.breakdown.find(row=>row.variable==='Vstd13').ci).toBeCloseTo(-10/2/2*.4/.38**2,10);
    point.variableNominals.Vstd11.value+=1e-5;
    const edited=derivedResult(point,session);
    expect(edited.nominalResult-result.nominalResult).toBeCloseTo(1e-5*10/2/2/.38,10);
  });
  it('opens native voltage budgets and includes paired Type A exactly once in the final output',async()=>{
    const {session}=buildAcShuntBudget(fixture());
    const point=session.testPoints[0], components=resolvePointBudgetComponents(point,session);
    const tmdeTolerances=[], onSave=()=>{};
    const {result}=renderHook(()=>useUncertaintyCalculation(point,session,tmdeTolerances,point.uutTolerance,
      point.testPointInfo.parameter,components,onSave));
    await waitFor(()=>expect(result.current.calcResults?.is_detailed_uncertainty_calculated).toBe(true));
    expect(result.current.calculationError).toBeNull();
    const groups=result.current.calcResults.calculatedBudgetGroups;
    expect(groups.filter(group=>group.kind==='input' && group.unit==='V')).toHaveLength(16);
    const typeA=point.components.find(row=>row.type==='A');
    const final=groups.find(group=>group.kind==='final');
    expect(final.components.filter(row=>row.id===typeA.id)).toHaveLength(1);
    expect(groups.filter(group=>group.kind==='input').every(group=>group.components.every(row=>row.id!==typeA.id))).toBe(true);
    expect(result.current.calcResults.combined_uncertainty_absolute_base).toBeCloseTo(computeUncertaintyForPoint(point,session).combined_uncertainty_absolute_base,10);
  });
});

describe('AC-shunt budget import',()=>{
  it.each(['Y5020','A40B'])('keeps frequency exclusively in qualifiers for %s instrument ranges',model=>{
    const {session}=buildAcShuntBudget(fixture(model));
    const ranges=[...session.uuts,...session.tmdes].flatMap(item=>item.instrument.functions.flatMap(fn=>fn.ranges));
    expect(ranges.some(range=>range.qualifier?.unit==='Hz')).toBe(true);
    for (const range of ranges) {
      expect(range.contextLabel).toBeUndefined();
      expect(range.range).not.toMatch(/Hz|filter/);
      for (const preferBounds of [false,true]) expect(formatRangeLabel(range,{preferBounds})).not.toMatch(/Hz/);
    }
    expect(session.uuts[0].instrument.functions[0].ranges[0].qualifier).toMatchObject({min:1000,max:1000,unit:'Hz'});
  });
  it.each(['Y5020','A40B'])('calculates risk and links UUT limits and every Type B to %s instruments',model=>{
    const {session,riskCalculated}=buildAcShuntBudget(fixture(model));
    const point=session.testPoints[0];
    expect(riskCalculated).toBe(1);
    expect(point.uutTolerance.tolerances.reading.high).toBe(model==='A40B'?37:100);
    expect(point.uutTolerance.rangeId).toBe(session.uuts[0].instrument.functions[0].ranges[0].id);
    if (model==='A40B') expect(point.uutTolerance.tolerances.bias.value).toBeCloseTo(30e-6);
    else expect(point.uutTolerance.tolerances.bias).toBeUndefined();
    expect(point.expanded_uncertainty_absolute_base).toBeGreaterThan(0);
    for (const row of point.components.filter(c=>c.type==='B')) {
      expect(row.tmdeBudgetSourceId).toBeTruthy();
      expect(row.tmdeBudgetRangeId).toBeTruthy();
      expect(row.value_native).toBeGreaterThan(0);
      if (!row.isResolution) expect(row.toleranceLimit_native).toBeGreaterThan(0);
      expect(row.variableSymbol).toBeTruthy();
      expect(row.tmdeTransferSources).toBeUndefined();
      expect(row.isInlineManual).not.toBe(true);
      expect(row.distribution).toMatch(/^(Normal|Rectangular)/);
      expect(row.distribution).not.toMatch(/^k\s*=/);
    }
    const risk=computePointRiskMetrics(point,session);
    for (const key of ['tur','pfa','pfr']) expect(Number.isFinite(risk[key]),key).toBe(true);
    expect(risk.tar).toBeUndefined();
    expect(risk.tmdeLimits.reason).toMatch(/different physical units/);
    const groups=Object.entries(point.variableMappings).map(([symbol,variableType])=>({kind:'input',variableType,nominalPoint:point.variableNominals[symbol]}));
    expect(getBudgetRangeWarnings({components:point.components,measurementType:'derived',groups,tmdes:session.tmdes})).toEqual({});
    expect(risk.tur).toBeGreaterThan(0);
  });
  it('deduplicates repeated TVC and reader specs while retaining distinct frequency conditions',()=>{
    const source=fixture('A40B');source.shuntRange=10;
    source.points=[5,7,10].flatMap(current=>[1000,10000].map(frequency=>({...source.points[0],current,frequency})));
    const {session,riskCalculated}=buildAcShuntBudget(source);
    expect(riskCalculated).toBe(6);
    for (const reader of session.tmdes.filter(t=>t.instrument.description==='34420A')) {
      expect(reader.instrument.functions).toHaveLength(1);
      expect(reader.instrument.functions[0].ranges).toHaveLength(1);
      expect(reader.instrument.typeBComponents || []).toHaveLength(0);
    }
    for (const tvc of session.tmdes.filter(t=>t.instrument.description==='TVC')) expect(tvc.instrument.functions[0].ranges).toHaveLength(2);
  });
  it('recomputes error, uncertainty and risk from edits to the matching TMDE range after persistence',()=>{
    const {session}=buildAcShuntBudget(fixture());
    const original=JSON.parse(JSON.stringify(session));
    const previous=computePointRiskMetrics(original.testPoints[0],original);
    const range=session.tmdes[1].instrument.functions[0].ranges[0];
    range.tolerances.reading.high=380;range.tolerances.reading.low=-380;
    const next=syncPointTolerances(session,original);
    const rows=resolvePointBudgetComponents(next.testPoints[0],next);
    expect(rows[2].toleranceLimit_native).toBeGreaterThan(original.testPoints[0].components[2].toleranceLimit_native);
    expect(rows[3].toleranceLimit_native).toBe(original.testPoints[0].components[3].toleranceLimit_native);
    expect(next.testPoints[0].expanded_uncertainty_absolute_base).toBeGreaterThan(original.testPoints[0].expanded_uncertainty_absolute_base);
    expect(computePointRiskMetrics(next.testPoints[0],next).tur).toBeLessThan(previous.tur);
    // Removing a linked physical range must not silently use the first range.
    next.tmdes[1].instrument.functions[0].ranges=[];
    expect(computeUncertaintyForPoint(next.testPoints[0],next)).toBeNull();
    expect(computePointRiskMetrics(next.testPoints[0],next)).toBeNull();
  });
  it('matches UUT manufacturer frequency limits and refuses extrapolation',()=>{
    expect(acShuntUutSpec('A40B',10,5500,10,40).ppm).toBe(48.5);
    expect(acShuntUutSpec('A40B',10,1000,10,60).ppm).toBe(57);
    expect(acShuntUutSpec('Y5020',20,1000,20).ppm).toBe(250);
    expect(acShuntUutSpec('Y5020',20,1001,20).ppm).toBe(350);
    expect(()=>acShuntUutSpec('Y5020',20,6000,20)).toThrow(/5 kHz/);
    expect(()=>acShuntUutSpec('A40B',10,1000,20)).toThrow(/range/);
  });
  it('creates Electrical points with finite Type A dof and a calculable budget',()=>{
    const {session}=buildAcShuntBudget(fixture());
    expect(session.tmdes).toHaveLength(3);
    const point=session.testPoints[0];
    expect(point.testPointInfo).toMatchObject({measurementArea:'Electrical',parameter:{value:10,unit:'A'},qualifier:{value:1000,unit:'Hz'}});
    const rows=resolvePointBudgetComponents(point,session);
    expect(rows[0]).toMatchObject({type:'A',value:2,dof:3});
    expect(rows[0].value_native).toBeCloseTo(.00002,12);
    expect(rows[1].value).toBe(2);
    expect(rows).toHaveLength(34); // Type A, shunt, accuracy + resolution for 16 phase inputs.
    const uncertainty=computeUncertaintyForPoint(point,session);
    expect(uncertainty).not.toBeNull();
    expect(uncertainty.combined_uncertainty_absolute_base).toBeGreaterThan(.00002);
    expect(session.tmdes[1].instrument.functions[0].ranges[0].tolerances.reading.high).toBe(38);
  });
  it('uses both TVC certificates only for A40B',()=>{
    const {session}=buildAcShuntBudget(fixture('A40B'),{rocK:2});
    expect(session.tmdes).toHaveLength(5);
    expect(session.testPoints[0].components.filter(c=>c.name.includes('TVC')).map(c=>c.value)).toEqual([3,4]);
    expect(session.tmdes.find(t=>t.assetId==='T1').instrument.functions[0].ranges[0].tolerances.reading.high).toBe(6);
  });
  it('does not reduce uncertainty for a shared reader or duplicate its identity',()=>{
    const {session}=buildAcShuntBudget(fixture('Y5020',true));
    expect(session.tmdes).toHaveLength(2);
    const point=session.testPoints[0];
    const rows=point.components.filter(c=>c.variableSymbol?.startsWith('V'));
    expect(new Set(rows.map(row=>row.tmdeBudgetSourceId)).size).toBe(1);
    expect(rows).toHaveLength(32);
    expect(point.inputCorrelations[correlationKey(point.variableMappings.Vstd11,point.variableMappings.Vti11)]).toBe(-1);
    const phaseUncertainty=Math.hypot((38e-6*.2+1.5e-6)/2.58,1e-7/Math.sqrt(12));
    expect(computeUncertaintyForPoint(point,session).combined_uncertainty_absolute_base).toBeCloseTo(Math.hypot(200*phaseUncertainty,2e-5,2e-5),10);
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

describe('repeat imports from the shared library',()=>{
  const sharedDefinitions = source => {
    const {session}=buildAcShuntBudget(source);
    return [...session.uuts,...session.tmdes].map(item=>({...item.instrument,scope:'validated'}));
  };
  it('uses 100 ppm Navy limits with no Y5020 bias at every frequency, independently of measured delta',()=>{
    const source=fixture();source.points=[100,1000,3000,5000].map(frequency=>({...source.points[0],frequency}));
    const first=buildAcShuntBudget(source).session;
    source.points=source.points.map(point=>({...point,analytics:{...point.analytics,pair_delta_uut_ppm:-900}}));
    const second=buildAcShuntBudget(source).session;
    first.testPoints.forEach((point,index)=>{
      expect(point.uutTolerance.tolerances).toEqual({reading:expect.objectContaining({high:100,low:-100,unit:'ppm'})});
      expect(getUutBiasDefault(point,first)).toBeUndefined();
      expect(second.testPoints[index].testPointInfo.acShuntSource.deltaPpm).toBe(-900);
      expect(computePointRiskMetrics(point,first).pfa).toBe(computePointRiskMetrics(second.testPoints[index],second).pfa);
    });
  });
  it.each(['Y5020','A40B'])('reuses %s shared ranges and uncertainties while importing new Type A data',model=>{
    const source=fixture(model), library=sharedDefinitions(source);
    for (const item of library.slice(0,2)) {
      const range=item.functions[0].ranges[0];
      Object.assign(range,{min:5,max:20,qualifier:{name:'Frequency',min:.5,max:5,unit:'kHz'}});
    }
    for (const item of library.filter(item=>item.description==='TVC')) item.functions[0].ranges[0].qualifier={min:.5,max:5,unit:'kHz'};
    library[1].functions[0].ranges[0].tolerances.reading={high:20,low:-20,unit:'ppm',distribution:'2'};
    const original=JSON.parse(JSON.stringify(library));
    source.points[0]={...source.points[0],current:12,frequency:3000,shuntSources:[],
      analytics:{...source.points[0].analytics,pair_type_a_uncertainty_ppm:5,n_pairs_used:9}};
    const result=buildAcShuntBudget(source,{instruments:library});
    expect(result.reusedInstruments).toBe(library.length);
    expect(result.needsCertificates).toBe(false);
    expect(result.riskCalculated).toBe(1);
    const {session}=reconcileImportedInstruments(JSON.parse(JSON.stringify(result.session)),{sharedInstruments:library});
    expect(session.uuts[0].libraryInstrumentId).toBe(library[0].id);
    expect(computeSyncState(session.uuts[0].instrument)).toBe('green');
    expect(session.testPoints[0].uutTolerance.rangeId).toBe(library[0].functions[0].ranges[0].id);
    const rows=resolvePointBudgetComponents(session.testPoints[0],session);
    expect(rows[0]).toMatchObject({type:'A',value:5,dof:8});
    expect(rows[0].value_native).toBeCloseTo(60e-6,12);
    expect(rows[1].value_native).toBeCloseTo(120e-6,12);
    session.tmdes.forEach((item,index)=>{
      expect(item.instrument.functions).toEqual(library[index+1].functions);
      expect(computeSyncState(item.instrument)).toBe('green');
    });
    expect(library).toEqual(original);
    const previous=JSON.parse(JSON.stringify(session));
    session.tmdes[0].instrument.functions[0].ranges[0].tolerances.reading.high=40;
    session.tmdes[0].instrument.functions[0].ranges[0].tolerances.reading.low=-40;
    const updated=syncPointTolerances(session,previous);
    expect(updated.testPoints[0].expanded_uncertainty_absolute_base).toBeGreaterThan(previous.testPoints[0].expanded_uncertainty_absolute_base);
  });
  it('removes older shared Y5020 manufacturer limits and bias only from the UUT session copy',()=>{
    const source=fixture(),library=sharedDefinitions(source);
    const range=library[0].functions[0].ranges[0];
    range.tolerances={reading:{high:250,low:-250,unit:'ppm',distribution:'2'},bias:{kind:'absolute',value:.001,unit:'A'}};
    const original=JSON.parse(JSON.stringify(library));
    const {session}=buildAcShuntBudget(source,{instruments:library});
    expect(session.testPoints[0].uutTolerance.tolerances.reading.high).toBe(100);
    expect(getUutBiasDefault(session.testPoints[0],session)).toBeUndefined();
    expect(session.uuts[0].instrument.localOverride).toBe(true);
    expect(computeSyncState(session.uuts[0].instrument)).toBe('red');
    expect(library).toEqual(original);
    expect(session.tmdes[0].instrument.functions).toEqual(library[1].functions);
  });
  it.each(['missing','ambiguous'])('leaves %s shared reference ranges incomplete instead of rebuilding them from certificates',mode=>{
    const source=fixture(),library=sharedDefinitions(source);
    const fn=library[1].functions[0];
    if(mode==='missing') fn.ranges[0].qualifier={min:2000,max:5000,unit:'Hz'};
    else fn.ranges.push({...fn.ranges[0],id:'overlap'});
    const {session,warnings,riskCalculated}=buildAcShuntBudget(source,{instruments:library});
    expect(riskCalculated).toBe(0);
    expect(warnings.join(' ')).toMatch(mode==='missing'?/no shared range matches/:/multiple shared ranges match/);
    expect(session.tmdes[0].instrument.functions).toEqual(library[1].functions);
    expect(computeUncertaintyForPoint(session.testPoints[0],session)).toBeNull();
  });
  it('does not guess between duplicate instrument identities and accepts an explicit shared choice',()=>{
    const source=fixture(),library=sharedDefinitions(source);
    library.push({...library[1],id:'other-reference'});
    expect(buildAcShuntBudget(source,{instruments:library}).session.tmdes[0].libraryInstrumentId).toBeUndefined();
    const result=buildAcShuntBudget(source,{instruments:library,selections:{shunt:'other-reference'}});
    expect(result.session.tmdes[0].libraryInstrumentId).toBe('other-reference');
  });
  it('uses saved reader voltage ranges and AUTO selects the smallest matching shared range',()=>{
    const source=fixture();
    source.points=[.069,.2].map(voltage=>({...source.points[0],readerPoints:source.points[0].readerPoints.map(point=>({...point,rangeMode:'AUTO',phases:Object.fromEntries(Object.keys(point.phases).map(key=>[key,voltage]))}))}));
    const library=sharedDefinitions(source);
    const result=buildAcShuntBudget(source,{instruments:library});
    expect(result.riskCalculated).toBe(2);
    const reader=result.session.tmdes[1];
    const ac=reader.instrument.functions.find(fn=>fn.name==='AC Voltage');
    const inputRange=point=>point.components.find(row=>row.variableSymbol==='Vstd11').tmdeBudgetRangeId;
    expect(inputRange(result.session.testPoints[0])).toBe(ac.ranges.find(range=>range.max===.07).id);
    source.points[0].readerPoints.forEach(point=>point.rangeMode='.22');
    const selected=buildAcShuntBudget(source,{instruments:library});
    expect(inputRange(selected.session.testPoints[0])).toBe(ac.ranges.find(range=>range.max===.22).id);
  });
  it('includes additional shared shunt uncertainties and respects disabled reader resolutions',()=>{
    const source=fixture(),library=sharedDefinitions(source);
    library[1].tmdeSecondaryUncertainties=[{id:'thermal',name:'Thermal uncertainty',kind:'parametric',
      tolerance:{reading:{high:6,low:-6,unit:'ppm',distribution:'2'}}}];
    for (const reader of library.slice(2)) for (const fn of reader.functions) for (const range of fn.ranges) range.includeResolutionInBudget=false;
    const {session,riskCalculated}=buildAcShuntBudget(source,{instruments:library});
    expect(riskCalculated).toBe(1);
    const rows=resolvePointBudgetComponents(session.testPoints[0],session);
    expect(rows.find(row=>row.tmdeUncertaintySourceId==='thermal')?.value_native).toBeCloseTo(30e-6,12);
    expect(rows.filter(row=>row.isResolution)).toHaveLength(0);
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

it('imports grouped frequency subranges, dedicated point fields and editable reader resolutions',()=>{
  const source=fixture(); source.points=[100,1000,3000].map(frequency=>({...source.points[0],frequency}));
  const {session}=buildAcShuntBudget(source);
  expect(session.uuts[0].instrument).toMatchObject({manufacturer:'Fluke',model:'UUT',description:'Y5020'});
  const ranges=session.uuts[0].instrument.functions[0].ranges;
  expect(new Set(ranges.map(r=>r.qualifierGroupId)).size).toBe(1);
  expect(ranges.map(r=>r.qualifier.min)).toEqual([100,1000,3000]);
  expect(session.testPoints.every(p=>p.section==='' && p.testPointInfo.parameter.value===10 && p.testPointInfo.qualifier.unit==='Hz')).toBe(true);
  expect(session.tmdes[1].instrument.functions[0].ranges[0]).toMatchObject({resolution:1e-7,resolutionUnit:'V',includeResolutionInBudget:true});
  const resolutions=session.testPoints[0].components.filter(c=>c.isResolution);
  expect(resolutions).toHaveLength(16);
  expect(resolutions.every(c=>c.value_native>0 && !c.pendingReason)).toBe(true);
});
it('uses reader resolution appropriate to the saved filter and integration time',()=>{
  expect(readerSpec('5790B',1,1000,'2.2',false,{filterMode:'FAST'}).resolutionVolts).toBe(1e-6);
  expect(readerSpec('5790B',1,1000,'2.2',false,{filterMode:'MEDIUM'}).resolutionVolts).toBe(1e-7);
  expect(readerSpec('34420A',1,1000,null,false,{nplc:100}).resolutionVolts).toBe(1e-7);
  expect(readerSpec('34420A',1,1000,null,false,{nplc:10}).resolutionVolts).toBe(1e-6);
});
