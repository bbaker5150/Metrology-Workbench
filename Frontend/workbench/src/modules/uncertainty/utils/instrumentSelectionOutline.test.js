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

  it('excludes the shared uncertainty rail only in range mode, including at browser zoom', () => {
    const container = document.createElement('div');
    container.innerHTML = '<table><tbody><tr><td data-cell-selected class="instrument-uncertainty-name-cell" style="--instrument-uncertainty-rail-width:22px">Source</td></tr></tbody></table>';
    const table = container.querySelector('table');
    const bounds = { left: 10, top: 20, right: 210, bottom: 60, width: 200, height: 40 };
    Object.defineProperty(container, 'offsetWidth', { value: 100 });
    container.getBoundingClientRect = table.getBoundingClientRect = table.querySelector('td').getBoundingClientRect = () => bounds;
    const outline = createInstrumentSelectionOutline(container, table);
    table.dataset.selectionMode = 'range';
    outline.sync();
    expect(container.querySelector('path').getAttribute('d')).toBe('M22,0L100,0 M22,20L100,20 M22,0L22,20 M100,0L100,20');
    table.dataset.selectionMode = 'instrument';
    outline.sync();
    expect(container.querySelector('path').getAttribute('d')).toBe('M0,0L100,0 M0,20L100,20 M0,0L0,20 M100,0L100,20');
    outline.destroy();
  });

  it('wraps around the entire shared rail when a continuation source selects its instrument', () => {
    const container = document.createElement('div');
    container.innerHTML = `<table data-selection-mode="instrument"><tbody>
      <tr data-selection-key="tmde"><td rowspan="3" data-cell-selected class="cell-description">Instrument</td><td>Range</td></tr>
      <tr data-selection-key="tmde"><td class="instrument-uncertainty-name-cell" style="--instrument-uncertainty-rail-width:22px"><span class="instrument-uncertainty-rail">Label</span></td></tr>
      <tr data-selection-key="tmde"><td data-cell-selected class="instrument-uncertainty-name-cell" style="--instrument-uncertainty-rail-width:22px">Second source</td></tr>
    </tbody></table>`;
    const table = container.querySelector('table');
    const bounds = (left, top, right, bottom) => ({ left, top, right, bottom, width:right-left, height:bottom-top });
    Object.defineProperty(container, 'offsetWidth', { value: 60 });
    container.getBoundingClientRect = table.getBoundingClientRect = () => bounds(0,0,60,30);
    table.querySelector('.cell-description').getBoundingClientRect = () => bounds(0,0,20,30);
    const sources = table.querySelectorAll('.instrument-uncertainty-name-cell');
    sources[0].getBoundingClientRect = () => bounds(20,10,60,20);
    sources[1].getBoundingClientRect = () => bounds(20,20,60,30);
    table.querySelector('.instrument-uncertainty-rail').getBoundingClientRect = () => bounds(20,10,42,30);
    const outline = createInstrumentSelectionOutline(container, table);
    outline.sync();
    const segments = [...container.querySelector('path').getAttribute('d').matchAll(/M([\d.-]+),([\d.-]+)L([\d.-]+),([\d.-]+)/g)].map(m=>m.slice(1).map(Number));
    expect(sorted(segments)).toEqual(sorted([
      [0,0,20,0], [0,30,60,30], [20,10,42,10], [42,20,60,20],
      [0,0,0,30], [20,0,20,10], [42,10,42,20], [60,20,60,30],
    ]));
    outline.destroy();
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

  it.each([0.8, 1, 1.25])('wraps the independent action surface without an internal seam at scale %s', scale => {
    const viewport = document.createElement('div');
    viewport.className = 'instrument-table-viewport';
    viewport.innerHTML = `<div><table><thead><tr><th>Header</th></tr></thead><tbody>
      <tr><td data-cell-selected>Selected</td></tr><tr><td>Unselected</td></tr>
      </tbody></table></div><div class="instrument-action-layer"><div class="instrument-action-band" data-cell-selected></div></div>`;
    const [container,layer] = viewport.children, table = container.firstChild;
    const bounds = (left,top,right,bottom) => ({left:left*scale,top:top*scale,right:right*scale,bottom:bottom*scale,width:(right-left)*scale,height:(bottom-top)*scale});
    Object.defineProperty(viewport,'offsetWidth',{value:128});
    Object.defineProperties(container,{offsetWidth:{value:100},clientHeight:{value:70,writable:true}});
    viewport.getBoundingClientRect = () => bounds(0,0,128,70);
    container.getBoundingClientRect = () => bounds(0,0,100,70);
    layer.getBoundingClientRect = () => bounds(100,0,128,70);
    table.tHead.rows[0].cells[0].getBoundingClientRect = () => bounds(0,0,120,20);
    const [first,second] = table.querySelectorAll('td');
    first.getBoundingClientRect = () => bounds(-20,20,120,40);
    second.getBoundingClientRect = () => bounds(-20,40,120,60);
    layer.firstChild.getBoundingClientRect = () => bounds(100,20,128,60);
    const outline = createInstrumentSelectionOutline(container,table);
    const segments = () => [...viewport.querySelector('path').getAttribute('d').matchAll(/M([\d.-]+),([\d.-]+)L([\d.-]+),([\d.-]+)/g)].map(m=>m.slice(1).map(Number));
    outline.sync();
    expect(sorted(segments())).toEqual(sorted([
      [0,20,128,20],[0,40,100,40],[100,60,128,60],[0,20,0,40],[100,40,100,60],[128,20,128,60],
    ]));
    second.setAttribute('data-cell-selected','');
    first.getBoundingClientRect = () => bounds(-20,20,99.6,40);
    second.getBoundingClientRect = () => bounds(-20,40,99.6,60);
    container.clientHeight = 50;
    outline.sync();
    expect(sorted(segments())).toEqual(sorted([[0,20,128,20],[0,50,128,50],[0,20,0,50],[128,20,128,50]]));
    expect(container.querySelector('svg')).toBeNull();
    outline.destroy();
  });

});
