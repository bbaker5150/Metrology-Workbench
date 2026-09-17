import { describe, expect, it } from 'vitest';
import { reorderInstrumentRows, instrumentDropPosition } from './instrumentReorder';

describe.each(['uut', 'tmde'])('%s instrument reorder', kind => {
  const listKey = kind === 'uut' ? 'uuts' : 'tmdes';
  const a = { id: 'a', measurementAreaNames: ['Voltage', 'Other'], ranges: [{ id: 'a-range' }] };
  const b = { id: 'b', measurementAreaNames: ['Voltage'] };
  const c = { id: 'c', measurementAreaNames: ['Voltage'] };
  const unrelated = { id: 'unrelated', measurementAreaNames: ['Temperature'] };
  const session = { [listKey]: [a, unrelated, b, c], testPoints: [{ components: [{ sourceTmdeId: 'a' }] }] };
  it('moves above and below a target without changing identities or unrelated slots', () => {
    const down = reorderInstrumentRows(session, kind, 'voltage', ['a'], 'c', 'after');
    expect(down[listKey]).toEqual([b, unrelated, c, a]);
    expect(down[listKey][3]).toBe(a);
    expect(down.testPoints).toBe(session.testPoints);
    const up = reorderInstrumentRows(down, kind, 'voltage', ['a'], 'b', 'before');
    expect(up[listKey]).toEqual(session[listKey]);
    expect(a.measurementAreaNames).toEqual(['Voltage', 'Other']);
  });
  it('moves a selection as a stable block and treats a header as the end of the area', () => {
    expect(reorderInstrumentRows(session, kind, 'voltage', ['c', 'a'], 'b', 'before')[listKey])
      .toEqual([a, unrelated, c, b]);
    expect(reorderInstrumentRows(session, kind, 'voltage', ['a', 'b'], null)[listKey])
      .toEqual([c, unrelated, a, b]);
  });
  it('does not save on self drops, missing targets or unchanged order', () => {
    expect(reorderInstrumentRows(session, kind, 'voltage', ['a', 'b'], 'b')).toBe(session);
    expect(reorderInstrumentRows(session, kind, 'voltage', ['a'], 'missing')).toBe(session);
    expect(reorderInstrumentRows(session, kind, 'voltage', ['a'], 'b', 'before')).toBe(session);
  });
});

it('uses the full expanded instrument group when deciding before/after', () => {
  const table = document.createElement('table');
  table.innerHTML = '<tbody><tr data-instrument-id="a" data-measurement-area="voltage"></tr><tr data-instrument-id="a" data-measurement-area="voltage"></tr><tr data-instrument-id="a" data-measurement-area="other"></tr></tbody>';
  [...table.rows].forEach((row, i) => { row.getBoundingClientRect = () => ({ top: i * 40, bottom: (i + 1) * 40 }); });
  expect(instrumentDropPosition({ currentTarget: table.rows[0], clientY: 30 })).toBe('before');
  expect(instrumentDropPosition({ currentTarget: table.rows[1], clientY: 50 })).toBe('after');
});
