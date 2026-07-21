import { describe, expect, it } from "vitest";
import {
  runMonteCarloPropagation,
  buildMonteCarloInputs,
  distributionFromDivisor,
  computeMcInputsHash,
  normalizeMcSampleCount,
  DEFAULT_MC_MAX_SAMPLES,
} from "./monteCarlo";
import { calculateDerivedUncertainty, correlationKey } from "./uncertaintyMath";

// Seeded runs are deterministic, so these tolerances are stable, not flaky:
// with N = 6e4 the statistical error on u is ~0.3% (≈ 1/√2N); we assert at
// 1.5–3% to leave generous headroom.
const N = 60000;

const normalInput = (symbol, nominalBase, u) => ({
  symbol,
  groupId: symbol,
  nominalBase,
  components: [{ u, distribution: "normal" }],
});

describe("distributionFromDivisor", () => {
  it("maps the app's divisor values to distribution shapes", () => {
    expect(distributionFromDivisor("1.732")).toBe("rectangular");
    expect(distributionFromDivisor("3.464")).toBe("rectangular");
    expect(distributionFromDivisor("2.449")).toBe("triangular");
    expect(distributionFromDivisor("4.899")).toBe("triangular");
    expect(distributionFromDivisor("1.414")).toBe("arcsine");
    expect(distributionFromDivisor("4.179")).toBe("rayleigh");
    expect(distributionFromDivisor("1.960")).toBe("normal");
    expect(distributionFromDivisor("1.000")).toBe("normal");
    expect(distributionFromDivisor(undefined)).toBe("normal");
  });
});

