import { describe, expect, it } from "vitest";
import { computeKnownTwoSidedRisk8, computeKnownMeasurementRisk8 } from "./risk8/knownMeasurementRisk8";
import { normalPDF } from "./risk8/riskEngine8";
import { buildRiskDistributionModel, acceptanceAtTrueError, normalCurve } from "./riskDistributionModel";

export const makeRiskResults = (overrides = {}) => ({ nativeUnit: "V", risk8: computeKnownTwoSidedRisk8({
  nominal: 10, riskAverage: 10, calBias: 0, lowerLimit: 9, upperLimit: 11,
  expandedUncertaintyNative: .25, tur: 4, assumedReop: .95, requiredReop: .9,
  reqPFA: .02, initialGB: 1, originalInterval: 12, ...overrides,
}) });

describe("point risk teaching model", () => {
  it("uses the exact point outcomes and independent variance sum", () => {
    const results = makeRiskResults({ riskAverage: 10.1, calBias: .05 });
    const m = buildRiskDistributionModel(results);
    expect(m.available).toBe(true);
    expect(m.state.pPFA).toBeCloseTo(results.risk8.out.pfa, 12);
    expect(m.state.pPFR).toBeCloseTo(results.risk8.out.pfr, 12);
    expect(m.trueMean).toBeCloseTo(.1, 12);
    expect(m.calMean).toBeCloseTo(.05, 12);
    expect(m.observedMean).toBeCloseTo(.15, 12);
    expect(m.observedSigma ** 2).toBeCloseTo(m.trueSigma ** 2 + m.calSigma ** 2, 12);
    expect(m.state.pPCA + m.state.pPFA + m.state.pPFR + m.state.pPCR).toBeCloseTo(1, 10);
  });

  it("shows REOP controlling reference spread and uncertainty controlling calibration spread", () => {
    const results = makeRiskResults({ turNeeded: 4 });
    const m = buildRiskDistributionModel(results);
    const lowerReop = buildRiskDistributionModel(results, { reop: .8 });
    expect(lowerReop.referenceObservedSigma).toBeGreaterThan(m.referenceObservedSigma);
    const increased = buildRiskDistributionModel(results, { uncertaintyFactor: 2 });
    expect(increased.calSigma).toBeCloseTo(m.calSigma * 2, 12);
    expect(increased.trueSigma).toBeCloseTo(m.trueSigma, 12);
    expect(increased.observedSigma).toBeGreaterThan(m.observedSigma);
    expect(increased.state.pObs).toBeLessThan(m.state.pObs);
    expect(results.risk8.input.tur).toBe(4);
  });

  it("reinfers the true population when reference TUR follows current TUR", () => {
    const results = makeRiskResults();
    const m = buildRiskDistributionModel(results);
    const increased = buildRiskDistributionModel(results, { uncertaintyFactor: 2 });
    expect(increased.fixedReference).toBe(false);
    expect(increased.referenceTur).toBe(increased.tur);
    expect(increased.trueSigma).toBeLessThan(m.trueSigma);
    expect(increased.state.pObs).toBeCloseTo(.95, 7);
  });

  it("integrates the conditional demonstration back to population PFA/PFR", () => {
    const m = buildRiskDistributionModel(makeRiskResults({ riskAverage: 10.12, calBias: -.08, initialGB: .9 }));
    const integrate = (a, b, reject) => {
      const n = 10000, dx = (b - a) / n;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const error = a + (i + .5) * dx;
        const chance = acceptanceAtTrueError(m, error);
        sum += normalPDF((error - m.trueMean) / m.trueSigma) / m.trueSigma * (reject ? chance.rejected : chance.accepted) * dx;
      }
      return sum;
    };
    expect(integrate(m.trueMean - 9 * m.trueSigma, m.lower, false) + integrate(m.upper, m.trueMean + 9 * m.trueSigma, false)).toBeCloseTo(m.state.pPFA, 6);
    expect(integrate(m.lower, m.upper, true)).toBeCloseTo(m.state.pPFR, 6);
  });

  it.each(["low", "high"])("supports a %s single-sided tolerance", direction => {
    const m = buildRiskDistributionModel({ nativeUnit: "V", risk8: computeKnownMeasurementRisk8({
      tolerance: { singleSided: { direction, limit: direction === "low" ? 9 : 11, measurement: "known", unit: "V" } },
      nominal: 10, riskAverage: 10, expandedUncertaintyNative: .25, tur: 4, assumedReop: .95, requiredReop: .9, reqPFA: .02, initialGB: 1, originalInterval: 12,
    }) });
    expect(m.available).toBe(true);
    expect(direction === "low" ? m.upper : m.lower).toBe(direction === "low" ? Infinity : -Infinity);
    expect(acceptanceAtTrueError(m, direction === "low" ? -1 : 1).accepted).toBeCloseTo(.5, 7);
  });

  it("keeps asymmetric limits relative to the nominal", () => {
    const m = buildRiskDistributionModel(makeRiskResults({ nominal: 20, riskAverage: 20, lowerLimit: 19, upperLimit: 25, tur: 2.65, assumedReop: .85, turNeeded: 4, expandedUncertaintyNative: 1.13159879 }));
    expect(m.lower).toBe(-1);
    expect(m.upper).toBe(5);
    expect(m.nominal).toBe(20);
    expect(m.state.pPFA).toBeCloseTo(.0342532438, 7);
  });

  it("handles missing, unknown, and infeasible models without inventing curves", () => {
    expect(buildRiskDistributionModel(null).available).toBe(false);
    expect(buildRiskDistributionModel({ risk8: { out: { tolType: 5 } } }).reason).toMatch(/unknown nominal/);
    expect(buildRiskDistributionModel(makeRiskResults(), { uncertaintyFactor: 3, reop: .9999 }).available).toBe(false);
    expect(acceptanceAtTrueError(null, 0)).toBe(null);
    expect(normalCurve(0, 0, [-1, 1])).toEqual([]);
    expect(normalCurve(.1234, .00001, [-1, 1]).some(p => p.x === .1234)).toBe(true);
  });
});
