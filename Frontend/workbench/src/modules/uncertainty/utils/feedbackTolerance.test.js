import { describe, expect, it } from "vitest";
import { calculateUncertaintyFromToleranceObject, getAbsoluteLimits, getToleranceSummary, unitSystem, getUnitDisplayLabel } from "./uncertaintyMath";
import { SI_PREFIX_OPTIONS } from "./siPrefixes";
import { getBudgetComponentsFromTolerance } from "../features/analysis/utils/budgetUtils";

const term = (high, unit, extra = {}) => ({ high, low: -high, unit, distribution: "1.732", symmetric: true, ...extra });
const tolerance = { whicheverIsGreater: true, reading: term(1, "%"), range: term(3, "%", { value: 10 }), floor: term(10, "mV") };

describe("whichever is greater", () => {
  it("chooses FS at a low indication and IV at a high indication, rather than their sum", () => {
    for (const [value, expected] of [[2, .3], [50, .5], [-50, .5]]) {
      const point = { value, unit: "V" };
      const result = calculateUncertaintyFromToleranceObject(tolerance, point);
      expect(result.breakdown).toHaveLength(1);
      expect(Number(getAbsoluteLimits(tolerance, point).rawHigh)).toBeCloseTo(value + expected, 12);
      const components = getBudgetComponentsFromTolerance(tolerance, point);
      expect(components).toHaveLength(1);
      expect(components[0].value_native).toBeCloseTo(expected / Math.sqrt(3), 12);
    }
  });
  it("preserves additive specifications and the authored alternatives", () => {
    expect(calculateUncertaintyFromToleranceObject({ ...tolerance, whicheverIsGreater: false }, { value: 2, unit: "V" }).breakdown).toHaveLength(3);
    expect(getToleranceSummary(tolerance)).toContain("whichever is greater");
    expect(tolerance.floor.high).toBe(10);
  });
  it("handles zero indication, nested tolerances, and dB alternatives", () => {
    expect(calculateUncertaintyFromToleranceObject({ tolerances: tolerance }, { value: 0, unit: "V" }).breakdown[0].absoluteHigh).toBeCloseTo(.3, 12);
    const nested = { max: 100, tolerances: { ...tolerance, range: term(3, "%") } };
    expect(getBudgetComponentsFromTolerance(nested, { value: 1, unit: "V" })[0].value_native).toBeCloseTo(3 / Math.sqrt(3), 12);
    expect(calculateUncertaintyFromToleranceObject(nested, { value: 1, unit: "V" }).breakdown[0].absoluteHigh).toBeCloseTo(4, 12);
    const db = { whicheverIsGreater: true, floor: term(.001, "V"), db: term(1, "dB", { multiplier: 20, ref: 1 }) };
    expect(calculateUncertaintyFromToleranceObject(db, { value: 1, unit: "V" }).breakdown[0].name).toBe("dB Value");
    expect(getBudgetComponentsFromTolerance(db, { value: 1, unit: "V" })).toHaveLength(1);
  });
});

describe("complete prefix families", () => {
  it.each(["V", "Ohm", "psi", "degC", "m^2", "L/min"])("provides all 21 ordered factors for %s", base => {
    const options = Object.entries(unitSystem.units).filter(([, def]) => def.prefixBase === base);
    for (const prefix of SI_PREFIX_OPTIONS) {
      const entry = options.find(([, def]) => def.prefixKey === prefix.key);
      expect(entry, `${prefix.label} ${base}`).toBeDefined();
      const [unit, definition] = entry;
      expect(definition.to_si / unitSystem.units[base].to_si / 10 ** prefix.power).toBeCloseTo(1, 12);
      expect(unitSystem.fromBaseUnit(unitSystem.toBaseUnit(2, unit), unit)).toBeCloseTo(2, 12);
    }
  });
  it("preserves old physical units and renders micro and ohm symbols", () => {
    expect(unitSystem.units["cm^2"].to_si).toBe(1e-4);
    expect(unitSystem.units.kg.to_si).toBe(1);
    expect(unitSystem.units.min.to_si).toBe(60);
    expect(getUnitDisplayLabel("uOhm")).toBe("µΩ");
    expect(SI_PREFIX_OPTIONS.map(p => p.power)).toEqual([24,21,18,15,12,9,6,3,2,1,0,-1,-2,-3,-6,-9,-12,-15,-18,-21,-24]);
  });
});
