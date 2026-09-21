// End-to-end robustness of the equation workflow: sophisticated user
// equations must flow validation → linear (GUM) engine → Monte Carlo engine
// without breaking, and the failure modes that CAN'T work must degrade into
// descriptive errors, never crashes or silent NaNs.

import { describe, expect, it } from "vitest";
import { validateEquation } from "./equationValidation";
import { calculateDerivedUncertainty } from "./uncertaintyMath";
import { buildMonteCarloInputs, runMonteCarloPropagation } from "./monteCarlo";

const RECT = "1.7320508075688772";

// A TMDE whose ± floor tolerance gives u = span/√3 at the given nominal.
const makeTmde = (variableType, value, span = null) => {
  // Default to a tolerance ~0.1% of the nominal so the linearization is good
  // and linear-vs-MC agreement is meaningful.
  const half = span ?? Math.max(Math.abs(value) * 1e-3, 1e-6);
  return {
    id: `tmde-${variableType}`,
    variableType,
    measurementPoint: { value, unit: "V" },
    floor: {
      high: half,
      low: -half,
      unit: "V",
      symmetric: true,
      distribution: RECT,
    },
  };
};

const runBothEngines = (expression, nominals, spans = {}) => {
  const variableMappings = {};
  const tmdes = [];
  Object.entries(nominals).forEach(([symbol, value]) => {
    variableMappings[symbol] = `T_${symbol}`;
    tmdes.push(makeTmde(`T_${symbol}`, value, spans[symbol] ?? null));
  });

  const linear = calculateDerivedUncertainty(
    expression,
    variableMappings,
    tmdes,
    { value: 1, unit: "V" },
    [],
  );

  const { inputs, missingTypes } = buildMonteCarloInputs(
    variableMappings,
    tmdes,
    [],
  );
  expect(missingTypes).toEqual([]);
  const mc = runMonteCarloPropagation({
    equationString: expression,
    inputs,
    samples: 60000,
    seed: 42,
    quantileCount: 101,
  });

  return { linear, mc };
};

describe("sophisticated equations run through BOTH engines and agree", () => {
  const CASES = [
    { name: "capital E electrical input", expression: "E/R", nominals: { E: 20, R: 4 } },
    {
      name: "buoyancy-corrected deadweight pressure",
      expression: "m * g * (1 - rhoA / rhoM) / Ap",
      nominals: { m: 10, g: 9.80665, rhoA: 1.2, rhoM: 8000, Ap: 0.000196 },
    },
    {
      name: "orifice mass flow (nested roots & 4th power)",
      expression: "Cd * Ao * sqrt(2 * rho * dP) / sqrt(1 - betaR^4)",
      nominals: { Cd: 0.62, Ao: 0.0005, rho: 998, dP: 25000, betaR: 0.5 },
    },
    {
      name: "Callendar–Van Dusen resistance",
      expression: "R0 * (1 + Ac * t + Bc * t^2)",
      nominals: { R0: 100, Ac: 3.9083e-3, Bc: -5.775e-7, t: 100 },
    },
    {
      name: "Magnus saturation vapor pressure (exp of a ratio)",
      expression: "6.112 * exp(17.62 * t / (243.12 + t))",
      nominals: { t: 23 },
    },
    {
      name: "mismatch-corrected attenuation in dB (log of products)",
      expression: "10 * log((P1 / P2) * (1 - G1 * G2)^2) / log(10)",
      nominals: { P1: 0.01, P2: 0.001, G1: 0.05, G2: 0.08 },
    },
    {
      name: "bridge output with trig phase and offset",
      expression: "(Vs * Rx / (Rs + Rx) - Vl) * cos(theta) + Roff",
      nominals: { Vs: 10, Rx: 1000, Rs: 1000, Vl: 2, theta: 0.5, Roff: 0.1 },
    },
    {
      name: "rational polynomial sensor model",
      expression: "(k1 + k2 * x + k3 * x^2) / (1 + k4 * x)",
      nominals: { k1: 0.5, k2: 1.2, k3: -0.04, k4: 0.01, x: 20 },
    },
  ];

  CASES.forEach(({ name, expression, nominals }) => {
    it(`${name}: validates, differentiates, and MC matches GUM`, () => {
      // 1. Validation passes with no hard error.
      const validation = validateEquation(expression);
      expect(validation.status).toBe("ok");
      expect(validation.nonDifferentiable).toEqual([]);

      // 2. Both engines produce finite, agreeing results.
      const { linear, mc } = runBothEngines(expression, nominals);
      expect(linear.error).toBeNull();
      expect(Number.isFinite(linear.combinedUncertaintyNative)).toBe(true);
      expect(linear.combinedUncertaintyNative).toBeGreaterThan(0);
      expect(Number.isFinite(mc.standardUncertainty)).toBe(true);

      // Mean ≈ f(nominals) and u within a few % (tight tolerances, smooth f).
      expect(
        Math.abs(mc.mean - linear.nominalResult) /
          Math.max(Math.abs(linear.nominalResult), 1e-12),
      ).toBeLessThan(0.01);
      expect(
        Math.abs(mc.standardUncertainty - linear.combinedUncertaintyNative) /
          linear.combinedUncertaintyNative,
      ).toBeLessThan(0.05);
    });
  });
});

