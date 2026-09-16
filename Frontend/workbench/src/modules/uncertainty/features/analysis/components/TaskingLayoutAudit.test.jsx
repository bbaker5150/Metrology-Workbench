import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import UncertaintyPanel, { InlineDistributionCell } from './UncertaintyPanel';

it('keeps one-range instruments as one named, unindented point-range tile', () => {
  const tmde = { id: 't', tag: 'W2', description: 'Diagnostic Equipment', instrument: { model: 'MD1217', functions: [
    { name: 'Voltage', unit: 'V', ranges: [{ id: 'r', min: 1, max: 1, unit: 'V', tolerances: { floor: { low: -.1, high: .1, unit: 'V', distribution: '1.732' } } }] },
  ] } };
  const point = { id: 'p', measurementType: 'direct', testPointInfo: { parameter: { name: 'Voltage', value: 1, unit: 'V' } }, components: [] };
  const update = vi.fn();
  render(<UncertaintyPanel testPointData={point} sessionData={{ id: 's', uuts: [], tmdes: [tmde], testPoints: [point], measurementAreas: [], uncReq: {} }}
    uutNominal={point.testPointInfo.parameter} tmdeTolerancesData={[]} onUpdateTestPoint={update}
    calcResults={{ combined_uncertainty: 0, expanded_uncertainty: 0, k_value: 2, effective_dof: Infinity }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add component to budget' }));
  const tile = within(document.querySelector('.budget-tmde-picker-menu')).getByRole('button', { name: /^\(W2\) MD1217 Diagnostic Equipment/ });
  expect(tile).toHaveTextContent('1 V | ± 0.1 V | Rectangular');
  expect(tile).not.toHaveTextContent('1 to 1');
  expect(tile.querySelector('.budget-tmde-picker-range-mark')).toBeNull();
  expect(document.querySelector('.budget-tmde-picker-instrument-name')).toBeNull();
  fireEvent.click(tile);
  expect(update.mock.calls.at(-1)[0].components[0]).toMatchObject({ tmdeBudgetSourceId: 't', tmdeBudgetRangeId: 'r' });
});

it('returns distribution selection focus to its field for subsequent Tab navigation', async () => {
  const change = vi.fn();
  render(<table><tbody><tr><td><InlineDistributionCell divisor='1.732' onChange={change} /></td><td><input aria-label='Next field' /></td></tr></tbody></table>);
  fireEvent.click(screen.getByTitle('Edit distribution'));
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1));
  await waitFor(() => expect(document.activeElement).toHaveAttribute('role', 'option'));
  fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
  fireEvent.keyDown(document.activeElement, { key: 'Enter' });
  expect(change).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Spec band distribution' })).toHaveFocus();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  fireEvent.keyDown(document.activeElement, { key: 'Tab' });
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Next field' })).toHaveFocus());
});
