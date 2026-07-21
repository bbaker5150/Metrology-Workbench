/**
 * computeOneRow8.test.js — Phase 3 tests for the row driver.
 *
 * Exercises the full ComputeOneRow orchestration across the tolerance-type
 * branches: blank rows, symmetric/asymmetric two-sided, single-sided, the
 * unknown-measured-value (5/6) boundary method, and the input-error / missing-
 * input status paths. Core numbers are cross-checked against the underlying
 * evaluator so the driver is proven to route inputs through unchanged.
 */

import { describe, expect, test } from "vitest";
import { evaluateCaseDS, normalInvCDF } from "./riskEngine8";
import { computeOneRow } from "./computeOneRow8";

// A complete, valid symmetric two-sided row: nominal 10, +/-1, TUR 4, REOP 0.90,
// targets 2% PFA / 85% REOP, 12-month interval, default (E1) decay.
const symRow = () => ({
  nominal: 10,
  lowerLimit: 9,
  upperLimit: 11,
  initialGB: 1,
  uCal: "",
  mu: "",
  xcal: "",
  tur: 4,
  reop: 0.9,
  turNeeded: "",
  originalInterval: 12,
  pfaTarget: 0.02,
  reopTarget: 0.85,
  decayModel: "",
  weibullBeta: "",
});

describe("computeOneRow — blank and error rows", () => {
  test("entirely blank inputs -> all outputs blank", () => {
    const out = computeOneRow({});
    expect(out.tolType).toBe("");
    expect(out.obs).toBe("");
    expect(out.statusCore).toBe("");
    expect(out.statusMit).toBe("");
  });

  test("nominal outside the limits -> tolType 'input error', bad-input statuses", () => {
    const out = computeOneRow({ ...symRow(), nominal: 10, lowerLimit: 11, upperLimit: 12 });
    expect(out.tolType).toBe("input error");
    expect(out.statusCore).toBe("bad input");
    expect(out.statusMit).toBe("solution not found");
    expect(out.statusInt).toBe("solution not found");
  });

  test("missing TUR -> 'missing required input'", () => {
    const out = computeOneRow({ ...symRow(), tur: "" });
    expect(out.tolType).toBe(1);
    expect(out.statusCore).toBe("missing required input");
    expect(out.obs).toBe("");
  });
});

describe("computeOneRow — symmetric two-sided", () => {
  const out = computeOneRow(symRow());

  test("detects type 1 and computes core risk matching the evaluator", () => {
    expect(out.tolType).toBe(1);
    expect(out.asymmetry).toBe(0);
    expect(out.statusCore).toBe("OK");

    // GB init 1 -> GB_L/GB_H = -1/+1 == tolerance band; must equal the evaluator.
    const r = evaluateCaseDS(4, 0.9, 4, -1, 1, 0, -1, 1, 0);
    expect(out.obs).toBeCloseTo(r.pObs, 12);
    expect(out.pfa).toBeCloseTo(r.pPFA, 12);
    expect(out.pfr).toBeCloseTo(r.pPFR, 12);
    expect(out.trueReop).toBeCloseTo(r.pTrue, 12);
    expect(out.maxReop).toBeCloseTo(r.maxREOP_input, 12);
  });

  test("both mitigation blocks resolve and project an interval", () => {
    expect(out.statusMit).toMatch(/^solution found/);
    expect(typeof out.mitReop).toBe("number");
    expect(typeof out.gbInterval).toBe("number");
    expect(out.gbInterval).toBeGreaterThan(0);

    expect(out.statusInt).toMatch(/solution found/);
    expect(typeof out.intReop).toBe("number");
    expect(typeof out.intInterval).toBe("number");
  });

  test("physical GB limits are written about the nominal", () => {
    // recGB in (0,1]; limits pulled inward from [9, 11] toward 10.
    expect(typeof out.physGbLower).toBe("number");
    expect(typeof out.physGbUpper).toBe("number");
    expect(out.physGbLower).toBeGreaterThanOrEqual(9);
    expect(out.physGbUpper).toBeLessThanOrEqual(11);
  });
});

describe("computeOneRow — mitigation target handling", () => {
  test("missing mitigation targets keep core risk but flag the mitigation blocks", () => {
    const out = computeOneRow({ ...symRow(), pfaTarget: "" });
    expect(out.statusCore).toBe("OK");
    expect(typeof out.obs).toBe("number");
    expect(out.statusMit).toBe("mitigation target missing");
    expect(out.statusInt).toBe("mitigation target missing");
  });

  test("non-numeric mitigation target -> 'target input error'", () => {
    const out = computeOneRow({ ...symRow(), reopTarget: "abc" });
    expect(out.statusMit).toBe("target input error");
    expect(out.statusInt).toBe("target input error");
  });
});

