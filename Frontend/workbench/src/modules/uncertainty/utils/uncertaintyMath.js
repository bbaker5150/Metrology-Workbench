import * as math from "mathjs";

// ==========================================
// 1. Unit Systems & Conversions
// ==========================================
export const unitSystem = {
  units: {
    // --- Voltage ---
    V: { to_si: 1, quantity: "Voltage" },
    mV: { to_si: 1e-3, quantity: "Voltage" },
    uV: { to_si: 1e-6, quantity: "Voltage" },
    kV: { to_si: 1e3, quantity: "Voltage" },
    nV: { to_si: 1e-9, quantity: "Voltage" },

    // --- Current ---
    A: { to_si: 1, quantity: "Current" },
    mA: { to_si: 1e-3, quantity: "Current" },
    uA: { to_si: 1e-6, quantity: "Current" },
    nA: { to_si: 1e-9, quantity: "Current" },
    pA: { to_si: 1e-12, quantity: "Current" },

    // --- Resistance ---
    Ohm: { to_si: 1, quantity: "Resistance" },
    kOhm: { to_si: 1e3, quantity: "Resistance" },
    MOhm: { to_si: 1e6, quantity: "Resistance" },
    GOhm: { to_si: 1e9, quantity: "Resistance" },
    mOhm: { to_si: 1e-3, quantity: "Resistance" },

    // --- Capacitance ---
    F: { to_si: 1, quantity: "Capacitance" },
    mF: { to_si: 1e-3, quantity: "Capacitance" },
    uF: { to_si: 1e-6, quantity: "Capacitance" },
    nF: { to_si: 1e-9, quantity: "Capacitance" },
    pF: { to_si: 1e-12, quantity: "Capacitance" },

    // --- Inductance ---
    H: { to_si: 1, quantity: "Inductance" },
    mH: { to_si: 1e-3, quantity: "Inductance" },
    uH: { to_si: 1e-6, quantity: "Inductance" },

    // --- Power ---
    W: { to_si: 1, quantity: "Power" },
    mW: { to_si: 1e-3, quantity: "Power" },
    kW: { to_si: 1e3, quantity: "Power" },
    dBm: { to_si: 1, quantity: "Power" },

    // --- Frequency ---
    Hz: { to_si: 1, quantity: "Frequency" },
    kHz: { to_si: 1e3, quantity: "Frequency" },
    MHz: { to_si: 1e6, quantity: "Frequency" },
    GHz: { to_si: 1e9, quantity: "Frequency" },

    // --- Time ---
    s: { to_si: 1, quantity: "Time" },
    ms: { to_si: 1e-3, quantity: "Time" },
    us: { to_si: 1e-6, quantity: "Time" },
    ns: { to_si: 1e-9, quantity: "Time" },
    min: { to_si: 60, quantity: "Time" },
    hr: { to_si: 3600, quantity: "Time" },

    // --- Temperature ---
    degC: { to_si: 1, quantity: "Temperature" },
    degF: { to_si: 0.55555555, quantity: "Temperature" },
    K: { to_si: 1, quantity: "Temperature" },

    // --- Length ---
    m: { to_si: 1, quantity: "Length" },
    cm: { to_si: 0.01, quantity: "Length" },
    mm: { to_si: 0.001, quantity: "Length" },
    um: { to_si: 1e-6, quantity: "Length" },
    nm: { to_si: 1e-9, quantity: "Length" },
    in: { to_si: 0.0254, quantity: "Length" },
    inch: { to_si: 0.0254, quantity: "Length" },
    ft: { to_si: 0.3048, quantity: "Length" },
    yd: { to_si: 0.9144, quantity: "Length" },
    mi: { to_si: 1609.34, quantity: "Length" },

    // --- Mass ---
    kg: { to_si: 1, quantity: "Mass" },
    g: { to_si: 1e-3, quantity: "Mass" },
    mg: { to_si: 1e-6, quantity: "Mass" },
    lb: { to_si: 0.453592, quantity: "Mass" },
    oz: { to_si: 0.0283495, quantity: "Mass" },
    t: { to_si: 1000, quantity: "Mass" },

    // --- Angle ---
    rad: { to_si: 1, quantity: "Angle" },
    deg: { to_si: 0.0174532925, quantity: "Angle" },
    mrad: { to_si: 0.001, quantity: "Angle" },
    arcmin: { to_si: 0.000290888, quantity: "Angle" },
    arcsec: { to_si: 4.84814e-6, quantity: "Angle" },
    rev: { to_si: 6.2831853, quantity: "Angle" },

    // --- Angular Speed --- (SI base: rad/s)
    "rad/s": { to_si: 1, quantity: "Angular Speed" },
    rpm: { to_si: 0.10471975512, quantity: "Angular Speed" }, // 2π/60
    "deg/s": { to_si: 0.0174532925, quantity: "Angular Speed" },
    "rev/s": { to_si: 6.2831853, quantity: "Angular Speed" },

    // --- Volume ---
    "m^3": { to_si: 1, quantity: "Volume" },
    L: { to_si: 0.001, quantity: "Volume" },
    mL: { to_si: 1e-6, quantity: "Volume" },
    gal: { to_si: 0.00378541, quantity: "Volume" },
    "fl-oz": { to_si: 2.95735e-5, quantity: "Volume" },

    // --- Velocity ---
    "m/s": { to_si: 1, quantity: "Velocity" },
    "km/h": { to_si: 0.277778, quantity: "Velocity" },
    mph: { to_si: 0.44704, quantity: "Velocity" },
    "ft/s": { to_si: 0.3048, quantity: "Velocity" },
    kn: { to_si: 0.514444, quantity: "Velocity" },

    // --- Acceleration ---
    "m/s^2": { to_si: 1, quantity: "Acceleration" },
    G_accel: { to_si: 9.80665, quantity: "Acceleration" },
    "ft/s^2": { to_si: 0.3048, quantity: "Acceleration" },

    // --- Pressure ---
    Pa: { to_si: 1, quantity: "Pressure" },
    kPa: { to_si: 1e3, quantity: "Pressure" },
    MPa: { to_si: 1e6, quantity: "Pressure" },
    hPa: { to_si: 100, quantity: "Pressure" },
    bar: { to_si: 1e5, quantity: "Pressure" },
    mbar: { to_si: 100, quantity: "Pressure" },
    psi: { to_si: 6894.76, quantity: "Pressure" },
    psig: { to_si: 6894.76, quantity: "Pressure" },
    psia: { to_si: 6894.76, quantity: "Pressure" },
    inHg: { to_si: 3386.39, quantity: "Pressure" },
    mmHg: { to_si: 133.322, quantity: "Pressure" },
    torr: { to_si: 133.322, quantity: "Pressure" },
    atm: { to_si: 101325, quantity: "Pressure" },
    inH2O: { to_si: 249.089, quantity: "Pressure" },
    // "inWa" (inches of water) is the same physical unit as inH2O; kept as a
    // distinct selectable alias because many flow/pressure calibration procedures
    // label it this way. Related water-column units below.
    inWa: { to_si: 249.089, quantity: "Pressure" },
    ftH2O: { to_si: 2989.07, quantity: "Pressure" },
    cmH2O: { to_si: 98.0665, quantity: "Pressure" },
    mmH2O: { to_si: 9.80665, quantity: "Pressure" },

    // --- Force ---
    N: { to_si: 1, quantity: "Force" },
    kN: { to_si: 1e3, quantity: "Force" },
    lbf: { to_si: 4.44822, quantity: "Force" },
    ozf: { to_si: 0.278014, quantity: "Force" },
    kgf: { to_si: 9.80665, quantity: "Force" },

    // --- Torque ---
    "N-m": { to_si: 1, quantity: "Torque" },
    "N-cm": { to_si: 0.01, quantity: "Torque" },
    "lb-in": { to_si: 0.112985, quantity: "Torque" },
    "lb-ft": { to_si: 1.35582, quantity: "Torque" },
    "ozf-in": { to_si: 0.00706155, quantity: "Torque" },
    "in-oz": { to_si: 0.00706155, quantity: "Torque" },
    "in-ozf": { to_si: 0.00706155, quantity: "Torque" },
    "kgf-m": { to_si: 9.80665, quantity: "Torque" },
    "kgf-cm": { to_si: 0.0980665, quantity: "Torque" },

    // --- Flow Rate ---
    "m^3/s": { to_si: 1, quantity: "Flow" },
    "L/min": { to_si: 1.66667e-5, quantity: "Flow" },
    cfm: { to_si: 0.000471947, quantity: "Flow" },
    gpm: { to_si: 6.30902e-5, quantity: "Flow" },
    // Standard volumetric flow units (treated volumetrically at standard
    // conditions). sccm = 1 cm^3/min, slpm = 1 L/min, scfh = 1 ft^3/hr,
    // scfm = 1 ft^3/min.
    sccm: { to_si: 1.66667e-8, quantity: "Flow" },
    slpm: { to_si: 1.66667e-5, quantity: "Flow" },
    scfh: { to_si: 7.86579e-6, quantity: "Flow" },
    scfm: { to_si: 0.000471947, quantity: "Flow" },

    // --- Energy ---
    J: { to_si: 1, quantity: "Energy" },
    kJ: { to_si: 1e3, quantity: "Energy" },
    Wh: { to_si: 3600, quantity: "Energy" },
    kWh: { to_si: 3.6e6, quantity: "Energy" },
    BTU: { to_si: 1055.06, quantity: "Energy" },
    cal: { to_si: 4.184, quantity: "Energy" },

    // --- Light / Illuminance ---
    lx: { to_si: 1, quantity: "Illuminance" },
    fc: { to_si: 10.7639, quantity: "Illuminance" },

    // --- Magnetic Flux / Field ---
    T: { to_si: 1, quantity: "Magnetic Field" },
    mT: { to_si: 1e-3, quantity: "Magnetic Field" },
    uT: { to_si: 1e-6, quantity: "Magnetic Field" },
    G: { to_si: 1e-4, quantity: "Magnetic Field" },

    // --- Generic / Ratio ---
    "%": { to_si: 0.01, quantity: "Ratio" },
    ppm: { to_si: 1e-6, quantity: "Ratio" },
    ppb: { to_si: 1e-9, quantity: "Ratio" },
    dB: { to_si: 1, quantity: "Ratio" },

    // --- Humidity & Moisture ---
    "%RH": { to_si: 1, quantity: "Humidity" },
    "degC dp": { to_si: 1, quantity: "DewPoint" },
    "degF dp": { to_si: 0.55555555, quantity: "DewPoint" },
    "g/m^3": { to_si: 1, quantity: "AbsoluteHumidity" },
    "g/kg": { to_si: 1, quantity: "SpecificHumidity" },
    "ppmv": { to_si: 1e-6, quantity: "VolumeConcentration" },
    "%v": { to_si: 0.01, quantity: "VolumeConcentration" },
  },

  getQuantity(unit) {
    return this.units[unit]?.quantity || null;
  },

  getRelevantUnits: (baseUnit) => {
    const quantity = unitSystem.getQuantity(baseUnit);
    if (!quantity) return ["ppm", "%"];

    return Object.keys(unitSystem.units).filter(
      (u) => unitSystem.units[u].quantity === quantity
    );
  },

  toBaseUnit: (value, unit) => {
    if (!unitSystem.units[unit]) return value;
    return value * unitSystem.units[unit].to_si;
  },

  fromBaseUnit: (value, targetUnit) => {
    if (!unitSystem.units[targetUnit]) return value;
    return value / unitSystem.units[targetUnit].to_si;
  }
};

export const UNIT_DISPLAY_LABELS = {
  uV: "µV",
  uA: "µA",
  uF: "µF",
  uH: "µH",
  us: "µs",
  um: "µm",
  ug: "µg",
  uT: "µT",
  Ohm: "Ω",
  kOhm: "kΩ",
  MOhm: "MΩ",
  GOhm: "GΩ",
  mOhm: "mΩ",
  TOhm: "TΩ",
  degC: "°C",
  degF: "°F",
  Cel: "°C",
  "degC dp": "°C dp",
  "degF dp": "°F dp",
  deg: "°",
  arcmin: "′",
  arcsec: "″",
  rpm: "RPM",
  "deg/s": "°/s",
  // Canonical inch label uses a trailing period; "inch" is retained only for
  // backward compatibility with previously saved data and shown identically.
  in: "in.",
  inch: "in.",
  "m^3": "m³",
  "g/m^3": "g/m³",
  "m/s^2": "m/s²",
  "ft/s^2": "ft/s²",
  G_accel: "g",
  "N-m": "N·m",
  "N-cm": "N·cm",
  "lb-in": "lbf·in",
  "lb-ft": "lbf·ft",
  "ozf-in": "ozf·in",
  "in-oz": "in·ozf",
  "in-ozf": "in·ozf",
  "kgf-m": "kgf·m",
  "kgf-cm": "kgf·cm",
  "m^3/s": "m³/s",
  "%RH": "% RH",
  // Pressure (water column) — render the chemical subscript for clarity.
  inH2O: "inH₂O",
  ftH2O: "ftH₂O",
  cmH2O: "cmH₂O",
  mmH2O: "mmH₂O",
  // Standard volumetric flow units conventionally shown uppercase.
  sccm: "SCCM",
  slpm: "SLPM",
  scfh: "SCFH",
  scfm: "SCFM",
};

export const getUnitDisplayLabel = (unit) => UNIT_DISPLAY_LABELS[unit] || unit;

export const unitCategories = {
  Voltage: ["V", "mV", "uV", "kV", "nV", "TV"],
  Current: ["A", "mA", "uA", "nA", "pA", "kA"],
  Resistance: ["Ohm", "kOhm", "MOhm", "mOhm", "GOhm", "TOhm"],
  Capacitance: ["F", "uF", "nF", "pF", "mF"],
  Inductance: ["H", "mH", "uH"],
  Frequency: ["Hz", "kHz", "MHz", "GHz", "THz"],
  Time: ["s", "ms", "us", "ns", "ps", "min", "hr", "day"],
  Temperature: ["Cel", "degF", "degC", "K"],
  Pressure: ["Pa", "kPa", "MPa", "psi", "bar", "mbar", "torr", "inHg", "inH2O", "inWa", "ftH2O", "cmH2O", "mmH2O", "atm", "hPa"],
  Length: ["m", "cm", "mm", "um", "nm", "km", "in", "ft", "yd", "mi"],
  Mass: ["kg", "g", "mg", "ug", "lb", "oz", "t"],
  Power: ["W", "mW", "kW", "MW", "dBm"],
  Humidity: ["%RH", "degC dp", "degF dp", "g/m^3", "g/kg", "ppmv", "%v"],
  Angle: ["rad", "deg", "mrad", "arcmin", "arcsec", "rev"],
  "Angular Speed": ["rpm", "rad/s", "deg/s", "rev/s"],
  Volume: ["m^3", "L", "mL", "gal", "fl-oz"],
  Velocity: ["m/s", "km/h", "mph", "ft/s", "kn"],
  Force: ["N", "kN", "lbf", "ozf", "kgf"],
  Torque: ["N-m", "N-cm", "lb-in", "lb-ft", "ozf-in", "in-oz", "in-ozf", "kgf-m", "kgf-cm"],
  Flow: [
    "m^3/s",
    "L/min",
    "cfm",
    "gpm",
    "sccm",
    "slpm",
    "scfh",
    "scfm",
  ],
  Energy: ["J", "kJ", "Wh", "kWh", "BTU", "cal"],
  Illuminance: ["lx", "fc"],
  "Magnetic Field": ["T", "mT", "uT", "G"]
};

