const actionPositions = new WeakMap();

// Pointer movement only changes visibility; it must not remeasure every row.
export function updateInstrumentActionHover(layer, pointer = null) {
  for (const {action, band, selected, left, right, top, bottom} of actionPositions.get(layer) || []) {
    const hovered = pointer && pointer.x >= left && pointer.x <= right && pointer.y >= top && pointer.y < bottom;
    action.toggleAttribute('data-active', Boolean(hovered || selected));
    band?.toggleAttribute('data-cell-hovered', Boolean(hovered));
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
  const tableScale = containerScale * (parseFloat(getComputedStyle(table).zoom) || 1);
  const surfaces = layer.querySelector('.instrument-action-surfaces');
  const bands = [];
  const surface = (className, top, bottom) => {
    if (!surfaces || bottom <= top) return null;
    const band = document.createElement('div');
    band.className = className;
    band.style.top = `${(top - bounds.top) / scale}px`;
    band.style.height = `${(bottom - top) / scale}px`;
    bands.push(band);
    return band;
  };
  // Extend the actual header/area surfaces, including their themed rules.
  const copySurface = (band, cell) => {
    if (!band || !cell) return;
    const style = getComputedStyle(cell), rowStyle = getComputedStyle(cell.parentElement);
    band.style.backgroundColor = ['transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor) ? rowStyle.backgroundColor : style.backgroundColor;
    const paint = copyRules(band, style, style, cell.tagName === 'TH', collapsedTop(cell, style));
    paint.style.backgroundColor = band.style.backgroundColor;
    paint.style.backgroundImage = style.backgroundImage;
    paint.style.boxShadow = style.boxShadow;
    paint.style.position = style.position;
    paint.style.willChange = style.willChange;
  };
  // Use the same collapsed-cell painter for gradients, borders and inset
  // highlights. Div borders/pseudo-elements rasterize differently at the seam.
  const collapsedTop = (cell, style) => {
    const previous = cell.parentElement.previousElementSibling?.cells?.[0];
    const above = previous && getComputedStyle(previous);
    return above && parseFloat(above.borderBottomWidth) >= parseFloat(style.borderTopWidth)
      ? above.borderBottom : style.borderTop;
  };
  const copyRules = (band, first, last, header = false, top = first.borderTop) => {
    const paintTable = document.createElement('table');
    paintTable.className = 'instrument-action-paint';
    const zoom = tableScale / scale;
    paintTable.style.zoom = zoom;
    paintTable.style.width = `${100 / zoom}%`;
    paintTable.style.top = `${-(parseFloat(top) || 0) / 2}px`;
    const section = header ? paintTable.createTHead() : paintTable.createTBody();
    const row = section.insertRow();
    row.style.height = `${parseFloat(band.style.height) / zoom}px`;
    const paint = document.createElement(header ? 'th' : 'td');
    paint.style.borderTop = top;
    paint.style.borderBottom = last.borderBottom;
    row.appendChild(paint);
    band.appendChild(paintTable);
    return paint;
  };
  const header = [...(table.tHead?.rows[0]?.cells || [])].at(-1);
  if (header) {
    const rect = header.getBoundingClientRect();
    copySurface(surface('instrument-action-header', Math.max(viewport.top, rect.top), Math.min(visibleBottom, rect.bottom)), header);
  }
  table.querySelectorAll(':scope > tbody > tr:not([data-instrument-id])').forEach(row => {
    const rect = row.getBoundingClientRect();
    copySurface(surface('instrument-action-area', Math.max(visibleTop, rect.top), Math.min(visibleBottom, rect.bottom)), row.cells[0]);
  });
  const key = node => JSON.stringify([node.dataset.instrumentId, node.dataset.measurementArea]);
  rows.forEach(row => {
    const id = key(row);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  });
  for (const action of layer.querySelectorAll(':scope > .instrument-row-action')) {
    const group = groups.get(key(action)) || [];
    const rects = group.map(row => row.getBoundingClientRect());
    const top = Math.max(visibleTop, Math.min(...rects.map(rect => rect.top)));
    const bottom = Math.min(visibleBottom, Math.max(...rects.map(rect => rect.bottom)));
    const band = surface('instrument-action-band', top, bottom);
    const cellSelected = group.some(row => row.dataset.rangeSelected === 'true' ||
      row.matches(':not([data-selection-key]):is(.selected-row, .selected-spec-row)'));
    if (band) {
      const first = getComputedStyle(group[0].cells[0]), last = getComputedStyle(group.at(-1).cells[0]);
      band.style.setProperty('--instrument-function-color', first.getPropertyValue('--instrument-function-color') || getComputedStyle(group[0]).getPropertyValue('--instrument-function-color'));
      copyRules(band, first, last, false, collapsedTop(group[0].cells[0], first));
      band.dataset.instrumentId = action.dataset.instrumentId;
      band.dataset.measurementArea = action.dataset.measurementArea;
      band.toggleAttribute('data-cell-selected', cellSelected);
    }
    const visible = rects.length > 0 && bottom - top >= 20 * scale;
    action.hidden = !visible;
    if (!visible) continue;
    action.style.top = `${((top + bottom) / 2 - bounds.top) / scale}px`;
    const selected = group.some(row => row.dataset.rangeSelected === 'true' ||
      row.matches('.selected-row, .selected-spec-row, .instrument-selected, :focus-within'));
    positions.push({ action, band, selected, left:viewport.left, right:bounds.right, top, bottom });
  }
  surfaces?.replaceChildren(...bands);
  actionPositions.set(layer, positions);
  updateInstrumentActionHover(layer, pointer);
}
