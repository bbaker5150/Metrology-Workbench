import React, { useLayoutEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { getAnchoredMenuPlacement } from "../../utils/anchoredMenuPosition";

export default function SidebarColumnPopover({ anchorRef, onClose, children }) {
  const [placement, setPlacement] = useState(null);
  const menuRef = useRef(null);
  const placed = Boolean(placement);
  useLayoutEffect(() => {
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      // Fixed portal coordinates are CSS pixels; the trigger rect is already
      // scaled by global UI zoom. Convert both into the portal's coordinate
      // space so its growing list cannot cover the toggle at reduced zoom.
      const zoom = (parseFloat(getComputedStyle(document.documentElement).zoom) || 1) *
        (parseFloat(getComputedStyle(document.body).zoom) || 1);
      const next = getAnchoredMenuPlacement({
        anchorRect: rect && Object.fromEntries(["top", "right", "bottom", "left"].map(key => [key, rect[key] / zoom])),
        viewportWidth: window.innerWidth / zoom,
        viewportHeight: window.innerHeight / zoom,
        preferredWidth: 480,
        preferredMaxHeight: 600,
      });
      // Constrain the menu to one side of its trigger. Growing the selected
      // column list must never cover the toggle needed to close the menu.
      setPlacement(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (menuRef.current) resize?.observe(menuRef.current);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      resize?.disconnect();
    };
  }, [anchorRef, placed]);
  if (!placement) return null;
  return createPortal(
    <div
      ref={menuRef}
      className="sidebar-filter-dropdown"
      role="dialog"
      aria-label="Visible measurement point columns"
      style={{
        width: placement.width,
        maxHeight: placement.maxHeight,
        "--column-menu-height": `${placement.maxHeight}px`,
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
