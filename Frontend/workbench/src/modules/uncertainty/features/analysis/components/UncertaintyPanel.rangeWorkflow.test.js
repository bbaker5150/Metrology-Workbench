import { describe, expect, it } from "vitest";
import { makeFunctionKey } from "../../../utils/functionGrouping";
import {
  getDeleteSelectionTarget,
  rangeIsBlank,
  removeRangeFromItem,
  removeSelectedRangesFromItem,
  resolveUutRangeHelper,
  sortRangesAscending,
  sortRangesInItem,
} from "./UncertaintyPanel";

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

describe("removeSelectedRangesFromItem", () => {
  it("removes a Ctrl/Cmd-selected batch, including the final range", () => {
    const item = {
      id: "uut-1",
      instrument: {
        ranges: [
          { id: "range-1", min: 0, max: 10 },
          { id: "range-2", min: 10, max: 20 },
          { id: "range-3", min: 20, max: 30 },
        ],
      },
    };

    const updated = removeSelectedRangesFromItem(item, ["range-1", "range-2"]);
    expect(updated.instrument.ranges.map((range) => range.id)).toEqual(["range-3"]);

    const lastRange = removeSelectedRangesFromItem(item, ["range-1", "range-2", "range-3"]);
    expect(lastRange.instrument.ranges).toHaveLength(1);
    expect(lastRange.instrument.ranges[0]).toEqual(
      expect.objectContaining({ min: "", max: "", tolerances: {} }),
    );
  });

  it("allows the only function-scoped range to be deleted", () => {
    const item = {
      id: "uut-2",
      instrument: {
        functions: [{ id: "fn-1", ranges: [{ id: "only", min: 0, max: 1 }] }],
      },
    };

    const updated = removeRangeFromItem(item, "only");
    expect(updated.instrument.functions[0].ranges).toHaveLength(1);
    expect(updated.instrument.functions[0].ranges[0]).toEqual(
      expect.objectContaining({ min: "", max: "", tolerances: {} }),
    );
  });
});

describe("range ordering", () => {
  it("sorts numeric bounds ascending and keeps incomplete rows last", () => {
    const ranges = [
      { id: "blank", min: "", max: "" },
      { id: "twenty", min: "20", max: "30" },
      { id: "zero", min: "0", max: "10" },
      { id: "ten", min: "10", max: "20" },
    ];

    expect(sortRangesAscending(ranges).map((range) => range.id)).toEqual([
      "zero",
      "ten",
      "twenty",
      "blank",
    ]);
  });

  it("sorts function-scoped ranges without mutating the original item", () => {
    const item = {
      id: "uut-1",
      instrument: {
        functions: [
          {
            id: "fn-1",
            ranges: [
              { id: "range-2", min: 10, max: 20 },
              { id: "range-1", min: 0, max: 10 },
            ],
          },
        ],
      },
    };

    const sorted = sortRangesInItem(item);
    expect(sorted).not.toBe(item);
    expect(sorted.instrument.functions[0].ranges.map((range) => range.id)).toEqual([
      "range-1",
      "range-2",
    ]);
    expect(item.instrument.functions[0].ranges.map((range) => range.id)).toEqual([
      "range-2",
      "range-1",
    ]);
  });
});

describe("getDeleteSelectionTarget", () => {
  it("prioritizes the last selected range over its active parent UUT", () => {
    expect(
      getDeleteSelectionTarget({
        lastSelectionTarget: "range",
        selectedRangeIds: { "uut:uut-1": ["range-2", "range-3"] },
        selectedUutIds: ["uut-1"],
      }),
    ).toBe("range");
  });

  it("does not fall back to deleting the parent after the range selection is cleared", () => {
    expect(
      getDeleteSelectionTarget({
        lastSelectionTarget: "range",
        selectedRangeIds: {},
        selectedUutIds: ["uut-1"],
      }),
    ).toBeNull();
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
