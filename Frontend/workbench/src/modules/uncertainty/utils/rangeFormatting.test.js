import { describe, expect, it } from "vitest";
import { formatRangeLabel } from "./rangeFormatting";

describe("formatRangeLabel", () => {
  it("does not repeat a unit already included in the range name", () => {
    expect(formatRangeLabel({ range: "100 V", unit: "V" })).toBe("100 V");
    expect(formatRangeLabel({ range: "100V Range", unit: "V" })).toBe(
      "100V Range",
    );
  });

  it("adds the unit when the range name does not include it", () => {
    expect(formatRangeLabel({ range: "100", unit: "V" })).toBe("100 V");
  });

  it("displays symbolic unit labels", () => {
    expect(formatRangeLabel({ min: -328, max: 700, unit: "degF" })).toBe(
      "-328 to 700 °F",
    );
    expect(formatRangeLabel({ range: "-328 to 700 degF", unit: "degF" })).toBe(
      "-328 to 700 °F",
    );
  });

  it("formats bounded and unspecified ranges clearly", () => {
    expect(formatRangeLabel({ min: 10, max: 100, unit: "V" })).toBe(
      "10 to 100 V",
    );
    expect(formatRangeLabel({ unit: "V" })).toBe("Full Range");
  });

  it("can prefer numeric bounds over an explicit range name", () => {
    expect(
      formatRangeLabel(
        { range: "100 V", min: 10, max: 100, unit: "V" },
        { preferBounds: true },
      ),
    ).toBe("10 to 100 V");
  });

  it("uses the same bounded format for UUT and TMDE range selectors", () => {
    const range = {
      range: "100 V Range",
      min: 100.000000001,
      max: 1000,
      unit: "V",
    };

    expect(formatRangeLabel(range, { preferBounds: true })).toBe(
      "100.000000001 to 1000 V",
    );
  });
});
