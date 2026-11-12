import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import InstrumentLibraryModal from './InstrumentLibraryModal';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../analysis/components/UncertaintyPanel', () => ({ default: ({ libraryToolbar }) => libraryToolbar(() => {}) }));
beforeEach(() => { axios.get.mockReset().mockResolvedValue({ data: { canValidate: false, reviews: [] } }); });
afterEach(cleanup);
const open = props => render(<InstrumentLibraryModal isOpen onClose={vi.fn()} {...props} />);

it.each([false, true])('omits access reports and an empty validation inbox for reviewer access %s', async canValidate => {
  axios.get.mockResolvedValue({ data: { canValidate, reviews: [] } });
  const getAccessReport = vi.fn();
  await act(async () => { open({ getAccessReport }); });
  expect(screen.queryByRole('button', { name: 'Instrument access report' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Validation inbox' })).not.toBeInTheDocument();
  expect(getAccessReport).not.toHaveBeenCalled();
});

it('hides the inbox control when a fresh review listing is empty', async () => {
  axios.get.mockResolvedValueOnce({ data: { canValidate: true, reviews: [{ id: 'submission', scope: 'pending' }] } });
  open({});
  const inbox = await screen.findByRole('button', { name: 'Validation inbox' });
  axios.get.mockResolvedValue({ data: { canValidate: true, reviews: [] } });
  fireEvent.click(inbox);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Validation inbox' })).not.toBeInTheDocument());
});

it('shows copyable library load errors with retry instead of presenting an empty catalog as success', async () => {
  const onRefresh = vi.fn();
  const loadError = "Access denied\nGET /_api/web/lists/getbytitle('Published Instruments')/items\nHTTP 403\nRequest ID request-42";
  await act(async () => { open({ loadError, onRefresh }); });
  expect(screen.getByRole('alert')).toHaveTextContent('Displayed instruments may be incomplete');
  fireEvent.click(screen.getByRole('button', { name: 'Error details' }));
  expect(screen.getByRole('alertdialog')).toHaveTextContent('HTTP 403 Request ID request-42');
  expect(screen.getByRole('button', { name: 'Copy error details' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry library' }));
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

it('preserves the permission reason and request ID from inbox failures and retries the request', async () => {
  axios.get.mockRejectedValueOnce({ serverMessage: 'Manage Lists is required on Instrument Drafts.', httpStatus: 403, requestId: 'review-42' });
  open({});
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load validation inbox');
  fireEvent.click(screen.getByRole('button', { name: 'Error details' }));
  const dialog = screen.getByRole('alertdialog');
  expect(dialog).toHaveTextContent('Manage Lists is required on Instrument Drafts. HTTP 403 Request ID review-42');
  fireEvent.click(within(dialog).getByTitle('Close'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry inbox' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(axios.get).toHaveBeenCalledTimes(2);
});