// Reverse lookup: unit key -> its category name, built once from unitCategories.
const UNIT_TO_CATEGORY = Object.entries(unitCategories).reduce(
  (acc, [category, units]) => {
    units.forEach((u) => {
      acc[u] = category;
    });
    return acc;
  },
  {}
);

// react-select `filterOption` for unit dropdowns. Matches the typed text against
// the unit's display label, its raw value, AND its category name — so typing a
// category like "angular speed" surfaces every unit in that category instead of
// returning nothing (react-select's default only matches the option label).
export const unitFilterOption = (option, rawInput) => {
  const needle = String(rawInput || "").trim().toLowerCase();
  if (!needle) return true;
  const value = String(option?.value || "");
  const label = String(option?.label || "");
  const category = UNIT_TO_CATEGORY[value] || "";
  return (
    label.toLowerCase().includes(needle) ||
    value.toLowerCase().includes(needle) ||
    category.toLowerCase().includes(needle)
  );
};

export const convertPpmToUnit = (ppmValue, targetUnit, referencePoint) => {
  const nominalValue = parseFloat(referencePoint?.value);
  if (isNaN(ppmValue) || !referencePoint) return "N/A";
  if (targetUnit === "ppm") return ppmValue;
  // ppb is purely relative (1 ppm = 1000 ppb), so no nominal is needed.
  if (targetUnit === "ppb") return ppmValue * 1000;

  if (isNaN(nominalValue)) return "N/A";

  if (nominalValue === 0) {
    if (targetUnit === "%") return ppmValue / 10000;
    return "N/A (Nominal is 0)";
  }

  const nominalInBase = unitSystem.toBaseUnit(
    nominalValue,
    referencePoint.unit
  );
  const deviationInBase = (ppmValue / 1e6) * Math.abs(nominalInBase);

  if (targetUnit === "%") {
    return (deviationInBase / Math.abs(nominalInBase)) * 100;
  }

  const targetUnitInfo = unitSystem.units[targetUnit];
  if (targetUnitInfo?.to_si) {
    return deviationInBase / targetUnitInfo.to_si;
  }

  return ppmValue;
};

export const convertToPPM = (
  value,
  unit,
  nominalValue,
  nominalUnit,
  fallbackReferenceValue = null,
  getExplanation = false
) => {
  const parsedValue = parseFloat(value);
  let parsedNominal = parseFloat(nominalValue);

  if (isNaN(parsedValue)) return getExplanation ? { value: NaN } : NaN;
  if (unit === "ppm")
    return getExplanation ? { value: parsedValue } : parsedValue;
  // ppb is purely relative (1 ppm = 1000 ppb), convert straight to ppm.
  if (unit === "ppb") {
    const ppm = parsedValue / 1000;
    return getExplanation ? { value: ppm } : ppm;
  }

  if (parsedNominal === 0 && fallbackReferenceValue) {
    parsedNominal = parseFloat(fallbackReferenceValue);
  }

  const nominalQuantity = unitSystem.getQuantity(nominalUnit);
  const valueQuantity = unitSystem.getQuantity(unit);

  if (!nominalQuantity)
    return getExplanation
      ? { value: NaN, warning: `Unknown quantity for nominal unit '${nominalUnit}'.` }
      : NaN;

  let valueInBase;
  if (unit === "%") {
    valueInBase = (parsedValue / 100) * unitSystem.toBaseUnit(parsedNominal, nominalUnit);
  } else if (
    valueQuantity &&
    (valueQuantity === nominalQuantity || valueQuantity === "Relative")
  ) {
    valueInBase = unitSystem.toBaseUnit(parsedValue, unit);
  } else if (
    valueQuantity &&
    nominalQuantity &&
    valueQuantity !== nominalQuantity
  ) {
    return getExplanation
      ? { value: NaN, warning: `Unit mismatch: Cannot convert ${unit} (${valueQuantity}) to ${nominalUnit} (${nominalQuantity}).` }
      : NaN;
  } else {
    valueInBase = unitSystem.toBaseUnit(parsedValue, unit);
  }

  if (isNaN(valueInBase))
    return getExplanation
      ? { value: NaN, warning: `Unsupported unit conversion for '${unit}'.` }
      : NaN;

  const nominalInBase = unitSystem.toBaseUnit(parsedNominal, nominalUnit);
  if (isNaN(nominalInBase) || nominalInBase === 0)
    return getExplanation ? { value: NaN } : NaN;

  const ppmValue = (valueInBase / Math.abs(nominalInBase)) * 1e6;

  if (getExplanation) {
    const explanation = `((${valueInBase.toExponential(4)}) / ${Math.abs(
      nominalInBase
    ).toExponential(4)}) × 1,000,000 = ${ppmValue.toFixed(2)} ppm`;
    return { value: ppmValue, explanation };
  }

  return ppmValue;
};

// ==========================================
// 2. Statistics & Distributions
// ==========================================

export const DISTRIBUTION_NOT_SET = "not_set";

export const errorDistributions = [
  { value: DISTRIBUTION_NOT_SET, label: "Not Set" },
  { value: "1.732", label: "Rectangular" },
  { value: "2.449", label: "Triangular" },
  { value: "1.414", label: "U-Shaped" },
  { value: "1.645", label: "Normal (90%)" },
  { value: "1.960", label: "Normal (95%)" },
  { value: "2.000", label: "Normal (95.45%)" },
  { value: "2.576", label: "Normal (99%)" },
  { value: "3.000", label: "Normal (99.73%)" },
  { value: "4.179", label: "Rayleigh" },
  { value: "1.000", label: "Normal (k=1)" },
];

// ---------------------------------------------------------------------------
// Student-t inverse CDF (coverage factor at finite degrees of freedom)
// ---------------------------------------------------------------------------
//
// The coverage factor k = t_p(ν) depends on BOTH the coverage probability p
// (from the uncertainty requirements' confidence %) AND the effective degrees
// of freedom ν (Welch–Satterthwaite). The previous implementation hard-coded a
// 95 % lookup table, which silently ignored the configured confidence whenever
// ν was finite. This computes t_p(ν) exactly for any p and ν via the inverse
// regularized incomplete beta function, so 90 / 95 / 99 % all give correct k.

// Lanczos log-gamma.
function logGamma(x) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Continued-fraction kernel for the incomplete beta function (Numerical Recipes).
function betacf(a, b, x) {
  const FPMIN = 1e-300;
  const EPS = 3e-14;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 10000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) <= EPS) break;
  }
  return h;
}

// Regularized incomplete beta I_x(a,b).
function regularizedIncompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta =
    logGamma(a + b) -
    logGamma(a) -
    logGamma(b) +
    a * Math.log(x) +
    b * Math.log(1 - x);
  const front = Math.exp(lbeta);
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betacf(a, b, x)) / a;
  }
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

// Inverse of the regularized incomplete beta: returns x with I_x(a,b) = p.
// Bisection — robust for the a = ν/2, b = 1/2 shape we need (including small ν).
function inverseRegularizedIncompleteBeta(p, a, b) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  let x = 0.5;
  for (let i = 0; i < 200; i++) {
    x = 0.5 * (lo + hi);
    const err = regularizedIncompleteBeta(x, a, b) - p;
    if (Math.abs(err) < 1e-12) break;
    if (err < 0) lo = x;
    else hi = x;
  }
  return x;
}

/**
 * Inverse Student-t CDF: the value t such that P(T <= t) = p for ν = df.
 * Used as the coverage factor for a two-sided interval with p = (1 + C)/2.
 */
export function studentTQuantile(p, df) {
  if (!Number.isFinite(df) || df <= 0 || df > 1e7) return normalQuantile(p);
  if (p === 0.5) return 0;
  const tail = p < 0.5 ? p : 1 - p; // upper/lower tail probability
  const x = inverseRegularizedIncompleteBeta(2 * tail, df / 2, 0.5);
  const t = Math.sqrt((df * (1 - x)) / x);
  return p >= 0.5 ? t : -t;
}

/**
 * Coverage factor from degrees of freedom at a given two-sided coverage
 * probability. ν = ∞ (or NaN) collapses to the normal quantile. `probability`
 * is the one-sided upper probability p = (1 + C)/2 (default 0.975 ≡ 95 %).
 */
export function getKValueFromTDistribution(dof, probability = 0.975) {
  if (dof === Infinity || dof == null || isNaN(dof)) {
    return normalQuantile(probability);
  }
  return studentTQuantile(probability, dof);
}

// ==========================================
// 2b. Input Correlation (GUM cross-terms)
// ==========================================
//
// Mirrors the MUA workbook's `TlrCorSq` routine, which combines input
// uncertainties as  u_c^2 = Σ_i Σ_j u_i u_j c_i c_j ρ_ij  over a correlation
// matrix. With an identity matrix (no off-diagonals) this reduces to plain RSS,
// so the default {} preserves the app's existing independent-input behavior.
//
// Correlations are stored sparsely as a symmetric map keyed by the two
// component identities sorted and joined with "|", e.g. { "Length|Weight": 1 }.

export const correlationKey = (idA, idB) =>
  [String(idA), String(idB)].sort().join("|");

export const getCorrelation = (correlations, idA, idB) => {
  if (idA === idB) return 1;
  const v = correlations?.[correlationKey(idA, idB)];
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Combine SIGNED contributions (cᵢ = sensitivity × uᵢ, in consistent units)
 * into a combined standard uncertainty, honoring an optional correlation map.
 *
 *   u_c = sqrt( Σ cᵢ²  +  2 Σ_{i<j} ρ_ij·cᵢ·cⱼ )
 *
 * Sign matters: a positive correlation on an input with a negative sensitivity
 * reduces u_c (e.g. a ratio V1/V2). An empty map yields pure RSS.
 *
 * @param {Array<{id: string, contribution: number}>} contributions
 * @param {Object} [correlations] sparse symmetric map; {} = identity
 * @returns {number} combined standard uncertainty (>= 0)
 */
export const combineWithCorrelation = (contributions, correlations = {}) => {
  let sum = 0;
  for (let i = 0; i < contributions.length; i++) {
    const ci = contributions[i].contribution;
    if (!Number.isFinite(ci)) continue;
    sum += ci * ci; // diagonal term (ρ = 1)
    for (let j = i + 1; j < contributions.length; j++) {
      const cj = contributions[j].contribution;
      if (!Number.isFinite(cj)) continue;
      const rho = getCorrelation(
        correlations,
        contributions[i].id,
        contributions[j].id
      );
      if (rho !== 0) sum += 2 * rho * ci * cj;
    }
  }
  // Clamp: an over-correlated (non positive-semidefinite) matrix could drive the
  // variance slightly negative; treat that as zero rather than returning NaN.
  return Math.sqrt(Math.max(0, sum));
};

// ==========================================
// 2c. Accurate inverse standard-normal CDF
// ==========================================
//
// simple-statistics' `probit(0.975)` returns ~1.95716, which is ~0.14% short of
// the true 95% two-sided coverage factor 1.959964 used by the MUA workbook
// (its EqBudget reports k = 1.9599639845). That error propagates into every
// expanded uncertainty and risk number. This is Acklam's rational approximation
// refined with one Halley step against CumNorm, accurate to full double
// precision — so normalQuantile(0.975) === 1.959963984540054.

export function normalQuantile(p) {
  if (!(p > 0)) return -Infinity;
  if (!(p < 1)) return Infinity;

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239e0,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
    -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0,
    3.754408661907416e0,
  ];
  const plow = 0.02425;
  const phigh = 1 - plow;

  let x;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= phigh) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  // Halley refinement using the existing CumNorm (standard-normal CDF).
  const e = CumNorm(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  x = x - u / (1 + (x * u) / 2);
  return x;
}

// Round a [low, high] acceptance band INWARD to the UUT's measuring resolution
// grid, mirroring the workbook: low rounds up (resDwn), high rounds down
// (resUp). resolutionNative must already be in the limits' (nominal) unit.
// A zero/invalid resolution, or a snap that would collapse/invert the band,
// leaves the raw limits untouched.
export function snapLimitsToResolution(low, high, resolutionNative) {
  if (!Number.isFinite(resolutionNative) || resolutionNative <= 0) {
    return { low, high };
  }
  const snappedLow = resDwn(low, resolutionNative); // inward = up for the low limit
  const snappedHigh = resUp(high, resolutionNative); // inward = down for the high limit
  if (!(snappedLow < snappedHigh)) return { low, high };
  return { low: snappedLow, high: snappedHigh };
}

// ==========================================
// 3. Uncertainty Logic & Formatters
// ==========================================

export const getToleranceUnitOptions = (referenceUnit) => {
  const quantity = unitSystem.getQuantity(referenceUnit);
  if (!quantity) return ["%", "ppm"];

  const physicalUnits = Object.keys(unitSystem.units).filter(
    (u) => unitSystem.units[u].quantity === quantity
  );

  return ["%", "ppm", ...physicalUnits];
};

export const getToleranceSummary = (toleranceData) => {
  if (!toleranceData || Object.keys(toleranceData).length === 0)
    return "Not Set";

  const formatPart = (part) => {
    if (!part || (isNaN(parseFloat(part.high)) && isNaN(parseFloat(part.low))))
      return null;
    const high = parseFloat(part.high || 0);
    const low = parseFloat(part.low || -high);
    const unitLabel = getUnitDisplayLabel(part.unit || "");
    if (Math.abs(high + low) < 1e-9 && high > 0)
      return `±${high} ${unitLabel}`;
    return `+${high}/${low} ${unitLabel}`;
  };

  const parts = [];
  if (toleranceData.reading) parts.push(formatPart(toleranceData.reading));
  if (toleranceData.readings_iv) parts.push(formatPart(toleranceData.readings_iv));
  if (toleranceData.range) {
    // Only append " of FS" when the range actually has a value — otherwise
    // formatPart returns null and we'd produce a misleading "null of FS".
    const rangePart = formatPart(toleranceData.range);
    if (rangePart) parts.push(`${rangePart} of FS`);
  }
  if (toleranceData.floor) parts.push(formatPart(toleranceData.floor));
  if (toleranceData.db) parts.push(formatPart(toleranceData.db));

  return parts.filter((p) => p).join(" + ") || "Not Set";
};

