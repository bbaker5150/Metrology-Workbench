import { describe, expect, it } from "vitest";
import {
  errorDistributions,
  getAbsoluteLimits,
  getToleranceErrorSummary,
} from "./uncertaintyMath";

describe("getToleranceErrorSummary", () => {
  it("ignores a textual range label when calculating point tolerance", () => {
    const tolerance = {
      range: "100 V Range",
      min: 10.000000001,
      max: 100,
      unit: "V",
      reading: {
        high: 0.0045,
        low: -0.0045,
        unit: "%",
        symmetric: true,
        distribution: "1.7320508075688772",
      },
    };

    expect(
      getToleranceErrorSummary(tolerance, { value: 15, unit: "V" }),
    ).toBe("±0.000675 V");
  });

  it("displays symbolic units in point-list tolerance summaries", () => {
    const tolerance = {
      min: -328,
      max: 700,
      unit: "degF",
      floor: {
        high: 3,
        low: -3,
        unit: "degF",
        symmetric: true,
        distribution: "1.7320508075688772",
      },
    };

    expect(
      getToleranceErrorSummary(tolerance, { value: 5, unit: "degF" }),
    ).toBe("±3.00 °F");
  });

  it("displays symbolic units in absolute limits", () => {
    const tolerance = {
      floor: {
        high: 2,
        low: -2,
        unit: "uV",
        symmetric: true,
        distribution: "1.7320508075688772",
      },
    };

    expect(getAbsoluteLimits(tolerance, { value: 5, unit: "uV" })).toEqual({
      low: "3.000000 µV",
      high: "7.000000 µV",
    });
  });
});

describe("errorDistributions", () => {
  it("offers a normal distribution with k=1", () => {
    expect(errorDistributions).toContainEqual({
      value: "1.000",
      label: "Normal (k=1)",
    });
  });
});
