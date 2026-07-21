/**
 * riskAdapter8.test.js — Phase 5 tests for the app-data adapter: tolerance-frame
 * normalization, the AVERAGE->mu mapping, field mapping to the 8.0 contract, and
 * the end-to-end run cross-checked against the underlying evaluator.
 */

import { describe, expect, test } from "vitest";
import { evaluateCaseDS } from "./riskEngine8";
import {
  TOLTYPE_DS_SYM,
  TOLTYPE_DS_ASYM,
  TOLTYPE_SS_UPPER,
  TOLTYPE_SS_LOWER,
  TOLTYPE_SS_LOWER_UNKNOWN,
  TOLTYPE_SS_UPPER_UNKNOWN,
} from "./toleranceTypes8";
import {
  normalizeToleranceFrame,
  buildRisk8Contract,
  runRisk8FromApp,
} from "./riskAdapter8";

const appRow = () => ({
  nominal: 10,
  uutLowerLimit: 9,
  uutUpperLimit: 11,
  riskAverage: 10, // centered -> mu 0
  tur: 4,
  turNeeded: "",
  reliability: 0.9,
  reqPFA: 0.02,
  reopTarget: 0.85,
  initialGB: 1,
  originalInterval: 12,
  uCalNative: "",
  calBias: 0,
  decayModel: "",
  weibullBeta: "",
  resolution: "",
});

describe("normalizeToleranceFrame", () => {
  test("two-sided frame is centered on the nominal (not the band midpoint)", () => {
    expect(normalizeToleranceFrame(TOLTYPE_DS_SYM, 10, 9, 11)).toEqual({ center: 10, halfSpan: 1 });
    // asymmetric: nominal 10 sits off-center in [9,12]; center is the nominal,
    // half-span is (upper-lower)/2. The band's offset is carried by the engine's
    // delta, and mu is measured from the nominal.
    expect(normalizeToleranceFrame(TOLTYPE_DS_ASYM, 10, 9, 12)).toEqual({ center: 10, halfSpan: 1.5 });
  });

  test("single-sided frames are anchored at the nominal", () => {
    expect(normalizeToleranceFrame(TOLTYPE_SS_UPPER, 10, "", 11)).toEqual({ center: 10, halfSpan: 1 });
    expect(normalizeToleranceFrame(TOLTYPE_SS_LOWER, 10, 9, "")).toEqual({ center: 10, halfSpan: 1 });
  });

  test("degenerate / unknown frames return null", () => {
    expect(normalizeToleranceFrame(TOLTYPE_DS_SYM, 10, 11, 11)).toBeNull(); // zero span
    expect(normalizeToleranceFrame(99, 10, 9, 11)).toBeNull(); // unknown type
  });
});

describe("buildRisk8Contract — AVERAGE -> mu and field mapping", () => {
  test("centered average yields mu 0", () => {
    const { input, meta } = buildRisk8Contract(appRow());
    expect(input.mu).toBeCloseTo(0, 12);
    expect(meta.tolType).toBe(TOLTYPE_DS_SYM);
    expect(meta.frame).toEqual({ center: 10, halfSpan: 1 });
  });

  test("off-center average normalizes by the half-span", () => {
    // riskAverage 10.5 with half-span 1 -> mu 0.5
    const { input } = buildRisk8Contract({ ...appRow(), riskAverage: 10.5 });
    expect(input.mu).toBeCloseTo(0.5, 12);
  });

  test("cal bias normalizes to xcal by the half-span", () => {
    const { input } = buildRisk8Contract({ ...appRow(), uutLowerLimit: 8, uutUpperLimit: 12, calBias: 0.4 });
    // half-span = 2 -> xcal = 0.4 / 2 = 0.2
    expect(input.xcal).toBeCloseTo(0.2, 12);
  });

  test("REOP/PFA fields map through; reqReop defaults to reliability when blank", () => {
    const { input } = buildRisk8Contract({ ...appRow(), reopTarget: "" });
    expect(input.reop).toBe(0.9); // assumed REOP <- reliability
    expect(input.pfaTarget).toBe(0.02); // <- reqPFA
    expect(input.reopTarget).toBe(0.9); // defaults to reliability
    expect(input.tur).toBe(4);
    expect(input.initialGB).toBe(1);
    expect(input.originalInterval).toBe(12);
  });

  test("explicit reqReop is honored", () => {
    const { input } = buildRisk8Contract(appRow());
    expect(input.reopTarget).toBe(0.85);
  });

  test("explicit assumed and required REOP fields map to separate workbook columns", () => {
    const { input } = buildRisk8Contract({
      ...appRow(),
      reliability: 0.5,
      reopTarget: 0.5,
      assumedReop: 0.82,
      requiredReop: 0.91,
    });
    expect(input.reop).toBe(0.82); // MAIN.T Assumed_REOP
    expect(input.reopTarget).toBe(0.91); // MAIN.AB REOP_Required
  });
});

