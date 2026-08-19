import { getUnitDisplayLabel, unitSystem } from "./uncertaintyMath";

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
export const getSidebarUncertaintyDisplayValue = (point, kind) => {
  const unit = point?.testPointInfo?.parameter?.unit || "";
  const absoluteBase = point?.[`${kind}_uncertainty_absolute_base`];
  const baseValue = Number(absoluteBase);
  const nativeValue =
    Number.isFinite(baseValue) && unit
      ? unitSystem.fromBaseUnit(baseValue, unit)
      : point?.[`${kind}_uncertainty`];
  const numeric = parseNumericValue(nativeValue);

  if (numeric === null) return null;

  // Keep the historical PPM fallback for older points that predate the native
  // absolute uncertainty fields and therefore do not carry a point unit.
  const displayUnit = unit || "ppm";
  return { numeric, displayUnit };
};

export const formatSidebarUncertainty = (point, kind) => {
  const value = getSidebarUncertaintyDisplayValue(point, kind);
  if (!value) return "-";

  const { numeric, displayUnit } = value;
  return `${numeric.toPrecision(4)} ${getUnitDisplayLabel(displayUnit)}`;
};

/** Full stored/calculated value used by the native hover tooltip. */
export const formatSidebarUncertaintyFull = (point, kind) => {
  const value = getSidebarUncertaintyDisplayValue(point, kind);
  if (!value) return "-";

  return `${String(value.numeric)} ${getUnitDisplayLabel(value.displayUnit)}`;
};
