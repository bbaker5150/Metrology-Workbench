import { describe, expect, it } from 'vitest';
import {
  buildRecommendationCandidateDSFromLimits,
  buildRecommendationCandidateSSFromLimit,
  evaluateCaseDS,
  getRPairForInterval,
  intervalFromFinalRisk,
  MODE_SS_LOWER,
  MODE_SS_UPPER,
  pfaHundredthsOfPercent,
  pfaPassesAtDisplayedPrecision,
} from './riskEngine8';

/**
 * Final V8.00 audit anchors for the pure numerical core.
 *
 * Flowmeter values are saved full-precision cells from the supplied final
 * workbook, SHA-256 8410cc4812276aff5973c1ac50abd6ef3a6d13ecd114240f418e3b80121d223d.
 * They were not generated from the JavaScript under test. Other cases below
 * state algebraic or limiting-case expectations independently of the solver.
 * These checks supplement, rather than relabel, the older Excel Beta.7 captures.
 */
describe('final V8.00 PFA acceptance policy', () => {
  it('uses hundredths of a percent with a half-up boundary', () => {
    // modRiskBackend.PFAHundredthsOfPercent uses Int(p*10000 + .5000000001).
    // At a 2% requirement, [2.0000%, 2.0050%) still displays as 2.00%.
    // A strict probability comparison and the beta's REC_TOL comparison both
    // reject 0.020049; the final workbook intentionally accepts it.
    expect(pfaHundredthsOfPercent(-0.01)).toBe(0);
    expect(pfaHundredthsOfPercent(0.02)).toBe(200);
    expect(pfaHundredthsOfPercent(0.020049)).toBe(200);
    expect(pfaHundredthsOfPercent(0.02005)).toBe(201);
    expect(pfaPassesAtDisplayedPrecision(0.020049, 0.02)).toBe(true);
    expect(pfaPassesAtDisplayedPrecision(0.02005, 0.02)).toBe(false);
    // The same display policy applies at zero and to the required value too.
    expect(pfaPassesAtDisplayedPrecision(0.000049, 0)).toBe(true);
    expect(pfaPassesAtDisplayedPrecision(0.00005, 0)).toBe(false);
    expect(pfaPassesAtDisplayedPrecision(0.0201, 0.02005)).toBe(true);
  });
});

