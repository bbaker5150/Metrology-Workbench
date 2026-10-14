import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import InstrumentLibraryModal from './InstrumentLibraryModal';
import UncertaintyPanel from '../../analysis/components/UncertaintyPanel';
import { ConfirmRecordDeletesContext } from '../../../contexts/RecordDeletePolicy';
vi.mock('plotly.js-dist', () => ({ default: {} }));
const definition = (id, scope='local') => ({ id, scope, manufacturer: 'Example', model: id, description: `Meter ${id}`, functions: [{id:'f', name:'Voltage', unit:'V', ranges:[{id:'r', min:0, max:10, unit:'V', resolution:0.01, tolerances:{reading:{value:1,unit:'%'}}}]}] });
const openInstrument = id => fireEvent.click(document.querySelector(`tr[data-instrument-id="${id}"] .instrument-library-edit`));
function Harness({ save=vi.fn(), remove=vi.fn(), close=vi.fn(), confirmDeletes=false, initial=[definition('A'),definition('B','validated'),definition('C')] }) {
 const [instruments,setInstruments]=useState(initial);
 return <ConfirmRecordDeletesContext.Provider value={confirmDeletes}><InstrumentLibraryModal isOpen instruments={instruments} onClose={close}
 onSaveToLibrary={async(value,options)=>{await save(value,options);setInstruments(previous=>[...previous.filter(item=>item.id!==value.id),value]);return value;}}
 onBatchAdd={vi.fn()} onDelete={async id=>{await remove(id);setInstruments(previous=>previous.filter(item=>item.id!==id));}} /></ConfirmRecordDeletesContext.Provider>;
}
it('selects names without expansion and opens the real table only from Edit',()=>{
 render(<Harness/>);
 expect(document.querySelectorAll('.instrument-equipment-table')).toHaveLength(1);
 // Portals need the same scope as the overview for live column widths and
 // expanded-editor rules to apply.
 expect(screen.getByRole('dialog', { name: 'Instrument library' })).toHaveClass('uncertainty-module');
 expect(document.querySelectorAll('.instrument-library-name')).toHaveLength(3);
 expect(document.querySelector('.cell-tolerance')).toBeNull();
 expect(screen.getByRole('heading',{name:'Instrument Library'})).toBeInTheDocument();
 expect(screen.queryByText('All changes saved')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Remove selected'})).not.toBeInTheDocument();
 fireEvent.click(document.querySelector('tr[data-instrument-id="A"] .instrument-library-name'));
 expect(document.querySelector('tr[data-instrument-id="A"]')).toHaveClass('selected-row');
 expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Use as UUT'})).not.toBeInTheDocument();
 expect(document.querySelector('.instrument-library-footer')).toBeNull();
 expect(document.querySelector('.cell-tolerance')).toBeNull();
 expect(document.querySelector('.instrument-equipment-table colgroup')).toBeNull();
 expect(screen.getAllByRole('columnheader').map(node=>node.textContent)).toEqual(['Description']);
 openInstrument('A');
 expect(document.querySelector('tr[data-instrument-id="A"] .cell-tolerance')).not.toBeNull();
 expect(document.querySelectorAll('.instrument-library-name')).toHaveLength(2);
 expect(screen.queryByRole('button',{name:'Back to names'})).not.toBeInTheDocument();
 expect(screen.queryByText(/of 3 instruments/)).not.toBeInTheDocument();
 fireEvent.keyDown(window,{key:'Escape'});
 expect(document.querySelectorAll('.instrument-library-name')).toHaveLength(3);
 expect(document.querySelector('.library-table')).toBeNull();
 expect(screen.queryByText('Type B')).not.toBeInTheDocument();
 expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
it.each([['session','uut'],['session','tmde'],['point','uut'],['point','tmde']])('copies selected library instruments to an empty %s %s table', (viewMode, kind)=>{
 const save=vi.fn();
 render(<><Harness/><UncertaintyPanel testPointData={{id:'point',viewMode,testPointInfo:{parameter:{name:'Voltage',value:5,unit:'V'}},components:[],tmdeTolerances:[]}}
   sessionData={{id:'target',uuts:[],tmdes:[],testPoints:[],measurementAreas:[],uncReq:{}}}
   currentUutSelection={[]} setCurrentUutSelection={()=>{}} onSessionSave={save}
   tmdeTolerancesData={[]} uutNominal={{value:5,unit:'V'}} setNotification={()=>{}} /></>);
 const library=screen.getByRole('dialog',{name:'Instrument library'});
 const source=library.querySelector('[data-instrument-id="A"]');
 fireEvent.click(source.querySelector('.instrument-library-name'));
 fireEvent.click(library.querySelector('[data-instrument-id="B"] .instrument-library-name'),{ctrlKey:true});
 const data=new Map();const dataTransfer={setData:(key,value)=>data.set(key,value),getData:key=>data.get(key)||'',get types(){return [...data.keys()]}};
 const drag=new Event('dragstart',{bubbles:true,cancelable:true});
 Object.assign(drag,{dataTransfer,workbenchPointerDrag:true});fireEvent(source,drag);
 expect(dataTransfer.effectAllowed).toBe('copy');
 const target=[...document.querySelectorAll(`[data-tour="${kind}-table"]`)].find(node=>!library.contains(node));
 fireEvent.drop(target.querySelector('td'),{dataTransfer});
 expect(save).toHaveBeenCalledTimes(1);
 const rows=save.mock.calls[0][0][kind==='uut'?'uuts':'tmdes'];
 expect(rows.map(row=>row.instrument.id)).toEqual(['A','B']);
 expect(rows.map(row=>row.instrument.scope)).toEqual(['local','validated']);
 expect(new Set(rows.map(row=>row.id)).size).toBe(2);
 expect(rows.every(row=>!['A','B'].includes(row.id))).toBe(true);
 expect(library.querySelectorAll('.instrument-library-name')).toHaveLength(3);
 expect(rows[0].instrument.functions[0].ranges[0].tolerances.reading.value).toBe(1);
});
it('shows qualifiers and inserted columns only for the instrument being edited',()=>{
 const qualified=definition('B');
 qualified.functions[0].ranges[0].qualifier={id:'q',text:'60 Hz',qualifier:{id:'q2',text:'23 °C'}};
 render(<Harness initial={[definition('A'),qualified,definition('C')]}/>);
 openInstrument('A');
 expect(document.querySelector('th[data-instrument-column="qualifier"]')).toBeNull();
 openInstrument('B');
 expect(document.querySelector('th[data-instrument-column="qualifier"]')).not.toBeNull();
 expect(document.querySelector('th[data-instrument-column="qualifier2"]')).not.toBeNull();
 const insert=document.querySelector('th[data-instrument-column="resolution"] .instrument-column-insert-button');
 fireEvent.click(insert);
 expect(document.querySelector('th[data-instrument-column^="custom:"]')).not.toBeNull();
 fireEvent.keyDown(window,{key:'Escape'});
 openInstrument('C');
 expect(document.querySelector('th[data-instrument-column^="qualifier"]')).toBeNull();
 expect(document.querySelector('th[data-instrument-column^="custom:"]')).toBeNull();
 fireEvent.keyDown(window,{key:'Escape'});
 openInstrument('B');
 expect(document.querySelector('th[data-instrument-column^="custom:"]')).not.toBeNull();
});
it('keeps multiple editors open independently of selection and internal action clicks',async()=>{
 const save=vi.fn();render(<Harness save={save}/>);
 openInstrument('A');openInstrument('C');
 const a=document.querySelector('tr[data-instrument-id="A"]');
 const c=document.querySelector('tr[data-instrument-id="C"]');
 expect(a.querySelector('.cell-tolerance')).not.toBeNull();
 expect(c.querySelector('.cell-tolerance')).not.toBeNull();
 expect(screen.getByRole('columnheader',{name:/Tolerance\/Uncertainty/})).toBeInTheDocument();
 // This changes table selection while both independent editors remain open.
 fireEvent.click(document.querySelector('tr[data-instrument-id="B"] .instrument-library-name'));
 fireEvent.click(within(a).getByTitle('Edit tolerance'));
 fireEvent.click(within(a).getByTitle('Asymmetric tolerance'));
 fireEvent.click(within(a).getByTitle('Single-sided tolerance'));
 await waitFor(()=>expect(save).toHaveBeenCalled());
 expect(a.querySelector('.cell-tolerance')).not.toBeNull();
 expect(c.querySelector('.cell-tolerance')).not.toBeNull();
 expect(within(a).getByTitle('Single-sided tolerance')).toHaveAttribute('aria-pressed','true');
 fireEvent.keyDown(window,{key:'Escape'});
 expect(document.querySelectorAll('.instrument-library-name')).toHaveLength(3);
});
it('closes remove confirmation and keeps the remaining editor open',async()=>{
 const remove=vi.fn();render(<Harness remove={remove} confirmDeletes/>);
 openInstrument('C');openInstrument('A');
 fireEvent.keyDown(window,{key:'Delete'});
 const dialog=screen.getByRole('alertdialog',{name:'Remove instruments'});
 fireEvent.click(within(dialog).getByRole('button',{name:'Remove',exact:true}));
 expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
 await waitFor(()=>expect(remove).toHaveBeenCalledExactlyOnceWith('A'));
 expect(document.querySelector('tr[data-instrument-id="A"]')).toBeNull();
 expect(document.querySelector('tr[data-instrument-id="C"] .cell-tolerance')).not.toBeNull();
});
it('commits a focused edit before collapsing on outside click or Escape',async()=>{
 const save=vi.fn();render(<><Harness save={save}/><div className="instrument-table-viewport" data-testid="workspace-table">Workspace table</div></>);
 for (const dismiss of ['outside','escape']) {
   openInstrument('A');
   fireEvent.mouseDown(document.querySelector('tr[data-instrument-id="A"] .inline-desc-combined'),{button:0});
   const model=screen.getByPlaceholderText('Model',{exact:true});
   model.focus();fireEvent.change(model,{target:{value: dismiss}});
   if (dismiss==='outside') fireEvent.click(screen.getByTestId('workspace-table'));
   else fireEvent.keyDown(model,{key:'Escape'});
   expect(document.querySelectorAll('.instrument-library-name')).toHaveLength(3);
   await waitFor(()=>expect(save.mock.calls.at(-1)?.[0].model).toBe(dismiss));
 }
});
it('filters by source without sorting controls',()=>{
 render(<Harness/>);
 fireEvent.click(screen.getByLabelText('Filter instruments'));
 fireEvent.click(screen.getByRole('button',{name:'Shared',exact:true}));
 expect(document.querySelector('tr[data-instrument-id="B"]')).toHaveTextContent('Meter B');
 expect(document.querySelector('tr[data-instrument-id="A"]')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'All sources'}));
 expect(screen.queryByText('Sort by')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Ascending'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Done'})).not.toBeInTheDocument();
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
 fireEvent.click(first.querySelector('.instrument-library-name'));
 expect(first).toHaveClass("selected-row");
 fireEvent.click(third.querySelector('.instrument-library-name'),{ctrlKey:true});
 expect(first).toHaveClass("selected-row");
 expect(third).toHaveClass("selected-row");
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
 openInstrument('B');
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
it('keeps local library entries local while allowing shared entries to become local',async()=>{
 const remove=vi.fn(), save=vi.fn();render(<Harness remove={remove} save={save}/>);
 openInstrument('A');
 const badge=document.querySelector('tr[data-instrument-id="A"] .inline-sync-badge');
 expect(badge).not.toHaveAccessibleName(/session only/);
 fireEvent.contextMenu(badge);
 expect(remove).not.toHaveBeenCalled();
 expect(save).not.toHaveBeenCalled();
 expect(document.querySelector('tr[data-instrument-id="A"] .cell-tolerance')).not.toBeNull();
 openInstrument('B');
 fireEvent.contextMenu(document.querySelector('tr[data-instrument-id="B"] .inline-sync-badge'));
 await waitFor(()=>expect(save).toHaveBeenCalled());
 expect(save.mock.calls[0][0]).toMatchObject({scope:'local',sourceId:'B'});
 expect(remove).not.toHaveBeenCalled();
});
it('keeps expanded instruments open when moving the library header',()=>{
 render(<Harness/>);openInstrument('A');openInstrument('C');
 const modal=screen.getByRole('dialog',{name:'Instrument library'});
 const title=screen.getByRole('heading',{name:'Instrument Library'});
 const left=parseFloat(modal.style.left);
 fireEvent.mouseDown(title,{clientX:300,clientY:100,button:0});
 fireEvent.mouseMove(document,{clientX:380,clientY:180});
 fireEvent.mouseUp(document);
 fireEvent.click(title);
 expect(parseFloat(modal.style.left)).toBe(left+80);
 for(const id of ['A','C']) expect(modal.querySelector(`tr[data-instrument-id="${id}"] .cell-tolerance`)).not.toBeNull();
});

it.each(['Table', 'Equation'])('saves the primary uncertainty as %s through the TMDE type menu', async label => {
 const save=vi.fn();render(<Harness save={save}/>);
 openInstrument('A');
 const row=document.querySelector('tr[data-instrument-id="A"]');
 fireEvent.click(within(row).getByTitle('Edit tolerance'));
 fireEvent.click(within(row).getByRole('button',{name:'Change uncertainty type'}));
 fireEvent.click(within(row).getByRole('button',{name:label,exact:true}));
 await waitFor(()=>expect(save).toHaveBeenCalled());
 expect(save.mock.calls.at(-1)[0].functions[0].ranges[0].tolerances.tmdeUncertaintyDefinition.kind).toBe(label.toLowerCase());
 expect(row.querySelector('.dynamic-budget-editor')).toHaveAttribute('data-dynamic-kind',label.toLowerCase());
});

it('adds, names, changes type and restores additional uncertainties in the library',async()=>{
 const save=vi.fn();const view=render(<Harness save={save}/>);
 openInstrument('A');
 fireEvent.click(within(document.querySelector('tr[data-instrument-id="A"]')).getByTitle('Edit tolerance'));
 fireEvent.click(screen.getByRole('button',{name:'Add a secondary uncertainty'}));
 await waitFor(()=>expect(save.mock.calls.at(-1)?.[0].tmdeSecondaryUncertainties).toHaveLength(1));
 const name=screen.getByRole('textbox',{name:'Uncertainty name'});
 fireEvent.change(name,{target:{value:'Thermal drift'}});fireEvent.keyDown(name,{key:'Enter'});
 const source=document.querySelector('.instrument-uncertainty-row');
 fireEvent.click(within(source).getByRole('button',{name:'Change uncertainty type'}));
 fireEvent.click(within(source).getByRole('button',{name:'Equation',exact:true}));
 await waitFor(()=>expect(save.mock.calls.at(-1)?.[0].tmdeSecondaryUncertainties[0]).toMatchObject({name:'Thermal drift',kind:'equation'}));
 const saved=save.mock.calls.at(-1)[0];
 expect(saved.functions[0].ranges[0].tolerances.reading.value).toBe(1);
 view.unmount();
 render(<InstrumentLibraryModal isOpen instruments={[saved]} onClose={()=>{}} onSaveToLibrary={save}/>);
 openInstrument('A');
 expect(document.querySelector('.instrument-uncertainty-row')).toHaveTextContent('Thermal drift');
 fireEvent.click(document.querySelector('.instrument-uncertainty-row .cell-tolerance button'));
 expect(document.querySelector('.instrument-uncertainty-row .dynamic-budget-editor')).toHaveAttribute('data-dynamic-kind','equation');
});
