import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import InstrumentLibraryModal from './InstrumentLibraryModal';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('plotly.js-dist', () => ({ default: {} }));
beforeEach(() => { axios.get.mockReset().mockResolvedValue({ data: { canValidate: false, reviews: [] } }); });
afterEach(cleanup);
const instruments = [
  { id: 'one', scope: 'local', manufacturer: 'Acme', model: 'M10', description: 'Meter 10', nickname: 'REF' },
  { id: 'two', scope: 'pending', manufacturer: 'ACME', model: 'M2', description: 'Meter 2' },
  { id: 'three', scope: 'validated', manufacturer: 'Beta', model: 'M2', description: 'Bridge', nickname: 'REF' },
  { id: 'four', scope: 'shared', manufacturer: 'Beta', model: 'M20', description: 'Source', nickname: 'FIELD' },
];
const open = async props => { await act(async () => { render(<InstrumentLibraryModal isOpen instruments={instruments} onClose={vi.fn()} {...props} />); }); };
const rows = () => [...document.querySelectorAll('.instrument-library-name-row[data-instrument-id]')].map(row => row.dataset.instrumentId);
const filter = label => { fireEvent.click(screen.getByRole('button', { name: `Filter and sort ${label}` })); return within(screen.getByRole('dialog', { name: `${label} filter and sort` })); };
const check = (menu, name) => fireEvent.click(menu.getByRole('checkbox', { name, exact: true }));
const done = menu => fireEvent.click(menu.getByRole('button', { name: 'Done' }));

it('filters shared and validated together and combines Status with distinct Description categories', async () => {
  await open();
  const status = filter('Status');
  expect(status.getAllByRole('checkbox').map(input => input.getAttribute('aria-label'))).toEqual(['Select all Status values', 'Local', 'Awaiting validation', 'Shared']);
  check(status, 'Select all Status values'); check(status, 'Shared'); done(status);
  expect(rows()).toEqual(['three', 'four']);
  expect(screen.getByRole('button', { name: 'Filter and sort Status' })).toHaveClass('is-filtered');
  let description = filter('Description');
  expect(description.getAllByRole('checkbox').map(input => input.getAttribute('aria-label'))).toEqual(['Select all Manufacturer values', 'Acme', 'Beta']);
  check(description, 'Acme');
  fireEvent.click(description.getByRole('button', { name: 'Model', exact: true }));
  check(description, 'Select all Model values'); check(description, 'M2'); done(description);
  expect(rows()).toEqual(['three']);
  description = filter('Description');
  fireEvent.click(description.getByRole('button', { name: 'Clear filter' })); done(description);
  expect(rows()).toEqual(['three', 'four']);
  expect(screen.getByRole('button', { name: 'Filter and sort Status' })).toHaveClass('is-filtered');
  const clearStatus = filter('Status'); fireEvent.click(clearStatus.getByRole('button', { name: 'Clear filter' })); done(clearStatus);
  expect(rows()).toEqual(['three', 'two', 'one', 'four']);
});

it('filters Name and blank Tag values, searches checkbox choices and preserves hidden selections', async () => {
  await open();
  const menu = filter('Description');
  fireEvent.change(menu.getByRole('searchbox', { name: 'Search Manufacturer values' }), { target: { value: 'acme' } });
  check(menu, 'Select all Manufacturer values');
  expect(rows()).toEqual(['three', 'four']);
  fireEvent.change(menu.getByRole('searchbox', { name: 'Search Manufacturer values' }), { target: { value: '' } });
  expect(menu.getByRole('checkbox', { name: 'Beta', exact: true })).toBeChecked();
  expect(menu.getByRole('checkbox', { name: 'Select all Manufacturer values' }).indeterminate).toBe(true);
  fireEvent.click(menu.getByRole('button', { name: 'Clear filter' }));
  fireEvent.click(menu.getByRole('button', { name: 'Name', exact: true }));
  check(menu, 'Select all Name values'); check(menu, 'Meter 2'); check(menu, 'Meter 10');
  fireEvent.click(menu.getByRole('button', { name: 'Tag', exact: true }));
  check(menu, 'Select all Tag values'); check(menu, '(Not set)'); done(menu);
  expect(rows()).toEqual(['two']);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search instruments' }), { target: { value: 'Bridge' } });
  expect(screen.getByText(/No instruments match/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Search instruments' }), { target: { value: '' } });
  expect(rows()).toEqual(['two']);
});

it('sorts by each relevant description field and status without saving instruments', async () => {
  const save = vi.fn(); await open({ onSaveToLibrary: save });
  const menu = filter('Description');
  fireEvent.click(menu.getByRole('button', { name: 'Sort Manufacturer descending' }));
  expect(rows()).toEqual(['three', 'four', 'one', 'two']);
  fireEvent.click(menu.getByRole('button', { name: 'Model', exact: true }));
  fireEvent.click(menu.getByRole('button', { name: 'Sort Model ascending' }));
  expect(rows()).toEqual(['two', 'three', 'one', 'four']);
  fireEvent.click(menu.getByRole('button', { name: 'Tag', exact: true }));
  fireEvent.click(menu.getByRole('button', { name: 'Sort Tag ascending' }));
  expect(rows()).toEqual(['two', 'four', 'one', 'three']);
  fireEvent.click(menu.getByRole('button', { name: 'Name', exact: true }));
  fireEvent.click(menu.getByRole('button', { name: 'Sort Name descending' }));
  expect(rows()).toEqual(['four', 'one', 'two', 'three']); done(menu);
  const status = filter('Status'); fireEvent.click(status.getByRole('button', { name: 'Sort Status ascending' }));
  expect(rows()).toEqual(['one', 'two', 'three', 'four']);
  fireEvent.click(status.getByRole('button', { name: 'Sort Status descending' }));
  expect(rows()).toEqual(['three', 'four', 'two', 'one']);
  expect(document.querySelectorAll('tr.selected-row, tr.instrument-selected')).toHaveLength(0);
  expect(save).not.toHaveBeenCalled();
});

it('keeps specification expansion when Escape closes a filter and dismisses only on outside scroll', async () => {
  await open();
  fireEvent.click(document.querySelector('tr[data-instrument-id="one"] .instrument-library-specifications'));
  let menu = filter('Description');
  fireEvent.scroll(menu.getByRole('group', { name: 'Manufacturer values' }));
  expect(screen.getByRole('dialog', { name: 'Description filter and sort' })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Description filter and sort' })).toBeNull();
  expect(document.querySelector('tr[data-instrument-id="one"] .instrument-library-specifications')).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'Filter and sort Description' })).toHaveFocus();
  menu = filter('Description');
  fireEvent.scroll(document.querySelector('.instrument-table-scroll'));
  expect(screen.queryByRole('dialog', { name: 'Description filter and sort' })).toBeNull();
});