// =================================================================================
// UPDATED: calculateUncertaintyFromToleranceObject
// Includes fixes for: Normalization, Positive Low Values, and Zero Nominal Value
// =================================================================================
export const calculateUncertaintyFromToleranceObject = (
  rawToleranceObject,
  referenceMeasurementPoint,
  excludeResolution = false
) => {
  
  // 1. Structure Normalization
  let toleranceObject = rawToleranceObject;
  if (Array.isArray(toleranceObject)) {
    toleranceObject = toleranceObject[0];
  }

  // Preserve outer resolution before diving deeper
  let outerResolution = null;
  let outerResolutionUnit = null;
  if (toleranceObject) {
    outerResolution = toleranceObject.resolution || toleranceObject.measuringResolution;
    outerResolutionUnit = toleranceObject.resolutionUnit || toleranceObject.measuringResolutionUnit;
  }

  // Handle nested tolerance objects
  if (toleranceObject && typeof toleranceObject === 'object') {
     if (toleranceObject.tolerance) {
        toleranceObject = toleranceObject.tolerance;
     } else if (toleranceObject.tolerances) {
        toleranceObject = toleranceObject.tolerances;
     }
  }

  const hasValidValue = referenceMeasurementPoint && 
                        referenceMeasurementPoint.value !== null && 
                        referenceMeasurementPoint.value !== undefined && 
                        referenceMeasurementPoint.value !== "";

  if (
    !toleranceObject ||
    !referenceMeasurementPoint ||
    !hasValidValue ||
    !referenceMeasurementPoint.unit
  ) {
    console.warn("⚠️ Missing valid inputs for calculation");
    console.groupEnd();
    return { standardUncertainty: 0, totalToleranceForTar: 0, breakdown: [] };
  }

  const nominalValue = parseFloat(referenceMeasurementPoint.value);
  const nominalUnit = referenceMeasurementPoint.unit;
  let totalVariance = 0;
  let totalLinearTolerance = 0;
  const breakdown = [];

  const addComponent = (tolComp, name, baseValueForRelative) => {
    if (
      !tolComp ||
      (isNaN(parseFloat(tolComp.high)) && isNaN(parseFloat(tolComp.low)))
    )
      return;

    const high = parseFloat(tolComp.high || 0);
    let low = parseFloat(tolComp.low || -high);
    
    // FIX: Handle positive low value (e.g. "low": 0.05) by forcing negative
    if (tolComp.symmetric && low > 0) {
        low = -Math.abs(low);
    } else if (low > 0 && high > 0 && Math.abs(high - low) < 1e-9) {
        low = -Math.abs(low);
    }

    const halfSpan = (high - low) / 2;

    if (halfSpan === 0) return;

    const unit = tolComp.unit;
    const unitLabel = getUnitDisplayLabel(unit || "");
    const nominalUnitLabel = getUnitDisplayLabel(nominalUnit || "");
    const divisor =
      tolComp.distribution === DISTRIBUTION_NOT_SET
        ? NaN
        : parseFloat(tolComp.distribution);
    const distributionLabel =
      errorDistributions.find((d) => d.value === String(tolComp.distribution))
        ?.label || (tolComp.distribution === DISTRIBUTION_NOT_SET ? "Not Set" : "Rectangular");

    let specString =
      Math.abs(high + low) < 1e-9
        ? `±${high} ${unitLabel}`
        : `+${high}/${low} ${unitLabel}`;

    let valueInNominalUnits;
    let explanation = "";

    if (unit === "%" || unit === "ppm" || unit === "ppb") {
      valueInNominalUnits =
        halfSpan * unitSystem.units[unit].to_si * baseValueForRelative;
      explanation = `${halfSpan.toExponential(
        3
      )}${unitLabel} of ${baseValueForRelative}${nominalUnitLabel}`;
    } else {
      const valueInBase = unitSystem.toBaseUnit(halfSpan, unit);
      const nominalUnitInBase = unitSystem.toBaseUnit(1, nominalUnit);
      valueInNominalUnits = valueInBase / nominalUnitInBase;
      explanation = `${halfSpan.toExponential(3)} ${unitLabel}`;
    }

    const rangeFsValue = parseFloat(toleranceObject.range?.value);
    
    // Attempt PPM conversion
    const ppm = convertToPPM(
      valueInNominalUnits,
      nominalUnit,
      nominalValue,
      nominalUnit,
      rangeFsValue
    );

    // FIX: Fallback for 0 Nominal Value (PPM is NaN)
    const canUsePPM = !isNaN(ppm);
    const u_i_absolute = valueInNominalUnits / divisor;
    
    if (canUsePPM || !isNaN(u_i_absolute)) {
      const u_i = canUsePPM ? Math.abs(ppm / divisor) : Math.abs(u_i_absolute);
      
      totalLinearTolerance += canUsePPM ? Math.abs(ppm) : 0; 
      
      if (canUsePPM) {
         totalVariance += Math.pow(u_i, 2);
      }

      // Calculate absolute deviations and final limits
      const highDeviation = (high / halfSpan) * valueInNominalUnits;
      const lowDeviation = (low / halfSpan) * valueInNominalUnits;
      const absoluteHigh = nominalValue + highDeviation;
      const absoluteLow = nominalValue + lowDeviation;

      breakdown.push({
        name,
        input: specString,
        explanation,
        ppm: canUsePPM ? Math.abs(ppm) : 0,
        u_i: u_i,
        divisor,
        distributionLabel,
        absoluteLow,
        absoluteHigh,
        originalHalfSpan: Math.abs(halfSpan),
        originalUnit: unit,
      });
    }
  };

  addComponent(toleranceObject.reading, "% of Indicated Value", nominalValue);
  // Legacy "Readings (IV)" held a raw indicated-value error == a Floor Value;
  // still summed for backward compatibility and labeled accordingly.
  addComponent(toleranceObject.readings_iv, "Floor Value", nominalValue);

  addComponent(
    toleranceObject.range,
    "% Full Scale",
    parseFloat(toleranceObject.range?.value) || parseFloat(toleranceObject.max)
  );
  addComponent(toleranceObject.floor, "Floor Value", nominalValue);

  const dbTolComp = toleranceObject.db;
  if (dbTolComp && !isNaN(parseFloat(dbTolComp.high))) {
    const highDb = parseFloat(dbTolComp.high || 0);
    const lowDb = parseFloat(dbTolComp.low || -highDb);
    const dbTol = (highDb - lowDb) / 2;

    if (dbTol > 0 && nominalValue > 0) {
      const dbMult = parseFloat(dbTolComp.multiplier) || 20;
      const dbRef = parseFloat(dbTolComp.ref) || 1;
      const divisor =
        dbTolComp.distribution === DISTRIBUTION_NOT_SET
          ? NaN
          : parseFloat(dbTolComp.distribution);
      const distributionLabel =
        errorDistributions.find(
          (d) => d.value === String(dbTolComp.distribution)
        )?.label ||
        (dbTolComp.distribution === DISTRIBUTION_NOT_SET ? "Not Set" : "Rectangular");

      const dbNominal = dbMult * Math.log10(nominalValue / dbRef);
      const absoluteHigh = dbRef * Math.pow(10, (dbNominal + highDb) / dbMult);
      const absoluteLow = dbRef * Math.pow(10, (dbNominal + lowDb) / dbMult);
      const centerValue = (absoluteHigh + absoluteLow) / 2;
      const absoluteDeviation = absoluteHigh - centerValue;

      const ppm = convertToPPM(
        absoluteDeviation,
        nominalUnit,
        nominalValue,
        nominalUnit
      );

      if (!isNaN(ppm)) {
        const u_i = Math.abs(ppm / divisor);
        totalLinearTolerance += Math.abs(ppm);
        totalVariance += Math.pow(u_i, 2);
        const specString =
          Math.abs(highDb + lowDb) < 1e-9
            ? `±${highDb} dB`
            : `+${highDb}/${lowDb} dB`;
        breakdown.push({
          name: "dB Value",
          input: specString,
          explanation: `Calculates to a half-span of ${absoluteDeviation.toExponential(
            3
          )} ${nominalUnit}`,
          ppm: Math.abs(ppm),
          u_i,
          divisor,
          distributionLabel,
          absoluteLow,
          absoluteHigh,
          originalHalfSpan: Math.abs(dbTol),
          originalUnit: "dB",
        });
      }
    }
  }

  // --- AUTOMATIC RESOLUTION LOGIC REMOVED ---
  // Resolution is manually handled.

  const standardUncertainty = Math.sqrt(totalVariance);

  return {
    standardUncertainty,
    totalToleranceForTar: totalLinearTolerance,
    breakdown,
  };
};

export const getToleranceErrorSummary = (toleranceObject, referencePoint) => {
  if (
    !toleranceObject ||
    Object.keys(toleranceObject).length <= 1 ||
    !referencePoint ||
    !referencePoint.value
  ) {
    return "Not Set";
  }

  const { breakdown } = calculateUncertaintyFromToleranceObject(
    toleranceObject,
    referencePoint
  );

  const nominalValue = parseFloat(referencePoint.value);
  const nominalUnit = referencePoint.unit;
  const nominalUnitLabel = getUnitDisplayLabel(nominalUnit || "");

  if (breakdown.length === 0) {
    return "Not Calculated";
  }

  const specComponents = breakdown.filter(
    (comp) => comp.absoluteHigh !== undefined && comp.absoluteLow !== undefined
  );

  if (specComponents.length === 0) {
    return "N/A";
  }

  const totalHighDeviation = specComponents.reduce((sum, comp) => {
    return sum + (comp.absoluteHigh - nominalValue);
  }, 0);

  const totalLowDeviation = specComponents.reduce((sum, comp) => {
    return sum + (comp.absoluteLow - nominalValue);
  }, 0);

  if (
    Math.abs(totalHighDeviation + totalLowDeviation) < 1e-9 &&
    totalHighDeviation > 0
  ) {
    return `±${totalHighDeviation.toPrecision(3)} ${nominalUnitLabel}`;
  }

  return `+${totalHighDeviation.toPrecision(
    3
  )} / ${totalLowDeviation.toPrecision(3)} ${nominalUnitLabel}`;
};

export const getAbsoluteLimits = (toleranceObject, referencePoint) => {
  if (!toleranceObject || !referencePoint || !referencePoint.value) {
    return { high: "N/A", low: "N/A" };
  }

  const { breakdown } = calculateUncertaintyFromToleranceObject(
    toleranceObject,
    referencePoint
  );

  if (breakdown.length === 0) {
    const nominal = `${parseFloat(referencePoint.value).toPrecision(
      7,
    )} ${getUnitDisplayLabel(referencePoint.unit || "")}`;
    return { high: nominal, low: nominal };
  }

  const nominalValue = parseFloat(referencePoint.value);
  const nominalUnit = referencePoint.unit;
  const nominalUnitLabel = getUnitDisplayLabel(nominalUnit || "");

  const specComponents = breakdown.filter(
    (comp) => comp.absoluteHigh !== undefined && comp.absoluteLow !== undefined
  );

  const totalHighDeviation = specComponents.reduce((sum, comp) => {
    return sum + (comp.absoluteHigh - nominalValue);
  }, 0);

  const totalLowDeviation = specComponents.reduce((sum, comp) => {
    return sum + (comp.absoluteLow - nominalValue);
  }, 0);

  const finalHighLimit = nominalValue + totalHighDeviation;
  const finalLowLimit = nominalValue + totalLowDeviation;

  // Mirror the workbook: snap the acceptance band inward to the UUT's measuring
  // resolution (when one is defined) so the displayed limits match Excel.
  const { low: snappedLow, high: snappedHigh } = snapLimitsToResolution(
    finalLowLimit,
    finalHighLimit,
    resolveResolutionNative(toleranceObject, nominalUnit)
  );

  return {
    high: `${snappedHigh.toPrecision(7)} ${nominalUnitLabel}`,
    low: `${snappedLow.toPrecision(7)} ${nominalUnitLabel}`,
  };
};

// Absolute low/high limits of the combined TMDE (standard) tolerance for a
// point, expressed in the UUT nominal's unit. Mirrors the TMDE span that feeds
// calcTAR (riskCompute / useRiskCalculation): each TMDE is evaluated at its own
// measurement point (or the UUT nominal as a fallback), its deviations are
// converted into the UUT's native unit and scaled by quantity, and the totals
// are anchored on the UUT nominal. Unlike the UUT acceptance band these are NOT
// snapped to resolution. Returns { high: "N/A", low: "N/A" } when no usable
// TMDE tolerance or nominal is present.
export const getTmdeAbsoluteLimits = (tmdeTolerances, uutNominal) => {
  if (!Array.isArray(tmdeTolerances) || tmdeTolerances.length === 0) {
    return { high: "N/A", low: "N/A" };
  }
  if (
    !uutNominal ||
    uutNominal.value === "" ||
    uutNominal.value === null ||
    uutNominal.value === undefined ||
    !uutNominal.unit
  ) {
    return { high: "N/A", low: "N/A" };
  }

  const nominalValue = parseFloat(uutNominal.value);
  const nominalUnit = uutNominal.unit;
  const nominalUnitLabel = getUnitDisplayLabel(nominalUnit || "");
  const targetUnitInfo = unitSystem.units[nominalUnit];
  if (isNaN(nominalValue) || !targetUnitInfo || isNaN(targetUnitInfo.to_si)) {
    return { high: "N/A", low: "N/A" };
  }

  let totalHighDev = 0;
  let totalLowDev = 0;
  let hasAny = false;

  for (const tmde of tmdeTolerances) {
    const hasOwnPoint =
      tmde.measurementPoint &&
      tmde.measurementPoint.value &&
      tmde.measurementPoint.unit;
    const refPoint = hasOwnPoint ? tmde.measurementPoint : uutNominal;
    if (!refPoint || !refPoint.value || !refPoint.unit) continue;

    const tmdeUnitInfo = unitSystem.units[refPoint.unit];
    if (!tmdeUnitInfo || isNaN(tmdeUnitInfo.to_si)) continue;

    let breakdown;
    try {
      ({ breakdown } = calculateUncertaintyFromToleranceObject(
        tmde.tolerance || tmde,
        refPoint
      ));
    } catch {
      continue;
    }

    const specs = (breakdown || []).filter(
      (comp) =>
        comp.absoluteHigh !== undefined && comp.absoluteLow !== undefined
    );
    if (specs.length === 0) continue;

    const tmdeNominal = parseFloat(refPoint.value);
    let highDev = 0;
    let lowDev = 0;
    specs.forEach((comp) => {
      highDev +=
        ((comp.absoluteHigh - tmdeNominal) * tmdeUnitInfo.to_si) /
        targetUnitInfo.to_si;
      lowDev +=
        ((comp.absoluteLow - tmdeNominal) * tmdeUnitInfo.to_si) /
        targetUnitInfo.to_si;
    });

    const quantity = parseInt(tmde.quantity, 10) || 1;
    totalHighDev += highDev * quantity;
    totalLowDev += lowDev * quantity;
    hasAny = true;
  }

  if (!hasAny) return { high: "N/A", low: "N/A" };

  const finalHigh = nominalValue + totalHighDev;
  const finalLow = nominalValue + totalLowDev;
  return {
    high: `${finalHigh.toPrecision(7)} ${nominalUnitLabel}`,
    low: `${finalLow.toPrecision(7)} ${nominalUnitLabel}`,
  };
};

// Per-standard limits for derived-point displays. Unlike
// getTmdeAbsoluteLimits, this does not combine the standards into one TAR band;
// it preserves each assigned TMDE so the UI can show and compare them.
export const getTmdeAbsoluteLimitEntries = (tmdeTolerances) => {
  if (!Array.isArray(tmdeTolerances)) return [];

  return tmdeTolerances.flatMap((tmde, index) => {
    const referencePoint = tmde?.measurementPoint;
    if (
      !referencePoint ||
      referencePoint.value === "" ||
      referencePoint.value === null ||
      referencePoint.value === undefined ||
      !referencePoint.unit
    ) {
      return [];
    }

    let limits;
    try {
      limits = getAbsoluteLimits(tmde.tolerance || tmde, referencePoint);
    } catch {
      return [];
    }
    if (!limits || limits.low === "N/A" || limits.high === "N/A") return [];

    return [
      {
        id: tmde.id || tmde.sourceId || `tmde-${index}`,
        variableType: tmde.variableType || "",
        description:
          tmde.description ||
          tmde.name ||
          (tmde.instrument
            ? `${tmde.instrument.manufacturer || ""} ${
                tmde.instrument.model || ""
              }`.trim()
            : "") ||
          "TMDE",
        quantity: parseInt(tmde.quantity, 10) || 1,
        low: limits.low,
        high: limits.high,
      },
    ];
  });
};

