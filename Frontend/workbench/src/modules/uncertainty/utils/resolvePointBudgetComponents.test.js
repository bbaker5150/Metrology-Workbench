import { describe, expect, it } from "vitest";
import { resolvePointBudgetComponents } from "./resolvePointBudgetComponents";
import { computePointRiskMetrics } from "./riskCompute";
import { applyItemRangePatch } from "../features/analysis/components/UncertaintyPanel";
import { syncPointTolerances } from "./pointToleranceSync";

const makeFixture = measurementType => {
  const master = {id:"meter",instrument:{functions:[{id:"voltage",name:"Voltage",unit:"V",ranges:[{
    id:"range",min:0,max:100,unit:"V",measuringResolution:.1,measuringResolutionUnit:"V",measuringResolutionDistribution:"3.464",
    tolerances:{floor:{low:-1,high:1,unit:"V",distribution:"1.732"},measuringResolution:.1,measuringResolutionUnit:"V",measuringResolutionDistribution:"3.464"}
  }]}]}};
  const point = {id:"p",measurementType,equationString:"x",variableMappings:{x:"Voltage"},variableNominals:{x:{value:10,unit:"V"}},
    testPointInfo:{parameter:{value:10,unit:"V"}},uutTolerance:{floor:{low:-10,high:10,unit:"V",distribution:"1.732"}},tmdeTolerances:[],
    components:["Accuracy","Resolution"].map(kind=>({id:kind,name:kind,type:"B",variableType:"Voltage",tmdeBudgetSourceId:"meter",tmdeBudgetRangeId:"range",tmdeBudgetComponentKind:kind}))};
  return {point,session:{tmdes:[master],uncReq:{uncertaintyConfidence:95,reliability:85,neededTUR:4,reqPFA:2,calInt:12}}};
};

it("refreshes secondary uncertainties by source id across renames, type changes and removal", () => {
  const { point, session } = makeFixture("derived");
  const tolerance = session.tmdes[0].instrument.functions[0].ranges[0].tolerances;
  tolerance.tmdeSecondaryUncertainties = [
    { id: "thermal", name: "Thermal", kind: "parametric", tolerance: { floor: { high: .2, low: -.2, unit: "V", distribution: "1.732" } } },
    { id: "head", name: "Head", kind: "parametric", tolerance: { floor: { high: .3, low: -.3, unit: "V", distribution: "1.732" } } },
  ];
  point.components = [point.components[0], ...tolerance.tmdeSecondaryUncertainties.map(source => ({
    ...point.components[0], id: source.id, tmdeUncertaintySourceId: source.id, tmdeUncertaintyComponentKind: "Accuracy",
  }))];
  let rows = resolvePointBudgetComponents(point, session);
  expect(rows.map(row => row.value_native)).toEqual([1 / Math.sqrt(3), .2 / Math.sqrt(3), .3 / Math.sqrt(3)]);
  tolerance.tmdeSecondaryUncertainties[0] = { id: "thermal", name: "Renamed thermal", kind: "equation", dynamicDefinition: {
    id: "eq", kind: "equation", columns: [{ id: "u" }], name: "Renamed thermal", measurementUnit: "V", outputUnit: "V", mode: "standard",
    equation: "x * a", variables: { x: {}, a: { value: .04 } }, pointVariable: "x",
  } };
  rows = resolvePointBudgetComponents(point, session);
  expect(rows[1].value_native).toBeCloseTo(.4, 10);
  expect(rows[1].tmdeUncertaintySourceName).toBe("Renamed thermal");
  expect(rows[2].value_native).toBeCloseTo(.3 / Math.sqrt(3), 10);
  point.components[2].tmdeUncertaintyOverride = { distribution: "2", componentKind: "Accuracy" };
  rows = resolvePointBudgetComponents(point, session);
  expect(rows[2].value_native).toBeCloseTo(.15, 10);
  expect(rows[0].value_native).toBeCloseTo(1 / Math.sqrt(3), 10);
  tolerance.tmdeSecondaryUncertainties.shift();
  expect(resolvePointBudgetComponents(point, session)[1].pendingReason).toBeTruthy();
});

