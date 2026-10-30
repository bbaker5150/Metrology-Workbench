import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import UncertaintyPanel from './UncertaintyPanel';
import { buildAcShuntBudget } from '../../../utils/acShuntBudget';
import { generic5790, nominalY5020Resolution } from '../../../utils/testFixtures/generic5790';

vi.mock('plotly.js-dist', () => ({ default: {} }));
beforeEach(() => localStorage.clear());
function setup() {
  const ti = { id: 'ti', type: 'uut', scope: 'validated', manufacturer: 'Fluke', model: 'Y5020 · TI',
    functions: [{ id: 'current', name: 'Current', unit: 'A', ranges: [{ id: '10A', min: 10, max: 10, unit: 'A',
      qualifier: { value: 1000, unit: 'Hz', isSingleValue: true },
      tolerances: { reading: { high: 100, low: -100, unit: 'ppm', symmetric: true, distribution: 'not_set' } } }] }] };
  const { session } = buildAcShuntBudget({ id: 1, name: 'Simplified tables', generic5790Instrument: generic5790,
    instruments: { test_instrument_model: 'Y5020', test_instrument_serial: 'TI' },
    points: [{ current: 10, frequency: 1000, readerResolution: nominalY5020Resolution(10),
      analytics: { pair_delta_uut_ppm: 1, pair_type_a_uncertainty_ppm: 2, n_pairs_used: 5 } }],
  }, { instruments: [ti] });
  session.id = 'simplified-controls';
  const point = session.testPoints[0], save = vi.fn();
  const rendered = render(<UncertaintyPanel testPointData={{ ...point, viewMode: 'point' }} sessionData={session}
    onSessionSave={save} uutNominal={point.testPointInfo.parameter} tmdeTolerancesData={[]} />);
  return { ...rendered, session, save };
}
const specifications = table => table.querySelector('.instrument-library-specifications');

it('uses the normal badge layout and area color and places expanded controls beside the description', () => {
  const { container } = setup();
  for (const kind of ['uut', 'tmde']) {
    const table = container.querySelector(`[data-tour="${kind}-table"]`);
    const badge = table.querySelector('.instrument-usage-badge');
    expect(badge).toHaveTextContent(kind === 'uut' ? 'Active UUT' : 'In Budget');
    expect(badge.parentElement).toHaveClass('uut-description-content');
    const color = badge.style.getPropertyValue('--instrument-function-color');
    expect(color).not.toBe('');
    expect(color).toBe(badge.closest('tr').style.getPropertyValue('--instrument-function-color'));
    fireEvent.click(specifications(table));
    const control = specifications(table);
    expect(control).toHaveAttribute('aria-expanded', 'true');
    expect(control.parentElement).toHaveClass('cell-description', 'instrument-library-expanded-description');
    expect(control.closest('.uut-description-content')).toBeNull();
    expect(table.querySelector('.instrument-usage-badge').style.getPropertyValue('--instrument-function-color')).toBe(color);
  }
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(container.querySelectorAll('[data-range-id]')).toHaveLength(0);
  expect(container.querySelectorAll('.instrument-simplified-row')).toHaveLength(2);
});

it('commits a focused specification edit before Escape collapses the tables', () => {
  const { container, save } = setup();
  const table = container.querySelector('[data-tour="tmde-table"]');
  fireEvent.click(specifications(table));
  const row = table.querySelector('[data-range-id="fluke-5790b-generic-medium-slow-2.2"]');
  fireEvent.click(row.querySelector('[title="Edit resolution"]'));
  const input = row.querySelector('.inline-resolution-input');
  input.focus();
  fireEvent.change(input, { target: { value: '0.0000002' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(table.querySelectorAll('[data-range-id]')).toHaveLength(0);
  const reader = save.mock.calls.at(-1)[0].tmdes[0].instrument;
  expect(Number(reader.functions[0].ranges[1].resolution)).toBe(2e-7);
});

it('dismisses an open view menu before collapsing specifications', () => {
  const { container } = setup();
  const table = container.querySelector('[data-tour="tmde-table"]');
  fireEvent.click(specifications(table));
  fireEvent.click(screen.getByRole('button', { name: 'TMDE table view' }));
  const menu = screen.getByRole('group', { name: 'TMDE table view options' });
  fireEvent.keyDown(within(menu).getByRole('checkbox', { name: 'Show simplified view' }), { key: 'Escape' });
  expect(screen.queryByRole('group', { name: 'TMDE table view options' })).not.toBeInTheDocument();
  expect(table.querySelectorAll('[data-range-id]').length).toBeGreaterThan(0);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(table.querySelectorAll('[data-range-id]')).toHaveLength(0);
});

it('leaves Escape to an editor outside the instrument tables', () => {
  const { container } = setup();
  const table = container.querySelector('[data-tour="tmde-table"]');
  fireEvent.click(specifications(table));
  const field = document.createElement('input');
  container.querySelector('.detailed-view-section-layout').appendChild(field);
  field.focus();
  expect(fireEvent.keyDown(field, { key: 'Escape' })).toBe(true);
  expect(field).toHaveFocus();
  expect(table.querySelectorAll('[data-range-id]').length).toBeGreaterThan(0);
});
