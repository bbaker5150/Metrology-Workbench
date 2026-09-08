import React, { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getAnchoredMenuPlacement } from "../../utils/anchoredMenuPosition";

export default function SidebarColumnPopover({ anchorRef, onClose, children }) {
  const [placement, setPlacement] = useState(null);
  useLayoutEffect(() => {
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      const next = getAnchoredMenuPlacement({
        anchorRect: rect,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        preferredWidth: 480,
        preferredMaxHeight: 600,
      });
      // This is a longer checklist: use the larger side when that exposes
      // more choices without scrolling, rather than a short-menu threshold.
      const below = window.innerHeight - (rect?.bottom || 0) - 14;
      const above = (rect?.top || 0) - 14;
      if (below < 600 && above > below) {
        next.top = undefined;
        next.bottom = window.innerHeight - rect.top + 6;
        next.maxHeight = Math.min(600, above);
      }
      setPlacement(next);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef]);
  if (!placement) return null;
  return createPortal(
    <div
      className="sidebar-filter-dropdown"
      role="dialog"
      aria-label="Visible measurement point columns"
      style={{
        width: placement.width,
        maxHeight: placement.maxHeight,
        left: placement.left,
        boxSizing: "border-box",
        position: "fixed",
        top: placement.top ?? "auto",
        bottom: placement.bottom ?? "auto",
        right: "auto",
        zIndex: 10020,
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
          anchorRef.current?.querySelector("button")?.focus();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
