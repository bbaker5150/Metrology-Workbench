import React from 'react';
import { fireEvent, render, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import UncertaintyPanel from './UncertaintyPanel';

vi.mock('plotly.js-dist', () => ({ default: {} }));
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it('keyboard resizing round-trips the saved width despite a temporarily expanded instrument column', () => {
  const key = 'uncertalytics:uut:instrument-column-widths:v2';
  const widths = { __absolute: true, description: 200, range: 80, tolerance: 140, resolution: 140, sync: 96 };
  localStorage.setItem(key, JSON.stringify(widths));
  const session = { id: 'column-sizing', simplifiedInstrumentTables: false, uuts: [{ id: 'meter', description: 'Meter',
    instrument: { functions: [{ id: 'f', name: 'Voltage', unit: 'V', ranges: [{ id: 'r', min: 0, max: 10, unit: 'V' }] }] } }], tmdes: [], testPoints: [], uncReq: {} };
  const { container } = render(<UncertaintyPanel sessionData={session} onSessionSave={vi.fn()} tmdeTolerancesData={[]}
    testPointData={{ id: 'p', viewMode: 'session', components: [], tmdeTolerances: [], specifications: {} }} />);
  const table = container.querySelector('[data-tour="uut-table"] table');
  Object.defineProperty(table, 'offsetWidth', { configurable: true, value: 1000 });
  table.getBoundingClientRect = () => ({ width: 1000 });
  for (const header of table.querySelectorAll('thead [data-instrument-column]')) {
    header.getBoundingClientRect = () => ({ width: header.dataset.instrumentColumn === 'description' ? 400 : widths[header.dataset.instrumentColumn] });
  }
  const handle = within(table).getByRole('button', { name: 'Resize Description column', exact: true });
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(JSON.parse(localStorage.getItem(key))).toEqual({ ...widths, description: 212 });
  fireEvent.keyDown(handle, { key: 'ArrowLeft' });
  expect(JSON.parse(localStorage.getItem(key))).toEqual(widths);
});
