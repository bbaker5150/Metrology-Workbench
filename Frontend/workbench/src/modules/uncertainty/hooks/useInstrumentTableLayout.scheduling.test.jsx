import React, { useRef } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import useInstrumentTableLayout, { instrumentMutationAffectsLayout } from "./useInstrumentTableLayout";
import { measureTableColumnWidths } from "../utils/measureTableColumnWidths";
vi.mock('../utils/measureTableColumnWidths', () => ({ measureTableColumnWidths: vi.fn() }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('does not resize for hover colors, but still responds to editors, selection and column changes', () => {
  const cell = document.createElement('td');
  const mutation = (before, after) => {
    cell.className = after;
    return { type: 'attributes', attributeName: 'class', oldValue: before, target: cell };
  };
  expect(instrumentMutationAffectsLayout(mutation('cell-value', 'cell-value col-hovered'))).toBe(false);
  expect(instrumentMutationAffectsLayout(mutation('row-hovered instrument-function-row', 'instrument-function-row'))).toBe(false);
  expect(instrumentMutationAffectsLayout(mutation('inline-range-editor', 'inline-range-editor is-editing'))).toBe(true);
  expect(instrumentMutationAffectsLayout(mutation('instrument-function-row', 'instrument-function-row selected-row'))).toBe(true);
  expect(instrumentMutationAffectsLayout({ type: 'attributes', attributeName: 'style' })).toBe(true);
  expect(instrumentMutationAffectsLayout({ type: 'childList' })).toBe(true);
});

it('ignores its own layout styles while still responding to authored widths and zoom', () => {
  const table = document.createElement('table'), col = document.createElement('col'), button = document.createElement('button');
  button.className = 'instrument-column-insert-button';
  const change = (target, before, after) => {
    target.setAttribute('style', after);
    return instrumentMutationAffectsLayout({ type: 'attributes', attributeName: 'style', oldValue: before, target });
  };
  expect(change(table, 'min-width: 1200px;', 'min-width: 1200px; --instrument-live-table-width: 1600px; --instrument-natural-table-width: 1600px;')).toBe(false);
  expect(change(col, 'width: 100px;', 'width: 100px; --instrument-live-column-width: 180px;')).toBe(false);
  expect(change(button, 'left: 20px;', 'left: 40px; position: fixed;')).toBe(false);
  expect(change(table, 'zoom: 1;', 'zoom: 1.2;')).toBe(true);
  expect(change(col, 'width: 100px;', 'width: 200px;')).toBe(true);
});

it('updates range selection and mode without cloning or remeasuring library content', async () => {
  const frames = new Map(); let id = 0;
  vi.stubGlobal('requestAnimationFrame', callback => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', key => frames.delete(key));
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}]);
  measureTableColumnWidths.mockReturnValue({ description: 300, range: 120 });
  function Fixture() {
    const ref = useRef(null), attach = useInstrumentTableLayout(ref);
    return <div className="instrument-library-window"><div ref={attach}><table data-selection-mode="instrument">
      <colgroup><col style={{ width: '50%' }}/><col style={{ width: '50%' }}/></colgroup>
      <thead><tr><th data-instrument-column="description">Description</th><th data-instrument-column="range">Range</th></tr></thead>
      <tbody><tr data-selection-key="meter" data-range-id="a" data-range-selected="false"><td rowSpan={2} className="cell-description">Meter</td><td>A</td></tr>
        <tr data-selection-key="meter" data-range-id="b" data-range-selected="false"><td>B</td></tr></tbody>
    </table></div></div>;
  }
  const { container, unmount } = render(<Fixture/>);
  const table = container.querySelector('table');
  const description = table.tBodies[0].rows[0].cells[0];
  const row = table.tBodies[0].rows[1];
  const flush = async () => {
    await act(async () => { await Promise.resolve(); });
    await act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); });
  };
  await flush();
  measureTableColumnWidths.mockClear();
  row.dataset.rangeSelected = 'true'; row.className = 'instrument-selected is-selected-range';
  await flush();
  expect(row.cells[0]).toHaveAttribute('data-cell-selected');
  expect(description).toHaveAttribute('data-cell-selected');
  table.dataset.selectionMode = 'range';
  await flush();
  expect(row.cells[0]).toHaveAttribute('data-cell-selected');
  expect(description).not.toHaveAttribute('data-cell-selected');
  row.dataset.rangeSelected = 'false'; row.className = '';
  await flush();
  expect(row.cells[0]).not.toHaveAttribute('data-cell-selected');
  expect(measureTableColumnWidths).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
  unmount();
});

