/**
 * goldenVectors8.js — golden input/output vectors for the 8.0 risk-engine port.
 * =============================================================================
 * PURPOSE: the reviewer's bit-for-bit sign-off. Each vector is one row of the
 * workbook: the fixed-column INPUTS plus the OUTPUTS read off RISK_DATA / MAIN.
 * The harness (goldenVectors8.test.js) runs the port on each input and asserts it
 * reproduces the expected outputs to the vector's tolerance. This is the only
 * thing that turns "structurally correct" into "proven equal to the workbook."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO CAPTURE A REAL VECTOR FROM `Unc_Tool_v8.00Beta.4`
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Pick a MAIN row and note its inputs. Map the columns to `input` keys:
 *      F MeasurementPoint -> nominal      S TUR            -> tur
 *      G UUT_LL           -> lowerLimit    T Assumed_REOP   -> reop
 *      H UUT_UL           -> upperLimit    U TUR_Needed     -> turNeeded
 *      I Initial_GB       -> initialGB     Z Original_Interval -> originalInterval
 *      J U_cal (5/6)      -> uCal          AA PFA_Required  -> pfaTarget
 *      K UUT_Bias         -> mu            AB REOP_Required -> reopTarget
 *      L Cal_Bias         -> xcal          AC Decay_Model   -> decayModel
 *                                          AD Weibull_Beta  -> weibullBeta
 *    Leave a key as "" when the workbook cell is blank. The UUT resolution
 *    (used to snap GB_LL/GB_UL) goes in `resolution`.
 * 2. Read the OUTPUT cell VALUES (not the % display — the underlying fraction,
 *    e.g. 0.0123, not "1.23%") into `expected`, keyed by the RISK_DATA/MAIN
 *    column names (REOP_At_Test_TUR, Test_PFA, ...). Optionally include the
 *    scratch statuses statusCore / statusMit / statusInt.
 * 3. Set `source: "workbook v8.00Beta.4"` and choose `tol` (decimal places for
 *    numeric closeTo; 6 ≈ 5e-7 is a good default given the workbook's own solver
 *    tolerances). Delete the `selfCapture` flag.
 *
 * Full-precision captures below were read from MAIN after running the public
 * `ComputeRiskForMainTable` VBA entry point. Types 5/6 remain intentionally
 * uncaptured: Beta.4's bridge requires TUR to be numeric for every type, while
 * `HandleUnknownMeasuredValue` requires TUR to be blank. See MIGRATION_AUDIT.md.
 */

