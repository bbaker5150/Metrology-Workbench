import useExclusiveMenu from "../../hooks/useExclusiveMenu";
import React, { useLayoutEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";

export default function SidebarColumnPopover({ anchorRef, onClose, children }) {
  useExclusiveMenu(true, onClose);
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
      const viewportWidth = window.innerWidth / zoom, viewportHeight = window.innerHeight / zoom;
      const right = rect?.right / zoom, left = rect?.left / zoom;
      const next = right + 8 + 480 <= viewportWidth - 8 ? {
        left: right + 8, top: 8, width: 480, maxHeight: viewportHeight - 16,
      } : left - 8 - 480 >= 8 ? {
        left: left - 8 - 480, top: 8, width: 480, maxHeight: viewportHeight - 16,
      } : {
        // A narrow viewport cannot fit the menu beside the trigger. Keep the
        // entire vertical budget instead of clipping it to the space below.
        left: Math.max(8, Math.min(left || 8, viewportWidth - Math.min(480, viewportWidth - 16) - 8)),
        top: 8, width: Math.min(480, viewportWidth - 16), maxHeight: viewportHeight - 16,
      };
      // Prefer either side of the trigger; narrow screens retain Escape and
      // outside-click dismissal while using the available viewport height.
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
