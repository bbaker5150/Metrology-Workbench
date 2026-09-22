import { useEffect } from "react";
import { flushSync } from "react-dom";
export const FLUSH_EDITORS = "uncertainty:flush-editors";
export default function usePageExitRecovery() {
  useEffect(() => {
    const flush = () => flushSync(() => {
      document.activeElement?.blur?.();
      window.dispatchEvent(new Event(FLUSH_EDITORS));
    });
    const hidden = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
}
