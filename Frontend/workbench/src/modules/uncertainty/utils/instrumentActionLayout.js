const actionPositions = new WeakMap();

// Pointer movement only changes visibility; it must not remeasure every row.
export function updateInstrumentActionHover(layer, pointer = null) {
  for (const {action, selected, left, right, top, bottom} of actionPositions.get(layer) || []) {
    const hovered = pointer && pointer.x >= left && pointer.x <= right && pointer.y >= top && pointer.y < bottom;
    action.toggleAttribute('data-active', Boolean(hovered || selected));
  }
}

// Actions occupy a sibling gutter, outside both the table and its scroll area.
// Use rendered row bounds so column changes, rowspans and zoom need no special
// cases. Center within the visible part of a group when it is taller than the
// viewport, keeping the action below the sticky header and above the scrollbar.
export function syncInstrumentActions(container, table, layer, pointer = null) {
  if (!layer) return;
  const bounds = layer.getBoundingClientRect();
  const viewport = container.getBoundingClientRect();
  const scale = layer.offsetWidth ? bounds.width / layer.offsetWidth || 1 : 1;
  const containerScale = container.offsetWidth ? viewport.width / container.offsetWidth || 1 : 1;
  // THEAD itself scrolls; its sticky cells are the visible header boundary.
  const headerBottom = Math.max(viewport.top, ...[...(table.tHead?.rows[0]?.cells || [])]
    .map(cell => cell.getBoundingClientRect().bottom));
  const visibleTop = Math.max(viewport.top + container.clientTop * containerScale, headerBottom);
  const visibleBottom = viewport.top + (container.clientTop + container.clientHeight) * containerScale;
  const rows = [...table.querySelectorAll(':scope > tbody > tr[data-instrument-id]')];
  const groups = new Map(), positions = [];
  const key = node => JSON.stringify([node.dataset.instrumentId, node.dataset.measurementArea]);
  rows.forEach(row => {
    const id = key(row);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  });
  for (const action of layer.children) {
    const group = groups.get(key(action)) || [];
    const rects = group.map(row => row.getBoundingClientRect());
    const top = Math.max(visibleTop, Math.min(...rects.map(rect => rect.top)));
    const bottom = Math.min(visibleBottom, Math.max(...rects.map(rect => rect.bottom)));
    const visible = rects.length > 0 && bottom - top >= 20 * scale;
    action.hidden = !visible;
    if (!visible) continue;
    action.style.top = `${((top + bottom) / 2 - bounds.top) / scale}px`;
    const selected = group.some(row => row.dataset.rangeSelected === 'true' ||
      row.matches('.selected-row, .selected-spec-row, .instrument-selected, :focus-within'));
    positions.push({ action, selected, left:viewport.left, right:bounds.right, top, bottom });
  }
  actionPositions.set(layer, positions);
  updateInstrumentActionHover(layer, pointer);
}
