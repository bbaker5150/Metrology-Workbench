import { describe, expect, it } from "vitest";
import {
  addRangeWithBound,
  rangeIsBlank,
  restoreRangeToItem,
} from "./UncertaintyPanel";

// Helpers backing the redesigned range workflow: ghost-row add
// (addRangeWithBound), clear-to-delete detection (rangeIsBlank), and the Undo
// toast restore (restoreRangeToItem).

const itemWithRanges = (ranges) => ({
  id: "uut-1",
  instrument: {
    id: "inst-1",
    functions: [{ id: "fn-1", name: "", unit: "V", ranges }],
  },
});

describe("addRangeWithBound (ghost-row materialize)", () => {
  it("adds a new range carrying the typed bound", () => {
    const item = itemWithRanges([
      { id: "r1", min: "1", max: "10", unit: "V", tolerances: {} },
    ]);
    const { item: updated, newRangeId } = addRangeWithBound(item, "r1", "min", "10");
    const ranges = updated.instrument.functions[0].ranges;
    expect(ranges).toHaveLength(2);
    const added = ranges.find((r) => r.id === newRangeId);
    expect(added).toBeTruthy();
    expect(added.min).toBe("10");
    expect(added.max).toBe("");
  });

  it("seeds the new range's tolerance component structure from the active range, blanked", () => {
    const item = itemWithRanges([
      {
        id: "r1",
        min: "1",
        max: "10",
        unit: "V",
        tolerances: { percentReading: { value: "0.5" }, floor: { value: "2" } },
      },
    ]);
    const { item: updated, newRangeId } = addRangeWithBound(item, "r1", "min", "10");
    const added = updated.instrument.functions[0].ranges.find((r) => r.id === newRangeId);
    // Same term keys, values blanked.
    expect(Object.keys(added.tolerances).sort()).toEqual(["floor", "percentReading"]);
    expect(added.tolerances.percentReading.value).toBe("");
    expect(added.tolerances.floor.value).toBe("");
  });
});

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

describe("restoreRangeToItem (Undo)", () => {
  it("re-inserts the removed range preserving its id and tolerance data", () => {
    const removed = {
      id: "r2",
      min: "10",
      max: "100",
      unit: "V",
      tolerances: { percentReading: { value: "0.5" } },
    };
    const item = itemWithRanges([
      { id: "r1", min: "1", max: "10", unit: "V", tolerances: {} },
    ]);
    const restored = restoreRangeToItem(item, "r1", removed);
    const ranges = restored.instrument.functions[0].ranges;
    expect(ranges).toHaveLength(2);
    const back = ranges.find((r) => r.id === "r2");
    expect(back).toBeTruthy();
    expect(back.min).toBe("10");
    expect(back.max).toBe("100");
    expect(back.tolerances.percentReading.value).toBe("0.5");
  });
});
