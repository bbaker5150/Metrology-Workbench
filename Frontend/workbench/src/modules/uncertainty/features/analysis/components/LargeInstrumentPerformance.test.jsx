import React, { Profiler } from 'react';
import { render, fireEvent, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import UncertaintyPanel from './UncertaintyPanel';
import { qualified5790, nominalY5020Resolution } from '../../../utils/testFixtures/generic5790';
import { buildAcShuntBudget } from '../../../utils/acShuntBudget';
import { resolvePointBudgetComponents } from '../../../utils/resolvePointBudgetComponents';

vi.mock('plotly.js-dist', () => ({ default: {} }));

function largeSession() {
  const source = qualified5790.functions[0];
  const ranges = Array.from({ length: 60 }, (_, copy) => source.ranges.map(range => ({ ...range,
    id: copy ? `${range.id}-copy-${copy}` : range.id, qualifierGroupId: `${range.qualifierGroupId}-${copy}`,
  }))).flat();
  const reader = { ...qualified5790, functions: [{ ...source, ranges }] };
  const ti = { id: 'ti', type: 'uut', scope: 'validated', manufacturer: 'Fluke', model: 'Y5020 · TI',
    functions: [{ id: 'current', name: 'Current', unit: 'A', ranges: [{ id: '10A', min: 10, max: 10, unit: 'A',
      qualifier: { value: 1000, unit: 'Hz', isSingleValue: true },
      tolerances: { reading: { high: 100, low: -100, unit: 'ppm', symmetric: true, distribution: 'not_set' } } }] }] };
  const { session } = buildAcShuntBudget({ id: 1, name: 'Large instrument', generic5790Instrument: reader,
    instruments: { test_instrument_model: 'Y5020', test_instrument_serial: 'TI' },
    points: [{ current: 10, frequency: 1000, readerResolution: nominalY5020Resolution(10),
      analytics: { pair_delta_uut_ppm: 1, pair_type_a_uncertainty_ppm: 2, n_pairs_used: 5 } }],
  }, { instruments: [ti] });
  return session;
}

it.each(['session', 'point'])('keeps a 720-spec instrument editable without workspace rerenders on hover in %s view', viewMode => {
  const session = largeSession();
  session.simplifiedInstrumentTables = false;
  const point = session.testPoints[0], save = vi.fn(), commit = vi.fn();
  const start = performance.now();
  const { container } = render(<Profiler id="workspace" onRender={commit}>
    <UncertaintyPanel testPointData={{ ...point, viewMode }} sessionData={session} onSessionSave={save}
      tmdeTolerancesData={[]} uutNominal={point.testPointInfo.parameter}/>
  </Profiler>);
  const mountedMs = performance.now() - start;
  const table = container.querySelector('[data-tour="tmde-table"]');
  const rows = [...table.querySelectorAll('[data-range-id]')];
  expect(rows).toHaveLength(720);
  for (const text of ['90 Days', '1 Year', '2 Years']) expect(table).toHaveTextContent(text);
  commit.mockClear();
  const hoverStart = performance.now();
  for (const row of [rows[0], rows[359], rows[719]]) {
    const cell = row.querySelector('.cell-tolerance');
    fireEvent.mouseEnter(cell);
    fireEvent.pointerOver(cell);
    fireEvent.pointerMove(cell);
  }
  if (process.env.REPORT_INSTRUMENT_TIMINGS) process.stdout.write(`${viewMode}: 720 specs mounted in ${mountedMs.toFixed(0)} ms; hover ${(performance.now() - hoverStart).toFixed(0)} ms, ${commit.mock.calls.length} React commits (jsdom).\n`);
  expect(commit).not.toHaveBeenCalled();
  // Edit the linked range and confirm the uncertainty updates immediately.
  const linked = rows.find(row => row.dataset.rangeId === 'fluke-5790b-generic-medium-slow-2.2');
  fireEvent.click(linked.querySelector('[title="Edit resolution"]'));
  const input = linked.querySelector('.inline-resolution-input');
  fireEvent.change(input, { target: { value: '0.0000002' } });
  fireEvent.blur(input);
  expect(save).toHaveBeenCalled();
  const updated = save.mock.calls.at(-1)[0];
  expect(resolvePointBudgetComponents(point, updated).at(-1).value).toBeCloseTo(2 * Math.SQRT2 / Math.sqrt(12), 10);
  expect(updated.tmdes[0].instrument.functions[0].ranges).toHaveLength(720);
}, 20000);

it('collapses a 720-spec expansion on Escape without rebuilding the specification rows', () => {
  const session = { ...largeSession(), id: 'large-escape' }, point = session.testPoints[0];
  const { container } = render(<UncertaintyPanel testPointData={{ ...point, viewMode: 'point' }} sessionData={session}
    onSessionSave={vi.fn()} tmdeTolerancesData={[]} uutNominal={point.testPointInfo.parameter} />);
  const table = container.querySelector('[data-tour="tmde-table"]');
  fireEvent.click(table.querySelector('.instrument-library-specifications'));
  expect(table.querySelectorAll('[data-range-id]')).toHaveLength(720);
  const start = performance.now();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  if (process.env.REPORT_INSTRUMENT_TIMINGS) process.stdout.write(`Escape collapsed 720 specs in ${(performance.now() - start).toFixed(0)} ms (jsdom).\n`);
  expect(table.querySelectorAll('[data-range-id]')).toHaveLength(0);
  expect(table.querySelectorAll('thead th')).toHaveLength(2);
  expect(table.querySelector('.instrument-library-specifications')).toHaveAttribute('aria-expanded', 'false');
  expect(container.querySelector('[data-budget-instrument-specifications-expanded]')).toBeNull();
}, 20000);


it('switches large imported budgets with no hidden spec rows and expands live editors on demand', () => {
  const session = { ...largeSession(), id: 'simplified-large' };
  const first = session.testPoints[0];
  const save = vi.fn();
  const pointView = point => <UncertaintyPanel key={point.id} testPointData={{ ...point, viewMode: 'point' }}
    sessionData={session} onSessionSave={save} tmdeTolerancesData={[]} uutNominal={point.testPointInfo.parameter} />;
  const start = performance.now();
  const { container, rerender } = render(pointView(first));
  for (const kind of ['uut', 'tmde']) {
    const table = container.querySelector(`[data-tour="${kind}-table"]`);
    expect([...table.querySelectorAll('thead th')].map(th => th.getAttribute('aria-label'))).toEqual(['Description', 'Sync']);
    expect(table.querySelectorAll('[data-range-id]')).toHaveLength(0);
    const resize = within(table).getByRole('button', { name: 'Resize Description column' });
    const initialWidth = table.querySelector('col').style.width;
    fireEvent.keyDown(resize, { key: 'ArrowRight' });
    expect(table.querySelector('col').style.width).not.toBe(initialWidth);
    expect(JSON.parse(localStorage.getItem(`uncertalytics:simplified:${kind}:instrument-column-widths:v2`)).description).toBeGreaterThan(0);
  }
  const mountMs = performance.now() - start;
  const switching = performance.now();
  for (let index = 0; index < 5; index++) {
    rerender(pointView({ ...first, id: `point-${index}`, testPointInfo: { ...first.testPointInfo, parameter: { value: 10 + index, unit: 'A' } } }));
    expect(container.querySelectorAll('[data-range-id]')).toHaveLength(0);
    expect(container.querySelectorAll('.instrument-simplified-row')).toHaveLength(2);
  }
  if (process.env.REPORT_INSTRUMENT_TIMINGS) process.stdout.write(`Simplified 720 specs: mount ${mountMs.toFixed(0)} ms; five point switches ${(performance.now() - switching).toFixed(0)} ms (jsdom).\n`);
  const tmde = container.querySelector('[data-tour="tmde-table"]');
  fireEvent.click(within(tmde).getByRole('button', { name: /View or Edit Instrument Specifications Fluke 5790B/ }));
  expect(tmde.querySelectorAll('[data-range-id]')).toHaveLength(720);
  const linked = tmde.querySelector('[data-range-id="fluke-5790b-generic-medium-slow-2.2"]');
  fireEvent.click(linked.querySelector('[title="Edit resolution"]'));
  fireEvent.change(linked.querySelector('.inline-resolution-input'), { target: { value: '0.0000002' } });
  fireEvent.blur(linked.querySelector('.inline-resolution-input'));
  expect(resolvePointBudgetComponents(first, save.mock.calls.at(-1)[0]).at(-1).value).toBeCloseTo(2 * Math.SQRT2 / Math.sqrt(12), 10);
  const hide = tmde.querySelector('[title="Hide Instrument Specifications"]');
  expect(hide).toHaveAttribute('aria-expanded', 'true');
  const savedCalls = save.mock.calls.length;
  fireEvent.mouseDown(hide);
  fireEvent.click(hide);
  expect(save).toHaveBeenCalledTimes(savedCalls);
  expect(tmde.querySelectorAll('[data-range-id]')).toHaveLength(0);
  const trigger = tmde.closest('.panel-card').querySelector('[aria-label="TMDE table view"]');
  fireEvent.click(trigger);
  const menu = within(tmde.closest('.panel-card')).getByRole('group', { name: 'TMDE table view options' });
  expect(within(menu).getByRole('checkbox', { name: 'Show all measurement areas' })).not.toBeChecked();
  expect(within(menu).getByRole('checkbox', { name: 'Show simplified view' })).toBeChecked();
  fireEvent.click(within(menu).getByRole('checkbox', { name: 'Show simplified view' }));
  expect(tmde.querySelectorAll('[data-range-id]')).toHaveLength(720);
  rerender(pointView({ ...first, id: 'next-point' }));
  expect(container.querySelector('[data-tour="tmde-table"]').querySelectorAll('[data-range-id]')).toHaveLength(720);
  expect(container.querySelector('[data-tour="uut-table"]').querySelectorAll('[data-range-id]')).toHaveLength(0);
}, 20000);
