import useExclusiveMenu from "../../hooks/useExclusiveMenu";
import React, { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function SidebarColumnPopover({ anchorRef, onClose, children }) {
  useExclusiveMenu(true, onClose);
  const dialogRef = useRef(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const trigger = anchorRef.current?.querySelector('button');
    // The native top layer has no containing block in the workbench. Unlike
    // a body portal, it cannot enlarge the document's scrollable overflow.
    const fit = () => {
      const zoom = (parseFloat(getComputedStyle(document.documentElement).zoom) || 1) *
        (parseFloat(getComputedStyle(document.body).zoom) || 1);
      const viewport = window.visualViewport;
      dialog.style.setProperty('--column-dialog-width', `${Math.max(1, (viewport?.width || innerWidth) / zoom - 32)}px`);
      dialog.style.setProperty('--column-dialog-height', `${Math.max(1, (viewport?.height || innerHeight) / zoom - 32)}px`);
    };
    fit();
    dialog.showModal();
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
      dialog.close();
      trigger?.focus({ preventScroll: true });
    };
  }, [anchorRef]);
  return createPortal(
    <dialog ref={dialogRef} className="sidebar-filter-dropdown point-columns-dialog"
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
    </dialog>,
    document.body,
  );
}
