import { describe, expect, it, vi } from "vitest";
import { parse, derivative } from "./equationMath";
import { createDerivedEquationCache } from "./derivedEquationCache";
import { calculateDerivedUncertainty } from "./uncertaintyMath";

describe("derived equation programs", () => {
  it("reuses compilation and symbolic derivatives without retaining input values", () => {
    const cached = createDerivedEquationCache();
    const expression = "x^2 + x*y + sin(y)";
    const plan = cached(expression);
    const compile = vi.spyOn(plan.node, "compile");
    const first = plan.getDerivative("x");
    const second = plan.getDerivative("x", 2);
    for (let i = 1; i <= 100; i++) {
      const scope = { x: i / 10, y: -i / 20 };
      expect(cached(expression)).toBe(plan);
      expect(plan.evaluate(scope)).toBe(parse(expression).compile().evaluate(scope));
      expect(plan.getDerivative("x")).toBe(first);
      expect(plan.getDerivative("x", 2)).toBe(second);
      expect(first.compiled.evaluate(scope)).toBe(derivative(expression, "x").compile().evaluate(scope));
      expect(second.compiled.evaluate(scope)).toBe(2);
    }
    expect(compile).toHaveBeenCalledOnce();
  });

  it("bounds retention while keeping recently used equations warm", () => {
    const cached = createDerivedEquationCache(2);
    const first = cached("x");
    const second = cached("x^2");
    expect(cached("x")).toBe(first);
    cached("x^3");
    expect(cached("x")).toBe(first);
    expect(cached("x^2")).not.toBe(second);
  });

  it("refreshes propagated values, units, uncertainties and equation edits", () => {
    const calculate = (value, unit, uncertainty, expression = "x^2") =>
      calculateDerivedUncertainty(expression, { x: "Input" }, [], {
        unit: "V", variableNominals: { x: { value, unit } },
      }, [{ id: "u", variableType: "Input", value_native: uncertainty, unit_native: unit }]);
    const initial = calculate(2, "V", .1);
    expect(initial.nominalResult).toBe(4);
    expect(initial.combinedUncertaintyNative).toBeCloseTo(.4);
    const changed = calculate(3000, "mV", 200);
    expect(changed.nominalResult).toBe(9);
    expect(changed.combinedUncertaintyNative).toBeCloseTo(1.2);
    expect(changed.breakdown[0].secondDerivative_display).toBeCloseTo(.000002);
    expect(calculate(3, "V", .2, "x^3").nominalResult).toBe(27);
    expect(calculate(2, "V", .1)).toEqual(initial);
  });
});
