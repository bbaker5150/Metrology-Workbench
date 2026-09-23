import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BiasDistributionVisualizer, { buildBiasDistributionModel, hasActivePointBias, passProbabilityAtTrueValue } from "./BiasDistributionVisualizer";
import { biasFixture } from "../../../utils/measurementBias.fixtures";

const point = {
  measurementType: "direct",
  testPointInfo: { parameter: { value: 100, unit: "V" } },
  uutBias: { mode: "override", value: 20, kind: "percent" },
  measurementBias: { mode: "manual", value: 1, kind: "absolute", unit: "V" },
  uutTolerance: { floor: { low: -10, high: 10, unit: "V", distribution: "1.732" } },
};
const reference = { value: 100, unit: "V" };
const calculation = { combined_uncertainty_absolute_base: 1.5 };
const risk = { LLow: 90, LUp: 110, ALow: 90, AUp: 110, riskAverage: 102, calBias: 1, uUUT: 2, riskCalSigma: 1.5, uDev: 2.5 };

describe("bias decision distribution", () => {
  it("plots one UUT density with exact measurement, center, tolerance, and axis ticks", () => {
    render(<BiasDistributionVisualizer point={point} session={{}} referencePoint={reference} calcResults={calculation} riskResults={risk} />);
    expect(screen.getByText("90 to 110 V")).toBeInTheDocument();
    expect(screen.getByText("LOWER TOLERANCE 90")).toBeInTheDocument();
    expect(screen.getByText("UPPER TOLERANCE 110")).toBeInTheDocument();
    expect(screen.getByText("Point: 100 V")).toBeInTheDocument();
    expect(screen.getByText("UUT center: 102 V")).toBeInTheDocument();
    expect(screen.getByTestId("bias-density-curve")).toBeInTheDocument();
    expect(document.querySelectorAll(".budget-bias-viz-density-line")).toHaveLength(1);
    expect(screen.getByTestId("bias-accepted-area")).toBeInTheDocument();
    expect(document.querySelectorAll(".budget-bias-viz-tick-label").length).toBeGreaterThan(4);
    expect(Number(screen.getByTestId("bias-mean-line").getAttribute("x1")))
      .toBeGreaterThan(Number(screen.getByTestId("bias-nominal-line").getAttribute("x1")));
  });

  it("keeps bias out of the spread but shifts every possible observed reading", () => {
    const model = buildBiasDistributionModel(point, {}, reference, calculation, risk);
    expect(model.trueMean).toBe(102);
    expect(model.sigma).toBe(2);
    expect(model.trueInterval).toEqual([98, 106]);
    expect(model.observedMean).toBe(103);
    expect(model.observedSpread).toBe(2.5);
    expect(model.observedInterval).toEqual([98, 108]);
    expect(model.effective).toEqual({ lower: 89, upper: 109 });
  });

  it("applies system bias inside the per-value acceptance probability", () => {
    const input = { lower: 90, upper: 110, calBias: 1, calSigma: 0 };
    expect(passProbabilityAtTrueValue(109, input)).toBe(1);
    expect(passProbabilityAtTrueValue(109.1, input)).toBe(0);
    expect(passProbabilityAtTrueValue(89, input)).toBe(1);
    expect(passProbabilityAtTrueValue(88.9, input)).toBe(0);
    expect(passProbabilityAtTrueValue(109, { ...input, calSigma: 1.5 })).toBeCloseTo(.5, 2);
  });

  it("keeps the center at the measurement point with only TMDE bias", () => {
    const sourceOnly = { ...point, uutBias: { mode: "override", value: 0, unit: "V" } };
    const model = buildBiasDistributionModel(sourceOnly, {}, reference, calculation, { ...risk, riskAverage: 100 });
    expect(model.trueMean).toBe(100);
    expect(model.observedMean).toBe(101);
    expect(model.effective).toEqual({ lower: 89, upper: 109 });
  });

  it("derives tolerance before risk is ready without claiming accepted probability", () => {
    const model = buildBiasDistributionModel(point, {}, reference, calculation, null);
    expect(model.limits).toEqual({ lower: 90, upper: 110 });
    expect(model.hasRiskSpread).toBe(false);
    expect(model.passInputs).toBeNull();
  });

  it("hides when no utilized source has an active residual bias", () => {
    const unbiased = { ...point, uutBias: { mode: "override", value: 0, unit: "V" }, measurementBias: { mode: "manual", value: 0, unit: "V" } };
    expect(hasActivePointBias(unbiased, {})).toBe(false);
    const { container } = render(<BiasDistributionVisualizer point={unbiased} session={{}} referencePoint={reference} calcResults={calculation} riskResults={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows utilized TMDE bias and respects a manual zero replacement", () => {
    const { point: derivedPoint, session } = biasFixture();
    expect(hasActivePointBias(derivedPoint, session)).toBe(true);
    expect(hasActivePointBias({ ...derivedPoint, measurementBias: { mode: "manual", value: 0, unit: "A" } }, session)).toBe(false);
  });
});