// Resolve a tolerance object's measuring resolution into the nominal unit's
// grid spacing. Returns 0 when no usable resolution is present (snap is a no-op).
export function resolveResolutionNative(toleranceObject, nominalUnit) {
  // Derived (equation) tolerance objects carry the LSD under `resolution`,
  // while instrument-range tolerances use `measuringResolution`. The budget
  // readers already fall back across both keys (see budgetUtils and
  // calculateUncertaintyFromToleranceObject); mirror that here so the
  // acceptance-limit snap fires for derived points too — without it their
  // limits stay un-snapped and TUR diverges from the workbook.
  const resRaw = parseFloat(
    toleranceObject?.measuringResolution ?? toleranceObject?.resolution,
  );
  if (isNaN(resRaw) || resRaw <= 0) return 0;
  const resUnit =
    toleranceObject?.measuringResolutionUnit ||
    toleranceObject?.resolutionUnit ||
    nominalUnit;
  // Same unit -> no conversion. Skipping the SI round-trip avoids introducing
  // floating-point dust (e.g. (0.1 * 6894.76) / 6894.76 = 0.10000000000000002),
  // which the grid-snapping would otherwise have to defend against.
  if (resUnit === nominalUnit) return resRaw;
  const resUnitInfo = unitSystem.units[resUnit];
  const nominalUnitInfo = unitSystem.units[nominalUnit];
  if (resUnitInfo && nominalUnitInfo && !isNaN(nominalUnitInfo.to_si)) {
    return (resRaw * resUnitInfo.to_si) / nominalUnitInfo.to_si;
  }
  return resRaw;
}

// Warn when an input's second-order Taylor term ½·|f″|·u² exceeds this
// fraction of its first-order term |f′|·u. At that point the linear (GUM)
// budget is measurably understating the input's contribution.
const NONLINEARITY_WARN_RATIO = 0.1;

export const calculateDerivedUncertainty = (
  equationString,
  variableMappings,
  tmdeTolerances,
  derivedNominalPoint,
  manualComponents = []
) => {
  // 1. Basic Validation
  if (!equationString || !variableMappings || !tmdeTolerances) {
    console.error("calculateDerivedUncertainty missing essential inputs", {
      equationString,
      variableMappings,
      tmdeTolerances,
    });
    return {
      combinedUncertaintyNative: NaN,
      breakdown: [],
      nominalResult: NaN,
      error: "Missing calculation inputs.",
    };
  }

  if (
    Object.keys(variableMappings).length === 0 &&
    equationString.match(/[a-zA-Z]/)
  ) {
    return {
      combinedUncertaintyNative: NaN,
      breakdown: [],
      nominalResult: NaN,
      error: "Variable mappings are missing for the equation.",
    };
  }

  try {
    // 2. Parse the Equation
    let expressionToParse = equationString.trim();
    const equalsIndex = expressionToParse.indexOf("=");

    if (equalsIndex !== -1) {
      if (equalsIndex < expressionToParse.length - 1) {
        expressionToParse = expressionToParse.substring(equalsIndex + 1).trim();
      } else {
        throw new Error(
          "Invalid equation format: Assignment without expression."
        );
      }
    }
    if (!expressionToParse) {
      throw new Error("Equation expression is empty.");
    }

    const node = math.parse(expressionToParse);
    const variables = Object.keys(variableMappings);

    // Get Target Unit Conversion Factor (to convert final result back to user's unit)
    const targetUnit = derivedNominalPoint?.unit || "";
    const targetUnitInfo = unitSystem.units[targetUnit];
    // Default to 1 if unit not found to prevent NaN, but logic relies on valid units usually
    const targetToSi = targetUnitInfo ? targetUnitInfo.to_si : 1; 

    // Handle Constant Expressions (e.g. "1 + 1")
    if (variables.length === 0) {
      try {
        const constantResultBase = node.compile().evaluate({});
        const constantResultConverted = unitSystem.fromBaseUnit(constantResultBase, targetUnit);
        return {
          combinedUncertaintyNative: 0,
          breakdown: [],
          nominalResult: constantResultConverted,
          error: null,
        };
      } catch (constEvalError) {
        throw new Error(
          "Equation has no mapped variables and is not a constant expression."
        );
      }
    }

    let sumOfSquaresBase = 0;
    // Second-order (Taylor) aggregates across all inputs: Σ(½f″ᵢuᵢ²)² for the
    // GUM second-order variance term and Σ½f″ᵢuᵢ² for the mean-value shift.
    let sumSecondOrderSquaresBase = 0;
    let secondOrderShiftBase = 0;
    let hasSecondOrderTerms = false;
    const calculationBreakdown = [];
    const nominalScope = {};
    const uncertaintyInputs = {};
    const warnings = [];

    // --- 3. PROCESS TMDE INPUTS (Build Data Source) ---
    // We collect all data in BASE UNITS to ensure physics are correct (e.g. 1mV * 1kV = 0.001 * 1000 = 1)
    tmdeTolerances.forEach((tmde) => {
      if (
        !tmde.variableType ||
        !tmde.measurementPoint ||
        tmde.measurementPoint.value === "" ||
        tmde.measurementPoint.unit === ""
      ) {
        return; 
      }

      const nominalValue = parseFloat(tmde.measurementPoint.value);
      if (isNaN(nominalValue)) return;

      // Calculate Standard Uncertainty
      const toleranceSource = tmde.tolerance || tmde;
      const { standardUncertainty: ui_ppm } =
        calculateUncertaintyFromToleranceObject(toleranceSource, tmde.measurementPoint, true);

      const nominalInBase = unitSystem.toBaseUnit(
        nominalValue,
        tmde.measurementPoint.unit
      );

      // Uncertainty in Base Units (absolute)
      const ui_absolute_base = (ui_ppm / 1e6) * Math.abs(nominalInBase);

      const quantity = parseInt(tmde.quantity, 10) || 1;
      const variance_base = ui_absolute_base ** 2 * quantity;
      // Additive composition: when several TMDEs map to ONE equation variable,
      // the variable's value is the SUM of the pieces (the workbook's torque
      // case — deadweights summing to a load), and `quantity` is additive
      // multiplicity. Independent pieces' variances add (RSS). This makes a
      // single variable carrying N TMDEs mathematically identical to the same
      // equation rewritten with the N pieces as separate summed input variables.
      // Previously only the FIRST TMDE's value was kept as the nominal, so two
      // 10 kg weights read as 10 (not 20) — halving the derived result and, via
      // the sensitivity evaluation point, corrupting every risk metric.
      const nominalContribution_base = nominalInBase * quantity;

      if (isNaN(variance_base) || variance_base < 0) {
        return;
      }

      // Store in map
      if (uncertaintyInputs[tmde.variableType]) {
        uncertaintyInputs[tmde.variableType].ui_squared_sum_base += variance_base;
        uncertaintyInputs[tmde.variableType].nominalBase += nominalContribution_base;
      } else {
        uncertaintyInputs[tmde.variableType] = {
          ui_squared_sum_base: variance_base,
          nominalBase: nominalContribution_base, // SUM of pieces (base SI)
          unit: tmde.measurementPoint.unit,
        };
      }
    });

    // --- 4. PROCESS MANUAL COMPONENT INPUTS ---
    if (manualComponents && Array.isArray(manualComponents)) {
      manualComponents.forEach((comp) => {
        const varType = comp.variableType || comp.name;
        const nominalValue = parseFloat(comp.nominal);
        const existingInput = uncertaintyInputs[varType];
        const nativeUnit = comp.unit_native || comp.unit || existingInput?.unit || "";
        const uNative =
          comp.value_native !== undefined && comp.value_native !== null
            ? parseFloat(comp.value_native)
            : parseFloat(comp.value);

        if (existingInput && !isNaN(uNative) && nativeUnit) {
          const uBase = unitSystem.toBaseUnit(uNative, nativeUnit);
          if (!isNaN(uBase)) {
            existingInput.ui_squared_sum_base += uBase ** 2;
          }
          return;
        }

        if (!isNaN(nominalValue)) {
          // Normalize manual input to Base Units
          const nominalInBase = comp.unit 
            ? unitSystem.toBaseUnit(nominalValue, comp.unit)
            : nominalValue;

          // Convert uncertainty value to Base Units
          // Check if value is provided in Base or Native. 
          // Usually manualComponents store 'value' as calculated standard uncertainty in NATIVE units (if unit provided) or PPM?
          // For simplicity in this context, assuming 'value' is absolute in the component's unit.
          const u_val_native = parseFloat(comp.value) || 0; 
          const u_val_base = comp.unit ? unitSystem.toBaseUnit(u_val_native, comp.unit) : u_val_native;
          
          const variance_base = u_val_base ** 2;

          if (uncertaintyInputs[varType]) {
            uncertaintyInputs[varType].ui_squared_sum_base += variance_base;
          } else {
            uncertaintyInputs[varType] = {
              ui_squared_sum_base: variance_base,
              nominalBase: nominalInBase,
              unit: comp.unit || "",
            };
          }
        }
      });
    }

    // New derived-point workflow: equation input nominals live on the test
    // point, independent of the TMDEs the user later chooses for each input
    // budget. These nominal-only inputs evaluate the equation and create
    // zero-uncertainty input budgets until TMDE/manual contributors are added.
    const variableNominals = derivedNominalPoint?.variableNominals || {};
    Object.entries(variableMappings || {}).forEach(([symbol, type]) => {
      const nominal = variableNominals[symbol] || variableNominals[type];
      const value = parseFloat(nominal?.value);
      const unit = nominal?.unit || "";
      if (!type || !unit || isNaN(value) || uncertaintyInputs[type]) return;

      const nominalInBase = unitSystem.toBaseUnit(value, unit);
      if (isNaN(nominalInBase)) return;

      uncertaintyInputs[type] = {
        ui_squared_sum_base: 0,
        nominalBase: nominalInBase,
        unit,
      };
    });

    // --- 5. POPULATE NOMINAL SCOPE (Base Units) ---
    Object.keys(variableMappings).forEach((symbol) => {
      const mappedType = variableMappings[symbol];
      const inputData = uncertaintyInputs[mappedType];

      if (inputData) {
        nominalScope[symbol] = inputData.nominalBase;
      }
    });

    // --- 6. VALIDATE ALL VARIABLES ARE PRESENT ---
    const missingSymbols = variables.filter(sym => nominalScope[sym] === undefined);

    if (missingSymbols.length > 0) {
      const missingTypes = missingSymbols.map(sym => variableMappings[sym]);
      return {
        combinedUncertaintyNative: NaN,
        breakdown: [],
        nominalResult: NaN,
        error: `Waiting for values for: ${[...new Set(missingTypes)].join(", ")}`,
        missingInputs: true,
        missingTypes: missingTypes
      };
    }

    // Pre-calculate final uncertainty for each input type
    Object.keys(uncertaintyInputs).forEach((type) => {
      uncertaintyInputs[type].ui_base = Math.sqrt(
        uncertaintyInputs[type].ui_squared_sum_base
      );
    });

    // --- 7. CALCULATE SENSITIVITY & COMBINED UNCERTAINTY (Base Units) ---
    variables.forEach((variableSymbol) => {
      const variableType = variableMappings[variableSymbol];
      const inputData = uncertaintyInputs[variableType];

      const ui_base = inputData.ui_base;

      // MathJS Derivative
      const derivativeNode = math.derivative(node, variableSymbol);
      const derivativeStr = derivativeNode.toString();
      const derivativeFunc = derivativeNode.compile();

      // Sensitivity in Base Units: d(ResultBase) / d(InputBase)
      const sensitivityCoeffBase = derivativeFunc.evaluate(nominalScope);

      if (isNaN(sensitivityCoeffBase)) {
        if (sensitivityCoeffBase && typeof sensitivityCoeffBase === 'object') {
          throw new Error(`Derivative for '${variableSymbol}' is Complex. Check equation domain.`);
        }
        throw new Error(`Could not evaluate derivative for '${variableSymbol}' (Result: NaN).`);
      }

      // Contribution to uncertainty in Base Units
      const contribution_base = sensitivityCoeffBase * ui_base;
      const termSquared_base = contribution_base ** 2;

      sumOfSquaresBase += termSquared_base;

      // --- Nonlinearity probe (stationary-point detection) ---
      // First-order GUM is blind to an input whose ∂f/∂x evaluates to 0 at the
      // operating point (null/balance measurements, unity power factor, RSS
      // terms near zero): the input's uncertainty silently vanishes from the
      // budget. Probe the symbolic second derivative so we can warn when the
      // ½·|f″|·u² term is non-negligible against the linear term, and hard-fail
      // below when the WHOLE budget degenerates to zero.
      let secondOrderTermBase = null;
      let secondDerivativeString = null;
      let secondDerivativeBase = null;
      try {
        const secondDerivNode = math.derivative(derivativeNode, variableSymbol);
        const secondDeriv = secondDerivNode.compile().evaluate(nominalScope);
        if (typeof secondDeriv === "number" && Number.isFinite(secondDeriv)) {
          secondDerivativeString = secondDerivNode.toString();
          secondDerivativeBase = secondDeriv;
          secondOrderTermBase = 0.5 * Math.abs(secondDeriv) * ui_base ** 2;
        }
      } catch {
        // Not twice-differentiable (or a domain issue) — skip the probe; the
        // zero-sensitivity check below still applies.
      }

      let nonlinearityWarning = null;
      const firstOrderTermBase = Math.abs(contribution_base);
      if (ui_base > 0) {
        if (sensitivityCoeffBase === 0) {
          nonlinearityWarning = `Input '${variableSymbol}' (${variableType}) has zero first-order sensitivity at this operating point, so its uncertainty does not appear in the linear (GUM) budget. The combined uncertainty may be understated.`;
        } else if (
          secondOrderTermBase !== null &&
          secondOrderTermBase > NONLINEARITY_WARN_RATIO * firstOrderTermBase
        ) {
          const pct = Math.round(
            (secondOrderTermBase / firstOrderTermBase) * 100
          );
          nonlinearityWarning = `Input '${variableSymbol}' (${variableType}): the second-order Taylor term is ~${pct}% of its first-order contribution at this operating point. The linear (GUM) budget may understate this input.`;
        }
      }
      if (nonlinearityWarning) warnings.push(nonlinearityWarning);

      // Convert Sensitivity for Display: d(TargetUnit) / d(InputNativeUnit)
      // ci_display = ci_base * (InputToSi / TargetToSi)
      const inputToSi = unitSystem.units[inputData.unit]?.to_si || 1;
      const ci_display = sensitivityCoeffBase * (inputToSi / targetToSi);

      // Convert Contribution for Display (Target Unit)
      const contribution_target = Math.abs(contribution_base / targetToSi);

      calculationBreakdown.push({
        variable: variableSymbol,
        type: variableType,
        nominal: unitSystem.fromBaseUnit(inputData.nominalBase, inputData.unit), // Display nominal in native unit
        unit: inputData.unit,
        ui_absolute_base: ui_base, 
        ci: ci_display, // Sensitivity scaled to units
        derivativeString: derivativeStr,
        contribution_native: contribution_target, // This matches the "Native" field expected by UI
        // SIGNED contribution in base SI units. Used by combineWithCorrelation
        // so cross-correlation terms carry the correct sign (a negative
        // sensitivity + positive correlation reduces u_c).
        contribution_base_signed: contribution_base,
        // Stable identity for the correlation map (matches the budget row's type).
        componentId: variableType,
        termSquared_native: termSquared_base, // Used for Pareto, strictly doesn't matter as long as proportional
        // Stationary-point / nonlinearity diagnostics (null when healthy).
        secondOrderTerm_base: secondOrderTermBase,
        nonlinearityWarning,
        // Second-order Taylor data for the breakdown modal: the symbolic
        // ∂²f/∂x², its value scaled to display units (d²(target)/d(input)²),
        // the |½·f″·u²| magnitude in the derived unit, and the SIGNED mean
        // shift ½·f″·u² this input induces (E[y] correction).
        secondDerivativeString,
        secondDerivative_display:
          secondDerivativeBase === null
            ? null
            : secondDerivativeBase * ((inputToSi * inputToSi) / targetToSi),
        secondOrderTerm_native:
          secondOrderTermBase === null
            ? null
            : secondOrderTermBase / targetToSi,
        secondOrderShift_native:
          secondDerivativeBase === null
            ? null
            : (0.5 * secondDerivativeBase * ui_base ** 2) / targetToSi,
      });
      if (secondOrderTermBase !== null) {
        sumSecondOrderSquaresBase += secondOrderTermBase ** 2;
        secondOrderShiftBase += 0.5 * secondDerivativeBase * ui_base ** 2;
        if (secondOrderTermBase > 0) hasSecondOrderTerms = true;
      }
    });

    // Second-order Taylor summary (display units). Null for effectively
    // linear equations so the UI adds nothing. The variance follows the GUM
    // higher-order note (diagonal terms): u² ≈ Σ(cᵢuᵢ)² + Σ(½f″ᵢuᵢ²)², and
    // the mean shift is E[y] − f(x̄) ≈ Σ½f″ᵢuᵢ².
    const secondOrder = hasSecondOrderTerms
      ? {
          combinedUncertaintyNative: unitSystem.fromBaseUnit(
            Math.sqrt(sumOfSquaresBase + sumSecondOrderSquaresBase),
            targetUnit
          ),
          meanShiftNative: secondOrderShiftBase / targetToSi,
        }
      : null;

    // Stationary-point guard: every input's first-order sensitivity is zero
    // while at least one input actually carries uncertainty. Reporting u_c = 0
    // here would cascade into U = 0 → TUR = ∞ → PFA ≈ 0 — a confidently wrong
    // "no risk" answer at exactly the operating points (nulls, bridge balance,
    // unity power factor) where the linear model is least valid. Fail the same
    // way the NaN-derivative path does, so the risk row blanks with an
    // explanation instead of reporting zero uncertainty.
    if (sumOfSquaresBase === 0) {
      const anyUncertainInput = variables.some(
        (sym) => (uncertaintyInputs[variableMappings[sym]]?.ui_base || 0) > 0
      );
      if (anyUncertainInput) {
        return {
          combinedUncertaintyNative: NaN,
          breakdown: calculationBreakdown,
          nominalResult: NaN,
          error:
            "The equation is at a stationary point: every input's first-order sensitivity is zero at this operating point, so the linear (GUM) budget would report zero uncertainty and infinite TUR. Offset the nominal from the null/stationary point, or evaluate this point with a higher-order or Monte Carlo method.",
          degenerate: true,
          warnings,
          secondOrder,
        };
      }
    }

    // Combined Uncertainty in Base Units
    const combinedUncertaintyBase = math.sqrt(sumOfSquaresBase);
    
    // Convert Combined Uncertainty to Target Unit
    const combinedUncertaintyTarget = unitSystem.fromBaseUnit(combinedUncertaintyBase, targetUnit);

    // Calculate Nominal Result in Base Units
    let nominalResultBase = NaN;
    try {
      nominalResultBase = node.compile().evaluate(nominalScope);
    } catch (evalError) {
      console.error("Error evaluating nominal equation result:", evalError);
    }

    // Convert Nominal Result to Target Unit
    const nominalResultTarget = unitSystem.fromBaseUnit(nominalResultBase, targetUnit);

    return {
      combinedUncertaintyNative: combinedUncertaintyTarget,
      breakdown: calculationBreakdown,
      nominalResult: nominalResultTarget,
      error: null,
      warnings,
      secondOrder,
    };

  } catch (error) {
    console.error("Error calculating derived uncertainty:", error);
    return {
      combinedUncertaintyNative: NaN,
      breakdown: [],
      nominalResult: NaN,
      error: error.message,
    };
  }
};

