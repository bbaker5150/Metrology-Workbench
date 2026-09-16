// Selection records physical range rows, including every row covered by a shared cell.
export function nextInstrumentCellSelection({ rows, clickedIndex, span = 1, rangeTarget, previous = {}, previousMode, anchor, shift, additive }) {
  const mode = rangeTarget && (!additive && !shift || previousMode === "range" || !Object.values(previous).some(ids => ids.length)) ? "range" : "instrument";
  const start = shift && Number.isInteger(anchor) ? Math.min(anchor, clickedIndex) : clickedIndex;
  const end = shift && Number.isInteger(anchor) ? Math.max(anchor, clickedIndex + span - 1) : clickedIndex + span - 1;
  const selected = rows.slice(start, end + 1);
  const next = additive ? Object.fromEntries(Object.entries(previous).map(([key, ids]) => [key, [...ids]])) : {};
  const remove = additive && !shift && selected.every(row => next[row.key]?.includes(row.rangeId));
  for (const row of selected) {
    const ids = new Set(next[row.key] || []);
    if (remove) ids.delete(row.rangeId); else ids.add(row.rangeId);
    if (ids.size) next[row.key] = [...ids]; else delete next[row.key];
  }
  return { ranges: next, mode, anchor: shift && Number.isInteger(anchor) ? anchor : clickedIndex };
}
export function instrumentRowSelectionFromEvent(event, previous, previousMode, anchor) {
  const row = event.currentTarget, table = row.closest("table");
  const elements = [...table.querySelectorAll("tr[data-selection-key][data-range-id]")];
  const rows = elements.map(node => ({ key: node.dataset.selectionKey, rangeId: node.dataset.rangeId }));
  return nextInstrumentCellSelection({ rows, clickedIndex: elements.indexOf(row), span: event.target.closest("td")?.rowSpan || 1,
    rangeTarget: Boolean(event.target.closest("[data-range-cell]")), previous, previousMode,
    anchor: anchor?.table === table ? anchor.index : null, shift: event.shiftKey, additive: event.ctrlKey || event.metaKey });
}
// Logical columns cannot use cellIndex: row-spanned Description/Sync/custom
// cells disappear from later rows. Build one occupancy grid for every range.
export function instrumentCellGrid(table) {
  const rows = [...table.querySelectorAll("tr[data-selection-key][data-range-id]")];
  const occupied = [], cells = [];
  rows.forEach((row, index) => {
    occupied[index] ||= [];
    let column = 0;
    for (const cell of row.cells) {
      while (occupied[index][column]) column++;
      const covered = rows.slice(index, index + cell.rowSpan).filter(candidate => candidate.dataset.selectionKey === row.dataset.selectionKey);
      const end = column + cell.colSpan;
      for (let offset = 0; offset < covered.length; offset++) {
        occupied[index + offset] ||= [];
        for (let col = column; col < end; col++) occupied[index + offset][col] = cell;
      }
      cells.push({ cell, index, column, end, covered });
      column = end;
    }
  });
  return { rows, cells };
}

export function updateInstrumentCellHighlights(table, hoveredRow = null, hoveredCell = null) {
  const { rows, cells } = instrumentCellGrid(table);
  const hoverIndex = rows.indexOf(hoveredRow);
  const hovered = cells.find(entry => entry.cell === hoveredCell);
  const syncColumn = cells.find(entry => entry.cell.classList.contains('cell-sync'))?.column;
  cells.forEach(({ cell, index, column, end, covered }) => {
      const selected = covered.some(candidate => candidate.dataset.rangeSelected === "true") &&
        !(table.dataset.selectionMode === "range" && cell.classList.contains("cell-description"));
      cell.toggleAttribute("data-cell-selected", selected);
      cell.toggleAttribute("data-cell-hovered", hoverIndex >= index && hoverIndex < index + covered.length);
      cell.toggleAttribute("data-column-hovered", Boolean(hovered && column < hovered.end && end > hovered.column));
      // Sync owns the full-height left seam. Do not also draw the preceding
      // cell's right border on only the first physical row of an instrument.
      cell.toggleAttribute("data-before-sync", end === syncColumn);
  });
}
