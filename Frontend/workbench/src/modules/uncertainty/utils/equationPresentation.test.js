import * as math from "mathjs";
import katex from "katex";
import { describe, expect, it } from "vitest";
import {
  equationTexOptions,
  equationVariableToTex,
  formatEquationVariableSymbol,
} from "./equationPresentation";
import { validateEquation } from "./equationValidation";

describe("equation presentation symbols", () => {
  it("renders lower- and upper-case Greek names distinctly", () => {
    expect(formatEquationVariableSymbol("theta")).toBe("θ");
    expect(formatEquationVariableSymbol("Theta")).toBe("Θ");
    expect(math.parse("theta + Theta").toTex(equationTexOptions)).toContain("\\theta");
    expect(math.parse("theta + Theta").toTex(equationTexOptions)).toContain("\\Theta");
  });

  it("subscripts an explicit underscore suffix but leaves camel-case names literal", () => {
    expect(formatEquationVariableSymbol("theta_Change")).toBe("θ_Change");
    expect(formatEquationVariableSymbol("thetaChange")).toBe("thetaChange");
    const tex = math.parse("theta_Change").toTex(equationTexOptions);
    expect(tex).toContain("\\theta");
    expect(tex).toContain("_{\\mathrm{Change}}");
    expect(validateEquation("Theta + theta_Change").variables).toEqual([
      "Theta",
      "theta_Change",
    ]);
  });

  it("renders the torque equation subscripts without changing its variables or calculation", () => {
    const expression = "R * F * (g / g_c) * a_b";
    const parsed = math.parse(expression);
    const tex = parsed.toTex(equationTexOptions);
    expect(tex).toContain("g_{c}");
    expect(tex).toContain("a_{b}");
    const markup = katex.renderToString(tex, { throwOnError: true, output: "mathml" });
    expect(markup.match(/<msub>/g)).toHaveLength(2);
    expect(validateEquation(expression).variables).toEqual(expect.arrayContaining(["R", "F", "g", "g_c", "a_b"]));
    expect(parsed.evaluate({ R: 2, F: 3, g: 10, g_c: 5, a_b: 4 })).toBe(48);
  });

  it.each(["alpha_beta", "Sensor_offset", "x_12", "x_low_range", "x_", "_offset"])("keeps %s valid in the math preview", name => {
    expect(() => katex.renderToString(math.parse(name).toTex(equationTexOptions), { throwOnError: true })).not.toThrow();
    if (name === "alpha_beta") expect(equationVariableToTex(name)).toBe("{\\alpha_{\\beta}}");
  });
});
