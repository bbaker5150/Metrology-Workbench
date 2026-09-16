import { describe, it, expect } from "vitest";
import { createDynamicDefinition, createDynamicComponent, resolveDynamicComponent, resolveDynamicComponents, updateDynamicDefinition, availableDynamicDefinitions, attachDynamicComponent } from "./dynamicBudgetComponents";
import { computeUncertaintyForPoint, computePointRiskMetrics, updateSharedDynamicDefinition } from "./riskCompute";

const table = () => { const d = createDynamicDefinition("table", {unit:"V"}); const id=d.columns[0].id;
  return {...d,mode:"standard",distribution:"1",name:"Head correction",rows:[{id:"a",point:"100",values:{[id]:{value:"0.012"}}},{id:"b",point:"200",values:{[id]:{value:"0.023"}}}]}; };
const point = (value, component) => ({id:String(value),measurementType:"direct",testPointInfo:{parameter:{name:"Voltage",value,unit:"V"}},components:[component],tmdeTolerances:[],uutTolerance:{floor:{high:1,low:-1,unit:"V",symmetric:true,distribution:"1.732"}}});
it("new error-limit components wait for an explicit distribution", () => {
  const d = createDynamicDefinition("table", { unit: "V" });
  d.rows[0] = { ...d.rows[0], point: 25, values: { [d.columns[0].id]: { value: .2 } } };
  const c = createDynamicComponent(d);
  expect(resolveDynamicComponent(c, d, { value: 25, unit: "V" }).pendingReason).toMatch(/distribution/);
  expect(resolveDynamicComponent(c, { ...d, distribution: "2" }, { value: 25, unit: "V" }).value_native).toBe(.1);
  expect(resolveDynamicComponent(c, { ...d, measurementUnit: "", outputUnit: "", distribution: "2" }, { value: 25, unit: "V" })).toMatchObject({ value_native: .1, unit_native: "V" });
});
it("evaluates asymmetric equations with shared variables and validates their order", () => {
  const d = { ...createDynamicDefinition("equation", { unit: "V" }), mode: "limits", distribution: "2", lowerEquation: "-x*a", upperEquation: "x*b", pointVariable: "x", variables: { a: { value: .01 }, b: { value: .02 } } };
  const c = createDynamicComponent(d);
  expect(resolveDynamicComponent(c, d, { value: 100, unit: "V" })).toMatchObject({ value_native: .75, dynamicSummary: "-1 to 2 V" });
  expect(resolveDynamicComponent(c, { ...d, lowerEquation: "3" }, { value: 100, unit: "V" }).pendingReason).toMatch(/upper/);
  expect(resolveDynamicComponent(c, { ...d, outputUnit: "A" }, { value: 100, unit: "V" }).pendingReason).toMatch(/incompatible/);
});
describe("shared dynamic budget definitions",()=>{
  it("looks up copied and newly created points without carrying the source's result",()=>{
    const d=table(), c=createDynamicComponent(d); const session={dynamicBudgetDefinitions:[d],uncReq:{uncertaintyConfidence:95}};
    for(const [nominal,expected] of [[100,.012],[200,.023]]) {
      const p=point(nominal,JSON.parse(JSON.stringify(c)));
      expect(resolveDynamicComponents(p.components,p,session)[0].value_native).toBe(expected);
      expect(computeUncertaintyForPoint(p,session).combined_uncertainty_absolute_base).toBeCloseTo(expected,10);
    }
  });
  it("updates all references and fresh risk metrics when one shared definition changes",()=>{
    const d=table(), c=createDynamicComponent(d), p=point(100,c), p2=point(200,c);
    const session={dynamicBudgetDefinitions:[d],testPoints:[p,p2],uncReq:{uncertaintyConfidence:95,reliability:95,reqPFA:2,calInt:12,neededTUR:4,measRelCalcAssumed:85,guardBandMultiplier:1}};
    const before=computePointRiskMetrics(p,session);
    const changed={...d,rows:d.rows.map(row=>({...row,values:{[d.columns[0].id]:{value:"0.25"}}}))};
    const next=updateDynamicDefinition(session,changed);
    expect(next.testPoints.every(p=>p.components[0].dynamicDefinition===changed)).toBe(true);
    expect(resolveDynamicComponents(p2.components,p2,next)[0].value_native).toBe(.25);
    expect(computePointRiskMetrics(p,next)).not.toEqual(before);
    expect(session.dynamicBudgetDefinitions[0]).toBe(d);
  });
  it("does not interpolate, extrapolate, accept duplicate points, or use stale risk",()=>{
    const d=table(),c=createDynamicComponent(d),session={dynamicBudgetDefinitions:[d],uncReq:{uncertaintyConfidence:95}};
    expect(resolveDynamicComponent(c,d,{value:150,unit:"V"}).pendingReason).toMatch(/No table entry/);
    expect(computePointRiskMetrics({...point(150,c),expanded_uncertainty_absolute_base:1},session)).toBeNull();
    expect(resolveDynamicComponent(c,{...d,rows:[d.rows[0],d.rows[0]]},{value:100,unit:"V"}).pendingReason).toMatch(/Duplicate/);
  });
  it("matches equivalent units and keeps separate uncertainty columns",()=>{
    const d=table();d.columns.push({id:"other",name:"Other"});d.rows[0].values.other={value:"2"};
    const result=resolveDynamicComponent(createDynamicComponent(d,"other"),d,{value:100000,unit:"mV"});
    expect(result.value_native).toBe(2);
    expect(result.name).toBe("Head correction — Other");
    expect(resolveDynamicComponent(createDynamicComponent(d),d,{value:100,unit:"A"}).pendingReason).toMatch(/incompatible/);
  });
  it("uses half the error-limit span and the selected distribution",()=>{
    const d=table();d.mode="limits";d.distribution="2";d.rows[0].values[d.columns[0].id]={low:"-.14",high:".13"};
    expect(resolveDynamicComponent(createDynamicComponent(d),d,{value:100,unit:"V"}).value_native).toBeCloseTo(.0675);
  });
  it("evaluates the measurement variable independently on each point",()=>{
    const d={...createDynamicDefinition("equation",{unit:"V"}),mode:"standard",distribution:"1",equation:"A*B+C",pointVariable:"A",variables:{A:{name:"Point",value:""},B:{name:"Scale",value:"10"},C:{name:"Offset",value:"2.2"}}};
    const c=createDynamicComponent(d);
    expect(resolveDynamicComponent(c,d,{value:100,unit:"V"}).value_native).toBe(1002.2);
    expect(resolveDynamicComponent(c,d,{value:200,unit:"V"}).value_native).toBe(2002.2);
    expect(resolveDynamicComponent(c,d,{value:0,unit:"V"}).value_native).toBe(2.2);
    expect(resolveDynamicComponent(c,{...d,equation:"import('x')"},{value:100,unit:"V"}).pendingReason).toBeTruthy();
    expect(resolveDynamicComponent(c,{...d,equation:"1/0"},{value:100,unit:"V"}).pendingReason).toMatch(/finite/);
    expect(resolveDynamicComponent(c,{...d,equation:"-1"},{value:100,unit:"V"}).pendingReason).toMatch(/negative/);
  });
  it("retains portable definitions through session and budget serialization",()=>{
    const d=table(), c=createDynamicComponent(d);
    const session=JSON.parse(JSON.stringify({testPoints:[point(100,c)]}));
    expect(availableDynamicDefinitions(session)).toEqual([d]);
    expect(resolveDynamicComponents([c],point(200,c),session)[0].value_native).toBe(.023);
  });
});

