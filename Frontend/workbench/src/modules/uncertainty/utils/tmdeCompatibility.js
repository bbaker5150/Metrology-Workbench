import { unitSystem } from "./uncertaintyMath";

const hasValue = (value) =>
  value !== undefined && value !== null && value !== "";

export const assessRangeCompatibility = (
  range,
  measurementPoint,
  rangeLabel = "range",
  { requirePointQualifier = true } = {},
) => {
  const pointValue = Number(measurementPoint?.value);
  const pointUnit = measurementPoint?.unit;
  const rangeUnit = range?.unit;

  if (!Number.isFinite(pointValue) || !pointUnit) {
    return {
      compatible: false,
      reason: "Define the measurement point value and unit first.",
    };
  }

  if (!range || Object.keys(range).length === 0 || !rangeUnit) {
    return {
      compatible: false,
      reason: `Select a ${rangeLabel} with a defined unit.`,
    };
  }

  const pointQuantity = unitSystem.getQuantity(pointUnit);
  const rangeQuantity = unitSystem.getQuantity(rangeUnit);
  const unitsMatch = pointQuantity && rangeQuantity
    ? pointQuantity === rangeQuantity
    : pointUnit === rangeUnit;

  if (!unitsMatch) {
    return {
      compatible: false,
      reason: `${rangeUnit} is not compatible with the point unit ${pointUnit}.`,
    };
  }

  const pointInRangeUnit =
    pointUnit === rangeUnit
      ? pointValue
      : unitSystem.fromBaseUnit(
          unitSystem.toBaseUnit(pointValue, pointUnit),
          rangeUnit,
        );
  const min = Number(range.min);
  const max = Number(range.max);

  if (hasValue(range.min) && Number.isFinite(min) && pointInRangeUnit < min) {
    return {
      compatible: false,
      reason: `${pointValue} ${pointUnit} is below this ${rangeLabel}.`,
    };
  }

  if (hasValue(range.max) && Number.isFinite(max) && pointInRangeUnit > max) {
    return {
      compatible: false,
      reason: `${pointValue} ${pointUnit} exceeds this ${rangeLabel}.`,
    };
  }

  if (range.qualifier && (range.qualifierGroupId || measurementPoint?.qualifier)) {
    const qualifier = range.qualifier;
    const nominal = measurementPoint?.qualifier;
    const result = assessQualifierCompatibility(qualifier, nominal, { requirePointQualifier });
    if (!result.compatible) return result;
  }
  return { compatible: true, reason: "" };
};

export const assessTmdeCompatibility = (range, measurementPoint) =>
  assessRangeCompatibility(range, measurementPoint, "TMDE range");

// Numeric qualifiers retain unit conversion; categorical qualifiers match their
// literal label. Automatic selection requires every dimension; an explicitly
// selected budget leaf only needs to match qualifiers supplied on the point.
export const assessQualifierCompatibility = (qualifier, nominal, { requirePointQualifier = true } = {}) => {
  const assessChild = () => qualifier.qualifier
    ? assessQualifierCompatibility(qualifier.qualifier, nominal?.qualifier, { requirePointQualifier })
    : { compatible: true, reason: "" };
  if (!hasValue(nominal?.value)) return requirePointQualifier
    ? { compatible: false, reason: `Define the measurement point qualifier (${qualifier.name || "Qualifier"}).` }
    : assessChild();
  if (qualifier.text != null) {
    if (String(nominal.value) !== String(qualifier.text)) return { compatible: false, reason: "The point does not match this qualifier." };
    return assessChild();
  }
  const min = qualifier.min ?? qualifier.value ?? "";
  const max = qualifier.max ?? qualifier.value ?? "";
  const numeric = [min, max].filter(hasValue).every(value => Number.isFinite(Number(value))) && Number.isFinite(Number(nominal.value));
  if (numeric && qualifier.unit) {
    const { qualifier: child, ...bounds } = qualifier;
    const result = assessRangeCompatibility({ ...bounds, min, max }, nominal, "qualifier range");
    if (!result.compatible) return result;
  } else if (numeric) {
    if ((hasValue(min) && Number(nominal.value) < Number(min)) || (hasValue(max) && Number(nominal.value) > Number(max))) return { compatible: false, reason: "The point is outside this qualifier range." };
  } else if (![min, max].filter(hasValue).map(String).includes(String(nominal.value))) {
    return { compatible: false, reason: "The point does not match this qualifier." };
  }
  return assessChild();
};
