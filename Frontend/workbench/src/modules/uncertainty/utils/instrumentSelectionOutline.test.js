import { describe, expect, it } from 'vitest';
import { createInstrumentSelectionOutline, selectionPerimeter } from './instrumentSelectionOutline';

const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
const sorted = segments => segments.map(segment => segment.join(',')).sort();

describe('selection perimeter', () => {
  it('removes every internal divider from adjacent selected cells and rows', () => {
    expect(sorted(selectionPerimeter([
      rect(0, 0, 20, 10), rect(20, 0, 40, 10),
      rect(0, 10, 20, 20), rect(20, 10, 40, 20),
    ]))).toEqual(sorted([[0, 0, 40, 0], [0, 20, 40, 20], [0, 0, 0, 20], [40, 0, 40, 20]]));
  });

  it('traces the mockup notch around the unselected range between shared cells', () => {
    expect(sorted(selectionPerimeter([
      rect(0, 0, 20, 20), rect(20, 0, 40, 10), rect(40, 0, 60, 10), rect(60, 0, 80, 20),
    ]))).toEqual(sorted([
      [0, 0, 80, 0], [0, 20, 20, 20], [60, 20, 80, 20], [20, 10, 60, 10],
      [0, 0, 0, 20], [80, 0, 80, 20], [20, 10, 20, 20], [60, 10, 60, 20],
    ]));
  });

  it('keeps separate selections separate and accepts fractional zoom coordinates', () => {
    const first = rect(0, 0, 20.125, 10.25), second = rect(0, 30.75, 20.125, 41);
    expect(selectionPerimeter([first, second])).toHaveLength(8);
    expect(selectionPerimeter([])).toEqual([]);
  });

  it('clears stale outlines and removes its overlay on cleanup', () => {
    const container = document.createElement('div');
    container.innerHTML = '<table><tbody><tr class="instrument-function-row selected-row"><td>Selected</td></tr></tbody></table>';
    const table = container.querySelector('table');
    const bounds = { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 };
    container.getBoundingClientRect = table.getBoundingClientRect = table.querySelector('td').getBoundingClientRect = () => bounds;
    const outline = createInstrumentSelectionOutline(container, table);
    outline.sync();
    expect(container.querySelectorAll('svg path')).toHaveLength(1);
    expect(table.querySelector('svg')).toBeNull();
    table.querySelector('tr').classList.remove('selected-row');
    outline.sync();
    expect(container.querySelectorAll('svg path')).toHaveLength(0);
    outline.destroy();
    expect(container.querySelector('svg')).toBeNull();
  });
});
