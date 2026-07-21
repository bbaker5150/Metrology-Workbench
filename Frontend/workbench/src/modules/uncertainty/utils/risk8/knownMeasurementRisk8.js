/**
 * Risk 8.0 adapter for single-sided tolerances with a known measurement.
 *
 * These are workbook tolerance Types 3 (lower limit) and 4 (upper limit).
 * Keeping their validation and output mapping here prevents the surrounding
 * UI from accidentally applying the legacy two-sided "both limits required"
 * rule.
 */

import { runRisk8FromApp } from "./riskAdapter8";
import { getSingleSidedTolerance } from "./unknownMeasurementRisk8";
import {
  evaluateCaseDS,
  evaluateCaseSS,
  getRPairForInterval,
  MODE_SS_LOWER,
  MODE_SS_UPPER,
  validateDecayModel,
} from "./riskEngine8";
import {
  TOLTYPE_DS_SYM,
  TOLTYPE_DS_ASYM,
  safeInitialGB,
  updateToleranceOutputs,
} from "./toleranceTypes8";

const finite = (value) =>
  value !== "" &&
  value !== null &&
  value !== undefined &&
  Number.isFinite(Number(value));
const percent = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value * 100 : undefined;

export function isKnownMeasurementTolerance(tolerance) {
  const singleSided = getSingleSidedTolerance(tolerance);
  return (
    singleSided != null &&
    String(singleSided.measurement || "known").trim().toLowerCase() !== "unknown"
  );
}

export function validateKnownSingleSidedGeometry(tolerance, nominal) {
  const singleSided = getSingleSidedTolerance(tolerance);
  const nominalNumber = Number(nominal);
  const limit = Number(singleSided?.limit);
  const direction = singleSided?.direction === "low" ? "low" : "high";

  if (!isKnownMeasurementTolerance(tolerance) || !finite(nominal) || !finite(limit)) {
    return { ok: false, direction, limit };
  }

  const ok = direction === "low" ? limit < nominalNumber : limit > nominalNumber;
  return { ok, direction, limit, nominal: nominalNumber };
}

/**
 * Risk 8.0 Type 2 is a known-measurement, two-sided asymmetric tolerance.
 * Detect it from the final physical limits rather than from the authoring
 * shape so compound IV/FS/floor specifications follow the same path as the
 * workbook after their terms have been combined.
 */
export function isKnownAsymmetricTolerance(nominal, lowerLimit, upperLimit) {
  if (!finite(nominal) || !finite(lowerLimit) || !finite(upperLimit)) return false;
  const tolerance = updateToleranceOutputs(
    Number(nominal),
    Number(lowerLimit),
    Number(upperLimit),
  );
  return tolerance.ok && tolerance.tolType === TOLTYPE_DS_ASYM;
}

export function isKnownTwoSidedTolerance(nominal, lowerLimit, upperLimit) {
  if (!finite(nominal) || !finite(lowerLimit) || !finite(upperLimit)) return false;
  const tolerance = updateToleranceOutputs(
    Number(nominal),
    Number(lowerLimit),
    Number(upperLimit),
  );
  return (
    tolerance.ok &&
    (tolerance.tolType === TOLTYPE_DS_SYM ||
      tolerance.tolType === TOLTYPE_DS_ASYM)
  );
}

export function computeKnownTwoSidedRisk8({
  nominal,
  riskAverage,
  lowerLimit,
  upperLimit,
  expandedUncertaintyNative,
  tur,
  assumedReop,
  requiredReop,
  turNeeded,
  reqPFA,
  initialGB,
  originalInterval,
  resolution = "",
  decayModel = "",
  weibullBeta = "",
}) {
  if (!isKnownTwoSidedTolerance(nominal, lowerLimit, upperLimit)) {
    return { computed: false };
  }

  const average = finite(riskAverage) ? Number(riskAverage) : Number(nominal);
  const result = runRisk8FromApp({
    measurement: "known",
    nominal,
    uutLowerLimit: lowerLimit,
    uutUpperLimit: upperLimit,
    riskAverage: average,
    uCalNative: expandedUncertaintyNative,
    tur,
    assumedReop,
    requiredReop,
    turNeeded,
    reqPFA,
    initialGB,
    originalInterval,
    resolution,
    decayModel,
    weibullBeta,
  });
  const diagnostics = buildKnownTwoSidedDiagnostics(result);

  return {
    ...result,
    diagnostics,
    lowerLimit: Number(lowerLimit),
    upperLimit: Number(upperLimit),
    tur: finite(tur) ? Number(tur) : undefined,
  };
}

