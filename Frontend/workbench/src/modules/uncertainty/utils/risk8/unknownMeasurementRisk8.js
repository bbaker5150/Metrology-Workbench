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
  resolution = "",
}) {
  const singleSided = getSingleSidedTolerance(tolerance);
  if (!isUnknownMeasurementTolerance(tolerance)) return null;

  const direction = singleSided.direction === "low" ? "low" : "high";
  const limit = singleSided.limit;
  const lowerLimit = direction === "low" ? limit : "";
  const upperLimit = direction === "high" ? limit : "";

  const result = runRisk8FromApp({
    measurement: "unknown",
    nominal: "",
    uutLowerLimit: lowerLimit,
    uutUpperLimit: upperLimit,
    uCalNative,
    tur: "",
    assumedReop: "",
    requiredReop: "",
    reqPFA,
    resolution,
  });

  return {
    ...result,
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
 * rows and exports. `pfa` is the boundary PFA achieved by construction; metrics
 * that require a measured value remain undefined and therefore render as N/A.
 */
export function toUnknownMeasurementSummary(boundary) {
  if (!boundary?.computed || boundary.out?.statusMit !== "OK") return null;

  return {
    riskMethod: "risk8-pfa-boundary",
    riskAvailability: "pfa-boundary-only",
    pfa:
      typeof boundary.out.mitPfa === "number"
        ? boundary.out.mitPfa * 100
        : undefined,
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
    gbPfa:
      typeof boundary.out.mitPfa === "number"
        ? boundary.out.mitPfa * 100
        : undefined,
  };
}
