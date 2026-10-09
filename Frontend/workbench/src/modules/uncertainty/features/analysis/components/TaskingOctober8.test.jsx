import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { getCollapsedSpecRows, formatRangeToleranceDetail, ResolutionCellInput } from './UncertaintyPanel';

const range = { min: 0, max: 20, unit: 'A', qualifier: { name: 'Frequency', min: 60, max: 60, unit: 'Hz' },
  tolerances: { tmdeUncertaintyDefinition: { id: 'table', kind: 'table', outputUnit: 'A', measurementUnit: 'A', mode: 'tolerance', distribution: '2',
    columns: [{ id: 'u' }], rows: [{ point: 20, values: { u: { value: .005 } } }] } } };

it('shows the matching tabular spec at a point, absence of a match, and a generic overview label', () => {
  expect(getCollapsedSpecRows(range)).toEqual(['Tabular TMDE uncertainty']);
  expect(getCollapsedSpecRows(range, { value: 20, unit: 'A' })).toEqual(['Tabular – ± 0.005 A']);
  expect(getCollapsedSpecRows(range, { value: 20000, unit: 'mA' })).toEqual(['Tabular – ± 0.005 A']);
  expect(getCollapsedSpecRows(range, { value: 19, unit: 'A' })).toEqual(['Tabular – No matching points']);
  expect(formatRangeToleranceDetail(range, { value: 20, unit: 'A' })).toContain('Frequency: 60 Hz');
  expect(formatRangeToleranceDetail(range, { value: 20, unit: 'A' })).toContain('Tabular – ± 0.005 A');
});

it('renders imported numeric resolutions in decimal form before the first edit', () => {
  render(<ResolutionCellInput value={1e-7} unit="V" />);
  expect(screen.getByRole('button')).toHaveTextContent('0.0000001 V');
});

it('includes the entire free-text qualifier path with renamed columns in budget menu details', () => {
 const qualified = {...range, qualifier: {text:'100 Hz – 1 kHz', qualifier:{text:'90 days'}}};
 const detail = formatRangeToleranceDetail(qualified, {value:20,unit:'A'}, ['Frequency band','Calibration interval']);
 expect(detail).toContain('Frequency band: 100 Hz – 1 kHz');
 expect(detail).toContain('Calibration interval: 90 days');
 expect(detail).toContain('Tabular – ± 0.005 A');
});
