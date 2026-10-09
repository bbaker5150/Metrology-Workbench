const SELECTED_CELLS = [
  'tr.instrument-function-row:not([data-selection-key]):is(.selected-row, .selected-spec-row) > td',
  'td[data-cell-selected]',
].join(',');
const SVG_NS = 'http://www.w3.org/2000/svg';
const snap = value => Math.round(value * 100) / 100;

// Opposite edges cancel, including partial overlaps beside row-spanned cells.
// Sweep each line so adjacent cells leave a single uninterrupted outer edge.
export function selectionPerimeter(rectangles) {
  const lines = new Map();
  const edge = (axis, position, start, end, direction) => {
    const key = `${axis}:${snap(position)}`;
    if (!lines.has(key)) lines.set(key, { axis, position: snap(position), events: new Map() });
    const { events } = lines.get(key);
    start = snap(start); end = snap(end);
    events.set(start, (events.get(start) || 0) + direction);
    events.set(end, (events.get(end) || 0) - direction);
  };
  rectangles.forEach(({ left, top, right, bottom }) => {
    edge('h', top, left, right, 1);
    edge('h', bottom, left, right, -1);
    edge('v', left, top, bottom, 1);
    edge('v', right, top, bottom, -1);
  });
  const segments = [];
  lines.forEach(({ axis, position, events }) => {
    let active = 0, start;
    [...events].sort(([a], [b]) => a - b).forEach(([point, delta]) => {
      const next = active + delta;
      if (!active && next) start = point;
      if (active && !next && point > start) {
        segments.push(axis === 'h' ? [start, position, point, position] : [position, start, position, point]);
      }
      active = next;
    });
  });
  return segments;
}

export function createInstrumentSelectionOutline(container, table) {
  const viewport = container.closest('.instrument-table-viewport');
  const actionLayer = viewport?.querySelector('.instrument-action-layer');
  const host = actionLayer ? viewport : container;
  const overlay = document.createElementNS(SVG_NS, 'svg');
  overlay.classList.add('instrument-selection-outline');
  if (actionLayer) overlay.classList.add('instrument-selection-outline--integrated');
  overlay.setAttribute('aria-hidden', 'true');
  host.appendChild(overlay);
  let previous = '';
  return {
    sync() {
      const bounds = (actionLayer ? host : table).getBoundingClientRect();
      const containerBounds = host.getBoundingClientRect();
      const scale = host.offsetWidth ? containerBounds.width / host.offsetWidth || 1 : 1;
      const scrollBounds = container.getBoundingClientRect();
      const scrollScale = container.offsetWidth ? scrollBounds.width / container.offsetWidth || 1 : 1;
      const clipTop = Math.max(scrollBounds.top, ...[...(table.tHead?.rows[0]?.cells || [])].map(cell => cell.getBoundingClientRect().bottom));
      const clipBottom = scrollBounds.top + (container.clientTop + container.clientHeight) * scrollScale;
      const clipLeft = scrollBounds.left + container.clientLeft * scrollScale;
      const clipRight = actionLayer?.getBoundingClientRect().left;
      const groups = new Map();
      const selectedCells = [...table.querySelectorAll(SELECTED_CELLS),
        ...(actionLayer?.querySelectorAll('.instrument-action-band[data-cell-selected]') || [])];
      const addRectangle = (color, rectangle, inActions = false) => {
        if (actionLayer) {
          rectangle.left = Math.max(rectangle.left, (clipLeft - bounds.left) / scale);
          if (!inActions) {
            const seam = (clipRight - bounds.left) / scale;
            // scrollWidth is integral while zoomed cells are fractional. At
            // the scroll limit, join their subpixel remainder to the gutter.
            rectangle.right = Math.abs(rectangle.right - seam) <= 1 / scale
              ? seam : Math.min(rectangle.right, seam);
          }
          rectangle.top = Math.max(rectangle.top, (clipTop - bounds.top) / scale);
          rectangle.bottom = Math.min(rectangle.bottom, (clipBottom - bounds.top) / scale);
        }
        if (rectangle.right <= rectangle.left || rectangle.bottom <= rectangle.top) return;
        if (!groups.has(color)) groups.set(color, []);
        groups.get(color).push(rectangle);
      };
      const sourceKeys = new Set(selectedCells.filter(cell => cell.classList.contains('instrument-uncertainty-name-cell'))
        .map(cell => cell.parentElement.dataset.selectionKey));
      const sharedRails = table.dataset.selectionMode === 'instrument'
        ? [...table.querySelectorAll('.instrument-uncertainty-rail')].filter(rail => sourceKeys.has(rail.closest('tr').dataset.selectionKey)) : [];
      const sharedKeys = new Set(sharedRails.map(rail => rail.closest('tr').dataset.selectionKey));
      selectedCells.forEach(cell => {
        const rect = cell.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const style = getComputedStyle(cell);
        // The shared label rail belongs to the group, outside an individual range selection.
        const inset = (table.dataset.selectionMode === 'range' || sharedKeys.has(cell.parentElement.dataset.selectionKey)) && cell.classList.contains('instrument-uncertainty-name-cell')
          ? parseFloat(style.getPropertyValue('--instrument-uncertainty-rail-width')) || 0 : 0;
        const left = (rect.left - bounds.left) / scale + inset;
        const right = (rect.right - bounds.left) / scale;
        if (right <= left) return;
        const color = style.getPropertyValue('--instrument-function-color').trim() || 'var(--primary-color)';
        addRectangle(color, {
          left, right,
          top: (rect.top - bounds.top) / scale, bottom: (rect.bottom - bounds.top) / scale,
        }, cell.classList.contains('instrument-action-band'));
      });
      // A label spans the whole source group, like the shared Description cell.
      // Add it once, without overlapping the inset source rectangles, so no
      // selection edge can run through its text on a continuation row.
      sharedRails.forEach(rail => {
        const cell = rail.parentElement;
        const rect = cell.getBoundingClientRect(), style = getComputedStyle(cell);
        const color = style.getPropertyValue('--instrument-function-color').trim() || 'var(--primary-color)';
        const width = parseFloat(style.getPropertyValue('--instrument-uncertainty-rail-width')) || 0;
        if (!width) return;
        const left = (rect.left - bounds.left) / scale, top = (rect.top - bounds.top) / scale;
        const right = Math.min(left + width, (rect.right - bounds.left) / scale);
        if (right <= left) return;
        addRectangle(color, { left, top, right,
          bottom: top + rail.getBoundingClientRect().height / scale });
      });
      const paths = [...groups].map(([color, rectangles]) => ({ color,
        d: selectionPerimeter(rectangles).map(([x1, y1, x2, y2]) => `M${x1},${y1}L${x2},${y2}`).join(' '),
      }));
      const geometry = actionLayer ? { left:0, top:0, width:bounds.width / scale, height:bounds.height / scale } : {
        left: (bounds.left - containerBounds.left) / scale + container.scrollLeft - container.clientLeft,
        top: (bounds.top - containerBounds.top) / scale + container.scrollTop - container.clientTop,
        width: bounds.width / scale, height: bounds.height / scale,
      };
      const signature = JSON.stringify([geometry, paths]);
      if (signature === previous) return;
      previous = signature;
      Object.entries(geometry).forEach(([key, value]) => { overlay.style[key] = `${value}px`; });
      overlay.replaceChildren(...paths.map(({ color, d }) => {
        const path = document.createElementNS(SVG_NS, 'path');
        path.style.setProperty('--instrument-function-color', color);
        path.setAttribute('d', d);
        return path;
      }));
    },
    destroy() { overlay.remove(); },
  };
}
