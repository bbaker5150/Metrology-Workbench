import { getInstrumentRangeRows, isDraftInstrumentRange } from "./instrumentFunctionSelection";
import { assessRangeCompatibility } from "./tmdeCompatibility";

const rowsByUut = new WeakMap();
const awaitingChoice = Object.freeze({ rangeSelection: "required" });

export function getPointUutRanges(uut) {
  if (!uut) return [];
  if (!rowsByUut.has(uut)) rowsByUut.set(uut, getInstrumentRangeRows(uut).filter(row => !isDraftInstrumentRange(row)));
  return rowsByUut.get(uut);
}

export function matchingPointRanges(rows, pointInfo = {}) {
  const nominal = { ...pointInfo?.parameter, qualifier: pointInfo?.qualifier };
  if (nominal.value == null || String(nominal.value).trim() === "" || !nominal.unit) return [];
  return rows.filter(row => {
    const bounds = row.isSingleValue ? { ...row, min: row.value ?? row.min, max: row.value ?? row.min } : row;
    return assessRangeCompatibility(bounds, nominal, "UUT range").compatible;
  });
}

export function samePointRangeInputs(a, b) {
  return a?.parameter?.value === b?.parameter?.value && a?.parameter?.unit === b?.parameter?.unit &&
    (a?.qualifier === b?.qualifier || JSON.stringify(a?.qualifier) === JSON.stringify(b?.qualifier));
}

export function samePointRange(a, b) {
  if (!a || !b || (a.functionId && b.functionId && String(a.functionId) !== String(b.functionId))) return false;
  const id = a.rangeId ?? a.id;
  if (id != null || (b.rangeId ?? b.id) != null) return id != null && String(id) === String(b.rangeId ?? b.id);
  return a._index != null && a._index === b._index && a.functionName === b.functionName &&
    a.min === b.min && a.max === b.max && a.unit === b.unit;
}

export function choosePointRange(range, previous) {
  return { ...range, rangeSelection: "explicit", includeResolutionInBudget: previous?.includeResolutionInBudget ?? false };
}

export function resolvePointRange(rows, pointInfo, existing, { keepUnmatched = false } = {}) {
  const saved = rows.find(row => samePointRange(row, existing));
  const candidates = matchingPointRanges(rows, pointInfo);
  // Adding a qualifier to an already chosen leaf does not erase that point's
  // budget. Keep its stable range identity when the point inputs are unchanged;
  // qualifiers the point actually supplies still have to match the edited leaf.
  const savedQualifierMatches = saved && (!saved.qualifier || assessRangeCompatibility(
    saved, { ...pointInfo?.parameter, qualifier: pointInfo?.qualifier }, "UUT range", { requirePointQualifier: false },
  ).compatible);
  if (existing?.rangeSelection === "explicit" && saved &&
    (candidates.includes(saved) || (keepUnmatched && savedQualifierMatches) || pointInfo?.parameter?.value === "")) return choosePointRange(saved, existing);
  if (candidates.length > 1) return existing?.includeResolutionInBudget
    ? { ...awaitingChoice, includeResolutionInBudget: true }
    : awaitingChoice;
  const next = candidates[0] || (keepUnmatched && savedQualifierMatches ? saved : null);
  return next ? { ...next, includeResolutionInBudget: existing?.includeResolutionInBudget ?? false } : null;
}

export const isManualPointTolerance = tolerance => tolerance && Object.keys(tolerance).length > 0 &&
  !tolerance.rangeSelection && tolerance.rangeId == null && tolerance.id == null && tolerance._index == null && !tolerance.functionId;
