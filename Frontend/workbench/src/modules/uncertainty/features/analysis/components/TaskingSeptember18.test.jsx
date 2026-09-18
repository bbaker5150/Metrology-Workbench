import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import UncertaintyPanel, { InlineToleranceCell, applyToleranceCaseChange } from './UncertaintyPanel';
import { resolvePointBudgetComponents } from '../../../utils/resolvePointBudgetComponents';
import MeasurementInputBias, { measurementInputBias } from './MeasurementInputBias';
import { biasFixture } from '../../../utils/measurementBias.fixtures';

vi.mock('plotly.js-dist', () => ({ default: {} }));

it('adds a TMDE without an error limit, retains its warning, and resolves a later master edit', () => {
  const range = { id: 'r', unit: 'V', tolerances: {} };
  const tmde = { id: 'tmde', name: 'Reference', ranges: [range], measurementAreaNames: ['Voltage'] };
  const point = { id: 'p', measurementType: 'direct', testPointInfo: { parameter: { name: 'Voltage', value: 100, unit: 'V' } }, components: [] };
  const session = { id: 's', uuts: [], tmdes: [tmde], testPoints: [point], measurementAreas: [], uncReq: {} };
  const update = vi.fn();
  render(<UncertaintyPanel testPointData={point} sessionData={session} uutNominal={point.testPointInfo.parameter}
    tmdeTolerancesData={[]} onUpdateTestPoint={update} calcResults={{ combined_uncertainty: 0, expanded_uncertainty: 0, k_value: 2, effective_dof: Infinity }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add component to budget' }));
  fireEvent.click(within(document.querySelector('.budget-tmde-picker-menu')).getByRole('button', { name: /^Reference/ }));
  const components = update.mock.calls.at(-1)[0].components;
  expect(components).toHaveLength(1);
  expect(components[0].tmdeBudgetRangeId).toBe('r');
  expect(resolvePointBudgetComponents({ ...point, components }, session)[0].pendingReason).toMatch(/error limit/i);
  range.tolerances.floor = { high: 2.5, low: -2.5, unit: 'V', symmetric: true, distribution: '1.732' };
  const resolved = resolvePointBudgetComponents({ ...point, components }, session)[0];
  expect(resolved.pendingReason).toBeFalsy();
  expect(resolved.value_native).toBeCloseTo(2.5 / Math.sqrt(3), 10);
});

it('restores configured bias alongside the saved SS tolerance without showing the greater checkbox', () => {
  const initial = { singleSided: { direction: 'high', measurement: 'known', limit: 10 }, bias: { value: 2, unit: 'V' } };
  function Harness() {
    const [tolerance, setTolerance] = useState(initial);
    return <InlineToleranceCell tolerance={tolerance} activeRange={{ id: 'r', unit: 'V' }} biasRole="uut" editable openRequested
      onCommit={(type, value) => setTolerance(previous => applyToleranceCaseChange(previous, type, value))} />;
  }
  const view = render(<Harness />);
  expect(screen.getByRole('button', { name: 'Bias', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('textbox', { name: 'Range UUT bias' })).toHaveValue('2');
  expect(document.querySelector('.inline-tolerance-term-group')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bias', exact: true }));
  expect(screen.queryByRole('checkbox', { name: 'Whichever is greater' })).toBeNull();
  expect(document.querySelector('.inline-tolerance-term-group')).not.toBeNull();
  view.unmount(); render(<Harness />);
  expect(screen.getByRole('button', { name: 'Bias', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

it('allows selecting a tolerance unit before any range unit is supplied', () => {
  render(<InlineToleranceCell tolerance={{}} activeRange={{ id: 'r' }} editable openRequested onCommit={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Tolerance unit base unit', exact: true })).toBeInTheDocument();
});

it('displays input bias before sensitivity propagation and keeps the output override separate', () => {
  const { point, session } = biasFixture();
  const variable = { symbol: 'V', name: 'Voltage', value: 1, unit: 'V' };
  const bias = measurementInputBias(point, session, variable);
  expect(bias).toBeCloseTo(.01);
  point.measurementBias = { mode: 'manual', value: 500, unit: 'A' };
  expect(measurementInputBias(point, session, variable)).toBeCloseTo(.01);
  const view = render(<MeasurementInputBias point={point} session={session} variable={variable} mode="percent" />);
  expect(screen.getByText('5 %')).toBeInTheDocument();
  view.rerender(<MeasurementInputBias point={point} session={session} variable={variable} mode="adjusted" />);
  expect(screen.getByText('1.01 V')).toBeInTheDocument();
});
