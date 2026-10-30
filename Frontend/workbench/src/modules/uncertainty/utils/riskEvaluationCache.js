import { computeRiskEvaluationMap } from "./riskCompute";

// React replaces edited points and shared definitions immutably. Keep the last
// evaluation of each unchanged point instead of reevaluating the entire session
// when the active budget saves its calculated fields. Shared changes invalidate
// every entry; the pure calculation API remains uncached for other callers.
export function createRiskEvaluationCache(evaluate = computeRiskEvaluationMap) {
  let shared = null, guardband, entries = new Map();
  return (points, session, includeGuardband = false) => {
    const { testPoints: _points, ...nextShared } = session || {};
    if (!shared || guardband !== includeGuardband || Object.keys(shared).length !== Object.keys(nextShared).length ||
      Object.keys(nextShared).some(key => !Object.is(shared[key], nextShared[key]))) entries.clear();
    shared = nextShared;
    guardband = includeGuardband;
    const nextEntries = new Map();
    const result = { metrics: {}, statuses: {}, uncertainties: {} };
    for (const point of points || []) {
      const previous = entries.get(point.id);
      const value = previous?.point === point ? previous.value : evaluate([point], session, includeGuardband);
      nextEntries.set(point.id, { point, value });
      for (const key of Object.keys(result)) Object.assign(result[key], value[key]);
    }
    entries = nextEntries;
    return result;
  };
}
