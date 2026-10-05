import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import StorageAdministration from './StorageAdministration';

it('offers storage administration only to list managers', async () => {
  render(<StorageAdministration store={{canManageStorage:vi.fn().mockResolvedValue(false)}} />);
  await act(async () => {});
  fireEvent.keyDown(window,{key:'T',ctrlKey:true,shiftKey:true});
  expect(screen.queryByRole('button',{name:'Storage administration'})).not.toBeInTheDocument();
});
it('shows grouped storage settings and upgrades in place', async () => {
  HTMLDialogElement.prototype.showModal=vi.fn(function(){this.setAttribute('open','');});
  const records=['sessions','instruments','equations','bugReports'].map(key=>({key,Id:key,Title:'Old '+key,displayTitle:'Uncertalytics — '+key,description:'App data',Hidden:false}));
  const store={webUrl:'https://example.test/sites/lab',prefix:'Uncertainty',canManageStorage:vi.fn().mockResolvedValue(true),storageInventory:vi.fn().mockResolvedValue(records),organizeStorage:vi.fn().mockResolvedValue(records.map(r=>({...r,Hidden:true,Title:r.displayTitle})))};
  render(<StorageAdministration store={store}/>);
  await act(async () => {});
  expect(screen.queryByRole('button',{name:'Storage administration'})).not.toBeInTheDocument();
  fireEvent.keyDown(window,{key:'t',ctrlKey:true});
  expect(screen.queryByRole('button',{name:'Storage administration'})).not.toBeInTheDocument();
  fireEvent.keyDown(window,{key:'T',ctrlKey:true,shiftKey:true});
  fireEvent.click(await screen.findByRole('button',{name:'Storage administration'}));
  expect(await screen.findByText('Current name: Old sessions')).toBeInTheDocument();
  expect(screen.getAllByRole('link',{name:'Settings'})).toHaveLength(4);
  fireEvent.click(screen.getByRole('button',{name:'Organize storage'}));
  expect(await screen.findByText(/Storage organized/)).toBeInTheDocument();
  expect(screen.getAllByText('Hidden')).toHaveLength(4);
  expect(store.organizeStorage).toHaveBeenCalledOnce();
});
