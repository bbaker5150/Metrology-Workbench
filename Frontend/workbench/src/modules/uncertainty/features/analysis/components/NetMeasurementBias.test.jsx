import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { NetBiasCell } from "./NetMeasurementBias";
import { biasFixture } from "../../../utils/measurementBias.fixtures";
import { resolveMeasurementBias } from "../../../utils/measurementBias";
import { computePointRiskMetrics } from "../../../utils/riskCompute";
import { copyPointBudget, pastePointBudget } from "../../../App";
import { InlineToleranceCell, applyToleranceCaseChange } from "./UncertaintyPanel";

it.each([['bias', '0.1 A'], ['percent', '5 %'], ['adjusted', '10.1 A']])("collapses a saved percent to the %s display without changing the authored basis", (mode, expected) => {
  const { point, session } = biasFixture();
  point.measurementBias = { mode: 'manual', kind: 'percent', value: '5', unit: 'A' };
  let saved;
  function Harness() {
    const [current, setCurrent] = useState(point); saved = current;
    return <NetBiasCell point={current} session={session} mode={mode} onChange={patch => setCurrent(p => ({ ...p, ...patch }))} />;
  }
  render(<Harness />);
  const summary = () => screen.getByRole('button', { name: 'Edit net measurement system bias' });
  expect(summary()).toHaveTextContent(expected);
  fireEvent.click(summary());
  const input = screen.getByRole('textbox', { name: 'Net measurement system bias' });
  expect(input).toHaveValue('5');
  fireEvent.change(input, { target: { value: '6' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.queryByRole('textbox', { name: 'Net measurement system bias' })).toBeNull();
  expect(saved.measurementBias).toMatchObject({ kind: 'percent', value: '6' });
  expect(resolveMeasurementBias(saved, session).calBias).toBeCloseTo(.12, 12);
  expect(summary()).toHaveTextContent(mode === 'bias' ? '0.12 A' : mode === 'percent' ? '6 %' : '10.12 A');
  fireEvent.click(summary());
  const invalid = screen.getByRole('textbox', { name: 'Net measurement system bias' });
  fireEvent.change(invalid, { target: { value: 'invalid' } }); fireEvent.blur(invalid);
  expect(invalid).toBeInTheDocument();
  expect(saved.measurementBias.value).toBe('6');
});

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
    return <table><tbody><tr><td><NetBiasCell point={current} session={session} onChange={change} /></td></tr></tbody></table>;
  };
  render(<Harness />);
  expect(screen.queryByRole("button", { name: "Add Net Bias" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Net measurement system bias" })).toBeNull();
  expect(resolveMeasurementBias(saved, session).calBias).toBeCloseTo(originalCal, 12);
  expect(computePointRiskMetrics(saved, session, true)).toEqual(originalRisk);
  fireEvent.click(screen.getByRole("button", { name: "Edit net measurement system bias" }));
  let input = screen.getByRole("textbox", { name: "Net measurement system bias" });
  fireEvent.focus(input); fireEvent.blur(input);
  expect(saved.measurementBias).toEqual({ mode: "sources", sources });
  fireEvent.click(screen.getByRole("button", { name: "Edit net measurement system bias" }));
  input = screen.getByRole("textbox", { name: "Net measurement system bias" });
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
  expect(screen.getByRole("button", { name: "Edit net measurement system bias" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove Net Bias" })).toBeNull();
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
  expect(screen.getByRole("checkbox", { name: "Whichever is greater" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Bias", exact: true }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Whichever is greater" }));
  expect(saved.whicheverIsGreater).toBe(true);
  expect(saved.floor).toEqual(initial.floor);
});
