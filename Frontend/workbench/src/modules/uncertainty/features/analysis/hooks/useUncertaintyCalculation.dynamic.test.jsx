import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useUncertaintyCalculation } from "./useUncertaintyCalculation";
import { createDynamicDefinition, createDynamicComponent, resolveDynamicComponents } from "../../../utils/dynamicBudgetComponents";

it("recalculates a dynamic budget on point changes and clears totals for missing entries", async () => {
  const definition = createDynamicDefinition("table", { unit:"V" });
  const id = definition.columns[0].id;
  definition.rows = [{id:"a",point:100,values:{[id]:{value:.012}}},{id:"b",point:200,values:{[id]:{value:.023}}}];
  const component = createDynamicComponent(definition);
  const session = { uncReq:{uncertaintyConfidence:95},dynamicBudgetDefinitions:[definition] };
  const data = value => { const point = {id:String(value),measurementType:"direct",testPointInfo:{parameter:{name:"Voltage",value,unit:"V"}},components:[component]};
    return {point,manual:resolveDynamicComponents(point.components,point,session)}; };
  const onSave = vi.fn(), tmdes=[], tolerance={};
  const { result, rerender } = renderHook(({point,manual})=>useUncertaintyCalculation(point,session,tmdes,tolerance,point.testPointInfo.parameter,manual,onSave),{initialProps:data(100)});
  await waitFor(()=>expect(result.current.calcResults?.combined_uncertainty_absolute_base).toBeCloseTo(.012));
  rerender(data(200));
  await waitFor(()=>expect(result.current.calcResults?.combined_uncertainty_absolute_base).toBeCloseTo(.023));
  rerender(data(150));
  await waitFor(()=>expect(result.current.calcResults?.is_detailed_uncertainty_calculated).toBe(false));
  const group=result.current.calcResults.calculatedBudgetGroups[0];
  expect(group.components[0].pendingReason).toMatch(/No table entry/);
  expect(group.results.combined).toBeNull();
});
