import { describe, expect, it } from "vitest";
import {
  normalizeRisk8MonteCarloTrials,
  risk8Cholesky,
  runRisk8EquationMonteCarlo,
} from "./monteCarloEngine8";

const seededRandom = (seed = 0x12345678) => {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

describe("Risk 8.0 Monte Carlo workbook parity", () => {
  it("uses the workbook default and rejects fewer than 100 trials", () => {
    expect(normalizeRisk8MonteCarloTrials("")).toBe(10000);
    expect(normalizeRisk8MonteCarloTrials("25000")).toBe(25000);
    expect(() => normalizeRisk8MonteCarloTrials(99)).toThrow(/at least 100/i);
    expect(() => normalizeRisk8MonteCarloTrials(100.5)).toThrow(/whole number/i);
  });

  it("matches the analytic standard uncertainty of a correlated linear equation", () => {
    const result = runRisk8EquationMonteCarlo({
      equationString: "y = 2 * a - 3 * b",
      inputs: [
        { symbol: "a", componentId: "A", meanBase: 10, standardUncertaintyBase: 0.4 },
        { symbol: "b", componentId: "B", meanBase: 2, standardUncertaintyBase: 0.2 },
      ],
      correlations: { "A|B": 0.35 },
      trials: 80000,
      rng: seededRandom(),
    });
    // c^T Cov c = (2*.4)^2 + (-3*.2)^2 + 2*(2)*(-3)*rho*.4*.2
    const expected = Math.sqrt(0.64 + 0.36 - 0.336);
    expect(result.nominalResultBase).toBe(14);
    expect(result.standardUncertaintyBase).toBeCloseTo(expected, 2);
    expect(result.influenceFractions.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(result.inputs.map((input) => input.symbol)).toEqual(["a", "b"]);
    expect(result.correlationMatrix).toEqual([[1, 0.35], [0.35, 1]]);
    expect(result.choleskyMatrix[0]).toEqual([1, 0]);
    expect(result.choleskyMatrix[1][0]).toBeCloseTo(0.35, 12);
    expect(result.choleskyMatrix[1][1]).toBeCloseTo(Math.sqrt(1 - 0.35 ** 2), 12);
  });

  it("captures nonlinear uncertainty while retaining f(mean) as the nominal", () => {
    const result = runRisk8EquationMonteCarlo({
      equationString: "x ^ 2",
      inputs: [
        { symbol: "x", componentId: "X", meanBase: 0, standardUncertaintyBase: 1 },
      ],
      trials: 80000,
      rng: seededRandom(42),
    });
    expect(result.nominalResultBase).toBe(0);
    expect(result.meanBase).toBeCloseTo(1, 1);
    expect(result.standardUncertaintyBase).toBeCloseTo(Math.sqrt(2), 1);
  });

  it("rejects a non-physical correlation matrix instead of repairing it", () => {
    expect(() =>
      risk8Cholesky([
        [1, 0.9, 0.9],
        [0.9, 1, -0.9],
        [0.9, -0.9, 1],
      ]),
    ).toThrow(/not physically valid/i);
  });
});
