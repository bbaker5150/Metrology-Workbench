import React, { useLayoutEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCog } from "@fortawesome/free-solid-svg-icons";
import useExclusiveMenu from "../../../hooks/useExclusiveMenu";
import { getAnchoredMenuPlacement } from "../../../utils/anchoredMenuPosition";

export default function UncertaintyTypeMenu({ value = "parametric", onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  useExclusiveMenu(open, () => setOpen(false));
  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    // The top layer escapes equation/table overflow while keeping the menu
    // inside its editor for focus, click-away handling and inherited styling.
    menu.showPopover?.();
    const position = () => {
      const rect = menu.getBoundingClientRect();
      const scale = menu.offsetWidth ? rect.width / menu.offsetWidth || 1 : 1;
      const placement = getAnchoredMenuPlacement({
        anchorRect: rootRef.current.querySelector('button').getBoundingClientRect(),
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
        preferredWidth: rect.width || 132,
        preferredMaxHeight: menu.scrollHeight * scale + 2, gap: 4,
      });
      for (const key of ['left', 'top', 'bottom', 'maxHeight']) {
        menu.style[key] = placement[key] == null ? 'auto' : `${placement[key] / scale}px`;
      }
    };
    position();
    const dismiss = event => { if (!rootRef.current.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open]);
  return <div ref={rootRef} className="uncertainty-type-menu">
    <button type="button" aria-label="Change uncertainty type" title="Change uncertainty type" aria-expanded={open}
      onClick={event => { event.stopPropagation(); setOpen(!open); }}><FontAwesomeIcon icon={faCog}/></button>
    {open && <div ref={menuRef} popover="manual" className="instrument-source-settings" role="group" aria-label="Uncertainty type">
      {[["parametric", "Manual"], ["table", "Table"], ["equation", "Equation"]].map(([kind, label]) =>
        <button key={kind} type="button" aria-pressed={value === kind} onClick={event => {
          event.stopPropagation(); setOpen(false); if (kind !== value) onChange(kind);
        }}>{label}</button>)}
    </div>}
  </div>;
}