describe.each(["direct","derived"])("live instrument components (%s)", measurementType => {
  it("refreshes existing accuracy and resolution rows, including legacy aliases, units and distribution", () => {
    const {point,session} = makeFixture(measurementType);
    const initial=resolvePointBudgetComponents(point,session);
    const initialTur=computePointRiskMetrics(point,session).tur;
    const master=session.tmdes[0];
    const tolerance=master.instrument.functions[0].ranges[0].tolerances;
    session.tmdes=[applyItemRangePatch(master,"range",{tolerances:{...tolerance,floor:{...tolerance.floor,low:-2,high:2}}})];
    let updated=resolvePointBudgetComponents(point,session);
    expect(updated[0].id).toBe(initial[0].id);
    expect(updated[0].value_native).toBeCloseTo(initial[0].value_native*2,10);
    expect(computePointRiskMetrics(point,session).tur).toBeLessThan(initialTur);
    session.tmdes=[applyItemRangePatch(session.tmdes[0],"range",{resolution:.4})];
    updated=resolvePointBudgetComponents(point,session);
    expect(updated[1].value_native).toBeCloseTo(initial[1].value_native*4,10);
    session.tmdes=[applyItemRangePatch(session.tmdes[0],"range",{resolutionUnit:"mV",resolutionDistribution:"1.960"})];
    updated=resolvePointBudgetComponents(point,session);
    expect(updated[1].value_native).toBeCloseTo(.0004/(2*1.96),10);
    expect(updated[1].distribution).toMatch(/Normal/);
    session.tmdes=[applyItemRangePatch(session.tmdes[0],"range",{resolution:""})];
    expect(resolvePointBudgetComponents(point,session).map(c=>c.id)).toEqual(["Accuracy"]);
    session.tmdes=[applyItemRangePatch(session.tmdes[0],"range",{resolution:.4})];
    expect(resolvePointBudgetComponents(point,session).map(c=>c.id)).toEqual(["Accuracy","Resolution"]);
    expect(point.components).toHaveLength(2);
  });
});

it("refreshes an already-added UUT resolution when its instrument table is edited", () => {
  const {point,session}=makeFixture("direct");
  const master={...session.tmdes[0],id:"uut"};
  point.activeUutId="uut";point.associatedUutIds=["uut"];
  point.uutTolerance={...master.instrument.functions[0].ranges[0],rangeId:"range"};
  point.components=[{id:"uut-resolution",uutResolutionBudgetSource:true,type:"B"}];
  const before={...session,uuts:[master],testPoints:[point]};
  const initial=resolvePointBudgetComponents(point,before)[0];
  const after=syncPointTolerances({...before,uuts:[applyItemRangePatch(master,"range",{resolution:.5})]},before);
  const updated=resolvePointBudgetComponents(after.testPoints[0],after)[0];
  expect(updated.id).toBe(initial.id);
  expect(updated.value_native).toBeCloseTo(initial.value_native*5,10);
});

it("refreshes legacy TMDE snapshot calculations from the master without removing the resolution opt-in", () => {
  const {point,session}=makeFixture("direct");
  point.components=[];
  const range=session.tmdes[0].instrument.functions[0].ranges[0];
  point.tmdeTolerances=[{...range,id:"instance",sourceId:"meter",rangeId:"range",includeResolutionInBudget:true,measurementPoint:{value:10,unit:"V"}}];
  const initial=computePointRiskMetrics(point,session).tur;
  session.tmdes=[applyItemRangePatch(session.tmdes[0],"range",{resolution:10,resolutionDistribution:"1.732"})];
  expect(computePointRiskMetrics(point,session).tur).toBeLessThan(initial/2);
});

it("refreshes stored uncertainty for unopened points when a linked TMDE changes", () => {
  const {point,session}=makeFixture("derived");
  const before={...session,testPoints:[{...point,combined_uncertainty_absolute_base:999,expanded_uncertainty_absolute_base:999}]};
  const after=syncPointTolerances({...before,tmdes:[applyItemRangePatch(session.tmdes[0],"range",{resolution:2})]},before);
  const resolved=resolvePointBudgetComponents(point,after);
  expect(after.testPoints[0].combined_uncertainty_absolute_base).toBeCloseTo(Math.hypot(...resolved.map(c=>c.value_native)),10);
  expect(after.testPoints[0].expanded_uncertainty_absolute_base).toBeLessThan(999);
  expect(after.testPoints[0].components).toBe(point.components);
});
