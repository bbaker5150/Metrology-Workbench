/**
 * riskAdapter8.js — app-data adapter for the 8.0 risk engine
 * =============================================================================
 * This is the ONLY risk8 module that knows about the app's risk inputs. It maps
 * the same native-unit quantities `useRiskCalculation` already assembles onto
 * the 8.0 fixed-column contract (computeOneRow8 / riskBridge8), runs the engine,
 * and returns the outputs. It is the app-side equivalent of the workbook's
 * front-end tolerance/uncertainty forms that populate tblMain before the risk
 * back-end runs.
 *
 * Two mapping decisions are baked in here (confirmed with the product owner) and
 * are the things the workbook author should scrutinize during the 1:1 check:
 *
 *   1. AVERAGE -> mu.  8.0 centers the UUT truth distribution with a normalized
 *      UUT bias `mu` and cal bias `xcal` (both in units of the tolerance
 *      half-span). We map the app's measured operating point (riskAverage) to
 *      mu by normalizing its offset from the tolerance center:
 *          mu = (riskAverage - center) / halfSpan
 *      and default xcal to calBias/halfSpan (0 unless a cal-bias field is set).
 *      For a symmetric, centered, no-MC point this is 0 — identical to today.
 *
 *   2. FIELD SEMANTICS.  The 8.0 workbook separates the reliability used to
 *      evaluate the current point (`Assumed_REOP`) from the required reliability
 *      used by mitigation (`REOP_Required`). The app has both values: the
 *      "Calculated/Assumed Meas. Reliability" requirement maps to the former,
 *      while "Measurement Reliability Target" maps to the latter. Callers should
 *      pass them as `assumedReop` and `requiredReop`; the legacy
 *      `reliability`/`reopTarget` names remain as compatibility fallbacks only.
 *
 * FLAG (asymmetric): the mu reference for asymmetric (type 2) tolerances uses
 * the tolerance midpoint, same as symmetric. The engine represents asymmetry via
 * the delta term (LTL=delta-1, UTL=delta+1), so the exact physical reference for
 * mu in the asymmetric case should be confirmed against the workbook front end.
 */

import { computeRiskRow8 } from "./riskBridge8";
import {
  updateToleranceOutputs,
  TOLTYPE_DS_SYM,
  TOLTYPE_DS_ASYM,
  TOLTYPE_SS_LOWER,
  TOLTYPE_SS_UPPER,
  isBlankCell,
} from "./toleranceTypes8";

