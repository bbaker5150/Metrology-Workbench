import { preparePointForPaste } from "../../../utils/pointClipboard";
import { computeUncertaintyForPoint } from "../../../utils/riskCompute";
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import UncertaintyPanel, { InlineToleranceCell, getCollapsedSpecRows, getSpecRows } from "./UncertaintyPanel";
import { resolvePointBudgetComponents } from "../../../utils/resolvePointBudgetComponents";
import { createDynamicDefinition, createDynamicComponent, resolveDynamicComponents } from "../../../utils/dynamicBudgetComponents";
import { copyPointBudget, pastePointBudget } from "../../../App";
import DynamicBudgetComponentRow from "./DynamicBudgetComponentRow";

vi.mock("plotly.js-dist", () => ({ default: {} }));
const term = (high, unit) => ({ high, low: -high, unit, symmetric: true, distribution: "1.732" });
const tolerance = { whicheverIsGreater: true, reading: term(10, "%"), floor: term(2, "V") };

it("shows the winning authored term while preserving every alternative in the editor and picker", () => {
  const before = JSON.stringify(tolerance);
  expect(getCollapsedSpecRows(tolerance, { value: 5, unit: "V" })[0]).toBe("± 2 V");
  expect(getCollapsedSpecRows({ tolerances: tolerance }, { value: 50, unit: "V" })[0]).toBe("± 10% IV");
  expect(getCollapsedSpecRows(tolerance, { value: 0, unit: "V" })[0]).toBe("± 2 V");
  expect(getCollapsedSpecRows(tolerance, { value: -50, unit: "V" })[0]).toBe("± 10% IV");
  expect(getCollapsedSpecRows(tolerance)[0]).toBe("Point-dependent");
  expect(getCollapsedSpecRows(tolerance, { value: 50, unit: "A" })[0]).toBe("Unit mismatch");
  expect(getSpecRows(tolerance)[0]).toMatch(/10% IV, or ±2 V, whichever is greater/);
  expect(JSON.stringify(tolerance)).toBe(before);
  render(<InlineToleranceCell tolerance={tolerance} activeRange={{ unit: "V" }} referencePoint={{ value: 5, unit: "V" }} editable onCommit={vi.fn()} />);
  expect(screen.getByText("± 2 V")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("checkbox", { name: /whichever is greater/i })).toBeChecked();
});

it("adds a TMDE with mismatched units as a linked, warned budget component", () => {
  const tmde = { id: "amps", name: "Current reference", measurementAreaNames: ["Voltage"], instrument: { functions: [{ name: "Current", unit: "A", ranges: [
    { id: "amp-range", min: 0, max: 10, unit: "A", tolerances: { floor: term(1, "A") } },
  ] }] } };
  const point = { id: "p", measurementType: "direct", testPointInfo: { parameter: { name: "Voltage", value: 5, unit: "V" } }, components: [] };
  const session = { id: "s", uuts: [], tmdes: [tmde], testPoints: [point], measurementAreas: [], uncReq: {} };
  const update = vi.fn();
  render(<UncertaintyPanel testPointData={point} sessionData={session} uutNominal={point.testPointInfo.parameter}
    tmdeTolerancesData={[]} onUpdateTestPoint={update} calcResults={{ combined_uncertainty: 0, expanded_uncertainty: 0, k_value: 2, effective_dof: Infinity }} />);
  fireEvent.click(screen.getByRole("button", { name: "Add component to budget" }));
  const menu = document.querySelector(".budget-tmde-picker-menu");
  expect(within(menu).getByRole("img", { name: /Unit mismatch/ })).toBeInTheDocument();
  fireEvent.click(within(menu).getByRole("button", { name: /^Current reference/ }));
  const components = update.mock.calls.at(-1)[0].components;
  expect(components).toHaveLength(1);
  expect(components[0].tmdeBudgetRangeId).toBe("amp-range");
  const resolved = resolvePointBudgetComponents({ ...point, components }, session);
  expect(resolved[0].pendingReason).toMatch(/Unit mismatch/);
  expect(resolved[0].value_native).toBeNull();
});

it("keeps the entered table on collapse while the parent save is still pending", async () => {
  const definition = { ...createDynamicDefinition("table", { unit: "V" }), mode: "standard", distribution: "1" };
  const component = createDynamicComponent(definition);
  const commit = vi.fn();
  const ui = saved => <><button>Outside</button><table><tbody><DynamicBudgetComponentRow component={saved}
    referencePoint={{ value: 3000, unit: "V" }} onCommit={commit} /></tbody></table></>;
  const { rerender } = render(ui(component));
  fireEvent.click(document.querySelector(".dynamic-tolerance-cell button"));
  fireEvent.paste(screen.getByLabelText("Measurement point row 1"), { clipboardData: { getData: () => "3000\t3\n4000\t4" } });
  fireEvent.click(screen.getByRole("button", { name: "Outside" }));
  await waitFor(() => expect(commit).toHaveBeenCalledOnce());
  expect(screen.getByRole("button", { name: "± 3 V" })).toBeInTheDocument();
  rerender(ui({ ...component, dynamicDefinition: structuredClone(definition) }));
  expect(screen.getByRole("button", { name: "± 3 V" })).toBeInTheDocument();
  const saved = commit.mock.calls[0][0];
  rerender(ui({ ...component, dynamicDefinition: saved }));
  fireEvent.click(screen.getByRole("button", { name: "Edit error limit distribution" }));
  fireEvent.change(screen.getByLabelText("Error limit distribution"), { target: { value: "1.732" } });
  expect(commit.mock.calls.at(-1)[0]).toMatchObject({ mode: "tolerance", distribution: "1.732" });
  expect(screen.getByRole("button", { name: "± 3 V" })).toBeInTheDocument();
});

