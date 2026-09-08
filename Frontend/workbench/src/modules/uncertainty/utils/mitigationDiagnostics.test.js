import { describe, expect, it } from "vitest";
import { computeRiskEvaluationMap } from "./riskCompute";
import { getPointDiagnostics } from "./pointDiagnostics";
import { getMitigationDiagnostics } from "./mitigationDiagnostics";

const point = {
  id: "p",
  measurementType: "direct",
  testPointInfo: { parameter: { value: 10, unit: "V" } },
  uutTolerance: {
    floor: {
      high: 1,
      low: -1,
      unit: "V",
      symmetric: true,
      distribution: "1.732",
    },
  },
  tmdeTolerances: [
    {
      id: "t",
      measurementPoint: { value: 10, unit: "V" },
      floor: {
        high: 0.2,
        low: -0.2,
        unit: "V",
        symmetric: true,
        distribution: "1.732",
      },
    },
  ],
  components: [],
};
const requirements = {
  reliability: 85,
  measRelCalcAssumed: 90,
  reqPFA: 2,
  neededTUR: 4,
  uncertaintyConfidence: 95,
  calInt: 12,
  guardBandMultiplier: 1,
};
const visibleColumns = {
  gbPfa: true,
  gbCalInt: true,
  noGbPfa: true,
  noGbCalInt: true,
};
const evaluate = (overrides = {}, target = point) => {
  const session = { uncReq: { ...requirements, ...overrides } };
  const { metrics, statuses } = computeRiskEvaluationMap(
    [target],
    session,
    true,
  );
  return {
    metrics: metrics.p,
    status: statuses.p,
    warnings: getPointDiagnostics(target, session, {
      riskMetrics: metrics.p,
      riskStatus: statuses.p,
      visibleColumns,
    }),
  };
};

describe("mitigation diagnostics through the sidebar calculation", () => {
  it("explains infeasible targets separately for both mitigation groups", () => {
    const target = {
      ...point,
      tmdeTolerances: [
        {
          ...point.tmdeTolerances[0],
          floor: { ...point.tmdeTolerances[0].floor, high: 1, low: -1 },
        },
      ],
    };
    const result = evaluate(
      { reliability: 95, measRelCalcAssumed: 85 },
      target,
    );
    expect(result.metrics.pfa).toEqual(expect.any(Number));
    expect(result.metrics.gbPfa).toBeUndefined();
    expect(result.metrics.noGbPfa).toBeUndefined();
    expect(result.status).toMatchObject({
      gb: "solution not found",
      interval: "solution not found",
    });
    expect(result.warnings.join(" ")).toContain(
      "No feasible guard-band and interval solution",
    );
    expect(result.warnings.join(" ")).toContain(
      "holding the current guard band fixed",
    );
  });
  it("keeps successful GB + Int results when only interval-only mitigation fails", () => {
    const result = evaluate({ guardBandMultiplier: 0.1 });
    expect(result.metrics.gbPfa).toEqual(expect.any(Number));
    expect(result.status.interval).toBe("solution not found");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^Int Only/);
  });
  it("explains missing calibration intervals while preserving calculated risk", () => {
    const result = evaluate({ calInt: "" });
    expect(result.metrics.gbPfa).toEqual(expect.any(Number));
    expect(result.status.gb).toContain("interval input error");
    expect(result.warnings.join(" ")).toContain(
      "GB + Int — calibration interval: Enter Cal Int",
    );
    expect(result.warnings.join(" ")).toContain(
      "Int Only — calibration interval: Enter Cal Int",
    );
  });
  it("explains a missing target in both mitigation groups", () => {
    const result = evaluate({ reqPFA: "" });
    expect(result.warnings.join(" ")).toContain("Set PFA Required");
    expect(result.warnings.some((w) => w.startsWith("GB + Int"))).toBe(true);
    expect(result.warnings.some((w) => w.startsWith("Int Only"))).toBe(true);
  });
  it("does not warn for successful results, hidden columns, or valid zeros", () => {
    expect(evaluate().warnings).toEqual([]);
    expect(getMitigationDiagnostics({ metrics: {}, requirements })).toEqual([]);
    expect(
      getMitigationDiagnostics({
        metrics: { gbPfa: 0, noGbPfa: 0 },
        visibleColumns: { gbPfa: true, noGbPfa: true },
        requirements,
      }),
    ).toEqual([]);
  });
  it.each([0, -12, "bad"])("explains an invalid interval (%s)", (calInt) => {
    const result = evaluate({ calInt });
    expect(result.warnings.join(" ")).toMatch(
      /Cal Int.*positive number of months/,
    );
    expect(evaluate().warnings).toEqual([]);
  });
  it("explains intentionally unavailable unknown-measurement metrics and preserves the PFA boundary", () => {
    const result = evaluate(
      {},
      {
        ...point,
        uutTolerance: {
          singleSided: { direction: "high", limit: 11, measurement: "unknown" },
        },
      },
    );
    expect(result.metrics.gbPfa).toEqual(expect.any(Number));
    expect(result.warnings.join(" ")).toContain(
      "PFA-only acceptance-boundary results",
    );
    expect(result.warnings.join(" ")).not.toContain(
      "PFA acceptance boundary could not be calculated",
    );
  });
  it("explains the unused bound of a known single-sided tolerance", () => {
    expect(
      getMitigationDiagnostics({
        metrics: { gbHigh: 11 },
        visibleColumns: { gbHigh: true, gbLow: true },
        requirements,
        tolerance: { singleSided: { direction: "high", measurement: "known" } },
      }),
    ).toEqual([expect.stringContaining("only an upper limit")]);
  });
  it("names the interval model failure without calling valid risk values missing", () => {
    const warnings = getMitigationDiagnostics({
      metrics: { gbPfa: 0.1 },
      status: { gb: "solution found; target R outside (0,1)" },
      visibleColumns: { gbCalInt: true, gbPfa: true },
      requirements,
    });
    expect(warnings).toEqual([
      expect.stringContaining(
        "GB + Int — calibration interval: The interval model requires the calculated target reliability",
      ),
    ]);
  });
});
