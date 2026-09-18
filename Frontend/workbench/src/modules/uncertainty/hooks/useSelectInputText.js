import { useEffect } from "react";

/** One editing contract for the workspace and its portal dialogs. Selecting
 * after focus/click lets the browser place focus first and then highlights the
 * existing value. Explicit drag selections remain available; read-only fields,
 * pickers, checkboxes and buttons keep their native interaction. */
export default function useSelectInputText() {
  useEffect(() => {
    let pointer = null;
    const fieldFor = target => target?.closest?.("input, textarea, [contenteditable='true']");
    const select = field => {
      if (!field?.isConnected || field.disabled || field.readOnly) return;
      if (field.matches("input") && !["text", "search", "email", "tel", "url", "password", "number"].includes(field.type)) return;
      if (field !== document.activeElement && !field.contains(document.activeElement)) return;
      if (field.isContentEditable) {
        const range = document.createRange();
        range.selectNodeContents(field);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
      } else field.select?.();
    };
    const focus = event => {
      const field = fieldFor(event.target);
      queueMicrotask(() => select(field));
    };
    const down = event => { pointer = { x: event.clientX, y: event.clientY, moved: false }; };
    const move = event => {
      if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 4) pointer.moved = true;
    };
    const click = event => {
      const moved = pointer?.moved;
      pointer = null;
      if (!moved) focus(event);
    };
    document.addEventListener("focusin", focus, true);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("click", click, true);
    return () => {
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("click", click, true);
    };
  }, []);
}
