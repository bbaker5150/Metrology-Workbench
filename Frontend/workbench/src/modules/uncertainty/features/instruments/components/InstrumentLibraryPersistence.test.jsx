import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import InstrumentLibraryModal from './InstrumentLibraryModal';
import useSessionManager from '../../../hooks/useSessionManager';
import { readRecovery } from '../../../utils/sessionRecovery';

vi.mock('plotly.js-dist', () => ({ default: {} }));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
let stored;
const copy = value => JSON.parse(JSON.stringify(value));
function App() {
  const manager = useSessionManager();
  return <InstrumentLibraryModal isOpen instruments={manager.instruments} onClose={() => {}} onSaveToLibrary={manager.saveInstrument} />;
}
const expand = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Select instrument Meter' }));
  fireEvent.click(screen.getByRole('button', { name: 'View or Edit Instrument Specifications Meter' }));
};
const persist = async (_url, record) => { stored = copy(record); return { data: copy(stored) }; };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  stored = { id: 'meter', scope: 'local', description: 'Meter', qualifierColumnNames: ['Frequency'],
    functions: [{ id: 'f', name: 'Voltage', unit: 'V', ranges: [{ id: 'r', min: 0, max: 10, unit: 'V', qualifier: { id: 'q', text: '60 Hz' }, tolerances: {} }] }] };
  axios.get.mockImplementation(async url => ({ data: url.endsWith('/instruments/') ? [copy(stored)] : [] }));
  axios.post.mockImplementation(persist);
});
it('restores the latest unblurred qualifier edit after an interrupted save and a fresh app load', async () => {
  // The first write is in flight; the later edit has not reached the server.
  axios.post.mockImplementation(() => new Promise(() => {}));
  const first = render(<App />); await expand();
  fireEvent.click(screen.getByRole('button', { name: 'Frequency', exact: true }));
  const input = screen.getByLabelText('Qualifier 1 column name');
  fireEvent.change(input, { target: { value: 'Operating' } });
  await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { value: 'Operating frequency' } });
  expect(readRecovery().libraryEdits.meter.instrument.qualifierColumnNames).toEqual(['Operating frequency']);
  first.unmount();
  expect(stored.qualifierColumnNames).toEqual(['Frequency']);

  axios.post.mockImplementation(persist);
  const second = render(<App />); await expand();
  expect(await screen.findByRole('button', { name: 'Operating frequency', exact: true })).toBeInTheDocument();
  await waitFor(() => expect(stored.qualifierColumnNames).toEqual(['Operating frequency']));
  await waitFor(() => expect(readRecovery().libraryEdits.meter).toBeUndefined());
  second.unmount(); localStorage.clear();

  // With browser recovery gone, the name must come from persisted API data.
  render(<App />); await expand();
  expect(screen.getByRole('button', { name: 'Operating frequency', exact: true })).toBeInTheDocument();
});