/**
* Smart Lookup for Instrument Specs
* 1. Matches the Function based on unit (e.g. "V" matches "DC Voltage" if unit is V)
* 2. Normalizes measurement value to instrument base unit (mV -> V)
* 3. Finds the specific Range where value falls between Min/Max
* 4. Returns the tolerance object for that range
*/
/**
 * Smart Lookup for Instrument Specs (ALL Matches)
 * Returns ARRAY of matches or NULL if none found.
 */
export const findMatchingTolerances = (instrument, value, unit) => {
  if (!instrument || !value || !unit) return null;

  const numValue = parseFloat(value);
  if (isNaN(numValue)) return null;

  // 1. Find Matching Functions
  const matchedFunctions = instrument.functions.filter(f => {
    const funcUnit = unitSystem.units[f.unit];
    const inputUnit = unitSystem.units[unit];
    return funcUnit && inputUnit && funcUnit.quantity === inputUnit.quantity;
  });

  if (matchedFunctions.length === 0) return null;

  const allMatches = [];

  matchedFunctions.forEach(func => {
    // 2. Convert Input Value to Function's Base Unit
    const inputToSi = unitSystem.units[unit].to_si;
    const funcToSi = unitSystem.units[func.unit].to_si;
    const valueInBase = (numValue * inputToSi) / funcToSi;

    // 3. Find Ranges
    func.ranges.forEach(r => {
      const min = parseFloat(r.min);
      const max = parseFloat(r.max);
      const absVal = Math.abs(valueInBase);

      if (absVal >= min && absVal <= max) {
        allMatches.push({
          tolerance: r.tolerances,
          rangeMax: r.max,
          rangeUnit: func.unit,
          resolution: r.resolution,
          rangeInfo: `${r.min}-${r.max} ${getUnitDisplayLabel(func.unit)}`,
          id: Date.now() + Math.random() // Unique ID for selection
        });
      }
    });
  });

  return allMatches.length > 0 ? allMatches : null;
};

/**
 * Legacy Wrapper: Returns the BEST match (smallest range usually)
 * Preserves existing behavior for parts of the app not yet updated.
 */
export const findInstrumentTolerance = (instrument, value, unit) => {
  const matches = findMatchingTolerances(instrument, value, unit);
  if (!matches) return null;

  // improved heuristic: prefer smallest rangeMax (tightest fit)
  // The previous logic sorted by ranges.max before finding, so we replicate that preference.
  return matches.sort((a, b) => parseFloat(a.rangeMax) - parseFloat(b.rangeMax))[0];
};

// ==========================================
// 4. Instrument Logic
// ==========================================

export const recalculateTolerance = (instrument, value, unit, existingData = {}) => {
  let matchedData = null;

  // CHECK: Did we pass a specific resolved match (from the Ambiguity Modal or Range Lookup)?
  // A "Match Object" typically has { tolerance: {...}, rangeMax: ..., id: ... }
  if (existingData && existingData.tolerance && existingData.rangeInfo) {
    matchedData = existingData;
  } else {
    // Fallback to auto-detection (Best Fit) if we just passed an old tolerance object
    matchedData = findInstrumentTolerance(instrument, parseFloat(value), unit);
  }

  if (!matchedData) return null;

  // Deep copy the raw specs from the matched range
  const specs = JSON.parse(JSON.stringify(matchedData.tolerances || matchedData.tolerance || {}));

  // Determine Range Max for 'range' specs
  let calculatedRangeMax = matchedData.rangeMax;
  if (!calculatedRangeMax) calculatedRangeMax = parseFloat(value);

  // Apply updates to the specs structure (units, range values, etc.)
  const compKeys = ['reading', 'range', 'floor', 'readings_iv', 'db'];

  compKeys.forEach(key => {
    if (specs[key]) {
      if (!specs[key].unit) {
        if (key === 'reading' || key === 'range') specs[key].unit = '%';
        else if (key === 'floor' || key === 'readings_iv') specs[key].unit = unit;
      }
      if (key === 'range') {
        if (specs[key].value === undefined || specs[key].value === null || specs[key].value === "") {
             specs[key].value = calculatedRangeMax;
        }
      }
      if (specs[key].high) {
        const highVal = parseFloat(specs[key].high);
        if (!isNaN(highVal)) {
          specs[key].low = String(-Math.abs(highVal));
        }
        specs[key].symmetric = true;
      }
    }
  });

  // Return a CLEAN object. 
  // We do NOT spread 'existingData' directly because it might contain the raw 'tolerance' object 
  // or other metadata from the lookup that we don't want polluting the actual tolerance state.
  // We only preserve specific keys if 'existingData' was actually a previous Tolerance State, 
  // but in the "Edit UUT" flow, we usually want to Replace, not Merge, when switching ranges.

  return {
    ...specs,
    measuringResolution: matchedData.resolution
  };
};

// ==========================================
// 5. Bivariate & Normal Distributions
// ==========================================

export function CumNorm(x) {
  const XAbs = Math.abs(x);
  let Build;
  let Exponential;

  if (XAbs > 37) {
    if (x > 0) {
      return 1.0;
    } else {
      return 0.0;
    }
  } else {
    Exponential = Math.exp((-XAbs * XAbs) / 2);
    if (XAbs < 7.07106781186547) {
      Build = 3.52624965998911e-2 * XAbs + 0.700383064443688;
      Build = Build * XAbs + 6.37396220353165;
      Build = Build * XAbs + 33.912866078383;
      Build = Build * XAbs + 112.079291497871;
      Build = Build * XAbs + 221.213596169931;
      Build = Build * XAbs + 220.206867912376;
      let CumNormVal = Exponential * Build;

      Build = 8.83883476483184e-2 * XAbs + 1.75566716318264;
      Build = Build * XAbs + 16.064177579207;
      Build = Build * XAbs + 86.7807322029461;
      Build = Build * XAbs + 296.564248779674;
      Build = Build * XAbs + 637.333633378831;
      Build = Build * XAbs + 793.826512519948;
      Build = Build * XAbs + 440.413735824752;
      CumNormVal = CumNormVal / Build;

      if (x > 0) {
        return 1 - CumNormVal;
      } else {
        return CumNormVal;
      }
    } else {
      Build = XAbs + 0.65;
      Build = XAbs + 4 / Build;
      Build = XAbs + 3 / Build;
      Build = XAbs + 2 / Build;
      Build = XAbs + 1 / Build;
      let CumNormVal = Exponential / Build / 2.506628274631;

      if (x > 0) {
        return 1 - CumNormVal;
      } else {
        return CumNormVal;
      }
    }
  }
}

export function InvNormalDistribution(y0) {
  const Expm2 = 0.135335283236613;
  const S2Pi = 2.506628274631;
  const MaxRealNumber = Number.MAX_VALUE;

  if (y0 <= 0) return -MaxRealNumber;
  if (y0 >= 1) return MaxRealNumber;

  let y = y0;
  let code = 1;

  if (y > 1 - Expm2) {
    y = 1 - y;
    code = 0;
  }

  if (y > Expm2) {
    y -= 0.5;
    const y2 = y * y;
    let P0 = -59.9633501014108;
    P0 = 98.0010754186 + y2 * P0;
    P0 = -56.676285746907 + y2 * P0;
    P0 = 13.931260938728 + y2 * P0;
    P0 = -1.23916583867381 + y2 * P0;
    let Q0 = 1;
    Q0 = 1.95448858338142 + y2 * Q0;
    Q0 = 4.67627912898882 + y2 * Q0;
    Q0 = 86.3602421390891 + y2 * Q0;
    Q0 = -225.462687854119 + y2 * Q0;
    Q0 = 200.260212380061 + y2 * Q0;
    Q0 = -82.0372256168333 + y2 * Q0;
    Q0 = 15.9056225126212 + y2 * Q0;
    Q0 = -1.1833162112133 + y2 * Q0;
    let x = y + (y * y2 * P0) / Q0;
    return x * S2Pi;
  }

  let x = Math.sqrt(-2 * Math.log(y));
  const x0 = x - Math.log(x) / x;
  const z = 1 / x;
  let x1;

  if (x < 8) {
    let P1 = 4.05544892305962;
    P1 = 31.5251094599894 + z * P1;
    P1 = 57.1628192246421 + z * P1;
    P1 = 44.0805073893201 + z * P1;
    P1 = 14.6849561928858 + z * P1;
    P1 = 2.1866330685079 + z * P1;
    P1 = -(1.40256079171354 * 0.1) + z * P1;
    P1 = -(3.50424626827848 * 0.01) + z * P1;
    P1 = -(8.57456785154685 * 0.0001) + z * P1;

    let Q1 = 1;
    Q1 = 15.7799883256467 + z * Q1;
    Q1 = 45.3907635128879 + z * Q1;
    Q1 = 41.3172038254672 + z * Q1;
    Q1 = 15.0425385692908 + z * Q1;
    Q1 = 2.50464946208309 + z * Q1;
    Q1 = -(1.42182922854788 * 0.1) + z * Q1;
    Q1 = -(3.80806407691578 * 0.01) + z * Q1;
    Q1 = -(9.33259480895457 * 0.0001) + z * Q1;

    x1 = (z * P1) / Q1;
  } else {
    let P2 = 3.23774891776946;
    P2 = 6.91522889068984 + z * P2;
    P2 = 3.93881025292474 + z * P2;
    P2 = 1.33303460815808 + z * P2;
    P2 = 0.201485389549179 + z * P2;
    P2 = 0.012371663481782 + z * P2;
    P2 = 0.000301581553508235 + z * P2;
    P2 = 0.00000265806974686738 + z * P2;
    P2 = 0.00000000623974539184983 + z * P2;

    let Q2 = 1;
    Q2 = 6.02427039364742 + z * Q2;
    Q2 = 3.67983563856161 + z * Q2;
    Q2 = 1.37702099489081 + z * Q2;
    Q2 = 0.216236993594497 + z * Q2;
    Q2 = 0.0134204006088543 + z * Q2;
    Q2 = 0.000328014464682128 + z * Q2;
    Q2 = 0.00000289247864745381 + z * Q2;
    Q2 = 0.00000000679019408009981 + z * Q2;

    x1 = (z * P2) / Q2;
  }

  x = x0 - x1;
  return code !== 0 ? -x : x;
}

export function PHID(z) {
  const P = [
    220.206867912376, 221.213596169931, 112.079291497871, 33.912866078383,
    6.37396220353165, 0.700383064443688, 0.0352624965998911,
  ];
  const Q = [
    440.413735824752, 793.826512519948, 637.333633378831, 296.564248779674,
    86.7807322029461, 16.064177579207, 1.75566716318264, 0.0883883476483184,
  ];
  const CUTOFF = 8;
  const ZABS = Math.abs(z);
  let p;

  if (ZABS > CUTOFF) {
    p = 0;
  } else {
    const EXPNTL = Math.exp(-Math.pow(ZABS, 2) / 2);
    const numerator =
      (((((P[6] * ZABS + P[5]) * ZABS + P[4]) * ZABS + P[3]) * ZABS + P[2]) *
        ZABS +
        P[1]) *
      ZABS +
      P[0];
    const denominator =
      ((((((Q[7] * ZABS + Q[6]) * ZABS + Q[5]) * ZABS + Q[4]) * ZABS +
        Q[3]) *
        ZABS +
        Q[2]) *
        ZABS +
        Q[1]) *
      ZABS +
      Q[0];
    p = (EXPNTL * numerator) / denominator;
  }
  return z > 0 ? 1 - p : p;
}