it("matches temperature nominals with offsets and does not merge tiny distinct points",()=>{
  const d=table();d.measurementUnit='degC';d.outputUnit='degC';d.rows[0].point=0;
  const c=createDynamicComponent(d);
  expect(resolveDynamicComponent(c,d,{value:32,unit:'degF'}).value_native).toBe(.012);
  d.measurementUnit='V';d.outputUnit='V';
  expect(resolveDynamicComponent(c,d,{value:1e-12,unit:'V'}).pendingReason).toMatch(/No table entry/);
});
it("resolves shared dynamic components in derived input budgets",()=>{
  const d=table(), c=createDynamicComponent(d,null,{kind:'input',variableType:'Input'});
  const p={...point(200,c),measurementType:'derived',equationString:'X*2',variableMappings:{X:'Input'},variableNominals:{X:{value:100,unit:'V'}}};
  const session={dynamicBudgetDefinitions:[d],uncReq:{uncertaintyConfidence:95}};
  expect(resolveDynamicComponents(p.components,p,session)[0].value_native).toBe(.012);
  expect(computeUncertaintyForPoint(p,session).combined_uncertainty_absolute_base).toBeCloseTo(.024);
});

it("refreshes cached uncertainty for unopened points on a shared edit",()=>{
  const d=table(),c=createDynamicComponent(d),p=point(100,c),p2=point(200,c);
  const session={testPoints:[p,p2],dynamicBudgetDefinitions:[d],uncReq:{uncertaintyConfidence:95}};
  const changed={...d,rows:d.rows.map(row=>({...row,values:{[d.columns[0].id]:{value:.5}}}))};
  const next=updateSharedDynamicDefinition(session,changed);
  expect(next.testPoints.map(p=>p.combined_uncertainty_absolute_base)).toEqual([.5,.5]);
});


