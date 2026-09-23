import React, { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import UncertaintyPanel, { RangeCell, getSpecRows } from "./UncertaintyPanel";
import RepeatabilityModal from "./RepeatabilityModal";
import { getBudgetComponentsFromTolerance } from "../utils/budgetUtils";
vi.mock("plotly.js-dist", () => ({ default: {} }));

it("tabs out of an expanded range into the intervening collapsed custom column", async () => {
  const CustomCell = () => {
    const [editing, setEditing] = useState(false);
    return editing ? <input aria-label="Custom column" /> : <button className="inline-tolerance-summary" onClick={() => setEditing(true)}>Not Set</button>;
  };
  const tolerance = vi.fn();
  const range = { id: "r", min: 0, max: 10, unit: "V" };
  render(<table><tbody><tr><td><RangeCell ranges={[range]} activeIndex={0} activeRange={range}
    editable onEditBound={vi.fn()} onEditUnit={vi.fn()} onOpenTolerance={tolerance} /></td>
    <td><CustomCell /></td><td><button className="inline-tolerance-summary" onClick={tolerance}>Tolerance</button></td>
  </tr></tbody></table>);
  fireEvent.click(screen.getByRole("button", { name: "0 to 10 V" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "Range unit prefix" }), { key: "Tab" });
  await waitFor(() => expect(screen.getByLabelText("Custom column")).toHaveFocus());
  expect(tolerance).not.toHaveBeenCalled();
});

it("offers only base units in Repeatability while preserving a saved prefix", () => {
  render(<RepeatabilityModal isOpen onClose={vi.fn()} onSave={vi.fn()} uutNominal={{ value: 2, unit: "mV" }} />);
  expect(screen.getByRole("button", { name: "Repeatability unit prefix" })).toHaveTextContent("m");
  fireEvent.click(screen.getByRole("button", { name: "Repeatability unit base unit" }));
  fireEvent.change(screen.getByPlaceholderText("Search units..."), { target: { value: "volt" } });
  const options = screen.getAllByRole("option");
  expect(options.some(option => option.textContent.startsWith("V"))).toBe(true);
  expect(options.some(option => /^(mV|uV|kV)/.test(option.textContent))).toBe(false);
});

const EquationHarness = ({ calculated = 5 }) => {
  const [point, setPoint] = useState({ id: "followup-equation", measurementType: "derived", equationString: "E", variableMappings: { E: "Input" },
    variableNominals: { E: { value: 5, unit: "V" } }, testPointInfo: { parameter: { value: 5, unit: "V" } }, components: [] });
  return <UncertaintyPanel testPointData={point} sessionData={{ id: "s", uuts: [], tmdes: [], testPoints: [point] }}
    calcResults={{ calculatedNominalValue: calculated }} uutNominal={point.testPointInfo.parameter} tmdeTolerancesData={[]}
    onUpdateTestPoint={patch => setPoint(previous => ({ ...previous, ...patch }))} />;
};

it("keeps invalid syntax editable after clicking away and collapses after correction", () => {
  render(<EquationHarness />);
  fireEvent.click(screen.getByRole("button", { name: "Edit measurement equation" }));
  fireEvent.change(screen.getByLabelText("Measurement equation"), { target: { value: "/asd" } });
  fireEvent.click(document.body);
  expect(screen.getByLabelText("Measurement equation")).toHaveValue("/asd");
  expect(document.querySelector(".measurement-equation-actions")).toHaveTextContent("Library");
  expect(screen.getByText(/Equation does not parse/)).toBeInTheDocument();
  fireEvent.focus(screen.getByLabelText("Measurement equation"));
  fireEvent.change(screen.getByLabelText("Measurement equation"), { target: { value: "E" } });
  fireEvent.keyDown(screen.getByLabelText("Measurement equation"), { key: "Enter" });
  expect(screen.getByRole("button", { name: "Edit measurement equation" })).toBeInTheDocument();
});

it.each([[5, "Matches measurement point"], [6, "Does not match measurement point"], [null, null]])("shows the table status for calculated value %s", (calculated, label) => {
  render(<EquationHarness calculated={calculated} />);
  const table = document.querySelector(".measurement-inputs-table");
  if (label) expect(within(table).getByText(label)).toBeInTheDocument();
  else expect(table.querySelector("tfoot")).toBeNull();
});

it.each(["", "A", "ohm"])("preserves the authored TMDE error limit with point unit '%s'", unit => {
  const source = { unit: "ohm", floor: { high: 2, low: -2, unit: "ohm", distribution: "1.732" } };
  const [component] = getBudgetComponentsFromTolerance(source, { value: 5, unit });
  expect(component.unit_native).toBe("ohm");
  expect(getSpecRows(component.authoredTolerance)[0]).toContain("Ω");
  expect(getSpecRows(component.authoredTolerance)[0]).not.toContain("ppm");
});


it.each(["", "5"])("retains source units for an unassigned point unit and value '%s'", value => {
  const [component] = getBudgetComponentsFromTolerance({ unit: "mV", floor: { high: 2, low: -2, unit: "mV", distribution: "1.732" } }, { value, unit: "" });
  expect(component.unit_native).toBe("mV");
  expect(getSpecRows(component.authoredTolerance)[0]).toContain("mV");
  if (value) expect(component.value_native).toBeCloseTo(2 / Math.sqrt(3), 8);
  else expect(component.pendingReason).toBeTruthy();
});
