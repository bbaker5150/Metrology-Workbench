import { afterEach, expect, it, vi } from 'vitest';
import { attachInstrumentPointerDrag } from './instrumentPointerDrag';
import { instrumentCellGrid, updateInstrumentCellHighlights } from './instrumentCellSelection';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });
const pointer = (target, type, x, y) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
};
it('keeps transfers in memory, cancels outside drops, and accepts valid table drops', () => {
  document.body.innerHTML = '<table class="instrument-equipment-table"><tbody><tr class="instrument-function-row"><td>Source</td></tr><tr><td>Target</td></tr></tbody></table><div id="outside"></div>';
  const table = document.querySelector('table'), source = table.rows[0].cells[0], target = table.rows[1].cells[0];
  const drop = vi.fn();
  table.addEventListener('dragstart', event => event.dataTransfer.setData('application/x-workbench-instruments', JSON.stringify({ items: [{ kind: 'uut', item: { id: 'one' } }] })));
  table.addEventListener('drop', event => drop(JSON.parse(event.dataTransfer.getData('application/x-workbench-instruments'))));
  let hit = document.getElementById('outside');
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => hit) });
  const release = attachInstrumentPointerDrag(table);
  const start = () => { pointer(source, 'pointerdown', 10, 10); pointer(window, 'pointermove', 40, 40); };
  start();
  expect(document.querySelector('.instrument-pointer-drag-preview')).not.toBeNull();
  pointer(window, 'pointerup', 40, 40);
  expect(drop).not.toHaveBeenCalled();
  expect(document.querySelector('.instrument-pointer-drag-preview')).toBeNull();
  start(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(document.body.style.cursor).not.toBe('grabbing');
  expect(drop).not.toHaveBeenCalled();
  hit = target; start(); pointer(window, 'pointerup', 40, 40);
  expect(drop).toHaveBeenCalledExactlyOnceWith({ items: [{ kind: 'uut', item: { id: 'one' } }] });
  start(); window.dispatchEvent(new Event('blur'));
  expect(document.querySelector('.instrument-pointer-drag-preview')).toBeNull();
  start(); release();
  expect(document.body.style.userSelect).not.toBe('none');
});

it('maps Sync and custom columns through shared range cells without lighting unrelated rows', () => {
  const table = document.createElement('table');
  table.innerHTML = '<tbody><tr data-selection-key="one" data-range-id="a"><td rowspan="2">Description</td><td>Range A</td><td rowspan="2">Custom</td><td>Distribution A</td><td rowspan="2" class="cell-sync">Sync</td></tr><tr data-selection-key="one" data-range-id="b" data-range-selected="true"><td>Range B</td><td>Distribution B</td></tr><tr data-selection-key="two" data-range-id="c"><td>Other</td><td>Range C</td><td>Other custom</td><td>Distribution C</td><td class="cell-sync">Other sync</td></tr></tbody>';
  const { cells } = instrumentCellGrid(table);
  expect(cells.find(entry => entry.cell.textContent === 'Distribution B').column).toBe(3);
  updateInstrumentCellHighlights(table, table.rows[1], table.rows[1].cells[1]);
  expect(table.rows[0].cells[3]).toHaveAttribute('data-column-hovered');
  expect(table.rows[0].cells[3]).not.toHaveAttribute('data-cell-hovered');
  expect(table.rows[0].cells[2]).toHaveAttribute('data-cell-hovered');
  expect(table.rows[1].cells[1]).toHaveAttribute('data-before-sync');
  expect(table.rows[0].cells[3]).toHaveAttribute('data-before-sync');
  updateInstrumentCellHighlights(table, table.rows[1], table.rows[0].cells[4]);
  expect(table.rows[2].cells[4]).toHaveAttribute('data-column-hovered');
  expect(table.rows[2].cells[0]).not.toHaveAttribute('data-cell-hovered');
});
