import { expect, it } from 'vitest';
import { getTmdePointColumns, availableTmdePointColumns, getPointTmdeSpecifications } from './pointTmdeColumns';
import { generic5790, nominalY5020Resolution } from './testFixtures/generic5790';

const meter = (id, name, unit, limit) => ({id,name,instrument:{functions:[{id:`fn-${id}`,name,unit,
  ranges:[{id:`${id}-range`,min:0,max:100,unit,resolution:limit/10,
    tolerances:{floor:{low:-limit,high:limit,unit,distribution:'1.960'}}}]}]}});
const voltage = meter('v','Voltage meter','mV',.01), resistance = meter('r','Reference shunt','Ohm',.001);
const session = {tmdes:[voltage,resistance]};
const point = {measurementType:'derived',equationString:'V/R',variableMappings:{V:'Voltage',R:'Resistance'},
  variableNominals:{V:{value:6.25,unit:'mV'},R:{value:.1,unit:'Ohm'}}, testPointInfo:{parameter:{value:.0625,unit:'A'}},
  components:[{id:'c-v',variableType:'Voltage',tmdeBudgetSourceId:'v',tmdeBudgetRangeId:'v-range'},
    {id:'c-r',variableType:'Resistance',tmdeBudgetSourceId:'r',tmdeBudgetRangeId:'r-range'}]};

it('offers only current session instruments and keeps their keys on rename', () => {
  expect(getTmdePointColumns()).toEqual([]);
  const cols = getTmdePointColumns([voltage,resistance]);
  expect(cols.map(c=>c.label)).toEqual(['Voltage meter Limits','Voltage meter Uncertainty','Reference shunt Limits','Reference shunt Uncertainty']);
  expect(getTmdePointColumns([{...voltage,name:'Renamed meter'}])[0].key).toBe(cols[0].key);
  expect(availableTmdePointColumns({[cols[0].key]:true,[cols[2].key]:true,value:true,tmdeLow:true},cols.slice(0,2)))
    .toEqual({[cols[0].key]:true,[cols[2].key]:false,value:true,tmdeLow:false});
  expect(getTmdePointColumns([voltage,{...voltage,id:'copy'}])[2].label).toBe('Voltage meter (2) Limits');
});
it('keeps each input in its native units, uses live specifications and deduplicates linked accuracy/resolution', () => {
  const p = {...point, components:[...point.components,{...point.components[0],id:'resolution',isResolution:true}]};
  const before = JSON.stringify({p,session});
  const volts = getPointTmdeSpecifications(p,voltage,session);
  expect(volts).toHaveLength(1);
  expect(volts[0]).toMatchObject({limits:'6.240 to 6.260 mV',reference:{value:6.25,unit:'mV'}});
  expect(getPointTmdeSpecifications(p,resistance,session)[0].limits).toBe('0.0990 to 0.1010 Ω');
  expect(JSON.stringify({p,session})).toBe(before);
  const changed = structuredClone(session);
  changed.tmdes[0].instrument.functions[0].ranges[0].tolerances.floor.high = .02;
  expect(getPointTmdeSpecifications(p,changed.tmdes[0],changed)[0].limits).toBe('6.240 to 6.270 mV');
});
it('leaves unassigned instruments blank and identifies missing ranges without borrowing another specification', () => {
  expect(getPointTmdeSpecifications({...point,components:[]},voltage,session)).toEqual([]);
  const broken = {...point,components:[{...point.components[0],tmdeBudgetRangeId:'removed'}]};
  expect(getPointTmdeSpecifications(broken,voltage,session)[0]).toMatchObject({limits:'—',reason:'The linked TMDE range is missing.'});
  const direct = {...point,measurementType:'direct'};
  expect(getPointTmdeSpecifications(direct,voltage,session)[0].reason).toMatch(/compatible TMDE input/);
});
it('refreshes legacy point instances and shows resolution-only sources without unused accuracy limits', () => {
  const p = {...point,components:[],tmdeTolerances:[{id:'instance',sourceId:'v',rangeId:'v-range',variableType:'Voltage',
    tolerance:{floor:{high:999,low:-999,unit:'mV'}}}]};
  expect(getPointTmdeSpecifications(p,voltage,session)[0].limits).toBe('6.240 to 6.260 mV');
  const onlyResolution = {...point,components:[{...point.components[0],isResolution:true}]};
  expect(getPointTmdeSpecifications(onlyResolution,voltage,session)[0]).toMatchObject({limits:'—',specification:'Resolution: 0.001 mV'});
});
it('shows Y5020 reader resolution from its linked live voltage range without applying accuracy limits', () => {
  const reader = {id:'reader',instrument:generic5790};
  const p = {testPointInfo:{parameter:{value:10,unit:'A'}},components:[{id:'reader-resolution',tmdeBudgetSourceId:'reader',
    isResolution:true,y5020Resolution:nominalY5020Resolution(10)}]};
  const entries = getPointTmdeSpecifications(p,reader,{tmdes:[reader]});
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({limits:'—',specification:'Resolution: 1e-7 V'});
  expect(entries[0].reason).toMatch(/Only resolution/);
});
it('uses the saved physical input values for transfer specifications', () => {
  const p = {...point,measurementType:'direct',components:[{id:'transfer',tmdeTransferSources:[
    {sourceId:'v',functionId:'fn-v',rangeId:'v-range',nominal:{value:1,unit:'mV'},role:'Reference',direction:'AC'},
    {sourceId:'v',functionId:'fn-v',rangeId:'v-range',nominal:{value:2,unit:'mV'},role:'Reference',direction:'DC'},
  ]}]};
  expect(getPointTmdeSpecifications(p,voltage,session).map(e=>[e.label,e.limits])).toEqual([
    ['Reference / AC','0.990 to 1.010 mV'],['Reference / DC','1.990 to 2.010 mV']]);
});
