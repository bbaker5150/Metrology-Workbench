import { describe, expect, it } from "vitest";
import { expandedInstrumentWidths } from "./useInstrumentTableLayout";
import { resizeTableColumn } from "../utils/fillTrailingColumn";

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

it("can reverse repeated drags without saving trailing fill or expanding neighboring columns", () => {
  const initial = { description: 300, range: 200, sync: 60 };
  const visible = { description: 300, range: 200, sync: 300 };
  const narrow = resizeTableColumn(initial, visible, 'range', -100, 80);
  expect(narrow).toEqual({ description: 300, range: 100, sync: 60 });
  const restored = resizeTableColumn(narrow, { description: 300, range: 100, sync: 400 }, 'range', 100, 80);
  expect(restored).toEqual(initial);
});
