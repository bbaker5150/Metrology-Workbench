import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import AcShuntImportTool from './AcShuntImportTool';
import { buildAcShuntBudget } from '../../utils/acShuntBudget';
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
  await screen.findByText(/A40B · 1 points/);
  expect(screen.getByText(/items to review/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Create budget'}));
  await waitFor(()=>expect(onImport).toHaveBeenCalledTimes(1));
  expect(onImport.mock.calls[0][0]).toMatchObject({name:'A40B calibration · AC/DC budget'});
  await waitFor(()=>expect(screen.queryByText('Build from a shunt session')).toBeNull());
});
it('automatically reuses shared instruments, hides certificate setup, and allows reviewing the matches',async()=>{
  const source={...snapshot,instruments:{test_instrument_model:'Y5020',test_instrument_serial:'UUT',standard_instrument_model:'Y5020',standard_instrument_serial:'REF',standard_reader_model:'5790B',standard_reader_serial:'R1',test_reader_model:'5790B',test_reader_serial:'R2'}};
  const generated=buildAcShuntBudget(source).session;
  const instruments=[...generated.uuts,...generated.tmdes].map(item=>({...item.instrument,scope:'validated'}));
  axios.get.mockImplementation(url=>Promise.resolve({data:url.endsWith('/1/')?source:{available:true,sessions:[{id:1,session_name:'Saved Y5020 run'}],pages:1}}));
  const onImport=vi.fn().mockResolvedValue({});
  render(<AcShuntImportTool onImport={onImport} instruments={instruments}/>);
  fireEvent.click(screen.getByRole('button',{name:'Import AC/DC shunt session'}));
  fireEvent.click(await screen.findByRole('button',{name:'Saved Y5020 run Unknown model · No serial'}));
  await screen.findByText('4 of 4 instruments reused from the shared library.');
  expect(screen.queryByLabelText('Certificate coverage factor (k)')).not.toBeInTheDocument();
  expect(screen.getByText(/Y5020 UUT: Navy ±100 ppm/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Instrument matches'));
  expect(screen.getByLabelText('Shared instrument for Reference shunt')).toHaveValue(instruments[1].id);
  fireEvent.change(screen.getByLabelText('Shared instrument for Reference shunt'),{target:{value:''}});
  expect(screen.getByText('3 of 4 instruments reused from the shared library.')).toBeInTheDocument();
  expect(screen.getByLabelText('Certificate coverage factor (k)')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Shared instrument for Reference shunt'),{target:{value:instruments[1].id}});
  fireEvent.click(screen.getByRole('button',{name:'Create budget'}));
  await waitFor(()=>expect(onImport).toHaveBeenCalledTimes(1));
  expect(onImport.mock.calls[0][0].tmdes[0].libraryInstrumentId).toBe(instruments[1].id);
});
it('shows database failures and prevents creating an absent preview',async()=>{
  axios.get.mockRejectedValue(new Error('offline'));
  render(<AcShuntImportTool onImport={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Import AC/DC shunt session'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load');
  expect(screen.getByRole('button',{name:'Create budget'})).toBeDisabled();
});
it('keeps the dialog open on save failure and permits correcting invalid certificate k',async()=>{
  render(<AcShuntImportTool onImport={vi.fn().mockRejectedValue(new Error('Save failed'))}/>);
  fireEvent.click(screen.getByRole('button',{name:'Import AC/DC shunt session'}));
  fireEvent.click(await screen.findByRole('button',{name:/A40B calibration/}));
  await screen.findByText(/A40B · 1 points/);
  fireEvent.change(screen.getByLabelText('Certificate coverage factor (k)'),{target:{value:'0'}});
  expect(screen.getByRole('button',{name:'Create budget'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Certificate coverage factor (k)'),{target:{value:'2'}});
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
