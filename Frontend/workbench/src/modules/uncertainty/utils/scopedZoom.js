// The compact Results design is its 100% baseline. Logical scales are what the
// user edits/sees; the physical factor preserves the previous default geometry.
export const physicalScopedZoom = (key, scale = 1) => Number((scale * (key?.split(":")[0] === "budget-results" ? 0.8 : 1)).toFixed(6));
export function normalizeSizingPreferences(preferences = {}) {
  if (preferences.resultsScaleVersion === 2) return preferences;
  const levels = { ...preferences.scopedZoomLevels };
  for (const key of Object.keys(levels)) {
    if (key.split(":")[0] === "budget-results") levels[key] = Number((levels[key] / 0.8).toFixed(6));
  }
  return { ...preferences, ...(preferences.scopedZoomLevels ? { scopedZoomLevels: levels } : {}), resultsScaleVersion: 2 };
}
