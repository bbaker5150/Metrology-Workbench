import { describe, expect, it } from "vitest";
import { expandedInstrumentWidths } from "./useInstrumentTableLayout";

describe("temporary instrument column widths", () => {
  it("expands only the active columns and restores saved proportions", () => {
    const weights = [10, 10, 40, 40];
    expect(expandedInstrumentWidths(weights, 1200, [300, 360])).toEqual([300, 360, 480, 480]);
    expect(expandedInstrumentWidths(weights, 1200, [])).toEqual([120, 120, 480, 480]);
    expect(weights).toEqual([10, 10, 40, 40]);
  });
});
