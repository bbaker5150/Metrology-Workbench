import { it, expect } from "vitest";
import { computePointTmdeLimits } from "./pointTmdeLimits";
import { computePointRiskMetrics } from "./riskCompute";
const master=(id,unit,limit)=>({id,instrument:{functions:[{name:id,unit,ranges:[{id:id+"-range",min:0,max:100,tolerances:{floor:{low:-limit,high:limit,unit,distribution:"1.960"}}}]}]}});
const session={tmdes:[master("meter","mV",.0038125),master("shunt","Ohm",3.125e-8)],
  uncReq:{uncertaintyConfidence:95,reliability:85,reqPFA:2,neededTUR:4,measRelCalcAssumed:85,calInt:6,guardBandMultiplier:1}};
const point={id:"p",measurementType:"derived",equationString:"V/R",variableMappings:{V:"Voltage",R:"Resistance"},
  variableNominals:{V:{value:6.25,unit:"mV"},R:{value:.0000125,unit:"Ohm"}},
  testPointInfo:{parameter:{value:500,unit:"A"}},uutTolerance:{floor:{low:-50,high:50,unit:"A",distribution:"1.732"}},
  components:[["meter","Voltage"],["shunt","Resistance"]].map(([id,type])=>({id,variableType:type,tmdeBudgetSourceId:id,tmdeBudgetRangeId:id+"-range",tmdeBudgetComponentKind:"Accuracy"}))};

it("propagates linked meter and shunt specifications through V/R without double counting budget rows",()=>{
  const p={...point,components:[...point.components,{...point.components[1],id:"resolution",tmdeBudgetComponentKind:"Resolution"}]};
  const limits=computePointTmdeLimits(p,session);
  expect(limits.reason).toBeNull();
  expect(limits.entries).toHaveLength(2);
  expect(limits.low).toBeCloseTo((.00625-.0000038125)/(.0000125+3.125e-8),10);
  expect(limits.high).toBeCloseTo((.00625+.0000038125)/(.0000125-3.125e-8),10);
  const risk=computePointRiskMetrics(point,session);
  expect(risk.tar).toBeCloseTo(100/limits.span,9);
});
it("updates live master specifications, preserves asymmetric limits and quantity",()=>{
  const p={measurementType:"direct",testPointInfo:{parameter:{value:0,unit:"V"}},tmdeTolerances:[{
    id:"a",quantity:2,measurementPoint:{value:0,unit:"mV"},floor:{low:-2,high:3,unit:"mV",distribution:"1.732"}
  }]};
  const limits=computePointTmdeLimits(p);
  expect(limits.low).toBeCloseTo(-.004,10);expect(limits.high).toBeCloseTo(.006,10);
  const changed=structuredClone(session);changed.tmdes[0].instrument.functions[0].ranges[0].tolerances.floor.high=.01;
  expect(computePointTmdeLimits(point,changed).high).toBeGreaterThan(computePointTmdeLimits(point,session).high);
});
it("does not report fictitious limits for missing sources, wrong dimensions or singular equations",()=>{
  expect(computePointTmdeLimits(point,{tmdes:[]}).reason).toMatch(/missing/);
  expect(computePointTmdeLimits({...point,variableNominals:{...point.variableNominals,R:{value:0,unit:"Ohm"}}},session).reason).toMatch(/zero/);
  expect(computePointTmdeLimits({...point,measurementType:"direct"},session).reason).toMatch(/units differ/);
  expect(computePointTmdeLimits({...point,components:[point.components[0]]},session).reason).toMatch(/input R/);
});
it("includes interior extrema instead of assuming endpoint evaluations are sufficient",()=>{
  const p={...point,equationString:"V^2",variableMappings:{V:"Voltage"},variableNominals:{V:{value:0,unit:"mV"}},components:[point.components[0]]};
  const result=computePointTmdeLimits(p,session);
  expect(result.low).toBe(0);expect(result.high).toBeCloseTo((.0038125/1000)**2,16);
});
