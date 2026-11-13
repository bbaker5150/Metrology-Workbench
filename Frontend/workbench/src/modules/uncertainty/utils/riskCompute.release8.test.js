import { describe, expect, it, vi } from "vitest";
import { computePointRiskMetrics, computeRiskEvaluationMap } from "./riskCompute";
import { createRiskEvaluationCache } from "./riskEvaluationCache";

// Plumbing regression using the final release's 160 gpm geometry and combined
// uncertainty. Store the already-combined u_c as one explicit source so edits to
// measuring resolution test the acceptance grid only, without altering u_c.
// Raw budget component parity is covered separately by the budget audit.
const makePoint = (resolution = 0.1) => ({
  id: "v8-flowmeter",
  measurementType: "direct",
  testPointInfo: { parameter: { value: 160, unit: "gpm" } },
  uutTolerance: {
    floor: { high: 0.4, low: -0.4, unit: "gpm", symmetric: true, distribution: "1.732" },
    resolution,
    resolutionUnit: "gpm",
    includeResolutionInBudget: false,
  },
  tmdeTolerances: [],
  components: [{
    id: "workbook-combined-source",
    type: "B",
    name: "Saved workbook combined uncertainty",
    value_native: 0.15878570727031235,
    unit_native: "gpm",
    dof: Infinity,
  }],
});
const sessionFor = point => ({
  id: "release8-regression",
  testPoints: [point],
  tmdes: [],
  uncReq: {
    reliability: 85,
    measRelCalcAssumed: 85,
    neededTUR: 4,
    reqPFA: 2,
    uncertaintyConfidence: 95,
    calInt: 18,
  },
});

describe("final V8.00 live risk routing", () => {
  it("matches the released flowmeter solution through point/sidebar wiring", () => {
    const point = makePoint();
    const metrics = computePointRiskMetrics(point, sessionFor(point), true);
    expect(metrics?.riskMethod).toBe("risk8-two-sided-symmetric");
    expect(metrics.gbLow).toBeCloseTo(159.7, 12);
    expect(metrics.gbHigh).toBeCloseTo(160.3, 12);
    expect(metrics.gbMult).toBeCloseTo(75, 8); // summary percentages, not fractions
    expect(metrics.gbCalInt).toBeCloseTo(4.421331946491825, 6);
    expect(metrics.gbObservedReop).toBeCloseTo(85, 8);
    expect(metrics.gbMeasRel).toBeCloseTo(99.44290447016071, 6);
    expect(metrics.gbPfa).toBeCloseTo(0.06006333430993438, 6);
  });

  it("invalidates a cached interval when the point's resolution changes", () => {
    const evaluate = vi.fn(computeRiskEvaluationMap);
    const cached = createRiskEvaluationCache(evaluate);
    const continuous = makePoint(0);
    const first = cached([continuous], sessionFor(continuous), true);
    expect(first.metrics[continuous.id].gbCalInt).toBeGreaterThan(11);
    const rounded = { ...continuous, uutTolerance: { ...continuous.uutTolerance, resolution: 0.1 } };
    const session = sessionFor(continuous);
    cached([continuous], session, true);
    evaluate.mockClear();
    const result = cached([rounded], { ...session, testPoints: [rounded] }, true);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(result.metrics[rounded.id].gbCalInt).toBeCloseTo(4.421331946491825, 6);
    expect(result.metrics[rounded.id].gbMult).toBeCloseTo(75, 8);
  });

  it("does not fall back to raw tolerance limits when the measuring grid collapses the band", () => {
    const point = makePoint(1);
    const status = vi.fn();
    expect(computePointRiskMetrics(point, sessionFor(point), true, status)).toBeNull();
    expect(status).toHaveBeenCalledWith({
      core: "bad input", gb: "solution not found", interval: "solution not found",
    });
  });
});

