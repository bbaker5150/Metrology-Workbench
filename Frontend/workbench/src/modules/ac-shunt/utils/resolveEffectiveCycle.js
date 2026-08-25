// src/utils/resolveEffectiveCycle.js
//
// Shared resolver for "which cycle does the chart actually show?" used by
// both CalibrationChart (its own cycle picker) and Calibration.jsx (which
// needs to mirror the chart's resolved cycle into LiveStabilityTracker).
//
// Two helpers, kept tiny so both call sites can share them without
// risking subtle divergence in the "what is the latest cycle" answer.

/**
 * Distinct cycle ordinals present across every dataset in a chart-data
 * shape `{ datasets: [{ data: [{cycle, ...}] }] }`. Untagged legacy
 * readings are bucketed into cycle 1 so older sessions still render.
 * Returns a sorted (ascending) array.
 */
export function listAvailableCycles(chartData) {
  const seen = new Set();
  (chartData?.datasets || []).forEach((ds) => {
    (ds.data || []).forEach((pt) => {
      const c = Number.isFinite(pt?.cycle) ? Number(pt.cycle) : 1;
      seen.add(c);
    });
  });
  return Array.from(seen).sort((a, b) => a - b);
}

/**
 * Resolve the cycle the chart will actually display:
 *   - explicit user selection wins (if still present in availableCycles)
 *   - otherwise: the explicitly supplied active live cycle, even before its
 *     first reading arrives
 *   - otherwise: latest available cycle
 *   - falls back to 1 when there is no data at all
 */
export function resolveEffectiveCycle(
  selectedCycle,
  availableCycles,
  activeCycle = null,
) {
  if (selectedCycle != null && availableCycles.includes(selectedCycle)) {
    return selectedCycle;
  }
  if (Number.isFinite(activeCycle)) {
    return Number(activeCycle);
  }
  return availableCycles.length
    ? availableCycles[availableCycles.length - 1]
    : 1;
}