export const GOLDEN_VECTORS = [
  {
    // First real workbook capture. Type 2 double-sided asymmetric voltage point
    // from Unc_Tool_v8.00Beta.4 (IMG_1910): measured value 5 V, floor tol -2/+11
    // => limits [3, 16], TUR needed 4, assumed REOP 85%, PFA req 2%, REOP req 85%,
    // cal interval 12, E1. Outputs were read from the sheet at DISPLAY precision
    // (2 decimals on the percentages), so tol is loose (tol:3 ~= 0.05% on a
    // percentage) to accommodate display rounding. Replace expected with
    // full-precision cell values (click the cell, read the formula bar) for a
    // tight bit-for-bit check, then raise tol.
    name: "workbook Type-2 voltage — asymmetric, measured 5 V, limits [3,16]",
    source: "workbook v8.00Beta.4 (IMG_1910, display precision 2dp)",
    displayPrecision: true,
    tol: 3,
    input: {
      nominal: 5, lowerLimit: 3, upperLimit: 16, initialGB: 1,
      uCal: "", mu: 0, xcal: 0,
      tur: 114.31, reop: 0.85, turNeeded: 4,
      originalInterval: 12, pfaTarget: 0.02, reopTarget: 0.85,
      decayModel: "", weibullBeta: "",
    },
    resolution: 0.01,
    expected: {
      REOP_At_Test_TUR: 0.8744,
      Test_PFA: 0.0014,
      Test_PFR: 0.0014,
      GB_Percent: 1,
      PFA_With_GB: 0.0014,
      PFR_With_GB: 0.0014,
      statusCore: "OK",
    },
  },
  {
    name: "workbook Type-1 symmetric — nominal 10, limits [9,11]",
    source: "workbook v8.00Beta.4 (full-precision MAIN cell values)",
    tol: 11,
    input: {
      nominal: 10, lowerLimit: 9, upperLimit: 11, initialGB: 1,
      uCal: "", mu: "", xcal: "",
      tur: 4, reop: 0.9, turNeeded: "",
      originalInterval: 12, pfaTarget: 0.02, reopTarget: 0.85,
      decayModel: "", weibullBeta: "",
    },
    resolution: "",
    expected: {
      REOP_At_Test_TUR: 0.899999999999458,
      Test_PFA: 0.0132995422437293,
      Test_PFR: 0.020787960232863,
      Max_REOP_At_Test_TUR: 0.999999999999996,
      True_REOP_At_Test_TUR: 0.907488417988592,
      GB_Percent: 1,
      GB_LL: 9,
      GB_UL: 11,
      PFA_With_GB: 0.0171484975232226,
      PFR_With_GB: 0.0240717403268167,
      Interval_With_GB: 18.5100380517164,
      Target_REOP_With_GB: 0.849999999999102,
      PFA_REOP_Only: 0.0171485294071587,
      PFR_REOP_Only: 0.0240717645056783,
      Interval_REOP_Only: 18.5101050484723,
      Target_REOP_Only: 0.849999499999971,
    },
  },
  {
    name: "workbook Type-2 asymmetric — nominal 10, limits [9,12]",
    source: "workbook v8.00Beta.4 (full-precision MAIN cell values)",
    tol: 11,
    input: {
      nominal: 10, lowerLimit: 9, upperLimit: 12, initialGB: 1,
      uCal: "", mu: "", xcal: "",
      tur: 4, reop: 0.9, turNeeded: "",
      originalInterval: 12, pfaTarget: 0.02, reopTarget: 0.85,
      decayModel: "", weibullBeta: "",
    },
    resolution: "",
    expected: {
      REOP_At_Test_TUR: 0.899999999999981,
      Test_PFA: 0.0139864408116862,
      Test_PFR: 0.0220732738684445,
      Max_REOP_At_Test_TUR: 0.999999913534718,
      True_REOP_At_Test_TUR: 0.90808683305674,
      GB_Percent: 1,
      GB_LL: 9,
      GB_UL: 12,
      PFA_With_GB: 0.0176264482248822,
      PFR_With_GB: 0.0247237829935142,
      Interval_With_GB: 18.5100380516918,
      Target_REOP_With_GB: 0.850000000000048,
      PFA_REOP_Only: 0.0176264779019731,
      PFR_REOP_Only: 0.0247238026223404,
      Interval_REOP_Only: 18.5101050484199,
      Target_REOP_Only: 0.849999500000166,
    },
  },
  {
    name: "workbook Type-3 single-sided lower known",
    source: "workbook v8.00Beta.4 (full-precision MAIN cell values)",
    tol: 11,
    input: {
      nominal: 10, lowerLimit: 9, upperLimit: "", initialGB: 1,
      uCal: "", mu: "", xcal: "",
      tur: 4, reop: 0.95, turNeeded: "",
      originalInterval: 12, pfaTarget: 0.02, reopTarget: 0.9,
      decayModel: "", weibullBeta: "",
    },
    resolution: "",
    expected: {
      REOP_At_Test_TUR: 0.950000000000409,
      Test_PFA: 0.00664977087157792,
      Test_PFR: 0.0103939798661484,
      Max_REOP_At_Test_TUR: 0.999999999999998,
      True_REOP_At_Test_TUR: 0.95374420899498,
      GB_Percent: 1,
      GB_LL: 9,
      GB_UL: "",
      PFA_With_GB: 0.00989490240592716,
      PFR_With_GB: 0.0129270887398407,
      Interval_With_GB: 24.6489566131695,
      Target_REOP_With_GB: 0.899999999999945,
      PFA_REOP_Only: 0.00989492379244394,
      PFR_REOP_Only: 0.0129271010036306,
      Interval_REOP_Only: 24.6490865845688,
      Target_REOP_Only: 0.899999500000467,
    },
  },
  {
    name: "workbook Type-4 single-sided upper known",
    source: "workbook v8.00Beta.4 (full-precision MAIN cell values)",
    tol: 11,
    input: {
      nominal: 10, lowerLimit: "", upperLimit: 11, initialGB: 1,
      uCal: "", mu: "", xcal: "",
      tur: 4, reop: 0.95, turNeeded: "",
      originalInterval: 12, pfaTarget: 0.02, reopTarget: 0.9,
      decayModel: "", weibullBeta: "",
    },
    resolution: "",
    expected: {
      REOP_At_Test_TUR: 0.950000000000409,
      Test_PFA: 0.00664977087136653,
      Test_PFR: 0.010393979865937,
      Max_REOP_At_Test_TUR: 0.999999999999998,
      True_REOP_At_Test_TUR: 0.95374420899498,
      GB_Percent: 1,
      GB_LL: "",
      GB_UL: 11,
      PFA_With_GB: 0.00989490240556323,
      PFR_With_GB: 0.0129270887394768,
      Interval_With_GB: 24.6489566131695,
      Target_REOP_With_GB: 0.899999999999945,
      PFA_REOP_Only: 0.00989492379208001,
      PFR_REOP_Only: 0.0129271010032667,
      Interval_REOP_Only: 24.6490865845688,
      Target_REOP_Only: 0.899999500000467,
    },
  },
  {
    name: "Type-5 lower unknown — intended backend path",
    source: "awaiting workbook bridge correction; see MIGRATION_AUDIT.md",
    input: {
      nominal: "", lowerLimit: 9, upperLimit: "", initialGB: 1,
      uCal: 0.2, mu: "", xcal: "", tur: "", reop: "", turNeeded: "",
      originalInterval: 12, pfaTarget: 0.02, reopTarget: 0.9,
      decayModel: "", weibullBeta: "",
    },
    resolution: "",
  },
  {
    name: "Type-6 upper unknown — intended backend path",
    source: "awaiting workbook bridge correction; see MIGRATION_AUDIT.md",
    input: {
      nominal: "", lowerLimit: "", upperLimit: 11, initialGB: 1,
      uCal: 0.2, mu: "", xcal: "", tur: "", reop: "", turNeeded: "",
      originalInterval: 12, pfaTarget: 0.02, reopTarget: 0.9,
      decayModel: "", weibullBeta: "",
    },
    resolution: "",
  },
];
