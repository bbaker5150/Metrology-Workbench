import { expect, it, vi } from 'vitest';
import { buildConsecutiveSidebarCellGroups, buildSidebarCellGroups } from './sidebarCellGroups';

it('groups a large shunt session in one pass and shares the run identity list', () => {
  const points = Array.from({ length: 3000 }, (_, id) => ({ id, uut: 'shunt' }));
  const value = vi.fn(point => point.uut);
  const groups = buildConsecutiveSidebarCellGroups(points, value);
  expect(value).toHaveBeenCalledTimes(points.length);
  expect(groups[0]).toMatchObject({ isStart: true, isEnd: false, span: 3000 });
  expect(groups.at(-1)).toMatchObject({ isStart: false, isEnd: true, span: 3000 });
  expect(groups[1500].pointIds).toBe(groups[0].pointIds);
  expect(groups[1500].key).toBe(groups[0].key);
});

it('preserves blank inputs, merges empty diagnostics, and splits the member being edited', () => {
  const points = Array.from({ length: 5 }, (_, id) => ({ id, associatedUutIds: ['uut'], section: id < 3 ? 'A' : '',
    testPointInfo: { qualifier: { value: 60, unit: 'Hz' } } }));
  const format = q => `${q.value} ${q.unit}`;
  const groups = buildSidebarCellGroups(points, { 2: ['warning'] }, { field: 'qualifier', pointId: 2 }, format);
  expect(groups.map(group => group.warningIcons.span)).toEqual([2, 2, 1, 2, 2]);
  expect(groups.map(group => group.section.span)).toEqual([3, 3, 3, 1, 1]);
  expect(groups.map(group => group.qualifier.span)).toEqual([2, 2, 1, 2, 2]);
  const saved = points.map(point => point.id === 2 ? { ...point, testPointInfo: { qualifier: { value: 400, unit: 'Hz' } } } : point);
  expect(buildSidebarCellGroups(saved, {}, null, format).map(group => group.qualifier.span)).toEqual([2, 2, 1, 2, 2]);
  expect(buildSidebarCellGroups(points, {}, null, format)[0].qualifier.span).toBe(5);
});
