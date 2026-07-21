/**
 * riskEngine8.test.js — Phase 1 unit tests for the 8.0 risk-engine port.
 *
 * These are correctness anchors for the ported primitives and the two core
 * evaluators. They do two things:
 *   1. Pin each primitive to an independently known value (so a failure
 *      localizes to one function rather than the whole pipeline).
 *   2. Assert structural invariants of EvaluateCase_DS/_SS (confusion-matrix
 *      partition sums to 1, probabilities in [0,1], reopMet logic, sigma
 *      relationships) plus a couple of hand-computed sigma values.
 *
 * NOTE: bit-for-bit agreement with the workbook is verified separately by the
 * golden-vector suite (later phase) that captures real MAIN inputs/outputs from
 * `Unc_Tool_v8.00Beta`. Tolerances here account for the Abramowitz-Stegun CDF
 * approximation (max abs error ~7.5e-8) used by the engine on purpose.
 */

import { describe, expect, test } from "vitest";
import {
  MODE_TWO_SIDED,
  MODE_SS_LOWER,
  MODE_SS_UPPER,
  normalPDF,
  normalCDF,
  normalInvCDF,
  probBetween,
  probSinglePass,
  clamp01,
  sigmaCalFromTUR,
  sigmaCalFromUCal,
  sigmaFromArea,
  solveSigmaObsSingle,
  maxAchievableSinglePass,
  minAchievableSinglePass,
  pcaIntegralDS,
  evaluateCaseDS,
  evaluateCaseSS,
  guardbandFromRatio,
  recommendMitigationDS,
  recommendMitigationSS,
  recommendREOPOnlyDS,
  riskTargetsMet,
  computeLogInterval,
  computeWeibullInterval,
  computeDiffusionInterval,
  getRPairForInterval,
  validateDecayModel,
  intervalFromFinalRisk,
} from "./riskEngine8";

describe("normal distribution primitives", () => {
  test("normalPDF matches standard normal density", () => {
    expect(normalPDF(0)).toBeCloseTo(0.3989422804, 9);
    expect(normalPDF(1)).toBeCloseTo(0.2419707245, 9);
    expect(normalPDF(-1)).toBeCloseTo(normalPDF(1), 12);
  });

  test("normalCDF hits known quantiles within A&S approximation error", () => {
    expect(normalCDF(0)).toBeCloseTo(0.5, 7);
    expect(normalCDF(1.959963985)).toBeCloseTo(0.975, 6); // 95% two-sided k-factor
    expect(normalCDF(1.644853627)).toBeCloseTo(0.95, 6);
    // symmetry branch: F(-z) = 1 - F(z)
    expect(normalCDF(-0.5)).toBeCloseTo(1 - normalCDF(0.5), 12);
  });

  test("normalInvCDF inverts normalCDF (120-iter bisection)", () => {
    expect(normalInvCDF(0.975)).toBeCloseTo(1.959963985, 4);
    expect(normalInvCDF(0.95)).toBeCloseTo(1.644853627, 4);
    // round-trip through the engine's own CDF
    expect(normalCDF(normalInvCDF(0.8))).toBeCloseTo(0.8, 6);
    expect(() => normalInvCDF(0)).toThrow();
    expect(() => normalInvCDF(1)).toThrow();
  });

  test("probBetween degenerate branches", () => {
    expect(probBetween(1, -1, 0, 1)).toBe(0); // a >= b
    expect(probBetween(-1, 1, 0, -0.5)).toBe(0); // sigma < 0
    expect(probBetween(-1, 1, 0, 0)).toBe(1); // sigma 0, mu inside
    expect(probBetween(-1, 1, 5, 0)).toBe(0); // sigma 0, mu outside
    // symmetric band, sigma 1: F(1)-F(-1) ~ 0.6827
    expect(probBetween(-1, 1, 0, 1)).toBeCloseTo(0.6826894921, 6);
  });

  test("probSinglePass upper/lower and degenerate sigma", () => {
    // sigma 1, limit at mean: exactly half the mass passes either way
    expect(probSinglePass(0, MODE_SS_UPPER, 0, 1)).toBeCloseTo(0.5, 7);
    expect(probSinglePass(0, MODE_SS_LOWER, 0, 1)).toBeCloseTo(0.5, 7);
    // upper limit at +1, mean 0: P(pass) = F(1) ~ 0.8413
    expect(probSinglePass(1, MODE_SS_UPPER, 0, 1)).toBeCloseTo(0.8413447461, 6);
    // sigma 0 hard pass/fail
    expect(probSinglePass(1, MODE_SS_UPPER, 0.5, 0)).toBe(1);
    expect(probSinglePass(1, MODE_SS_UPPER, 2, 0)).toBe(0);
    expect(probSinglePass(1, MODE_SS_LOWER, 2, 0)).toBe(1);
  });

  test("clamp01", () => {
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.37)).toBe(0.37);
  });
});

