import { describe, expect, it } from "vitest";
import { rangeIsBlank } from "./UncertaintyPanel";

// rangeIsBlank backs clear-to-delete: a range is removed only once BOTH bounds
// are cleared (a half-filled range stays put).

describe("rangeIsBlank (clear-to-delete detection)", () => {
  it("is true only when a range has no numeric bounds", () => {
    expect(rangeIsBlank({ min: "", max: "" })).toBe(true);
    expect(rangeIsBlank({ min: "1", max: "" })).toBe(false); // half-filled stays
    expect(rangeIsBlank({ min: "", max: "10" })).toBe(false);
    expect(rangeIsBlank({ min: "1", max: "10" })).toBe(false);
  });

  it("handles single-value ranges", () => {
    expect(rangeIsBlank({ isSingleValue: true, value: "" })).toBe(true);
    expect(rangeIsBlank({ isSingleValue: true, value: "30" })).toBe(false);
  });
});
