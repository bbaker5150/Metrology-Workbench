/**
 * toleranceTypes8.test.js — Phase 3 tests for tolerance typing, input coercion,
 * the IV/Range/Floor builder, resolution rounding, and physical guard-band
 * limit construction. Anchors each ported function to the workbook's behaviour;
 * bit-for-bit agreement is locked later by the golden-vector suite.
 */

import { describe, expect, test } from "vitest";
import { normalInvCDF } from "./riskEngine8";
import {
  TOLTYPE_DS_SYM,
  TOLTYPE_DS_ASYM,
  TOLTYPE_SS_LOWER,
  TOLTYPE_SS_UPPER,
  TOLTYPE_SS_LOWER_UNKNOWN,
  TOLTYPE_SS_UPPER_UNKNOWN,
  isBlankCell,
  isNumericCell,
  getNumericState,
  updateToleranceOutputs,
  safeAsymmetry,
  safeToleranceType,
  safeSingleSidedSwitch,
  safeInitialGB,
  safeOptionalDouble,
  ivTerm,
  rangeTerm,
  floorTerm,
  isNearInteger,
  cleanResolutionValue,
  roundLimitUpToResolution,
  roundLimitDownToResolution,
  writePhysicalGBFromMultiplier,
  writePhysicalGBForUnknownMeasuredValue,
} from "./toleranceTypes8";

describe("cell-value helpers", () => {
  test("isBlankCell treats null/undefined/'' /whitespace as blank", () => {
    expect(isBlankCell(null)).toBe(true);
    expect(isBlankCell(undefined)).toBe(true);
    expect(isBlankCell("")).toBe(true);
    expect(isBlankCell("   ")).toBe(true);
    expect(isBlankCell(0)).toBe(false);
    expect(isBlankCell("1.5")).toBe(false);
  });

  test("isNumericCell accepts numeric strings, rejects blank/non-numeric", () => {
    expect(isNumericCell("1.5")).toBe(true);
    expect(isNumericCell(0)).toBe(true);
    expect(isNumericCell(-2)).toBe(true);
    expect(isNumericCell("")).toBe(false);
    expect(isNumericCell("abc")).toBe(false);
  });

  test("getNumericState returns 0 / 1 / -1 with the coerced value", () => {
    expect(getNumericState("")).toEqual({ state: 0, value: 0 });
    expect(getNumericState("3.25")).toEqual({ state: 1, value: 3.25 });
    expect(getNumericState("x")).toEqual({ state: -1, value: 0 });
  });
});

describe("updateToleranceOutputs — tolerance-type detection", () => {
  test("all limits blank -> symmetric double-sided (type 1)", () => {
    expect(updateToleranceOutputs("", "", "")).toEqual({
      ok: true,
      tolType: TOLTYPE_DS_SYM,
      asymmetry: null,
    });
  });

  test("symmetric fully-specified -> type 1 with delta 0", () => {
    // nominal 10, [9, 11]: delta = (11 - 20 + 9)/(11 - 9) = 0
    expect(updateToleranceOutputs(10, 9, 11)).toEqual({
      ok: true,
      tolType: TOLTYPE_DS_SYM,
      asymmetry: 0,
    });
  });

  test("asymmetric fully-specified -> type 2 with computed delta", () => {
    // nominal 10, [9, 12]: delta = (12 - 20 + 9)/(12 - 9) = 1/3
    const res = updateToleranceOutputs(10, 9, 12);
    expect(res.ok).toBe(true);
    expect(res.tolType).toBe(TOLTYPE_DS_ASYM);
    expect(res.asymmetry).toBeCloseTo(1 / 3, 12);
  });

  test("nominal not strictly inside the limits is an input error", () => {
    expect(updateToleranceOutputs(10, 11, 12).ok).toBe(false); // lower >= nominal
    expect(updateToleranceOutputs(10, 8, 10).ok).toBe(false); // upper == nominal
  });

  test("single-sided known-value lower/upper (types 3/4)", () => {
    expect(updateToleranceOutputs(10, 9, "").tolType).toBe(TOLTYPE_SS_LOWER);
    expect(updateToleranceOutputs(10, "", 11).tolType).toBe(TOLTYPE_SS_UPPER);
  });

  test("single-sided unknown-value lower/upper (types 5/6)", () => {
    expect(updateToleranceOutputs("", 9, "").tolType).toBe(TOLTYPE_SS_LOWER_UNKNOWN);
    expect(updateToleranceOutputs("", "", 11).tolType).toBe(TOLTYPE_SS_UPPER_UNKNOWN);
  });

  test("non-numeric input and ambiguous 2-of-3 patterns are input errors", () => {
    expect(updateToleranceOutputs(10, "abc", 11).ok).toBe(false);
    // limits present but nominal blank (sF=0, sG=1, sH=1): not a valid type
    expect(updateToleranceOutputs("", 9, 11).ok).toBe(false);
  });
});