describe("sigma helpers", () => {
  test("sigmaCalFromTUR / sigmaCalFromUCal use the fixed 1.96 k-factor", () => {
    expect(sigmaCalFromTUR(4)).toBeCloseTo(1 / (4 * 1.96), 12);
    expect(sigmaCalFromTUR(1)).toBeCloseTo(1 / 1.96, 12);
    // U_cal normalized = 1.96 * sigma_cal, so a TUR-4 span (U_cal = 1/4) inverts back
    expect(sigmaCalFromUCal(1 / 4)).toBeCloseTo(sigmaCalFromTUR(4), 12);
  });

  test("sigmaFromArea inverts probBetween on a symmetric band", () => {
    // 0.9 = 2*F(1/sigma) - 1  =>  F(1/sigma) = 0.95  =>  1/sigma = 1.6448536
    // => sigma = 0.6079568 (exact normal). A&S approximation lands within 1e-4.
    const sigma = sigmaFromArea(-1, 1, 0, 0.9);
    expect(sigma).toBeCloseTo(0.6079568, 4);
    // and it is a genuine inverse: feeding sigma back reproduces the area
    expect(probBetween(-1, 1, 0, sigma)).toBeCloseTo(0.9, 8);
  });

  test("sigmaFromArea rejects impossible inputs", () => {
    expect(() => sigmaFromArea(-1, 1, 0, 0)).toThrow();
    expect(() => sigmaFromArea(-1, 1, 0, 1)).toThrow();
    expect(() => sigmaFromArea(-1, 1, 5, 0.9)).toThrow(); // mu outside (a,b)
  });

  test("solveSigmaObsSingle inverts probSinglePass", () => {
    // upper limit +1, mean 0, target 0.95 => F(1/sigma)=0.95 => sigma=0.6079568
    const sigma = solveSigmaObsSingle(1, MODE_SS_UPPER, 0, 0.95, 0);
    expect(sigma).toBeCloseTo(0.6079568, 4);
    expect(probSinglePass(1, MODE_SS_UPPER, 0, sigma)).toBeCloseTo(0.95, 7);
  });

  test("solveSigmaObsSingle guards the 50% asymptote and infeasible targets", () => {
    expect(() => solveSigmaObsSingle(0, MODE_SS_UPPER, 0, 0.5, 0)).toThrow();
  });

  test("max/min achievable single pass clamp around 0.5", () => {
    // mean well inside the pass region: max is the finite value, min floors at 0.5
    const sc = sigmaCalFromTUR(4);
    expect(maxAchievableSinglePass(1, MODE_SS_UPPER, 0, sc)).toBeGreaterThan(0.5);
    expect(minAchievableSinglePass(1, MODE_SS_UPPER, 0, sc)).toBeCloseTo(0.5, 12);
  });
});

describe("PCA_Integral_DS structural checks", () => {
  test("integral never exceeds the observed-accept band probability", () => {
    // With guard band == tolerance band, PCA <= P(true in tol) and <= P(obs in acc)
    const mu = 0;
    const su = 0.5;
    const sc = sigmaCalFromTUR(4);
    const pca = pcaIntegralDS(mu, su, -1, 1, sc, -1, 1, 0);
    expect(pca).toBeGreaterThan(0);
    expect(pca).toBeLessThanOrEqual(probBetween(-1, 1, mu, su) + 1e-9);
  });

  test("su = 0 collapses to the pass probability at the mean", () => {
    // degenerate: all mass at mu, inside band => equals Ppass_given_y at mu
    expect(pcaIntegralDS(0, 0, -1, 1, 0.1, -1, 1, 0)).toBeCloseTo(
      probBetween(-1, 1, 0, 0.1),
      9
    );
  });
});

