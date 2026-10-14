import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import LibraryInstrumentRow from './LibraryInstrumentRow';
vi.mock('plotly.js-dist', () => ({ default: {} }));
const instrument = { id: 'meter', scope: 'local', manufacturer: 'Acme', model: 'M1', functions: [{ id: 'f', name: 'Voltage', unit: 'V', ranges: [{ id: 'r', min: 0, max: 10, unit: 'V', tolerances: {} }] }] };
const setup = (overrides = {}) => { const props = { instrument, onSave: vi.fn().mockResolvedValue(instrument), onSelect: vi.fn(), onEdit: vi.fn(), ...overrides }; render(<table><tbody><LibraryInstrumentRow {...props} /></tbody></table>); return props; };
it('edits identity inline and persists without leaving the table', async () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Edit model: M1' }));
  fireEvent.change(screen.getByLabelText('model'), { target: { value: 'M2' } });
  fireEvent.click(screen.getByText('Save changes'));
  await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'meter', model: 'M2', scope: 'local' }), { requireSaved: true }));
});
it('preserves a failed save for retry', async () => {
  setup({ onSave: vi.fn().mockRejectedValue(new Error('Offline')) });
  fireEvent.click(screen.getByRole('button', { name: 'Edit model: M1' }));
  fireEvent.change(screen.getByLabelText('model'), { target: { value: 'M2' } });
  fireEvent.click(screen.getByText('Save changes'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  expect(screen.getByLabelText('model')).toHaveValue('M2');
});
it('saves shared edits as a separate local copy', async () => {
  const props = setup({ instrument: { ...instrument, scope: 'validated' } });
  fireEvent.click(screen.getByRole('button', { name: 'Edit model: M1' }));
  fireEvent.change(screen.getByLabelText('model'), { target: { value: 'M2' } });
  fireEvent.click(screen.getByText('Save changes'));
  await waitFor(() => expect(props.onSave).toHaveBeenCalled());
  expect(props.onSave.mock.calls[0][0]).toMatchObject({ scope: 'local', sourceId: 'meter', model: 'M2' });
  expect(props.onSave.mock.calls[0][0].id).not.toBe('meter');
});
it('expands the shared specification editors and collapses them', () => {
  setup(); const toggle = screen.getByRole('button', { name: /Voltage/ });
  fireEvent.click(toggle);
  expect(screen.getByRole('button', { name: 'Set tolerance' })).toBeInTheDocument();
  fireEvent.click(toggle);
  expect(screen.queryByRole('button', { name: 'Set tolerance' })).not.toBeInTheDocument();
});