describe("runRisk8FromApp end-to-end", () => {
  test("centered symmetric row matches the evaluator directly", () => {
    const { out, computed, meta } = runRisk8FromApp(appRow());
    expect(computed).toBe(true);
    expect(meta.mu).toBeCloseTo(0, 12);

    // GB init 1, mu 0 -> identical to evaluateCaseDS(4, 0.9, 4, -1, 1, 0, -1, 1, 0)
    const r = evaluateCaseDS(4, 0.9, 4, -1, 1, 0, -1, 1, 0);
    expect(out.pfa).toBeCloseTo(r.pPFA, 12);
    expect(out.pfr).toBeCloseTo(r.pPFR, 12);
    expect(out.obs).toBeCloseTo(r.pObs, 12);
  });

  test("off-center average feeds a nonzero mu into the evaluator", () => {
    const { out, meta } = runRisk8FromApp({ ...appRow(), riskAverage: 10.3 });
    expect(meta.mu).toBeCloseTo(0.3, 12);
    // The engine must have used mu = 0.3 (matches a direct evaluate with that bias).
    const r = evaluateCaseDS(4, 0.9, 4, -1, 1, 0.3, -1, 1, 0);
    expect(out.pfa).toBeCloseTo(r.pPFA, 12);
  });

  test("named MAIN/RISK fields are returned alongside the raw output", () => {
    const { fields, out } = runRisk8FromApp(appRow());
    expect(fields.Test_PFA).toBe(out.pfa);
    expect(fields.REOP_At_Test_TUR).toBe(out.obs);
  });

  test.each([
    ["low", 9, "", TOLTYPE_SS_LOWER_UNKNOWN, "GB_LL"],
    ["high", "", 11, TOLTYPE_SS_UPPER_UNKNOWN, "GB_UL"],
  ])(
    "single-sided unknown %s ignores stale TUR and runs the PFA-only boundary",
    (_direction, lower, upper, expectedType, boundaryField) => {
      const { input, out, fields, computed, meta } = runRisk8FromApp({
        ...appRow(),
        measurement: "unknown",
        uutLowerLimit: lower,
        uutUpperLimit: upper,
        uCalNative: 0.1,
        tur: 4, // stale known-measurement value must not leak into types 5/6
        assumedReop: "",
        requiredReop: "",
      });

      expect(input.nominal).toBe("");
      expect(input.tur).toBe("");
      expect(input.reop).toBe("");
      expect(input.reopTarget).toBe("");
      expect(meta.measurementUnknown).toBe(true);
      expect(meta.tolType).toBe(expectedType);
      expect(computed).toBe(true);
      expect(out.statusMit).toBe("OK");
      expect(fields.PFA_With_GB).toBe(0.02);
      expect(typeof fields[boundaryField]).toBe("number");
      expect(fields.REOP_At_Test_TUR).toBe("");
      expect(fields.Test_PFR).toBe("");
    }
  );
});

describe("asymmetric tolerance (type 2) mapping", () => {
  // Nominal 10 sits off-center in the band [9, 12]; UUT average at the nominal.
  const asymRow = () => ({ ...appRow(), uutLowerLimit: 9, uutUpperLimit: 12, riskAverage: 10 });

  test("keeps the nominal as the frame center and detects type 2", () => {
    const { input, meta } = buildRisk8Contract(asymRow());
    expect(meta.tolType).toBe(2); // asymmetric
    expect(meta.frame).toEqual({ center: 10, halfSpan: 1.5 });
    // average == nominal -> mu 0 (the asymmetry lives in the engine's delta, not mu)
    expect(input.mu).toBeCloseTo(0, 12);
  });

  test("average measured from the nominal, not the band midpoint", () => {
    // riskAverage 10.75 with nominal 10, half-span 1.5 -> mu = 0.5
    const { input } = buildRisk8Contract({ ...asymRow(), riskAverage: 10.75 });
    expect(input.mu).toBeCloseTo(0.5, 12);
  });

  test("runs end-to-end and reports type 2 with OK status", () => {
    const { out, meta, computed } = runRisk8FromApp(asymRow(), { enforceMinimumInputs: false });
    expect(computed).toBe(true);
    expect(meta.tolType).toBe(2);
    expect(out.statusCore).toBe("OK");
    expect(typeof out.pfa).toBe("number");
    expect(out.pfa).toBeGreaterThanOrEqual(0);
  });
});
