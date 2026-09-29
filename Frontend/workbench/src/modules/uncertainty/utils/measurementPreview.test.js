import { expect, it } from 'vitest';
import { measurementPreview } from './measurementPreview';

const point = (unit, inputUnits = ['', '']) => ({ equationString: 'I * V',
  variableNominals: { I: { value: 2, unit: inputUnits[0] }, V: { value: 3, unit: inputUnits[1] } },
  testPointInfo: { parameter: { value: 6, unit } } });

it('shows a numeric preview for missing or incompatible units without validating them', () => {
  expect(measurementPreview(point('A'))).toEqual({ value: 6, unitsMatch: false });
  expect(measurementPreview(point('A', ['A', 'V']))).toEqual({ value: 6, unitsMatch: false });
});
it('converts a compatible result into the target prefix', () => {
  expect(measurementPreview(point('mW', ['A', 'V']))).toEqual({ value: 6000, unitsMatch: true });
});
it('keeps the authoritative calculated value for compatible units', () => {
  expect(measurementPreview(point('W', ['A', 'V']), 7)).toEqual({ value: 7, unitsMatch: true });
});
it('does not treat an empty input as zero', () => {
  const p = point('W'); p.variableNominals.I.value = '';
  expect(measurementPreview(p).value).toBeNull();
});