describe("EvaluateCase_DS", () => {
  // Symmetric, TUR 4, assumed REOP 0.90, guard band == tolerance (g=1), no bias.
  const r = evaluateCaseDS(4, 0.9, 4, -1, 1, 0, -1, 1, 0);

  test("succeeds and meets REOP", () => {
    expect(r.OK).toBe(true);
    expect(r.reopMet).toBe(true);
  });

  test("solved UUT sigma matches the hand computation", () => {
    // so_ref solves REOP 0.90 over (-1,1): sigma = 0.6079568.
    // sc_solve = 1/(4*1.96) = 0.12755102.
    // su = sqrt(so_ref^2 - sc_solve^2) = sqrt(0.36961148 - 0.01626926) = 0.5944260
    expect(r.so_ref).toBeCloseTo(0.6079568, 3);
    expect(r.sc_solve).toBeCloseTo(0.12755102, 8);
    expect(r.su).toBeCloseTo(0.5944260, 3);
  });

  test("confusion matrix partitions to 1 and stays in range", () => {
    for (const p of [r.pPCA, r.pPFA, r.pPFR, r.pPCR, r.pObs, r.pTrue]) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(r.pPCA + r.pPFA + r.pPFR + r.pPCR).toBeCloseTo(1, 9);
    // Identity: pObs = pPCA + pPFA, pTrue = pPCA + pPFR
    expect(r.pObs).toBeCloseTo(r.pPCA + r.pPFA, 9);
    expect(r.pTrue).toBeCloseTo(r.pPCA + r.pPFR, 9);
  });

  test("small but nonzero false-accept / false-reject risk", () => {
    expect(r.pPFA).toBeGreaterThan(0);
    expect(r.pPFR).toBeGreaterThan(0);
    expect(r.pPFA).toBeLessThan(0.1);
  });

  test("bad inputs return OK:false with the DS message", () => {
    const bad = evaluateCaseDS(4, 0.9, 4, 1, -1, 0, -1, 1, 0); // GB_L > GB_H
    expect(bad.OK).toBe(false);
    expect(bad.msg).toMatch(/GB_L<GB_H/);
    const offCenter = evaluateCaseDS(4, 0.9, 4, -1, 1, 5, -1, 1, 0); // mu outside band
    expect(offCenter.OK).toBe(false);
  });

  test("REOP above the cal-limited maximum is flagged (reopMet=false)", () => {
    // TUR 1 makes sc_solve large; requesting REOP 0.999 can exceed maxREOP_solve.
    const hi = evaluateCaseDS(1, 0.999, 1, -1, 1, 0, -1, 1, 0);
    if (hi.OK && 0.999 > hi.maxREOP_solve + 1e-10) {
      expect(hi.reopMet).toBe(false);
      expect(hi.su).toBe(0);
    }
  });
});

describe("EvaluateCase_SS", () => {
  // Upper single-sided, activeUUT = +1, guard band at limit (g=1), TUR 4,
  // single-sided REOP 0.95, no bias.
  const r = evaluateCaseSS(4, 0.95, 4, 1, 1, MODE_SS_UPPER, 0, 0);

  test("succeeds and meets REOP", () => {
    expect(r.OK).toBe(true);
    expect(r.reopMet).toBe(true);
  });

  test("solved UUT sigma matches the hand computation", () => {
    // so_ref solves single-sided REOP 0.95 at limit +1: sigma = 0.6079568.
    // su = sqrt(0.6079568^2 - (1/(4*1.96))^2) = 0.5944260
    expect(r.so_ref).toBeCloseTo(0.6079568, 3);
    expect(r.su).toBeCloseTo(0.5944260, 3);
  });

  test("confusion matrix partitions to 1", () => {
    expect(r.pPCA + r.pPFA + r.pPFR + r.pPCR).toBeCloseTo(1, 9);
    expect(r.pObs).toBeCloseTo(r.pPCA + r.pPFA, 9);
    expect(r.pTrue).toBeCloseTo(r.pPCA + r.pPFR, 9);
  });

  test("lower single-sided mode is symmetric to upper", () => {
    // mirror the scenario across zero: activeUUT = -1, lower mode.
    const rl = evaluateCaseSS(4, 0.95, 4, -1, -1, MODE_SS_LOWER, 0, 0);
    expect(rl.OK).toBe(true);
    expect(rl.su).toBeCloseTo(r.su, 6);
    expect(rl.pPFA).toBeCloseTo(r.pPFA, 6);
    expect(rl.pPFR).toBeCloseTo(r.pPFR, 6);
  });

  test("invalid mode returns OK:false with the SS message", () => {
    // EvaluateCase_SS rejects the two-sided mode constant.
    const bad = evaluateCaseSS(4, 0.95, 4, 1, 1, MODE_TWO_SIDED, 0, 0);
    expect(bad.OK).toBe(false);
    expect(bad.msg).toMatch(/single-sided mode/);
  });
});

