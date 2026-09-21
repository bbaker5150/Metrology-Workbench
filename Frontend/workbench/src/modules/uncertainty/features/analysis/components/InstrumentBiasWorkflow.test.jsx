import React, { useMemo, useState } from "react";
import { fireEvent, render, screen, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import LegacyPointBiasNotice from "./LegacyPointBiasNotice";
import { InlineToleranceCell, applyToleranceCaseChange } from "./UncertaintyPanel";
import { biasFixture } from "../../../utils/measurementBias.fixtures";
import { computePointRiskMetrics } from "../../../utils/riskCompute";
import { resolvePointBudgetComponents } from "../../../utils/resolvePointBudgetComponents";
import { useUncertaintyCalculation } from "../hooks/useUncertaintyCalculation";
import { useRiskCalculation } from "../hooks/useRiskCalculation";
import { resolveMeasurementBias } from "../../../utils/measurementBias";

const enter = (label, value) => {
  const input = screen.getByRole("textbox", { name: label, exact: true });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

it("shows no additional bias UI for populated instrument biases or zero/corrected defaults", () => {
  const { point, session } = biasFixture();
  const { container, rerender } = render(<LegacyPointBiasNotice point={point} session={session} onChange={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
  const changed = { ...point, uutTolerance: { bias: { value: "0", unit: "A" } }, measurementBias: { mode: "sources", sources: { stale: null } } };
  session.tmdes[0].instrument.functions[0].ranges[0].tolerances.bias.corrected = true;
  rerender(<LegacyPointBiasNotice point={changed} session={session} onChange={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
});

it.each([
  { uutBias: { mode: "override", value: "0", unit: "A" } },
  { measurementBias: { mode: "manual", value: ".5", unit: "A" } },
  { measurementBias: { sources: { "tmde:voltage::voltage-range:Voltage": { value: ".02", unit: "V" } } } },
])("preserves a saved override until explicit reset to instrument biases: %j", overrides => {
  const fixture = biasFixture();
  const initial = { ...fixture.point, ...overrides };
  const initialRisk = computePointRiskMetrics(initial, fixture.session, true);
  const instrumentSnapshot = JSON.stringify(fixture.session);
  let saved;
  const Harness = () => {
    const [point, setPoint] = useState(initial);
    saved = point;
    return <LegacyPointBiasNotice point={point} session={fixture.session} onChange={patch => setPoint(previous => ({ ...previous, ...patch }))} />;
  };
  const { container } = render(<Harness />);
  expect(screen.getByRole("status")).toHaveTextContent("Saved point bias overrides are active");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(computePointRiskMetrics(saved, fixture.session, true)).toEqual(initialRisk);
  fireEvent.click(screen.getByRole("button", { name: "Use instrument biases" }));
  expect(container).toBeEmptyDOMElement();
  expect(saved).toEqual({ ...fixture.point, uutBias: null, measurementBias: null });
  const reloaded = JSON.parse(JSON.stringify(saved));
  expect(resolveMeasurementBias(reloaded, fixture.session).calBias).toBeCloseTo(-.1);
  expect(computePointRiskMetrics(reloaded, fixture.session, true)).toEqual(computePointRiskMetrics(fixture.point, fixture.session, true));
  expect(JSON.stringify(fixture.session)).toBe(instrumentSnapshot);
});

it("stores a range default without changing its tolerance or distribution", () => {
  const initial = { floor: { high: 1, low: -1, unit: "V", distribution: "1.732" } };
  let saved;
  const Harness = () => {
    const [tolerance, setTolerance] = useState(initial);
    saved = tolerance;
    return <InlineToleranceCell tolerance={tolerance} activeRange={{ id: "r", unit: "V" }} biasRole="uut" editable openRequested
      onCommit={(type, value) => setTolerance(previous => applyToleranceCaseChange(previous, type, value))} />;
  };
  render(<Harness />);
  expect(screen.queryByRole("textbox", { name: "Range UUT bias" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Bias", exact: true }));
  enter("Range UUT bias", "-.25");
  expect(saved).toEqual({ ...initial, bias: { value: "-.25", unit: "V", corrected: false } });
  fireEvent.click(screen.getByRole("button", { name: "Bias", exact: true }));
  expect(screen.queryByRole("textbox", { name: "Range UUT bias" })).toBeNull();
  expect(screen.getByRole("button", { name: "Bias", exact: true })).toHaveAttribute("aria-pressed", "false");
});

it("keeps the open risk panel and sidebar identical as biases change", async () => {
  const { point, session } = biasFixture();
  const save = vi.fn();
  const { result, rerender } = renderHook(({ current }) => {
    const sources = useMemo(() => resolvePointBudgetComponents(current, session), [current]);
    const { calcResults } = useUncertaintyCalculation(current, session, current.tmdeTolerances, current.uutTolerance, current.testPointInfo.parameter, sources, save);
    return useRiskCalculation(session, current, current.uutTolerance, current.tmdeTolerances, current.testPointInfo.parameter, calcResults, "riskmitigation");
  }, { initialProps: { current: point } });
  const check = async current => {
    const sidebar = computePointRiskMetrics(current, session, true);
    await waitFor(() => expect(result.current.riskResults?.pfa).toBeCloseTo(sidebar.pfa, 8));
    for (const key of ["pfr", "gbLow", "gbHigh", "gbPfa", "gbPfr", "noGbPfa", "noGbPfr"]) {
      if (sidebar[key] !== undefined) expect(result.current.riskResults[key], key).toBeCloseTo(sidebar[key], 8);
    }
  };
  await check(point);
  // h=2 A: 7.5% UUT => .15 A and 10% cal => .2 A in BOTH entry points.
  const changed = { ...point, uutBias: { mode: "override", value: 7.5, kind: "percent", unit: "A" }, measurementBias: { mode: "manual", value: 10, kind: "percent", unit: "A" } };
  rerender({ current: changed });
  await check(changed);
  expect(result.current.riskResults.risk8.meta.xcal).toBeCloseTo(.1);
});

it("clears risk without a modal while a biased equation input is being edited", async () => {
  const { point, session } = biasFixture();
  const save = vi.fn();
  const { result, rerender } = renderHook(({ current }) => {
    const sources = useMemo(() => resolvePointBudgetComponents(current, session), [current]);
    const { calcResults } = useUncertaintyCalculation(current, session, current.tmdeTolerances, current.uutTolerance, current.testPointInfo.parameter, sources, save);
    return useRiskCalculation(session, current, current.uutTolerance, current.tmdeTolerances, current.testPointInfo.parameter, calcResults, "riskmitigation");
  }, { initialProps: { current: point } });
  await waitFor(() => expect(result.current.riskResults?.pfa).toBeTypeOf("number"));
  const symbol = Object.keys(point.variableMappings)[0];
  const incomplete = { ...point, variableMappings: { ...point.variableMappings, [symbol]: "" } };
  const pending = resolveMeasurementBias(incomplete, session);
  expect(pending.missingInputs).toBe(true);
  expect(pending.error).toContain(symbol);
  expect(pending.calBias).toBeNaN();
  rerender({ current: incomplete });
  await waitFor(() => expect(result.current.riskResults).toBeNull());
  expect(result.current.notification).toBeNull();
  rerender({ current: point });
  await waitFor(() => expect(result.current.riskResults?.pfa).toBeCloseTo(computePointRiskMetrics(point, session, true).pfa, 8));
  expect(result.current.notification).toBeNull();
});

it.each(["known", "unknown"])("keeps biased %s single-sided panel, sidebar, and breakdown inputs aligned", async measurement => {
  const { point, session } = biasFixture();
  point.uutTolerance = { singleSided: { direction: "high", measurement, limit: 12, unit: "A" } };
  point.uutBias = { mode: "override", value: .2, unit: "A" };
  point.measurementBias = { mode: "manual", value: .1, unit: "A" };
  const sources = resolvePointBudgetComponents(point, session);
  const save = vi.fn();
  const { result } = renderHook(() => {
    const { calcResults } = useUncertaintyCalculation(point, session, point.tmdeTolerances, point.uutTolerance, point.testPointInfo.parameter, sources, save);
    return useRiskCalculation(session, point, point.uutTolerance, point.tmdeTolerances, point.testPointInfo.parameter, calcResults, "riskmitigation");
  });
  const sidebar = computePointRiskMetrics(point, session, true);
  await waitFor(() => expect(result.current.riskResults?.pfa).toBeCloseTo(sidebar.pfa, 8));
  expect(result.current.riskResults.gbHigh).toBeCloseTo(sidebar.gbHigh, 8);
  if (measurement === "known") {
    expect(result.current.riskResults.tur).toBeCloseTo(sidebar.tur, 8);
    expect(result.current.riskResults.measurementAverage).toBeCloseTo(10);
    expect(result.current.riskResults.riskAverage).toBeCloseTo(10.2);
  } else expect(result.current.riskResults.risk8.calBias).toBe(0);
});


it.each([0, -100])("keeps numeric nominal %s valid for workbook-normalized percentages in the open panel", async nominal => {
  const point = { id: "p", measurementType: "direct", testPointInfo: { parameter: { value: nominal, unit: "V" } },
    uutTolerance: { floor: { low: -10, high: 10, unit: "V" } },
    uutBias: { mode: "override", value: 50, kind: "percent" },
    measurementBias: { mode: "manual", value: 20, kind: "percent" },
    components: [{ id: "c", name: "Reference", type: "B", value: 1, value_native: 1, unit_native: "V", distribution: "1" }] };
  const { session } = biasFixture();
  const save = vi.fn();
  const emptySources = [];
  const { result } = renderHook(() => {
    const { calcResults } = useUncertaintyCalculation(point, session, emptySources, point.uutTolerance, point.testPointInfo.parameter, point.components, save);
    return useRiskCalculation(session, point, point.uutTolerance, emptySources, point.testPointInfo.parameter, calcResults, "riskmitigation");
  });
  const sidebar = computePointRiskMetrics(point, session, true);
  expect(sidebar).not.toBeNull();
  await waitFor(() => expect(result.current.riskResults?.pfa).toBeCloseTo(sidebar.pfa, 8));
  expect(result.current.riskResults.risk8.meta.mu).toBeCloseTo(.5);
  expect(result.current.riskResults.risk8.meta.xcal).toBeCloseTo(.2);
});
