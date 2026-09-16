import { getUnitDisplayLabel } from "./uncertaintyMath";

const escapeRegExp = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const formatRangeLabel = (range = {}, { preferBounds = false } = {}) => {
  const explicitLabel =
    typeof range.range === "string" ? range.range.trim() : "";
  const hasBounds =
    range.min !== undefined &&
    range.min !== null &&
    range.min !== "" &&
    range.max !== undefined &&
    range.max !== null &&
    range.max !== "";
  // A single-point range is one value, including numeric strings from imports.
  const sameBound = hasBounds && Number.isFinite(Number(range.min)) && Number(range.min) === Number(range.max);
  const boundedLabel = hasBounds ? sameBound ? String(range.min) : `${range.min} to ${range.max}` : "";
  const rangeText = preferBounds
    ? boundedLabel || explicitLabel || "Full Range"
    : explicitLabel || boundedLabel || "Full Range";
  const unit = typeof range.unit === "string" ? range.unit.trim() : "";
  const unitLabel = getUnitDisplayLabel(unit);

  if (!unit || rangeText === "Full Range") return rangeText;

  const unitAtEnd = new RegExp(
    `${escapeRegExp(unit)}(?:\\s+Range)?$`,
    "i",
  );

  return unitAtEnd.test(rangeText)
    ? rangeText.replace(unitAtEnd, (match) =>
        match.replace(new RegExp(escapeRegExp(unit), "i"), unitLabel),
      )
    : `${rangeText} ${unitLabel}`;
};
