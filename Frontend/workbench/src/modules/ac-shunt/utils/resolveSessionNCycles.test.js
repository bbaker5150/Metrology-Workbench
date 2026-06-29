import { describe, it, expect } from "vitest";
import { resolveSessionNCycles } from "./resolveSessionNCycles";

const pt = (fwdN, revN) => ({
  forward: fwdN == null ? null : { settings: { n_cycles: fwdN } },
  reverse: revN == null ? null : { settings: { n_cycles: revN } },
});

describe("resolveSessionNCycles", () => {
  it("returns the fallback when no point has a value", () => {
    expect(resolveSessionNCycles([], 7)).toBe(7);
    expect(resolveSessionNCycles([pt(null, null)], 7)).toBe(7);
    expect(resolveSessionNCycles(undefined, null)).toBeNull();
  });

  it("uses the first established value (Forward wins when set)", () => {
    expect(resolveSessionNCycles([pt(12, 15)], null)).toBe(12);
  });

  it("falls back to Reverse when Forward is unset", () => {
    expect(resolveSessionNCycles([pt(null, 12)], null)).toBe(12);
  });

  it("is the single source of truth across multiple points", () => {
    // Reverse of the first point is the earliest established value, so every
    // direction/point should resolve to it (12), never the default 15.
    const points = [pt(null, 12), pt(15, 15)];
    expect(resolveSessionNCycles(points, 15)).toBe(12);
  });

  it("ignores invalid / below-minimum values", () => {
    expect(resolveSessionNCycles([pt("abc", 12)], null)).toBe(12);
    expect(resolveSessionNCycles([pt(1, 12)], null)).toBe(12); // 1 < min(2)
  });
});
