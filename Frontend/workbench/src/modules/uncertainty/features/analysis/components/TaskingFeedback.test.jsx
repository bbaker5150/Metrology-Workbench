import React from "react";
import { render, renderHook, screen, fireEvent, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { normalizeRangeBounds, RangeCell, getUsableBudgetRangeChoices } from "./UncertaintyPanel";
import UncertaintyBudgetTable from "./UncertaintyBudgetTable";
import { resolvePointBudgetComponents } from "../../../utils/resolvePointBudgetComponents";
import { getBudgetComponentsFromTolerance } from "../utils/budgetUtils";
import { computePointRiskMetrics } from "../../../utils/riskCompute";
import { useUncertaintyCalculation } from "../hooks/useUncertaintyCalculation";

vi.mock("plotly.js-dist", () => ({ default: {} }));
const range = (id, high, unit = "V", distribution = "1.732") => ({
  id, min: 0, max: 100, unit,
  tolerances: { floor: { low: -high, high, symmetric: true, unit, distribution } },
});
const master = (ranges) => ({ id: "meter", nickname: "REF", name: "Reference", instrument: { manufacturer: "Acme", model: "123", functions: [{ id: "voltage", name: "Voltage", unit: "V", ranges }] } });
const point = { id: "point", measurementType: "direct", testPointInfo: { parameter: { value: 10, unit: "V" } }, uutTolerance: { floor: { high: 10, low: -10, unit: "V", distribution: "1.732" } } };
const component = { id: "source", type: "B", tmdeBudgetSourceId: "meter", tmdeBudgetRangeId: "one", tmdeBudgetComponentKind: "Accuracy", isBudgetInstance: true, name: "Reference - Accuracy" };

it.each([["100", ""], ["", "100"], ["100", "100"], ["0", ""]])("infers a single point from bounds %s / %s", (min, max) => {
  const result = normalizeRangeBounds(min, max);
  expect(result).toEqual({ min: min || max, max: min || max, value: min || max, isSingleValue: true });
});

it("lets a selected single-range row add or delete without entering its inputs", () => {
  const add = vi.fn(), remove = vi.fn();
  render(<RangeCell editable actionsVisible activeRange={range("one", 1)} onAddRange={add} onClearRange={remove} />);
  expect(screen.queryByPlaceholderText("min")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add range" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete range" }));
  expect(add).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce();
});

it("keeps an unset-distribution TMDE selectable and suppresses uncertainty and risk until fixed", () => {
  const instrument = master([range("one", 1, "V", "not-set")]);
  const session = { tmdes: [instrument], uncReq: { uncertaintyConfidence: 95 } };
  const testPoint = { ...point, components: [component] };
  expect(getUsableBudgetRangeChoices(instrument, point.testPointInfo.parameter)).toHaveLength(1);
  const sources = resolvePointBudgetComponents(testPoint, session);
  expect(sources[0].pendingReason).toMatch(/distribution/i);
  expect(sources[0].value_native).toBeNull();
  expect(computePointRiskMetrics(testPoint, session)).toBeNull();
  const save = vi.fn(), tmdes = [];
  const { result } = renderHook(() => useUncertaintyCalculation(testPoint, session, tmdes, point.uutTolerance, point.testPointInfo.parameter, sources, save));
  const final = result.current.calcResults.calculatedBudgetGroups.at(-1);
  expect(final.results.combined).toBeNull(); expect(final.results.expanded).toBeNull();
  session.tmdes = [master([range("one", 1)])];
  expect(resolvePointBudgetComponents(testPoint, session)[0].value_native).toBeGreaterThan(0);
});

it("permits incompatible units but leaves totals undefined, while converting compatible units", () => {
  const bad = { id: "amps", type: "B", value: 1, value_native: 1, unit_native: "A", isBaseUnitValue: true };
  const testPoint = { ...point, components: [bad] };
  const session = { tmdes: [], uncReq: { uncertaintyConfidence: 95 } };
  const resolved = resolvePointBudgetComponents(testPoint, session);
  expect(resolved[0].pendingReason).toMatch(/Unit mismatch/);
  expect(computePointRiskMetrics(testPoint, session)).toBeNull();
  expect(testPoint.components[0]).toBe(bad);
  const converted = getBudgetComponentsFromTolerance(range("milli", 1000, "mV"), point.testPointInfo.parameter)[0];
  expect(converted.pendingReason).toBeFalsy();
  expect(converted.value_native).toBeCloseTo(1 / Math.sqrt(3));
});

it("swaps a linked range without changing component identity or touching the other budget entries", () => {
  const session = { tmdes: [master([range("one", 1), range("two", 2)])] };
  const testPoint = { ...point, components: [component] };
  const before = resolvePointBudgetComponents(testPoint, session)[0];
  const after = resolvePointBudgetComponents({ ...testPoint, components: [{ ...component, tmdeBudgetRangeId: "two" }] }, session)[0];
  expect(after.id).toBe(before.id); expect(after.value_native).toBeCloseTo(before.value_native * 2);
  expect(component.tmdeBudgetRangeId).toBe("one");
});

it("shows a range selector and final PFA/PFR, including unavailable PFR for unknown measurements", () => {
  const onUpdate = vi.fn();
  render(<UncertaintyBudgetTable components={[{ ...component, value_native: 1, unit_native: "V" }]} budgetInstruments={[master([range("one", 1), range("two", 2)])]}
    referencePoint={point.testPointInfo.parameter} onComponentUpdate={onUpdate} riskResults={{ riskMethod: "risk8-pfa-boundary", pfa: 1.5 }} />);
  fireEvent.click(screen.getByRole("button", { name: /Range for/ }));
  fireEvent.click(within(screen.getByRole("listbox", { name: /Range for/ })).getAllByRole("option")[1]);
  expect(onUpdate.mock.calls[0][1].selectedBudgetRange.id).toBe("two");
  expect(screen.getByLabelText("Final decision risk")).toHaveTextContent("PFA at Boundary1.500 %");
  expect(screen.getByLabelText("PFR: Unavailable")).toHaveTextContent("—");
});
