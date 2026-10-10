import { describe, expect, it } from 'vitest';
import { consecutiveCellGroup } from './consecutiveCellGroup';

describe('instrument custom field and qualifier grouping', () => {
  it.each([undefined, null, '', '  ', '\t'])('keeps unset inputs independently editable: %j', value => {
    const rows = [value, value, value];
    rows.forEach((_, index) => {
      expect(consecutiveCellGroup(rows, index, i => rows[i]))
        .toEqual({ value, start: index, end: index + 1, rows: [value] });
    });
  });
  it.each(['Test', 0])('still groups repeated populated values: %j', value => {
    const rows = [value, value, ''];
    expect(consecutiveCellGroup(rows, 0, i => rows[i]))
      .toEqual({ value, start: 0, end: 2, rows: [value, value] });
    expect(consecutiveCellGroup(rows, 1, i => rows[i])).toBeNull();
  });
});
