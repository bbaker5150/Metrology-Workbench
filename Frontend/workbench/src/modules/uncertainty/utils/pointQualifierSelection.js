import { getPointUutRanges, choosePointRange } from "./pointUutRange";
import { assessRangeCompatibility, assessQualifierCompatibility } from "./tmdeCompatibility";
import { formatQualifierValue } from "./qualifierRanges";
import { formatRangeLabel } from "./rangeFormatting";
import { getToleranceErrorSummary, getUnitDisplayLabel, unitSystem } from "./uncertaintyMath";

const hasValue = value => value != null && String(value).trim() !== "";

// Candidates depend on the primary measurement only. Applying the current
// qualifier here would hide alternative branches and every first-time choice.
export function getPointQualifierChoices(uut, pointInfo = {}) {
  const nominal = pointInfo.parameter || {};
  if (!hasValue(nominal.value) || !nominal.unit) return [];
  const names = uut?.instrument?.qualifierColumnNames || uut?.qualifierColumnNames || [];
  return getPointUutRanges(uut).flatMap((range, index) => {
    if (!range.qualifier) return [];
    const bounds = range.isSingleValue
      ? { ...range, min: range.value ?? range.min, max: range.value ?? range.min, qualifier: undefined }
      : { ...range, qualifier: undefined };
    if (!assessRangeCompatibility(bounds, nominal, "UUT range").compatible) return [];
    const path = [];
    for (let node = range.qualifier; node; node = node.qualifier) {
      const name = String(names[path.length] || "Qualifier").trim() || "Qualifier";
      const label = formatQualifierValue(node) || "Not Set";
      path.push({ id: node.id ?? JSON.stringify([name, label]), name, label });
    }
    return [{
      key: JSON.stringify([uut?.id ?? uut?.instrument?.id ?? "", range.functionId ?? range.functionName ?? "", range.rangeId ?? range.id ?? range._index ?? index]),
      range, path, functionName: range.functionName || "",
      rangeLabel: formatRangeLabel(range, { preferBounds: true }),
      summary: getToleranceErrorSummary(range, nominal),
    }];
  });
}

// Instrument qualifiers describe categories or bands. A point stores actual
// nominal values: choosing a numeric band must never invent a test frequency.
export function normalizeSelectedQualifier(source, existing) {
  if (!source) return undefined;
  const { qualifier: child, ...dimension } = source;
  const min = source.min ?? source.value ?? "";
  const max = source.max ?? source.value ?? "";
  const single = source.isSingleValue || (hasValue(min) && hasValue(max) && String(min) === String(max));
  const result = { name: source.name || "Qualifier", value: "", unit: source.unit || "" };
  if (source.text != null) {
    result.value = String(source.text);
    result.unit = "";
  } else if (single) {
    result.value = source.value ?? min;
    result.min = result.value;
    result.max = result.value;
    result.isSingleValue = true;
  } else {
    result.min = min;
    result.max = max;
    if (hasValue(existing?.value) && assessQualifierCompatibility(dimension, existing).compatible) {
      result.value = existing.value;
      result.unit = existing.unit || result.unit;
      if (source.unit && result.unit !== source.unit) {
        for (const key of ["min", "max"]) {
          if (hasValue(result[key]) && Number.isFinite(Number(result[key]))) {
            result[key] = unitSystem.fromBaseUnit(unitSystem.toBaseUnit(Number(result[key]), source.unit), result.unit);
          }
        }
      }
    }
  }
  if (child) result.qualifier = normalizeSelectedQualifier(child, existing?.qualifier);
  return result;
}

export function validatePointQualifierChoice(choice, qualifier) {
  if (!choice?.range?.qualifier) return { compatible: false, reason: "Choose an instrument qualifier." };
  return assessQualifierCompatibility(choice.range.qualifier, qualifier);
}

export function applyPointQualifierChoice(point, choice, qualifier) {
  const info = point.testPointInfo || {};
  const selected = qualifier ?? normalizeSelectedQualifier(choice.range.qualifier, info.qualifier);
  return {
    ...point,
    testPointInfo: {
      ...info, qualifier: selected,
      parameter: { ...info.parameter, qualifier: selected },
    },
    uutTolerance: choosePointRange(choice.range, point.uutTolerance),
  };
}

export function formatPointQualifierSelection(qualifier) {
  const labels = [];
  for (let node = qualifier; node; node = node.qualifier) {
    const value = String(node.value ?? "").trim();
    const unit = String(node.unit ?? "").trim();
    if (!value) continue;
    const displayUnit = getUnitDisplayLabel(unit);
    const alreadyIncludesUnit = [unit, displayUnit].some(suffix => suffix && value.toLowerCase().endsWith(` ${suffix.toLowerCase()}`));
    labels.push([value, alreadyIncludesUnit ? "" : displayUnit].filter(Boolean).join(" "));
  }
  return labels.join(" › ");
}
