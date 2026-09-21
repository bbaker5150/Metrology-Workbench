import { expect, it } from "vitest";
import { normalizeSizingPreferences, physicalScopedZoom } from "./scopedZoom";
it("makes the compact Results geometry its 100% baseline without changing other surfaces", () => {
  expect(physicalScopedZoom("budget-results", 1)).toBe(.8);
  expect(physicalScopedZoom("budget-results:old-group", 1.25)).toBe(1);
  expect(physicalScopedZoom("budget-table", 1)).toBe(1);
});
it("preserves existing physical sizes and migrates saved results scales only once", () => {
  const old = { scopedZoomLevels: { "budget-results": .8, "budget-results:a": 1.2, "budget-table": .9 } };
  const current = normalizeSizingPreferences(old);
  expect(current.scopedZoomLevels).toEqual({ "budget-results": 1, "budget-results:a": 1.5, "budget-table": .9 });
  expect(normalizeSizingPreferences(current)).toBe(current);
  expect(old.scopedZoomLevels["budget-results"]).toBe(.8);
});
