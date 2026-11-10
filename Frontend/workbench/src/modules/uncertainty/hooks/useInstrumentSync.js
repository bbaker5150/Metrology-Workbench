import { useCallback } from "react";
import axios from "axios";
import { UNCERTAINTY_API } from "../constants/constants";
import { computeSyncState, diffFromSnapshot, buildSyncPayload } from "../utils/instrumentSync";
import { formatInstrumentSyncError } from "../utils/instrumentSyncError";
import { getDeviceKey, instrumentRequestConfig } from "../utils/deviceKey";

export const useInstrumentSync = (onSynced) => {
  const syncToShared = useCallback(async instrument => {
    try {
      const payload = { ...buildSyncPayload(instrument), owner: getDeviceKey() };
      const { data } = await axios.post(`${UNCERTAINTY_API}/instruments/`, payload, instrumentRequestConfig());
      if (!data?.id) return { ok: false, message: "The library returned no instrument ID after submission." };
      onSynced?.(data);
      return { ok: true, instrument: data };
    } catch (error) {
      return { ok: false, message: formatInstrumentSyncError(error) };
    }
  }, [onSynced]);

  return { getSyncState: computeSyncState, getDiff: diffFromSnapshot, syncToShared };
};

export default useInstrumentSync;
