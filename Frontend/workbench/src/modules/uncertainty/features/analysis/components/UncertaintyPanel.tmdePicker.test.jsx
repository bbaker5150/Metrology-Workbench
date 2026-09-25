import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import UncertaintyPanel from "./UncertaintyPanel";

it.each([1, 2])("requires a range choice only when the TMDE has multiple ranges (%s)", (count) => {
  const range = index => ({ id: `range-${index}`, min: 0, max: index * 10, unit: "V", tolerances: { floor: { high: 1, low: -1, unit: "V", symmetric: true, distribution: "1.732" } } });
  const tmde = { id: "meter", name: "Reference meter", instrument: { functions: [{ name: "Voltage", unit: "V", ranges: Array.from({ length: count }, (_, i) => range(i + 1)) }] } };
  const update = vi.fn();
  render(<UncertaintyPanel
    testPointData={{ id: "point", measurementType: "direct", testPointInfo: { parameter: { name: "Voltage", value: 5, unit: "V" } }, components: [] }}
    sessionData={{ id: "session", uuts: [], tmdes: [tmde], testPoints: [], measurementAreas: [], uncReq: {} }}
    uutNominal={{ name: "Voltage", value: 5, unit: "V" }} tmdeTolerancesData={[]} onUpdateTestPoint={update}
    calcResults={{ combined_uncertainty: 0, expanded_uncertainty: 0, k_value: 2, effective_dof: Infinity }}
  />);
  fireEvent.click(screen.getByRole("button", { name: "Add component to budget" }));
  const menu = document.querySelector(".budget-tmde-picker-menu");
  if (count === 1) {
    // A single range is one selectable tile containing both instrument identity
    // and its specification; its accessible name includes both visible lines.
    const name = within(menu).getByRole("button", { name: "Reference meter 0 to 10 V | ± 1 V | Rectangular", exact: true });
    expect(name).toBeEnabled(); fireEvent.click(name);
  } else {
    const name = within(menu).getByRole("button", { name: "Reference meter", exact: true });
    expect(name).toBeDisabled();
    fireEvent.click(menu.querySelectorAll(".budget-tmde-picker-range")[1]);
  }
  expect(update).toHaveBeenCalled();
  expect(JSON.stringify(update.mock.calls)).toContain(`range-${count}`);
});

it.each(["direct", "derived"])("adds only the chosen named uncertainty to a %s budget", measurementType => {
  const sources = [
    { id: "manual", name: "Thermal", kind: "parametric", tolerance: { floor: { high: .3, low: -.3, unit: "V", distribution: "1.732" } } },
    { id: "table", name: "Head Height", kind: "table", dynamicDefinition: { id: "table", kind: "table", mode: "standard", measurementUnit: "V", outputUnit: "V", columns: [{ id: "u" }], rows: [{ point: 5, values: { u: { value: .2 } } }] } },
    { id: "equation", name: "Drift", kind: "equation", dynamicDefinition: { id: "eq", kind: "equation", mode: "standard", measurementUnit: "V", outputUnit: "V", columns: [{ id: "u" }], equation: "x / 25", pointVariable: "x", variables: { x: {} } } },
  ];
  const tmde = { id: "meter", name: "Reference meter", instrument: { tmdeSecondaryUncertainties: sources, functions: [{ name: "Voltage", unit: "V", ranges: [{ id: "range", min: 0, max: 10, unit: "V", tolerances: { floor: { high: 1, low: -1, unit: "V", distribution: "1.732" } } }] }] } };
  const update = vi.fn();
  render(<UncertaintyPanel
    testPointData={{ id: "point", measurementType, equationString: "x", variableMappings: { x: "Voltage" }, variableNominals: { x: { value: 5, unit: "V" } }, testPointInfo: { parameter: { name: "Voltage", value: 5, unit: "V" } }, components: [] }}
    sessionData={{ id: "session", uuts: [], tmdes: [tmde], testPoints: [], measurementAreas: [], uncReq: {} }}
    uutNominal={{ name: "Voltage", value: 5, unit: "V" }} tmdeTolerancesData={[]} onUpdateTestPoint={update}
    calcResults={{ combined_uncertainty: 0, expanded_uncertainty: 0, k_value: 2, effective_dof: Infinity,
      ...(measurementType === "derived" ? { calculatedBudgetGroups: [{ id: "Voltage", kind: "input", variableType: "Voltage", label: "Voltage", nominalPoint: { value: 5, unit: "V" }, components: [] }] } : {}) }}
  />);
  fireEvent.click(screen.getAllByRole("button", { name: "Add component to budget" })[0]);
  const menu = document.querySelector(".budget-tmde-picker-menu");
  for (const [index, source] of sources.entries()) {
    const option = within(menu).getByRole("button", { name: new RegExp("Reference meter - " + source.name) });
    expect(option.querySelector(".budget-add-component-copy > span")).toHaveTextContent("Reference meter - " + source.name);
    fireEvent.click(option);
    const rows = update.mock.calls.at(-1)[0].components;
    expect(rows).toHaveLength(1);
    expect(rows[0].tmdeUncertaintySourceId).toBe(source.id);
    expect(rows[0].name).toBe("Reference meter - " + source.name);
    expect(rows[0].value_native).toBeCloseTo(index === 0 ? .3 / Math.sqrt(3) : .2, 8);
    expect(rows[0].tmdeBudgetSourceId).toBe("meter");
    expect(rows[0].tmdeBudgetRangeId).toBe("range");
  }
  fireEvent.click(menu.querySelector(".budget-tmde-picker-single"));
  const rows = update.mock.calls.at(-1)[0].components;
  expect(rows).toHaveLength(1);
  expect(rows[0].value_native).toBeCloseTo(1 / Math.sqrt(3), 8);
});
