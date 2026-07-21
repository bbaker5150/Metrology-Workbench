import { describe, expect, it } from "vitest";
import { assessTmdeCompatibility } from "./tmdeCompatibility";

describe("assessTmdeCompatibility", () => {
  it("accepts a matching unit family when the point is inside the range", () => {
    expect(
      assessTmdeCompatibility(
        { min: 0, max: 100, unit: "V" },
        { value: 15, unit: "V" },
      ),
    ).toEqual({ compatible: true, reason: "" });
  });

  it("converts compatible units before checking range bounds", () => {
    expect(
      assessTmdeCompatibility(
        { min: 0, max: 1, unit: "V" },
        { value: 500, unit: "mV" },
      ).compatible,
    ).toBe(true);
  });

  it("treats a unit-bearing specification without bounds as all values", () => {
    expect(
      assessTmdeCompatibility(
        { min: "", max: "", unit: "V" },
        { value: 1e12, unit: "V" },
      ),
    ).toEqual({ compatible: true, reason: "" });
  });

  it("rejects incompatible quantities and out-of-range values", () => {
    expect(
      assessTmdeCompatibility(
        { min: 0, max: 100, unit: "Ohm" },
        { value: 15, unit: "V" },
      ).compatible,
    ).toBe(false);
    expect(
      assessTmdeCompatibility(
        { min: 0, max: 10, unit: "V" },
        { value: 15, unit: "V" },
      ).compatible,
    ).toBe(false);
  });
});
