/**
 * Type-5/6 app wiring for the approved Risk 8.0 unknown-measurement policy.
 *
 * The app retains a nominal value for the test point even when the tolerance
 * explicitly says the measurement is unknown. The workbook selects types 5/6
 * by leaving MeasurementPoint blank, so this helper is the single place that
 * translates the stored tolerance case into that fixed-column contract.
 */

import { runRisk8FromApp } from "./riskAdapter8";

export function getSingleSidedTolerance(tolerance) {
  return tolerance?.singleSided || tolerance?.tolerances?.singleSided || null;
}

export function isUnknownMeasurementTolerance(tolerance) {
  const singleSided = getSingleSidedTolerance(tolerance);
  return (
    singleSided != null &&
    String(singleSided.measurement || "").trim().toLowerCase() === "unknown"
  );
}

/**
 * Execute the type-5/6 PFA-only acceptance-boundary method.
 *
 * `uCalNative` is the expanded uncertainty used by workbook column J. TUR and
 * REOP inputs are intentionally omitted: they are neither available nor used
 * when there is no measured value.
 */
export function computeUnknownMeasurementBoundary8({
  tolerance,
  uCalNative,
  reqPFA,
  calBias = 0,
  resolution = "",
}) {
  const singleSided = getSingleSidedTolerance(tolerance);
  if (!isUnknownMeasurementTolerance(tolerance)) return null;

  const direction = singleSided.direction === "low" ? "low" : "high";
  const limit = singleSided.limit;
  if (limit == null || String(limit).trim() === "" || !Number.isFinite(Number(limit)) || !Number.isFinite(Number(calBias))) return { computed: false };
  // APP EXTENSION, not literal Beta.7 parity for nonzero bias: workbook Types
  // 5/6 ignore K/L. With reading Y = true value + bCal + noise, the acceptance
  // boundary in reading coordinates is L+bCal-sigma*z(PFA) (lower) or
  // U+bCal+sigma*z(PFA) (upper). Translate the limit BEFORE the workbook's inward
  // resolution snap; adding bias after snapping would leave the measurement grid
  // and misstate achieved PFA. Keep the original true limit below for derivations.
  // At bCal=0 this is exactly the dedicated workbook boundary procedure. At
  // nonzero bias we compare to Excel with an explicitly translated limit, and
  // separately test/document the difference from its unchanged physical input.
  const observedLimit = Number(limit) + Number(calBias);
  const lowerLimit = direction === "low" ? limit : "";
  const upperLimit = direction === "high" ? limit : "";

  const result = runRisk8FromApp({
    measurement: "unknown",
    nominal: "",
    uutLowerLimit: direction === "low" ? observedLimit : "",
    uutUpperLimit: direction === "high" ? observedLimit : "",
    uCalNative,
    tur: "",
    assumedReop: "",
    requiredReop: "",
    reqPFA,
    resolution,
  });

  return {
    ...result,
    calBias: Number(calBias),
    direction,
    lowerLimit:
      lowerLimit === "" || !Number.isFinite(Number(lowerLimit))
        ? undefined
        : Number(lowerLimit),
    upperLimit:
      upperLimit === "" || !Number.isFinite(Number(upperLimit))
        ? undefined
        : Number(upperLimit),
  };
}

/**
 * Convert the PFA-only result to the compact metrics contract used by sidebar
 * rows and exports. The cutoff still uses required PFA, but an unknown reading has no observed
 * PFA or PFR. Keep those metrics unavailable, matching workbook types 5/6.
 */
export function toUnknownMeasurementSummary(boundary) {
  if (!boundary?.computed || boundary.out?.statusMit !== "OK") return null;

  return {
    riskMethod: "risk8-pfa-boundary",
    riskAvailability: "pfa-boundary-only",
    pfa: undefined,
    pfr: undefined,
    tur: undefined,
    tar: undefined,
    gbLow:
      typeof boundary.out.physGbLower === "number"
        ? boundary.out.physGbLower
        : undefined,
    gbHigh:
      typeof boundary.out.physGbUpper === "number"
        ? boundary.out.physGbUpper
        : undefined,
    gbPfa: undefined,
  };
}
