import { getInstrumentRangeRows } from "./instrumentFunctionSelection";
import { getUnitDisplayLabel } from "./uncertaintyMath";
const filled = value => value != null && String(value).trim() !== "";
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

// Update stored source snapshots in the same session transaction as an instrument
// edit, so every sidebar row and its risk calculation see the new specification.
export function syncPointTolerances(session, previous) {
  if (!previous || session.uuts === previous.uuts) return session;
  const changed = new Map();
  for (const uut of session.uuts || []) {
    const old = (previous.uuts || []).find(item => sameId(item.id, uut.id));
    if (JSON.stringify(old) !== JSON.stringify(uut)) changed.set(String(uut.id), uut);
  }
  if (!changed.size) return session;
  let updated = false;
  const testPoints = (session.testPoints || []).map(point => {
    const uutId = point.activeUutId || point.associatedUutIds?.[0];
    const uut = changed.get(String(uutId));
    if (!uut) return point;
    const existing = point.uutTolerance;
    // A standalone, manually authored point tolerance has no source range.
    if (existing && Object.keys(existing).length && existing.rangeId == null && existing.id == null && !existing.functionId) return point;
    const parameter = point.testPointInfo?.parameter || {};
    const rows = getInstrumentRangeRows(uut);
    const candidates = rows.filter(row => {
      if (parameter.unit && row.unit && getUnitDisplayLabel(parameter.unit) !== getUnitDisplayLabel(row.unit)) return false;
      if (!filled(parameter.value) || !Number.isFinite(Number(parameter.value))) return true;
      if (!filled(row.min) && !filled(row.max)) return true;
      return Number(parameter.value) >= Number(row.min) && Number(parameter.value) <= Number(row.max);
    });
    const next = candidates.find(row => sameId(row.rangeId ?? row.id, existing?.rangeId ?? existing?.id) &&
      (!existing?.functionId || sameId(row.functionId, existing.functionId))) || candidates[0] || null;
    const tolerance = next ? {
      ...next,
      ...(existing?.includeResolutionInBudget !== undefined ? { includeResolutionInBudget: existing.includeResolutionInBudget } : {}),
    } : null;
    if (JSON.stringify(tolerance) === JSON.stringify(existing)) return point;
    updated = true;
    return { ...point, uutTolerance: tolerance };
  });
  return updated ? { ...session, testPoints } : session;
}
