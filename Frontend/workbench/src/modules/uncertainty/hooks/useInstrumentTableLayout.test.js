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

it("fills spare panel space with only the last column and preserves overflow widths", () => {
  const fitted = expandedInstrumentWidths([60, 200, 180], 1200, [], true);
  expect(fitted).toEqual([60, 200, 940]);
  expect(fitted[0] / fitted[1]).toBeCloseTo(60 / 200);
  expect(expandedInstrumentWidths([60, 200, 180], 300, [140], true)).toEqual([140, 200, 180]);
  expect(expandedInstrumentWidths([60, 200, 180], 1200, [140], true)).toEqual([140, 200, 860]);
});
