import { useCallback } from "react";
import axios from "axios";
import { UNCERTAINTY_API } from "../constants/constants";
import {
  computeSyncState,
  diffFromSnapshot,
  buildSyncPayload,
} from "../utils/instrumentSync";

/**
 * Sync primitives for the local/shared instrument library
 * (feature/inline-instrument-tables). Thin React wrapper over the pure helpers
 * in utils/instrumentSync — it adds the password-gated network call that pushes
 * a diverged/new instrument up to the validated (shared) library.
 *
 * @param {(instrument:object)=>void} [onSynced] - called with the server's
 *        canonical record after a successful sync, so the caller can reconcile
 *        its in-memory list (the row then flips back to green).
 */
export const useInstrumentSync = (onSynced) => {
  /**
   * Push an instrument to the validated library. Returns a result object rather
   * than throwing so callers can surface the outcome inline:
   *   { ok: true, instrument } | { ok: false, reason: "password"|"network", message }
   */
  const syncToShared = useCallback(
    async (instrument, password) => {
      try {
        const payload = buildSyncPayload(instrument, password);
        const res = await axios.post(`${UNCERTAINTY_API}/instruments/`, payload);
        if (res?.data) onSynced?.(res.data);
        return { ok: true, instrument: res?.data };
      } catch (e) {
        if (e?.response?.status === 403) {
          return {
            ok: false,
            reason: "password",
            message: e.response?.data?.detail || "Invalid shared-library password.",
          };
        }
        return {
          ok: false,
          reason: "network",
          message: "Could not reach the shared library. Try again.",
        };
      }
    },
    [onSynced],
  );

  return {
    getSyncState: computeSyncState,
    getDiff: diffFromSnapshot,
    syncToShared,
  };
};

export default useInstrumentSync;
