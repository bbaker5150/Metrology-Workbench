import { recalculatePointUncertaintyFields } from "./riskCompute";
import { getInstrumentRangeRows, isDraftInstrumentRange } from "./instrumentFunctionSelection";
import { assessRangeCompatibility } from "./tmdeCompatibility";
const filled = value => value != null && String(value).trim() !== "";
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

// Update stored source snapshots in the same session transaction as an instrument
// edit, so every sidebar row and its risk calculation see the new specification.
export function syncPointTolerances(session, previous) {
  if (!previous) return session;
  if (session.uuts === previous.uuts && session.tmdes === previous.tmdes) return session;
  const indexItems = items => {
    const index = new Map();
    for (const item of items || []) {
      if (item.id != null && !index.has(String(item.id))) index.set(String(item.id), item);
    }
    return index;
  };
  const changed = new Map();
  if (session.uuts !== previous.uuts) {
    const previousUuts = indexItems(previous.uuts);
    for (const uut of session.uuts || []) {
      const old = uut.id == null ? undefined : previousUuts.get(String(uut.id));
      if (old !== uut && JSON.stringify(old) !== JSON.stringify(uut)) changed.set(String(uut.id), uut);
    }
  }
  const changedTmdeIds = new Set();
  if (session.tmdes !== previous.tmdes) {
    const previousTmdes = indexItems(previous.tmdes);
    const nextTmdes = indexItems(session.tmdes);
    const changedIds = new Set();
    for (const id of new Set([...previousTmdes.keys(), ...nextTmdes.keys()])) {
      const old = previousTmdes.get(id), next = nextTmdes.get(id);
      if (old !== next && JSON.stringify(old) !== JSON.stringify(next)) changedIds.add(id);
    }
    for (const tmde of [...(session.tmdes || []), ...(previous.tmdes || [])]) {
      if (tmde.id != null && changedIds.has(String(tmde.id))) {
        for (const value of [tmde.id, tmde.sourceId, tmde.instrument?.id]) if (value != null) changedTmdeIds.add(String(value));
      }
    }
  }
  if (!changed.size && !changedTmdeIds.size) return session;
  let updated = false;
  const testPoints = (session.testPoints || []).map(point => {
    const uutId = point.activeUutId || point.associatedUutIds?.[0];
    const uut = changed.get(String(uutId));
    if (!uut) return point;
    const existing = point.uutTolerance;
    // A standalone, manually authored point tolerance has no source range.
    if (existing && Object.keys(existing).length && existing.rangeId == null && existing.id == null && !existing.functionId) return point;
    const parameter = { ...point.testPointInfo?.parameter, qualifier: point.testPointInfo?.qualifier };
    const rows = getInstrumentRangeRows(uut);
    const candidates = rows.filter(row => {
      if (isDraftInstrumentRange(row)) return false;
      if (parameter.unitSelectionExplicit && !parameter.unit) return false;
      return assessRangeCompatibility(row, parameter, "UUT range").compatible;
    });
    const next = rows.find(row => (!row.qualifier || assessRangeCompatibility(row, parameter, "UUT range").compatible) && sameId(row.rangeId ?? row.id, existing?.rangeId ?? existing?.id) &&
      (!existing?.functionId || sameId(row.functionId, existing.functionId))) || candidates[0] || null;
    const tolerance = next ? {
      ...next,
      includeResolutionInBudget: existing?.includeResolutionInBudget ?? false,
    } : null;
    if (JSON.stringify(tolerance) === JSON.stringify(existing)) return point;
    updated = true;
    return { ...point, uutTolerance: tolerance };
  });
  const result = updated ? { ...session, testPoints } : session;
  let recalculated = false;
  const refreshedPoints = (result.testPoints || []).map(point => {
    const components = point.components || [];
    const uutId = point.activeUutId || point.associatedUutIds?.[0];
    const resolutionLinked = components.some(c => c.uutResolutionBudgetSource) ||
      point.uutTolerance?.includeResolutionInBudget || point.uutTolerance?.tolerances?.includeResolutionInBudget;
    const sources = [...components, ...(point.tmdeTolerances || [])];
    const tmdeChanged = sources.some(source => [source.tmdeBudgetSourceId, source.sourceTmdeId, source.typeBSourceTmdeId,
      source.sourceId, source.id, source.sourceInstrument?.id, source.instrument?.id]
      .some(id => id != null && changedTmdeIds.has(String(id))));
    if (!(changed.has(String(uutId)) && resolutionLinked) && !tmdeChanged) return point;
    recalculated = true;
    return recalculatePointUncertaintyFields({ ...point, calculatedBudgetComponents: [], calculatedBudgetGroups: [],
      is_detailed_uncertainty_calculated: false, mcSummary: null, risk8MonteCarloResult: null }, result);
  });
  return recalculated ? { ...result, testPoints: refreshedPoints } : result;
}
