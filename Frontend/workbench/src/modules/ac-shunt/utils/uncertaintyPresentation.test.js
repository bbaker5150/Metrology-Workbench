import { describe, expect, it } from "vitest";
import {
  TYPE_A_COVERAGE_FACTOR,
  expandedTypeAUncertainty,
} from "./uncertaintyPresentation";

describe("expandedTypeAUncertainty", () => {
  it("uses the NIST conventional k=2 presentation factor", () => {
    expect(TYPE_A_COVERAGE_FACTOR).toBe(2);
    expect(expandedTypeAUncertainty(1.0276)).toBeCloseTo(2.0552, 10);
  });

  it("does not turn missing or invalid values into a reported interval", () => {
    expect(expandedTypeAUncertainty(null)).toBeNull();
    expect(expandedTypeAUncertainty(undefined)).toBeNull();
    expect(expandedTypeAUncertainty("not-a-number")).toBeNull();
  });
});
