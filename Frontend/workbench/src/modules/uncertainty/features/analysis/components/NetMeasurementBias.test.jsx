import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AddNetBiasButton, NetBiasRow } from "./NetMeasurementBias";
import { biasFixture } from "../../../utils/measurementBias.fixtures";
import { resolveMeasurementBias } from "../../../utils/measurementBias";
import { computePointRiskMetrics } from "../../../utils/riskCompute";
import { copyPointBudget, pastePointBudget } from "../../../App";
import { InlineToleranceCell, applyToleranceCaseChange } from "./UncertaintyPanel";

it("adds one net output bias, replaces source contributions, and restores them on removal", () => {
  const { point, session } = biasFixture();
  const sources = { "tmde:voltage::voltage-range:Voltage": { value: .02, unit: "V" } };
  point.measurementBias = { mode: "sources", sources };
  point.uutBias = { mode: "override", value: .3, unit: "A" };
  const originalRisk = computePointRiskMetrics(point, session, true);
  const originalCal = resolveMeasurementBias(point, session).calBias;
  let saved;
  const Harness = () => {
    const [current, setCurrent] = useState(point);
    saved = current;
    const change = patch => setCurrent(previous => ({ ...previous, ...patch }));
    return <><AddNetBiasButton point={current} session={session} onChange={change} />
      <table><tbody><NetBiasRow point={current} onChange={change} /></tbody></table></>;
  };
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Add Net Bias" }));
  expect(screen.queryByRole("button", { name: "Add Net Bias" })).toBeNull();
  expect(screen.getAllByText("Net Bias")).toHaveLength(1);
  expect(resolveMeasurementBias(saved, session).calBias).toBeCloseTo(originalCal, 12);
  expect(computePointRiskMetrics(saved, session, true)).toEqual(originalRisk);
  const input = screen.getByRole("textbox", { name: "Net measurement system bias" });
  fireEvent.change(input, { target: { value: "-.5" } });
  fireEvent.blur(input);
  const bias = resolveMeasurementBias(saved, session);
  expect(bias.calBias).toBe(-.5);
  expect(bias.uutBias).toBe(.3);
  expect(saved.components).toBe(point.components);
  expect(saved.equationString).toBe(point.equationString);
  expect(computePointRiskMetrics(saved, session, true).tur).toBe(originalRisk.tur);
  const copied = pastePointBudget({ ...point, id: "target" }, copyPointBudget(saved));
  expect(resolveMeasurementBias(JSON.parse(JSON.stringify(copied)), session).calBias).toBe(-.5);
  fireEvent.click(screen.getByRole("button", { name: "Remove Net Bias" }));
  expect(saved.measurementBias).toEqual({ mode: "sources", sources });
  expect(computePointRiskMetrics(saved, session, true)).toEqual(originalRisk);
  expect(screen.getByRole("button", { name: "Add Net Bias" })).toBeInTheDocument();
});

it("keeps old corrected TMDE biases inert until edited, without exposing a correction checkbox", () => {
  const initial = { floor: { high: 1, low: -1, unit: "V", distribution: "1.732" }, bias: { value: ".2", unit: "V", corrected: true } };
  let saved;
  const Harness = () => {
    const [tolerance, setTolerance] = useState(initial);
    saved = tolerance;
    return <InlineToleranceCell tolerance={tolerance} activeRange={{ id: "r", unit: "V" }} biasRole="tmde" editable openRequested
      onCommit={(type, value) => setTolerance(previous => applyToleranceCaseChange(previous, type, value))} />;
  };
  render(<Harness />);
  expect(screen.getByRole("button", { name: "Bias", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(saved.bias.corrected).toBe(true);
  expect(screen.queryByRole("checkbox", { name: "Already corrected" })).toBeNull();
  expect(screen.getByText(/Saved as corrected/)).toBeInTheDocument();
  const input = screen.getByRole("textbox", { name: "Range source bias" });
  fireEvent.change(input, { target: { value: ".3" } });
  fireEvent.blur(input);
  expect(saved).toEqual({ ...initial, bias: { value: ".3", unit: "V", corrected: false } });
  expect(screen.queryByRole("checkbox", { name: "Whichever is greater" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Bias", exact: true }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Whichever is greater" }));
  expect(saved.whicheverIsGreater).toBe(true);
  expect(saved.floor).toEqual(initial.floor);
});
