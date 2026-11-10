// A tall auto-height table can put its native horizontal track below the page.
// Mirror that track at the visible bottom without changing the table's height,
// scroll owner, saved column widths, or sticky header.
export function createInstrumentFloatingScrollbar(container) {
  const host = container.closest('.instrument-table-viewport') || container;
  const bar = document.createElement('div');
  bar.className = 'instrument-floating-scrollbar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Horizontal scroll for instrument table');
  bar.tabIndex = 0;
  bar.hidden = true;
  const track = document.createElement('div');
  track.className = 'instrument-floating-scrollbar-track';
  bar.append(track);
  host.append(bar);
  const parents = [];
  for (let parent = container.parentElement; parent; parent = parent.parentElement) parents.push(parent);
  const set = (node, name, value) => { if (node.style[name] !== value) node.style[name] = value; };
  const moveTable = () => {
    if (!bar.hidden && Math.abs(container.scrollLeft - bar.scrollLeft) > 0.5) container.scrollLeft = bar.scrollLeft;
  };
  bar.addEventListener('scroll', moveTable, { passive: true });
  const hide = () => {
    if (document.activeElement === bar) bar.blur();
    bar.hidden = true;
  };
  const sync = () => {
    if (container.scrollWidth <= container.clientWidth + 1 || !container.getClientRects().length) {
      hide();
      return;
    }
    const rect = container.getBoundingClientRect();
    const scale = rect.width / container.offsetWidth || 1;
    let left = Math.max(0, rect.left + container.clientLeft * scale);
    let right = Math.min(window.innerWidth, rect.left + (container.clientLeft + container.clientWidth) * scale);
    let top = Math.max(0, rect.top + container.clientTop * scale);
    const nativeTop = rect.top + (container.clientTop + container.clientHeight) * scale;
    let bottom = Math.min(window.innerHeight, nativeTop);
    for (const parent of parents) {
      const style = getComputedStyle(parent);
      const clipX = /(auto|scroll|hidden|clip)/.test(style.overflowX);
      const clipY = /(auto|scroll|hidden|clip)/.test(style.overflowY);
      if (!clipX && !clipY) continue;
      const bounds = parent.getBoundingClientRect();
      const parentScale = bounds.width / parent.offsetWidth || 1;
      if (clipX) {
        left = Math.max(left, bounds.left + parent.clientLeft * parentScale);
        right = Math.min(right, bounds.left + (parent.clientLeft + parent.clientWidth) * parentScale);
      }
      if (clipY) {
        top = Math.max(top, bounds.top + parent.clientTop * parentScale);
        bottom = Math.min(bottom, bounds.top + (parent.clientTop + parent.clientHeight) * parentScale);
      }
    }
    // Prefer the real track when it is visible. Do not leave a floating track
    // over another section after this table has scrolled completely away.
    if (right - left < 40 || bottom - top < 36 || nativeTop <= bottom + 1) {
      hide();
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const hostScale = hostRect.width / host.offsetWidth || 1;
    const height = 14;
    set(bar, 'left', `${(left - hostRect.left) / hostScale - host.clientLeft + host.scrollLeft}px`);
    set(bar, 'top', `${(bottom - hostRect.top) / hostScale - host.clientTop + host.scrollTop - height}px`);
    set(bar, 'width', `${(right - left) / hostScale}px`);
    set(track, 'width', `${(right - left) / hostScale + container.scrollWidth - container.clientWidth}px`);
    bar.hidden = false;
    if (Math.abs(bar.scrollLeft - container.scrollLeft) > 0.5) bar.scrollLeft = container.scrollLeft;
  };
  return {
    sync,
    destroy() {
      bar.removeEventListener('scroll', moveTable);
      bar.remove();
    },
  };
}
