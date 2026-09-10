// src/hooks/useCycleAnalytics.js
//
// Single source of truth for AC-DC pair-cycle analytics on the frontend.
//
// The backend (CalibrationResults.recompute_pair_aggregate, exposed via
// `pair_analytics` on CalibrationResultsSerializer) computes pair rows,
// outlier sets, exclusions, and the headline mean / u_A. Three React views
// share this state — CycleStatisticsTracker, CalibrationResults (the
// "Calculations" subtab), and Calibration's Calculate-tab — so they must
// agree pixel-for-pixel.
//
// Toggles (ABBA, outlier filter, manual exclude) PATCH /analytics/ for the
// focused test point's forward direction (the recompute mirrors state onto
// the reverse row). We refresh the global data via onDataUpdate after each
// successful PATCH so all consumers re-render from the same backend state.

import { useCallback, useMemo, useRef } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/constants";

const EMPTY_STATS = { mean: null, uA: null, n: 0 };

function pickPayload(focusedTestPoint) {
  // The pair_analytics blob is mirrored across Fwd/Rev — read whichever
  // side has data so partial pairs (only one direction collected) still
  // render the row table.
  return (
    focusedTestPoint?.forward?.results?.pair_analytics ||
    focusedTestPoint?.reverse?.results?.pair_analytics ||
    null
  );
}

function targetTestPointId(focusedTestPoint) {
  // Prefer Forward as the canonical write target; recompute mirrors both.
  return (
    focusedTestPoint?.forward?.id ||
    focusedTestPoint?.reverse?.id ||
    null
  );
}

export default function useCycleAnalytics({
  focusedTestPoint,
  sessionId,
  onDataUpdate,
  defaultUseAbba = true,
  direction = "paired",
}) {
  const inFlight = useRef(false);

  const canonical = useMemo(() => pickPayload(focusedTestPoint), [focusedTestPoint]);
  const payload = useMemo(() => direction === "paired" ? canonical : {
    ...canonical,
    ...(canonical?.directional?.[direction] || {
      pair_rows: [], pair_delta_uut_ppm: null, pair_type_a_uncertainty_ppm: null,
      n_pairs_used: 0, auto_excluded_pairs: [], flagged_pairs: [], manual_excluded_pairs: [],
    }),
  }, [canonical, direction]);

  const useAbba = payload?.use_abba_pairing != null
    ? Boolean(payload.use_abba_pairing)
    : Boolean(defaultUseAbba);
  const filterMode = payload?.outlier_filter_mode || "none";
  const manualExcluded = useMemo(
    () => new Set(payload?.manual_excluded_pairs || []),
    [payload]
  );
  const autoExcluded = useMemo(
    () => new Set(payload?.auto_excluded_pairs || []),
    [payload]
  );
  const flagged = useMemo(
    () => new Set(payload?.flagged_pairs || []),
    [payload]
  );

  // Pair rows from backend are already keyed snake_case; expose them as
  // camelCase for the JSX. Empty when no analytics yet (no cycles run).
  const pairRows = useMemo(() => {
    return (payload?.pair_rows || []).map((r) => ({
      pairNum: r.pair_num,
      fwdCycleNum: r.fwd_cycle_num,
      revCycleNum: r.rev_cycle_num,
      fwdDelta: r.fwd_delta,
      revDelta: r.rev_delta,
      pairedAvg: r.paired_avg,
    }));
  }, [payload]);

  // Headline stats from backend (post-exclusion). Fall back to local fields
  // on the results row for pre-pair_analytics sessions.
  const stats = useMemo(() => {
    if (!payload) return EMPTY_STATS;
    return {
      mean: payload.pair_delta_uut_ppm,
      uA: payload.pair_type_a_uncertainty_ppm,
      n: payload.n_pairs_used ?? 0,
    };
  }, [payload]);

  const patch = useCallback(
    async (body) => {
      const tpId = targetTestPointId(focusedTestPoint);
      if (!tpId || !sessionId) return;
      if (inFlight.current) return; // simple coalesce: one PATCH at a time
      inFlight.current = true;
      try {
        await axios.patch(
          `${API_BASE_URL}/calibration_sessions/${sessionId}/test_points/${tpId}/analytics/`,
          body
        );
        if (onDataUpdate) await onDataUpdate();
      } catch (e) {
        // Swallow network errors here — the UI keeps the previous payload.
        console.warn("useCycleAnalytics PATCH failed:", e);
      } finally {
        inFlight.current = false;
      }
    },
    [focusedTestPoint, sessionId, onDataUpdate]
  );

  const setUseAbba = useCallback(
    (next) => patch({ use_abba_pairing: !!next }),
    [patch]
  );

  const setFilterMode = useCallback(
    (mode) => patch({ outlier_filter_mode: mode === "auto" ? "auto" : "none" }),
    [patch]
  );

  const toggleExclusion = useCallback(
    (pairNum) => {
      const next = new Set(manualExcluded);
      if (next.has(pairNum)) next.delete(pairNum);
      else next.add(pairNum);
      return patch({ manual_excluded_pairs: Array.from(next) });
    },
    [manualExcluded, patch]
  );

  return {
    useAbba,
    filterMode,
    manualExcluded,
    autoExcluded,
    flagged,
    pairRows,
    stats,
    setUseAbba,
    setFilterMode,
    toggleExclusion,
    hasAnalytics: !!canonical,
  };
}
