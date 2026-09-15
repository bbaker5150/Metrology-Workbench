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
  const overlay = document.createElementNS(SVG_NS, 'svg');
  overlay.classList.add('instrument-selection-outline');
  overlay.setAttribute('aria-hidden', 'true');
  container.appendChild(overlay);
  let previous = '';
  return {
    sync() {
      const bounds = table.getBoundingClientRect();
      const containerBounds = container.getBoundingClientRect();
      const scale = containerBounds.width / container.offsetWidth || 1;
      const groups = new Map();
      table.querySelectorAll(SELECTED_CELLS).forEach(cell => {
        const rect = cell.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const color = getComputedStyle(cell).getPropertyValue('--instrument-function-color').trim() || 'var(--primary-color)';
        if (!groups.has(color)) groups.set(color, []);
        groups.get(color).push({
          left: (rect.left - bounds.left) / scale, right: (rect.right - bounds.left) / scale,
          top: (rect.top - bounds.top) / scale, bottom: (rect.bottom - bounds.top) / scale,
        });
      });
      const paths = [...groups].map(([color, rectangles]) => ({ color,
        d: selectionPerimeter(rectangles).map(([x1, y1, x2, y2]) => `M${x1},${y1}L${x2},${y2}`).join(' '),
      }));
      const geometry = {
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
