import { describe, expect, it } from "vitest";
import {
  DISTRIBUTION_NOT_SET,
  calculateUncertaintyFromToleranceObject,
  distributionDivisorValue,
  errorDistributions,
  getAbsoluteLimits,
  getToleranceErrorSummary,
} from "./uncertaintyMath";

describe("getToleranceErrorSummary", () => {
  it("converts a physical tolerance expressed in a different compatible unit", () => {
    const result = calculateUncertaintyFromToleranceObject(
      {
        min: 0,
        max: 1000,
        unit: "mg",
        floor: {
          high: 0.001,
          low: -0.001,
          unit: "lb",
          symmetric: true,
          distribution: "1.7320508075688772",
        },
      },
      { value: 500, unit: "mg" },
    );

    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].originalUnit).toBe("lb");
    expect(result.breakdown[0].absoluteHigh).toBeCloseTo(953.592, 4);
    expect(result.breakdown[0].absoluteLow).toBeCloseTo(46.408, 4);
  });

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
      rawLow: "3",
      rawHigh: "7",
    });
  });

  it("calculates nonzero limits around a zero-valued temperature point", () => {
    const tolerance = {
      floor: {
        high: 3,
        low: -3,
        unit: "degF",
        symmetric: true,
        distribution: "1.732",
      },
    };

    expect(getAbsoluteLimits(tolerance, { value: 0, unit: "degF" })).toEqual({
      low: "-3.000000 °F",
      high: "3.000000 °F",
      rawLow: "-3",
      rawHigh: "3",
    });
  });
});

describe("errorDistributions", () => {
  it("calculates legacy shape divisors with Risk 8.0 workbook precision", () => {
    expect(distributionDivisorValue("1.732")).toBe(Math.sqrt(3));
    expect(distributionDivisorValue("3.464")).toBe(Math.sqrt(12));
    expect(distributionDivisorValue("2.449")).toBe(Math.sqrt(6));
    expect(distributionDivisorValue("4.899")).toBe(Math.sqrt(24));
    expect(distributionDivisorValue("1.414")).toBe(Math.sqrt(2));
    expect(distributionDivisorValue("4.179")).toBe(4.178);
  });

  it("offers an explicit not-set option for unvalidated instrument specs", () => {
    expect(errorDistributions[0]).toEqual({
      value: DISTRIBUTION_NOT_SET,
      label: "Not Set",
    });
  });

  it("offers a normal distribution with k=1", () => {
    expect(errorDistributions).toContainEqual(expect.objectContaining({
      value: "1.000",
      shortLabel: "k = 1.000",
    }));
  });

  it("offers the resolution-specific triangular divisor", () => {
    expect(errorDistributions).toContainEqual(expect.objectContaining({
      value: "4.899",
      label: "Triangular (resolution)",
      shortLabel: "k = 4.899",
    }));
  });

  it("shows only the active absolute limit for a single-sided tolerance", () => {
    expect(
      getAbsoluteLimits(
        { singleSided: { direction: "low", limit: 1, unit: "V" } },
        { value: 2, unit: "V" },
      ),
    ).toEqual({
      low: "1.000000 V",
      high: "—",
      rawLow: "1",
      rawHigh: "—",
    });

    expect(
      getAbsoluteLimits(
        { singleSided: { direction: "high", limit: 3, unit: "V" } },
        { value: 2, unit: "V" },
      ),
    ).toEqual({
      low: "—",
      high: "3.000000 V",
      rawLow: "—",
      rawHigh: "3",
    });
  });
});