it('opens by keyboard into the filter and closes from Done or its header trigger without an X button', async () => {
  await open();
  const description = screen.getByRole('button', { name: 'Filter and sort Description' });
  description.focus(); fireEvent.keyDown(description, { key: 'ArrowDown' });
  expect(screen.getByRole('searchbox', { name: 'Search Manufacturer values' })).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'Close Description filter' })).toBeNull();
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Description filter and sort' })).getByRole('button', { name: 'Done' }));
  expect(description).toHaveFocus();
  filter('Status');
  expect(screen.getByRole('button', { name: 'Sort Status ascending' })).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'Close Status filter' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Filter and sort Status' }));
  expect(screen.queryByRole('dialog', { name: 'Status filter and sort' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Filter and sort Status' })).toHaveFocus();
});

it('keeps Description sections open independently while combining their filters', async () => {
  await open();
  const menu = filter('Description');
  const manufacturer = menu.getByRole('button', { name: 'Manufacturer', exact: true });
  const model = menu.getByRole('button', { name: 'Model', exact: true });
  fireEvent.change(menu.getByRole('searchbox', { name: 'Search Manufacturer values' }), { target: { value: 'acme' } });
  fireEvent.click(model);
  expect(manufacturer).toHaveAttribute('aria-expanded', 'true');
  expect(model).toHaveAttribute('aria-expanded', 'true');
  expect(menu.getByRole('searchbox', { name: 'Search Manufacturer values' })).toHaveValue('acme');
  expect(menu.getByRole('searchbox', { name: 'Search Model values' })).toBeInTheDocument();
  check(menu, 'Acme');
  check(menu, 'Select all Model values'); check(menu, 'M2');
  expect(rows()).toEqual(['three']);
  fireEvent.click(manufacturer);
  expect(manufacturer).toHaveAttribute('aria-expanded', 'false');
  expect(model).toHaveAttribute('aria-expanded', 'true');
  expect(menu.queryByRole('searchbox', { name: 'Search Manufacturer values' })).toBeNull();
  expect(menu.getByRole('checkbox', { name: 'M2', exact: true })).toBeChecked();
  expect(rows()).toEqual(['three']);
  fireEvent.click(model);
  done(menu);
  const trigger = screen.getByRole('button', { name: 'Filter and sort Description' });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(screen.getByRole('button', { name: 'Manufacturer', exact: true })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Model', exact: true })).toHaveAttribute('aria-expanded', 'false');
});

it('drops hidden selections and resets column filters when creating a new draft', async () => {
  const remove = vi.fn(); await open({ onDelete: remove });
  fireEvent.click(document.querySelector('tr[data-instrument-id="one"] .instrument-library-name'));
  const menu = filter('Status'); check(menu, 'Local'); done(menu);
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add instrument' }));
  expect(screen.getByRole('button', { name: 'Filter and sort Status' })).not.toHaveClass('is-filtered');
  expect(document.querySelector('.inline-sync-badge--red')).toBeInTheDocument();
});

it('keeps independent filters for the library and review inbox', async () => {
  axios.get.mockResolvedValue({ data: { canValidate: true, reviews: instruments.slice(0, 2).map(row => ({ ...row, scope: 'pending' })) } });
  await open();
  const status = filter('Status'); check(status, 'Select all Status values'); check(status, 'Shared'); done(status);
  fireEvent.click(screen.getByRole('button', { name: 'Validation inbox' }));
  await screen.findByRole('region', { name: 'Pending instrument validations' });
  expect(rows()).toEqual(['review-two', 'review-one']);
  const description = filter('Description'); fireEvent.click(description.getByRole('button', { name: 'Model', exact: true }));
  check(description, 'M10'); done(description);
  expect(rows()).toEqual(['review-two']);
  fireEvent.click(screen.getByRole('button', { name: 'Validation inbox' }));
  await waitFor(() => expect(rows()).toEqual(['three', 'four']));
  fireEvent.click(screen.getByRole('button', { name: 'Validation inbox' }));
  await waitFor(() => expect(rows()).toEqual(['review-two']));
});
