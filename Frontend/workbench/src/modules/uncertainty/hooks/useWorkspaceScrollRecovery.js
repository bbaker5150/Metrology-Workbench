import { useEffect } from "react";
import { readEditorDraft, saveEditorDraft } from "../utils/editorRecovery";
export default function useWorkspaceScrollRecovery(sessionId, pointId, mode) {
  useEffect(() => {
    if (!sessionId) return;
    const entries = [
      [".measurement-point-list", `scroll:sidebar:${sessionId}`],
      [".analysis-content", `scroll:analysis:${sessionId}:${pointId || "overview"}:${mode}`],
    ];
    let frame;
    const cleanups = [];
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        for (const [selector, key] of entries) {
          const node = document.querySelector(selector);
          if (!node) continue;
          const saved = readEditorDraft(key);
          if (saved) { node.scrollTop = saved.top; node.scrollLeft = saved.left; }
          const save = () => saveEditorDraft(key, { top: node.scrollTop, left: node.scrollLeft });
          node.addEventListener("scroll", save, { passive: true });
          cleanups.push(() => node.removeEventListener("scroll", save));
        }
      });
    });
    return () => { cancelAnimationFrame(frame); cleanups.forEach(cleanup => cleanup()); };
  }, [sessionId, pointId, mode]);
}