export function PHIDInv(p) {
  return InvNormalDistribution(p);
}

export function bivariateNormalCDF(A, B, r) {
  const x_quad = [0.04691008, 0.23076534, 0.5, 0.76923466, 0.95308992];
  const w_quad = [
    0.018854042, 0.038088059, 0.0452707394, 0.038088059, 0.018854042,
  ];

  let h1 = A;
  let h2 = B;
  let h12 = (h1 * h1 + h2 * h2) / 2.0;
  let LH = 0.0;

  if (Math.abs(r) < 0.7) {
    let h3 = h1 * h2;
    if (r !== 0) {
      for (let i = 0; i < 5; i++) {
        let r1 = r * x_quad[i];
        let r2 = 1 - r1 * r1;
        LH = LH + (w_quad[i] * Math.exp((r1 * h3 - h12) / r2)) / Math.sqrt(r2);
      }
    }
    return CumNorm(h1) * CumNorm(h2) + r * LH;
  } else {
    let r2 = 1 - r * r;
    let r3 = Math.sqrt(r2);
    if (r < 0) {
      h2 = -h2;
    }
    let h3 = h1 * h2;
    let h7 = Math.exp(-h3 / 2.0);

    if (Math.abs(r) < 1) {
      let h6 = Math.abs(h1 - h2);
      let h5 = (h6 * h6) / 2.0;
      h6 = h6 / r3;
      let AA = 0.5 - h3 / 8.0;
      let ab = 3 - 2 * AA * h5;
      LH =
        0.13298076 * h6 * ab * (1 - CumNorm(h6)) -
        Math.exp(-h5 / r2) * (ab + AA * r2) * 0.053051647;

      for (let i = 0; i < 5; i++) {
        let r1 = r3 * x_quad[i];
        let rr = r1 * r1;
        let r2_inner = Math.sqrt(1 - rr);
        LH =
          LH -
          w_quad[i] *
          Math.exp(-h5 / rr) *
          (Math.exp(-h3 / (1 + r2_inner)) / r2_inner / h7 - 1 - AA * rr);
      }
    }

    let BiVar = LH * r3 * h7 + CumNorm(Math.min(h1, h2));
    if (r < 0) {
      BiVar = CumNorm(h1) - BiVar;
    }
    return BiVar;
  }
}

// ==========================================
// 5. Risk Analysis & Reliability Functions
// ==========================================

// --- SHARED HELPERS ---
const isNotNumeric = (val) => isNaN(parseFloat(val));
const vbaNbrValidate = (val) => (isNotNumeric(val) ? 0 : parseFloat(val));

export function vbNormSDist(ZVal) {
  return CumNorm(ZVal);
}

export function uutUnc(r, uCal, LLow, LUp) {
  const Mid = (LUp + LLow) / 2;
  const halfLUp = Math.abs(LUp - Mid);
  const uDev = halfLUp / InvNormalDistribution((1 + r) / 2);
  const uUUT2 = Math.pow(uDev, 2) - Math.pow(uCal, 2);
  const uUUT = uUUT2 <= 0 ? 0 : Math.sqrt(uUUT2);
  return uUUT;
}

// VBA passes these limits ByRef. UUTunc rewrites them to a symmetric
// +/- half-span, and its callers continue calculating with the rewritten pair.
function vbaUutUnc(r, uCal, LLow, LUp) {
  const mid = (LUp + LLow) / 2;
  const low = -Math.abs(LLow - mid);
  const up = Math.abs(LUp - mid);
  return { uUUT: uutUnc(r, uCal, low, up), low, up };
}

export function uutUncLL(r, uCal, Avg, LLow) {
  let workingAvg = Avg;
  let workingLLow = LLow;
  if (workingLLow > workingAvg) {
    const temp = workingAvg;
    workingAvg = workingLLow;
    workingLLow = temp;
  }
  const uDev = (workingLLow - workingAvg) / InvNormalDistribution(1 - r);
  const uUUT2 = Math.pow(uDev, 2) - Math.pow(uCal, 2);
  const uUUT = uUUT2 <= 0 ? 0 : Math.sqrt(uUUT2);
  return uUUT;
}

export function uutUncUL(r, uCal, avg, LUp) {
  let workingAvg = avg;
  let workingLUp = LUp;
  if (workingLUp < workingAvg) {
    const temp = workingAvg;
    workingAvg = workingLUp;
    workingLUp = temp;
  }
  const uDev = (workingLUp - workingAvg) / InvNormalDistribution(r);
  const uUUT2 = Math.pow(uDev, 2) - Math.pow(uCal, 2);
  const uUUT = uUUT2 <= 0 ? 0 : Math.sqrt(uUUT2);
  return uUUT;
}

export function ObsRel(
  sRiskType,
  dCalUnc,
  dMeasRel,
  dAvg,
  dTolLow,
  dTolUp,
  dMeasUnc
) {
  let dBiasUnc, dDevUnc;

  if (sRiskType === "NotThreshold") {
    const normalized = vbaUutUnc(dMeasRel, dCalUnc, dTolLow, dTolUp);
    dBiasUnc = normalized.uUUT;
    dTolLow = normalized.low;
    dTolUp = normalized.up;
    dDevUnc = Math.sqrt(Math.pow(dMeasUnc, 2) + Math.pow(dBiasUnc, 2));
    return vbNormSDist(dTolUp / dDevUnc) - vbNormSDist(dTolLow / dDevUnc);
  }

  if (sRiskType === "UpThreshold") {
    dBiasUnc = uutUncUL(dMeasRel, dCalUnc, dAvg, dTolUp);
    dDevUnc = Math.sqrt(Math.pow(dMeasUnc, 2) + Math.pow(dBiasUnc, 2));
    return vbNormSDist((dTolUp - dAvg) / dDevUnc);
  }

  if (sRiskType === "LowThreshold") {
    dBiasUnc = uutUncLL(dMeasRel, dCalUnc, dAvg, dTolLow);
    dDevUnc = Math.sqrt(Math.pow(dMeasUnc, 2) + Math.pow(dBiasUnc, 2));
    return 1 - vbNormSDist((dTolLow - dAvg) / dDevUnc);
  }

  return 0;
}

export function PredRel(
  sRiskType,
  dCalUnc,
  dMeasRel,
  dAvg,
  dTolLow,
  dTolUp,
  dMeasUnc,
  dGBLow,
  dGBUp
) {
  let dBiasUnc, dDevUnc;

  if (sRiskType === "NotThreshold") {
    const normalized = vbaUutUnc(dMeasRel, dCalUnc, dGBLow, dGBUp);
    dBiasUnc = normalized.uUUT;
    dGBLow = normalized.low;
    dGBUp = normalized.up;
    dDevUnc = Math.sqrt(Math.pow(dMeasUnc, 2) + Math.pow(dBiasUnc, 2));
    return vbNormSDist(dTolUp / dDevUnc) - vbNormSDist(dTolLow / dDevUnc);
  }

  if (sRiskType === "UpThreshold") {
    dBiasUnc = uutUncUL(dMeasRel, dCalUnc, dAvg, dGBUp);
    dDevUnc = Math.sqrt(Math.pow(dMeasUnc, 2) + Math.pow(dBiasUnc, 2));
    return vbNormSDist((dTolUp - dAvg) / dDevUnc);
  }

  if (sRiskType === "LowThreshold") {
    dBiasUnc = uutUncLL(dMeasRel, dCalUnc, dAvg, dGBLow);
    dDevUnc = Math.sqrt(Math.pow(dMeasUnc, 2) + Math.pow(dBiasUnc, 2));
    return 1 - vbNormSDist((dTolLow - dAvg) / dDevUnc);
  }

  return 0;
}

// ==========================================
// 6. Risk Managers (TUR, TAR, PFA, PFR, Guard Band)
// ==========================================

function getTolInfo(rngNominal, rngAvg, rngTolLow, rngTolUp) {
  const bNoNominal = isNotNumeric(rngNominal);
  const bNoAvg = isNotNumeric(rngAvg);
  const bNoTolLow = isNotNumeric(rngTolLow);
  const bNoTolUp = isNotNumeric(rngTolUp);

  if (bNoTolLow && bNoTolUp) return ["Fail"];

  let dNominal = vbaNbrValidate(rngNominal);
  let dAvg = vbaNbrValidate(rngAvg);
  let dTolLow = vbaNbrValidate(rngTolLow);
  let dTolUp = vbaNbrValidate(rngTolUp);
  const bIsThreshold = (bNoTolLow && !bNoTolUp) || (bNoTolUp && !bNoTolLow);

  if (bIsThreshold) {
    if (bNoTolLow) {
      if (bNoNominal) dNominal = dTolUp;
      if (bNoAvg) {
        dAvg = dNominal;
        return ["AltUpThreshold", dNominal, dAvg, dTolLow, dTolUp, bIsThreshold];
      } else {
        return ["UpThreshold", dNominal, dAvg, dTolLow, dTolUp, bIsThreshold];
      }
    } else if (bNoTolUp) {
      if (bNoNominal) dNominal = dTolLow;
      if (bNoAvg) {
        dAvg = dNominal;
        return ["AltLowThreshold", dNominal, dAvg, dTolLow, dTolUp, bIsThreshold];
      } else {
        return ["LowThreshold", dNominal, dAvg, dTolLow, dTolUp, bIsThreshold];
      }
    }
  } else {
    if (dTolLow >= dTolUp) return ["Fail"];
    dNominal = (dTolLow + dTolUp) / 2;
    if (!bNoAvg && dNominal !== dAvg) {
      if (dAvg > dTolLow && dAvg < dTolUp) {
        dNominal = dAvg;
      }
    }
    dTolLow = dTolLow - dNominal;
    dTolUp = dTolUp - dNominal;
    return ["NotThreshold", dNominal, dAvg, dTolLow, dTolUp, bIsThreshold];
  }
  return ["Fail"];
}

function getRiskInfo(rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel) {
  const [sRiskType, dNominal, dAvg, dTolLow, dTolUp, bIsThreshold] = getTolInfo(
    rngNominal, rngAvg, rngTolLow, rngTolUp
  );

  const bNoMeasUnc = isNotNumeric(rngMeasUnc);
  const bNoMeasRel = isNotNumeric(rngMeasRel);

  if (bNoMeasUnc || bNoMeasRel) return ["Fail"];

  const dMeasUnc = vbaNbrValidate(rngMeasUnc);
  const dMeasRel = vbaNbrValidate(rngMeasRel);

  return [sRiskType, dNominal, dAvg, dTolLow, dTolUp, dMeasUnc, dMeasRel, bIsThreshold];
}

function GetGBInfo(rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel, rngGBLow, rngGBUp) {
  const [sRiskType, dNominal, dAvg, dTolLow, dTolUp, dMeasUnc, dMeasRel, bIsThreshold] = getRiskInfo(
    rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel
  );

  let dGBLow = vbaNbrValidate(rngGBLow);
  let dGBUp = vbaNbrValidate(rngGBUp);

  if (dGBLow === 0 && dGBUp === 0) {
    return [sRiskType, dNominal, dAvg, dTolLow, dTolUp, dMeasUnc, dMeasRel, dGBLow, dGBUp];
  }

  if (!bIsThreshold) {
    dGBLow = dGBLow - dNominal;
    dGBUp = dGBUp - dNominal;
  }

  return [sRiskType, dNominal, dAvg, dTolLow, dTolUp, dMeasUnc, dMeasRel, dGBLow, dGBUp];
}

function calRelwTUR(sRiskType, rngTUR, rngReqTUR, dMeasUnc, dMeasRel, dTolLow, dTolUp, dAvg) {
  if (rngReqTUR === "" || rngReqTUR === null) return dMeasRel;

  let dReqTur = parseFloat(rngReqTUR);
  let dTUR = parseFloat(rngTUR);
  let dCalUnc;

  if (sRiskType === "NotThreshold" || sRiskType === "UpThreshold" || sRiskType === "LowThreshold") {
    if (dReqTur > 0) {
      dCalUnc = (dMeasUnc * dTUR) / dReqTur;
    } else {
      return dMeasRel;
    }
  } else {
    return dMeasRel;
  }

  let dBiasUnc, dDevUnc;

  if (sRiskType === "NotThreshold") {
    const normalized = vbaUutUnc(dMeasRel, dCalUnc, dTolLow, dTolUp);
    dBiasUnc = normalized.uUUT;
    dTolLow = normalized.low;
    dTolUp = normalized.up;
    dDevUnc = Math.sqrt(dMeasUnc * dMeasUnc + dBiasUnc * dBiasUnc);
    dMeasRel = vbNormSDist(dTolUp / dDevUnc) - vbNormSDist(dTolLow / dDevUnc);
  } else if (sRiskType === "UpThreshold") {
    dBiasUnc = uutUncUL(dMeasRel, dCalUnc, dAvg, dTolUp);
    dDevUnc = Math.sqrt(dMeasUnc * dMeasUnc + dBiasUnc * dBiasUnc);
    dMeasRel = vbNormSDist((dTolUp - dAvg) / dDevUnc);
  } else if (sRiskType === "LowThreshold") {
    dBiasUnc = uutUncLL(dMeasRel, dCalUnc, dAvg, dTolLow);
    dDevUnc = Math.sqrt(dMeasUnc * dMeasUnc + dBiasUnc * dBiasUnc);
    dMeasRel = 1 - vbNormSDist((dTolLow - dAvg) / dDevUnc);
  }

  return dMeasRel;
}

// --- CORE PFA MATH FUNCTIONS ---
function PFA_Core(uUUT, uCal, LLow, LUp, ALow, AUp) {
  const uDev = Math.sqrt(Math.pow(uUUT, 2) + Math.pow(uCal, 2));
  const cor = uUUT / uDev;
  const term1 = bivariateNormalCDF(LLow / uUUT, AUp / uDev, cor) - bivariateNormalCDF(LLow / uUUT, ALow / uDev, cor);
  const term2 = bivariateNormalCDF(-LUp / uUUT, -ALow / uDev, cor) - bivariateNormalCDF(-LUp / uUUT, -AUp / uDev, cor);
  return [term1 + term2, term1, term2, uUUT, uDev, cor];
}

function PFAUL_Core(uUUT, uCal, avg, LUp, AUp) {
  const uDev = Math.sqrt(Math.pow(uUUT, 2) + Math.pow(uCal, 2));
  const cor = uUUT / uDev;
  const term1 = vbNormSDist((LUp - avg) / uUUT);
  const term2 = bivariateNormalCDF(-(LUp - avg) / uUUT, -(AUp - avg) / uDev, cor);
  return [1 - term1 - term2, term1, term2, uUUT, uDev, cor];
}

function PFALL_Core(uUUT, uCal, avg, LLow, ALow) {
  const uDev = Math.sqrt(Math.pow(uUUT, 2) + Math.pow(uCal, 2));
  const cor = uUUT / uDev;
  const term1 = vbNormSDist((LLow - avg) / uUUT);
  const term2 = bivariateNormalCDF((LLow - avg) / uUUT, (ALow - avg) / uDev, cor);
  return [term1 - term2, term1, term2, uUUT, uDev, cor];
}

// --- CORE PFR MATH FUNCTIONS ---
function PFR_Core(uUUT, uCal, LLow, LUp, ALow, AUp) {
  const uDev = Math.sqrt(Math.pow(uUUT, 2) + Math.pow(uCal, 2));
  const cor = uUUT / uDev;
  const term1 = bivariateNormalCDF(LUp / uUUT, ALow / uDev, cor) - bivariateNormalCDF(LLow / uUUT, ALow / uDev, cor);
  const term2 = bivariateNormalCDF(-LLow / uUUT, -AUp / uDev, cor) - bivariateNormalCDF(-LUp / uUUT, -AUp / uDev, cor);
  return [term1 + term2, term1, term2];
}

