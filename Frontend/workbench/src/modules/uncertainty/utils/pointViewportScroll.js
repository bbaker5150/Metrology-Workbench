// Keep the single outer viewport usable with a mouse as well as a trackpad.
export const scrollPointViewport = event => {
  if (event.ctrlKey || event.metaKey || event.defaultPrevented || event.deltaX) return;
  const surface = event.target?.closest?.('.measurement-points-zoom-surface');
  const viewport = surface?.closest('.measurement-point-list');
  if (!viewport || event.target.closest('textarea, select, [role="listbox"]')) return;
  if (viewport.scrollWidth <= viewport.clientWidth + 1) return;
  if (!event.shiftKey && viewport.scrollHeight > viewport.clientHeight + 1) return;
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1;
  const next = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth,
    viewport.scrollLeft + event.deltaY * scale));
  if (next === viewport.scrollLeft) return;
  event.preventDefault();
  viewport.scrollLeft = next;
};
