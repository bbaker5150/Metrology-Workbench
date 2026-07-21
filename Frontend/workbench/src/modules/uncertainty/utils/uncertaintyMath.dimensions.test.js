import { describe, expect, it } from "vitest";
import { equationLibrary } from "./equationLibrary";
import {
  calculateDerivedUncertainty,
  validateEquationUnits,
} from "./uncertaintyMath";

const fixture = (targetUnit, variableUnits) => ({ targetUnit, variableUnits });

// Units reflect the physical quantities implied by each curated equation.
// Numeric coefficients are intentionally left unannotated, matching the 8.0
// workbook's Excel-formula workflow (e.g. 0.001 W in the dBm equation).
const LIBRARY_UNIT_FIXTURES = {
  "AC real power": fixture("W", { V: "V", Irms: "A", theta: "rad" }),
  "Resistance (Ohm's law)": fixture("Ohm", { V: "V", Idc: "A" }),
  "Voltage divider": fixture("V", { Vin: "V", R1: "Ohm", R2: "Ohm" }),
  "Power across a resistance": fixture("W", { V: "V", R: "Ohm" }),
  "Four-terminal resistance (lead-corrected)": fixture("Ohm", {
    V: "V", Idc: "A", Rlead: "Ohm",
  }),
  "Capacitive reactance": fixture("Ohm", { fr: "Hz", C: "F" }),
  "Inductive reactance": fixture("Ohm", { fr: "Hz", Lh: "H" }),
  "Power factor": fixture("%", { Preal: "W", V: "V", Irms: "A" }),
  "Attenuator output voltage": fixture("V", { Vin: "V", dB: "dB" }),
  "Thermal expansion": fixture("m", { L0: "m", alpha: "1/K", dT: "K" }),
  "Sine bar height": fixture("m", { L: "m", theta: "rad" }),
  "Three-wire thread pitch diameter": fixture("m", { Mw: "m", w: "m", Ptc: "m" }),
  "Length comparison (differential expansion)": fixture("m", {
    Ls: "m", dL: "m", alphaS: "1/K", dTs: "K", alphaU: "1/K", dTu: "K",
  }),
  "Angle from rise over run": fixture("rad", { rise: "m", run: "m" }),
  "Force from mass": fixture("N", { m: "kg", g: "m/s^2" }),
  Torque: fixture("N-m", { F: "N", L: "m" }),
  "Deadweight pressure": fixture("Pa", { F: "N", A: "m^2" }),
  "Conventional mass (air buoyancy)": fixture("kg", {
    mr: "kg", rhoA: "kg/m^3", rhoW: "kg/m^3",
  }),
  "Torque at an angle": fixture("N-m", { F: "N", Larm: "m", theta: "rad" }),
  "Hydrostatic head": fixture("Pa", { rho: "kg/m^3", g: "m/s^2", h: "m" }),
  "Deadweight pressure (buoyancy-corrected)": fixture("Pa", {
    m: "kg", g: "m/s^2", rhoA: "kg/m^3", rhoM: "kg/m^3", Ap: "m^2",
  }),
  "Orifice mass flow": fixture("kg/s", {
    Cd: "%", Ao: "m^2", rho: "kg/m^3", dP: "Pa", betaR: "%",
  }),
  "Volumetric flow (collected volume)": fixture("m^3/s", { Vol: "m^3", tElapsed: "s" }),
  "RTD temperature (linear)": fixture("K", { R: "Ohm", R0: "Ohm", alpha: "1/K" }),
  "Callendar–Van Dusen resistance (t ≥ 0 °C)": fixture("Ohm", {
    R0: "Ohm", Ac: "1/K", Bc: "1/K^2", t: "K",
  }),
  "Thermocouple temperature (linearized)": fixture("K", {
    emf: "V", emf0: "V", seebeck: "V/K",
  }),
  "Power in dBm": fixture("dB", { P: "W" }),
  "VSWR from reflection": fixture("%", { G: "%" }),
  "Return loss (dB)": fixture("dB", { G: "%" }),
  "Attenuation from power ratio (dB)": fixture("dB", { Pin: "W", Pout: "W" }),
  "Mismatch factor": fixture("%", { G1: "%", G2: "%" }),
  "Fractional frequency offset": fixture("%", { fMeas: "Hz", fRef: "Hz" }),
  "Period from frequency": fixture("s", { fMeas: "Hz" }),
  "Sound pressure level (dB SPL)": fixture("dB", { p: "Pa" }),
  "Accelerometer sensitivity": fixture("V/(m/s^2)", { Vout: "V", accel: "m/s^2" }),
  "Inverse-square illuminance": fixture("lx", { Iv: "cd", d: "m" }),
  "Refractive index (Snell)": fixture("%", { theta1: "rad", theta2: "rad" }),
  "Saturation vapor pressure (Magnus)": fixture("hPa", { t: "K" }),
  "Relative humidity from vapor pressures": fixture("%RH", { pv: "Pa", psat: "Pa" }),
  "Dilution concentration": fixture("ppmv", { C1: "ppmv", V1: "L", V2: "L" }),
  "Molar concentration": fixture("mol/L", { mSol: "kg", MW: "kg/mol", VolL: "L" }),
  "RMS from peak (sine)": fixture("V", { Vp: "V" }),
  "THD (first harmonics)": fixture("%", { h2: "V", h3: "V", h5: "V", V1: "V" }),
};

