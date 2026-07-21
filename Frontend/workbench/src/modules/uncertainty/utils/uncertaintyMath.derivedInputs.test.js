import { describe, expect, it } from "vitest";
import { calculateDerivedUncertainty } from "./uncertaintyMath";

const makeTmde = (id) => ({
  id,
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

// A TMDE whose floor tolerance gives u = 1/√3 V at the given nominal.
const makeTmdeAt = (id, variableType, value) => ({
  id,
  variableType,
  measurementPoint: { value, unit: "V" },
  floor: {
    high: 1,
    low: -1,
    unit: "V",
    symmetric: true,
    distribution: "1.7320508075688772",
  },
});

describe("calculateDerivedUncertainty stationary-point handling", () => {
  it("errors (degenerate) when every input has zero sensitivity but nonzero uncertainty", () => {
    // d/dx (x-5)^2 = 2(x-5) = 0 at the nominal x = 5: a pure null measurement.
    const result = calculateDerivedUncertainty(
      "y = (x - 5)^2",
      { x: "Offset" },
      [makeTmdeAt("tmde-x", "Offset", 5)],
      { value: 0, unit: "V" },
    );

    expect(result.degenerate).toBe(true);
    expect(result.error).toMatch(/stationary point/i);
    expect(result.combinedUncertaintyNative).toBeNaN();
  });

  it("keeps a healthy budget but warns on a zero-sensitivity input", () => {
    const result = calculateDerivedUncertainty(
      "y = w + (x - 5)^2",
      { w: "Length", x: "Offset" },
      [makeTmdeAt("tmde-w", "Length", 10), makeTmdeAt("tmde-x", "Offset", 5)],
      { value: 10, unit: "V" },
    );

    expect(result.error).toBeNull();
    // Only w contributes: u_c = u_w = 1/√3.
    expect(result.combinedUncertaintyNative).toBeCloseTo(Math.sqrt(1 / 3), 8);
    const xItem = result.breakdown.find((b) => b.variable === "x");
    expect(xItem.nonlinearityWarning).toMatch(/zero first-order sensitivity/i);
    const wItem = result.breakdown.find((b) => b.variable === "w");
    expect(wItem.nonlinearityWarning).toBeNull();
    expect(result.warnings).toHaveLength(1);
  });

  it("warns when the second-order term is non-negligible against the first-order term", () => {
    // y = x² at x = 1 with u = 1/√3: first order |2x|·u ≈ 1.155, second order
    // ½·2·u² ≈ 0.333 → ~29% of first order, well past the 10% threshold.
    const result = calculateDerivedUncertainty(
      "y = x^2",
      { x: "Length" },
      [makeTmdeAt("tmde-x", "Length", 1)],
      { value: 1, unit: "V" },
    );

    expect(result.error).toBeNull();
    expect(result.combinedUncertaintyNative).toBeCloseTo(2 / Math.sqrt(3), 8);
    expect(result.breakdown[0].nonlinearityWarning).toMatch(/second-order/i);
  });

  it("does not error when u_c = 0 because no input carries uncertainty", () => {
    const result = calculateDerivedUncertainty(
      "y = (x - 5)^2",
      { x: "Offset" },
      [
        {
          id: "tmde-x",
          variableType: "Offset",
          measurementPoint: { value: 5, unit: "V" },
          // No tolerance components at all → u = 0 legitimately.
        },
      ],
      { value: 0, unit: "V" },
    );

    expect(result.degenerate).toBeUndefined();
    expect(result.error).toBeNull();
    expect(result.combinedUncertaintyNative).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("calculateDerivedUncertainty second-order Taylor data", () => {
  it("exposes per-input second-derivative terms and the aggregate summary", () => {
    // y = x² at x = 1 with u = 1/√3 (V unit is its own base: to_si = 1).
    // f″ = 2 ⇒ ½·f″·u² = 1/3; first-order u_c = 2u = 2/√3.
    const result = calculateDerivedUncertainty(
      "y = x^2",
      { x: "Length" },
      [makeTmdeAt("tmde-x", "Length", 1)],
      { value: 1, unit: "V" },
    );

    const item = result.breakdown[0];
    expect(item.secondDerivativeString).toBe("2");
    expect(item.secondDerivative_display).toBeCloseTo(2, 10);
    expect(item.secondOrderTerm_native).toBeCloseTo(1 / 3, 8);
    expect(item.secondOrderShift_native).toBeCloseTo(1 / 3, 8);

    // Aggregate: u² = (2/√3)² + (1/3)², mean shift Σ½f″u² = 1/3.
    expect(result.secondOrder).not.toBeNull();
    expect(result.secondOrder.combinedUncertaintyNative).toBeCloseTo(
      Math.sqrt(4 / 3 + 1 / 9),
      8,
    );
    expect(result.secondOrder.meanShiftNative).toBeCloseTo(1 / 3, 8);
  });

  it("carries a negative second derivative's sign into the mean shift", () => {
    // y = -(x²): f″ = -2 ⇒ shift = -u² = -1/3, |term| still 1/3.
    const result = calculateDerivedUncertainty(
      "y = -(x^2)",
      { x: "Length" },
      [makeTmdeAt("tmde-x", "Length", 1)],
      { value: -1, unit: "V" },
    );

    const item = result.breakdown[0];
    expect(item.secondOrderTerm_native).toBeCloseTo(1 / 3, 8);
    expect(item.secondOrderShift_native).toBeCloseTo(-1 / 3, 8);
    expect(result.secondOrder.meanShiftNative).toBeCloseTo(-1 / 3, 8);
  });

  it("reports no second-order summary for a linear equation", () => {
    const result = calculateDerivedUncertainty(
      "y = x",
      { x: "Length" },
      [makeTmde("tmde-a")],
      { value: 10, unit: "V" },
    );

    expect(result.error).toBeNull();
    expect(result.secondOrder).toBeNull();
    expect(result.breakdown[0].secondOrderTerm_native).toBe(0);
  });

  it("still provides second-order data on the degenerate (stationary) return", () => {
    const result = calculateDerivedUncertainty(
      "y = (x - 5)^2",
      { x: "Offset" },
      [makeTmdeAt("tmde-x", "Offset", 5)],
      { value: 0, unit: "V" },
    );

    expect(result.degenerate).toBe(true);
    const item = result.breakdown[0];
    expect(item.secondDerivativeString).toBeTruthy();
    expect(item.secondOrderTerm_native).toBeCloseTo(1 / 3, 8);
    expect(result.secondOrder).not.toBeNull();
    expect(result.secondOrder.combinedUncertaintyNative).toBeCloseTo(1 / 3, 8);
  });
});

describe("calculateDerivedUncertainty input contributors", () => {
  it("rejects a force-per-length equation labeled as torque", () => {
    const result = calculateDerivedUncertainty(
      "y = w / l",
      { l: "Length", w: "Weight" },
      [],
      {
        value: 0.5,
        unit: "in-ozf",
        variableNominals: {
          l: { value: 1, unit: "in" },
          w: { value: 2, unit: "ozf" },
        },
      },
      [],
      { strictUnitValidation: true },
    );

    expect(result.unitMismatch).toMatchObject({
      result: "Force / Length",
      target: "Torque",
      targetUnit: "in-ozf",
    });
    expect(result.error).toMatch(/w \* l/i);
    expect(result.nominalResult).toBeNaN();
  });

  it("accepts a force-times-length equation for a torque target", () => {
    const result = calculateDerivedUncertainty(
      "y = w * l",
      { l: "Length", w: "Weight" },
      [],
      {
        value: 0.5,
        unit: "in-ozf",
        variableNominals: {
          l: { value: 1, unit: "in" },
          w: { value: 2, unit: "ozf" },
        },
      },
      [],
      { strictUnitValidation: true },
    );

    expect(result.error).toBeNull();
    expect(result.nominalResult).toBeCloseTo(2, 5);
  });

  it("uses point-level variable nominals before TMDEs are added to input budgets", () => {
    const result = calculateDerivedUncertainty(
      "torque = w * l",
      { l: "Length", w: "Weight" },
      [],
      {
        value: 10,
        unit: "N-m",
        variableNominals: {
          w: { value: 5, unit: "N" },
          l: { value: 2, unit: "m" },
        },
      },
    );

    expect(result.error).toBeNull();
    expect(result.missingInputs).toBeUndefined();
    expect(result.nominalResult).toBeCloseTo(10, 10);
    expect(result.combinedUncertaintyNative).toBe(0);
    expect(result.breakdown).toHaveLength(2);
  });

  it("additively composes multiple TMDEs assigned to one derived input", () => {
    const result = calculateDerivedUncertainty(
      "y = x",
      { x: "Length" },
      [makeTmde("tmde-a"), makeTmde("tmde-b")],
      { value: 20, unit: "V" },
    );

    expect(result.error).toBeNull();
    // Two TMDEs each reading 10 compose ADDITIVELY into the variable: 10+10=20.
    // (Previously only the first TMDE's value was kept, giving 10.)
    expect(result.nominalResult).toBeCloseTo(20, 10);
    // Combined uncertainty is absolute, so the two independent ±1 V floors still
    // RSS to √(1/3 + 1/3) = √(2/3) regardless of the summed nominal.
    expect(result.combinedUncertaintyNative).toBeCloseTo(
      Math.sqrt(2 / 3),
      8,
    );
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].type).toBe("Length");
  });

  it("uses manually added TMDE budget components without equation assignments", () => {
    const result = calculateDerivedUncertainty(
      "y = x",
      { x: "Length" },
      [],
      {
        value: 2,
        unit: "m",
        variableNominals: { x: { value: 2, unit: "m" } },
      },
      [
        {
          id: "tmde-budget-1",
          variableType: "Length",
          value: 0.5,
          value_native: 0.5,
          unit_native: "m",
        },
      ],
    );

    expect(result.error).toBeNull();
    expect(result.nominalResult).toBeCloseTo(2, 10);
    expect(result.combinedUncertaintyNative).toBeCloseTo(0.5, 10);
  });
});
