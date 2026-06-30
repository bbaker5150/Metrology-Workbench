import { describe, expect, it } from "vitest";
import {
  getSpecRows,
  componentIsAsymmetric,
  toleranceTermMode,
} from "./UncertaintyPanel";

// The simplified ("read") tolerance/error-limit view renders getSpecRows(...)[0].
// It must show EVERY component the user entered, on one line, with consistent
// short labels (% IV / % FS) — regressions here dropped %FS when %IV was also
// present, or flipped between "% IV" and "of Indicated Value".
describe("getSpecRows compact spec line", () => {
  it("shows a single symmetric reading term", () => {
    const tol = { reading: { value: "2", high: "2", low: "-2", unit: "%" } };
    expect(getSpecRows(tol)[0]).toBe("± 2% IV");
  });

  it("keeps BOTH %IV and %FS terms on one line", () => {
    const tol = {
      reading: { value: "2", high: "2", low: "-2", unit: "%" },
      // %FS entered with only a high value (low blank → treated as symmetric).
      range: { value: "10", high: "1", low: "", unit: "%" },
    };
    expect(getSpecRows(tol)[0]).toBe("±(2% IV + 1% FS)");
  });

  it("includes an absolute floor term alongside the percent terms", () => {
    const tol = {
      reading: { high: "2", low: "-2", unit: "%" },
      range: { high: "1", low: "-1", unit: "%" },
      floor: { high: "0.5", low: "-0.5", unit: "V" },
    };
    expect(getSpecRows(tol)[0]).toBe("±(2% IV + 1% FS + 0.5 V)");
  });

  it("uses consistent % IV / % FS labels even when a term is asymmetric", () => {
    const tol = {
      reading: { high: "2", low: "-2", unit: "%" },
      range: { high: "1", low: "-0.5", unit: "%" },
    };
    const line = getSpecRows(tol)[0];
    expect(line).toContain("% IV");
    expect(line).toContain("% FS");
    // No component is dropped and the old "of Indicated Value" wording is gone.
    expect(line).not.toContain("Indicated Value");
    expect(line).toBe("±2% IV + (+1/-0.5)% FS");
  });

  it("falls back to a placeholder when nothing is set", () => {
    expect(getSpecRows({})[0]).toBe("Not Set");
    expect(getSpecRows(null)[0]).toBe("-");
  });
});

// The tolerance editor shows ONE ± input for a symmetric tolerance and two
// (+ / −) inputs when the limits genuinely differ — including a true single-
// sided (unilateral) tolerance like +1/-0. componentIsAsymmetric drives that.
describe("componentIsAsymmetric", () => {
  it("treats mirrored ± limits as symmetric (one input)", () => {
    expect(componentIsAsymmetric({ high: "1", low: "-1" })).toBe(false);
  });

  it("treats a blank/missing low limit as symmetric (mirrors to ±)", () => {
    expect(componentIsAsymmetric({ high: "1", low: "" })).toBe(false);
    expect(componentIsAsymmetric({ high: "1" })).toBe(false);
  });

  it("flags asymmetric bilateral limits as two-sided", () => {
    expect(componentIsAsymmetric({ high: "1", low: "-0.5" })).toBe(true);
  });

  it("flags a true single-sided (unilateral) +n/-0 tolerance as two-sided", () => {
    expect(componentIsAsymmetric({ high: "1", low: "0" })).toBe(true);
    expect(componentIsAsymmetric({ high: "0", low: "-1" })).toBe(true);
  });

  it("is symmetric when nothing is entered yet", () => {
    expect(componentIsAsymmetric({ high: "", low: "" })).toBe(false);
    expect(componentIsAsymmetric({})).toBe(false);
  });
});

// The three-way tolerance shape control picks its layout from toleranceTermMode.
describe("toleranceTermMode", () => {
  it("classifies a mirrored ± value as symmetric", () => {
    expect(toleranceTermMode({ high: "1", low: "-1" })).toBe("symmetric");
    expect(toleranceTermMode({ high: "1", low: "" })).toBe("symmetric");
    expect(toleranceTermMode({})).toBe("symmetric");
  });

  it("classifies a unilateral +n/-0 or +0/-n as single-sided", () => {
    expect(toleranceTermMode({ high: "1", low: "0" })).toBe("single");
    expect(toleranceTermMode({ high: "0", low: "-1" })).toBe("single");
  });

  it("classifies two unequal non-zero limits as asymmetric", () => {
    expect(toleranceTermMode({ high: "1", low: "-0.5" })).toBe("asymmetric");
  });
});
