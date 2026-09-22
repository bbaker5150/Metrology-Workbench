import useExclusiveMenu from "../../hooks/useExclusiveMenu";
import React, { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function SidebarColumnPopover({ anchorRef, onClose, children }) {
  useExclusiveMenu(true, onClose);
  const dialogRef = useRef(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const trigger = anchorRef.current?.querySelector('button');
    // Keep the menu inside the viewport, including UI scaling. The top layer
    // avoids contributing overflow to the workbench layout.
    const fit = () => {
      const zoom = (parseFloat(getComputedStyle(document.documentElement).zoom) || 1) *
        (parseFloat(getComputedStyle(document.body).zoom) || 1);
      const viewport = window.visualViewport;
      dialog.style.setProperty('--column-dialog-width', `${Math.max(1, (viewport?.width || innerWidth) / zoom - 32)}px`);
      const height = (viewport?.height || innerHeight) / zoom;
      const width = (viewport?.width || innerWidth) / zoom;
      dialog.style.setProperty('--column-dialog-height', `${Math.max(1, height - 32)}px`);
      const anchor = trigger?.getBoundingClientRect();
      dialog.style.left = `${Math.max(16, Math.min((anchor?.left || 16) / zoom, width - Math.min(680, width - 32) - 16))}px`;
      dialog.style.top = `${Math.max(16, Math.min((anchor?.bottom || 16) / zoom + 6, height - Math.min(720, height - 32) - 16))}px`;
    };
    fit();
    // Nonmodal popovers use the top layer without making the workspace inert.
    dialog.showPopover?.();
    const outside = event => {
      if (!dialog.contains(event.target) && !anchorRef.current?.contains(event.target)) onClose();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('resize', fit);
    // UI scale can change independently of a browser resize.
    const observer = new MutationObserver(fit);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
    return () => {
      window.removeEventListener('resize', fit);
      window.visualViewport?.removeEventListener('resize', fit);
      observer.disconnect();
      document.removeEventListener('pointerdown', outside);
      dialog.hidePopover?.();
      trigger?.focus({ preventScroll: true });
    };
  }, [anchorRef]);
  return createPortal(
    <div role="dialog" popover="manual" ref={dialogRef} className="sidebar-filter-dropdown point-columns-dialog"
      aria-label="Visible measurement point columns"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key === 'Tab') {
          const focusable = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
            .filter(node => node.getClientRects().length > 0);
          const first = focusable[0], last = focusable.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <header className="point-columns-dialog-header">
        <button type="button" onClick={onClose} aria-label="Close column settings" autoFocus>×</button>
      </header>
      {children}
    </div>,
    document.body,
  );
}
