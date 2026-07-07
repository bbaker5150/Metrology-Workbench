import { describe, expect, it } from "vitest";
import { makeFunctionKey } from "../../../utils/functionGrouping";
import { rangeIsBlank, resolveUutRangeHelper } from "./UncertaintyPanel";

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

describe("resolveUutRangeHelper for derived input assignments", () => {
  it("uses the variable nominal to select a compatible TMDE range when the variable name is not a real function", () => {
    const tmde = {
      id: "tmde-temp",
      instrument: {
        functions: [
          {
            id: "fn-v",
            name: "DC Voltage",
            unit: "V",
            ranges: [
              {
                id: "range-v",
                min: "0",
                max: "10",
                unit: "V",
                tolerances: {},
              },
            ],
          },
          {
            id: "fn-t",
            name: "Temperature",
            unit: "degF",
            ranges: [
              {
                id: "range-t",
                min: "0",
                max: "500",
                unit: "degF",
                tolerances: {
                  floor: {
                    high: "1",
                    low: "-1",
                    unit: "degF",
                    symmetric: true,
                  },
                },
              },
            ],
          },
        ],
      },
    };

    const resolved = resolveUutRangeHelper(
      tmde,
      {},
      null,
      { value: "212", unit: "degF" },
      makeFunctionKey("b", "degF"),
    );

    expect(resolved.activeRange.id).toBe("range-t");
    expect(resolved.activeRange.floor.high).toBe("1");
  });
});
