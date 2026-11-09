import { recalculatePointUncertaintyFields } from "./riskCompute";
import { getPointUutRanges, isManualPointTolerance, resolvePointRange, samePointRangeInputs } from "./pointUutRange";

// Update stored source snapshots in the same session transaction as an instrument
// edit, so every sidebar row and its risk calculation see the new specification.
export function syncPointTolerances(session, previous) {
  const loading = !previous;
  previous ||= {};
  if (session.uuts === previous.uuts && session.tmdes === previous.tmdes && session.testPoints === previous.testPoints) return session;
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
      if (old !== uut && (!old || JSON.stringify(old) !== JSON.stringify(uut))) changed.set(String(uut.id), uut);
    }
  }
  const changedTmdeIds = new Set();
  if (!loading && session.tmdes !== previous.tmdes) {
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
  if (!changed.size && !changedTmdeIds.size && session.testPoints === previous.testPoints) return session;
  const previousPoints = indexItems(previous.testPoints);
  const uuts = indexItems(session.uuts);
  let updated = false;
  const testPoints = (session.testPoints || []).map(point => {
    const uutId = point.activeUutId || point.associatedUutIds?.[0];
    const existing = point.uutTolerance;
    if (isManualPointTolerance(existing)) return point;
    const sourceChanged = changed.has(String(uutId));
    const old = previousPoints.get(String(point.id));
    const nominalChanged = !old || !samePointRangeInputs(point.testPointInfo, old.testPointInfo);
    const assignmentChanged = uutId !== (old?.activeUutId || old?.associatedUutIds?.[0]);
    if (!sourceChanged && !nominalChanged && !assignmentChanged) return point;
    const uut = uuts.get(String(uutId));
    if (!uut) return point;
    const rows = getPointUutRanges(uut);
    if (loading && !rows.length) return point;
    const tolerance = resolvePointRange(rows, point.testPointInfo, existing, { keepUnmatched: loading || !nominalChanged });
    // Legacy snapshots did not record how a range was chosen. Only ambiguous
    // snapshots need a new decision when opening an existing session.
    if (loading && existing && !existing.rangeSelection && tolerance?.rangeSelection !== "required") return point;
    if (JSON.stringify(tolerance) === JSON.stringify(existing)) return point;
    updated = true;
    return { ...point, uutTolerance: tolerance };
  });
  const result = updated ? { ...session, testPoints } : session;
  if (loading || (!changed.size && !changedTmdeIds.size)) return result;
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
