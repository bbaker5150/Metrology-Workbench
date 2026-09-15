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
  const name = within(menu).getByRole("button", { name: "Reference meter", exact: true });
  if (count === 1) {
    expect(name).toBeEnabled(); fireEvent.click(name);
  } else {
    expect(name).toBeDisabled();
    fireEvent.click(menu.querySelectorAll(".budget-tmde-picker-range")[1]);
  }
  expect(update).toHaveBeenCalled();
  expect(JSON.stringify(update.mock.calls)).toContain(`range-${count}`);
});
