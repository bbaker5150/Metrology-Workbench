import React, { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import UncertaintyPanel, { RangeCell, MeasurementInputNominalCell, instrumentWithSelectedRanges, pasteInstrumentIntoSession, getUsableBudgetRangeChoices } from "./UncertaintyPanel";
import InlineMenuSelect from "../../../components/common/InlineMenuSelect";
import { getBudgetComponentsFromTolerance } from "../utils/budgetUtils";
import { nextInstrumentCellSelection, updateInstrumentCellHighlights } from "../../../utils/instrumentCellSelection";
import { pointDisplayResolution } from "../../../utils/pointLimitDisplay";
vi.mock("plotly.js-dist", () => ({ default: {} }));

it("opens a single-point range with one value and keeps a cleared range", () => {
  const patch = vi.fn(), remove = vi.fn();
  render(<RangeCell editable activeRange={{ id: "r", min: 100, max: 100, isSingleValue: true, value: 100, unit: "V" }} onPatchRange={patch} onClearRange={remove} />);
  fireEvent.click(screen.getByTitle("Edit range"));
  expect(screen.getByPlaceholderText("min")).toHaveValue("100");
  expect(screen.getByPlaceholderText("max")).toHaveValue("");
  fireEvent.change(screen.getByPlaceholderText("min"), { target: { value: "" } });
  fireEvent.blur(screen.getByPlaceholderText("min"));
  expect(patch).toHaveBeenCalledWith({ min: "", max: "", value: "", isSingleValue: false });
  expect(remove).not.toHaveBeenCalled();
});
it("lets a nominal be entered before a variable name", () => {
  const update = vi.fn();
  render(<MeasurementInputNominalCell symbol="x" onValueChange={update} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit nominal for equation variable x" }));
  const input = screen.getByLabelText("Nominal value for equation variable x");
  expect(input).toBeEnabled();
  fireEvent.change(input, { target: { value: "3000" } });
  expect(update).toHaveBeenCalledWith("3000");
});
it("keeps variable mappings committed until the equation loses focus", () => {
  const update = vi.fn();
  const point = { id: "p", measurementType: "derived", equationString: "a*b", variableMappings: { a: "Length", b: "Width" }, variableNominals: { a: { value: 2, unit: "m" }, b: { value: 3, unit: "m" } }, testPointInfo: { parameter: { name: "Area", value: 6, unit: "m²" } }, components: [] };
  function Harness() {
    const [value, setValue] = useState(point);
    return <><button>Outside equation</button><UncertaintyPanel testPointData={value} sessionData={{ id: "s", uuts: [], tmdes: [], testPoints: [value], measurementAreas: [], uncReq: {} }} uutNominal={value.testPointInfo.parameter} tmdeTolerancesData={[]}
      onUpdateTestPoint={patch => { update(patch); setValue(previous => ({ ...previous, ...patch })); }} calcResults={{ combined_uncertainty: 0, expanded_uncertainty: 0, k_value: 2, effective_dof: Infinity }} /></>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Edit measurement equation" }));
  const input = screen.getByLabelText("Measurement equation");
  fireEvent.change(input, { target: { value: "a+" } });
  expect(update).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Edit nominal for equation variable b" })).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "a+b+c" } });
  expect(update).not.toHaveBeenCalled();
  fireEvent.blur(input, { relatedTarget: screen.getByText("Outside equation") });
  expect(update.mock.calls.at(-1)[0]).toMatchObject({ equationString: "a+b+c", variableMappings: { a: "Length", b: "Width", c: "" } });
});
it("offers an authored TMDE before a nominal unit has been assigned", () => {
  const range = { id: "r", min: 0, max: 10, unit: "V", tolerances: { floor: { high: 1, low: -1, unit: "V", distribution: "1.732" } } };
  expect(getUsableBudgetRangeChoices({ instrument: { functions: [{ unit: "V", ranges: [range] }] } }, { value: 5, unit: "" })).toHaveLength(1);
  // September 18 permits a unitless numeric frame, so a populated source no
  // longer stays pending merely because the point's unit label is blank.
  const component = getBudgetComponentsFromTolerance(range, { value: 5, unit: "" })[0];
  expect(component.pendingReason).toBeFalsy();
  expect(component.value_native).toBeCloseTo(1 / Math.sqrt(3), 12);
});
it("moves a distribution highlight without selecting until Enter", async () => {
  const change = vi.fn();
  render(<InlineMenuSelect ariaLabel="Distribution" value="a" options={[{ value: "a", label: "Normal" }, { value: "b", label: "Rectangular" }]} onChange={change} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Distribution" }), { key: "ArrowDown" });
  await waitFor(() => expect(screen.getByRole("option", { name: "Normal a" })).toHaveFocus());
  fireEvent.keyDown(document.activeElement, { key: "ArrowDown" });
  expect(screen.getByRole("option", { name: "Rectangular b" })).toHaveFocus();
  expect(change).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement, { key: "Enter" });
  expect(change).toHaveBeenCalledWith("b");
  expect(screen.getByRole("button", { name: "Distribution" })).toHaveFocus();
});
const rows = [0,1,2,3].map(n => ({ key: "tmde:t", rangeId: String(n) }));
it("selects shared rows and promotes ranges when another column is added", () => {
  const first = nextInstrumentCellSelection({ rows, clickedIndex: 1, rangeTarget: true });
  expect(first).toMatchObject({ ranges: { "tmde:t": ["1"] }, mode: "range" });
  const next = nextInstrumentCellSelection({ rows, clickedIndex: 3, rangeTarget: false, additive: true, previous: first.ranges, previousMode: first.mode });
  expect(next).toMatchObject({ ranges: { "tmde:t": ["1", "3"] }, mode: "instrument" });
  expect(nextInstrumentCellSelection({ rows, clickedIndex: 0, span: 2, rangeTarget: false }).ranges).toEqual({ "tmde:t": ["0", "1"] });
  expect(nextInstrumentCellSelection({ rows, clickedIndex: 3, anchor: 1, shift: true, rangeTarget: true, previousMode: "range" }).ranges).toEqual({ "tmde:t": ["1", "2", "3"] });
});
it("copies only selected physical rows and their custom values", () => {
  const item = { id: "t", name: "Reference", measurementAreaNames: ["Voltage"], instrument: { functions: [{ name: "Voltage", unit: "V", ranges: rows.map((row,i) => ({ id: row.rangeId, min: i, max: i, unit: "V" })) }] }, rangeCustomFields: { 0: { note: "Combined" }, 1: { note: "Combined" }, 2: { note: "Lone1" }, 3: { note: "Lone2" } } };
  const copy = instrumentWithSelectedRanges(item, ["1", "3"]);
  const pasted = pasteInstrumentIntoSession({ tmdes: [item], uuts: [], measurementAreas: [] }, { mode: "copy", items: [{ kind: "tmde", item: copy }] }, "tmde").row;
  expect(pasted.instrument.functions[0].ranges.map(range => range.id)).toEqual(["1", "3"]);
  expect(pasted.rangeCustomFields).toEqual({ 1: { note: "Combined" }, 3: { note: "Lone2" } });
  expect(item.instrument.functions[0].ranges).toHaveLength(4);
});
it("highlights only shared cells overlapping a selected or hovered row", () => {
  const table = document.createElement("table");
  table.dataset.selectionMode = "range";
  table.innerHTML = '<tbody><tr data-selection-key="t" data-range-id="0"><td rowspan="3" class="cell-description">Instrument</td><td>0</td><td rowspan="2">Combined</td></tr><tr data-selection-key="t" data-range-id="1"><td>1</td></tr><tr data-selection-key="t" data-range-id="2" data-range-selected="true"><td>2</td><td>Lone</td></tr></tbody>';
  updateInstrumentCellHighlights(table, table.rows[2]);
  expect(table.rows[0].cells[2].hasAttribute("data-cell-hovered")).toBe(false);
  expect(table.rows[0].cells[2].hasAttribute("data-cell-selected")).toBe(false);
  expect(table.rows[0].cells[0].hasAttribute("data-cell-selected")).toBe(false);
  expect(table.rows[2].cells[1].hasAttribute("data-cell-selected")).toBe(true);
});
it("ignores instrument resolutions absent from the budget", () => {
  const master = { id: "t", instrument: { functions: [{ unit: "V", ranges: [{ id: "small", min: 0, max: 1, resolution: .00001 }, { id: "large", min: 1, max: 10, resolution: .01 }] }] } };
  const point = { testPointInfo: { parameter: { value: 5, unit: "V" } }, uutTolerance: { resolution: .1, unit: "V" }, tmdeTolerances: [{ sourceId: "t", tolerance: { rangeId: "large", resolution: .0001, unit: "V" } }] };
  expect(pointDisplayResolution(point, { tmdes: [master] })).toBe(0);
  expect(pointDisplayResolution({ ...point, tmdeTolerances: [], components: [{ tmdeBudgetSourceId: "t" }] }, { tmdes: [master] })).toBe(0);
});
