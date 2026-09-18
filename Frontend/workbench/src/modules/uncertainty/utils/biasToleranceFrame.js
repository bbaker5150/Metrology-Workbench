import { calculateUncertaintyFromToleranceObject, snapLimitsToResolution, resolveResolutionNative } from "./uncertaintyMath";
import { normalizeToleranceFrame } from "./risk8/riskAdapter8";
import { updateToleranceOutputs } from "./risk8/toleranceTypes8";

/** Workbook MAIN AC/AD (Risk_Data K/L) express BOTH bias percentages in the
 * final UUT tolerance frame. This is not % IV and not the TMDE error limit.
 * Reuse the risk adapter's normalization to keep asymmetric/one-sided geometry
 * identical: h=(upper-lower)/2, N-lower, or upper-N. Resolution snapping matches
 * the acceptance limits supplied by both public risk entry points.
 *
 * `limits` optionally supplies the exact active risk limits, avoiding a second
 * tolerance evaluation and preserving manually edited risk-input geometry.
 * There is deliberately no nominal-magnitude fallback for incomplete limits.
 */
export function getBiasToleranceFrame(point = {}, session = {}, limits) {
  const reference = point.testPointInfo?.parameter || {};
  const nominal = reference.value === "" || reference.value == null ? NaN : Number(reference.value);
  const tolerance = point.uutTolerance || session.uutTolerance || {};
  const single = tolerance.singleSided || tolerance.tolerances?.singleSided;
  if (single?.measurement === "unknown") return null;
  let lower, upper;
  if (limits) {
    ({ lower, upper } = limits);
  } else if (single) {
    const limit = single.limit === "" || single.limit == null ? NaN : Number(single.limit);
    lower = single.direction === "low" ? limit : NaN;
    upper = single.direction === "high" ? limit : NaN;
  } else {
    const { breakdown } = calculateUncertaintyFromToleranceObject(tolerance, reference);
    const terms = (breakdown || []).filter(term => Number.isFinite(term.absoluteLow) && Number.isFinite(term.absoluteHigh));
    if (!terms.length) return null;
    lower = nominal + terms.reduce((sum, term) => sum + term.absoluteLow - nominal, 0);
    upper = nominal + terms.reduce((sum, term) => sum + term.absoluteHigh - nominal, 0);
    ({ low: lower, high: upper } = snapLimitsToResolution(lower, upper, resolveResolutionNative(tolerance, reference.unit)));
  }
  const type = updateToleranceOutputs(nominal, Number.isFinite(lower) ? lower : "", Number.isFinite(upper) ? upper : "");
  const frame = type.ok ? normalizeToleranceFrame(type.tolType, nominal, lower, upper) : null;
  return frame ? { ...frame, unit: reference.unit || "" } : null;
}
