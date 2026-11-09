import { useCallback } from "react";
import axios from "axios";
import { UNCERTAINTY_API } from "../constants/constants";
import { computeSyncState, diffFromSnapshot, buildSyncPayload } from "../utils/instrumentSync";
import { getDeviceKey, instrumentRequestConfig } from "../utils/deviceKey";

export const useInstrumentSync = (onSynced) => {
  const syncToShared = useCallback(async instrument => {
    try {
      const payload = { ...buildSyncPayload(instrument), owner: getDeviceKey() };
      const { data } = await axios.post(`${UNCERTAINTY_API}/instruments/`, payload, instrumentRequestConfig());
      onSynced?.(data);
      return { ok: true, instrument: data };
    } catch (error) {
      return { ok: false, message: error.response?.data?.detail || "Could not submit the instrument. Try again." };
    }
  }, [onSynced]);

  return { getSyncState: computeSyncState, getDiff: diffFromSnapshot, syncToShared };
};

export default useInstrumentSync;