describe("runMonteCarloPropagation — closed-form checks", () => {
  it("matches RSS and the normal coverage interval for a linear sum", () => {
    // y = a + b with normal u_a = 3, u_b = 4 → u_y = 5, interval ≈ ±1.96·5.
    const result = runMonteCarloPropagation({
      equationString: "y = a + b",
      inputs: [normalInput("a", 10, 3), normalInput("b", 5, 4)],
      samples: N,
      seed: 101,
    });
    expect(result.mean).toBeCloseTo(15, 1);
    expect(Math.abs(result.standardUncertainty - 5) / 5).toBeLessThan(0.015);
    expect(Math.abs(result.intervalLow - (15 - 1.96 * 5))).toBeLessThan(0.35);
    expect(Math.abs(result.intervalHigh - (15 + 1.96 * 5))).toBeLessThan(0.35);
  });

  it("reproduces rectangular statistics (u and 95% shortest-interval width)", () => {
    // Rectangular with u = 1 spans ±√3; any 95% window has width 0.95·2√3.
    const result = runMonteCarloPropagation({
      equationString: "y = x",
      inputs: [
        {
          symbol: "x",
          groupId: "x",
          nominalBase: 0,
          components: [{ u: 1, distribution: "rectangular" }],
        },
      ],
      samples: N,
      seed: 102,
    });
    expect(Math.abs(result.standardUncertainty - 1)).toBeLessThan(0.02);
    const width = result.intervalHigh - result.intervalLow;
    expect(Math.abs(width - 0.95 * 2 * Math.sqrt(3))).toBeLessThan(0.05);
  });

  it("samples triangular and arcsine shapes with the right spread and bounds", () => {
    for (const [distribution, bound] of [
      ["triangular", Math.sqrt(6)],
      ["arcsine", Math.SQRT2],
    ]) {
      const result = runMonteCarloPropagation({
        equationString: "y = x",
        inputs: [
          {
            symbol: "x",
            groupId: "x",
            nominalBase: 0,
            components: [{ u: 1, distribution }],
          },
        ],
        samples: N,
        seed: 103,
        returnSamples: true,
      });
      expect(Math.abs(result.standardUncertainty - 1)).toBeLessThan(0.02);
      expect(result.samples[0]).toBeGreaterThanOrEqual(-bound - 1e-9);
      expect(result.samples[result.samples.length - 1]).toBeLessThanOrEqual(
        bound + 1e-9
      );
    }
  });

  it("samples a zero-mean rayleigh with std = u", () => {
    const result = runMonteCarloPropagation({
      equationString: "y = x",
      inputs: [
        {
          symbol: "x",
          groupId: "x",
          nominalBase: 0,
          components: [{ u: 1, distribution: "rayleigh" }],
        },
      ],
      samples: N,
      seed: 104,
    });
    expect(Math.abs(result.mean)).toBeLessThan(0.02);
    expect(Math.abs(result.standardUncertainty - 1)).toBeLessThan(0.02);
  });

  it("handles the stationary point y = x² at x = 0 (where first-order GUM reports zero)", () => {
    // x ~ N(0,1): y = x² is χ²(1) → E[y] = 1, Var[y] = 2. First-order GUM
    // says u_y = 0 here; MC must recover both the mean shift and the spread,
    // and the coverage interval must be one-sided (y ≥ 0).
    const result = runMonteCarloPropagation({
      equationString: "y = x^2",
      inputs: [normalInput("x", 0, 1)],
      samples: 80000,
      seed: 105,
    });
    expect(Math.abs(result.mean - 1)).toBeLessThan(0.03);
    expect(
      Math.abs(result.standardUncertainty - Math.SQRT2) / Math.SQRT2
    ).toBeLessThan(0.03);
    expect(result.intervalLow).toBeGreaterThanOrEqual(0);
    // Strongly asymmetric: nearly all of the interval lies above the mode at 0.
    expect(result.intervalHigh - result.mean).toBeGreaterThan(
      result.mean - result.intervalLow
    );

    // Cross-check: the linear engine's guard treats this exact case as
    // degenerate rather than reporting u = 0.
    const linear = calculateDerivedUncertainty(
      "y = (x - 5)^2",
      { x: "Offset" },
      [
        {
          id: "t",
          variableType: "Offset",
          measurementPoint: { value: 5, unit: "V" },
          floor: {
            high: 1,
            low: -1,
            unit: "V",
            symmetric: true,
            distribution: "1.7320508075688772",
          },
        },
      ],
      { value: 0, unit: "V" }
    );
    expect(linear.degenerate).toBe(true);
  });

  it("honors input correlations (ρ = 0.5 and the ρ = 1 cancellation limit)", () => {
    const inputs = [normalInput("a", 0, 1), normalInput("b", 0, 1)];

    // y = a − b, ρ_ab = 0.5 → u² = 1 + 1 − 2·0.5 = 1.
    const half = runMonteCarloPropagation({
      equationString: "y = a - b",
      inputs,
      correlations: { [correlationKey("a", "b")]: 0.5 },
      samples: N,
      seed: 106,
    });
    expect(Math.abs(half.standardUncertainty - 1)).toBeLessThan(0.02);

    // ρ = 1 with equal u → the difference cancels exactly.
    const full = runMonteCarloPropagation({
      equationString: "y = a - b",
      inputs,
      correlations: { [correlationKey("a", "b")]: 1 },
      samples: 10000,
      seed: 107,
    });
    expect(full.standardUncertainty).toBeLessThan(1e-9);
  });

  it("is deterministic for a given seed", () => {
    const opts = {
      equationString: "y = a * b",
      inputs: [normalInput("a", 10, 0.1), normalInput("b", 2, 0.05)],
      samples: 20000,
    };
    const r1 = runMonteCarloPropagation({ ...opts, seed: 42 });
    const r2 = runMonteCarloPropagation({ ...opts, seed: 42 });
    const r3 = runMonteCarloPropagation({ ...opts, seed: 43 });
    expect(r1.standardUncertainty).toBe(r2.standardUncertainty);
    expect(r1.intervalLow).toBe(r2.intervalLow);
    expect(r1.standardUncertainty).not.toBe(r3.standardUncertainty);
  });

  it("adaptive mode stops once u is stable and stays within tolerance", () => {
    const result = runMonteCarloPropagation({
      equationString: "y = a + b",
      inputs: [normalInput("a", 0, 3), normalInput("b", 0, 4)],
      adaptive: true,
      batchSize: 20000,
      maxSamples: 200000,
      seed: 108,
    });
    expect(result.samplesUsed).toBeGreaterThanOrEqual(60000); // ≥ 3 batches
    expect(result.samplesUsed).toBeLessThanOrEqual(200000);
    expect(Math.abs(result.standardUncertainty - 5) / 5).toBeLessThan(0.02);
  });

  it("flags domain excursions instead of returning NaN", () => {
    // sqrt(x) with x ~ N(0.01, 1): trials reach x < 0 → complex result.
    expect(() =>
      runMonteCarloPropagation({
        equationString: "y = sqrt(x)",
        inputs: [normalInput("x", 0.01, 1)],
        samples: 1000,
        seed: 109,
      })
    ).toThrow(/domain/i);
  });
});