it('settles after initial measurement with real mutation observation and positioned header controls', async () => {
  const frames = new Map(); let id = 0;
  vi.stubGlobal('requestAnimationFrame', callback => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', key => frames.delete(key));
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}]);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 500, bottom: 30, width: 500, height: 30 });
  const matches = Element.prototype.matches, open = new WeakSet();
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (selector) {
    return selector === ':popover-open' ? open.has(this) : matches.call(this, selector);
  });
  function Fixture() {
    const ref = useRef(null), attach = useInstrumentTableLayout(ref);
    return <div ref={attach}><table style={{ minWidth: 200 }}>
      <colgroup><col style={{ width: '100%' }}/></colgroup>
      <thead><tr><th data-instrument-column="description">Instrument<button className="instrument-column-insert-button"
        ref={node => { if (node) { node.showPopover = () => open.add(node); node.hidePopover = () => open.delete(node); } }}/></th></tr></thead>
      <tbody><tr><td>5790B</td></tr></tbody>
    </table></div>;
  }
  const { container, unmount } = render(<Fixture/>);
  await act(async () => { await Promise.resolve(); });
  expect(container.querySelector('button').style.position).toBe('fixed');
  expect(frames.size).toBe(0);
  // Authored width changes still schedule exactly one measurement.
  container.querySelector('col').style.width = '240px';
  await act(async () => { await Promise.resolve(); });
  expect(frames.size).toBe(1);
  await act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); });
  expect(frames.size).toBe(0);
  unmount();
});

it("coalesces drag style and resize notifications, yielding before measuring again", () => {
  let mutation, resize;
  let nextId = 0;
  const frames = new Map();
  const disconnected = vi.fn();
  vi.stubGlobal("MutationObserver", class { constructor(callback) { mutation = callback; } observe() {} disconnect() { disconnected(); } });
  vi.stubGlobal("ResizeObserver", class { constructor(callback) { resize = callback; } observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", callback => { frames.set(++nextId, callback); return nextId; });
  vi.stubGlobal("cancelAnimationFrame", id => frames.delete(id));
  // Count attempted layout reads. jsdom's empty rects deliberately skip the
  // browser geometry calculation; this tests the observer's event lifecycle.
  const measure = vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([]);
  function Fixture() { const ref = useRef(null); const attach = useInstrumentTableLayout(ref); return <div ref={attach}><table><tbody /></table></div>; }
  const { unmount } = render(<Fixture />);
  measure.mockClear();
  for (let i = 0; i < 100; i++) { mutation(); resize(); }
  expect(measure).not.toHaveBeenCalled();
  expect(frames.size).toBe(1);
  const pending = [...frames.values()]; frames.clear();
  act(() => pending.forEach(callback => callback()));
  expect(measure).toHaveBeenCalledOnce();
  mutation();
  expect(frames.size).toBe(1);
  unmount();
  expect(frames.size).toBe(0);
  expect(disconnected).toHaveBeenCalled();
});

it('sizes the library from content, caches measurements across hover/resize, and refits edited text', () => {
  let tableMutation, resize;
  const frames = [];
  vi.stubGlobal('MutationObserver', class {
    constructor(callback) { this.callback = callback; }
    observe(node) { if (node.tagName === 'TABLE') tableMutation = this.callback; }
    disconnect() {}
  });
  vi.stubGlobal('ResizeObserver', class { constructor(callback) { resize = callback; } observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', callback => { frames.push(callback); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}]);
  measureTableColumnWidths.mockReturnValue({ description: 300, tolerance: 500 });
  function Fixture({ namesOnly = false }) {
    const ref = useRef(null); const attach = useInstrumentTableLayout(ref);
    return <div className="instrument-library-window"><div className="configuration-panel"><div ref={attach}>
      <table className={namesOnly ? 'instrument-library-names-only' : ''} style={{ minWidth: 200 }}>
        {!namesOnly && <><colgroup><col style={{ width: '50%' }}/><col style={{ width: '50%' }}/></colgroup>
        <thead><tr><th data-instrument-column="description">Description</th><th data-instrument-column="tolerance">Tolerance</th></tr></thead></>}
        <tbody><tr><td>Meter</td><td>Long bias value</td></tr></tbody>
      </table>
    </div></div></div>;
  }
  const { container, unmount, rerender } = render(<Fixture />);
  const table = container.querySelector('table');
  const flush = () => act(() => { frames.splice(0).forEach(callback => callback()); });
  expect(measureTableColumnWidths).toHaveBeenCalledOnce();
  expect(table.style.getPropertyValue('--instrument-live-table-width')).toBe('800px');
  // Our width writes and viewport resizes must not trigger a new clone/reflow.
  tableMutation([{ type: 'attributes', attributeName: 'style', target: table }]);
  resize(); flush();
  const cell = table.querySelector('td'); cell.className = 'col-hovered';
  tableMutation([{ type: 'attributes', attributeName: 'class', oldValue: '', target: cell }]); flush();
  expect(measureTableColumnWidths).toHaveBeenCalledOnce();
  measureTableColumnWidths.mockReturnValue({ description: 300, tolerance: 650 });
  tableMutation([{ type: 'characterData', target: cell.firstChild }]); flush();
  expect(measureTableColumnWidths).toHaveBeenCalledTimes(2);
  expect(table.style.getPropertyValue('--instrument-live-table-width')).toBe('950px');
  rerender(<Fixture namesOnly />);
  tableMutation([{ type: 'childList', target: table }]); flush();
  expect(measureTableColumnWidths).toHaveBeenCalledTimes(2);
  expect(container.querySelector('.instrument-library-window').style.getPropertyValue('--instrument-library-width')).toBe('560px');
  expect(table.style.getPropertyValue('--instrument-live-table-width')).toBe('100%');
  unmount();
});
