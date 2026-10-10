import { useEffect } from "react";

// Cursor-only state must not rerender the point list or recalculate its widths.
export default function usePointBreakdownCursor() {
  useEffect(() => {
    const attribute = "data-point-breakdown-enabled";
    const setEnabled = enabled => {
      if (document.body.hasAttribute(attribute) !== enabled) {
        document.body.toggleAttribute(attribute, enabled);
      }
    };
    const update = event => setEnabled(Boolean(event.ctrlKey || event.metaKey));
    const reset = () => setEnabled(false);
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("pointermove", update, { passive: true });
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("pointermove", update);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
      reset();
    };
  }, []);
}