describe("Safe* input coercers", () => {
  test("safeAsymmetry validates the open interval (-1, 1)", () => {
    expect(safeAsymmetry("0.3")).toBe(0.3);
    expect(() => safeAsymmetry("1")).toThrow();
    expect(() => safeAsymmetry("-1")).toThrow();
    expect(() => safeAsymmetry("x")).toThrow();
  });

  test("safeToleranceType accepts integers 1-6, rejects others", () => {
    expect(safeToleranceType("1")).toBe(1);
    expect(safeToleranceType(6)).toBe(6);
    expect(() => safeToleranceType("0")).toThrow();
    expect(() => safeToleranceType("7")).toThrow();
    expect(() => safeToleranceType("2.5")).toThrow();
    expect(() => safeToleranceType("x")).toThrow();
  });

  test("safeSingleSidedSwitch snaps to -1/0/1", () => {
    expect(safeSingleSidedSwitch("-1")).toBe(-1);
    expect(safeSingleSidedSwitch("0")).toBe(0);
    expect(safeSingleSidedSwitch("1")).toBe(1);
    expect(safeSingleSidedSwitch("x")).toBe(0);
    expect(safeSingleSidedSwitch("0.4")).toBe(0);
  });

  test("safeInitialGB defaults to 1 for blank/non-numeric/negative", () => {
    expect(safeInitialGB("0.8")).toBe(0.8);
    expect(safeInitialGB("")).toBe(1);
    expect(safeInitialGB("x")).toBe(1);
    expect(safeInitialGB("-0.5")).toBe(1);
  });

  test("safeOptionalDouble uses the default for blank, throws on non-numeric", () => {
    expect(safeOptionalDouble("", 0)).toBe(0);
    expect(safeOptionalDouble("2.5", 0)).toBe(2.5);
    expect(() => safeOptionalDouble("x", 0)).toThrow();
  });
});

describe("IV / Range / Floor builder", () => {
  test("ivTerm: percent, ppm, absolute units", () => {
    expect(ivTerm(200, 1, "percent")).toBeCloseTo(2, 12); // 1% of 200
    expect(ivTerm(200, 50, "ppm")).toBeCloseTo(0.01, 12); // 50 ppm of 200
    expect(ivTerm(200, 0.5, "units")).toBe(0.5);
    expect(ivTerm(-200, 1, "percent")).toBeCloseTo(2, 12); // uses |nominal|
    expect(() => ivTerm(200, 1, "bogus")).toThrow();
  });

  test("rangeTerm: percent and ppm of the range value", () => {
    expect(rangeTerm(1000, 0.1, "percent")).toBeCloseTo(1, 12);
    expect(rangeTerm(1000, 100, "ppm")).toBeCloseTo(0.1, 12);
    expect(() => rangeTerm(1000, 1, "units")).toThrow();
  });

  test("floorTerm: micro/milli/units scaling", () => {
    expect(floorTerm(5, "Value (microunits)")).toBeCloseTo(5e-6, 15);
    expect(floorTerm(5, "Value (milliunits)")).toBeCloseTo(5e-3, 15);
    expect(floorTerm(5, "Value (units)")).toBe(5);
    expect(() => floorTerm(5, "bogus")).toThrow();
  });
});

describe("resolution rounding", () => {
  test("isNearInteger detects on-grid quotients", () => {
    expect(isNearInteger(12).near).toBe(true);
    expect(isNearInteger(12.3).near).toBe(false);
    expect(isNearInteger(12).nOut).toBe(12);
  });

  test("cleanResolutionValue removes floating-point dust", () => {
    expect(cleanResolutionValue(0.1 + 0.2)).toBe(0.3);
  });

  test("round up/down move outward/inward to the resolution grid", () => {
    expect(roundLimitUpToResolution(0.123, 0.01)).toBeCloseTo(0.13, 12);
    expect(roundLimitDownToResolution(0.123, 0.01)).toBeCloseTo(0.12, 12);
    // already on-grid: unchanged
    expect(roundLimitUpToResolution(0.12, 0.01)).toBeCloseTo(0.12, 12);
    expect(roundLimitDownToResolution(0.12, 0.01)).toBeCloseTo(0.12, 12);
    // negative values: up = toward +inf (ceil), down = toward -inf (floor)
    expect(roundLimitUpToResolution(-0.123, 0.01)).toBeCloseTo(-0.12, 12);
    expect(roundLimitDownToResolution(-0.123, 0.01)).toBeCloseTo(-0.13, 12);
    // res <= 0 is a no-op
    expect(roundLimitUpToResolution(0.123, 0)).toBe(0.123);
  });
});

