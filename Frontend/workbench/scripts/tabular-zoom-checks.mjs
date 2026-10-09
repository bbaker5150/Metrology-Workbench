// Focused regression for nested grid geometry during scoped instrument zoom.
export async function checkTabularZoom({ editor, check }) {
  const previous = await editor.evaluate(cell => cell.closest('.instrument-equipment-table').style.zoom);
  try {
    for (const zoom of [.65, .8, 1, 1.15, 1.25, 1.5, .8, 1]) {
      await editor.evaluate(async (cell, value) => {
        cell.closest('.instrument-equipment-table').style.zoom = String(value);
        window.dispatchEvent(new Event('resize'));
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      }, zoom);
      check(`tabular borders and columns stay aligned at zoom ${zoom}`, await editor.locator('.dynamic-lookup-table').evaluate(table => {
        const rows = [...table.rows];
        const headers = [...rows[0].cells].map(cell => cell.getBoundingClientRect());
        return getComputedStyle(table).borderCollapse === 'separate'
          && [...rows[0].cells].every(cell => getComputedStyle(cell).willChange === 'auto')
          && rows.every((row, index) => [...row.cells].every((cell, column) => {
            const rect = cell.getBoundingClientRect();
            const style = getComputedStyle(cell);
            const next = rows[index + 1]?.cells[column]?.getBoundingClientRect();
            return Math.abs(rect.left - headers[column].left) < 1
              && Math.abs(rect.right - headers[column].right) < 1
              && (!next || Math.abs(rect.bottom - next.top) < 1)
              && parseFloat(style.borderBottomWidth) > 0
              && (column >= row.cells.length - 2 || parseFloat(style.borderRightWidth) > 0);
          }));
      }));
    }
  } finally {
    await editor.evaluate((cell, zoom) => {
      cell.closest('.instrument-equipment-table').style.zoom = zoom;
      window.dispatchEvent(new Event('resize'));
    }, previous);
  }
}