describe("guard-band mitigation: two-sided", () => {
  test("no guard band needed -> recGB = 1 when PFA already meets target", () => {
    // High TUR (10) makes the cal process tight; PFA at g=1 is well under 2%.
    const RR = recommendMitigationDS(10, 0.9, 10, -1, 1, 0, -1, 1, 0, 0.02, 0.85);
    expect(RR.Found).toBe(true);
    expect(RR.recGB).toBe(1);
    expect(RR.pPFA).toBeLessThanOrEqual(0.02 + 1e-6);
    expect(RR.Status).toBe("solution found");
  });

  test("guard band tightened to meet a strict PFA target", () => {
    // Low TUR (2) + strict PFA (1%) forces a guard band < 1.
    const reqPFA = 0.01;
    const RR = recommendMitigationDS(2, 0.85, 2, -1, 1, 0, -1, 1, 0, reqPFA, 0.85);
    expect(RR.Found).toBe(true);
    expect(RR.recGB).toBeGreaterThan(0);
    expect(RR.recGB).toBeLessThanOrEqual(1);
    expect(RR.pPFA).toBeLessThanOrEqual(reqPFA + 5e-7);

    // Self-consistency: re-evaluating at the recommended REOP + physical GB
    // reproduces the reported PFA (GB_L = g*LTL, GB_H = g*UTL for symmetric).
    const { GB_L, GB_H } = guardbandFromRatio(-1, 1, RR.recGB);
    const check = evaluateCaseDS(2, RR.recREOP, 2, GB_L, GB_H, 0, -1, 1, 0);
    expect(check.OK).toBe(true);
    expect(check.pPFA).toBeCloseTo(RR.pPFA, 6);
  });

  test("target input errors are reported without a solution", () => {
    expect(recommendMitigationDS(4, 0.9, 4, -1, 1, 0, -1, 1, 0, 1.2, 0.85).Status).toBe(
      "target input error"
    );
    expect(recommendMitigationDS(4, 0.9, 4, -1, 1, 0, -1, 1, 0, 0.02, 0).Status).toBe(
      "target input error"
    );
  });
});

describe("guard-band mitigation: single-sided", () => {
  test("upper single-sided finds a guard band meeting the PFA target", () => {
    const reqPFA = 0.01;
    const RR = recommendMitigationSS(2, 0.9, 2, 1, 1, MODE_SS_UPPER, 0, 0, reqPFA, 0.9);
    expect(RR.Found).toBe(true);
    expect(RR.recGB).toBeGreaterThan(0);
    expect(RR.recGB).toBeLessThanOrEqual(1);
    expect(RR.pPFA).toBeLessThanOrEqual(reqPFA + 5e-7);
  });

  test("invalid mode yields target input error", () => {
    const RR = recommendMitigationSS(2, 0.9, 2, 1, 1, MODE_TWO_SIDED, 0, 0, 0.01, 0.9);
    expect(RR.Found).toBe(false);
    expect(RR.Status).toBe("target input error");
  });
});

describe("REOP-only mitigation", () => {
  test("holds GB fixed and returns a compliant REOP", () => {
    const reqPFA = 0.05;
    const reqAdjREOP = 0.8;
    const RR = recommendREOPOnlyDS(4, 0.9, 4, -1, 1, 0, -1, 1, 0, reqPFA, reqAdjREOP);
    expect(RR.Found).toBe(true);
    expect(RR.pPFA).toBeLessThanOrEqual(reqPFA + 5e-7);
    expect(RR.pObs).toBeGreaterThanOrEqual(reqAdjREOP - 5e-7);

    // The reported result must itself satisfy the targets.
    const check = evaluateCaseDS(4, RR.recREOP, 4, -1, 1, 0, -1, 1, 0);
    expect(riskTargetsMet(check, reqPFA, reqAdjREOP)).toBe(true);
  });

  test("flags AlreadyCompliant when current inputs already pass", () => {
    // Very loose targets: the current REOP is already compliant.
    const RR = recommendREOPOnlyDS(4, 0.9, 4, -1, 1, 0, -1, 1, 0, 0.5, 0.5);
    expect(RR.Found).toBe(true);
    expect(RR.AlreadyCompliant).toBe(true);
    expect(RR.Status).toMatch(/already compliant/);
  });
});

