import { describe, expect, it } from "vitest";
import { computePointRiskMetrics } from "./riskCompute";
import {
  buildMonteCarloInputs,
  runMonteCarloPropagation,
  computeMcInputsHash,
} from "./monteCarlo";

// End-to-end Layer 3 plumbing: a derived point in MC mode with a fresh
// persisted summary must produce empirical risk in the sidebar map, and fall
// back (flagged stale) when the summary is missing or outdated.

const RECT = "1.7320508075688772";

const makeTmde = () => ({
  id: "t1",
  variableType: "Length",
  measurementPoint: { value: 10, unit: "V" },
  floor: { high: 1, low: -1, unit: "V", symmetric: true, distribution: RECT },
});

const makePoint = (overrides = {}) => ({
  id: "p1",
  measurementType: "derived",
  equationString: "y = x",
  variableMappings: { x: "Length" },
  testPointInfo: { parameter: { value: 10, unit: "V" } },
  tmdeTolerances: [makeTmde()],
  uutTolerance: {
    floor: { high: 2, low: -2, unit: "V", symmetric: true, distribution: RECT },
  },
  components: [],
  ...overrides,
});

const sessionData = {
  tmdes: [],
  uncReq: {
    reliability: 90,
    neededTUR: 4,
    uncertaintyConfidence: 95,
    reqPFA: 2,
  },
};

const attachFreshSummary = (point) => {
  const { inputs } = buildMonteCarloInputs(
    point.variableMappings,
    point.tmdeTolerances,
    [],
  );
  const result = runMonteCarloPropagation({
    equationString: point.equationString,
    inputs,
    samples: 120000,
    seed: 7,
    quantileCount: 513,
  });
  point.mcSummary = {
    hash: computeMcInputsHash({
      equationString: point.equationString,
      variableMappings: point.variableMappings,
      correlations: point.inputCorrelations,
      tmdeTolerances: point.tmdeTolerances,
      manualComponents: point.components,
    }),
    uBase: result.standardUncertainty,
    meanBase: result.mean,
    intervalLowBase: result.intervalLow,
    intervalHighBase: result.intervalHigh,
    coverageProbability: result.coverageProbability,
    quantiles: result.quantiles,
    samplesUsed: result.samplesUsed,
    seed: result.seed,
  };
  return point;
};

describe("computePointRiskMetrics Layer 3 integration", () => {
  it("uses the closed form for linear-mode points", () => {
    const metrics = computePointRiskMetrics(makePoint(), sessionData);
    expect(metrics).not.toBeNull();
    expect(metrics.riskMethod).toBe("closedform");
    expect(metrics.mcStale).toBe(false);
    expect(metrics.pfa).toBeGreaterThan(0);
  });

  it("flags MC-mode points without a fresh summary as stale and falls back", () => {
    const linear = computePointRiskMetrics(makePoint(), sessionData);
    const metrics = computePointRiskMetrics(
      makePoint({ propagationMode: "montecarlo" }),
      sessionData,
    );
    expect(metrics.riskMethod).toBe("closedform");
    expect(metrics.mcStale).toBe(true);
    expect(metrics.pfa).toBeCloseTo(linear.pfa, 10);
  });

  it("integrates empirically when a fresh summary is present", () => {
    const linear = computePointRiskMetrics(makePoint(), sessionData);
    const point = attachFreshSummary(
      makePoint({ propagationMode: "montecarlo" }),
    );
    const metrics = computePointRiskMetrics(point, sessionData, true);

    expect(metrics.riskMethod).toBe("empirical");
    expect(metrics.mcStale).toBe(false);
    // Same u (rectangular error), so the empirical PFA must land near the
    // closed form — within the normal-vs-rectangular modeling difference.
    expect(metrics.pfa).toBeGreaterThan(0);
    expect(Math.abs(metrics.pfa - linear.pfa)).toBeLessThan(1.5);
    // Interval-based TUR (a rectangular 95% interval is narrower than k·u).
    expect(metrics.tur).toBeGreaterThan(linear.tur);
    // Guard band from the empirical inversion: a valid band inside the
    // tolerance limits whose post-guard-band PFA meets the requirement.
    expect(metrics.gbLow).toBeGreaterThanOrEqual(8);
    expect(metrics.gbHigh).toBeLessThanOrEqual(12);
    expect(metrics.gbLow).toBeLessThan(metrics.gbHigh);
    expect(metrics.gbPfa).toBeLessThanOrEqual(2 * 1.2);
  });

  it("returns mitigation interval and reliability fields with guardband metrics", () => {
    const metrics = computePointRiskMetrics(
      makePoint(),
      {
        ...sessionData,
        uncReq: {
          ...sessionData.uncReq,
          calInt: 12,
          measRelCalcAssumed: 90,
        },
      },
      true,
    );

    expect(metrics.gbCalInt).toBeTypeOf("number");
    expect(metrics.noGbCalInt).toBeTypeOf("number");
    expect(metrics.noGbMeasRel).toBeTypeOf("number");
  });

  it("goes stale when the equation changes after the simulation", () => {
    const point = attachFreshSummary(
      makePoint({ propagationMode: "montecarlo" }),
    );
    point.equationString = "y = 2 * x";
    const metrics = computePointRiskMetrics(point, sessionData);
    expect(metrics.riskMethod).toBe("closedform");
    expect(metrics.mcStale).toBe(true);
  });
});
