import { expect, it, vi } from 'vitest';
import { syncInstrumentActions, updateInstrumentActionHover } from './instrumentActionLayout';

function setup(scale = 1) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<div><table><thead><tr><th>Header</th></tr></thead><tbody>
    <tr data-instrument-id="a" data-measurement-area="one" style="--instrument-function-color:#abcd00"><td>Range 1</td></tr>
    <tr data-instrument-id="a" data-measurement-area="one" style="--instrument-function-color:#abcd00"><td>Range 2</td></tr>
    <tr data-instrument-id="a" data-measurement-area="two"><td>Other area</td></tr>
    </tbody></table></div><div><div class="instrument-action-surfaces"></div><span class="instrument-row-action" data-instrument-id="a" data-measurement-area="one"><button>Delete</button></span></div>`;
  const [container, layer] = wrapper.children, table = container.firstChild, action = layer.lastChild;
  const bounds = (left, top, right, bottom) => ({ left:left*scale, top:top*scale,
    right:right*scale, bottom:bottom*scale, width:(right-left)*scale, height:(bottom-top)*scale });
  Object.defineProperties(container, { offsetWidth:{value:100}, clientHeight:{value:140} });
  Object.defineProperty(layer, 'offsetWidth', {value:28});
  container.getBoundingClientRect = () => bounds(0,0,100,150);
  layer.getBoundingClientRect = () => bounds(100,0,128,150);
  table.tHead.rows[0].cells[0].getBoundingClientRect = () => bounds(0,0,100,20);
  const rows = [...table.tBodies[0].rows];
  rows[0].getBoundingClientRect = () => bounds(0,20,400,50);
  rows[1].getBoundingClientRect = () => bounds(0,50,400,100);
  rows[2].getBoundingClientRect = () => bounds(0,100,400,140);
  return {container, table, layer, action, rows, bounds};
}

it.each([0.8, 1, 1.25])('centers the correct instrument/area group independently of column geometry at scale %s', scale => {
  const {container,table,layer,action,rows,bounds} = setup(scale);
  syncInstrumentActions(container,table,layer,{x:110*scale,y:70*scale});
  expect(action.hidden).toBe(false);
  expect(parseFloat(action.style.top)).toBeCloseTo(60);
  expect(action).toHaveAttribute('data-active');
  // Changing horizontal bounds and scroll does not move the action.
  rows[0].getBoundingClientRect = () => bounds(-200,20,800,50);
  container.scrollLeft = 200;
  syncInstrumentActions(container,table,layer);
  expect(parseFloat(action.style.top)).toBeCloseTo(60);
  expect(action).not.toHaveAttribute('data-active');
  // Expanded/reordered rows update the vertical group center.
  rows[0].getBoundingClientRect = () => bounds(0,60,800,90);
  rows[1].getBoundingClientRect = () => bounds(0,90,800,140);
  rows[1].dataset.rangeSelected = 'true';
  syncInstrumentActions(container,table,layer);
  expect(parseFloat(action.style.top)).toBeCloseTo(100);
  expect(action).toHaveAttribute('data-active');
  const band = layer.querySelector('.instrument-action-band');
  expect(band).toHaveAttribute('data-cell-selected');
  expect(band.style.getPropertyValue('--instrument-function-color')).toBe('#abcd00');
  expect(parseFloat(band.style.top)).toBeCloseTo(60);
  expect(parseFloat(band.style.height)).toBeCloseTo(80);
});

it('keeps tall groups reachable and hides actions outside the visible rows or after removal', () => {
  const {container,table,layer,action,rows,bounds} = setup();
  rows[0].getBoundingClientRect = () => bounds(0,-100,400,50);
  rows[1].getBoundingClientRect = () => bounds(0,50,400,500);
  syncInstrumentActions(container,table,layer);
  expect(action.style.top).toBe('80px'); // between sticky header and scrollbar
  rows[0].getBoundingClientRect = () => bounds(0,-100,400,-50);
  rows[1].getBoundingClientRect = () => bounds(0,-50,400,10);
  syncInstrumentActions(container,table,layer);
  expect(action.hidden).toBe(true);
  rows[0].remove(); rows[1].remove();
  syncInstrumentActions(container,table,layer);
  expect(action.hidden).toBe(true);
});

it('reveals actions on hover without measuring rows again', () => {
  const {container,table,layer,action,rows} = setup();
  syncInstrumentActions(container,table,layer);
  const measure = vi.spyOn(rows[0], 'getBoundingClientRect');
  updateInstrumentActionHover(layer,{x:110,y:60});
  expect(action).toHaveAttribute('data-active');
  updateInstrumentActionHover(layer);
  expect(action).not.toHaveAttribute('data-active');
  expect(measure).not.toHaveBeenCalled();
});

it('extends header shading and the winning measurement-area border into the action gutter', () => {
  const {container,table,layer,rows,bounds} = setup();
  const header = table.tHead.rows[0].cells[0];
  header.style.cssText = 'background-color:rgb(20, 30, 40);background-image:linear-gradient(red, blue);border-bottom:1px solid rgb(90, 100, 110);position:sticky;will-change:transform';
  const area = table.tBodies[0].insertRow(0);
  const cell = area.insertCell();
  cell.style.cssText = 'background-color:rgb(30, 70, 60);border-bottom:1px solid rgb(40, 50, 60);box-shadow:inset 0 1px rgb(60, 120, 100)';
  area.getBoundingClientRect = () => bounds(0,20,400,30);
  rows[0].getBoundingClientRect = () => bounds(0,30,400,50);
  rows[0].cells[0].style.borderTop = '1px solid rgb(90, 100, 110)';
  syncInstrumentActions(container,table,layer);
  const headerPaint = layer.querySelector('.instrument-action-header th');
  expect(headerPaint.style.backgroundImage).toBe(header.style.backgroundImage);
  expect(headerPaint.style.borderBottom).toBe(header.style.borderBottom);
  expect(headerPaint.style.position).toBe('sticky');
  expect(headerPaint.style.willChange).toBe('transform');
  const areaPaint = layer.querySelector('.instrument-action-area td');
  expect(areaPaint.style.backgroundColor).toBe(cell.style.backgroundColor);
  expect(areaPaint.style.boxShadow).toBe(cell.style.boxShadow);
  expect(layer.querySelector('.instrument-action-band td').style.borderTop).toBe(cell.style.borderBottom);
  // Decorative cells remain outside the instrument table and its column model.
  expect(table.querySelector('.instrument-action-paint')).toBeNull();
});
