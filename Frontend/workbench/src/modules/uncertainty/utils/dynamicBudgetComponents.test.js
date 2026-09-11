import { describe, it, expect } from "vitest";
import { createDynamicDefinition, createDynamicComponent, resolveDynamicComponent, resolveDynamicComponents, updateDynamicDefinition, availableDynamicDefinitions } from "./dynamicBudgetComponents";
import { computeUncertaintyForPoint, computePointRiskMetrics, updateSharedDynamicDefinition } from "./riskCompute";

const table = () => { const d = createDynamicDefinition("table", {unit:"V"}); const id=d.columns[0].id;
  return {...d,name:"Head correction",rows:[{id:"a",point:"100",values:{[id]:{value:"0.012"}}},{id:"b",point:"200",values:{[id]:{value:"0.023"}}}]}; };
const point = (value, component) => ({id:String(value),measurementType:"direct",testPointInfo:{parameter:{name:"Voltage",value,unit:"V"}},components:[component],tmdeTolerances:[],uutTolerance:{floor:{high:1,low:-1,unit:"V",symmetric:true,distribution:"1.732"}}});
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
    const d={...createDynamicDefinition("equation",{unit:"V"}),equation:"A*B+C",pointVariable:"A",variables:{A:{name:"Point",value:""},B:{name:"Scale",value:"10"},C:{name:"Offset",value:"2.2"}}};
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
