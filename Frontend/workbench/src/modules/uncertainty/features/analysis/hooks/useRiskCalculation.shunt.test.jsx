import { buildSessionReportModel } from "../../../utils/pdfGenerator";
import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useUncertaintyCalculation } from "./useUncertaintyCalculation";
import { useRiskCalculation } from "./useRiskCalculation";
import { resolvePointBudgetComponents } from "../../../utils/resolvePointBudgetComponents";
import { computePointRiskMetrics, computeUncertaintyForPoint } from "../../../utils/riskCompute";

it("preserves explicit shunt resolution and matches detailed risk and mitigations", async () => {
  const range = { id:"shunt-range", min:0, max:1, tolerances:{
    floor:{low:-3.125e-8,high:3.125e-8,unit:"Ohm",distribution:"1.960"},
    resolution:1e-7,resolutionUnit:"Ohm",resolutionDistribution:"3.464",includeResolutionInBudget:false
  }};
  const session = {uncReq:{uncertaintyConfidence:95,reliability:85,reqPFA:2,calInt:6,neededTUR:4,measRelCalcAssumed:85,guardBandMultiplier:1},
    tmdes:[{id:"shunt",instrument:{functions:[{id:"resistance",name:"Resistance",unit:"Ohm",ranges:[range]}]}}]};
  const point={id:"500A",measurementType:"derived",equationString:"V/R",variableMappings:{V:"Voltage",R:"Resistance"},
    variableNominals:{V:{value:6.25,unit:"mV"},R:{value:12.5e-6,unit:"Ohm"}},
    testPointInfo:{parameter:{value:500,unit:"A"}},tmdeTolerances:[],
    uutTolerance:{floor:{low:-50,high:50,unit:"A",distribution:"1.732"}},
    components:[{id:"voltage",name:"Voltage",variableType:"Voltage",value_native:.0021017294,unit_native:"mV",type:"B"},
      ...["Accuracy","Resolution"].map(kind=>({id:kind,name:kind,variableType:"Resistance",tmdeBudgetSourceId:"shunt",tmdeBudgetRangeId:"shunt-range",tmdeBudgetComponentKind:kind,type:"B"}))]};
  const sources=resolvePointBudgetComponents(point,session);
  expect(sources).toHaveLength(3);
  const expectedU=1.95996398454*Math.hypot(80*.0021017294,4e7*Math.hypot(3.125e-8/1.96,1e-7/Math.sqrt(12)));
  const sidebar=computePointRiskMetrics(point,session,true);
  expect(computeUncertaintyForPoint(point,session).expanded_uncertainty_absolute_base).toBeCloseTo(expectedU,6);
  expect(sidebar.tur).toBeCloseTo(19.184,3);
  const save=vi.fn();
  const {result}=renderHook(()=>{
    const {calcResults}=useUncertaintyCalculation(point,session,point.tmdeTolerances,point.uutTolerance,point.testPointInfo.parameter,sources,save);
    const risk = useRiskCalculation(session,point,point.uutTolerance,point.tmdeTolerances,point.testPointInfo.parameter,calcResults,"riskmitigation");
    return {...risk,calcResults};
  });
  await waitFor(()=>expect(result.current.riskResults?.tur).toBeCloseTo(sidebar.tur,8));
  for(const key of ["pfa","pfr","gbLow","gbHigh","gbPfa","gbPfr"]){
    expect(sidebar[key],key).toBeDefined();
    expect(result.current.riskResults[key],key).toBeCloseTo(sidebar[key],8);
  }
  const equation=result.current.calcResults.calculatedBudgetGroups.find(g=>g.kind==="equation");
  expect(equation.rows.find(r=>r.variable==="V").standardUncertainty).toBeCloseTo(.0021017294,10);
  const report=buildSessionReportModel({...session,testPoints:[{...point,...result.current.calcResults}]},{[point.id]:sidebar},{
    getToleranceErrorSummary:()=>"±50 A",getAbsoluteLimits:()=>({low:"450 A",high:"550 A"})
  });
  const row=report.functions[0].uuts[0].ranges[0].rows[0];
  expect(Number(row.tur)).toBeCloseTo(19.184,2);
  const changed=structuredClone(session); changed.tmdes[0].instrument.functions[0].ranges[0].tolerances.resolution=2e-7;
  expect(computePointRiskMetrics(point,changed).tur).toBeLessThan(sidebar.tur);
});


