import { describe, expect, it } from 'vitest';
import { readerSpec, readerContribution } from './acShuntReaderSpecs';
import { acShuntUutSpec } from './acShuntUutSpecs';
const fixture = (model='Y5020',shared=false) => ({id:10,name:'Saved run',createdAt:'2026-10-02T00:00:00Z',
  instruments:{test_instrument_model:model,test_instrument_serial:'UUT',standard_instrument_model:model,
    standard_instrument_serial:'REF',standard_reader_model:model==='A40B'?'34420A':'5790B',
    test_reader_model:model==='A40B'?'34420A':'5790B',standard_reader_serial:'R1',test_reader_serial:shared?'R1':'R2',
    standard_tvc_serial:'T1',test_tvc_serial:'T2'},
  points:[{sourcePointIds:[1,2],current:10,frequency:1000,analytics:{pair_type_a_uncertainty_ppm:2,n_pairs_used:4,pair_delta_uut_ppm:3},
    shuntSources:[{expandedPpm:4,report:{selection:'saved test-point report'}}],
    tvcs:{std:{expandedPpm:6,testVoltage:1},ti:{expandedPpm:8,testVoltage:1}},
    readerPoints:['Forward','Reverse'].map(direction=>({direction,rangeMode:'.22',eta_std:1,eta_ti:1,
      phases:Object.fromEntries(['std','ti'].flatMap(side=>['ac_open','ac_close','dc_pos','dc_neg'].map(p=>[`${side}_${p}`,.2])))}))}]});
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

it('uses reader resolution appropriate to the saved filter and integration time',()=>{
  expect(readerSpec('5790B',1,1000,'2.2',false,{filterMode:'FAST'}).resolutionVolts).toBe(1e-6);
  expect(readerSpec('5790B',1,1000,'2.2',false,{filterMode:'MEDIUM'}).resolutionVolts).toBe(1e-7);
  expect(readerSpec('34420A',1,1000,null,false,{nplc:100}).resolutionVolts).toBe(1e-7);
  expect(readerSpec('34420A',1,1000,null,false,{nplc:10}).resolutionVolts).toBe(1e-6);
});
  it('matches UUT manufacturer frequency limits and refuses extrapolation',()=>{
    expect(acShuntUutSpec('A40B',10,5500,10,40).ppm).toBe(48.5);
    expect(acShuntUutSpec('A40B',10,1000,10,60).ppm).toBe(57);
    expect(acShuntUutSpec('Y5020',20,1000,20).ppm).toBe(250);
    expect(acShuntUutSpec('Y5020',20,1001,20).ppm).toBe(350);
    expect(()=>acShuntUutSpec('Y5020',20,6000,20)).toThrow(/5 kHz/);
    expect(()=>acShuntUutSpec('A40B',10,1000,20)).toThrow(/range/);
  });
