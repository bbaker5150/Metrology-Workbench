import { afterEach, expect, it, vi } from 'vitest';
import { createInstrumentRangeViewCache, createQualifierRowSpanLookup, qualifierRowSpan } from './qualifierRanges';
import { createInstrumentCellHighlighter, instrumentRowAtY } from './instrumentCellSelection';
import { measureInlineTextWidths } from './measureInlineTextWidths';
import { getInstrumentRangeRows } from './instrumentFunctionSelection';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it('normalizes only linked specification rows and reads fresh resolution edits', () => {
  let reads = 0;
  const ranges = Array.from({ length: 2000 }, (_, i) => ({ id: String(i),
    get resolution() { reads++; return 1e-7; }, tolerances: { reading: { high: i, unit: 'ppm' } } }));
  const instrument = { functions: [{ id: 'f', name: 'Voltage', unit: 'V', ranges }] };
  const selected = () => getInstrumentRangeRows(instrument, { flattenTolerances: true, rangeIds: ['1999'] });
  expect(selected()).toMatchObject([{ rangeId: '1999', _index: 1999, functionId: 'f', resolution: 1e-7, reading: { high: 1999 } }]);
  expect(reads).toBe(1);
  Object.defineProperty(ranges[1999], 'resolution', { value: 2e-7 });
  expect(selected()[0].resolution).toBe(2e-7);
  expect(getInstrumentRangeRows(instrument, { rangeIds: ['missing'] })).toEqual([]);
});

it('preserves shared, blank, nested and separated qualifier spans with a linear lookup', () => {
  const rows = ['AC','AC','AC','','AC','DC','DC'].map((text, i) => ({
    id: String(i), functionId: 'voltage', qualifierGroupId: i < 4 ? 'first' : 'second',
    qualifier: { text, qualifier: { text: i % 3 === 0 ? '' : '1 Year' } },
  }));
  rows.push({ id: 'unqualified' });
  const span = createQualifierRowSpanLookup(rows);
  for (let depth = 0; depth < 4; depth++) {
    expect(rows.map(row => span(row, depth))).toEqual(rows.map(row => qualifierRowSpan(rows, row, depth)));
  }
  expect(span({ id: 'missing' })).toBe(0);
});

it('does not repeatedly walk all IDs when rendering thousands of specifications', () => {
  let reads = 0;
  const rows = Array.from({ length: 2000 }, (_, i) => ({
    get rangeId() { reads++; return String(i); }, qualifierGroupId: `group-${Math.floor(i / 30)}`,
    qualifier: { text: 'AC', qualifier: { text: ['90 Days','1 Year','2 Years'][i % 3] } },
  }));
  const span = createQualifierRowSpanLookup(rows);
  for (const row of rows) for (let depth = 0; depth < 3; depth++) span(row, depth);
  expect(reads).toBeLessThanOrEqual(rows.length * 5);
  const cache = createInstrumentRangeViewCache();
  const item = { instrument: { ranges: [{ id: 'r', resolution: 1, qualifier: { text: 'AC' } }] } };
  expect(cache(item)).toBe(cache(item));
  const edited = { instrument: { ranges: [{ ...item.instrument.ranges[0], resolution: 2 }] } };
  expect(cache(edited).rows[0].resolution).toBe(2);
  expect(cache(item).rows[0].resolution).toBe(1);
});

it('keeps instrument-owned secondary errors out of the editable range tolerance and honors custom overrides', () => {
  const base = { reading: { high: 10, unit: 'ppm' } }, override = { floor: { high: 1, unit: 'V' } };
  const item = { instrument: { tmdeSecondaryUncertainties: [{ id: 'secondary', kind: 'parametric' }],
    functions: [{ id: 'f', ranges: [{ id: 'r', tolerances: base }] }] } };
  const cache = createInstrumentRangeViewCache();
  expect(cache(item).tolerances.get('r')).toBe(base);
  expect(cache(item).rows[0].tolerances.tmdeSecondaryUncertainties).toHaveLength(1);
  expect(cache({ ...item, ranges: [{ rangeId: 'r', tolerances: override }] }).tolerances.get('r')).toBe(override);
});

it('moves hover within a 1000-row table without rebuilding the cell grid or rewriting the column', () => {
  const table = document.createElement('table');
  table.innerHTML = `<tbody>${Array.from({ length: 1000 }, (_, i) =>
    `<tr data-selection-key="meter" data-range-id="${i}">${i === 0 ? '<td rowspan="1000">Meter</td>' : ''}<td>Range ${i}</td><td>Spec ${i}</td></tr>`).join('')}</tbody>`;
  document.body.appendChild(table);
  const highlighter = createInstrumentCellHighlighter(table);
  highlighter.refresh();
  highlighter.hover(table.rows[500], table.rows[500].cells[1]);
  const query = vi.spyOn(table, 'querySelectorAll');
  const writes = vi.spyOn(Element.prototype, 'toggleAttribute');
  highlighter.hover(table.rows[501], table.rows[501].cells[1]);
  expect(query).not.toHaveBeenCalled();
  expect(writes.mock.calls.length).toBeLessThanOrEqual(4);
  expect(table.rows[0].cells[0]).toHaveAttribute('data-cell-hovered');
  expect(table.rows[500].cells[1]).not.toHaveAttribute('data-cell-hovered');
  expect(table.rows[501].cells[1]).toHaveAttribute('data-cell-hovered');
  table.rows[501].dataset.rangeSelected = 'true';
  highlighter.refresh();
  expect(table.rows[501].cells[1]).toHaveAttribute('data-cell-selected');
  const added = table.tBodies[0].insertRow();
  added.dataset.selectionKey = 'meter'; added.dataset.rangeId = 'added'; added.insertCell().textContent = 'New';
  highlighter.invalidate(); highlighter.hover(added, added.cells[0]);
  expect(added.cells[0]).toHaveAttribute('data-cell-hovered');
});

it('locates a physical row beneath a shared cell with logarithmic geometry reads', () => {
  let reads = 0;
  const rows = Array.from({ length: 4096 }, (_, i) => ({ dataset: { selectionKey: 'meter' },
    getBoundingClientRect() { reads++; return { top: i * 20, bottom: (i + 1) * 20 }; } }));
  expect(instrumentRowAtY(rows, 4000 * 20 + 1, 'meter')).toBe(rows[4000]);
  expect(reads).toBeLessThanOrEqual(13);
  expect(instrumentRowAtY(rows, 100, 'another')).toBeNull();
});

it('measures repeated qualifier labels with one attached probe batch', () => {
  const labels = Array.from({ length: 1000 }, (_, i) => {
    const label = document.createElement('span'); label.textContent = ['90 Days','1 Year','2 Years'][i % 3]; return label;
  });
  const append = vi.spyOn(document.body, 'appendChild');
  const widths = measureInlineTextWidths(labels);
  expect(append).toHaveBeenCalledOnce();
  expect(append.mock.calls[0][0].children.length).toBe(3);
  expect(widths.size).toBe(1000);
  expect(document.body.children).toHaveLength(0);
});