describe("buildMonteCarloInputs bridge", () => {
  const makeTmde = (id, quantity = 1) => ({
    id,
    quantity,
    variableType: "Length",
    measurementPoint: { value: 10, unit: "V" },
    floor: {
      high: 1,
      low: -1,
      unit: "V",
      symmetric: true,
      distribution: "1.7320508075688772",
    },
  });

  it("builds per-component inputs with the right u, shape, and additive nominal", () => {
    const { inputs, missingTypes } = buildMonteCarloInputs(
      { x: "Length" },
      [makeTmde("tmde-a", 2)]
    );
    expect(missingTypes).toHaveLength(0);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].symbol).toBe("x");
    expect(inputs[0].nominalBase).toBeCloseTo(20, 10); // 2 × 10 V, additive
    expect(inputs[0].components).toHaveLength(2); // one ±1 V floor per instance
    expect(inputs[0].components[0].distribution).toBe("rectangular");
    expect(inputs[0].components[0].u).toBeCloseTo(1 / Math.sqrt(3), 6);
  });

  it("agrees with the linear engine on a linear equation", () => {
    const { inputs } = buildMonteCarloInputs({ x: "Length" }, [makeTmde("t")]);
    const mc = runMonteCarloPropagation({
      equationString: "y = x",
      inputs,
      samples: N,
      seed: 110,
    });
    const linear = calculateDerivedUncertainty(
      "y = x",
      { x: "Length" },
      [makeTmde("t")],
      { value: 10, unit: "V" }
    );
    expect(mc.mean).toBeCloseTo(linear.nominalResult, 1);
    expect(
      Math.abs(mc.standardUncertainty - linear.combinedUncertaintyNative) /
        linear.combinedUncertaintyNative
    ).toBeLessThan(0.02);
  });

  it("reports unmapped variable types as missing", () => {
    const { inputs, missingTypes } = buildMonteCarloInputs(
      { x: "Length", w: "Weight" },
      [makeTmde("t")]
    );
    expect(inputs).toHaveLength(1);
    expect(missingTypes).toEqual(["Weight"]);
  });
});

describe("computeMcInputsHash trial-count semantics", () => {
  const base = {
    equationString: "y = x",
    variableMappings: { x: "Length" },
    correlations: {},
    tmdeTolerances: [],
    manualComponents: [],
  };

  it("treats a missing trial count as the default (back-compat with saved points)", () => {
    expect(computeMcInputsHash(base)).toBe(
      computeMcInputsHash({ ...base, maxSamples: DEFAULT_MC_MAX_SAMPLES })
    );
    expect(computeMcInputsHash(base)).toBe(
      computeMcInputsHash({ ...base, maxSamples: "not-a-number" })
    );
  });

  it("changes the hash when the trial count changes", () => {
    expect(computeMcInputsHash({ ...base, maxSamples: 100000 })).not.toBe(
      computeMcInputsHash({ ...base, maxSamples: 400000 })
    );
  });

  it("normalizes trial counts into a sane range", () => {
    expect(normalizeMcSampleCount(undefined)).toBe(DEFAULT_MC_MAX_SAMPLES);
    expect(normalizeMcSampleCount(0)).toBe(DEFAULT_MC_MAX_SAMPLES);
    expect(normalizeMcSampleCount(100000)).toBe(100000);
    expect(normalizeMcSampleCount(1)).toBe(10000);
    expect(normalizeMcSampleCount(1e9)).toBe(5000000);
  });
});
