import React, { Profiler } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import UncertaintyPanel from './UncertaintyPanel';
import { qualified5790, nominalY5020Resolution } from '../../../utils/testFixtures/generic5790';
import { buildAcShuntBudget } from '../../../utils/acShuntBudget';
import { resolvePointBudgetComponents } from '../../../utils/resolvePointBudgetComponents';

vi.mock('plotly.js-dist', () => ({ default: {} }));

it.each(['session', 'point'])('keeps a 720-spec instrument editable without workspace rerenders on hover in %s view', viewMode => {
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
