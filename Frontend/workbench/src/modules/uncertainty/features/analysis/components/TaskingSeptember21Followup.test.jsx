import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import UncertaintyPanel, { InlineDistributionCell } from "./UncertaintyPanel";
import PointRequirementCell from "../../../components/common/PointRequirementCell";
import { RISK_INPUT_FIELDS } from "../../../constants/constants";
import { getAbsoluteLimits, unitSystem } from "../../../utils/uncertaintyMath";
import { toleranceUnitMismatch } from "../../../utils/incompleteBudget";
import { computeUncertaintyForPoint, computePointRiskMetrics } from "../../../utils/riskCompute";
import { biasFixture } from "../../../utils/measurementBias.fixtures";
import BuilderUnitSelect from "../../instruments/components/BuilderUnitSelect";
vi.mock("plotly.js-dist", () => ({ default: {} }));

it("builder units browse/search bases while reading and editing saved SI prefixes separately", () => {
  let saved;
  const options = [{ label: "Voltage", options: ["V", "mV", "uV"].map(value => ({ value, label: value })) }];
  function Harness() {
    const [value, setValue] = useState("mV"); saved = value;
    return <BuilderUnitSelect value={value} onChange={setValue} options={options} ariaLabel="Voltage unit" />;
  }
  render(<Harness />);
  expect(screen.getByRole("button", { name: "Voltage unit base unit" })).toHaveTextContent("V");
  expect(screen.getByRole("button", { name: "Voltage unit prefix" })).toHaveTextContent("m");
  fireEvent.click(screen.getByRole("button", { name: "Voltage unit base unit" }));
  fireEvent.change(screen.getByPlaceholderText("Search units..."), { target: { value: "volt" } });
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("option")).toHaveTextContent("VVoltage");
  fireEvent.click(screen.getByRole("option"));
  expect(saved).toBe("V");
  fireEvent.click(screen.getByRole("button", { name: "Voltage unit prefix" }));
  fireEvent.click(screen.getByRole("option", { name: /^Micro / }));
  expect(saved).toBe("uV");
});

it("forgets a name after a committed variable deletion, including across re-addition", () => {
  let saved;
  function Harness() {
    const [point, setPoint] = useState({ id: "p", measurementType: "derived", equationString: "E", variableMappings: { E: "test" },
      variableNominals: { E: { value: 5, unit: "V" } }, testPointInfo: { parameter: { value: 5, unit: "V" } }, components: [] });
    saved = point;
    return <UncertaintyPanel testPointData={point} sessionData={{ id: "s", uuts: [], tmdes: [], testPoints: [point] }}
      uutNominal={point.testPointInfo.parameter} tmdeTolerancesData={[]} onUpdateTestPoint={patch => setPoint(previous => ({ ...previous, ...patch }))} />;
  }
  render(<Harness />);
  const commitEquation = value => {
    fireEvent.click(screen.getByRole("button", { name: "Edit measurement equation" }));
    const input = screen.getByLabelText("Measurement equation");
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });
  };
  commitEquation("1");
  expect(saved.variableMappings).toEqual({});
  commitEquation("E");
  expect(saved.variableMappings).toEqual({ E: "" });
});

it("immediately names the selected distribution while its editor retains focus", async () => {
  function Harness() {
    const [value, setValue] = useState("1.732");
    return <InlineDistributionCell divisor={value} onChange={setValue} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Rectangular" }));
  fireEvent.click(screen.getByRole("button", { name: "Spec band distribution" }));
  fireEvent.click(await screen.findByRole("option", { name: /Normal \(Std\. Unc\.\)/ }));
  expect(screen.getByRole("button", { name: "Spec band distribution" })).toHaveTextContent("Normal (Std. Unc.)");
  expect(screen.getByRole("button", { name: "Spec band distribution" })).not.toHaveTextContent("k =");
});

it("distinguishes inherited requirements from saved overrides and restores inheritance when cleared", () => {
  let saved;
  function Harness() {
    const [point, setPoint] = useState({}); saved = point;
    return <PointRequirementCell point={point} session={{ uncReq: { uncertaintyConfidence: 95 } }}
      field={RISK_INPUT_FIELDS[0]} onSave={setPoint} />;
  }
  render(<Harness />);
  const cell = () => document.querySelector(".point-requirement-cell");
  expect(cell()).toHaveClass("is-inherited");
  fireEvent.click(screen.getByRole("button", { name: "Edit Confidence Level" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "99" } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(saved.riskRequirements.uncertaintyConfidence).toBe("99");
  expect(cell()).toHaveClass("is-override");
  fireEvent.click(screen.getByRole("button", { name: "Edit Confidence Level" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(saved.riskRequirements).toEqual({});
  expect(cell()).toHaveClass("is-inherited");
  expect(cell()).toHaveTextContent("95");
});

it.each(["unit", "functionUnit"])("rejects a mismatched %s before evaluating relative limits, uncertainty or risk", key => {
  const { point, session } = biasFixture();
  point.uutTolerance = { [key]: "V", reading: { high: 1, low: -1, unit: "%", distribution: "1.732" } };
  expect(toleranceUnitMismatch(point.uutTolerance, "A", unitSystem)).toMatch(/Unit mismatch/);
  expect(getAbsoluteLimits(point.uutTolerance, point.testPointInfo.parameter)).toMatchObject({ high: "N/A", low: "N/A", reason: expect.stringMatching(/Unit mismatch/) });
  expect(computeUncertaintyForPoint(point, session)).toBeNull();
  expect(computePointRiskMetrics(point, session, true)).toBeNull();
});
