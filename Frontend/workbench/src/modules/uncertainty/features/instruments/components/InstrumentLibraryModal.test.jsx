import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import InstrumentLibraryModal from './InstrumentLibraryModal';
import { ConfirmRecordDeletesContext } from '../../../contexts/RecordDeletePolicy';
vi.mock('plotly.js-dist', () => ({ default: {} }));
const definition = (id, scope='local') => ({ id, scope, manufacturer: 'Example', model: id, description: `Meter ${id}`, functions: [{id:'f', name:'Voltage', unit:'V', ranges:[{id:'r', min:0, max:10, unit:'V', resolution:0.01, tolerances:{reading:{value:1,unit:'%'}}}]}] });
function Harness({ save=vi.fn(), remove=vi.fn(), close=vi.fn() }) {
 const [instruments,setInstruments]=useState([definition('A'),definition('B','validated'),definition('C')]);
 return <ConfirmRecordDeletesContext.Provider value={false}><InstrumentLibraryModal isOpen instruments={instruments} onClose={close}
 onSaveToLibrary={async(value,options)=>{await save(value,options);setInstruments(previous=>[...previous.filter(item=>item.id!==value.id),value]);return value;}}
 onDelete={async id=>{await remove(id);setInstruments(previous=>previous.filter(item=>item.id!==id));}} /></ConfirmRecordDeletesContext.Provider>;
}
it('renders the real instrument table with no separate function or Type B editor',()=>{
 render(<Harness/>);
 expect(document.querySelectorAll('.instrument-equipment-table')).toHaveLength(1);
 expect(screen.getByText('Description')).toBeInTheDocument();
 expect(screen.getByText('Resolution')).toBeInTheDocument();
 expect(document.querySelector('.library-table')).toBeNull();
 expect(screen.queryByText('Type B')).not.toBeInTheDocument();
 expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
it('filters and sorts from the search control',()=>{
 render(<Harness/>);
 fireEvent.click(screen.getByLabelText('Filter and sort instruments'));
 fireEvent.click(screen.getByRole('button',{name:'Shared',exact:true}));
 expect(document.querySelector('tr[data-instrument-id="B"]')).toHaveTextContent('Meter B');
 expect(document.querySelector('tr[data-instrument-id="A"]')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'All sources'}));
 fireEvent.click(screen.getByRole('button',{name:'Ascending'}));
 expect([...document.querySelectorAll('tr[data-instrument-id]')].map(row=>row.dataset.instrumentId)).toEqual(['C','B','A']);
 fireEvent.change(screen.getByLabelText('Search instruments'),{target:{value:'missing'}});
 expect(screen.getByText(/No instruments match/)).toBeInTheDocument();
});
it('creates an instrument through the table and saves it locally',async()=>{
 const save=vi.fn();render(<Harness save={save}/>);
 fireEvent.click(screen.getByRole('button',{name:'Add instrument',exact:true}));
 await waitFor(()=>expect(save).toHaveBeenCalled());
 expect(save.mock.calls[0][0]).toMatchObject({scope:'local',manufacturer:'',model:''});
 expect(save.mock.calls[0][1]).toEqual({requireSaved:true});
 expect(document.querySelectorAll('tr[data-instrument-id]')).toHaveLength(4);
});
it('removes only the selected records using table selection and Delete',async()=>{
 const remove=vi.fn();render(<Harness remove={remove}/>);
 const first=document.querySelector('tr[data-instrument-id="A"]');
 const third=document.querySelector('tr[data-instrument-id="C"]');
 fireEvent.mouseDown(first.querySelector("td.cell-description"));
 expect(screen.getByText("1 selected")).toBeInTheDocument();
 fireEvent.mouseDown(third.querySelector("td.cell-description"),{ctrlKey:true});
 expect(screen.getByText("2 selected")).toBeInTheDocument();
 fireEvent.keyDown(window,{key:'Delete'});
 await waitFor(()=>expect(remove).toHaveBeenCalledTimes(2));
 expect(remove.mock.calls.map(([id])=>id)).toEqual(['A','C']);
 expect(document.querySelector('tr[data-instrument-id="B"]')).toHaveTextContent('Meter B');
});
it('keeps failed saves available to retry',async()=>{
 const save=vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined);
 render(<Harness save={save}/>);
 fireEvent.click(screen.getByRole('button',{name:'Add instrument',exact:true}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
 fireEvent.click(screen.getByRole('button',{name:'Retry save'}));
 await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
 expect(save).toHaveBeenCalledTimes(2);
});

it('persists inline edits and keeps the shared original when making a local copy',async()=>{
 const save=vi.fn();render(<Harness save={save}/>);
 const row=document.querySelector('tr[data-instrument-id="B"]');
 fireEvent.mouseDown(row.querySelector('.inline-desc-combined'),{button:0});
 const model=screen.getByPlaceholderText('Model',{exact:true});
 fireEvent.change(model,{target:{value:'Edited shared'}});fireEvent.blur(model);
 await waitFor(()=>expect(save).toHaveBeenCalled());
 const updated=save.mock.calls.at(-1)[0];
 expect(updated).toMatchObject({scope:'local',sourceId:'B',model:'Edited shared'});
 expect(updated.id).not.toBe('B');
 await waitFor(()=>expect(document.querySelectorAll('tr[data-instrument-id]')).toHaveLength(4));
 expect(new Set([...document.querySelectorAll('tr[data-instrument-id]')].map(row=>row.dataset.instrumentId)).size).toBe(4);
 expect(within(document.querySelector('tr[data-instrument-id="B"]')).getByPlaceholderText('Model')).toHaveValue('B');
});
it('removes a demoted local entry from the library and retains other records',async()=>{
 const remove=vi.fn();render(<Harness remove={remove}/>);
 fireEvent.contextMenu(document.querySelector('tr[data-instrument-id="A"] .inline-sync-badge'));
 await waitFor(()=>expect(remove).toHaveBeenCalledExactlyOnceWith('A'));
 await waitFor(()=>expect(document.querySelector('tr[data-instrument-id="A"]')).toBeNull());
 expect(document.querySelectorAll('tr[data-instrument-id]')).toHaveLength(2);
});
