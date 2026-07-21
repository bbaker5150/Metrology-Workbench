import { describe, expect, it } from "vitest";
import {
  unitSystem,
  convertToPPM,
  convertPpmToUnit,
  calculateUncertaintyFromToleranceObject,
} from "./uncertaintyMath";

describe("ppb ratio unit", () => {
  it("is a known relative unit in the unit system", () => {
    expect(unitSystem.units.ppb).toEqual({ to_si: 1e-9, quantity: "Ratio" });
  });

  it("convertToPPM treats ppb as relative (1 ppm = 1000 ppb)", () => {
    expect(convertToPPM(5000, "ppb", 10, "V")).toBeCloseTo(5, 9);
    // Independent of nominal — ppb is purely relative.
    expect(convertToPPM(5000, "ppb", 999, "V")).toBeCloseTo(5, 9);
  });

  it("convertPpmToUnit converts ppm back to ppb", () => {
    expect(convertPpmToUnit(5, "ppb", { value: 10, unit: "V" })).toBeCloseTo(
      5000,
      6,
    );
  });

  it("scales an Indicated Value tolerance expressed in ppb with the reading", () => {
    // 1000 ppb of 10 V = 1e-5 V half-span; rectangular k=√3.
    const tolerance = {
      reading: {
        high: 1000,
        low: -1000,
        unit: "ppb",
        distribution: "1.7320508075688772",
        symmetric: true,
      },
    };

    const result = calculateUncertaintyFromToleranceObject(tolerance, {
      value: 10,
      unit: "V",
    });

    // 1000 ppb == 1 ppm half-span, so the tolerance resolves to ~1 ppm.
    expect(result.totalToleranceForTar).toBeCloseTo(1, 6);
    expect(result.breakdown[0].ppm).toBeCloseTo(1, 6);
  });

  it("keeps relative tolerance limits ordered for a negative indication", () => {
    const tolerance = {
      reading: {
        high: 1,
        low: -1,
        unit: "%",
        distribution: "1.7320508075688772",
        symmetric: true,
      },
    };

    const result = calculateUncertaintyFromToleranceObject(tolerance, {
      value: -2,
      unit: "V",
    });

    expect(result.breakdown[0].absoluteLow).toBeCloseTo(-2.02, 12);
    expect(result.breakdown[0].absoluteHigh).toBeCloseTo(-1.98, 12);
    expect(result.breakdown[0].absoluteLow).toBeLessThan(
      result.breakdown[0].absoluteHigh,
    );
    expect(result.breakdown[0].ppm).toBeCloseTo(10000, 6);
  });
});
