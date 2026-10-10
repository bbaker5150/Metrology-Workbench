import { toleranceUnitMismatch } from "./incompleteBudget";
import { unitSystem } from "./uncertaintyMath";

const parseNumericValue = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const match = String(value).match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Format a point's calculated uncertainty in the point's native measurement
 * unit. Calculations retain both a legacy relative PPM value and an absolute
 * SI-base value; the latter is the source of truth for the measurement-point
 * list so a pound, volt, or temperature point is not mislabeled as PPM.
 */
export const getSidebarUncertaintyDisplayValue = (point, kind, liveResult) => {
  if (liveResult === null) return null;
  const unit = point?.testPointInfo?.parameter?.unit || "";
  // Imported/unopened points can still carry cached totals. Never display a
  // number from an incompatible UUT frame while waiting for recalculation.
  if (toleranceUnitMismatch(point?.uutTolerance, unit, unitSystem)) return null;
  const source = liveResult === undefined ? point : liveResult;
  const absoluteBase = source?.[`${kind}_uncertainty_absolute_base`];
  const baseValue = Number(absoluteBase);
  const nativeValue =
    absoluteBase != null && Number.isFinite(baseValue)
      ? unit ? unitSystem.fromBaseUnit(baseValue, unit) : baseValue
      : source?.[`${kind}_uncertainty`];
  const numeric = parseNumericValue(nativeValue);

  if (numeric === null) return null;

  // Keep the historical PPM fallback for older points that predate the native
  // absolute uncertainty fields and therefore do not carry a point unit.
  const displayUnit = unit || "ppm";
  return { numeric, displayUnit };
};

export const formatSidebarUncertainty = (point, kind, liveResult) => {
  const value = getSidebarUncertaintyDisplayValue(point, kind, liveResult);
  if (!value) return "-";

  return value.numeric.toPrecision(4);
};

/** Full unrounded numeric value used by the native hover tooltip. */
export const formatSidebarUncertaintyFull = (point, kind, liveResult) => {
  const value = getSidebarUncertaintyDisplayValue(point, kind, liveResult);
  if (!value) return "-";

  return String(value.numeric);
};
