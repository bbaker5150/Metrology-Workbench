import { describe, expect, it } from "vitest";
import {
  unitSystem,
  unitCategories,
  getUnitDisplayLabel,
} from "./uncertaintyMath";

// Regression coverage for the SCCM/inWa unit families so their conversion
// factors, category membership, and display labels do not silently drift.
describe("standard flow units", () => {
  it("registers SCCM and relatives under the Flow quantity", () => {
    ["sccm", "slpm", "scfh", "scfm"].forEach((u) => {
      expect(unitSystem.getQuantity(u)).toBe("Flow");
      expect(unitCategories.Flow).toContain(u);
    });
  });

  it("converts standard flow units to base SI (m^3/s)", () => {
    // 1 SCCM = 1 cm^3/min = 1e-6 m^3 / 60 s.
    expect(unitSystem.toBaseUnit(1, "sccm")).toBeCloseTo(1e-6 / 60, 12);
    // 1 SLPM = 1 L/min.
    expect(unitSystem.toBaseUnit(1, "slpm")).toBeCloseTo(
      unitSystem.toBaseUnit(1, "L/min"),
      12
    );
    // 1 SCFM equals 1 ft^3/min (same factor as cfm).
    expect(unitSystem.toBaseUnit(1, "scfm")).toBeCloseTo(
      unitSystem.toBaseUnit(1, "cfm"),
      12
    );
    // 1 SCFH = 1 SCFM / 60.
    expect(unitSystem.toBaseUnit(60, "scfh")).toBeCloseTo(
      unitSystem.toBaseUnit(1, "scfm"),
      9
    );
  });

  it("supports metric-scaled GPM units", () => {
    expect(unitSystem.getQuantity("mgpm")).toBe("Flow");
    expect(unitCategories.Flow).toContain("mgpm");
    expect(unitSystem.toBaseUnit(1, "mgpm")).toBeCloseTo(
      unitSystem.toBaseUnit(0.001, "gpm"),
      14
    );
    expect(unitSystem.toBaseUnit(1, "kgpm")).toBeCloseTo(
      unitSystem.toBaseUnit(1000, "gpm"),
      10
    );
  });

  it("shows SCCM-family units uppercase", () => {
    expect(getUnitDisplayLabel("sccm")).toBe("SCCM");
    expect(getUnitDisplayLabel("scfm")).toBe("SCFM");
  });
});

describe("water-column pressure units", () => {
  it("registers inWa and relatives under the Pressure quantity", () => {
    ["inWa", "ftH2O", "cmH2O", "mmH2O"].forEach((u) => {
      expect(unitSystem.getQuantity(u)).toBe("Pressure");
      expect(unitCategories.Pressure).toContain(u);
    });
  });

  it("treats inWa as the same physical unit as inH2O", () => {
    expect(unitSystem.toBaseUnit(1, "inWa")).toBeCloseTo(
      unitSystem.toBaseUnit(1, "inH2O"),
      9
    );
  });

  it("keeps water-column units internally consistent", () => {
    // 1 ftH2O = 12 inH2O.
    expect(unitSystem.toBaseUnit(1, "ftH2O")).toBeCloseTo(
      unitSystem.toBaseUnit(12, "inH2O"),
      1
    );
    // 1 cmH2O = 10 mmH2O.
    expect(unitSystem.toBaseUnit(1, "cmH2O")).toBeCloseTo(
      unitSystem.toBaseUnit(10, "mmH2O"),
      9
    );
  });

  it("renders chemical subscripts for water-column labels", () => {
    expect(getUnitDisplayLabel("inH2O")).toBe("inH₂O");
    expect(getUnitDisplayLabel("mmH2O")).toBe("mmH₂O");
  });
});
