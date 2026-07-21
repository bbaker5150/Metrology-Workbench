import { describe, expect, test } from "vitest";
import { termUnboundedSide, toleranceUnboundedSide } from "./toleranceShape";

describe("termUnboundedSide", () => {
  test("explicit thresholdSide marker", () => {
    // bounded on high (≤ upper) => lower side open
    expect(termUnboundedSide({ high: "5", low: "", thresholdSide: "high" })).toBe("low");
    // bounded on low (≥ lower) => upper side open
    expect(termUnboundedSide({ high: "", low: "-5", thresholdSide: "low" })).toBe("high");
  });

  test("legacy +n/-0 data migrates to a threshold", () => {
    expect(termUnboundedSide({ high: "5", low: "0" })).toBe("low"); // open below
    expect(termUnboundedSide({ high: "0", low: "-5" })).toBe("high"); // open above
  });

  test("two-sided and blank terms are not thresholds", () => {
    expect(termUnboundedSide({ high: "5", low: "-5" })).toBe(""); // symmetric
    expect(termUnboundedSide({ high: "5", low: "-3" })).toBe(""); // asymmetric
    expect(termUnboundedSide({ high: "5", low: "" })).toBe(""); // blank low => symmetric
    expect(termUnboundedSide({})).toBe("");
  });
});

describe("toleranceUnboundedSide", () => {
  test("maps standalone workbook-style single-sided limits", () => {
    expect(
      toleranceUnboundedSide({
        singleSided: { direction: "high", measurement: "known", limit: "11" },
      }),
    ).toBe("low");
    expect(
      toleranceUnboundedSide({
        singleSided: { direction: "low", measurement: "unknown", limit: "9" },
      }),
    ).toBe("high");
  });

  test("finds a threshold term anywhere in the tolerance", () => {
    expect(toleranceUnboundedSide({ floor: { high: "16", low: "", thresholdSide: "high" } })).toBe("low");
    expect(toleranceUnboundedSide({ reading: { high: "1", low: "-1" }, floor: { high: "0", low: "-2" } })).toBe("high");
  });

  test("two-sided tolerances return ''", () => {
    expect(toleranceUnboundedSide({ reading: { high: "1", low: "-1" }, floor: { high: "2", low: "-2" } })).toBe("");
    expect(toleranceUnboundedSide({})).toBe("");
  });

  test("handles nested and array-wrapped shapes", () => {
    expect(toleranceUnboundedSide({ tolerances: { floor: { high: "5", low: "", thresholdSide: "high" } } })).toBe("low");
    expect(toleranceUnboundedSide([{ floor: { high: "0", low: "-5" } }])).toBe("high");
  });
});