const num = (v, dflt = NaN) => {
  if (isBlankCell(v)) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

/**
 * Derive the { center, halfSpan } that define the engine's normalized (+/-1)
 * frame for a given tolerance geometry, so a physical value can be mapped to a
 * normalized offset (value - center) / halfSpan.
 *
 *   - two-sided (1,2): center = (upper+lower)/2, halfSpan = (upper-lower)/2
 *   - single-sided lower (3): center = nominal, halfSpan = nominal - lower
 *   - single-sided upper (4): center = nominal, halfSpan = upper - nominal
 *
 * The center is the NOMINAL, not the band midpoint — the engine measures mu from
 * the nominal (its normalized "0"), and for an asymmetric tolerance it encodes
 * the band's offset from the nominal in `delta` (LTL=delta-1, UTL=delta+1). So
 * mu = (value - nominal) / halfSpan places the UUT mean correctly for both
 * symmetric (nominal == band center) and asymmetric (nominal off-center) specs.
 * halfSpan is always (upper - lower)/2 (one normalized unit).
 *
 * Returns null when the frame is undefined (unknown-value types 5/6, or a
 * degenerate/zero span) — callers then use mu = 0.
 */
export function normalizeToleranceFrame(tolType, nominal, lowerLimit, upperLimit) {
  switch (tolType) {
    case TOLTYPE_DS_SYM:
    case TOLTYPE_DS_ASYM: {
      if (!Number.isFinite(nominal) || !Number.isFinite(lowerLimit) || !Number.isFinite(upperLimit)) return null;
      const halfSpan = (upperLimit - lowerLimit) / 2;
      if (!(halfSpan > 0)) return null;
      return { center: nominal, halfSpan };
    }
    case TOLTYPE_SS_LOWER: {
      if (!Number.isFinite(nominal) || !Number.isFinite(lowerLimit)) return null;
      const halfSpan = nominal - lowerLimit;
      if (!(halfSpan > 0)) return null;
      return { center: nominal, halfSpan };
    }
    case TOLTYPE_SS_UPPER: {
      if (!Number.isFinite(nominal) || !Number.isFinite(upperLimit)) return null;
      const halfSpan = upperLimit - nominal;
      if (!(halfSpan > 0)) return null;
      return { center: nominal, halfSpan };
    }
    default:
      return null;
  }
}

/**
 * Assemble the 8.0 fixed-column contract from app-shaped, native-unit risk
 * inputs. All physical quantities (nominal, limits, riskAverage, calBias, uCal,
 * resolution) must share the same native unit; TUR and the REOP/PFA fractions
 * are dimensionless.
 *
 * Field mapping (app -> workbook column):
 *   nominal          -> MeasurementPoint (F)
 *   uutLowerLimit    -> UUT_LL (G)
 *   uutUpperLimit    -> UUT_UL (H)
 *   initialGB        -> Initial_GB (I)          [app guardBandMultiplier]
 *   uCalNative       -> ExpandedUncertainty (J) [only used for types 5/6]
 *   mu (derived)     -> UUT_Bias (K)            [normalized; see AVERAGE->mu]
 *   xcal (derived)   -> Cal_Bias (L)            [normalized; calBias/halfSpan]
 *   tur              -> TUR (S)                 [app turResult]
 *   assumedReop      -> Assumed_REOP (T)       [calculated/assumed reliability]
 *   turNeeded        -> TUR_Needed (U)          [app neededTUR, optional]
 *   originalInterval -> Original_Interval (Z)   [app calInt]
 *   reqPFA           -> PFA_Required (AA)
 *   requiredReop     -> REOP_Required (AB)     [required reliability target]
 *   decayModel       -> Decay_Model (AC)        [optional; blank -> E1]
 *   weibullBeta      -> Weibull_Beta (AD)       [optional]
 *   measurement      -> "known" | "unknown"     [single-sided case selector]
 *
 * Compatibility note: early comparison-panel builds supplied `reliability` and
 * `reopTarget`. They are still accepted so saved diagnostic fixtures continue to
 * run, but new/live callers must use the explicit names above. This keeps the
 * mapping auditable against MAIN columns T and AB instead of overloading one
 * ambiguous "reliability" value.
 */
export function buildRisk8Contract(appInputs) {
  const measurementUnknown =
    String(appInputs.measurement ?? "").trim().toLowerCase() === "unknown" ||
    appInputs.measurementUnknown === true;
  const suppliedNominal = num(appInputs.nominal);
  // Workbook types 5/6 are selected by leaving MeasurementPoint blank. The app
  // still owns a nominal test-point value for display and uncertainty math, so
  // the explicit measurement selector—not destruction of that app value—must
  // decide what is sent to the risk engine.
  const nominal = measurementUnknown ? NaN : suppliedNominal;
  const lowerLimit = num(appInputs.uutLowerLimit);
  const upperLimit = num(appInputs.uutUpperLimit);
  const riskAverage = num(appInputs.riskAverage, nominal);
  const calBias = num(appInputs.calBias, 0);

  // Detect the tolerance type the same way the engine will, so the normalization
  // frame matches the branch computeOneRow takes.
  const tol = updateToleranceOutputs(
    Number.isFinite(nominal) ? nominal : "",
    Number.isFinite(lowerLimit) ? lowerLimit : "",
    Number.isFinite(upperLimit) ? upperLimit : ""
  );
  const tolType = tol.ok ? tol.tolType : null;

  const frame = normalizeToleranceFrame(tolType, nominal, lowerLimit, upperLimit);

  // AVERAGE -> mu: normalized offset of the measured average from the tolerance
  // center. xcal: normalized cal bias. Both 0 when there is no usable frame.
  let mu = "";
  let xcal = "";
  if (frame) {
    mu = (riskAverage - frame.center) / frame.halfSpan;
    xcal = calBias / frame.halfSpan;
  }

  const assumedReopSource = isBlankCell(appInputs.assumedReop)
    ? appInputs.reliability
    : appInputs.assumedReop;
  const requiredReopSource = isBlankCell(appInputs.requiredReop)
    ? appInputs.reopTarget
    : appInputs.requiredReop;
  const assumedReop = num(assumedReopSource);
  const reqReop = isBlankCell(requiredReopSource)
    ? assumedReop
    : num(requiredReopSource);

  const input = {
    nominal: Number.isFinite(nominal) ? nominal : "",
    lowerLimit: Number.isFinite(lowerLimit) ? lowerLimit : "",
    upperLimit: Number.isFinite(upperLimit) ? upperLimit : "",
    initialGB: isBlankCell(appInputs.initialGB) ? "" : num(appInputs.initialGB),
    uCal: isBlankCell(appInputs.uCalNative) ? "" : num(appInputs.uCalNative),
    mu,
    xcal,
    // The approved type-5/6 path deliberately has no TUR. Ignore a stale TUR
    // supplied by a previous known-measurement calculation when the user flips
    // this tolerance to measurement unknown.
    tur: measurementUnknown || isBlankCell(appInputs.tur) ? "" : num(appInputs.tur),
    reop:
      !measurementUnknown && Number.isFinite(assumedReop) ? assumedReop : "",
    turNeeded: isBlankCell(appInputs.turNeeded) ? "" : num(appInputs.turNeeded),
    originalInterval: isBlankCell(appInputs.originalInterval) ? "" : num(appInputs.originalInterval),
    pfaTarget: isBlankCell(appInputs.reqPFA) ? "" : num(appInputs.reqPFA),
    reopTarget:
      !measurementUnknown && Number.isFinite(reqReop) ? reqReop : "",
    decayModel: isBlankCell(appInputs.decayModel) ? "" : String(appInputs.decayModel),
    weibullBeta: isBlankCell(appInputs.weibullBeta) ? "" : num(appInputs.weibullBeta),
  };

  return {
    input,
    resolution: isBlankCell(appInputs.resolution) ? "" : num(appInputs.resolution),
    // Surface the derived normalization so the comparison UI / reviewer can see
    // exactly what was fed to the engine.
    meta: { tolType, frame, mu, xcal, measurementUnknown },
  };
}

/**
 * Run the 8.0 engine from app-shaped inputs. Returns the bridge result
 * ({ out, fields, computed }) plus the derived normalization meta.
 *
 * @param {object} appInputs   see buildRisk8Contract
 * @param {object} [options]   forwarded to computeRiskRow8 (e.g. enforceMinimumInputs)
 */
export function runRisk8FromApp(appInputs, options = {}) {
  const { input, resolution, meta } = buildRisk8Contract(appInputs);
  const result = computeRiskRow8(input, { resolution, ...options });
  return { ...result, input, meta };
}