describe("8.0-compatible equation dimensional validation", () => {
  it("validates every equation shipped in the equation library", () => {
    const equations = equationLibrary.flatMap((area) => area.equations);
    expect(Object.keys(LIBRARY_UNIT_FIXTURES)).toHaveLength(equations.length);

    equations.forEach((equation) => {
      const units = LIBRARY_UNIT_FIXTURES[equation.name];
      expect(units, `missing unit fixture for ${equation.name}`).toBeTruthy();
      expect(
        validateEquationUnits(equation.expression, units.variableUnits, units.targetUnit),
        equation.name,
      ).toMatchObject({ status: "valid" });
    });
  });

  it.each([
    ["sqrt(x^2)", { x: "V" }, "V"],
    ["cbrt(x^3)", { x: "V" }, "V"],
    ["nthRoot(x^3, 3)", { x: "V" }, "V"],
    ["-x", { x: "V" }, "V"],
    ["+x", { x: "V" }, "V"],
    ["abs(x)", { x: "V" }, "V"],
    ["sign(x)", { x: "V" }, "%"],
    ["round(x, 2)", { x: "V" }, "V"],
    ["floor(x)", { x: "V" }, "V"],
    ["ceil(x)", { x: "V" }, "V"],
    ["hypot(x, y)", { x: "V", y: "V" }, "V"],
    ["mod(x, y)", { x: "V", y: "V" }, "V"],
    ["min(x, y)", { x: "V", y: "V" }, "V"],
    ["max(x, y)", { x: "V", y: "V" }, "V"],
    ["atan2(y, x)", { x: "V", y: "V" }, "rad"],
    ["log2(x)", { x: "%" }, "%"],
    ["sec(x) + csc(x) + cot(x)", { x: "rad" }, "%"],
    ["sinh(x) + cosh(x) + tanh(x)", { x: "%" }, "%"],
    ["asinh(x) + acosh(y) + atanh(z)", { x: "%", y: "%", z: "%" }, "%"],
    ["pi + e", {}, "%"],
  ])("accepts f(x) format %s", (expression, variableUnits, targetUnit) => {
    expect(validateEquationUnits(expression, variableUnits, targetUnit)).toMatchObject({
      status: "valid",
    });
  });

  it.each([
    ["V + I", { V: "V", I: "A" }, "V"],
    ["sin(V)", { V: "V" }, "%"],
    ["min(V, I)", { V: "V", I: "A" }, "V"],
    ["w / l", { w: "ozf", l: "in" }, "in-ozf"],
  ])("rejects provable contradiction %s", (expression, variableUnits, targetUnit) => {
    expect(validateEquationUnits(expression, variableUnits, targetUnit)).toMatchObject({
      status: "invalid",
    });
  });

  it("runs the RMS power case with %IV inputs through the strict live calculation path", () => {
    const rectangular = "1.7320508075688772";
    const tmde = (id, variableType, value, unit) => ({
      id,
      variableType,
      measurementPoint: { value, unit },
      reading: {
        high: 1,
        low: -1,
        unit: "%",
        symmetric: true,
        distribution: rectangular,
      },
    });
    const result = calculateDerivedUncertainty(
      "sqrt((V * Irms)^2 - (Irms^2 * R)^2)",
      { V: "Voltage", Irms: "Current", R: "Resistance" },
      [
        tmde("voltage", "Voltage", 10, "V"),
        tmde("current", "Current", 2, "A"),
        tmde("resistance", "Resistance", 4, "Ohm"),
      ],
      { value: 12, unit: "W" },
      [],
      { strictUnitValidation: true },
    );

    expect(result.error).toBeNull();
    expect(result.nominalResult).toBeCloseTo(12, 10);
    expect(result.combinedUncertaintyNative).toBeGreaterThan(0);
    expect(Number.isFinite(result.combinedUncertaintyNative)).toBe(true);
  });

  it("runs AC real power with an angle and identifies a resistance-mapped theta", () => {
    const rectangular = "1.7320508075688772";
    const tmde = (id, variableType, value, unit) => ({
      id,
      variableType,
      measurementPoint: { value, unit },
      reading: {
        high: 1,
        low: -1,
        unit: "%",
        symmetric: true,
        distribution: rectangular,
      },
    });
    const mappings = {
      V: "Voltage",
      Irms: "Current",
      theta: "Phase Angle",
    };
    const valid = calculateDerivedUncertainty(
      "V * Irms * cos(theta)",
      mappings,
      [
        tmde("voltage", "Voltage", 10, "V"),
        tmde("current", "Current", 2, "A"),
        tmde("phase", "Phase Angle", 0, "rad"),
      ],
      { value: 20, unit: "W" },
      [],
      { strictUnitValidation: true },
    );

    expect(valid.error).toBeNull();
    expect(valid.nominalResult).toBeCloseTo(20, 10);
    expect(valid.combinedUncertaintyNative).toBeGreaterThan(0);

    const invalid = calculateDerivedUncertainty(
      "V * Irms * cos(theta)",
      mappings,
      [
        tmde("voltage", "Voltage", 10, "V"),
        tmde("current", "Current", 2, "A"),
        tmde("resistance", "Phase Angle", 4, "Ohm"),
      ],
      { value: 20, unit: "W" },
      [],
      { strictUnitValidation: true },
    );

    expect(invalid.error).toContain("'theta' (Phase Angle)");
    expect(invalid.error).toContain("'Ohm' (Resistance)");
    expect(invalid.error).toContain("cos(...)");
    expect(invalid.error).toContain("rad or deg");
    expect(invalid.unitMismatch).toMatchObject({
      reason: "dimensionless-function-argument",
      variable: "theta",
      variableType: "Phase Angle",
      inputUnit: "Ohm",
      inputQuantity: "Resistance",
      target: "Power",
      targetUnit: "W",
    });
  });
});
