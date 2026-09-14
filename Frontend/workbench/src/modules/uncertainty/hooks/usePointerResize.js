import { useCallback, useEffect, useRef } from "react";

// A resize owns its listeners and body styles until it ends, even if the OS
// cancels the pointer or the user leaves the window before releasing it.
export default function usePointerResize() {
  const cleanup = useRef(null);
  useEffect(() => () => cleanup.current?.(false), []);

  return useCallback((event, { cursor = "col-resize", onMove, onFinish }) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cleanup.current?.(false);
    const previous = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
    const pointerId = event.pointerId;
    let frame = null;
    let latest = null;
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
    const flush = () => {
      frame = null;
      if (!latest) return;
      const next = latest;
      latest = null;
      onMove(next);
    };
    const move = next => {
      if (next.pointerId !== pointerId) return;
      latest = next;
      if (frame === null) frame = requestAnimationFrame(flush);
    };
    const finish = (commit = true) => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      document.removeEventListener("dragstart", interrupted, true);
      window.removeEventListener("blur", interrupted);
      document.body.style.cursor = previous.cursor;
      document.body.style.userSelect = previous.userSelect;
      cleanup.current = null;
      if (commit) {
        flush();
        onFinish?.();
      }
    };
    const end = next => { if (next.pointerId === pointerId) finish(); };
    const interrupted = () => finish();
    cleanup.current = finish;
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    document.addEventListener("dragstart", interrupted, true);
    window.addEventListener("blur", interrupted);
  }, []);
}
