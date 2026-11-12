const hoveredRuns = new WeakMap();

// Merged labels belong to the first row in the DOM but can sit over a later
// row. Use that physical row's runs, so independently merged columns agree.
export function updatePointRowHover(list, ownerRow, clientY, fromMergedLabel = false) {
  const previous = hoveredRuns.get(list);
  let row = ownerRow;
  if (row && fromMergedLabel && Number.isFinite(clientY)) {
    const containsY = candidate => {
      const rect = candidate?.getBoundingClientRect();
      return rect && rect.height > 0 && clientY >= rect.top && clientY < rect.bottom;
    };
    if (!containsY(row) && row.getBoundingClientRect().height > 0) {
      const area = row.closest('.measurement-area-points') || list;
      row = previous?.row?.isConnected && area.contains(previous.row) && containsY(previous.row)
        ? previous.row : [...area.querySelectorAll('.point-grid-item')].find(containsY) || null;
    }
  }
  const anchors = row ? [...row.children].filter(cell => cell.matches('.point-grouped-cell[data-run]')) : [];
  const keys = new Set(anchors.map(cell => cell.dataset.run));
  const sameRuns = previous && keys.size === previous.keys.size && [...keys].every(key => previous.keys.has(key));
  if (sameRuns && anchors.every(cell => previous.cells.has(cell)) &&
      [...previous.cells].every(cell => cell.isConnected && keys.has(cell.dataset.run) && cell.classList.contains('is-run-hovered'))) {
    previous.row = row;
    return;
  }
  const cells = new Set(keys.size
    ? [...list.querySelectorAll('.point-grouped-cell[data-run]')].filter(cell => keys.has(cell.dataset.run)) : []);
  previous?.cells.forEach(cell => { if (!cells.has(cell)) cell.classList.remove('is-run-hovered'); });
  cells.forEach(cell => { if (!cell.classList.contains('is-run-hovered')) cell.classList.add('is-run-hovered'); });
  if (cells.size) hoveredRuns.set(list, { row, keys, cells });
  else hoveredRuns.delete(list);
}
