import React from "react";
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import DynamicBudgetComponentRow from "./DynamicBudgetComponentRow";
import { InlineToleranceCell } from "./UncertaintyPanel";
import { createDynamicDefinition, createDynamicComponent } from "../../../utils/dynamicBudgetComponents";

vi.mock("plotly.js-dist", () => ({ default: {} }));

function renderLimits(kind, low, high, sharedEditor = false) {
  const point = { value: 5, unit: "V" };
  const definition = { ...createDynamicDefinition(kind, point), mode: "limits", distribution: "1.732",
    lowerEquation: String(low), upperEquation: String(high) };
  definition.rows = [{ point: 5, values: { [definition.columns[0].id]: { low, high } } }];
  return render(<table><tbody><DynamicBudgetComponentRow component={createDynamicComponent(definition)}
    referencePoint={point} measurementPoint={point} onCommit={vi.fn()}
    ToleranceEditorComponent={sharedEditor ? InlineToleranceCell : undefined} /></tbody></table>);
}

it.each(["table", "equation"])('stacks %s error limits beside their unit in the shared budget editor', kind => {
  const { container } = renderLimits(kind, -0.14, 0.13, true);
  const cell = container.querySelector(".dynamic-tolerance-cell");
  expect([...cell.querySelectorAll(".stacked-tolerance-limits > span")].map(node => node.textContent)).toEqual(["+0.13", "-0.14"]);
  expect(cell).toHaveTextContent("V");
  expect(cell).not.toHaveTextContent(" to ");
  expect(cell.querySelector(".stacked-tolerance-limits")).toHaveAccessibleName("Upper limit +0.13; lower limit -0.14");
});

it.each([
  [-0.14, 0.13, "+0.13", "-0.14"],
  [0.1, 0.2, "+0.2", "+0.1"],
  [-0.2, -0.1, "-0.1", "-0.2"],
  [0, 0.1, "+0.1", "−0"],
  [-0.1, 0, "+0", "-0.1"],
  [-3.472e-9, 2.1e-9, "+2.1e-9", "-3.472e-9"],
])('preserves signed bounds %s to %s in the fallback budget renderer', (low, high, upper, lower) => {
  const { container } = renderLimits("table", low, high);
  const cell = container.querySelector(".dynamic-tolerance-cell");
  expect([...cell.querySelectorAll(".stacked-tolerance-limits > span")].map(node => node.textContent)).toEqual([upper, lower]);
  expect(cell).toHaveTextContent("V");
  expect(cell).not.toHaveTextContent(" to ");
});
