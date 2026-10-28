import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import AcShuntImportTool from './AcShuntImportTool';
vi.mock('axios',()=>({default:{get:vi.fn()}}));

const snapshot={id:1,name:'A40B calibration',createdAt:'2026-10-02',
  instruments:{test_instrument_model:'A40B',test_instrument_serial:'UUT'},
  points:[{current:10,frequency:1000,sourcePointIds:[1,2],analytics:null,
    shuntSources:[null],tvcs:{std:null,ti:null},readerPoints:[{phases:{}}]}]};
beforeEach(()=>{
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal=vi.fn(function(){this.setAttribute('open','');});
  HTMLDialogElement.prototype.close=vi.fn(function(){this.removeAttribute('open');});
  axios.get.mockImplementation(url=>Promise.resolve({data:url.endsWith('/1/')?snapshot:
    {available:true,sessions:[{id:1,session_name:'A40B calibration',test_instrument_model:'A40B',test_instrument_serial:'UUT'}],page:1,pages:1}}));
});
it('loads only when opened, previews missing data, and saves a new budget',async()=>{
  const onImport=vi.fn().mockResolvedValue({});
  render(<AcShuntImportTool onImport={onImport}/>);
  expect(axios.get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Import AC/DC shunt session'}));
  fireEvent.click(await screen.findByRole('button',{name:/A40B calibration/}));
  await screen.findByText(/1 measurement points/);
  expect(screen.getByText(/items to review/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Create budget'}));
  await waitFor(()=>expect(onImport).toHaveBeenCalledTimes(1));
  expect(onImport.mock.calls[0][0]).toMatchObject({name:'A40B calibration · AC/DC budget'});
  await waitFor(()=>expect(screen.queryByText('Import shunt measurements')).toBeNull());
});
it('shows the measurement values and only an existing reference choice',async()=>{
  const source={...snapshot,points:[{...snapshot.points[0],analytics:{pair_delta_uut_ppm:-3,pair_type_a_uncertainty_ppm:2,n_pairs_used:4}}]};
  axios.get.mockImplementation(url=>Promise.resolve({data:url.endsWith('/1/')?source:{available:true,sessions:[{id:1,session_name:'Saved run'}],pages:1}}));
  const onImport=vi.fn().mockResolvedValue({});
  render(<AcShuntImportTool onImport={onImport} instruments={[{id:'reference',scope:'validated',model:'NIST reference',functions:[]}]}/>);
  fireEvent.click(screen.getByRole('button',{name:'Import AC/DC shunt session'}));
  fireEvent.click(await screen.findByRole('button',{name:/Saved run/}));
  await screen.findByText('1 measurement points');
  expect(screen.getByText('10 A')).toBeInTheDocument();
  expect(screen.getByText('1000 Hz')).toBeInTheDocument();
  expect(screen.getByText('-3 ppm')).toBeInTheDocument();
  expect(screen.getByText('2 ppm')).toBeInTheDocument();
  expect(screen.queryByLabelText('Certificate coverage factor (k)')).not.toBeInTheDocument();
  expect(screen.queryByText('Instrument matches')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Reference instrument'),{target:{value:'reference'}});
  fireEvent.click(screen.getByRole('button',{name:'Create budget'}));
  await waitFor(()=>expect(onImport).toHaveBeenCalledTimes(1));
  expect(onImport.mock.calls[0][0].tmdes[0].libraryInstrumentId).toBe('reference');
});
it('shows database failures and prevents creating an absent preview',async()=>{
  axios.get.mockRejectedValue(new Error('offline'));
  render(<AcShuntImportTool onImport={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Import AC/DC shunt session'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load');
  expect(screen.getByRole('button',{name:'Create budget'})).toBeDisabled();
});
it('keeps the dialog open when saving fails',async()=>{
  render(<AcShuntImportTool onImport={vi.fn().mockRejectedValue(new Error('Save failed'))}/>);
  fireEvent.click(screen.getByRole('button',{name:'Import AC/DC shunt session'}));
  fireEvent.click(await screen.findByRole('button',{name:/A40B calibration/}));
  await screen.findByText(/1 measurement points/);
  fireEvent.click(screen.getByRole('button',{name:'Create budget'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
});

it('makes later session pages available in one scrollable list without paging buttons',async()=>{
  axios.get.mockImplementation((url,{params})=>Promise.resolve({data:{available:true,page:params.page,pages:2,sessions:[{id:params.page,session_name:`Session ${params.page}`} ]}}));
  render(<AcShuntImportTool onImport={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Import AC/DC shunt session'}));
  expect(await screen.findByRole('button',{name:/Session 2/})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/Session 1/})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Previous'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Next'})).not.toBeInTheDocument();
});