describe("failure modes degrade gracefully (no crashes, no silent NaN)", () => {
  it("non-differentiable equation: linear engine reports an error, MC still works", () => {
    const expression = "max(x1, x2)";
    const validation = validateEquation(expression);
    expect(validation.status).toBe("ok");
    expect(validation.nonDifferentiable.sort()).toEqual(["x1", "x2"]);

    const variableMappings = { x1: "A", x2: "B" };
    const tmdes = [makeTmde("A", 10, 0.5), makeTmde("B", 10.1, 0.5)];

    const linear = calculateDerivedUncertainty(
      expression,
      variableMappings,
      tmdes,
      { value: 10, unit: "V" },
      [],
    );
    // Graceful: an error string, not a throw / NaN budget posing as real.
    expect(linear.error).toBeTruthy();

    const { inputs } = buildMonteCarloInputs(variableMappings, tmdes, []);
    const mc = runMonteCarloPropagation({
      equationString: expression,
      inputs,
      samples: 40000,
      seed: 7,
    });
    expect(Number.isFinite(mc.standardUncertainty)).toBe(true);
    expect(mc.mean).toBeGreaterThan(10);
  });

  it("domain violation under uncertainty: MC throws a descriptive error", () => {
    // sqrt(x) with x = 0.001 ± 0.01: trials reach negative x.
    const variableMappings = { x: "A" };
    const tmdes = [makeTmde("A", 0.001, 0.01)];
    const { inputs } = buildMonteCarloInputs(variableMappings, tmdes, []);
    expect(() =>
      runMonteCarloPropagation({
        equationString: "sqrt(x)",
        inputs,
        samples: 20000,
        seed: 7,
      }),
    ).toThrow(/domain/i);
  });

  it("stationary point: linear engine degenerates with an explanation, MC stands", () => {
    const expression = "(x - 5)^2";
    const variableMappings = { x: "A" };
    const tmdes = [makeTmde("A", 5, 1)];

    const linear = calculateDerivedUncertainty(
      expression,
      variableMappings,
      tmdes,
      { value: 0, unit: "V" },
      [],
    );
    expect(linear.degenerate).toBe(true);

    const { inputs } = buildMonteCarloInputs(variableMappings, tmdes, []);
    const mc = runMonteCarloPropagation({
      equationString: expression,
      inputs,
      samples: 60000,
      seed: 7,
    });
    // One-sided output distribution: mean = E[(x-5)²] = u² = 1/3.
    expect(mc.mean).toBeCloseTo(1 / 3, 1);
    expect(mc.intervalLow).toBeGreaterThanOrEqual(0);
  });

  it("deep nesting and unary chains parse and propagate", () => {
    const expression = "sqrt(a^2 + (b * sin(c))^2 + nthRoot(d, 3)^2)";
    const validation = validateEquation(expression);
    expect(validation.status).toBe("ok");

    const { linear, mc } = runBothEngines(expression, {
      a: 3,
      b: 4,
      c: 0.7,
      d: 8,
    });
    expect(linear.error).toBeNull();
    expect(
      Math.abs(mc.standardUncertainty - linear.combinedUncertaintyNative) /
        linear.combinedUncertaintyNative,
    ).toBeLessThan(0.05);
  });
});
