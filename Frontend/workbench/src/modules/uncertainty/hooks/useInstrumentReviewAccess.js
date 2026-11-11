import { useEffect, useState } from "react";
import axios from "axios";
import { UNCERTAINTY_API } from "../constants/constants";
import { instrumentRequestConfig } from "../utils/deviceKey";

// Read capabilities without loading other users' submitted definitions.
export default function useInstrumentReviewAccess() {
  const [canValidate, setCanValidate] = useState(false);
  useEffect(() => {
    let request;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      setCanValidate(false);
      (async () => {
        try {
          const { data } = await axios.get(`${UNCERTAINTY_API}/instrument-review-access/`, {
            ...instrumentRequestConfig(), signal: controller.signal,
          });
          if (!controller.signal.aborted) setCanValidate(data?.canValidate === true);
        } catch { /* Unavailable or denied access never enables reviewer actions. */ }
      })();
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      request?.abort();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return canValidate;
}
