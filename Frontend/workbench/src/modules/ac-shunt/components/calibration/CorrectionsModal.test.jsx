import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import CorrectionsModal from './CorrectionsModal';

vi.mock('axios', () => ({default:{get:vi.fn(), post:vi.fn(), patch:vi.fn(), put:vi.fn()}}));
vi.mock('../../contexts/InstrumentContext', () => ({useInstruments:() => ({})}));
vi.mock('../shared/AnimatedModalShell', () => ({default:({children}) => <div>{children}</div>}));

beforeEach(() => vi.resetAllMocks());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const importedDevice = {
  id: 1, model_name: 'A40B', serial_number: 'test-import', range: 10, is_manual: false,
  reports: [{ id: 2, is_active: true, notes: 'original', corrections: [
    { id: 3, current: 1, frequency: 1000, correction: 0.25, uncertainty: 0.5 },
  ] }],
};

async function openDevice(device = importedDevice) {
  axios.get.mockImplementation(async url => ({ data: url.includes('/shunts/') ? [device] : [] }));
  axios.patch.mockResolvedValue({ data: device });
  axios.put.mockResolvedValue({ data: device.reports[0] });
  const notify = vi.fn();
  render(<CorrectionsModal isOpen onClose={vi.fn()} showNotification={notify} uniqueTestPoints={[]} />);
  const edit = await screen.findByRole('button', { name: device.is_manual ? 'Edit this report' : 'Edit this report (admin)' });
  fireEvent.click(edit);
  return notify;
}

function verify() {
  const password = crypto.randomUUID();
  fireEvent.change(screen.getByLabelText('Authorization password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
  return password;
}

it('verifies on the server and sends the device grant with both report-edit writes', async () => {
  const token = crypto.randomUUID();
  axios.post.mockResolvedValue({ data: { token, expires_in: 600 } });
  await openDevice();
  expect(screen.queryByRole('button', { name: 'Save report' })).not.toBeInTheDocument();
  const password = verify();
  expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/corrections\/authorize\/$/), {
    password, device_type: 'shunt', device_id: 1,
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Save report' }));
  await waitFor(() => expect(axios.put).toHaveBeenCalled());
  const config = { headers: { Authorization: `Corrections ${token}` } };
  expect(axios.patch).toHaveBeenCalledWith(expect.stringMatching(/\/shunts\/1\/$/), expect.any(Object), config);
  expect(axios.put).toHaveBeenCalledWith(expect.stringMatching(/\/shunts\/1\/reports\/2\/$/), expect.any(Object), config);
});

it.each([403, 503])('does not unlock when the backend rejects verification with %s', async status => {
  axios.post.mockRejectedValue({ response: { status, data: { detail: 'Server denied verification' } } });
  const notify = await openDevice();
  verify();
  await waitFor(() => expect(notify).toHaveBeenCalledWith('Server denied verification', 'error'));
  expect(screen.getByLabelText('Authorization password')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save report' })).not.toBeInTheDocument();
  expect(axios.patch).not.toHaveBeenCalled();
});

it('ignores a verification response received after cancellation', async () => {
  let resolve;
  axios.post.mockReturnValue(new Promise(done => { resolve = done; }));
  await openDevice();
  verify();
  expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await act(async () => resolve({ data: { token: crypto.randomUUID(), expires_in: 600 } }));
  expect(screen.queryByRole('button', { name: 'Save report' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit this report (admin)' }));
  expect(screen.getByLabelText('Authorization password')).toHaveValue('');
});

it('preserves edits and requests a fresh grant after the server expires authorization', async () => {
  axios.post.mockResolvedValue({ data: { token: crypto.randomUUID(), expires_in: 600 } });
  axios.patch.mockRejectedValueOnce({ response: { status: 403 } });
  await openDevice();
  // openDevice establishes the default success mock, without replacing the queued rejection.
  verify();
  const save = await screen.findByRole('button', { name: 'Save report' });
  const notes = screen.getByDisplayValue('original');
  fireEvent.change(notes, { target: { value: 'Keep this unsaved note' } });
  fireEvent.click(save);
  await screen.findByLabelText('Authorization password');
  expect(notes).toHaveValue('Keep this unsaved note');
  expect(axios.put).not.toHaveBeenCalled();
  verify();
  await waitFor(() => expect(axios.put).toHaveBeenCalledWith(expect.any(String),
    expect.objectContaining({ notes: 'Keep this unsaved note' }), expect.any(Object)));
});

it('keeps manual report editing available without a password', async () => {
  await openDevice({ ...importedDevice, is_manual: true });
  fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
  await waitFor(() => expect(axios.put).toHaveBeenCalled());
  expect(axios.post).not.toHaveBeenCalled();
  expect(axios.put.mock.calls[0][2]).toEqual({});
});

it('includes active report notes in the shunt picker before the Manual suffix', async () => {
  axios.get.mockImplementation(async url => ({data:url.includes('/shunts/') ? [
    {id:1, model_name:'Y5020', serial_number:'3995010', range:20, is_manual:true,
      reports:[{id:1, notes:'old notes', calibration_date:'2025-01-01'},
        {id:2, notes:'used from 18A input', is_active:true, corrections:[]}]},
    {id:2, model_name:'A40B-10A', serial_number:'other', range:10, reports:[]},
  ] : []}));
  render(<CorrectionsModal isOpen onClose={vi.fn()} showNotification={vi.fn()} uniqueTestPoints={[]} />);
  expect(await screen.findByRole('option', {name:'[Y5020] 3995010 (20A), used from 18A input — Manual'})).toBeInTheDocument();
  expect(screen.getByRole('option', {name:'[A40B-10A] other'})).toBeInTheDocument();
  expect(screen.queryByRole('option', {name:/old notes/})).not.toBeInTheDocument();
});
