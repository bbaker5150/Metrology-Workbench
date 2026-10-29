import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import ImportTool from './AcShuntImportTool';
import { generic5790, nominalY5020Resolution } from '../../utils/testFixtures/generic5790';
vi.mock('axios',()=>({default:{get:vi.fn()}}));

const ti = { id:'shared-ti',type:'uut',scope:'validated',manufacturer:'Fluke',model:'A40B · UUT',functions:[{
  id:'current',name:'Current',unit:'A',ranges:[{id:'10-1000',min:10,max:10,unit:'A',
    qualifier:{value:1000,min:1000,max:1000,unit:'Hz',isSingleValue:true},
    tolerances:{reading:{high:100,low:-100,unit:'ppm',symmetric:true,distribution:'not_set'}}}]}] };
const AcShuntImportTool = ({instruments = [], ...props}) => <ImportTool {...props} instruments={[ti,...instruments]}/>;

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
  expect(onImport.mock.calls[0][0].uuts[0]).toMatchObject({libraryInstrumentId:'shared-ti',instrument:{manufacturer:'Fluke',model:'A40B · UUT',sourceId:'shared-ti'}});
  await waitFor(()=>expect(screen.queryByText('Import shunt measurements')).toBeNull());
});
it('automatically matches both instruments without selectors while showing the measurement values',async()=>{
  const source={...snapshot,instruments:{...snapshot.instruments,standard_instrument_model:'A40B',standard_instrument_serial:'REF'},
    points:[{...snapshot.points[0],analytics:{pair_delta_uut_ppm:-3,pair_type_a_uncertainty_ppm:2,n_pairs_used:4}}]};
  axios.get.mockImplementation(url=>Promise.resolve({data:url.endsWith('/1/')?source:{available:true,sessions:[{id:1,session_name:'Saved run'}],pages:1}}));
  const onImport=vi.fn().mockResolvedValue({});
  render(<AcShuntImportTool onImport={onImport} instruments={[{...ti,id:'reference',type:'tmde',model:'A40B · REF',description:'NIST reference'}]}/>);
  fireEvent.click(screen.getByRole('button',{name:'Import AC/DC shunt session'}));
  fireEvent.click(await screen.findByRole('button',{name:/Saved run/}));
  await screen.findByText('1 measurement points');
  expect(screen.getByText('10 A')).toBeInTheDocument();
  expect(screen.getByText('1000 Hz')).toBeInTheDocument();
  expect(screen.getByText('-3 ppm')).toBeInTheDocument();
  expect(screen.getByText('2 ppm')).toBeInTheDocument();
  expect(screen.queryByLabelText('Certificate coverage factor (k)')).not.toBeInTheDocument();
  expect(screen.queryByText('Instrument matches')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Reference instrument')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Test instrument (TI)')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Create budget'}));
  await waitFor(()=>expect(onImport).toHaveBeenCalledTimes(1));
  expect(onImport.mock.calls[0][0].tmdes[0].libraryInstrumentId).toBe('reference');
  expect(onImport.mock.calls[0][0].tmdes[0].name).toBe('NIST reference');
  expect(onImport.mock.calls[0][0].uuts[0].libraryInstrumentId).toBe('shared-ti');
});
it('shows database failures and prevents creating an absent preview',async()=>{
  axios.get.mockRejectedValue(new Error('offline'));
  render(<AcShuntImportTool onImport={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Import AC/DC shunt session'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load');
  expect(screen.getByRole('button',{name:'Create budget'})).toBeDisabled();
});
it('reports ambiguous automatic matching without introducing instrument selectors',async()=>{
  render(<AcShuntImportTool onImport={vi.fn()} instruments={[{...ti,id:'other'}]}/>);
  fireEvent.click(screen.getByRole('button',{name:'Import AC/DC shunt session'}));
  fireEvent.click(await screen.findByRole('button',{name:/A40B calibration/}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not automatically match TI');
  expect(screen.getByRole('button',{name:'Create budget'})).toBeDisabled();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
it('keeps the dialog open when saving fails',async()=>{
  render(<AcShuntImportTool onImport={vi.fn().mockRejectedValue(new Error('Save failed'))}/>);
  fireEvent.click(screen.getByRole('button',{name:'Import AC/DC shunt session'}));
  fireEvent.click(await screen.findByRole('button',{name:/A40B calibration/}));
  await screen.findByText(/1 measurement points/);
  fireEvent.click(screen.getByRole('button',{name:'Create budget'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
});

it('imports Y5020 with its generic reader even when the loaded library has no matching reader serial', async () => {
  const onImport = vi.fn();
  const source = {...snapshot, name:'Y5020 run',
    instruments:{test_instrument_model:'Y5020',test_instrument_serial:'UUT',test_reader_serial:'4449302'},
    generic5790Instrument:generic5790,
    points:[{current:10,frequency:1000,sourcePointIds:[1,2],readerResolution:nominalY5020Resolution(10),
      analytics:{pair_delta_uut_ppm:-3,pair_type_a_uncertainty_ppm:2,n_pairs_used:4}}]};
  axios.get.mockImplementation(url => Promise.resolve({data:url.endsWith('/1/') ? source
    : {available:true,sessions:[{id:1,session_name:'Y5020 run',test_instrument_model:'Y5020'}]}}));
  render(<ImportTool onImport={onImport} instruments={[{...ti,model:'Y5020 · UUT'}]}/>);
  fireEvent.click(screen.getByRole('button',{name:'Import AC/DC shunt session'}));
  fireEvent.click(await screen.findByRole('button',{name:/Y5020 run/}));
  await screen.findByText('1 measurement points');
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  const create = screen.getByRole('button',{name:'Create budget'});
  expect(create).toBeEnabled();
  fireEvent.click(create);
  await waitFor(() => expect(onImport).toHaveBeenCalledOnce());
  const session = onImport.mock.calls[0][0];
  expect(session.tmdes).toHaveLength(1);
  expect(session.tmdes[0].instrument.sourceId).toBe(generic5790.id);
  expect(session.testPoints[0].components.at(-1).tmdeBudgetSourceId).toBe(session.tmdes[0].id);
  expect(session.testPoints[0].expanded_uncertainty_absolute_base).toBeGreaterThan(0);
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