function PFRUL_Core(uUUT, uCal, avg, LUp, AUp) {
  const uDev = Math.sqrt(Math.pow(uUUT, 2) + Math.pow(uCal, 2));
  const cor = uUUT / uDev;
  const term1 = vbNormSDist((LUp - avg) / uUUT);
  const term2 = bivariateNormalCDF((LUp - avg) / uUUT, (AUp - avg) / uDev, cor);
  return [term1 - term2, term1, term2];
}

function PFRLL_Core(uUUT, uCal, avg, LLow, ALow) {
  const uDev = Math.sqrt(Math.pow(uUUT, 2) + Math.pow(uCal, 2));
  const cor = uUUT / uDev;
  const term1 = vbNormSDist((LLow - avg) / uUUT);
  const term2 = bivariateNormalCDF(-(LLow - avg) / uUUT, -(ALow - avg) / uDev, cor);
  return [1 - term1 - term2, term1, term2];
}

// --- PFA ITERATION LOGIC (Used by CalInt/CalRel) ---
function PFAIter(sRiskType, dMeasRel, dAvg, dTolLow, dTolUp, dMeasUnc) {
  let dUUTUnc;
  if (sRiskType === "NotThreshold") {
    const normalized = vbaUutUnc(dMeasRel, dMeasUnc, dTolLow, dTolUp);
    dUUTUnc = normalized.uUUT;
    dTolLow = normalized.low;
    dTolUp = normalized.up;
    if (dUUTUnc <= 0) return -1;
    return PFA_Core(dUUTUnc, dMeasUnc, dTolLow, dTolUp, dTolLow, dTolUp)[0];
  }
  if (sRiskType === "UpThreshold") {
    dUUTUnc = uutUncUL(dMeasRel, dMeasUnc, dAvg, dTolUp);
    if (dUUTUnc <= 0) return -1;
    return PFAUL_Core(dUUTUnc, dMeasUnc, dAvg, dTolUp, dTolUp)[0];
  }
  if (sRiskType === "LowThreshold") {
    dUUTUnc = uutUncLL(dMeasRel, dMeasUnc, dAvg, dTolLow);
    if (dUUTUnc <= 0) return -1;
    return PFALL_Core(dUUTUnc, dMeasUnc, dAvg, dTolLow, dTolLow)[0];
  }
  return -1;
}

// ---------------------------------------------------------
// EXPORTED FUNCTIONS
// ---------------------------------------------------------

// NOTE: resDwn/resUp intentionally mirror the spreadsheet's VBA ResDwn/ResUp
// bit-for-bit, INCLUDING a known floating-point quirk: a limit that is exactly
// on the resolution grid (e.g. 0.012750 = 1275 counts) divides to 1274.9999999…
// under IEEE-754, so the trunc/floor drops a whole count (-> 0.012740). That can
// surface a "guard band" (e.g. GB Mult 95.92%) where the solver actually returned
// no guard band. We preserve this on purpose so results match the spreadsheet of
// record exactly. Do NOT add grid-snapping here — see the GB Mult discrepancy
// investigation (it would make us diverge from Excel by ~1 resolution count).
export function resDwn(dVal, dRes) {
  // Pass non-finite values straight through so a failed guard-band solve shows
  // as N/A rather than being silently floored to a misleading number.
  if (!Number.isFinite(dVal)) return dVal;
  if (!Number.isFinite(dRes) || dRes <= 0) return dVal;
  if (dVal === 0) return dVal;
  // Snap to the grid when the value is already within floating-point dust of a
  // grid line. A resolution that round-trips through unit conversion (e.g.
  // 0.1 psig -> SI -> psig = 0.10000000000000002) makes an on-grid limit like
  // 10.5 divide to 104.9999...; floor() then drops it a full resolution count
  // to 10.4, corrupting the acceptance band (and every TUR/TAR/PFA/PFR built on
  // it). Correcting the dust here keeps a genuinely on-grid limit in place while
  // still rounding truly off-grid values inward below.
  const qd = dVal / dRes;
  const qdNearest = Math.round(qd);
  if (Math.abs(qd - qdNearest) < 1e-9) return qdNearest * dRes;
  let x = Math.floor(dVal / dRes) * dRes;
  const dZero = 0.000001;
  if (Math.abs(Math.trunc(dVal / dRes) - dVal / dRes) > dZero) {
    if (dVal > 0) x = x + dRes;
  }
  // Guard: a resolution coarser than the limit can round the value to exactly
  // 0. Never collapse a non-zero guard-band limit to zero (that produced the
  // GBLOW/GBUP "0" display bug); fall back to the unrounded value instead.
  if (x === 0 && dVal !== 0) return dVal;
  return x;
}

export function resUp(dVal, dRes) {
  if (!Number.isFinite(dVal)) return dVal;
  if (!Number.isFinite(dRes) || dRes <= 0) return dVal;
  if (dVal === 0) return dVal;
  // See resDwn: snap to the grid when within floating-point dust of a grid line
  // so an on-grid upper limit (e.g. 10.5 with a round-tripped 0.1 resolution)
  // isn't truncated a full resolution count down to 10.4.
  const qu = dVal / dRes;
  const quNearest = Math.round(qu);
  if (Math.abs(qu - quNearest) < 1e-9) return quNearest * dRes;
  let x = Math.trunc(dVal / dRes) * dRes;
  const dZero = 0.000001;
  if (Math.abs(Math.trunc(dVal / dRes) - dVal / dRes) > dZero) {
    if (dVal < 0) x = x - dRes;
  }
  // See resDwn: don't let a coarse resolution collapse a non-zero limit to 0.
  if (x === 0 && dVal !== 0) return dVal;
  return x;
}

export function calcTAR(rngNominal, rngAvg, rngTolLow, rngTolUp, rngSTDLow, rngSTDUp) {
  let dSTDLow, dSTDUp;
  if (isNaN(parseFloat(rngSTDLow)) || isNaN(parseFloat(rngSTDUp))) {
    return "";
  } else {
    dSTDLow = vbaNbrValidate(rngSTDLow);
    dSTDUp = vbaNbrValidate(rngSTDUp);
  }

  const [sRiskType, dNominal, dAvg, dTolLow, dTolUp] = getTolInfo(rngNominal, rngAvg, rngTolLow, rngTolUp);

  if (sRiskType === "NotThreshold") {
    return Math.abs((dTolUp - dTolLow) / (dSTDUp - dSTDLow));
  } else if (sRiskType === "LowThreshold") {
    return Math.abs((dAvg - dTolLow) / ((dSTDUp - dSTDLow) / 2));
  } else if (sRiskType === "UpThreshold") {
    return Math.abs((dTolUp - dAvg) / ((dSTDUp - dSTDLow) / 2));
  } else {
    return "";
  }
}

export function calcTUR(rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc) {
  let dMeasUnc;
  if (isNaN(parseFloat(rngMeasUnc))) {
    return "";
  } else {
    dMeasUnc = vbaNbrValidate(rngMeasUnc);
  }

  const [sRiskType, dNominal, dAvg, dTolLow, dTolUp] = getTolInfo(rngNominal, rngAvg, rngTolLow, rngTolUp);

  if (sRiskType === "NotThreshold") {
    return Math.abs((dTolUp - dTolLow) / (2 * dMeasUnc));
  } else if (sRiskType === "LowThreshold") {
    return Math.abs((dAvg - dTolLow) / dMeasUnc);
  } else if (sRiskType === "UpThreshold") {
    return Math.abs((dTolUp - dAvg) / dMeasUnc);
  } else {
    return "";
  }
}

export function PFAMgr(rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel, rngTUR, rngReqTUR) {
  let [sRiskType, dNominal, dAvg, dTolLow, dTolUp, dMeasUnc, dMeasRel] = getRiskInfo(
    rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel
  );

  dMeasRel = calRelwTUR(sRiskType, rngTUR, rngReqTUR, dMeasUnc, dMeasRel, dTolLow, dTolUp, dAvg);

  let dUUTUnc;
  if (sRiskType === "NotThreshold") {
    const normalized = vbaUutUnc(dMeasRel, dMeasUnc, dTolLow, dTolUp);
    dUUTUnc = normalized.uUUT;
    dTolLow = normalized.low;
    dTolUp = normalized.up;
    // Only reject truly invalid values (zero or negative)
    // Removed the `dUUTUnc <= dMeasUnc / 10` check to allow low-TUR scenarios to calculate
    if (dUUTUnc <= 0) return ["", "", "", "", "", ""];
    return PFA_Core(dUUTUnc, dMeasUnc, dTolLow, dTolUp, dTolLow, dTolUp);
  } else if (sRiskType === "UpThreshold") {
    dUUTUnc = uutUncUL(dMeasRel, dMeasUnc, dAvg, dTolUp);
    if (dUUTUnc <= 0) return ["", "", "", "", "", ""];
    return PFAUL_Core(dUUTUnc, dMeasUnc, dAvg, dTolUp, dTolUp);
  } else if (sRiskType === "LowThreshold") {
    dUUTUnc = uutUncLL(dMeasRel, dMeasUnc, dAvg, dTolLow);
    if (dUUTUnc <= 0) return ["", "", "", "", "", ""];
    return PFALL_Core(dUUTUnc, dMeasUnc, dAvg, dTolLow, dTolLow);
  }
  return ["", "", "", "", "", ""];
}

export function PFRMgr(rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel, rngTUR, rngReqTUR) {
  let [sRiskType, dNominal, dAvg, dTolLow, dTolUp, dMeasUnc, dMeasRel] = getRiskInfo(
    rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel
  );

  dMeasRel = calRelwTUR(sRiskType, rngTUR, rngReqTUR, dMeasUnc, dMeasRel, dTolLow, dTolUp, dAvg);

  let dUUTUnc;
  if (sRiskType === "NotThreshold") {
    const normalized = vbaUutUnc(dMeasRel, dMeasUnc, dTolLow, dTolUp);
    dUUTUnc = normalized.uUUT;
    dTolLow = normalized.low;
    dTolUp = normalized.up;
    // Only reject truly invalid values (zero or negative)
    if (dUUTUnc <= 0) return ["", "", ""];
    // FIX: Using tolerance limits (dTolLow, dTolUp) as acceptance limits
    return PFR_Core(dUUTUnc, dMeasUnc, dTolLow, dTolUp, dTolLow, dTolUp);
  } else if (sRiskType === "UpThreshold") {
    dUUTUnc = uutUncUL(dMeasRel, dMeasUnc, dAvg, dTolUp);
    if (dUUTUnc <= 0) return ["", "", ""];
    // FIX: Using tolerance limit dTolUp as acceptance limit
    return PFRUL_Core(dUUTUnc, dMeasUnc, dAvg, dTolUp, dTolUp);
  } else if (sRiskType === "LowThreshold") {
    dUUTUnc = uutUncLL(dMeasRel, dMeasUnc, dAvg, dTolLow);
    if (dUUTUnc <= 0) return ["", "", ""];
    // FIX: Using tolerance limit dTolLow as acceptance limit
    return PFRLL_Core(dUUTUnc, dMeasUnc, dAvg, dTolLow, dTolLow);
  }
  return ["", "", ""];
}

export function gbLowMgr(rngReq, rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel) {
  let [sRiskType, dNominal, dAvg, dTolLow, dTolUp, dMeasUnc, dMeasRel] = getRiskInfo(
    rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel
  );
  const dReq = vbaNbrValidate(rngReq);
  let dUUTUnc, GBMult;

  // Helper specific to GB
  function pfaGBMult(req, uUUT, uCal, LLow, LUp) {
    const uDev = Math.sqrt(Math.pow(uUUT, 2) + Math.pow(uCal, 2));
    const REOP = vbNormSDist(LUp / uDev) - vbNormSDist(LLow / uDev);
    const precision = 0.00001;
    let GBMult = 1;
    let AUp = LUp;
    let ALow = LLow;
    let uUUT_GB = uutUnc(REOP, uCal, ALow, AUp);

    let EstPFA = PFA_Core(uUUT_GB, uCal, LLow, LUp, ALow, AUp)[0];

    if (EstPFA > req) {
      let change = 0.05;
      do {
        GBMult -= change;
        AUp = LUp * GBMult;
        ALow = LLow * GBMult;
        uUUT_GB = uutUnc(REOP, uCal, ALow, AUp);
        EstPFA = PFA_Core(uUUT_GB, uCal, LLow, LUp, ALow, AUp)[0];
      } while (EstPFA > req);
      do {
        change /= 2;
        GBMult += EstPFA < req ? change : -change;
        AUp = LUp * GBMult;
        ALow = LLow * GBMult;
        uUUT_GB = uutUnc(REOP, uCal, ALow, AUp);
        EstPFA = PFA_Core(uUUT_GB, uCal, LLow, LUp, ALow, AUp)[0];
      } while (!(EstPFA >= req - precision && EstPFA <= req));
    }
    return GBMult;
  }

  // Internal Helper for LL GB
  function pfaLLGBMult(req, uUUT, uCal, avg, LLow) {
    const uDev = Math.sqrt(Math.pow(uUUT, 2) + Math.pow(uCal, 2));
    const REOP = vbNormSDist((avg - LLow) / uDev);
    const precision = 0.00001;
    let GBMult = 1;
    let ALow = LLow;
    let uUUT_GB = uutUncLL(REOP, uCal, avg, ALow);

    let EstPFA = PFALL_Core(uUUT_GB, uCal, avg, LLow, ALow)[0];

    if (EstPFA > req) {
      let change = 0.05;
      do {
        GBMult -= change;
        ALow = avg - (avg - LLow) * GBMult;
        uUUT_GB = uutUncLL(REOP, uCal, avg, ALow);
        EstPFA = PFALL_Core(uUUT_GB, uCal, avg, LLow, ALow)[0];
      } while (EstPFA > req);
      do {
        change /= 2;
        GBMult += EstPFA < req ? change : -change;
        ALow = avg - (avg - LLow) * GBMult;
        uUUT_GB = uutUncLL(REOP, uCal, avg, ALow);
        EstPFA = PFALL_Core(uUUT_GB, uCal, avg, LLow, ALow)[0];
      } while (!(EstPFA >= req - precision && EstPFA <= req));
    }
    return GBMult;
  }

  if (sRiskType === "NotThreshold") {
    const normalized = vbaUutUnc(dMeasRel, dMeasUnc, dTolLow, dTolUp);
    dUUTUnc = normalized.uUUT;
    dTolLow = normalized.low;
    dTolUp = normalized.up;
    if (dUUTUnc <= 0) return [NaN, NaN];
    GBMult = pfaGBMult(dReq, dUUTUnc, dMeasUnc, dTolLow, dTolUp);
    return [dNominal + dTolLow * GBMult, GBMult];
  } else if (sRiskType === "LowThreshold") {
    dUUTUnc = uutUncLL(dMeasRel, dMeasUnc, dAvg, dTolLow);
    if (dUUTUnc <= 0) return [NaN, NaN];
    GBMult = pfaLLGBMult(dReq, dUUTUnc, dMeasUnc, dAvg, dTolLow);
    return [dAvg - (dAvg - dTolLow) * GBMult, GBMult];
  } else if (sRiskType === "AltLowThreshold") {
    return [dTolLow - PHIDInv(dReq) * dMeasUnc, NaN];
  }
  return [NaN, NaN];
}

