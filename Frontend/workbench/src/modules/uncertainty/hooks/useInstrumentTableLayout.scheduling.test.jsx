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
  expect(container.querySelector('.instrument-library-window').style.getPropertyValue('--instrument-library-width')).toBe('480px');
  expect(table.style.getPropertyValue('--instrument-live-table-width')).toBe('100%');
  unmount();
});