export function computeKnownAsymmetricRisk8({
  nominal,
  riskAverage,
  lowerLimit,
  upperLimit,
  expandedUncertaintyNative,
  tur,
  assumedReop,
  requiredReop,
  turNeeded,
  reqPFA,
  initialGB,
  originalInterval,
  resolution = "",
  decayModel = "",
  weibullBeta = "",
}) {
  if (!isKnownAsymmetricTolerance(nominal, lowerLimit, upperLimit)) {
    return { computed: false };
  }
  return computeKnownTwoSidedRisk8({
    nominal,
    riskAverage,
    lowerLimit,
    upperLimit,
    expandedUncertaintyNative,
    tur,
    assumedReop,
    requiredReop,
    turNeeded,
    reqPFA,
    initialGB,
    originalInterval,
    resolution,
    decayModel,
    weibullBeta,
  });
}

export function buildKnownTwoSidedDiagnostics(result) {
  const input = result?.input || {};
  const out = result?.out || {};
  const tur = Number(input.tur);
  const turSolve = finite(input.turNeeded) ? Number(input.turNeeded) : tur;
  const reop = Number(input.reop);
  const mu = finite(input.mu) ? Number(input.mu) : 0;
  const xcal = finite(input.xcal) ? Number(input.xcal) : 0;
  const delta = Number(out.asymmetry);
  const initialGB = safeInitialGB(input.initialGB);
  const LTL = delta - 1;
  const UTL = delta + 1;
  const GBL = initialGB * LTL;
  const GBH = initialGB * UTL;

  if (
    !(tur > 0) ||
    !(turSolve > 0) ||
    !(reop > 0 && reop < 1) ||
    !Number.isFinite(delta)
  ) {
    return null;
  }

  const core = evaluateCaseDS(
    tur,
    reop,
    turSolve,
    GBL,
    GBH,
    mu,
    LTL,
    UTL,
    xcal,
  );
  if (!core.OK) return null;

  const recommended =
    finite(out.gbMult) && finite(out.mitReop)
      ? evaluateCaseDS(
          tur,
          Number(out.mitReop),
          turSolve,
          Number(out.gbMult) * LTL,
          Number(out.gbMult) * UTL,
          mu,
          LTL,
          UTL,
          xcal,
        )
      : null;
  const guardbandIntervalRisk = finite(out.mitReop)
    ? evaluateCaseDS(
        tur,
        Number(out.mitReop),
        turSolve,
        GBL,
        GBH,
        mu,
        LTL,
        UTL,
        xcal,
      )
    : null;
  const reopOnly = finite(out.intReop)
    ? evaluateCaseDS(
        tur,
        Number(out.intReop),
        turSolve,
        GBL,
        GBH,
        mu,
        LTL,
        UTL,
        xcal,
      )
    : null;
  const model = validateDecayModel(input.decayModel);
  const gbIntervalPair =
    guardbandIntervalRisk?.OK && model.ok
      ? getRPairForInterval(model.modelCode, core, guardbandIntervalRisk)
      : null;
  const reopOnlyIntervalPair =
    reopOnly?.OK && model.ok
      ? getRPairForInterval(model.modelCode, core, reopOnly)
      : null;

  return {
    mode: "two-sided",
    initialGB,
    tur,
    turSolve,
    reop,
    mu,
    xcal,
    muObserved: mu + xcal,
    delta,
    LTL,
    UTL,
    GBL,
    GBH,
    modelCode: model.ok ? model.modelCode : "",
    core,
    recommended: recommended?.OK ? recommended : null,
    guardbandIntervalRisk:
      guardbandIntervalRisk?.OK ? guardbandIntervalRisk : null,
    reopOnly: reopOnly?.OK ? reopOnly : null,
    gbIntervalPair,
    reopOnlyIntervalPair,
  };
}

export const buildKnownAsymmetricDiagnostics = buildKnownTwoSidedDiagnostics;

export function computeKnownMeasurementRisk8({
  tolerance,
  nominal,
  riskAverage,
  expandedUncertaintyNative,
  tur,
  assumedReop,
  requiredReop,
  turNeeded,
  reqPFA,
  initialGB,
  originalInterval,
  resolution = "",
  decayModel = "",
  weibullBeta = "",
}) {
  const geometry = validateKnownSingleSidedGeometry(tolerance, nominal);
  if (!geometry.ok) return { computed: false, geometry };

  const average = finite(riskAverage) ? Number(riskAverage) : Number(nominal);
  const uncertainty = Number(expandedUncertaintyNative);
  const calculatedTur =
    finite(tur) && Number(tur) > 0
      ? Number(tur)
      : uncertainty > 0
        ? Math.abs(average - geometry.limit) / uncertainty
        : NaN;

  const lowerLimit = geometry.direction === "low" ? geometry.limit : "";
  const upperLimit = geometry.direction === "high" ? geometry.limit : "";
  const result = runRisk8FromApp({
    measurement: "known",
    nominal,
    uutLowerLimit: lowerLimit,
    uutUpperLimit: upperLimit,
    riskAverage: average,
    uCalNative: expandedUncertaintyNative,
    tur: calculatedTur,
    assumedReop,
    requiredReop,
    turNeeded,
    reqPFA,
    initialGB,
    originalInterval,
    resolution,
    decayModel,
    weibullBeta,
  });

  const diagnostics = buildKnownMeasurementDiagnostics(result, geometry.direction);

  return {
    ...result,
    diagnostics,
    geometry,
    direction: geometry.direction,
    lowerLimit: lowerLimit === "" ? undefined : lowerLimit,
    upperLimit: upperLimit === "" ? undefined : upperLimit,
    tur: calculatedTur,
  };
}

