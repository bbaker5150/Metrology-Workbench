import { describe, it, expect } from "vitest";
import { validateInstrumentSpecifications } from "./instrumentValidation";
import { unitCategories, unitSystem, getUnitDisplayLabel } from "./uncertaintyMath";
const validate = range => validateInstrumentSpecifications({ functions: [{ name: "Length", unit: "m", ranges: [range] }] });
describe("instrument specification validation", () => {
  it("accepts intentional all-values specifications and zero resolution", () => {
    expect(validate({ min: "", max: "", resolution: 0 })).toEqual([]);
    expect(validate({ min: -5, max: 0 })).toEqual([]);
  });
  it("rejects partial ranges, reversed bounds, invalid numbers and distributions", () => {
    expect(validate({ min: 0, max: "" }).join()).toContain("both numeric bounds");
    expect(validate({ min: 2, max: 1 }).join()).toContain("minimum");
    expect(validate({ resolution: "bad", resolutionDistribution: "bad" })).toHaveLength(2);
    expect(validate({ tolerances: { reading: { value: "bad" } } }).join()).toContain("numeric");
    expect(validate({ unit: "bogus" }).join()).toContain("range unit");
    expect(validateInstrumentSpecifications({ functions: [{ name: "", unit: "" }] })).toHaveLength(2);
  });
});
it("categorizes every registered unit by quantity and keeps gravity distinct from mass", () => {
  const all = new Set(Object.values(unitCategories).flat());
  expect(Object.keys(unitSystem.units).filter(unit => !all.has(unit))).toEqual([]);
  expect(unitCategories.Acceleration).toContain("G_accel");
  expect(unitCategories.Mass).toContain("g");
  expect(unitCategories.Area).toContain("in^2");
  expect(getUnitDisplayLabel("in^2")).toBe("in\u00b2");
});