it.each([["degF", "°F"], ["degC", "°C"], ["Ohm", "Ω"], ["um", "µm"]])("formats dynamic budget limits with display symbols for %s", (unit, label) => {
  for (const kind of ['table', 'equation']) {
    const d = { ...createDynamicDefinition(kind, { value: 1, unit }), mode: 'standard', equation: 'x*2', pointVariable: 'x' };
    d.rows[0] = { ...d.rows[0], point: 1, values: { [d.columns[0].id]: { value: 2 } } };
    const resolved = resolveDynamicComponent(createDynamicComponent(d), d, { value: 1, unit });
    expect(resolved.dynamicSummary).toBe(`± 2 ${label}`);
    expect(resolved.unit_native).toBe(unit);
  }
});


it("binds shared input budgets to their own live nominal and final budgets to the point", () => {
  const points = [2,3].map((w,i) => ({ id: String(i), measurementType: 'derived', equationString: 'w*l', variableMappings: { w: 'Weight', l: 'Length' }, variableNominals: { w: { value:w,unit:'ozf' }, l:{value:2,unit:'in'} }, testPointInfo:{parameter:{value:w*2,unit:'in-ozf'}}, components: [] }));
  let session = attachDynamicComponent({testPoints:points},'0','equation',{kind:'input',variableType:'Weight'}).session;
  const definition = {...session.dynamicBudgetDefinitions[0],equation:'x/10',pointVariable:'x',mode:'standard'};
  session = updateDynamicDefinition(session,definition);
  session = attachDynamicComponent(session,'1','equation',{kind:'input',variableType:'Weight'},definition).session;
  expect(definition.measurementUnit).toBe('ozf');
  expect(session.testPoints.map(p=>resolveDynamicComponents(p.components,p,session)[0].value_native)).toEqual([.2,.3]);
  session.testPoints[1].variableNominals.w.value=5;
  expect(resolveDynamicComponents(session.testPoints[1].components,session.testPoints[1],session)[0].value_native).toBe(.5);
  const noUnit={...session.testPoints[0],variableNominals:{w:{value:2,unit:''}}};
  expect(resolveDynamicComponents(noUnit.components,noUnit,session)[0].pendingReason).toMatch(/No unit is set for Weight/);
  const final=attachDynamicComponent(session,'1','equation').session;
  expect(final.dynamicBudgetDefinitions.at(-1).measurementUnit).toBe('in-ozf');
});

