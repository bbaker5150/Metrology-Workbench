import { describe, expect, test } from "vitest";
import {
  computeKnownAsymmetricRisk8,
  computeKnownMeasurementRisk8,
  computeKnownTwoSidedRisk8,
  isKnownAsymmetricTolerance,
  isKnownMeasurementTolerance,
  isKnownTwoSidedTolerance,
  toKnownMeasurementSummary,
  validateKnownSingleSidedGeometry,
} from "./knownMeasurementRisk8";

const tolerance = (direction, limit, measurement = "known") => ({
  singleSided: { direction, limit, measurement, unit: "V" },
});

const calculate = (direction, limit) =>
  computeKnownMeasurementRisk8({
    tolerance: tolerance(direction, limit),
    nominal: 10,
    riskAverage: 10,
    expandedUncertaintyNative: 0.25,
    tur: 4,
    assumedReop: 0.95,
    requiredReop: 0.9,
    reqPFA: 0.02,
    initialGB: 1,
    originalInterval: 12,
  });

describe("known-measurement Risk 8.0 app wiring", () => {
  test("recognizes known single-sided tolerances and validates their direction", () => {
    expect(isKnownMeasurementTolerance(tolerance("low", 9))).toBe(true);
    expect(isKnownMeasurementTolerance(tolerance("low", 9, "unknown"))).toBe(false);
    expect(validateKnownSingleSidedGeometry(tolerance("low", 9), 10).ok).toBe(true);
    expect(validateKnownSingleSidedGeometry(tolerance("high", 11), 10).ok).toBe(true);
    expect(validateKnownSingleSidedGeometry(tolerance("high", 9), 10).ok).toBe(false);
  });

  test.each([
    ["low", 9, "GB_LL", "GB_UL"],
    ["high", 11, "GB_UL", "GB_LL"],
  ])("computes workbook Type 3/4 for the %s limit", (direction, limit, active, inactive) => {
    const result = calculate(direction, limit);
    const summary = toKnownMeasurementSummary(result);

    expect(result.computed).toBe(true);
    expect(result.out.statusCore).toBe("OK");
    expect(result.fields[active]).toBeTypeOf("number");
    expect(result.fields[inactive]).toBe("");
    expect(summary.riskMethod).toBe("risk8-single-sided-known");
    expect(summary.tur).toBe(4);
    expect(summary.pfa).toBeCloseTo(0.664977087, 6);
    expect(summary.pfr).toBeCloseTo(1.039397987, 6);
    expect(direction === "low" ? summary.gbHigh : summary.gbLow).toBeUndefined();
    expect(result.diagnostics.core.sc_in).toBeCloseTo(1 / (4 * 1.96), 12);
    expect(result.diagnostics.core.pPFA).toBeCloseTo(result.out.pfa, 12);
    expect(result.diagnostics.core.pPFR).toBeCloseTo(result.out.pfr, 12);
    expect(result.diagnostics.recommended.pPFA).toBeCloseTo(
      result.out.mitPfa,
      12,
    );
  });

  test("reproduces the workbook Type 2 asymmetric 20 V row", () => {
    expect(isKnownAsymmetricTolerance(20, 19, 25)).toBe(true);
    expect(isKnownAsymmetricTolerance(20, 19, 21)).toBe(false);

    const result = computeKnownAsymmetricRisk8({
      nominal: 20,
      riskAverage: 20,
      lowerLimit: 19,
      upperLimit: 25,
      expandedUncertaintyNative: 1.13159879,
      tur: 2.65,
      assumedReop: 0.85,
      requiredReop: 0.85,
      turNeeded: 4,
      reqPFA: 0.02,
      initialGB: 1,
      originalInterval: 12,
      resolution: 0.01,
    });
    const summary = toKnownMeasurementSummary(result);

    expect(result.computed).toBe(true);
    expect(result.out.tolType).toBe(2);
    expect(result.out.statusCore).toBe("OK");
    expect(summary.riskMethod).toBe("risk8-two-sided-asymmetric");
    expect(summary.observedReop).toBeCloseTo(82.7849872, 6);
    expect(summary.pfa).toBeCloseTo(3.42532438, 6);
    expect(summary.pfr).toBeCloseTo(7.69587381, 6);
    expect(summary.gbMult).toBeCloseTo(92.7030237, 6);
    expect(summary.gbPfa).toBeCloseTo(2.00005, 6);
    expect(summary.gbPfr).toBeCloseTo(9.84364898, 6);
  });

  test("reproduces the workbook Type 1 pressure mitigation row", () => {
    expect(isKnownTwoSidedTolerance(25, 24.8, 25.2)).toBe(true);
    const result = computeKnownTwoSidedRisk8({
      nominal: 25,
      riskAverage: 25,
      lowerLimit: 24.8,
      upperLimit: 25.2,
      expandedUncertaintyNative: 0.063257566,
      tur: 0.2 / 0.063257566,
      assumedReop: 0.85,
      requiredReop: 0.85,
      turNeeded: 4,
      reqPFA: 0.02,
      initialGB: 1,
      originalInterval: 12,
      resolution: 0.1,
    });
    const summary = toKnownMeasurementSummary(result);

    expect(result.out.tolType).toBe(1);
    expect(summary.riskMethod).toBe("risk8-two-sided-symmetric");
    expect(summary.observedReop).toBeCloseTo(84.59, 2);
    expect(summary.pfa).toBeCloseTo(2.07, 2);
    expect(summary.pfr).toBeCloseTo(3.18, 2);
    expect(summary.gbMult).toBeCloseTo(99.78, 2);
    expect(summary.gbPfa).toBeCloseTo(2.0, 2);
    expect(summary.gbPfr).toBeCloseTo(3.21, 2);
    expect(summary.gbCalInt).toBeCloseTo(11.5759, 3);
    expect(summary.gbMeasRel).toBeCloseTo(result.out.mitReop * 100, 10);
    expect(summary.noGbPfa).toBeCloseTo(2.0, 2);
    expect(summary.noGbPfr).toBeCloseTo(3.12, 2);
    expect(summary.noGbCalInt).toBeCloseTo(11.2529, 3);
  });
});