describe("computeOneRow — interval decay issues surface in status", () => {
  test("unknown decay model appends 'interval model error'", () => {
    const out = computeOneRow({ ...symRow(), decayModel: "X" });
    expect(out.statusMit).toMatch(/interval model error/);
    expect(out.gbInterval).toBe("");
  });

  test("missing original interval appends 'interval missing'", () => {
    const out = computeOneRow({ ...symRow(), originalInterval: "" });
    expect(out.statusMit).toMatch(/interval missing/);
    expect(out.gbInterval).toBe("");
  });

  test("Weibull model without beta appends 'beta missing'", () => {
    const out = computeOneRow({ ...symRow(), decayModel: "W1", weibullBeta: "" });
    expect(out.statusMit).toMatch(/beta missing/);
  });

  test("Weibull model with beta projects an interval", () => {
    const out = computeOneRow({ ...symRow(), decayModel: "W1", weibullBeta: 2 });
    expect(out.statusMit).toMatch(/^solution found/);
    expect(typeof out.gbInterval).toBe("number");
  });
});

describe("computeOneRow — single-sided (known measured value)", () => {
  test("upper single-sided (type 4) computes core risk", () => {
    const out = computeOneRow({
      ...symRow(),
      lowerLimit: "",
      upperLimit: 11,
      reop: 0.95,
    });
    expect(out.tolType).toBe(4);
    expect(out.statusCore).toBe("OK");
    expect(typeof out.obs).toBe("number");
    // Single-sided upper writes only an upper physical GB limit.
    expect(typeof out.physGbUpper).toBe("number");
    expect(out.physGbLower).toBe("");
  });

  test("lower single-sided (type 3) computes core risk", () => {
    const out = computeOneRow({
      ...symRow(),
      lowerLimit: 9,
      upperLimit: "",
      reop: 0.95,
    });
    expect(out.tolType).toBe(3);
    expect(out.statusCore).toBe("OK");
    expect(typeof out.physGbLower).toBe("number");
    expect(out.physGbUpper).toBe("");
  });
});

describe("computeOneRow — unknown measured value (types 5/6)", () => {
  test("type 5 (lower, unknown) uses the PFA-boundary method", () => {
    const out = computeOneRow({
      nominal: "",
      lowerLimit: 9,
      upperLimit: "",
      uCal: 0.1,
      tur: "", // must be blank for the unknown-value method
      pfaTarget: 0.02,
      reopTarget: "",
    });
    expect(out.tolType).toBe(5);
    // No core risk is computed for the boundary method.
    expect(out.obs).toBe("");
    // Physical GB limit offset by U_cal * z_alpha / 1.96.
    expect(out.physGbLower).toBeCloseTo(9 - (0.1 * normalInvCDF(0.02)) / 1.96, 12);
    expect(out.mitPfa).toBe(0.02);
    expect(out.statusMit).toBe("OK");
    expect(out.statusInt).toBe("not used");
  });

  test("type 5 with a non-blank TUR -> check inputs", () => {
    const out = computeOneRow({
      nominal: "",
      lowerLimit: 9,
      upperLimit: "",
      uCal: 0.1,
      tur: 4, // invalid for this method
      pfaTarget: 0.02,
    });
    expect(out.tolType).toBe(5);
    expect(out.statusCore).toBe("check inputs");
    expect(out.physGbLower).toBe("check inputs");
  });

  test("type 6 (upper, unknown) with missing PFA target -> 'PFA target missing'", () => {
    const out = computeOneRow({
      nominal: "",
      lowerLimit: "",
      upperLimit: 11,
      uCal: 0.1,
      tur: "",
      pfaTarget: "",
    });
    expect(out.tolType).toBe(6);
    expect(out.statusMit).toBe("PFA target missing");
    expect(out.statusInt).toBe("not used");
  });
});

describe("computeOneRow — asymmetric two-sided", () => {
  test("type 2 carries the asymmetry delta and computes core risk", () => {
    const out = computeOneRow({ ...symRow(), lowerLimit: 9, upperLimit: 12 });
    expect(out.tolType).toBe(2);
    expect(out.asymmetry).toBeCloseTo(1 / 3, 12);
    expect(out.statusCore).toBe("OK");
    expect(typeof out.obs).toBe("number");
  });
});
