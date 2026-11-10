import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import InstrumentLibraryModal from './InstrumentLibraryModal';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../analysis/components/UncertaintyPanel', () => ({ default: ({ libraryToolbar }) => libraryToolbar(() => {}) }));
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
beforeEach(() => { axios.get.mockReset().mockResolvedValue({ data: { canValidate: false, reviews: [] } }); });
afterEach(() => {
  cleanup();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else delete navigator.clipboard;
});
const open = props => render(<InstrumentLibraryModal isOpen onClose={vi.fn()} {...props} />);

it('lets a general user generate and copy an access report without validation access or writes', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const getAccessReport = vi.fn().mockResolvedValue('Build: test\nSite: https://example.test/site\nPublished Instruments: Read access missing');
  open({ getAccessReport });
  expect(getAccessReport).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Validation inbox' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Instrument access report' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveClass('notification-window--info');
  expect(dialog).toHaveTextContent('Published Instruments: Read access missing');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Copy access report' }));
  expect(await screen.findByText('Access report copied.')).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith(`Instrument access report\n${await getAccessReport.mock.results[0].value}`);
  expect(axios.post).not.toHaveBeenCalled();
});

it('provides a selected access report when the browser cannot use the clipboard', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  open({ getAccessReport: async () => 'Drafts: Manage Lists is missing' });
  fireEvent.click(screen.getByRole('button', { name: 'Instrument access report' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Copy access report' }));
  const field = await screen.findByRole('textbox', { name: 'Access report' });
  expect(field).toHaveFocus();
  expect(field.value.slice(field.selectionStart, field.selectionEnd)).toBe('Instrument access report\nDrafts: Manage Lists is missing');
});

it('shows copyable library load errors with retry instead of presenting an empty catalog as success', async () => {
  const onRefresh = vi.fn();
  const loadError = "Access denied\nGET /_api/web/lists/getbytitle('Published Instruments')/items\nHTTP 403\nRequest ID request-42";
  open({ loadError, onRefresh });
  expect(screen.getByRole('alert')).toHaveTextContent('Displayed instruments may be incomplete');
  fireEvent.click(screen.getByRole('button', { name: 'Error details' }));
  expect(screen.getByRole('alertdialog')).toHaveTextContent('HTTP 403 Request ID request-42');
  fireEvent.click(screen.getByRole('button', { name: 'Retry library' }));
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Instrument access report' })).not.toBeInTheDocument();
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

it('does not open a delayed access report after the user closes the library', async () => {
  let finish;
  const getAccessReport = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const { rerender } = open({ getAccessReport });
  fireEvent.click(screen.getByRole('button', { name: 'Instrument access report' }));
  expect(screen.getByRole('button', { name: 'Instrument access report' })).toBeDisabled();
  rerender(<InstrumentLibraryModal isOpen={false} getAccessReport={getAccessReport} />);
  await act(async () => { finish('Late access report'); });
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  rerender(<InstrumentLibraryModal isOpen getAccessReport={getAccessReport} />);
  expect(screen.getByRole('button', { name: 'Instrument access report' })).toBeEnabled();
});
