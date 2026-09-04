import { describe, expect, it } from "vitest";
import { calculateAcDcDriftPpm } from "./LiveStabilityTracker";

describe("calculateAcDcDriftPpm", () => {
  it("reports signed drift from AC Open to AC Close in ppm", () => {
    expect(calculateAcDcDriftPpm(1, 1.000002)).toBeCloseTo(2, 8);
    expect(calculateAcDcDriftPpm(1, 0.999997)).toBeCloseTo(-3, 8);
  });

  it("does not report drift until both valid means exist", () => {
    expect(calculateAcDcDriftPpm(undefined, 1)).toBeNull();
    expect(calculateAcDcDriftPpm(0, 1)).toBeNull();
  });
});
