import { describe, it, expect } from "vitest";
import { syncPointTolerances } from "./pointToleranceSync";
const range = (id, unit, high) => ({ id, unit, min: 0, max: 10, tolerances: { floor: { high, low: -high, unit } } });
const uut = ranges => ({ id: "u", instrument: { functions: [{ id: "f", name: "Electrical", ranges }] } });
const point = (id, unit, source) => ({ id, associatedUutIds: ["u"], testPointInfo: { parameter: { value: 5, unit } }, uutTolerance: source });
describe("live UUT tolerance snapshots", () => {
  it("refreshes all matching points and fills absent tolerances while preserving other units and manual specifications", () => {
    const before = { uuts: [uut([range("v", "V", 1), range("a", "A", 2)])], testPoints: [
      point(1, "V", { rangeId: "v", includeResolutionInBudget: false }),
      point(2, "V", null), point(3, "A", { rangeId: "a" }),
      point(4, "V", { floor: { high: 7, unit: "V" } }),
    ] };
    const after = syncPointTolerances({ ...before, uuts: [uut([range("v", "V", 3), range("a", "A", 2)])] }, before);
    expect(after.testPoints[0].uutTolerance.tolerances.floor.high).toBe(3);
    expect(after.testPoints[0].uutTolerance.includeResolutionInBudget).toBe(false);
    expect(after.testPoints[1].uutTolerance.tolerances.floor.high).toBe(3);
    expect(after.testPoints[2].uutTolerance.tolerances.floor.high).toBe(2);
    expect(after.testPoints[3]).toBe(before.testPoints[3]);
    expect(syncPointTolerances(after, after)).toBe(after);
  });
  it("clears removed source ranges rather than keeping stale tolerances or selecting another unit", () => {
    const before = { uuts: [uut([range("v", "V", 1)])], testPoints: [point(1, "V", { rangeId: "v" })] };
    const after = syncPointTolerances({ ...before, uuts: [uut([range("a", "A", 2)])] }, before);
    expect(after.testPoints[0].uutTolerance).toBeNull();
  });
});
