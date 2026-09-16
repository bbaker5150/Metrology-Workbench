import React, { useMemo, useState } from "react";
import { fireEvent, render, screen, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import MeasurementBiasEditor from "./MeasurementBiasEditor";
import { InlineToleranceCell, applyToleranceCaseChange } from "./UncertaintyPanel";
import { biasFixture } from "../../../utils/measurementBias.fixtures";
import { computePointRiskMetrics } from "../../../utils/riskCompute";
import { resolvePointBudgetComponents } from "../../../utils/resolvePointBudgetComponents";
import { useUncertaintyCalculation } from "../hooks/useUncertaintyCalculation";
import { useRiskCalculation } from "../hooks/useRiskCalculation";

const choose = (label, option) => {
  fireEvent.click(screen.getByRole("button", { name: label, exact: true }));
  fireEvent.click(screen.getByRole("option", { name: option, exact: true }));
};
const enter = (label, value) => {
  const input = screen.getByRole("textbox", { name: label, exact: true });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

it("edits source overrides, corrections, manual mode and a separate UUT override inline", () => {
  const fixture = biasFixture();
  let saved;
  const Harness = () => {
    const [point, setPoint] = useState(fixture.point);
    saved = point;
    return <MeasurementBiasEditor point={point} session={fixture.session} onChange={patch => setPoint(previous => ({ ...previous, ...patch }))} />;
  };
  const { container } = render(<Harness />);
  const details = container.querySelector("details");
  expect(details.open).toBe(false);
  fireEvent.click(screen.getByText("Bias settings"));
  enter("Bias for voltage", ".02");
  expect(Object.values(saved.measurementBias.sources)[0].value).toBe(".02");
  fireEvent.click(screen.getAllByRole("checkbox", { name: "Already corrected" })[0]);
  expect(Object.values(saved.measurementBias.sources)[0].corrected).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Use source default" }));
  expect(saved.measurementBias.sources).toEqual({});
  choose("Measurement system bias source", "Enter net bias");
  enter("Net measurement system bias", "-.5");
  expect(saved.measurementBias.value).toBe("-.5");
  choose("UUT bias source", "This point");
  enter("Point UUT bias", "0");
  expect(saved.uutBias).toMatchObject({ mode: "override", value: "0" });
  choose("UUT bias source", "Use UUT range");
  expect(saved.uutBias).toBeUndefined();
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
  enter("Range UUT bias", "-.25");
  expect(saved).toEqual({ ...initial, bias: { value: "-.25", unit: "V" } });
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
  const changed = { ...point, uutBias: { mode: "override", value: .15, unit: "A" }, measurementBias: { mode: "manual", value: .2, unit: "A" } };
  rerender({ current: changed });
  await check(changed);
  expect(result.current.riskResults.risk8.meta.xcal).not.toBe(0);
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
  } else expect(result.current.riskResults.risk8.calBias).toBe(.1);
});
