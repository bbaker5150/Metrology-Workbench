import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import UncertaintyPanel, { InlineToleranceCell, applyToleranceCaseChange, MeasurementInputNameCell,
  MeasurementInputNominalCell, MeasurementInputSymbolCell, reconcileEquationVariableState, renameEquationVariable, getSpecRows } from "./UncertaintyPanel";
import InlineMenuSelect from "../../../components/common/InlineMenuSelect";
import { getBudgetComponentsFromTolerance } from "../utils/budgetUtils";
import { resolvePointBudgetComponents } from "../../../utils/resolvePointBudgetComponents";
import { claimWorkspaceClipboard, ownsWorkspaceClipboard } from "../../../utils/workspaceClipboard";

vi.mock("plotly.js-dist", () => ({ default: {} }));

it.each(["uut", "tmde"])("disabling %s Bias deletes it and stays disabled after reopening", role => {
  let saved;
  function Harness() {
    const [tolerance, setTolerance] = useState({ floor: { high: 2, low: -2, unit: "V", distribution: "1.732" }, bias: { value: 1, unit: "V" } });
    saved = tolerance;
    return <><button>Outside</button><InlineToleranceCell tolerance={tolerance} activeRange={{ id: "r", unit: "V" }}
      biasRole={role} editable openRequested onCommit={(key, value) => setTolerance(previous => applyToleranceCaseChange(previous, key, value))} /></>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Bias", exact: true }));
  expect(saved.bias).toBeUndefined();
  expect(saved.floor.high).toBe(2);
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(document.querySelector(".inline-tolerance-summary"));
  expect(screen.getByRole("button", { name: "Bias", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(document.querySelector(".instrument-bias-editor")).toBeNull();
});

it("preserves a cleared variable name through reconciliation", () => {
  expect(reconcileEquationVariableState({ variables: ["R"], currentMappings: { R: "" }, rememberedMappings: { R: "Resistance" } }).mappings).toEqual({ R: "" });
  expect(reconcileEquationVariableState({ variables: ["R"], rememberedMappings: { R: "" } }).mappings).toEqual({ R: "" });
});

it("opens all three equation input fields on keyboard focus", () => {
  const change = vi.fn();
  render(<><MeasurementInputSymbolCell symbol="E" onCommit={change} /><MeasurementInputNameCell symbol="E" value="Voltage" onChange={change} />
    <MeasurementInputNominalCell symbol="E" value="20" unit="V" onValueChange={change} /></>);
  fireEvent.focus(screen.getByRole("button", { name: "Rename equation variable E" }));
  expect(screen.getByRole("textbox", { name: "Equation variable E" })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Equation variable E" }), { key: "Enter" });
  fireEvent.focus(screen.getByRole("button", { name: "Edit name for equation variable E" }));
  expect(screen.getByRole("textbox", { name: "Display name for equation variable E" })).toHaveFocus();
  fireEvent.focus(screen.getByRole("button", { name: "Edit nominal for equation variable E" }));
  expect(screen.getByRole("spinbutton", { name: "Nominal value for equation variable E" })).toHaveFocus();
});

it("opening a prefix or percentage selector closes the unit picker", () => {
  render(<><MeasurementInputNominalCell symbol="V" value="10" unit="V" onValueChange={vi.fn()} />
    <InlineMenuSelect ariaLabel="Percentage basis" options={[{ value: "%", label: "% IV" }, { value: "ppm", label: "ppm IV" }]} value="%" onChange={vi.fn()} /></>);
  fireEvent.click(screen.getByRole("button", { name: "Edit nominal for equation variable V" }));
  fireEvent.click(screen.getByRole("button", { name: "Nominal unit for equation variable V base unit" }));
  expect(document.querySelectorAll(".inline-unit-menu")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Percentage basis" }));
  expect(document.querySelectorAll(".inline-unit-menu")).toHaveLength(1);
  expect(screen.getByRole("option", { name: "ppm IV ppm" })).toBeInTheDocument();
});

it("mismatched TMDE limits keep their authored units and remain uncalculable", () => {
  const source = { id: "r", unit: "Ω", floor: { high: 2, low: -2, unit: "Ω", symmetric: true, distribution: "1.732" } };
  const [row] = getBudgetComponentsFromTolerance(source, { value: 10, unit: "A" });
  expect(row.pendingReason).toMatch(/Unit mismatch/);
  expect(row.value_native).toBeNull();
  expect(getSpecRows(row.authoredTolerance)).toEqual(["± 2 Ω"]);
});

it("a TMDE with no unit or limit stays unresolved without borrowing the UUT unit", () => {
  const point = { testPointInfo: { parameter: { value: 10, unit: "A" } }, components: [{ id: "c", tmdeBudgetSourceId: "m", tmdeBudgetRangeId: "r", tmdeBudgetComponentKind: "Accuracy", toleranceLimit_native: 99, unit_native: "A", authoredTolerance: { floor: { high: 99, unit: "A" } } }] };
  const session = { tmdes: [{ id: "m", ranges: [{ id: "r", unit: "" }] }] };
  const [row] = resolvePointBudgetComponents(point, session);
  expect(row.pendingReason).toMatch(/error limit/);
  expect(row.value_native).toBeNull();
  expect(row.unit_native).toBe("");
  expect(row.toleranceLimit_native).toBeNull();
  expect(row.authoredTolerance).toBeNull();
});

it("one clipboard owner replaces every older payload type", () => {
  for (const kind of ["point", "instrument", "range", "budget", "uut"]) {
    claimWorkspaceClipboard(kind);
    for (const other of ["point", "instrument", "range", "budget", "uut"]) expect(ownsWorkspaceClipboard(other)).toBe(other === kind);
  }
});

it("output name is editable while symbol and nominal remain owned by equation and point", () => {
  let saved;
  const initial = { id: "p", measurementType: "derived", equationString: "R*L", variableMappings: { R: "Force", L: "Length" },
    variableNominals: { R: { value: 10, unit: "lbf" }, L: { value: 2, unit: "ft" } },
    testPointInfo: { parameter: { name: "Torque", value: 20, unit: "ft-lbf" } }, components: [] };
  function Harness() {
    const [point, setPoint] = useState(initial); saved = point;
    return <UncertaintyPanel testPointData={point} sessionData={{ id: "s", uuts: [], tmdes: [], testPoints: [point], measurementAreas: [], uncReq: {} }}
      uutNominal={point.testPointInfo.parameter} tmdeTolerancesData={[]} onUpdateTestPoint={patch => setPoint(previous => ({ ...previous, ...patch }))} />;
  }
  render(<Harness />);
  const table = document.querySelector(".measurement-inputs-table");
  expect(table.tBodies[0].rows[0]).toHaveClass("measurement-output-row");
  expect(within(table.tBodies[0].rows[0]).getByText("Torque")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit output variable" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit nominal for equation variable output" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit name for equation variable output" }));
  const name = screen.getByRole("textbox", { name: "Display name for equation variable output" });
  fireEvent.change(name, { target: { value: "Applied torque" } });
  fireEvent.blur(name);
  expect(saved.outputQuantityName).toBe("Applied torque");
  expect(saved.equationString).toBe("R*L");
  expect(saved.testPointInfo.parameter.value).toBe(20);
  expect(Object.keys(saved.variableMappings).sort()).toEqual(["L", "R"]);
  expect(saved.variableNominals).toEqual(initial.variableNominals);
  expect(screen.queryByText(/Name every variable/)).toBeNull();
});

it("renames a Unicode input without rewriting the output or a longer symbol", () => {
  expect(renameEquationVariable("π = π*L + σπ", "π", "ρ")).toBe("π = ρ*L + σπ");
});
