import { describe, expect, it } from "vitest";
import { evaluate, derivative, compile } from "./equationMath";
import {
  validateEquation,
  extractEquationVariables,
  stripEquationPrefix,
} from "./equationValidation";

it("preserves the micro sign through validation, evaluation and differentiation", () => {
  expect(validateEquation("µ * V + μ")).toMatchObject({ status: "ok", variables: ["µ", "V", "μ"] });
  const scope = { "µ": 2, V: 3, "μ": 4 };
  expect(evaluate("µ * V + μ", scope)).toBe(10);
  expect(compile("µ * V + μ").evaluate(scope)).toBe(10);
  expect(derivative("µ * V + μ", "µ").evaluate(scope)).toBe(3);
});

describe("stripEquationPrefix", () => {
  it("strips a result-name prefix and tolerates missing one", () => {
    expect(stripEquationPrefix("y = V / R")).toBe("V / R");
    expect(stripEquationPrefix("V / R")).toBe("V / R");
    expect(stripEquationPrefix("  P = V^2 / R  ")).toBe("V^2 / R");
    expect(stripEquationPrefix("")).toBe("");
    expect(stripEquationPrefix(null)).toBe("");
  });
});

describe("validateEquation — accepts sophisticated metrology equations", () => {
  const SOPHISTICATED = [
    // Air-buoyancy-corrected deadweight pressure.
    "m * g / A0 * (1 - rhoA / rhoM)",
    // Orifice-plate mass flow.
    "Cd * A0 * sqrt(2 * rho * dP) / sqrt(1 - beta^4)",
    // Callendar–Van Dusen (above 0 °C).
    "R0 * (1 + Ac * t + Bc * t^2)",
    // Three-wire thread pitch-diameter measurement (60° threads).
    "Mw - 3 * w + 0.866025 * Ptc",
    // Mismatch-corrected RF power ratio in dB.
    "10 * log((P1 / P2) * (1 - G1 * G2)^2) / log(10)",
    // Saturation vapor pressure (Magnus form): exp/ratio nesting.
    "6.112 * exp(17.62 * t / (243.12 + t))",
    // Two-resistor bridge with lead correction and trig phase term.
    "(Vs * Rx / (Rs + Rx) - Vl) * cos(theta) + Roff",
    // Deeply nested roots/powers.
    "sqrt(a^2 + (b * sin(c))^2 + nthRoot(d, 3)^2)",
    // Rational polynomial.
    "(k1 + k2 * x + k3 * x^2) / (1 + k4 * x)",
    // Exponential decay with offset.
    "A1 * exp(-t / tau1) + C0",
  ];

  SOPHISTICATED.forEach((expression) => {
    it(`accepts: ${expression}`, () => {
      const result = validateEquation(expression);
      expect(result.status).toBe("ok");
      expect(result.error).toBeNull();
      expect(result.variables.length).toBeGreaterThan(0);
      // All of these are linear-engine compatible.
      expect(result.nonDifferentiable).toEqual([]);
    });
  });

  it("accepts a 'y =' prefixed equation and reports the bare expression", () => {
    const result = validateEquation("P = V * Irms * cos(theta)");
    expect(result.status).toBe("ok");
    expect(result.expression).toBe("V * Irms * cos(theta)");
    expect(result.variables).toEqual(["V", "Irms", "theta"]);
  });
});