it.each(["table", "equation"])("re-evaluates a copied %s component at the destination measurement value", kind => {
  const definition = createDynamicDefinition(kind, { unit: "V" });
  const col = definition.columns[0].id;
  Object.assign(definition, { mode: "tolerance", distribution: "2",
    rows: [{ id: "a", point: 3000, values: { [col]: { value: 3 } } }, { id: "b", point: 4000, values: { [col]: { value: 4 } } }],
    equation: "x/1000", pointVariable: "x", variables: { x: { value: "", name: "Point" } } });
  const source = { id: "a", measurementType: "direct", testPointInfo: { parameter: { value: 3000, unit: "V" } }, components: [createDynamicComponent(definition)] };
  const destination = { id: "b", measurementType: "direct", testPointInfo: { parameter: { value: 4000, unit: "V" } } };
  const copy = pastePointBudget(destination, copyPointBudget(source));
  const result = resolveDynamicComponents(copy.components, copy, { dynamicBudgetDefinitions: [definition] })[0];
  expect(result.dynamicSummary).toBe("± 4 V");
  expect(result.value_native).toBe(2);
  expect(result.dynamicReferencePoint.value).toBe(4000);
  expect(source.testPointInfo.parameter.value).toBe(3000);
});

it.each(["table", "equation"])("preserves destination derived nominals when pasting a shared %s budget", kind => {
  const definition = { ...createDynamicDefinition(kind, { value: 2, unit: 'ozf' }), mode: 'standard', equation: 'x/10', pointVariable: 'x' };
  definition.rows = [2,3].map(value => ({ id:String(value), point:value, values:{[definition.columns[0].id]:{value:value/10}} }));
  const source = { measurementType:'derived', equationString:'w*l', variableMappings:{w:'Weight',l:'Length'}, variableNominals:{w:{value:2,unit:'ozf'},l:{value:2,unit:'in'}}, components:[createDynamicComponent(definition,null,{kind:'input',variableType:'Weight'})] };
  const destination = {...source, testPointInfo:{parameter:{value:6,unit:'in-ozf'}}, variableNominals:{w:{value:3,unit:'ozf'},l:{value:2,unit:'in'}}, components:[]};
  const pasted = pastePointBudget(destination,copyPointBudget(source));
  expect(pasted.variableNominals.w.value).toBe(3);
  expect(resolveDynamicComponents(pasted.components,pasted,{dynamicBudgetDefinitions:[definition]})[0].value_native).toBe(.3);
  expect(source.variableNominals.w.value).toBe(2);
});


it("recalculates copied Fahrenheit equation budgets and edited point copies without carrying source results", () => {
  const definition = { ...createDynamicDefinition("equation", { unit: "degF" }),
    mode: "standard", distribution: "1", equation: "x*a", pointVariable: "x", variables: { x: { value: 1 }, a: { value: .1 } } };
  const session = { dynamicBudgetDefinitions: [definition], uncReq: { uncertaintyConfidence: 95 } };
  const source = { id: "source", measurementType: "direct", testPointInfo: { parameter: { value: 1, unit: "degF" } }, components: [createDynamicComponent(definition)] };
  source.components = resolveDynamicComponents(source.components, source, session);
  const pasted = pastePointBudget({ id: "destination", measurementType: "direct", testPointInfo: { parameter: { value: 4, unit: "degF" } } }, copyPointBudget(source));
  expect(pasted.components[0]).not.toHaveProperty("dynamicReferencePoint");
  expect(pasted.components[0].value_native).toBeNull();
  expect(computeUncertaintyForPoint(pasted, session).combined_uncertainty_absolute_base).toBeCloseTo(.4 * 5/9, 7);
  pasted.components = resolveDynamicComponents(pasted.components, pasted, session);
  const copy = preparePointForPaste(pasted, { mode: "copy" });
  expect(copy.components[0]).not.toHaveProperty("dynamicReferencePoint");
  copy.testPointInfo = { parameter: { value: 7, unit: "degF" } };
  expect(computeUncertaintyForPoint(copy, session).combined_uncertainty_absolute_base).toBeCloseTo(.7 * 5/9, 7);
  expect(resolveDynamicComponents(copy.components, copy, session)[0].value_native).toBeCloseTo(.7);
  expect(definition.variables.a.value).toBe(.1);
  expect(source.testPointInfo.parameter.value).toBe(1);
  expect(pasted.testPointInfo.parameter.value).toBe(4);
});
