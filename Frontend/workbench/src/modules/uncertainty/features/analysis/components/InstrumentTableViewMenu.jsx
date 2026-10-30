import React, { useLayoutEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faEye, faEyeSlash } from "@fortawesome/free-solid-svg-icons";
import useExclusiveMenu from "../../../hooks/useExclusiveMenu";
import { getAnchoredMenuPlacement } from "../../../utils/anchoredMenuPosition";
import { recoveryNamespace } from "../../../utils/recoveryNamespace";

const readView = (key, session, scope) => {
    const simplifiedDefault = scope === "overview" ? false : Boolean(session.simplifiedInstrumentTables);
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      return { showAll: saved?.showAll === true, simplified: typeof saved?.simplified === "boolean" ? saved.simplified : simplifiedDefault };
    } catch { return { showAll: false, simplified: simplifiedDefault }; }
};

export function useInstrumentTableView(session, kind, scope = "budget") {
  const key = `uncertainty:instrument-view:v1:${recoveryNamespace()}:${session.id}:${kind}${scope === "overview" ? ":overview" : ""}`;
  const [state, setState] = useState(() => ({ key, view: readView(key, session, scope) }));
  // Copied sessions may keep the same point IDs and reuse the mounted view.
  const view = state.key === key ? state.view : readView(key, session, scope);
  if (state.key !== key) setState({ key, view });
  const change = patch => {
    const next = { ...view, ...patch };
    setState({ key, view: next });
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* The current view remains usable without storage. */ }
  };
  return [view, change];
}

export default function InstrumentTableViewMenu({ kind, value, onChange, showMeasurementAreas = true }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null), menu = useRef(null), trigger = useRef(null);
  useExclusiveMenu(open, () => setOpen(false));
  useLayoutEffect(() => {
    if (!open) return;
    menu.current.showPopover?.();
    const position = () => {
      const element = menu.current, rect = element.getBoundingClientRect();
      const scale = element.offsetWidth ? rect.width / element.offsetWidth || 1 : 1;
      const placement = getAnchoredMenuPlacement({ anchorRect: trigger.current.getBoundingClientRect(),
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
        preferredWidth: rect.width || 260, preferredMaxHeight: element.scrollHeight * scale + 2, gap: 4 });
      for (const key of ["left", "top", "bottom", "maxHeight"]) element.style[key] = placement[key] == null ? "auto" : `${placement[key] / scale}px`;
    };
    position();
    const dismiss = event => { if (!root.current.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); trigger.current.focus(); } };
    document.addEventListener("pointerdown", dismiss);
    root.current.addEventListener("keydown", escape);
    const element = root.current;
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss); element.removeEventListener("keydown", escape);
      window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true);
    };
  }, [open]);
  return <div ref={root} className="instrument-view-menu">
    <button ref={trigger} type="button" className="btn-add-item btn-add-column" aria-label={`${kind.toUpperCase()} table view`}
      title={`${kind.toUpperCase()} table view`} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
      <FontAwesomeIcon icon={(showMeasurementAreas ? value.showAll : !value.simplified) ? faEye : faEyeSlash} /><FontAwesomeIcon icon={faChevronDown} />
    </button>
    {open && <div ref={menu} popover="manual" className="instrument-view-menu-options" role="group" aria-label={`${kind.toUpperCase()} table view options`}>
      {showMeasurementAreas && <label><input type="checkbox" checked={value.showAll} onChange={event => onChange({ showAll: event.target.checked })} />Show all measurement areas</label>}
      <label><input type="checkbox" checked={value.simplified} onChange={event => onChange({ simplified: event.target.checked })} />Show simplified view</label>
    </div>}
  </div>;
}
