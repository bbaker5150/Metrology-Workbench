import { expect, it } from 'vitest';
import { addRangeToItem, applyItemRangePatch, getItemRangeTolerance, pasteRangeIntoItem, removeRangeFromItem, resolveUutRangeHelper } from './UncertaintyPanel';

// The Risk 8 PDF stores instance ranges alongside an embedded library definition.
const fixture = () => {
  const range = { id: 'range', min: 0, max: 30, unit: 'V', tolerances: { floor: { high: 1, unit: 'V' } } };
  return { id: 'uut', ranges: [structuredClone(range)], instrument: { functions: [{ id: 'fn', name: 'Voltage', ranges: [range] }] } };
};
const visible = item => resolveUutRangeHelper(item, {}, null, null).ranges;

it('adds, edits and deletes the instance ranges that the imported session actually displays', () => {
  const original = fixture();
  const { item: added, newRangeId } = addRangeToItem(original, 'range');
  expect(visible(added).map(r => r.id)).toEqual(['range', newRangeId]);
  expect(added.instrument).toBe(original.instrument);
  const edited = applyItemRangePatch(added, newRangeId, { min: 30, max: 60 });
  expect(visible(edited)[1]).toMatchObject({ min: 30, max: 60 });
  expect(visible(removeRangeFromItem(edited, newRangeId)).map(r => r.id)).toEqual(['range']);
  const cleared = removeRangeFromItem(original, 'range');
  expect(visible(cleared)).toHaveLength(1);
  expect(visible(cleared)[0]).toMatchObject({ min: '', max: '' });
});

it('reads and patches instance tolerances without silently reverting to the library copy', () => {
  const original = fixture();
  original.ranges[0].tolerances.floor.high = 7;
  expect(getItemRangeTolerance(original, 'range').floor.high).toBe(7);
  const edited = applyItemRangePatch(original, 'range', { tolerances: { floor: { high: 9, unit: 'V' } } });
  expect(getItemRangeTolerance(edited, 'range').floor.high).toBe(9);
  expect(edited.instrument.functions[0].ranges[0].tolerances.floor.high).toBe(1);
});

it('pastes into the same instance list as add and preserves its position', () => {
  const original = fixture();
  const { item, newRangeId } = pasteRangeIntoItem(original, 'range', { id: 'copied', min: 40, max: 50, unit: 'V' });
  expect(visible(item).map(r => r.id)).toEqual(['range', newRangeId]);
  expect(visible(item)[1]).toMatchObject({ min: 40, max: 50 });
  expect(item.instrument).toBe(original.instrument);
});