describe("interval-decay models", () => {
  test("E1/E2 log model implements originalInterval * ln(newR)/ln(origR)", () => {
    const res = computeLogInterval(12, 0.9, 0.95);
    expect(res.ok).toBe(true);
    expect(res.newInterval).toBeCloseTo((12 * Math.log(0.95)) / Math.log(0.9), 10);
  });

  test("W1/W2 Weibull model implements originalInterval * ratio^(1/beta)", () => {
    const res = computeWeibullInterval(12, 0.9, 0.95, 2);
    expect(res.ok).toBe(true);
    const ratio = Math.log(0.95) / Math.log(0.9);
    expect(res.newInterval).toBeCloseTo(12 * ratio ** (1 / 2), 10);
  });

  test("D diffusion model scales with the sigma^2 ratio", () => {
    // 12 * 0.6^2 / 0.5^2 = 12 * 1.44 = 17.28
    const res = computeDiffusionInterval(12, 0.5, 0.6);
    expect(res.ok).toBe(true);
    expect(res.newInterval).toBeCloseTo(17.28, 9);
  });

  test("decay models reject out-of-range reliabilities and bad inputs", () => {
    expect(computeLogInterval(12, 1, 0.95).ok).toBe(false);
    expect(computeLogInterval(0, 0.9, 0.95).ok).toBe(false);
    expect(computeWeibullInterval(12, 0.9, 0.95, 0).ok).toBe(false);
    expect(computeDiffusionInterval(12, 0, 0.6).ok).toBe(false);
  });

  test("validateDecayModel normalizes blank -> E1 and rejects unknown codes", () => {
    expect(validateDecayModel("")).toEqual({ ok: true, modelCode: "E1", issue: "" });
    expect(validateDecayModel("  w1 ")).toEqual({ ok: true, modelCode: "W1", issue: "" });
    expect(validateDecayModel("d")).toEqual({ ok: true, modelCode: "D", issue: "" });
    expect(validateDecayModel("X").ok).toBe(false);
  });

  test("getRPairForInterval picks observed vs true reliability by model", () => {
    const RBase = { pObs: 0.9, pTrue: 0.88 };
    const RFinal = { pObs: 0.95, pTrue: 0.93 };
    expect(getRPairForInterval("E1", RBase, RFinal)).toEqual({ originalR: 0.9, newTargetR: 0.95 });
    expect(getRPairForInterval("E2", RBase, RFinal)).toEqual({ originalR: 0.88, newTargetR: 0.93 });
    expect(getRPairForInterval("W2", RBase, RFinal)).toEqual({ originalR: 0.88, newTargetR: 0.93 });
  });

  test("intervalFromFinalRisk routes the D model through the diffusion path", () => {
    const RBase = evaluateCaseDS(4, 0.9, 4, -1, 1, 0, -1, 1, 0);
    const RFinal = evaluateCaseDS(4, 0.8, 4, -1, 1, 0, -1, 1, 0);
    const res = intervalFromFinalRisk(
      "D", true, "", true, 12, "", true, 2, "", 0.9, 0.8, RBase, RFinal
    );
    expect(res.ok).toBe(true);
    // Diffusion: 12 * RFinal.su^2 / RBase.su^2
    expect(res.interval).toBeCloseTo(12 * RFinal.su ** 2 / RBase.su ** 2, 9);
  });

  test("intervalFromFinalRisk surfaces upstream read issues", () => {
    const RBase = evaluateCaseDS(4, 0.9, 4, -1, 1, 0, -1, 1, 0);
    const RFinal = evaluateCaseDS(4, 0.8, 4, -1, 1, 0, -1, 1, 0);
    expect(
      intervalFromFinalRisk("E1", false, "interval model error", true, 12, "", true, 2, "", 0.9, 0.8, RBase, RFinal)
    ).toEqual({ ok: false, issue: "interval model error" });
    expect(
      intervalFromFinalRisk("W1", true, "", true, 12, "", false, 0, "beta missing", 0.9, 0.8, RBase, RFinal)
    ).toEqual({ ok: false, issue: "beta missing" });
  });
});