describe("validateEquation — rejects constructs that would break the engines", () => {
  const REJECTED = [
    ["x +", /does not parse/i],
    ["a ; b", /single expression|multiple statements/i],
    ["[1, 2, 3]", /matrices|arrays/i],
    ["{a: 1}", /matrices|arrays/i],
    ['concat("a", "b")', /text strings|not allowed/i],
    ["a > b", /true\/false/i],
    ["a and b", /true\/false/i],
    // '==' contains '=', so the editor-rule prefix strip leaves "= b",
    // which fails to parse — rejected either way.
    ["a == b", /does not parse/i],
    ["foo(x) + 2", /unknown function/i],
    ["sin * 2", /built-in mathjs function name/i],
    ["a[1] + 2", /indexing|not supported/i],
    ["1:10", /ranges/i],
  ];

  REJECTED.forEach(([expression, pattern]) => {
    it(`rejects: ${expression}`, () => {
      const result = validateEquation(expression);
      expect(result.status).toBe("invalid");
      expect(result.error).toMatch(pattern);
    });
  });

  it("treats 'f(x) = x^2' as its right-hand side (editor prefix rule)", () => {
    // The editor discards everything before the first '=' as the result
    // name, so a function-definition attempt degrades into a working
    // expression rather than a mathjs function assignment.
    const result = validateEquation("f(x) = x^2");
    expect(result.status).toBe("ok");
    expect(result.expression).toBe("x^2");
    expect(result.variables).toEqual(["x"]);
  });

  it("rejects an equation that evaluates to a boolean through a function", () => {
    const result = validateEquation("isPositive(x)");
    expect(result.status).toBe("invalid");
    expect(result.error).toMatch(/true\/false|non-numeric/i);
  });

  it("treats empty input as 'empty', not an error", () => {
    expect(validateEquation("").status).toBe("empty");
    expect(validateEquation("y = ").status).toBe("empty");
  });
});

describe("validateEquation — warnings", () => {
  it("warns when a symbol is shadowed by a mathjs constant (phi, tau)", () => {
    const result = validateEquation("L * sin(phi)");
    expect(result.status).toBe("ok");
    // phi is mathjs's golden ratio — NOT extracted as a variable.
    expect(result.variables).toEqual(["L"]);
    expect(result.warnings.join(" ")).toMatch(/phi.*constant/i);
  });

  it("warns when the equation has no variables at all", () => {
    const result = validateEquation("2 * pi * 60");
    expect(result.status).toBe("ok");
    expect(result.variables).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/no input variables/i);
  });

  it("flags non-differentiable equations as Monte Carlo-only", () => {
    // mathjs has no symbolic derivative for max(); abs() it CAN handle.
    const result = validateEquation("max(x1, x2)");
    expect(result.status).toBe("ok");
    expect(result.nonDifferentiable.sort()).toEqual(["x1", "x2"]);
    expect(result.warnings.join(" ")).toMatch(/monte carlo/i);

    const differentiable = validateEquation("abs(x1 - x2)");
    expect(differentiable.status).toBe("ok");
    expect(differentiable.nonDifferentiable).toEqual([]);
  });

  it("warns (not errors) on probe-point domain failures", () => {
    // log(x - 5) fails at all probe values (1, 0.5, 2) but is fine at x = 10.
    const result = validateEquation("log(x - 5)");
    expect(result.status).toBe("ok");
    expect(result.warnings.join(" ")).toMatch(/test values|domain/i);
  });
});

describe("extractEquationVariables — editor-rule parity", () => {
  it("drops mathjs namespace symbols and never treats function names as variables", () => {
    expect(extractEquationVariables("V * Irms * cos(theta)")).toEqual([
      "V",
      "Irms",
      "theta",
    ]);
    // `i`, `pi`, `e` are constants; `sqrt` is a call.
    expect(extractEquationVariables("sqrt(x) + pi + e")).toEqual(["x"]);
  });
});

it("keeps Greek symbols in the equation input order", () => {
  expect(extractEquationVariables("θ * V + µ + μ + θ + Δ")).toEqual(["θ", "V", "µ", "μ", "Δ"]);
  expect(validateEquation("θ * V + μ + Δ")).toMatchObject({ status: "ok", variables: ["θ", "V", "μ", "Δ"] });
});

it("capital E is an input while lowercase e remains Euler's constant", () => {
  expect(extractEquationVariables("E/R + e")).toEqual(["E", "R"]);
  expect(validateEquation("E/R")).toMatchObject({ status: "ok", variables: ["E", "R"], warnings: [] });
});
