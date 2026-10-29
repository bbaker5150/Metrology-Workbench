// Selection records physical range rows, including every row covered by a shared cell.
export function nextInstrumentCellSelection({ rows, clickedIndex, span = 1, rangeTarget, previous = {}, previousMode, anchor, shift, additive }) {
  const mode = rangeTarget && (!additive && !shift || previousMode === "range" || !Object.values(previous).some(ids => ids.length)) ? "range" : "instrument";
  const start = shift && Number.isInteger(anchor) ? Math.min(anchor, clickedIndex) : clickedIndex;
  const end = shift && Number.isInteger(anchor) ? Math.max(anchor, clickedIndex + span - 1) : clickedIndex + span - 1;
  const selected = rows.slice(start, end + 1);
  const repeated = !additive && !shift && mode === previousMode &&
    Object.values(previous).reduce((count, ids) => count + ids.length, 0) === selected.length &&
    selected.every(row => previous[row.key]?.includes(row.rangeId));
  if (repeated) return { ranges: {}, mode, anchor: clickedIndex };
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
  const rows = [...table.querySelectorAll("tr[data-selection-key][data-range-id], tr.instrument-function-row:not([data-selection-key])")];
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

export function createInstrumentCellHighlighter(table) {
  let grid, byRow, byColumn, byCell;
  let hoveredColumn;
  let rowCells = new Set(), columnCells = new Set();
  const toggle = (cell, attribute, active) => {
    if (cell.hasAttribute(attribute) !== active) cell.toggleAttribute(attribute, active);
  };
  const update = (previous, next, attribute) => {
    previous.forEach(cell => { if (!next.has(cell)) toggle(cell, attribute, false); });
    next.forEach(cell => { if (!previous.has(cell)) toggle(cell, attribute, true); });
    return next;
  };
  const hover = (row = null, cell = null) => {
    if (!grid) refresh();
    rowCells = update(rowCells, new Set(byRow.get(row) || []), 'data-cell-hovered');
    const entry = byCell.get(cell), next = new Set();
    const columnKey = entry ? `${entry.column}:${entry.end}` : null;
    if (columnKey === hoveredColumn) return;
    hoveredColumn = columnKey;
    if (entry) for (let col = entry.column; col < entry.end; col++) {
      (byColumn.get(col) || []).forEach(candidate => next.add(candidate));
    }
    columnCells = update(columnCells, next, 'data-column-hovered');
  };
  const refresh = () => {
    grid = instrumentCellGrid(table);
    hoveredColumn = undefined;
    byRow = new Map(); byColumn = new Map(); byCell = new Map();
    rowCells = new Set(grid.cells.filter(({ cell }) => cell.hasAttribute('data-cell-hovered')).map(({ cell }) => cell));
    columnCells = new Set(grid.cells.filter(({ cell }) => cell.hasAttribute('data-column-hovered')).map(({ cell }) => cell));
    const syncColumn = grid.cells.find(entry => entry.cell.classList.contains('cell-sync'))?.column;
    grid.cells.forEach(entry => {
      const { cell, column, end, covered } = entry;
      byCell.set(cell, entry);
      covered.forEach(row => { if (!byRow.has(row)) byRow.set(row, []); byRow.get(row).push(cell); });
      for (let col = column; col < end; col++) {
        if (!byColumn.has(col)) byColumn.set(col, []);
        byColumn.get(col).push(cell);
      }
      const selected = covered.some(row => row.dataset.rangeSelected === 'true' ||
        (!row.dataset.selectionKey && row.matches('.selected-row, .selected-spec-row'))) &&
        !(table.dataset.selectionMode === 'range' && cell.classList.contains('cell-description'));
      toggle(cell, 'data-cell-selected', selected);
      toggle(cell, 'data-before-sync', end === syncColumn);
    });
  };
  return { refresh, hover, invalidate() { grid = null; }, get rows() { if (!grid) refresh(); return grid.rows; } };
}

// Shared description/qualifier cells can cover hundreds of physical rows.
// Resolve the pointer with logarithmic geometry reads, rather than scanning
// every preceding row for every pointermove event.
export function instrumentRowAtY(rows, y, selectionKey) {
  let low = 0, high = rows.length - 1;
  while (low <= high) {
    const index = (low + high) >>> 1, row = rows[index];
    const rect = row.getBoundingClientRect();
    if (y < rect.top) high = index - 1;
    else if (y >= rect.bottom) low = index + 1;
    else return row.dataset.selectionKey === selectionKey ? row : null;
  }
  return null;
}

export function updateInstrumentCellHighlights(table, hoveredRow = null, hoveredCell = null) {
  const highlighter = createInstrumentCellHighlighter(table);
  highlighter.refresh();
  highlighter.hover(hoveredRow, hoveredCell);
}