// These authoring cases exercise the tolerance form's stage BEFORE scratch
// input preparation, which direct computeOneRow oracle vectors cannot cover.
it.each([
  ["low", 9050, 9.1],
  ["high", 10950, 10.9],
])("prepares a %s direct limit in measurement units and rounds inward before risk", (direction, authoredLimit, expectedLimit) => {
  const point = {
    ...makePoint(),
    testPointInfo: { parameter: { value: 10, unit: "V" } },
    uutTolerance: {
      singleSided: { direction, limit: authoredLimit, unit: "mV", measurement: "known" },
      measuringResolution: 100, measuringResolutionUnit: "mV", includeResolutionInBudget: false,
    },
    components: [{ id: "u", type: "B", value_native: 0.1, unit_native: "V", dof: Infinity }],
  };
  const metrics = computePointRiskMetrics(point, sessionFor(point), true);
  const prepared = {
    ...point,
    uutTolerance: {
      ...point.uutTolerance,
      singleSided: { direction, limit: expectedLimit, unit: "V", measurement: "known" },
      measuringResolution: 0.1, measuringResolutionUnit: "V",
    },
  };
  expect(metrics?.riskMethod).toBe("risk8-single-sided-known");
  expect(metrics).toEqual(computePointRiskMetrics(prepared, sessionFor(prepared), true));
  expect(metrics.tur).toBeCloseTo(0.9 / (0.1 * 1.9599639845400536), 8);
});

it.each(["low", "high"])("rounds the unknown %s physical limit before solving its PFA boundary", direction => {
  const point = {
    ...makePoint(),
    testPointInfo: { parameter: { value: 10, unit: "V" } },
    uutTolerance: {
      singleSided: { direction, limit: direction === "low" ? 9050 : 10950, unit: "mV", measurement: "unknown" },
      measuringResolution: 100, measuringResolutionUnit: "mV", includeResolutionInBudget: false,
    },
    components: [{ id: "u", type: "B", value_native: 0.1, unit_native: "V", dof: Infinity }],
  };
  const summary = computePointRiskMetrics(point, sessionFor(point), true);
  expect(summary?.riskAvailability).toBe("pfa-boundary-only");
  // With sigma approximately0.1 V and alpha2%, the new limit advances another
  // 0.3 V inward. Starting from9.05/10.95 would instead produce9.3/10.7.
  expect(direction === "low" ? summary.gbLow : summary.gbHigh).toBeCloseTo(direction === "low" ? 9.4 : 10.6, 12);
  expect(summary.pfa).toBeUndefined(); // no population distribution for unknown value
});

it("clears cached sidebar uncertainty and risk on invalid covariance, then recovers", () => {
  const mappings = { a: "A", b: "B", c: "C" };
  const point = {
    id: "correlation",
    measurementType: "derived", equationString: "a+b+c",
    variableMappings: mappings,
    variableNominals: Object.fromEntries(Object.keys(mappings).map(key => [key, { value: 10, unit: "V" }])),
    testPointInfo: { parameter: { value: 30, unit: "V" } },
    uutTolerance: { floor: { high: 1, low: -1, unit: "V", symmetric: true, distribution: "1.732" } },
    tmdeTolerances: Object.entries(mappings).map(([id, variableType]) => ({
      id, variableType, measurementPoint: { value: 10, unit: "V" },
      reading: { high: 1, low: -1, unit: "%", distribution: "1", symmetric: true },
    })),
    components: [], inputCorrelations: {},
  };
  const session = sessionFor(point);
  const cached = createRiskEvaluationCache();
  const valid = cached([point], session, true);
  expect(valid.metrics[point.id]?.pfa).toEqual(expect.any(Number));
  expect(valid.uncertainties[point.id]?.expanded_uncertainty_absolute_base).toBeGreaterThan(0);
  const invalid = { ...point, inputCorrelations: { "A|B": 0.9, "A|C": 0.9, "B|C": -0.9 } };
  const cleared = cached([invalid], { ...session, testPoints: [invalid] }, true);
  expect(cleared.metrics[point.id]).toBeNull();
  expect(cleared.uncertainties[point.id]).toBeNull();
  expect(cleared.statuses[point.id]).toBeUndefined(); // no previous success/status retained
  expect(cached([point], session, true)).toEqual(valid);
});