/**
 * Reconstruct the exact intermediate RiskResult objects used by the workbook
 * port. These values are presentation diagnostics only; the public results
 * still come from computeOneRow8. Keeping this reconstruction beside the
 * adapter makes the UI breakdown auditable without duplicating the risk math.
 */
export function buildKnownMeasurementDiagnostics(result, direction) {
  const input = result?.input || {};
  const out = result?.out || {};
  const tur = Number(input.tur);
  const turSolve = finite(input.turNeeded) ? Number(input.turNeeded) : tur;
  const reop = Number(input.reop);
  const mu = finite(input.mu) ? Number(input.mu) : 0;
  const xcal = finite(input.xcal) ? Number(input.xcal) : 0;
  const initialGB = safeInitialGB(input.initialGB);
  const lower = direction === "low";
  const mode = lower ? MODE_SS_LOWER : MODE_SS_UPPER;
  const activeUUT = lower ? -1 : 1;
  const activeGB = initialGB * activeUUT;

  if (!(tur > 0) || !(turSolve > 0) || !(reop > 0 && reop < 1)) {
    return null;
  }

  const core = evaluateCaseSS(
    tur,
    reop,
    turSolve,
    activeGB,
    activeUUT,
    mode,
    mu,
    xcal,
  );
  if (!core.OK) return null;

  const recommended =
    finite(out.gbMult) && finite(out.mitReop)
      ? evaluateCaseSS(
          tur,
          Number(out.mitReop),
          turSolve,
          Number(out.gbMult) * activeUUT,
          activeUUT,
          mode,
          mu,
          xcal,
        )
      : null;

  // The workbook computes the guardband interval on the original/current GB
  // curve at the recommended reliability, not on the newly recommended GB.
  const guardbandIntervalRisk = finite(out.mitReop)
    ? evaluateCaseSS(
        tur,
        Number(out.mitReop),
        turSolve,
        activeGB,
        activeUUT,
        mode,
        mu,
        xcal,
      )
    : null;

  const reopOnly = finite(out.intReop)
    ? evaluateCaseSS(
        tur,
        Number(out.intReop),
        turSolve,
        activeGB,
        activeUUT,
        mode,
        mu,
        xcal,
      )
    : null;

  const model = validateDecayModel(input.decayModel);
  const gbIntervalPair =
    guardbandIntervalRisk?.OK && model.ok
      ? getRPairForInterval(model.modelCode, core, guardbandIntervalRisk)
      : null;
  const reopOnlyIntervalPair =
    reopOnly?.OK && model.ok
      ? getRPairForInterval(model.modelCode, core, reopOnly)
      : null;

  return {
    direction,
    mode,
    activeUUT,
    activeGB,
    initialGB,
    tur,
    turSolve,
    reop,
    mu,
    xcal,
    muObserved: mu + xcal,
    modelCode: model.ok ? model.modelCode : "",
    core,
    recommended: recommended?.OK ? recommended : null,
    guardbandIntervalRisk:
      guardbandIntervalRisk?.OK ? guardbandIntervalRisk : null,
    reopOnly: reopOnly?.OK ? reopOnly : null,
    gbIntervalPair,
    reopOnlyIntervalPair,
  };
}

export function toKnownMeasurementSummary(result) {
  if (!result?.computed || result.out?.statusCore !== "OK") return null;

  const { out } = result;
  const riskMethod =
    out.tolType === TOLTYPE_DS_SYM
      ? "risk8-two-sided-symmetric"
      : out.tolType === TOLTYPE_DS_ASYM
        ? "risk8-two-sided-asymmetric"
        : "risk8-single-sided-known";
  return {
    riskMethod,
    riskAvailability: "full",
    pfa: percent(out.pfa),
    pfr: percent(out.pfr),
    tur: finite(result.tur) ? Number(result.tur) : undefined,
    observedReop: percent(out.obs),
    maxReop: percent(out.maxReop),
    trueReop: percent(out.trueReop),
    gbLow: finite(out.physGbLower) ? Number(out.physGbLower) : undefined,
    gbHigh: finite(out.physGbUpper) ? Number(out.physGbUpper) : undefined,
    gbMult: percent(out.gbMult),
    gbPfa: percent(out.mitPfa),
    gbPfr: percent(out.mitPfr),
    gbCalInt: finite(out.gbInterval) ? Number(out.gbInterval) : undefined,
    gbMeasRel: percent(out.mitReop),
    noGbPfa: percent(out.intPfa),
    noGbPfr: percent(out.intPfr),
    noGbCalInt: finite(out.intInterval) ? Number(out.intInterval) : undefined,
    noGbMeasRel: percent(out.intReop),
  };
}