it.each(['table', 'equation'])("reuses one named %s draft across points and avoids duplicate budget rows", kind => {
  const p1 = point(100, null), p2 = point(200, null);
  p1.components = []; p2.components = [];
  let session = { testPoints: [p1, p2] };
  session = attachDynamicComponent(session, p1.id, kind).session;
  session = attachDynamicComponent(session, p1.id, kind).session;
  session = attachDynamicComponent(session, p2.id, kind).session;
  expect(session.dynamicBudgetDefinitions).toHaveLength(1);
  expect(session.dynamicBudgetDefinitions[0].name).toBe(`${kind === 'table' ? 'Tabular' : 'Equation'} component 1`);
  expect(session.testPoints.map(p => p.components.length)).toEqual([1, 1]);
  expect(session.testPoints[0].components[0].dynamicDefinitionId).toBe(session.testPoints[1].components[0].dynamicDefinitionId);
  if (kind === 'table') expect(session.dynamicBudgetDefinitions[0].rows.map(row => row.point)).toEqual([100, 200]);
});

it("repairs a legacy equation bound to the final point's different physical quantity", () => {
  const definition = { ...createDynamicDefinition('equation', {unit:'ozf'}, {unit:'in-ozf'}), equation:'x/10', pointVariable:'x', mode:'standard' };
  expect(resolveDynamicComponent(createDynamicComponent(definition), definition, {value:3,unit:'ozf'}).value_native).toBe(.3);
});

it.each(['table','equation'])("keeps a unitless %s draft reusable and reports its missing unit", kind => {
  const p = {id:'p',components:[],measurementType:'derived',variableMappings:{w:'Weight'},variableNominals:{w:{value:2,unit:''}}};
  let session = attachDynamicComponent({testPoints:[p]}, 'p', kind, {kind:'input',variableType:'Weight'}).session;
  session = attachDynamicComponent(session, 'p', kind, {kind:'input',variableType:'Weight'}).session;
  expect(session.dynamicBudgetDefinitions).toHaveLength(1);
  expect(session.testPoints[0].components).toHaveLength(1);
  expect(resolveDynamicComponents(session.testPoints[0].components,p,session)[0].pendingReason).toMatch(/No unit is set for Weight/);
});

it("reuses an authored table at a new point and shares later edits without altering other rows", () => {
  const p1 = point(100, null), p2 = point(200, null); p1.components = []; p2.components = [];
  let session = attachDynamicComponent({ testPoints: [p1, p2] }, p1.id, 'table').session;
  const definition = session.dynamicBudgetDefinitions[0], column = definition.columns[0].id;
  session = updateDynamicDefinition(session, { ...definition, mode: 'standard', rows: [{ ...definition.rows[0], values: { [column]: { value: .1 } } }] });
  session = attachDynamicComponent(session, p2.id, 'table', null, session.dynamicBudgetDefinitions[0]).session;
  session = attachDynamicComponent(session, p2.id, 'table', null, definition).session;
  expect(session.dynamicBudgetDefinitions).toHaveLength(1);
  expect(session.testPoints[1].components).toHaveLength(1);
  const updated = { ...session.dynamicBudgetDefinitions[0], rows: session.dynamicBudgetDefinitions[0].rows.map(row => ({ ...row, values: { [column]: { value: row.point / 1000 } } })) };
  session = updateDynamicDefinition(session, updated);
  expect(session.testPoints.map(p => resolveDynamicComponents(p.components, p, session)[0].value_native)).toEqual([.1, .2]);
  const distinct = attachDynamicComponent(session, p1.id, 'table').session;
  expect(distinct.dynamicBudgetDefinitions).toHaveLength(2);
  expect(distinct.dynamicBudgetDefinitions[1].name).toBe('Tabular component 2');
});
