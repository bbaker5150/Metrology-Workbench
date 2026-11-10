import React, { useState } from 'react';
import { render, fireEvent, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import UncertaintyPanel, { localizeSharedInstrumentEdit } from './UncertaintyPanel';

vi.mock('plotly.js-dist', () => ({ default: {} }));
beforeEach(() => localStorage.clear());

function Harness({ viewMode, kind, saveInstrument }) {
  const [session, setSession] = useState({ id: 'session', uuts: [], tmdes: [], testPoints: [],
    measurementAreaGroups: [{ name: 'Torque', kind, color: '#16865b' }], uncReq: {} });
  return <><UncertaintyPanel sessionData={session} onSessionSave={setSession} onSaveInstrument={saveInstrument}
    testPointData={{ id: 'point', viewMode, components: [], tmdeTolerances: [], specifications: {},
      testPointInfo: { parameter: { name: 'Torque', value: 5, unit: 'N·m' } } }} tmdeTolerancesData={[]} />
    <output data-testid="session">{JSON.stringify(session)}</output></>;
}

it.each([['session', 'uut'], ['session', 'tmde'], ['point', 'uut'], ['point', 'tmde']])(
  'creates and edits a %s %s without saving it to the local library', async (viewMode, kind) => {
    const saveInstrument = vi.fn();
    render(<Harness viewMode={viewMode} kind={kind} saveInstrument={saveInstrument} />);
    fireEvent.click(screen.getByRole('button', { name: `Add ${kind.toUpperCase()} to this measurement area` }));
    const read = () => JSON.parse(screen.getByTestId('session').textContent)[kind === 'uut' ? 'uuts' : 'tmdes'][0];
    expect(read().instrument.scope).toBe('session');
    const row = document.querySelector(`tr[data-instrument-id="${read().id}"]`);
    const specifications = row.querySelector('.instrument-library-specifications');
    if (!row.querySelector('.inline-desc-combined') && specifications) fireEvent.click(specifications);
    fireEvent.mouseDown(row.querySelector('.inline-desc-combined'), { button: 0 });
    const model = within(row).getByPlaceholderText('Model', { exact: true });
    fireEvent.change(model, { target: { value: 'New torque meter' } });
    fireEvent.blur(model);
    await waitFor(() => expect(read().instrument.model).toBe('New torque meter'));
    expect(read().instrument.scope).toBe('session');
    expect(saveInstrument).not.toHaveBeenCalled();
  },
);

it('keeps unscoped unsaved definitions session-only while preserving known library definitions', () => {
  const item = { id: 'row', instrument: { id: 'new', model: 'Meter' } };
  expect(localizeSharedInstrumentEdit(item).instrument.scope).toBe('session');
  expect(localizeSharedInstrumentEdit(item, [{ id: 'new', scope: 'local' }]).instrument.scope).toBe('local');
});
