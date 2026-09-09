import { describe, expect, it } from 'vitest';
import { getBudgetTmdeResolutionOptions } from './UncertaintyPanel';

const dmm = { id: 'dmm', instrument: { functions: [
  { id: 'a', name: 'Current', ranges: [{ id: 'amps', min: 0, max: 10, unit: 'A', resolution: 0.01 }] },
  { id: 'v', name: 'DC Voltage', ranges: [
    { id: 'blank', min: 0, max: 100, unit: 'V', resolution: '' },
    { id: 'volts', min: 0, max: 100, unit: 'V', measuringResolution: '', resolution: 0.1 },
    { id: 'large', min: 0, max: 1000, unit: 'V', resolution: 1 },
  ] },
] } };
describe('TMDE resolution picker', () => {
  it('offers all compatible resolution ranges without requiring accuracy terms or matching the input name', () => {
    const options = getBudgetTmdeResolutionOptions([dmm], { name: 'V_in', value: 50, unit: 'V' });
    expect(options.map(o => o.value)).toEqual([0.1, 1]);
    expect(new Set(options.map(o => o.rangeKey)).size).toBe(2);
  });
  it('excludes incompatible dimensions and out-of-range specifications', () => {
    expect(getBudgetTmdeResolutionOptions([dmm], { value: 500, unit: 'V' }).map(o => o.value)).toEqual([1]);
    expect(getBudgetTmdeResolutionOptions([dmm], { value: 5, unit: 'm' })).toEqual([]);
  });
});
