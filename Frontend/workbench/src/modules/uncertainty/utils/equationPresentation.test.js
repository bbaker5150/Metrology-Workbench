import * as math from "mathjs";
import { describe, expect, it } from "vitest";
import {
  equationTexOptions,
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

  it("joins an explicit underscore suffix but leaves camel-case names literal", () => {
    expect(formatEquationVariableSymbol("theta_Change")).toBe("θChange");
    expect(formatEquationVariableSymbol("thetaChange")).toBe("thetaChange");
    const tex = math.parse("theta_Change").toTex(equationTexOptions);
    expect(tex).toContain("\\theta");
    expect(tex).toContain("\\mathrm{Change}");
    expect(validateEquation("Theta + theta_Change").variables).toEqual([
      "Theta",
      "theta_Change",
    ]);
  });
});
