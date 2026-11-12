import { afterEach, expect, it, vi } from 'vitest';
import { updatePointRowHover } from './pointRowHover';

afterEach(() => document.body.replaceChildren());

function fixture() {
  const list = document.createElement('div');
  const area = document.createElement('div');
  area.className = 'measurement-area-points';
  list.append(area); document.body.append(list);
  let top = 0;
  const rows = [30, 45, 60, 35, 40, 30, 50].map((height, index) => {
    const row = document.createElement('div'); row.className = 'point-grid-item';
    const start = top; top += height;
    row.getBoundingClientRect = () => ({ top: start, bottom: start + height, height });
    const groups = { uut: index < 5 ? 'first' : 'second', section: index < 2 ? 'a' : index < 5 ? 'b' : 'c' };
    for (const [column, group] of Object.entries(groups)) {
      const cell = document.createElement('span');
      cell.className = 'point-grouped-cell'; cell.dataset.run = `${column}:${group}`;
      row.append(cell);
    }
    area.append(row); return row;
  });
  const highlighted = () => rows.map(row => [...row.children].filter(cell => cell.classList.contains('is-run-hovered')).map(cell => cell.dataset.run));
  return { list, area, rows, highlighted };
}

it('highlights all merged cells belonging to the child row and changes groups independently', () => {
  const { list, rows, highlighted } = fixture();
  updatePointRowHover(list, rows[1]);
  expect(highlighted()).toEqual([['uut:first', 'section:a'], ['uut:first', 'section:a'], ['uut:first'], ['uut:first'], ['uut:first'], [], []]);
  updatePointRowHover(list, rows[3]);
  expect(highlighted()).toEqual([['uut:first'], ['uut:first'], ['uut:first', 'section:b'], ['uut:first', 'section:b'], ['uut:first', 'section:b'], [], []]);
  updatePointRowHover(list, rows[6]);
  expect(highlighted()).toEqual([[], [], [], [], [], ['uut:second', 'section:c'], ['uut:second', 'section:c']]);
  updatePointRowHover(list, null);
  expect(highlighted()).toEqual([[], [], [], [], [], [], []]);
});

it('uses the physical row under a spanning label instead of its first-row DOM owner', () => {
  const { list, rows, highlighted } = fixture();
  updatePointRowHover(list, rows[0]);
  updatePointRowHover(list, rows[0], 95, true);
  expect(highlighted()).toEqual([['uut:first'], ['uut:first'], ['uut:first', 'section:b'], ['uut:first', 'section:b'], ['uut:first', 'section:b'], [], []]);
  updatePointRowHover(list, rows[0], 300, true);
  expect(highlighted()).toEqual([[], [], [], [], [], [], []]);
});

it('avoids run rescans while moving through rows that share the same merged cells', () => {
  const { list, rows } = fixture();
  updatePointRowHover(list, rows[0]);
  const query = vi.spyOn(list, 'querySelectorAll');
  updatePointRowHover(list, rows[0]);
  updatePointRowHover(list, rows[1]);
  expect(query).not.toHaveBeenCalled();
  query.mockRestore();
});

it('refreshes a regrouped or replaced row rather than keeping stale run highlights', () => {
  const { list, rows } = fixture();
  updatePointRowHover(list, rows[1]);
  rows[1].lastElementChild.dataset.run = 'section:b';
  updatePointRowHover(list, rows[1]);
  expect(rows[0].lastElementChild).not.toHaveClass('is-run-hovered');
  expect(rows[2].lastElementChild).toHaveClass('is-run-hovered');
  const replacement = rows[1].cloneNode(true);
  [...replacement.children].forEach(cell => cell.classList.remove('is-run-hovered'));
  rows[1].replaceWith(replacement);
  updatePointRowHover(list, replacement);
  [...replacement.children].forEach(cell => expect(cell).toHaveClass('is-run-hovered'));
});