describe("physical guard-band limits", () => {
  test("multiplier method (types 1-4) pulls limits inward by g", () => {
    // type 1 symmetric, nominal 10, [9, 11], g = 0.8
    const sym = writePhysicalGBFromMultiplier(TOLTYPE_DS_SYM, { nominal: 10, lowerLimit: 9, upperLimit: 11 }, 0.8);
    expect(sym.ok).toBe(true);
    expect(sym.gbLower).toBeCloseTo(9.2, 12); // 10 - 0.8*(10-9)
    expect(sym.gbUpper).toBeCloseTo(10.8, 12); // 10 + 0.8*(11-10)

    // type 3 single-sided lower: only a lower GB limit
    const lo = writePhysicalGBFromMultiplier(TOLTYPE_SS_LOWER, { nominal: 10, lowerLimit: 9 }, 0.5);
    expect(lo).toEqual({ ok: true, gbLower: 9.5 });

    // type 4 single-sided upper: only an upper GB limit
    const hi = writePhysicalGBFromMultiplier(TOLTYPE_SS_UPPER, { nominal: 10, upperLimit: 11 }, 0.5);
    expect(hi).toEqual({ ok: true, gbUpper: 10.5 });
  });

  test("multiplier method reports missing inputs", () => {
    // nominal missing -> leave blank (checkInputs false)
    expect(
      writePhysicalGBFromMultiplier(TOLTYPE_DS_SYM, { nominal: "", lowerLimit: 9, upperLimit: 11 }, 0.8)
    ).toEqual({ ok: false, checkInputs: false });
    // needed limit missing -> check inputs
    expect(
      writePhysicalGBFromMultiplier(TOLTYPE_DS_SYM, { nominal: 10, lowerLimit: "", upperLimit: 11 }, 0.8)
    ).toEqual({ ok: false, checkInputs: true, tolType: TOLTYPE_DS_SYM });
  });

  test("unknown-measured-value method (types 5/6) offsets by U_cal*z_alpha/1.96", () => {
    const alpha = 0.02;
    const uCal = 0.1;
    // type 5 lower: gbLower = lowerLimit - U_cal * z_alpha / 1.96
    const lo = writePhysicalGBForUnknownMeasuredValue(
      TOLTYPE_SS_LOWER_UNKNOWN,
      { uCal, lowerLimit: 9, turBlank: true },
      alpha
    );
    expect(lo.ok).toBe(true);
    expect(lo.gbLower).toBeCloseTo(9 - (uCal * normalInvCDF(alpha)) / 1.96, 12);
    expect(lo.gbLower).toBeGreaterThan(9); // z_alpha < 0 pulls the accept limit inward

    // type 6 upper
    const hi = writePhysicalGBForUnknownMeasuredValue(
      TOLTYPE_SS_UPPER_UNKNOWN,
      { uCal, upperLimit: 11, turBlank: true },
      alpha
    );
    expect(hi.ok).toBe(true);
    expect(hi.gbUpper).toBeCloseTo(11 + (uCal * normalInvCDF(alpha)) / 1.96, 12);
    expect(hi.gbUpper).toBeLessThan(11);
  });

  test("unknown-value method requires blank TUR, positive U_cal, valid alpha", () => {
    expect(
      writePhysicalGBForUnknownMeasuredValue(TOLTYPE_SS_LOWER_UNKNOWN, { uCal: 0.1, lowerLimit: 9, turBlank: false }, 0.02).ok
    ).toBe(false);
    expect(
      writePhysicalGBForUnknownMeasuredValue(TOLTYPE_SS_LOWER_UNKNOWN, { uCal: 0, lowerLimit: 9, turBlank: true }, 0.02).ok
    ).toBe(false);
    expect(
      writePhysicalGBForUnknownMeasuredValue(TOLTYPE_SS_LOWER_UNKNOWN, { uCal: 0.1, lowerLimit: 9, turBlank: true }, 0.6).ok
    ).toBe(false);
  });
});
