import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import UncertaintyPanel from './UncertaintyPanel';
import { buildAcShuntBudget } from '../../../utils/acShuntBudget';
import { generic5790, nominalY5020Resolution } from '../../../utils/testFixtures/generic5790';

vi.mock('plotly.js-dist', () => ({ default: {} }));
beforeEach(() => localStorage.clear());
function setup(viewMode = 'point', simplifyOverview = true) {
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
  const panel = (mode = viewMode, data = session) => <UncertaintyPanel testPointData={{ ...point, viewMode: mode }} sessionData={data}
    onSessionSave={save} uutNominal={point.testPointInfo.parameter} tmdeTolerancesData={[]} />;
  const rendered = render(panel());
  if (viewMode === 'session' && simplifyOverview) {
    for (const kind of ['uut', 'tmde']) toggleSimplified(kind);
  }
  return { ...rendered, session, save, panel };
}
const specifications = table => table.querySelector('.instrument-library-specifications');
it.each(['session','point'])('expands and collapses simplified instrument accordions in %s view',viewMode=>{
  const {container}=setup(viewMode);
  for(const kind of ['uut','tmde']){
    const table=container.querySelector(`[data-tour="${kind}-table"]`);
    fireEvent.click(table.querySelector('.instrument-specifications-toggle'));
    expect(table.querySelectorAll('[data-range-id]').length).toBeGreaterThan(0);
    fireEvent.click(table.querySelector('.instrument-specifications-toggle'));
    expect(table.querySelectorAll('[data-range-id]')).toHaveLength(0);
  }
});
function toggleSimplified(kind) {
  fireEvent.click(screen.getByRole('button', { name: `${kind.toUpperCase()} table view` }));
  const menu = screen.getByRole('group', { name: `${kind.toUpperCase()} table view options` });
  fireEvent.click(within(menu).getByRole('checkbox', { name: 'Show simplified view' }));
  fireEvent.pointerDown(document.body);
}

it('offers resizable simplified Overview tables and restores their choices independently of the budget', () => {
  const { container, rerender, panel, session } = setup('session', false);
  for (const kind of ['uut', 'tmde']) {
    const table = container.querySelector(`[data-tour="${kind}-table"]`);
    expect(table.querySelectorAll('[data-range-id]').length).toBeGreaterThan(0);
    toggleSimplified(kind);
    expect([...table.querySelectorAll('thead th')].map(th => th.getAttribute('aria-label'))).toEqual(['Description', 'Sync']);
    expect(table.querySelectorAll('[data-range-id]')).toHaveLength(0);
    expect(table.querySelector('.instrument-area-section-row td').colSpan).toBe(2);
    const width = table.querySelector('col').style.width;
    fireEvent.keyDown(within(table).getByRole('button', { name: 'Resize Description column' }), { key: 'ArrowRight' });
    expect(table.querySelector('col').style.width).not.toBe(width);
  }
  rerender(panel('point'));
  toggleSimplified('uut');
  expect(container.querySelector('[data-tour="uut-table"] [data-range-id]')).not.toBeNull();
  rerender(panel('session'));
  expect(container.querySelectorAll('.instrument-simplified-row')).toHaveLength(2);
  expect(container.querySelectorAll('[data-range-id]')).toHaveLength(0);
  rerender(panel('session', { ...session, id: 'other-overview' }));
  expect(container.querySelectorAll('.instrument-simplified-row')).toHaveLength(0);
  rerender(panel('session'));
  expect(container.querySelectorAll('.instrument-simplified-row')).toHaveLength(2);
});

it('expands only the requested Overview instrument with the shared button beside its editable description', () => {
  const { container, rerender, panel, session } = setup('session');
  const data = { ...session, tmdes: [...session.tmdes, { ...session.tmdes[0], id: 'second-reader' }] };
  rerender(panel('session', data));
  const table = container.querySelector('[data-tour="tmde-table"]');
  fireEvent.click(specifications(table));
  const control = specifications(table);
  expect(control).toHaveAttribute('aria-expanded', 'true');
  expect(control.parentElement).toHaveClass('cell-description', 'instrument-library-expanded-description');
  expect(table.querySelectorAll('[data-range-id]').length).toBeGreaterThan(0);
  const other = table.querySelector('tr[data-instrument-id="second-reader"]');
  expect(other).toHaveClass('instrument-simplified-row');
  expect(other.querySelector('.cell-description').colSpan).toBe(table.querySelectorAll('thead th').length - 1);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(table.querySelectorAll('thead th')).toHaveLength(2);
  expect(table.querySelectorAll('[data-range-id]')).toHaveLength(0);
  expect(table.querySelectorAll('.instrument-simplified-row')).toHaveLength(2);
});

it.each(['uut', 'tmde'])('opens a newly added %s for editing while Overview is simplified', kind => {
  const { container, rerender, panel, save } = setup('session');
  const table = container.querySelector(`[data-tour="${kind}-table"]`);
  fireEvent.click(within(table).getByRole('button', { name: `Add ${kind.toUpperCase()} to this measurement area` }));
  const updated = save.mock.calls.at(-1)[0], item = updated[kind === 'uut' ? 'uuts' : 'tmdes'].at(-1);
  rerender(panel('session', updated));
  const added = table.querySelector(`tr[data-instrument-id="${item.id}"]`);
  expect(added).toHaveAttribute('data-range-id');
  expect(specifications(added)).toHaveAttribute('aria-expanded', 'true');
  expect(added.querySelector('.cell-description')).toHaveClass('instrument-library-expanded-description');
  expect(table.querySelector('.instrument-simplified-row')).not.toBeNull();
});

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

it.each(['point', 'session'])('commits a focused specification edit before Escape collapses the tables in %s view', viewMode => {
  const { container, save } = setup(viewMode);
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

it.each(['point', 'session'])('dismisses an open view menu before collapsing specifications in %s view', viewMode => {
  const { container } = setup(viewMode);
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

it.each(['point', 'session'])('leaves Escape to an editor outside the instrument tables in %s view', viewMode => {
  const { container } = setup(viewMode);
  const table = container.querySelector('[data-tour="tmde-table"]');
  fireEvent.click(specifications(table));
  const field = document.createElement('input');
  container.querySelector('.detailed-view-section-layout, .configuration-panel').appendChild(field);
  field.focus();
  expect(fireEvent.keyDown(field, { key: 'Escape' })).toBe(true);
  expect(field).toHaveFocus();
  expect(table.querySelectorAll('[data-range-id]').length).toBeGreaterThan(0);
});
