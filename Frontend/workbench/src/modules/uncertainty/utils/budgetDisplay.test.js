import { describe, expect, it } from 'vitest';
import { budgetUncertaintyDisplay, canDisplayRelativeUncertainty } from './budgetDisplay';

describe('budget uncertainty display', () => {
  it.each([10, -10])('references ppm to the magnitude of %s A', value => {
    expect(budgetUncertaintyDisplay({ value: 20, unit: 'µA' }, { value, unit: 'A' }, 'ppm').value).toBeCloseTo(2);
  });
  it('handles prefixed points and mixed absolute/relative sources', () => {
    const point = { value: 10000, unit: 'mA' };
    expect(budgetUncertaintyDisplay({ value: 2, unit: 'ppm' }, point, 'absolute').value).toBeCloseTo(.02);
    expect(budgetUncertaintyDisplay({ value: .0002, unit: '%' }, point, 'ppm').value).toBeCloseTo(2);
    expect(budgetUncertaintyDisplay({ value: 2000, unit: 'ppb' }, point, 'ppm').value).toBeCloseTo(2);
  });
  it.each([0, '', null, undefined, Infinity, 'invalid'])('rejects undefined relative references: %s', value => {
    expect(canDisplayRelativeUncertainty({ value, unit: 'A' })).toBe(false);
    expect(budgetUncertaintyDisplay({ value: 1, unit: 'A' }, { value, unit: 'A' }, 'ppm').value).toBeNull();
  });
  it('preserves missing and zero uncertainties without fabricating values', () => {
    const point = { value: 10, unit: 'A' };
    expect(budgetUncertaintyDisplay({ value: null, unit: 'A' }, point, 'ppm').value).toBeNull();
    expect(budgetUncertaintyDisplay({ value: 0, unit: 'A' }, point, 'ppm').value).toBe(0);
    expect(budgetUncertaintyDisplay({ value: 1, unit: 'V' }, point, 'ppm').value).toBeNull();
  });
});
