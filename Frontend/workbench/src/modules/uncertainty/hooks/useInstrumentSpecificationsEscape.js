import { useEffect, useRef } from "react";

// Both workspaces collapse open specifications before Escape can deselect the
// current point. Inline edits commit first; floating editors own their Escape.
export default function useInstrumentSpecificationsEscape(expanded, setExpanded) {
  const workspaceRef = useRef(null);
  useEffect(() => {
    if (!expanded) return;
    const collapse = event => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('dialog[open], [role="alertdialog"], [role="dialog"]:not([hidden]), [role="menu"], [role="listbox"], .instrument-view-menu-options')) return;
      const active = document.activeElement;
      const inInstrumentTable = workspaceRef.current?.contains(active) && active?.closest('.instrument-equipment-table');
      if (!inInstrumentTable && active?.matches('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      if (inInstrumentTable) active.blur?.();
      setExpanded(new Set());
    };
    window.addEventListener("keydown", collapse, true);
    return () => window.removeEventListener("keydown", collapse, true);
  }, [expanded, setExpanded]);
  return workspaceRef;
}
