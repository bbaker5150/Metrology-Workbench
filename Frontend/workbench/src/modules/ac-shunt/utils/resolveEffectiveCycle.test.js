import { describe, expect, it } from "vitest";
import { listAvailableCycles, resolveEffectiveCycle } from "./resolveEffectiveCycle";

// Chart-data shape the calibration chart and Calibration.jsx both consume:
// { datasets: [{ data: [{ cycle, ... }] }] }
const chart = (...datasets) => ({ datasets: datasets.map((data) => ({ data })) });

describe("listAvailableCycles", () => {
  it("collects the distinct cycle ordinals across every dataset, ascending", () => {
    const data = chart(
      [{ cycle: 3 }, { cycle: 1 }],
      [{ cycle: 2 }, { cycle: 3 }],
    );
    expect(listAvailableCycles(data)).toEqual([1, 2, 3]);
  });

  it("buckets untagged legacy readings into cycle 1 so older sessions still render", () => {
    const data = chart([{}, { cycle: null }, { cycle: undefined }, { cycle: 2 }]);
    expect(listAvailableCycles(data)).toEqual([1, 2]);
  });

  it("treats non-finite cycle values as cycle 1 rather than propagating NaN", () => {
    const data = chart([{ cycle: NaN }, { cycle: Infinity }, { cycle: "4" }]);
    // "4" is not a finite *number*, so it falls into the legacy bucket too.
    expect(listAvailableCycles(data)).toEqual([1]);
  });

  it("sorts numerically, not lexicographically", () => {
    const data = chart([{ cycle: 10 }, { cycle: 9 }, { cycle: 2 }]);
    expect(listAvailableCycles(data)).toEqual([2, 9, 10]);
  });

  it("returns an empty list for missing, empty, or malformed input", () => {
    expect(listAvailableCycles(undefined)).toEqual([]);
    expect(listAvailableCycles(null)).toEqual([]);
    expect(listAvailableCycles({})).toEqual([]);
    expect(listAvailableCycles({ datasets: [] })).toEqual([]);
    expect(listAvailableCycles({ datasets: [{}] })).toEqual([]);
  });
});

describe("resolveEffectiveCycle", () => {
  it("honors an explicit user selection that is still present", () => {
    expect(resolveEffectiveCycle(2, [1, 2, 3])).toBe(2);
  });

  it("falls back to the latest cycle when the selection is no longer available", () => {
    // e.g. the user had cycle 5 selected, then loaded a session with only 3.
    expect(resolveEffectiveCycle(5, [1, 2, 3])).toBe(3);
  });

  it("defaults to the latest cycle when nothing is selected", () => {
    // During a live run the latest cycle is the one currently being collected.
    expect(resolveEffectiveCycle(null, [1, 2, 3])).toBe(3);
    expect(resolveEffectiveCycle(undefined, [1, 2])).toBe(2);
  });

  it("uses the active live cycle before its first reading arrives", () => {
    expect(resolveEffectiveCycle(null, [1], 2)).toBe(2);
    expect(resolveEffectiveCycle(undefined, [], 3)).toBe(3);
  });

  it("keeps an explicit available user selection over the active cycle", () => {
    expect(resolveEffectiveCycle(1, [1], 2)).toBe(1);
  });

  it("falls back to cycle 1 when there is no data at all", () => {
    expect(resolveEffectiveCycle(null, [])).toBe(1);
    expect(resolveEffectiveCycle(7, [])).toBe(1);
  });

  it("treats cycle 0 as a real selection rather than a missing one", () => {
    // 0 is falsy but a legitimate ordinal — the guard is `!= null`, not truthiness.
    expect(resolveEffectiveCycle(0, [0, 1, 2])).toBe(0);
  });

  it("composes with listAvailableCycles for the live-run case", () => {
    const data = chart([{ cycle: 1 }], [{ cycle: 2 }]);
    expect(resolveEffectiveCycle(null, listAvailableCycles(data))).toBe(2);
  });
});
