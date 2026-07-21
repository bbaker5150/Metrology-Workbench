import { describe, expect, it } from "vitest";
import { computePointRiskMetrics } from "./riskCompute";

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

describe("computePointRiskMetrics Layer 3 integration", () => {
  it("uses Risk 8.0 Type 2 math for asymmetric sidebar rows", () => {
    const point = makePoint({
      measurementType: "direct",
      equationString: "",
      variableMappings: {},
      testPointInfo: { parameter: { value: 20, unit: "V" } },
      uutTolerance: {
        reading: { high: 25, low: -5, unit: "%", distribution: RECT },
      },
      tmdeTolerances: [
        {
          id: "voltage-standard",
          measurementPoint: { value: 20, unit: "V" },
          floor: {
            high: 1,
            low: -1,
            unit: "V",
            symmetric: true,
            distribution: RECT,
          },
        },
      ],
      components: [],
    });
    const metrics = computePointRiskMetrics(point, {
      ...sessionData,
      uncReq: {
        ...sessionData.uncReq,
        reliability: 85,
        measRelCalcAssumed: 85,
        calInt: 12,
        guardBandMultiplier: 1,
      },
    }, true);

    expect(metrics).not.toBeNull();
    expect(metrics.riskMethod).toBe("risk8-two-sided-asymmetric");
    expect(metrics.pfa).toBeCloseTo(3.42, 1);
    expect(metrics.pfr).toBeCloseTo(7.69, 1);
    expect(metrics.gbPfa).toBeCloseTo(2, 3);
  });

  it("uses Risk 8.0 Type 1 for symmetric linear-mode points", () => {
    const metrics = computePointRiskMetrics(makePoint(), sessionData);
    expect(metrics).not.toBeNull();
    expect(metrics.riskMethod).toBe("risk8-two-sided-symmetric");
    expect(metrics.mcStale).toBe(false);
    expect(metrics.pfa).toBeGreaterThan(0);
  });

  it("matches the workbook Type 1 pressure mitigation row in the sidebar", () => {
    const point = makePoint({
      measurementType: "direct",
      equationString: "",
      variableMappings: {},
      testPointInfo: { parameter: { value: 25, unit: "psig" } },
      uutTolerance: {
        floor: {
          high: 0.2,
          low: -0.2,
          unit: "psig",
          symmetric: true,
          distribution: RECT,
        },
        includeResolutionInBudget: true,
        resolution: 0.1,
        resolutionUnit: "psig",
        resolutionDistribution: "3.464",
        measuringResolution: 0.1,
        measuringResolutionUnit: "psig",
      },
      tmdeTolerances: [
        {
          id: "pressure-standard",
          name: "TMDE tolerance",
          measurementPoint: { value: 25, unit: "psig" },
          floor: {
            high: 0.025,
            low: -0.025,
            unit: "psig",
            symmetric: true,
            distribution: RECT,
          },
        },
      ],
      components: [],
    });
    const metrics = computePointRiskMetrics(
      point,
      {
        ...sessionData,
        uncReq: {
          ...sessionData.uncReq,
          reliability: 85,
          measRelCalcAssumed: 85,
          neededTUR: 4,
          reqPFA: 2,
          calInt: 12,
          guardBandMultiplier: 1,
        },
      },
      true,
    );

    expect(metrics.riskMethod).toBe("risk8-two-sided-symmetric");
    expect(metrics.pfa).toBeCloseTo(2.07, 2);
    expect(metrics.pfr).toBeCloseTo(3.18, 2);
    expect(metrics.gbPfa).toBeCloseTo(2.0, 2);
    expect(metrics.gbPfr).toBeCloseTo(3.21, 2);
    expect(metrics.gbCalInt).toBeCloseTo(11.5759, 3);
    expect(metrics.noGbCalInt).toBeCloseTo(11.2529, 3);
  });

  it("ignores legacy direct Monte Carlo state in sidebar risk calculations", () => {
    const directPoint = makePoint({
      measurementType: "direct",
      equationString: "",
      variableMappings: {},
      testPointInfo: { parameter: { value: 10, unit: "V" } },
      tmdeTolerances: [makeTmde()],
    });
    const linear = computePointRiskMetrics(directPoint, sessionData, true);
    const legacyMonteCarlo = computePointRiskMetrics(
      {
        ...directPoint,
        budgetPropagationMethod: "montecarlo",
        monteCarloTrials: "invalid legacy value",
        risk8MonteCarloResult: {
          hash: "legacy-direct-result",
          standardUncertaintyBase: 999,
        },
      },
      sessionData,
      true,
    );

    expect(legacyMonteCarlo).not.toBeNull();
    expect(legacyMonteCarlo.pfa).toBeCloseTo(linear.pfa, 12);
    expect(legacyMonteCarlo.pfr).toBeCloseTo(linear.pfr, 12);
    expect(legacyMonteCarlo.tur).toBeCloseTo(linear.tur, 12);
  });

  it("calculates migrated derived points from manual TMDE components", () => {
    const point = makePoint({
      tmdeTolerances: [],
      variableNominals: { x: { value: 10, unit: "V" } },
      components: [
        {
          id: "tmde-budget-length",
          name: "Length - Accuracy",
          variableType: "Length",
          value: 1000,
          value_native: 0.01,
          unit_native: "V",
          distribution: "Normal (95%)",
        },
      ],
    });

    const metrics = computePointRiskMetrics(point, sessionData);

    expect(metrics).not.toBeNull();
    expect(metrics.pfa).toBeGreaterThan(0);
    expect(metrics.pfr).toBeGreaterThan(0);
  });

  it("refreshes linked derived TMDE components from the live master", () => {
    const point = makePoint({
      tmdeTolerances: [],
      variableNominals: { x: { value: 10, unit: "V" } },
      components: [
        {
          id: "tmde-budget-meter",
          name: "Meter - Accuracy",
          variableType: "Length",
          value: 1,
          value_native: 0.001,
          unit_native: "V",
          distribution: "Normal (95%)",
          tmdeBudgetSourceId: "master-meter",
          tmdeBudgetRangeId: "range-meter",
          tmdeBudgetFunctionId: "function-meter",
          tmdeBudgetFunctionName: "Length",
          tmdeBudgetComponentKind: "Accuracy",
        },
      ],
    });
    const master = {
      id: "master-meter",
      instrument: {
        functions: [
          {
            id: "function-meter",
            name: "Length",
            unit: "V",
            ranges: [
              {
                id: "range-meter",
                min: 0,
                max: 20,
                tolerances: {
                  reading: {
                    high: 1,
                    low: -1,
                    unit: "V",
                    distribution: "1.960",
                  },
                },
              },
            ],
          },
        ],
      },
    };

    const metrics = computePointRiskMetrics(point, {
      ...sessionData,
      tmdes: [master],
    });

    expect(metrics).not.toBeNull();
    expect(metrics.pfa).toBeGreaterThan(0);
    // The live 1 V error limit is much larger than the stale 0.001 V value;
    // the resulting risk must therefore reflect the refreshed source.
    expect(metrics.tur).toBeGreaterThan(1.5);
  });

  it("ignores the retired point-level Monte Carlo mode", () => {
    const linear = computePointRiskMetrics(makePoint(), sessionData);
    const metrics = computePointRiskMetrics(
      makePoint({ propagationMode: "montecarlo" }),
      sessionData,
    );
    expect(metrics.riskMethod).toBe("risk8-two-sided-symmetric");
    expect(metrics.mcStale).toBe(false);
    expect(metrics.pfa).toBeCloseTo(linear.pfa, 10);
  });

  it("does not use a retired empirical Monte Carlo summary", () => {
    {
      const retired = computePointRiskMetrics(
        makePoint({ propagationMode: "montecarlo", mcSummary: { hash: "old" } }),
        sessionData,
        true,
      );
      expect(retired.riskMethod).toBe("risk8-two-sided-symmetric");
      expect(retired.mcStale).toBe(false);
    }
  });

  it("uses Risk 8.0 risk math when Monte Carlo is the budget component", () => {
    const metrics = computePointRiskMetrics(
      makePoint({
        budgetPropagationMethod: "montecarlo",
        monteCarloTrials: 10000,
      }),
      sessionData,
      true,
    );
    expect(metrics.riskMethod).toBe("risk8-two-sided-symmetric");
    expect(metrics.mcStale).toBe(false);
    expect(metrics.pfa).toBeGreaterThan(0);
    expect(metrics.gbLow).toBeGreaterThanOrEqual(8);
    expect(metrics.gbHigh).toBeLessThanOrEqual(12);
  });

  it("calculates risk for a negative AC real-power result with a %IV UUT tolerance", () => {
    const component = (id, variableType, valueNative, unitNative) => ({
      id,
      name: `${variableType} - Accuracy`,
      variableType,
      value: 1000,
      value_native: valueNative,
      unit_native: unitNative,
      distribution: "Normal (95%)",
    });
    const calculatedPower = 2 * 1 * Math.cos(3);
    const point = makePoint({
      equationString: "V * Irms * cos(theta)",
      variableMappings: {
        V: "Voltage",
        Irms: "Current",
        theta: "Phase Angle",
      },
      variableNominals: {
        V: { value: 2, unit: "V" },
        Irms: { value: 1, unit: "A" },
        theta: { value: 3, unit: "rad" },
      },
      testPointInfo: {
        parameter: { value: calculatedPower, unit: "W" },
      },
      tmdeTolerances: [],
      components: [
        component("voltage", "Voltage", 0.0102, "V"),
        component("current", "Current", 0.005102, "A"),
        component("angle", "Phase Angle", 0.01531, "rad"),
      ],
      uutTolerance: {
        reading: {
          high: 1,
          low: -1,
          unit: "%",
          symmetric: true,
          distribution: RECT,
        },
        measuringResolution: {
          length: 0.0005,
          unit: "W",
          distribution: RECT,
        },
      },
      budgetPropagationMethod: "montecarlo",
      monteCarloTrials: 10000,
    });

    const metrics = computePointRiskMetrics(point, sessionData);

    expect(calculatedPower).toBeCloseTo(-1.979985, 6);
    expect(metrics).not.toBeNull();
    expect(metrics.pfa).toBeTypeOf("number");
    expect(metrics.pfr).toBeTypeOf("number");
    expect(metrics.tur).toBeTypeOf("number");
    expect(metrics.pfa).toBeGreaterThanOrEqual(0);
    expect(metrics.pfr).toBeGreaterThanOrEqual(0);
    expect(metrics.tur).toBeGreaterThan(0);
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

  it("uses the Risk 8.0 PFA-only boundary for single-sided measurement unknown", () => {
    const point = makePoint({
      uutTolerance: {
        singleSided: {
          direction: "low",
          measurement: "unknown",
          limit: 9,
          unit: "V",
        },
        measuringResolution: { length: 2, unit: "V", distribution: "Rectangular" },
      },
    });

    const metrics = computePointRiskMetrics(point, sessionData, true);

    expect(metrics).not.toBeNull();
    expect(metrics.riskMethod).toBe("risk8-pfa-boundary");
    expect(metrics.pfa).toBe(2);
    expect(metrics.gbLow).toBeTypeOf("number");
    expect(metrics.gbLow).toBeGreaterThan(9);
    expect(metrics.pfr).toBeUndefined();
    expect(metrics.tur).toBeUndefined();
    expect(metrics.tar).toBeUndefined();
  });

  it("uses the full Risk 8.0 Type 3 path for a known lower limit", () => {
    const point = makePoint({
      uutTolerance: {
        singleSided: {
          direction: "low",
          measurement: "known",
          limit: 9,
          unit: "V",
        },
      },
    });
    const metrics = computePointRiskMetrics(point, {
      ...sessionData,
      uncReq: {
        ...sessionData.uncReq,
        measRelCalcAssumed: 95,
        calInt: 12,
        guardBandMultiplier: 1,
      },
    }, true);

    expect(metrics).not.toBeNull();
    expect(metrics.riskMethod).toBe("risk8-single-sided-known");
    expect(metrics.pfa).toBeTypeOf("number");
    expect(metrics.pfr).toBeTypeOf("number");
    expect(metrics.tur).toBeGreaterThan(0);
  });

  it("uses the point value as the measured value for a direct 2 V / ≥1 V case", () => {
    const point = makePoint({
      measurementType: "direct",
      equationString: "",
      variableMappings: {},
      testPointInfo: { parameter: { value: 2, unit: "V" } },
      tmdeTolerances: [
        {
          id: "voltage-standard",
          measurementPoint: { value: 2, unit: "V" },
          floor: {
            high: 0.02,
            low: -0.02,
            unit: "V",
            symmetric: true,
            distribution: "1.960",
          },
        },
      ],
      uutTolerance: {
        singleSided: {
          direction: "low",
          measurement: "known",
          limit: 1,
          unit: "V",
        },
        measuringResolution: {
          length: 0.01,
          unit: "V",
          distribution: RECT,
        },
      },
    });
    const metrics = computePointRiskMetrics(point, {
      ...sessionData,
      uncReq: {
        ...sessionData.uncReq,
        reliability: 95,
        measRelCalcAssumed: 85,
        calInt: 12,
        guardBandMultiplier: 1,
      },
    }, true);

    expect(metrics).not.toBeNull();
    expect(metrics.riskMethod).toBe("risk8-single-sided-known");
    expect(metrics.pfa).toBeTypeOf("number");
    expect(metrics.pfr).toBeTypeOf("number");
    expect(metrics.tur).toBeGreaterThan(1);
  });

  it("matches the workbook Type 3 uncertainty and TUR inputs", () => {
    const point = makePoint({
      measurementType: "direct",
      equationString: "",
      variableMappings: {},
      testPointInfo: { parameter: { value: 2, unit: "V" } },
      tmdeTolerances: [
        {
          id: "voltage-standard",
          measurementPoint: { value: 2, unit: "V" },
          floor: {
            high: 0.02,
            low: -0.02,
            unit: "V",
            symmetric: true,
            distribution: RECT,
          },
        },
      ],
      uutTolerance: {
        singleSided: {
          direction: "low",
          measurement: "known",
          limit: 1,
          unit: "V",
        },
        includeResolutionInBudget: true,
        measuringResolution: "0.01",
        measuringResolutionUnit: "V",
        measuringResolutionDistribution: "3.464",
      },
    });
    const metrics = computePointRiskMetrics(point, {
      ...sessionData,
      uncReq: {
        ...sessionData.uncReq,
        reliability: 85,
        measRelCalcAssumed: 85,
        uncertaintyConfidence: 95,
        calInt: 12,
        guardBandMultiplier: 1,
      },
    }, true);

    expect(metrics).not.toBeNull();
    expect(metrics.riskMethod).toBe("risk8-single-sided-known");
    expect(metrics.tur).toBeCloseTo(42.87, 1);
    expect(metrics.pfa).toBeCloseTo(0.11, 1);
    expect(metrics.pfr).toBeCloseTo(0.12, 1);
  });

  it("rejects an upper limit below the known measurement instead of silently inverting it", () => {
    const point = makePoint({
      uutTolerance: {
        singleSided: {
          direction: "high",
          measurement: "known",
          limit: 9,
          unit: "V",
        },
      },
    });
    expect(computePointRiskMetrics(point, sessionData)).toBeNull();
  });

  it("does not revive a retired empirical summary after equation edits", () => {
    {
      const retired = computePointRiskMetrics(
        makePoint({
          propagationMode: "montecarlo",
          mcSummary: { hash: "old" },
          equationString: "y = x + 0",
        }),
        sessionData,
      );
      expect(retired.riskMethod).toBe("risk8-two-sided-symmetric");
      expect(retired.mcStale).toBe(false);
    }
  });
});
