import useExclusiveMenu from "../../hooks/useExclusiveMenu";
import React, { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function SidebarColumnPopover({ anchorRef, onClose, children }) {
  useExclusiveMenu(true, onClose);
  const dialogRef = useRef(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const trigger = anchorRef.current?.querySelector('button');
    let position = null;
    let drag = null;
    const currentZoom = () => (parseFloat(getComputedStyle(document.documentElement).zoom) || 1) *
      (parseFloat(getComputedStyle(document.body).zoom) || 1);
    // Keep the menu inside the viewport, including UI scaling. The top layer
    // avoids contributing overflow to the workbench layout.
    const fit = () => {
      const zoom = currentZoom();
      const viewport = window.visualViewport;
      dialog.style.setProperty('--column-dialog-width', `${Math.max(1, (viewport?.width || innerWidth) / zoom - 32)}px`);
      const height = (viewport?.height || innerHeight) / zoom;
      const width = (viewport?.width || innerWidth) / zoom;
      const selected = dialog.querySelector('.point-column-selected');
      const lists = dialog.querySelector('.point-column-lists');
      const listStyle = lists && getComputedStyle(lists);
      const contentHeight = (dialog.querySelector('.point-column-menu-actions')?.offsetHeight || 0) +
        (selected?.querySelector('.sidebar-column-order-heading')?.offsetHeight || 0) +
        (selected?.querySelector('.sidebar-column-order-list')?.scrollHeight || 0) +
        (parseFloat(listStyle?.paddingTop) || 0) + (parseFloat(listStyle?.paddingBottom) || 0) + 2;
      const menuHeight = Math.max(1, Math.min(height - 8, contentHeight));
      const menuWidth = Math.min(540, width - 32);
      dialog.style.setProperty('--column-dialog-height', `${menuHeight}px`);
      position ||= { left: (width - menuWidth) / 2, top: (height - menuHeight) / 2 };
      position.left = Math.max(4, Math.min(position.left, width - menuWidth - 4));
      position.top = Math.max(4, Math.min(position.top, height - menuHeight - 4));
      dialog.style.left = `${position.left}px`;
      dialog.style.top = `${position.top}px`;
    };
    // Nonmodal popovers use the top layer without making the workspace inert.
    dialog.showPopover?.();
    fit();
    const startDrag = event => {
      if (event.button !== 0 || !event.target.closest('.point-column-menu-actions') || event.target.closest('button')) return;
      event.preventDefault();
      drag = { x: event.clientX, y: event.clientY, ...position, pointerId: event.pointerId };
      dialog.setPointerCapture?.(event.pointerId);
    };
    const moveDrag = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      position = { left: drag.left + (event.clientX - drag.x) / currentZoom(), top: drag.top + (event.clientY - drag.y) / currentZoom() };
      fit();
    };
    const endDrag = () => {
      if (drag && dialog.hasPointerCapture?.(drag.pointerId)) dialog.releasePointerCapture(drag.pointerId);
      drag = null;
    };
    dialog.addEventListener('pointerdown', startDrag);
    window.addEventListener('pointermove', moveDrag);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    const contentObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    dialog.querySelectorAll('.sidebar-column-order-list, .point-column-menu-actions, .point-column-selected .sidebar-column-order-heading')
      .forEach(node => contentObserver?.observe(node));
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
      contentObserver?.disconnect();
      endDrag();
      dialog.removeEventListener('pointerdown', startDrag);
      window.removeEventListener('pointermove', moveDrag);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
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
      {children}
    </div>,
    document.body,
  );
}