export function gbUpMgr(rngReq, rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel) {
  let [sRiskType, dNominal, dAvg, dTolLow, dTolUp, dMeasUnc, dMeasRel] = getRiskInfo(
    rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel
  );
  const dReq = vbaNbrValidate(rngReq);
  let dUUTUnc, GBMult;

  function PFAULGBMult(req, uUUT, uCal, avg, LUp) {
    const uDev = Math.sqrt(Math.pow(uUUT, 2) + Math.pow(uCal, 2));
    const REOP = vbNormSDist((LUp - avg) / uDev);
    const precision = 0.00001;
    let GBMult = 1;
    let AUp = LUp;
    let uUUT_GB = uutUncUL(REOP, uCal, avg, AUp);

    let EstPFA = PFAUL_Core(uUUT_GB, uCal, avg, LUp, AUp)[0];

    if (EstPFA > req) {
      let change = 0.05;
      do {
        GBMult -= change;
        AUp = (LUp - avg) * GBMult + avg;
        uUUT_GB = uutUncUL(REOP, uCal, avg, AUp);
        EstPFA = PFAUL_Core(uUUT_GB, uCal, avg, LUp, AUp)[0];
      } while (EstPFA > req);
      do {
        change /= 2;
        GBMult += EstPFA < req ? change : -change;
        AUp = (LUp - avg) * GBMult + avg;
        uUUT_GB = uutUncUL(REOP, uCal, avg, AUp);
        EstPFA = PFAUL_Core(uUUT_GB, uCal, avg, LUp, AUp)[0];
      } while (!(EstPFA >= req - precision && EstPFA <= req));
    }
    return GBMult;
  }

  function pfaGBMult(req, uUUT, uCal, LLow, LUp) {
    // Reuse logic from gbLowMgr - logic identical for symmetric
    const uDev = Math.sqrt(Math.pow(uUUT, 2) + Math.pow(uCal, 2));
    const REOP = vbNormSDist(LUp / uDev) - vbNormSDist(LLow / uDev);
    const precision = 0.00001;
    let GBMult = 1;
    let AUp = LUp;
    let ALow = LLow;
    let uUUT_GB = uutUnc(REOP, uCal, ALow, AUp);
    let EstPFA = PFA_Core(uUUT_GB, uCal, LLow, LUp, ALow, AUp)[0];

    if (EstPFA > req) {
      let change = 0.05;
      do {
        GBMult -= change;
        AUp = LUp * GBMult;
        ALow = LLow * GBMult;
        uUUT_GB = uutUnc(REOP, uCal, ALow, AUp);
        EstPFA = PFA_Core(uUUT_GB, uCal, LLow, LUp, ALow, AUp)[0];
      } while (EstPFA > req);
      do {
        change /= 2;
        GBMult += EstPFA < req ? change : -change;
        AUp = LUp * GBMult;
        ALow = LLow * GBMult;
        uUUT_GB = uutUnc(REOP, uCal, ALow, AUp);
        EstPFA = PFA_Core(uUUT_GB, uCal, LLow, LUp, ALow, AUp)[0];
      } while (!(EstPFA >= req - precision && EstPFA <= req));
    }
    return GBMult;
  }

  if (sRiskType === "NotThreshold") {
    const normalized = vbaUutUnc(dMeasRel, dMeasUnc, dTolLow, dTolUp);
    dUUTUnc = normalized.uUUT;
    dTolLow = normalized.low;
    dTolUp = normalized.up;
    if (dUUTUnc <= 0) return [NaN, NaN];
    GBMult = pfaGBMult(dReq, dUUTUnc, dMeasUnc, dTolLow, dTolUp);
    return [dTolUp * GBMult + dNominal, GBMult];
  } else if (sRiskType === "UpThreshold") {
    dUUTUnc = uutUncUL(dMeasRel, dMeasUnc, dAvg, dTolUp);
    if (dUUTUnc <= 0) return [NaN, NaN];
    GBMult = PFAULGBMult(dReq, dUUTUnc, dMeasUnc, dAvg, dTolUp);
    return [(dTolUp - dAvg) * GBMult + dAvg, GBMult];
  } else if (sRiskType === "AltUpThreshold") {
    return [dTolUp + PHIDInv(dReq) * dMeasUnc, NaN];
  }
  return [NaN, NaN];
}

export function GBMultMgr(rngReq, rngNominal, rngAvg, rngTolLow, rngTolUp, rngGBLow, rngGBUp) {
  const [sRiskType, dNominal, dAvg, dTolLow, dTolUp] = getTolInfo(rngNominal, rngAvg, rngTolLow, rngTolUp);
  const dGBLow = vbaNbrValidate(rngGBLow);
  const dGBUp = vbaNbrValidate(rngGBUp);

  if (dGBLow === 0 && dGBUp === 0) return "";

  if (sRiskType === "NotThreshold") {
    return Math.abs(dTolUp) > 0 ? Math.abs(dGBUp - dNominal) / Math.abs(dTolUp) : "";
  } else if (sRiskType === "UpThreshold") {
    return Math.abs(dTolUp - dAvg) > 0 ? Math.abs(dGBUp - dAvg) / Math.abs(dTolUp - dAvg) : "";
  } else if (sRiskType === "LowThreshold") {
    return Math.abs(dAvg - dTolLow) > 0 ? Math.abs(dAvg - dGBLow) / Math.abs(dAvg - dTolLow) : "";
  }
  return "";
}

export function PFAwGBMgr(rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel, rngGBLow, rngGBUp) {
  let [sRiskType, dNominal, dAvg, dTolLow, dTolUp, dMeasUnc, dMeasRel, dGBLow, dGBUp] = GetGBInfo(
    rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel, rngGBLow, rngGBUp
  );

  // Return empty array strings on failure so destructuring [a,b,c] doesn't crash
  if (dGBLow === 0 && dGBUp === 0) return ["", "", ""];

  let dUUTUnc;

  if (sRiskType === "NotThreshold") {
    const normalized = vbaUutUnc(dMeasRel, dMeasUnc, dGBLow, dGBUp);
    dUUTUnc = normalized.uUUT;
    dGBLow = normalized.low;
    dGBUp = normalized.up;
    if (dUUTUnc <= 0) return ["", "", ""];
    return PFA_Core(dUUTUnc, dMeasUnc, dTolLow, dTolUp, dGBLow, dGBUp);
  }
  if (sRiskType === "UpThreshold") {
    dUUTUnc = uutUncUL(dMeasRel, dMeasUnc, dAvg, dGBUp);
    if (dUUTUnc <= 0) return ["", "", ""];
    return PFAUL_Core(dUUTUnc, dMeasUnc, dAvg, dTolUp, dGBUp);
  }
  if (sRiskType === "LowThreshold") {
    dUUTUnc = uutUncLL(dMeasRel, dMeasUnc, dAvg, dGBLow);
    if (dUUTUnc <= 0) return ["", "", ""];
    return PFALL_Core(dUUTUnc, dMeasUnc, dAvg, dTolLow, dGBLow);
  }
  if (sRiskType === "AltUpThreshold") {
    const val = PHID((dGBUp - dTolUp) / dMeasUnc);
    // Map scalar result to array: [Total, Lower, Upper]
    // UpThreshold implies risk is only on the Upper tail
    return [val, 0, val];
  }
  if (sRiskType === "AltLowThreshold") {
    const val = PHID((dTolLow - dGBLow) / dMeasUnc);
    // LowThreshold implies risk is only on the Lower tail
    return [val, val, 0];
  }
  return ["", "", ""];
}

export function PFRwGBMgr(rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel, rngGBLow, rngGBUp) {
  let [sRiskType, dNominal, dAvg, dTolLow, dTolUp, dMeasUnc, dMeasRel, dGBLow, dGBUp] = GetGBInfo(
    rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel, rngGBLow, rngGBUp
  );

  if (dGBLow === 0 && dGBUp === 0) return ["", "", ""];

  let dUUTUnc;

  if (sRiskType === "NotThreshold") {
    const normalized = vbaUutUnc(dMeasRel, dMeasUnc, dGBLow, dGBUp);
    dUUTUnc = normalized.uUUT;
    dGBLow = normalized.low;
    dGBUp = normalized.up;
    if (dUUTUnc <= 0) return ["", "", ""];
    return PFR_Core(dUUTUnc, dMeasUnc, dTolLow, dTolUp, dGBLow, dGBUp);
  }
  if (sRiskType === "UpThreshold") {
    dUUTUnc = uutUncUL(dMeasRel, dMeasUnc, dAvg, dGBUp);
    if (dUUTUnc <= 0) return ["", "", ""];
    return PFRUL_Core(dUUTUnc, dMeasUnc, dAvg, dTolUp, dGBUp);
  }
  if (sRiskType === "LowThreshold") {
    dUUTUnc = uutUncLL(dMeasRel, dMeasUnc, dAvg, dGBLow);
    if (dUUTUnc <= 0) return ["", "", ""];
    return PFRLL_Core(dUUTUnc, dMeasUnc, dAvg, dTolLow, dGBLow);
  }
  return ["", "", ""];
}

export function CalIntwGBMgr(rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngReqRel, rngMeasRel, rngGBLow, rngGBUp, rngTUR, rngReqTUR, rngInt) {
  const [sRiskType, dNominal, dAvg, dTolLow, dTolUp, dMeasUnc, dMeasRel, dGBLow, dGBUp] = GetGBInfo(
    rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel, rngGBLow, rngGBUp
  );
  const dReqRel = vbaNbrValidate(rngReqRel);
  const dTUR = vbaNbrValidate(rngTUR);
  const dReqTur = vbaNbrValidate(rngReqTUR);
  const dInt = vbaNbrValidate(rngInt);

  if (dGBLow === 0 && dGBUp === 0) return "";
  if (sRiskType !== "NotThreshold" && sRiskType !== "UpThreshold" && sRiskType !== "LowThreshold") return "";

  let dObsRel;
  if (dReqTur > 0) {
    const dTstRUnc = (dMeasUnc * dTUR) / dReqTur;
    dObsRel = ObsRel(sRiskType, dTstRUnc, dMeasRel, dAvg, dTolLow, dTolUp, dMeasUnc);
  } else {
    dObsRel = dMeasRel;
  }

  const dPredRel = PredRel(sRiskType, dMeasUnc, dReqRel, dAvg, dTolLow, dTolUp, dMeasUnc, dGBLow, dGBUp);
  const dPredInt = (Math.log(dPredRel) / Math.log(dObsRel)) * dInt;
  return dPredInt > 0 ? [dPredInt, dObsRel, dPredRel] : "";
}

export function CalIntMgr(rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngReqRel, rngMeasRel, rngTUR, rngReqTUR, rngInt, rngReqPFA) {
  const [sRiskType, dNominal, dAvg, dTolLow, dTolUp, dMeasUnc, dMeasRel] = getRiskInfo(
    rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel
  );
  const dTUR = vbaNbrValidate(rngTUR);
  const dReqTur = vbaNbrValidate(rngReqTUR);
  const dInt = vbaNbrValidate(rngInt);
  const dReqRel = vbaNbrValidate(rngReqRel);
  const dReqPFA = vbaNbrValidate(rngReqPFA);

  let dObsRel;
  if (dReqTur > 0) {
    const dTstRUnc = (dMeasUnc * dTUR) / dReqTur;
    dObsRel = ObsRel(sRiskType, dTstRUnc, dMeasRel, dAvg, dTolLow, dTolUp, dMeasUnc);
  } else {
    dObsRel = dMeasRel;
  }

  let result = PFAIter(sRiskType, dObsRel, dAvg, dTolLow, dTolUp, dMeasUnc);
  if (result === -1) return ["", "", ""];
  let dPFA = result;

  if (dPFA <= dReqPFA) {
    return [(Math.log(dReqRel) / Math.log(dObsRel)) * dInt, dObsRel, dReqRel];
  }

  let dPredRel = 1 - Math.abs(1 - dObsRel) / 2;
  result = PFAIter(sRiskType, dPredRel, dAvg, dTolLow, dTolUp, dMeasUnc);
  if (result === -1) return ["", "", ""];
  dPFA = result;

  let dChg = dPFA < dReqPFA ? -Math.abs(dPredRel - dObsRel) : Math.abs(dPredRel - dObsRel);
  let lIter = 1;
  while (Math.abs(dPFA - dReqPFA) >= 0.00001 && lIter < 20) {
    dChg = dPFA < dReqPFA ? -Math.abs(dChg) / 2 : Math.abs(dChg) / 2;
    dPredRel += dChg;
    result = PFAIter(sRiskType, dPredRel, dAvg, dTolLow, dTolUp, dMeasUnc);
    if (result !== -1) dPFA = result;
    lIter++;
  }

  if (dPredRel < dReqRel) {
    dPredRel = dReqRel;
    result = PFAIter(sRiskType, dPredRel, dAvg, dTolLow, dTolUp, dMeasUnc);
    if (result !== -1) dPFA = result;
  }

  return dPFA === -1 ? ["", "", ""] : [(Math.log(dPredRel) / Math.log(dObsRel)) * dInt, dObsRel, dPredRel];
}

export function CalRelMgr(rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngReqRel, rngMeasRel, rngTUR, rngReqTUR, rngInt, rngReqPFA) {
  const [sRiskType, dNominal, dAvg, dTolLow, dTolUp, dMeasUnc, dMeasRel] = getRiskInfo(
    rngNominal, rngAvg, rngTolLow, rngTolUp, rngMeasUnc, rngMeasRel
  );
  const dTUR = vbaNbrValidate(rngTUR);
  const dReqTur = vbaNbrValidate(rngReqTUR);
  const dInt = vbaNbrValidate(rngInt);
  const dReqRel = vbaNbrValidate(rngReqRel);
  const dReqPFA = vbaNbrValidate(rngReqPFA);

  let dObsRel;
  if (dReqTur > 0) {
    const dTstRUnc = (dMeasUnc * dTUR) / dReqTur;
    dObsRel = ObsRel(sRiskType, dTstRUnc, dMeasRel, dAvg, dTolLow, dTolUp, dMeasUnc);
  } else {
    dObsRel = dMeasRel;
  }

  let result = PFAIter(sRiskType, dObsRel, dAvg, dTolLow, dTolUp, dMeasUnc);
  if (result === -1) return "";
  let dPFA = result;

  if (dPFA <= dReqPFA) return [dReqRel, dObsRel];

  let dPredRel = 1 - Math.abs(1 - dObsRel) / 2;
  result = PFAIter(sRiskType, dPredRel, dAvg, dTolLow, dTolUp, dMeasUnc);
  if (result === -1) return "";
  dPFA = result;

  let dChg = dPFA < dReqPFA ? -Math.abs(dPredRel - dObsRel) : Math.abs(dPredRel - dObsRel);
  let lIter = 1;
  while (Math.abs(dPFA - dReqPFA) >= 0.00001 && lIter < 20) {
    dChg = dPFA < dReqPFA ? -Math.abs(dChg) / 2 : Math.abs(dChg) / 2;
    dPredRel += dChg;
    result = PFAIter(sRiskType, dPredRel, dAvg, dTolLow, dTolUp, dMeasUnc);
    if (result !== -1) dPFA = result;
    lIter++;
  }

  if (dPredRel < dReqRel) {
    dPredRel = dReqRel;
    result = PFAIter(sRiskType, dPredRel, dAvg, dTolLow, dTolUp, dMeasUnc);
    if (result !== -1) dPFA = result;
  }

  return dPFA === -1 ? "" : [dPredRel, dObsRel];
}
