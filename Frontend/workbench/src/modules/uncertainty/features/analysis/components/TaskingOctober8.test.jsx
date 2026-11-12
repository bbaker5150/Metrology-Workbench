import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { getCollapsedSpecRows, formatRangeToleranceDetail, ResolutionCellInput } from './UncertaintyPanel';

const range = { min: 0, max: 20, unit: 'A', qualifier: { name: 'Frequency', min: 60, max: 60, unit: 'Hz' },
  tolerances: { tmdeUncertaintyDefinition: { id: 'table', kind: 'table', outputUnit: 'A', measurementUnit: 'A', mode: 'tolerance', distribution: '2',
    columns: [{ id: 'u' }], rows: [{ point: 20, values: { u: { value: .005 } } }] } } };

it('shows the matching tabular spec at a point, absence of a match, and a generic overview label', () => {
  expect(getCollapsedSpecRows(range)).toEqual(['Tabular TMDE uncertainty']);
  expect(getCollapsedSpecRows(range, { value: 20, unit: 'A' })).toEqual(['±0.005 A (Table)']);
  expect(getCollapsedSpecRows(range, { value: 20000, unit: 'mA' })).toEqual(['±0.005 A (Table)']);
  expect(getCollapsedSpecRows(range, { value: 19, unit: 'A' })).toEqual(['Tabular – No matching points']);
  expect(formatRangeToleranceDetail(range, { value: 20, unit: 'A' }, ['Frequency'])).toContain('Frequency: 60 Hz');
  expect(formatRangeToleranceDetail(range, { value: 20, unit: 'A' })).toContain('Qualifier: 60 Hz');
  expect(formatRangeToleranceDetail(range, { value: 20, unit: 'A' })).toContain('±0.005 A (Table)');
});

it('renders imported numeric resolutions in decimal form before the first edit', () => {
  render(<ResolutionCellInput value={1e-7} unit="V" />);
  expect(screen.getByRole('button')).toHaveTextContent('0.0000001 V');
});

it('formats computed point tolerances in their output unit using the active range resolution or four significant digits', () => {
  const tmdeUncertaintyDefinition = { kind: 'equation', equation: 'x / 7', pointVariable: 'x', variables: {},
    columns: [{ id: 'u' }], mode: 'standard', measurementUnit: 'V', outputUnit: 'V' };
  const tolerance = { tmdeUncertaintyDefinition };
  const point = { value: 1, unit: 'V' };
  const resolutionRange = { unit: 'V', resolution: 10, resolutionUnit: 'mV' };
  expect(getCollapsedSpecRows(tolerance, point, resolutionRange)).toEqual(['±0.14 V (Eq.)']);
  expect(getCollapsedSpecRows(tolerance, point, { resolution: 1, unit: 'A' })).toEqual(['±0.1429 V (Eq.)']);
  expect(getCollapsedSpecRows(tolerance, { value: 0.001, unit: 'V' }, resolutionRange)).toEqual(['±0.0001429 V (Eq.)']);
  const limits = { ...tmdeUncertaintyDefinition, mode: 'limits', lowerEquation: '-x / 7', upperEquation: 'x / 3' };
  expect(getCollapsedSpecRows({ tmdeUncertaintyDefinition: limits }, point, resolutionRange)).toEqual(['-0.14 to 0.33 V (Eq.)']);
});

it('includes the entire free-text qualifier path with renamed columns in budget menu details', () => {
 const qualified = {...range, qualifier: {text:'100 Hz – 1 kHz', qualifier:{text:'90 days'}}};
 const detail = formatRangeToleranceDetail(qualified, {value:20,unit:'A'}, ['Frequency band','Calibration interval']);
 expect(detail).toContain('Frequency band: 100 Hz – 1 kHz');
 expect(detail).toContain('Calibration interval: 90 days');
 expect(detail).toContain('±0.005 A (Table)');
});