describe('final V8.00 rounded-limit reliability solve', () => {
  it('solves the flowmeter target against the final limits, then ages on the original curve', () => {
    // MAIN!M5:N5 = 159.6:160.4; AU5:AV5 = 159.7:160.3. The normalized
    // limits below retain the workbook's physical-to-normalized evaluation order.
    const halfWidth = (160.4 - 159.6) / 2;
    const lower = (159.7 - 160) / halfWidth;
    const upper = (160.3 - 160) / halfWidth;
    const tur = 1.2852881174149715; // MAIN!W5
    const solved = buildRecommendationCandidateDSFromLimits(
      tur, 4, 0.85, lower, upper, 0, -1, 1, 0,
    );
    expect(solved.ok).toBe(true);
    expect(solved.recREOP).toBeCloseTo(0.9944290447016071, 12); // MAIN!AZ5
    expect(solved.r.pObs).toBeCloseTo(0.8500000000003678, 12); // MAIN!BA5
    expect(solved.r.pPFA).toBeCloseTo(0.0006006333430993438, 12); // MAIN!AW5
    expect(solved.r.pPFR).toBeCloseTo(0.14755835482980795, 12); // MAIN!AX5

    const base = evaluateCaseDS(tur, 0.85, 4, -1, 1, 0, -1, 1, 0);
    const finalOriginalCurve = evaluateCaseDS(tur, solved.recREOP, 4, -1, 1, 0, -1, 1, 0);
    const result = intervalFromFinalRisk(
      'E1', true, '', true, 18, '', false, 0, 'beta missing',
      0.85, solved.recREOP, base, finalOriginalCurve,
    );
    expect(result.ok).toBe(true);
    expect(result.interval).toBeCloseTo(4.421331946491825, 10); // MAIN!AY5

    // Diagnostic only: this is what goes wrong if the beta's reference REOP is
    // kept after the physical limits are rounded. It is not a saved V8 output.
    const staleBeta = evaluateCaseDS(tur, 0.9246910766778693, 4, lower, upper, 0, -1, 1, 0);
    expect(staleBeta.pObs).toBeCloseTo(0.7325352374448406, 10);
    expect(staleBeta.pObs).toBeLessThan(0.85);
  });

  it('rejects an acceptance window too narrow to achieve the requested REOP', () => {
    // With TUR=1, sigma_cal=1/1.96. Even su=0 puts only about 15.5% inside
    // [-0.1,0.1]. Neither a smaller population spread nor a shorter interval
    // can achieve an 85% observed pass probability at that fixed resolution.
    expect(buildRecommendationCandidateDSFromLimits(1, 4, 0.85, -0.1, 0.1, 0, -1, 1, 0).ok).toBe(false);
  });

  it('uses the same reference solution for mirrored upper and lower one-sided limits', () => {
    // Reflection x -> -x swaps the side and negates both bias terms; it leaves
    // all pass probabilities and the inferred UUT spread unchanged.
    const upper = buildRecommendationCandidateSSFromLimit(2, 4, 0.9, 0.8, 1, MODE_SS_UPPER, 0.1, -0.05);
    const lower = buildRecommendationCandidateSSFromLimit(2, 4, 0.9, -0.8, -1, MODE_SS_LOWER, -0.1, 0.05);
    expect(upper.ok).toBe(true);
    expect(lower.ok).toBe(true);
    expect(upper.r.pObs).toBeCloseTo(0.9, 10);
    for (const key of ['pObs', 'pTrue', 'pPFA', 'pPFR', 'su']) {
      expect(lower.r[key], key).toBeCloseTo(upper.r[key], 10);
    }
    expect(lower.recREOP_single).toBeCloseTo(upper.recREOP_single, 10);
  });
});

describe('final V8.00 interval probability basis', () => {
  const base = { OK: true, pObs: 0.75, pTrue: 0.8, su: 2 };
  const final = { OK: true, pObs: 0.875, pTrue: 0.9, su: 1 };
  const calculate = (model, oneSided) => intervalFromFinalRisk(
    model, true, '', true, 12, '', true, 2, '',
    0.99, 0.999, base, final, oneSided,
  );

  it.each([
    ['E1', 0.5, 0.75], ['W1', 0.5, 0.75],
    ['E2', 0.6, 0.8], ['W2', 0.6, 0.8],
  ])('%s selects observed/true reliability before applying the 50% floor', (model, originalR, newTargetR) => {
    // GetRPairForInterval: q=2R-1 for Types 3/4 only. The reference-TUR inputs
    // 0.99/0.999 are deliberately distinct to detect accidentally using them.
    const pair = getRPairForInterval(model, base, final, 0.99, 0.999, true);
    expect(pair.originalR).toBeCloseTo(originalR, 14);
    expect(pair.newTargetR).toBeCloseTo(newTargetR, 14);
    const exponent = model.startsWith('W') ? 0.5 : 1;
    const expected = 12 * (Math.log(newTargetR) / Math.log(originalR)) ** exponent;
    expect(calculate(model, true).interval).toBeCloseTo(expected, 12);
    expect(calculate(model, false).interval).not.toBeCloseTo(expected, 5);
  });

  it('leaves the diffusion model on the UUT variance ratio', () => {
    // Hand result: 12 * 1^2 / 2^2 = 3. The single-sided flag cannot alter it.
    expect(calculate('D', true)).toEqual({ ok: true, interval: 3, issue: '' });
    expect(calculate('D', false)).toEqual({ ok: true, interval: 3, issue: '' });
  });

  it('returns an issue rather than a log interval at the one-sided 50% floor', () => {
    const atFloor = { ...base, pObs: 0.5 };
    const result = intervalFromFinalRisk(
      'E1', true, '', true, 12, '', true, 2, '', 0.75, 0.875, atFloor, final, true,
    );
    expect(result).toEqual({ ok: false, issue: 'original R outside (0,1)' });
  });
});
