import { useLayoutEffect, useRef } from "react";

// Only a row created by the current Add gesture is eligible. Previously saved
// empty instruments must survive Escape, as must text still in a local editor.
export default function useBlankInstrumentEscape(session, save, enabled) {
  const draft = useRef(null);
  const latest = useRef(null);
  useLayoutEffect(() => {
    latest.current = { session, save };
    const pending = draft.current;
    if (!pending) return;
    const row = session[pending.key]?.find(item => item.id === pending.item.id);
    if (!enabled || !row || (row !== pending.item && JSON.stringify(row) !== JSON.stringify(pending.item))) draft.current = null;
  }, [session, save, enabled]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const abandon = () => { draft.current = null; };
    const pointerDown = event => {
      if (!draft.current) return;
      const row = event.target.closest?.("[data-instrument-id]");
      if (row && row.dataset.instrumentId !== String(draft.current.item.id)) abandon();
    };
    const cancel = event => {
      const pending = draft.current;
      if (!pending || event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]:not([hidden]), [role="alertdialog"], [role="listbox"], [role="menu"]')) return;
      const { session, save } = latest.current;
      abandon();
      event.preventDefault();
      event.stopImmediatePropagation();
      save({ ...session, [pending.key]: session[pending.key].filter(item => item.id !== pending.item.id) });
    };
    window.addEventListener("input", abandon, true);
    window.addEventListener("pointerdown", pointerDown, true);
    window.addEventListener("keydown", cancel, true);
    return () => {
      window.removeEventListener("input", abandon, true);
      window.removeEventListener("pointerdown", pointerDown, true);
      window.removeEventListener("keydown", cancel, true);
    };
  }, [enabled]);
  return (key, item) => { if (enabled) draft.current = { key, item }; };
}
