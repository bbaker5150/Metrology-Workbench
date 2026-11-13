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
    expect(input.pfaTarget).toBeCloseTo(0.02, 12); // <- reqPFA
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
    expect(input.reop).toBe(0.82); // MAIN.AF -> scratch T: Assumed_REOP
    expect(input.reopTarget).toBe(0.91); // MAIN.AJ -> scratch AB: REOP_Required
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
      expect(fields.PFA_With_GB).toBeCloseTo(0.02, 12);
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

// Source: supplied final 8.00 Flowmeter workbook, MAIN row 5 and
// UUT_TOL_DATA!F2. These expected values are saved workbook outputs, not values
// produced by the app under test. This exercises the app -> scratch contract.
describe("final V8.00 flowmeter adapter regression", () => {
  const flowmeter = {
    nominal: 160,
    uutLowerLimit: 159.6,
    uutUpperLimit: 160.4,
    tur: 1.2852881174149715,
    assumedReop: 0.85,
    requiredReop: 0.85,
    turNeeded: 4,
    reqPFA: 0.02,
    originalInterval: 18,
    resolution: 0.1,
  };

  test("supplies resolution before solving, so interval and rounded limits describe one result", () => {
    const { input, out, fields } = runRisk8FromApp(flowmeter);
    expect(input.resolution).toBe(0.1); // scratch AE7, from UUT_TOL_DATA!F2
    expect(input.initialGB).toBe(""); // workbook default remains g = 1
    expect(input.decayModel).toBe(""); // workbook default remains E1
    expect(fields.GB_LL).toBeCloseTo(159.7, 12);
    expect(fields.GB_UL).toBeCloseTo(160.3, 12);
    expect(fields.GB_Percent).toBeCloseTo(0.75, 12);
    expect(fields.Interval_With_GB).toBeCloseTo(4.421331946491825, 8);
    expect(fields.Target_REOP_With_GB).toBeCloseTo(0.9944290447016071, 10);
    expect(fields.Observed_REOP_With_GB).toBeCloseTo(0.85, 10);
    expect(fields.Observed_REOP_Interval_Only).toBeCloseTo(0.8657909993806616, 8);
    expect(fields.Interval_REOP_Only).toBeCloseTo(11.276605944760007, 7);
    expect(out.mitPfa).toBeCloseTo(0.0006006333430993438, 10);
    // Never revive the beta's pre-rounding recommendation at rounded limits.
    expect(fields.Interval_With_GB).not.toBeCloseTo(11.734263719927311, 3);
  });

  test.each(["", 0, -0.1])("blank or nonpositive resolution %s retains the continuous solution", resolution => {
    const result = runRisk8FromApp({ ...flowmeter, resolution });
    expect(result.out.statusMit).toBe("solution found");
    expect(result.out.gbMult).toBeGreaterThan(0.97);
    expect(result.out.physGbLower).toBeLessThan(159.7);
    expect(result.out.gbInterval).toBeGreaterThan(11);
  });

  test.each(["not a number", Infinity])("invalid scratch resolution %s cannot publish stale GB outputs", resolution => {
    const { out } = runRisk8FromApp({ ...flowmeter, resolution });
    // Direct adapter inputs represent scratch values: a nonblank nonnumeric AE
    // fails ApplyResolutionToMitigation, rather than silently disabling rounding.
    expect(out.statusMit).toBe("solution not found");
    expect(out.gbMult).toBe("");
    expect(out.gbInterval).toBe("");
    expect(out.mitObs).toBe("");
    expect(out.intInterval).toEqual(expect.any(Number));
  });
});
