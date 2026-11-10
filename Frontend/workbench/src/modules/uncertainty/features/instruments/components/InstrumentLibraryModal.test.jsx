import React, { useState } from 'react';
import { flushSync } from 'react-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import axios from 'axios';
import InstrumentLibraryModal from './InstrumentLibraryModal';
import UncertaintyPanel from '../../analysis/components/UncertaintyPanel';
import { ConfirmRecordDeletesContext } from '../../../contexts/RecordDeletePolicy';
vi.mock('axios', () => ({default: {get: vi.fn(async () => ({data:{canValidate:false,reviews:[]}})), post: vi.fn()}}));
vi.mock('plotly.js-dist', () => ({ default: {} }));
const definition = (id, scope='local') => ({ id, scope, manufacturer: 'Example', model: id, description: `Meter ${id}`, functions: [{id:'f', name:'Voltage', unit:'V', ranges:[{id:'r', min:0, max:10, unit:'V', resolution:0.01, tolerances:{reading:{value:1,unit:'%'}}}]}] });
const openInstrument = id => fireEvent.click(document.querySelector(`tr[data-instrument-id="${id}"] .instrument-library-specifications`));
function Harness({ save=vi.fn(), remove=vi.fn(), close=vi.fn(), confirmDeletes=false, initial=[definition('A'),definition('B','validated'),definition('C')], initialDrafts=[] }) {
 const [instruments,setInstruments]=useState(initial);
 const [drafts,setDrafts]=useState(initialDrafts);
 return <ConfirmRecordDeletesContext.Provider value={confirmDeletes}><InstrumentLibraryModal isOpen instruments={instruments} onClose={close}
 libraryDraftRows={drafts} onChangeDrafts={(rows,present)=>setDrafts(previous=>[...previous.filter(row=>!rows.some(next=>next.id===row.id)),...(present?rows:[])])}
 onSaveToLibrary={async(value,options)=>{await save(value,options);setInstruments(previous=>[...previous.filter(item=>item.id!==value.id),value]);return value;}}
 onBatchAdd={vi.fn()} onDelete={async (id,options)=>{await (options ? remove(id,options) : remove(id));setInstruments(previous=>previous.filter(item=>item.id!==id));}} /></ConfirmRecordDeletesContext.Provider>;
}
it('selects names without expansion and opens details from its row specifications control',()=>{
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
 expect(document.querySelectorAll('.instrument-equipment-table colgroup col')).toHaveLength(2);
 expect(screen.getAllByRole('columnheader').map(node=>node.textContent)).toEqual(['Description','Status']);
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
it('selects a collapsed row from its padding or its name and leaves dragging to the pointer handler',()=>{
 render(<Harness/>);
 const row=document.querySelector('tr[data-instrument-id="B"]');
 expect(row.draggable).toBe(false);
 const name=row.querySelector('.instrument-library-name');
 const pointer=(target,type,x,buttons)=>fireEvent(target,Object.assign(new MouseEvent(type,{
   bubbles:true,cancelable:true,button:0,buttons,clientX:x,clientY:20
 }),{pointerId:1,pointerType:'mouse'}));
 pointer(name,'pointerdown',20,1);
 pointer(window,'pointermove',23,1);
 expect(document.querySelector('.instrument-pointer-drag-preview')).toBeNull();
 pointer(window,'pointerup',23,0);
 fireEvent.click(row.querySelector('.cell-description'),{detail:1});
 fireEvent.click(name,{detail:1});
 expect(row).toHaveClass('selected-row');
 pointer(name,'pointerdown',20,1);
 pointer(window,'pointermove',60,1);
 expect(document.querySelector('.instrument-pointer-drag-preview')).toHaveTextContent('Add instrument');
 pointer(window,'pointerup',60,0);
 expect(document.querySelector('.instrument-pointer-drag-preview')).toBeNull();
});
it('keeps a range menu open for option scrolling and dismisses it when the library scrolls',()=>{
 render(<Harness/>);
 const trigger=document.querySelector('.instrument-range-menu button');
 fireEvent.click(trigger);fireEvent.scroll(screen.getByRole('listbox'));
 expect(trigger).toHaveAttribute('aria-expanded','true');
 fireEvent.scroll(document.querySelector('.instrument-table-scroll'));
 expect(trigger).toHaveAttribute('aria-expanded','false');
 expect(screen.queryByRole('listbox')).toBeNull();
});
it('clears the leftover name focus on pointer Shift-selection while preserving keyboard focus',()=>{
 render(<Harness/>);
 const names=[...document.querySelectorAll('.instrument-library-name')];
 names[2].focus();fireEvent.click(names[2],{detail:1});
 expect(names[2]).not.toHaveFocus();
 // A keyboard-selected anchor may still own focus when Shift-click's
 // prevented mouse-down leaves it on the previous row.
 names[2].focus();fireEvent.click(names[0],{detail:1,shiftKey:true});
 expect(names[2]).not.toHaveFocus();
 expect(document.querySelectorAll('.instrument-library-name-row.selected-row')).toHaveLength(3);
 names[1].focus();fireEvent.click(names[1],{detail:0});
 expect(names[1]).toHaveFocus();
 expect(names[1]).toHaveAttribute('aria-pressed','false');
 fireEvent.click(names[1],{detail:0});
 expect(names[1]).toHaveFocus();
 expect(names[1]).toHaveAttribute('aria-pressed','true');
});
it('uses the table identity including Tag without repeating manufacturer/model in the name',()=>{
 const instrument={...definition('A'),nickname:'REF-12',description:'Example A reference meter'};
 render(<Harness initial={[instrument]}/>);
 expect(document.querySelector('.instrument-library-name')).toHaveTextContent('(REF-12) Example A reference meter');
 expect(screen.getByRole('button',{name:'View or Edit Instrument Specifications (REF-12) Example A reference meter'})).toBeInTheDocument();
 openInstrument('A');
 expect(document.querySelector('.inline-desc-combined')).toHaveTextContent('(REF-12) Example A reference meter');
});
it('keeps its dragged position and scale when toggled closed and open',()=>{
 const props={instruments:[definition('A')],onClose:vi.fn(),zoom:1.2};
 const {rerender}=render(<InstrumentLibraryModal {...props} isOpen/>);
 const modal=screen.getByRole('dialog',{name:'Instrument library'});
 const left=parseFloat(modal.style.left),top=parseFloat(modal.style.top);
 fireEvent.mouseDown(screen.getByRole('heading',{name:'Instrument Library'}),{clientX:400,clientY:100});
 fireEvent.mouseMove(document,{clientX:440,clientY:130});fireEvent.mouseUp(document);
 rerender(<InstrumentLibraryModal {...props} isOpen={false}/>);
 rerender(<InstrumentLibraryModal {...props} isOpen/>);
 const reopened=screen.getByRole('dialog',{name:'Instrument library'});
 expect(parseFloat(reopened.style.left)).toBe(left+40);
 expect(parseFloat(reopened.style.top)).toBe(top+30);
 expect(reopened.querySelector('.scoped-zoom-content').style.zoom).toBe('1.2');
});
it('preserves expanded instruments, editors, selection and scroll while minimized',async()=>{
 const save=vi.fn();
 function ToggleLibrary(){const [open,setOpen]=useState(true),[data,setData]=useState(()=>[definition('A'),definition('B')]);return <><button data-library-toggle onClick={()=>setOpen(value=>!value)}>Toggle library</button><InstrumentLibraryModal isOpen={open} instruments={data} onClose={()=>setOpen(false)} onSaveToLibrary={async value=>{save(value);setData(old=>old.map(item=>item.id===value.id?value:item));}}/><button>Workspace</button></>;}
 render(<ToggleLibrary/>);
 openInstrument('B');openInstrument('A');
 const modal=screen.getByRole('dialog',{name:'Instrument library'});
 fireEvent.click(within(modal.querySelector('tr[data-instrument-id="A"]')).getByTitle('Edit tolerance'));
 const editor=modal.querySelector('.inline-tolerance-editor'), input=editor.querySelector('.inline-tolerance-input');
 input.focus();fireEvent.change(input,{target:{value:'2.5'}});
 const scroller=modal.querySelector('.instrument-table-scroll');scroller.scrollTop=80;
 for(const close of [screen.getByRole('button',{name:'Toggle library'}),screen.getByRole('button',{name:'Close instrument library'})]){
   fireEvent.pointerDown(close);fireEvent.mouseDown(close);fireEvent.mouseUp(close);fireEvent.click(close);
   expect(screen.queryByRole('dialog',{name:'Instrument library'})).toBeNull();
   fireEvent.blur(input);
   fireEvent.click(screen.getByRole('button',{name:'Workspace'}));fireEvent.keyDown(window,{key:'Escape'});
   fireEvent.click(screen.getByRole('button',{name:'Toggle library'}));
   await waitFor(()=>expect(screen.getByRole('dialog',{name:'Instrument library'})).toBeVisible());
   expect(modal.querySelector('.inline-tolerance-editor')).toBe(editor);
   expect(modal.querySelectorAll('.instrument-library-specifications[aria-expanded="true"]')).toHaveLength(2);
   expect(input).toHaveValue('2.5');
   expect(scroller.scrollTop).toBe(80);
   expect(modal.querySelector('tr[data-instrument-id="A"]')).toHaveClass('instrument-selected');
 }
 fireEvent.mouseDown(modal.querySelector('tr[data-instrument-id="A"] .inline-desc-combined'),{button:0});
 const description=modal.querySelector('.inline-desc-fields');
 const model=within(description).getByPlaceholderText('Model',{exact:true});model.focus();
 const toggle=screen.getByRole('button',{name:'Toggle library'});
 fireEvent.blur(model,{relatedTarget:toggle});fireEvent.click(toggle);fireEvent.click(toggle);
 await new Promise(resolve=>setTimeout(resolve,180));
 expect(modal.querySelector('.inline-desc-fields')).toBe(description);
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
 const table=within(target).getByRole('table');
 expect(table.querySelector('tbody').children).toHaveLength(0);
 // Empty instrument tables deliberately have no placeholder row. Drop on
 // their actual header cell and keep checking the complete copied payload.
 fireEvent.drop(table.querySelector('th'),{dataTransfer});
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
it('selects qualifier rows and shared/nested spans like the instrument tables',async()=>{
 const qualified=definition('A');
 qualified.functions[0].ranges=[0,1,2].map(index=>({
   ...qualified.functions[0].ranges[0],id:`r${index}`,qualifierGroupId:'parent',
   qualifier:{id:`q${index}`,text:index<2?'60 Hz':'400 Hz',qualifier:{id:`nested${index}`,text:index===1?'1 year':'90 days'}},
 }));
 render(<Harness initial={[qualified,definition('B')]}/>);
 openInstrument('A');
 const rows=[...document.querySelectorAll('tr[data-range-group="tmde:A"]')];
 expect(rows).toHaveLength(3);
 const shared=rows[0].querySelector('[data-qualifier-cell="1"]');
 expect(shared).toHaveAttribute('rowspan','2');
 const nested=rows[1].querySelector('[data-qualifier-cell="2"]');
 fireEvent.mouseDown(nested);fireEvent.pointerMove(nested);
 expect(rows.map(row=>row.dataset.rangeSelected)).toEqual(['false','true','false']);
 await waitFor(()=>expect(nested).toHaveAttribute('data-cell-selected'));
 expect(shared).toHaveAttribute('data-cell-selected');
 expect(rows[1].querySelector('.cell-tolerance')).toHaveAttribute('data-cell-selected');
 expect(rows[0].querySelector('.cell-tolerance')).not.toHaveAttribute('data-cell-selected');
 expect(rows[2].querySelector('[data-qualifier-cell="1"]')).not.toHaveAttribute('data-cell-selected');
 expect(nested).toHaveAttribute('data-actions-selected','true');
 fireEvent.mouseDown(shared);
 expect(rows.map(row=>row.dataset.rangeSelected)).toEqual(['true','true','false']);
 const last=rows[2].querySelector('[data-qualifier-cell="2"]');
 fireEvent.mouseDown(last,{ctrlKey:true});
 expect(rows.every(row=>row.dataset.rangeSelected==='true')).toBe(true);
 fireEvent.mouseDown(last,{ctrlKey:true});
 expect(rows.map(row=>row.dataset.rangeSelected)).toEqual(['true','true','false']);
 fireEvent.mouseDown(nested);
 fireEvent.mouseDown(last,{shiftKey:true});
 expect(rows.map(row=>row.dataset.rangeSelected)).toEqual(['false','true','true']);
 expect(document.querySelector('tr[data-instrument-id="B"]')).not.toHaveClass('selected-row');
});
it.each(['.cell-tolerance','.cell-value:not([data-range-cell])','.cell-distribution'])('selects the corresponding qualifier when clicking %s in the library',async column=>{
 const qualified=definition('A');
 qualified.functions[0].ranges=[0,1,2].map(index=>({
   ...qualified.functions[0].ranges[0],id:`r${index}`,qualifierGroupId:'parent',
   qualifier:{id:`q${index}`,text:index<2?'60 Hz':'400 Hz',qualifier:{id:`n${index}`,text:index===1?'1 year':'90 days'}},
 }));
 render(<Harness initial={[qualified,definition('B')]}/>);
 openInstrument('A');
 const rows=[...document.querySelectorAll('tr[data-range-group="tmde:A"]')];
 fireEvent.mouseDown(rows[1].querySelector(column));
 fireEvent.pointerMove(rows[1].querySelector(column));
 expect(rows.map(row=>row.dataset.rangeSelected)).toEqual(['false','true','false']);
 await waitFor(()=>expect(rows[1].querySelector('[data-qualifier-cell="2"]')).toHaveAttribute('data-cell-selected'));
 expect(rows[0].querySelector('[data-qualifier-cell="1"]')).toHaveAttribute('data-cell-selected');
 expect(rows[0].querySelector('[data-range-cell]:not([data-qualifier-cell])')).toHaveAttribute('data-cell-selected');
 expect(rows[0].querySelector('.cell-description')).toHaveAttribute('data-cell-selected');
 expect(rows[0].querySelector('[data-qualifier-cell="2"]')).not.toHaveAttribute('data-cell-selected');
 expect(rows[2].querySelector('[data-qualifier-cell="1"]')).not.toHaveAttribute('data-cell-selected');
 expect(rows[0].querySelector(column)).not.toHaveAttribute('data-cell-selected');
 expect(rows[2].querySelector(column)).not.toHaveAttribute('data-cell-selected');
 fireEvent.mouseDown(rows[2].querySelector(column),{shiftKey:true});
 expect(rows.map(row=>row.dataset.rangeSelected)).toEqual(['false','true','true']);
 fireEvent.mouseDown(rows[1].querySelector(column),{ctrlKey:true});
 expect(rows.map(row=>row.dataset.rangeSelected)).toEqual(['false','false','true']);
 // Returning to Description restores whole-instrument selection for dragging.
 fireEvent.mouseDown(rows[0].querySelector('.cell-description'));
 expect(rows.every(row=>row.dataset.rangeSelected==='true')).toBe(true);
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
it('shows local/shared sync actions in simplified rows and uses search without a filter menu',()=>{
 const save=vi.fn();render(<Harness save={save}/>);
 expect(screen.queryByRole('button',{name:'Filter instruments'})).not.toBeInTheDocument();
 const local=document.querySelector('tr[data-instrument-id="A"]');
 const shared=document.querySelector('tr[data-instrument-id="B"]');
 expect(within(local).getByRole('button',{name:'My library. Click to submit for SME validation.'})).toBeInTheDocument();
 expect(within(shared).getByRole('button',{name:'Validated shared. Right-click to make a local copy.'})).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Search instruments'),{target:{value:'Meter B'}});
 expect(document.querySelector('tr[data-instrument-id="B"]')).toHaveTextContent('Meter B');
 expect(document.querySelector('tr[data-instrument-id="A"]')).toBeNull();
 fireEvent.change(screen.getByLabelText('Search instruments'),{target:{value:'missing'}});
 expect(screen.getByText(/No instruments match/)).toBeInTheDocument();
});
it('toggles specifications per row while preserving multi-selection and other expanded instruments',()=>{
 render(<Harness/>);
 const search=screen.getByLabelText('Search instruments').parentElement;
 expect(search.parentElement.querySelector('.instrument-library-specifications')).toBeNull();
 const add=within(search).getByRole('button',{name:'Add instrument'});
 expect(add).toHaveClass('btn-add-item','btn-add-column','function-header-action-btn');
 const row=id=>document.querySelector(`tr[data-instrument-id="${id}"]`);
 const control=id=>row(id).querySelector('.instrument-library-specifications');
 expect(control('A')).toHaveAttribute('title','View or Edit Instrument Specifications');
 expect(row('A').querySelector('.cell-description')).toContainElement(control('A'));
 fireEvent.click(row('A').querySelector('.instrument-library-name'));
 fireEvent.click(row('C').querySelector('.instrument-library-name'),{ctrlKey:true});
 fireEvent.click(control('A'));
 expect(row('A').querySelector('.cell-tolerance')).not.toBeNull();
 expect(row('C').querySelector('.instrument-library-name')).toHaveAttribute('aria-pressed','true');
 expect(control('A')).toHaveAttribute('title','Hide Instrument Specifications');
 expect(control('A')).toHaveAttribute('aria-expanded','true');
 fireEvent.click(control('C'));fireEvent.click(control('A'));
 expect(row('A').querySelector('.instrument-library-name')).toHaveAttribute('aria-pressed','true');
 expect(row('C').querySelector('.cell-tolerance')).not.toBeNull();
 expect(control('A')).toHaveAttribute('aria-expanded','false');
 fireEvent.click(control('A'));fireEvent.click(control('C'));
 expect(row('A').querySelector('.cell-tolerance')).not.toBeNull();
 expect(row('C').querySelector('.instrument-library-name')).toHaveAttribute('aria-pressed','true');
});
it('keeps a new instrument session-only through edits until explicitly saved locally',async()=>{
 const save=vi.fn();render(<Harness save={save}/>);
 fireEvent.click(screen.getByRole('button',{name:'Add instrument',exact:true}));
 expect(save).not.toHaveBeenCalled();
 expect(document.querySelectorAll('tr[data-instrument-id]')).toHaveLength(4);
 const row=[...document.querySelectorAll('tr[data-instrument-id]')].find(node=>!['A','B','C'].includes(node.dataset.instrumentId));
 expect(row.querySelector('.inline-sync-badge')).toHaveClass('inline-sync-badge--red');
 fireEvent.mouseDown(row.querySelector('.inline-desc-combined'),{button:0});
 const make=within(row).getByPlaceholderText('Mfr.');
 fireEvent.focus(make);
 expect(screen.queryByRole('listbox',{name:'Choose instrument'})).not.toBeInTheDocument();
 fireEvent.change(make,{target:{value:'Example'}});
 expect(screen.queryByRole('listbox',{name:'Choose instrument'})).not.toBeInTheDocument();
 make.focus(); fireEvent.keyDown(make,{key:'Escape'});
 expect(save).not.toHaveBeenCalled();
 const collapsed=document.querySelector(`tr[data-instrument-id="${row.dataset.instrumentId}"]`);
 expect(collapsed).toHaveTextContent('Example');
 expect(collapsed.querySelector('.inline-sync-badge')).toHaveClass('inline-sync-badge--red');
 fireEvent.click(collapsed.querySelector('.inline-sync-badge'));
 await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
 expect(save.mock.calls[0][0]).toMatchObject({scope:'local',manufacturer:'Example'});
 expect(save.mock.calls[0][1]).toEqual({requireSaved:true});
});
it('discards an untouched new row on Escape without writing a library record',()=>{
 const save=vi.fn(), remove=vi.fn();
 const existing={id:'empty',scope:'local',description:'',functions:[]};
 render(<Harness save={save} remove={remove} initial={[existing]}/>);
 fireEvent.click(screen.getByRole('button',{name:'Add instrument',exact:true}));
 expect(document.querySelectorAll('tr[data-instrument-id]')).toHaveLength(2);
 fireEvent.keyDown(window,{key:'Escape'});
 expect(document.querySelectorAll('tr[data-instrument-id]')).toHaveLength(1);
 expect(document.querySelector('tr[data-instrument-id="empty"]')).not.toBeNull();
 expect(save).not.toHaveBeenCalled();
 expect(remove).not.toHaveBeenCalled();
});
it('keeps copied and cut session drafts editable in the library without saving them locally',async()=>{
 const save=vi.fn();
 const draft={id:'draft-row',name:'Temporary meter',nickname:'DRAFT',instrument:{...definition('draft-definition','session'),description:'Temporary meter'}};
 draft.instrument.functions[0].ranges.push({...draft.instrument.functions[0].ranges[0],id:'second-range',min:10,max:20});
 render(<Harness save={save} initial={[]} initialDrafts={[draft]}/>);
 fireEvent.keyDown(window,{key:'Escape'});
 const source=document.querySelector('tr[data-instrument-id="draft-row"]');
 fireEvent.click(source.querySelector('.instrument-library-name'));
 fireEvent.keyDown(window,{key:'c',ctrlKey:true});fireEvent.keyDown(window,{key:'v',ctrlKey:true});
 expect(document.querySelectorAll('tr[data-instrument-id]')).toHaveLength(2);
 const copy=[...document.querySelectorAll('tr[data-instrument-id]')].find(row=>row.dataset.instrumentId!=='draft-row');
 const copyId=copy.dataset.instrumentId;
 expect(copy).toHaveTextContent('(DRAFT)');
 expect(copy.querySelector('.inline-sync-badge')).toHaveClass('inline-sync-badge--red');
 fireEvent.click(copy.querySelector('.instrument-range-menu button'));
 fireEvent.click(within(screen.getByRole('listbox')).getAllByRole('option')[1]);
 expect(copy.querySelector('.instrument-range-menu')).toHaveTextContent('10 to 20 V');
 fireEvent.keyDown(window,{key:'x',ctrlKey:true});
 expect(document.querySelectorAll('tr[data-instrument-id]')).toHaveLength(1);
 fireEvent.click(document.querySelector('tr[data-instrument-id="draft-row"] .instrument-library-name'));
 fireEvent.keyDown(window,{key:'v',ctrlKey:true});
 expect(document.querySelectorAll('tr[data-instrument-id]')).toHaveLength(2);
 openInstrument(copyId);
 fireEvent.mouseDown(document.querySelector(`tr[data-instrument-id="${copyId}"] .inline-desc-combined`),{button:0});
 const model=screen.getByPlaceholderText('Model',{exact:true});
 fireEvent.change(model,{target:{value:'Edited copy'}});fireEvent.blur(model);
 fireEvent.keyDown(window,{key:'Escape'});
 expect(document.querySelector(`tr[data-instrument-id="${copyId}"]`)).toHaveTextContent('Edited copy');
 expect(document.querySelector('tr[data-instrument-id="draft-row"]')).not.toHaveTextContent('Edited copy');
 expect(document.querySelectorAll('.inline-sync-badge--red')).toHaveLength(2);
 expect(save).not.toHaveBeenCalled();
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
 expect(remove).not.toHaveBeenCalled();
 fireEvent.click(within(screen.getByRole('alertdialog',{name:'Remove instruments'})).getByRole('button',{name:'Remove',exact:true}));
 await waitFor(()=>expect(remove).toHaveBeenCalledTimes(2));
 expect(remove.mock.calls.map(([id])=>id)).toEqual(['A','C']);
 expect(document.querySelector('tr[data-instrument-id="B"]')).toHaveTextContent('Meter B');
});

it('requires a masked password and explicit confirmation for shared library deletion',async()=>{
 const remove=vi.fn().mockRejectedValueOnce({response:{data:{detail:'Invalid shared-library password.'}}});
 render(<Harness remove={remove}/>);
 const select=()=>fireEvent.click(document.querySelector('tr[data-instrument-id="B"] .instrument-library-name'));
 select(); fireEvent.keyDown(window,{key:'Delete'});
 let dialog=screen.getByRole('alertdialog',{name:'Remove instruments'});
 const password=within(dialog).getByLabelText('Shared library password');
 expect(password).toHaveAttribute('type','password');
 fireEvent.click(within(dialog).getByRole('button',{name:'Remove',exact:true}));
 expect(remove).not.toHaveBeenCalled();
 fireEvent.change(password,{target:{value:'wrong'}});
 fireEvent.click(within(dialog).getByRole('button',{name:'Remove',exact:true}));
 await screen.findByText('Invalid shared-library password.');
 expect(document.querySelector('tr[data-instrument-id="B"]')).not.toBeNull();
 fireEvent.click(within(screen.getByRole('alertdialog')).getByTitle('Close'));
 fireEvent.keyDown(window,{key:'Delete'});
 dialog=screen.getByRole('alertdialog',{name:'Remove instruments'});
 fireEvent.change(within(dialog).getByLabelText('Shared library password'),{target:{value:'calibrate'}});
 fireEvent.click(within(dialog).getByRole('button',{name:'Remove',exact:true}));
 await waitFor(()=>expect(document.querySelector('tr[data-instrument-id="B"]')).toBeNull());
 expect(remove).toHaveBeenLastCalledWith('B',{password:'calibrate'});
});

it.each(['session','point'])('deletes a dropped workspace instrument instead of a stale library selection in %s view',viewMode=>{
 const remove=vi.fn(), deleteWorkspace=vi.fn();
 function Workspace(){const [session,setSession]=useState({id:'drop-delete',uuts:[],tmdes:[],testPoints:[],measurementAreas:[]});
  return <><Harness remove={remove}/><UncertaintyPanel testPointData={{id:'p',viewMode,testPointInfo:{parameter:{name:'Voltage',value:5,unit:'V'}},components:[],tmdeTolerances:[]}} sessionData={session}
    onSessionSave={setSession} onDeleteTmdeDefinition={deleteWorkspace} tmdeTolerancesData={[]} uutNominal={{value:5,unit:'V'}} /></>;}
 render(<Workspace/>);
 const library=screen.getByRole('dialog',{name:'Instrument library'});
 const source=library.querySelector('tr[data-instrument-id="A"]');
 fireEvent.click(source.querySelector('.instrument-library-name'));
 const values={};const dataTransfer={setData:(key,value)=>{values[key]=value;},getData:key=>values[key]||'',types:[]};
 const drag=new Event('dragstart',{bubbles:true,cancelable:true});
 Object.assign(drag,{dataTransfer,workbenchPointerDrag:true});fireEvent(source,drag);dataTransfer.types=Object.keys(values);
 const target=[...document.querySelectorAll('[data-tour="tmde-table"]')].find(node=>!library.contains(node));
 fireEvent.drop(target.querySelector('th'),{dataTransfer});
 fireEvent.click(library.querySelector('tr[data-instrument-id="C"] .instrument-library-name'));
 const row=target.querySelector('tr[data-instrument-id]');
 const cell=row.querySelector('.cell-description');
 fireEvent.pointerDown(cell,{button:0});fireEvent.mouseDown(cell,{button:0});fireEvent.click(cell);
 expect(row).toHaveClass('instrument-selected');
 expect(library.querySelectorAll('tr.selected-row, tr.instrument-selected')).toHaveLength(0);
 fireEvent.keyDown(window,{key:'Delete'});
 expect(deleteWorkspace).toHaveBeenCalledWith([row.dataset.instrumentId]);
 expect(remove).not.toHaveBeenCalled();
 expect(screen.queryByRole('alertdialog',{name:'Remove instruments'})).toBeNull();
});

it('browses ranges with specifications and qualifiers beneath the library description without expanding or saving',()=>{
 const instrument=definition('A');
 instrument.qualifierColumnNames=['Frequency','Interval'];
 instrument.functions[0].ranges=[
   {id:'r1',min:0,max:10,unit:'V',qualifier:{text:'60 Hz',qualifier:{text:'90-day'}},tolerances:{reading:{value:1,unit:'%',distribution:'2'}}},
   {id:'r2',min:0,max:20,unit:'V',qualifier:{text:'1000 Hz',qualifier:{text:'1-year'}},tolerances:{reading:{value:2,unit:'%',distribution:'2'}}},
 ];
 const save=vi.fn();render(<Harness initial={[instrument]} save={save}/>);
 const row=()=>document.querySelector('tr[data-instrument-id="A"]');
 const menu=row().querySelector('.instrument-range-menu');
 expect(menu.previousElementSibling).toHaveClass('instrument-library-name');
 const trigger=within(menu).getByRole('button');
 expect(trigger).toHaveTextContent('Range: 0 to 10 V');
 expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
 fireEvent.click(trigger);
 const list=screen.getByRole('listbox',{name:trigger.getAttribute('aria-label')});
 const options=within(list).getAllByRole('option');
 expect(options).toHaveLength(2);
 expect(options[0]).toHaveTextContent('0 to 10 V | Frequency: 60 Hz | Interval: 90-day | ± 1% IV | Normal (95.45%)');
 fireEvent.click(options[1]);
 expect(trigger).toHaveTextContent('Range: 0 to 20 V | Frequency: 1000 Hz | Interval: 1-year');
 expect(row().querySelector('.cell-tolerance')).toBeNull();
 expect(save).not.toHaveBeenCalled();
 fireEvent.click(trigger);
 expect(within(screen.getByRole('listbox')).getByRole('option',{selected:true})).toHaveTextContent('0 to 20 V');
 fireEvent.keyDown(screen.getByRole('option',{selected:true}),{key:'Escape'});
 expect(screen.queryByRole('listbox')).toBeNull();
 expect(trigger).toHaveFocus();
 expect(row().querySelector('.cell-tolerance')).toBeNull();
});
it('keeps failed saves available to retry',async()=>{
 const save=vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined);
 render(<Harness save={save}/>);
 openInstrument('A');
 fireEvent.mouseDown(document.querySelector('tr[data-instrument-id="A"] .inline-desc-combined'),{button:0});
 const model=screen.getByPlaceholderText('Model',{exact:true});
 fireEvent.change(model,{target:{value:'Test meter'}});fireEvent.blur(model);
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
 await waitFor(()=>expect(within(document.querySelector('tr[data-instrument-id="B"]')).getByPlaceholderText('Model')).toHaveValue('B'));
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
it('keeps the focused tolerance editor and its draft open when moving the library header',async()=>{
 const save=vi.fn();render(<Harness save={save}/>);openInstrument('A');openInstrument('C');
 const modal=screen.getByRole('dialog',{name:'Instrument library'});
 const title=screen.getByRole('heading',{name:'Instrument Library'});
 const row=modal.querySelector('tr[data-instrument-id="A"]');
 fireEvent.click(within(row).getByTitle('Edit tolerance'));
 const input=row.querySelector('.inline-tolerance-input');
 input.focus();fireEvent.change(input,{target:{value:'2.5'}});
 const left=parseFloat(modal.style.left);
 fireEvent.pointerDown(title,{clientX:300,clientY:100,button:0});
 fireEvent.mouseDown(title,{clientX:300,clientY:100,button:0});
 fireEvent.mouseMove(document,{clientX:380,clientY:180});
 fireEvent.pointerUp(title,{clientX:380,clientY:180,button:0});
 fireEvent.mouseUp(document);
 fireEvent.click(title);
 // Dismissal runs after the release/click to allow blur-driven commits.
 await new Promise(resolve=>setTimeout(resolve,20));
 expect(parseFloat(modal.style.left)).toBe(left+80);
 for(const id of ['A','C']) expect(modal.querySelector(`tr[data-instrument-id="${id}"] .cell-tolerance`)).not.toBeNull();
 expect(row.querySelector('.inline-tolerance-editor')).not.toBeNull();
 expect(input).toHaveFocus();
 expect(input).toHaveValue('2.5');
 fireEvent.blur(input);
 await waitFor(()=>expect(save.mock.calls.at(-1)?.[0].functions[0].ranges[0].tolerances.reading.value).toBe('2.5'));
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
 fireEvent.click(screen.getByRole('button',{name:'Uncertainty',exact:true}));
 const name=screen.getByRole('textbox',{name:'Uncertainty name'});
 expect(name).toHaveAttribute('placeholder','Name');
 fireEvent.change(name,{target:{value:'Thermal drift'}});fireEvent.keyDown(name,{key:'Enter'});
 const source=document.querySelector('.instrument-uncertainty-row');
 expect(source).toHaveAttribute('data-instrument-id','A');
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

it('preserves selection through editor controls and theme changes without library move controls',()=>{
 render(<><Harness/><button data-theme-toggle>Theme</button></>);
 openInstrument('A');
 const row=()=>document.querySelector('tr[data-instrument-id="A"]');
 const click=button=>{fireEvent.pointerDown(button,{button:0});fireEvent.mouseDown(button,{button:0});fireEvent.click(button);};
 click(within(row()).getByTitle('Edit tolerance'));
 for(const label of ['Asymmetric tolerance','Single-sided tolerance','Double-sided tolerance','Symmetric tolerance']) {
   click(within(row()).getByTitle(label));expect(row()).toHaveClass('instrument-selected');
 }
 expect(document.querySelector('.instrument-order-controls')).toBeNull();
 click(screen.getByRole('button',{name:'Theme'}));
 expect(row().querySelector('.inline-tolerance-editor')).not.toBeNull();
 expect(row()).toHaveClass('instrument-selected');
});
it('saves instrument-specific qualifier and custom headers and restores them on reopening',async()=>{
 const a=definition('A'), b=definition('B');
 for(const item of [a,b])item.functions[0].ranges[0].qualifier={id:'q',text:'60'};
 a.qualifierColumnNames=['Frequency'];b.qualifierColumnNames=['Interval'];
 const save=vi.fn();const view=render(<Harness initial={[a,b]} save={save}/>);
 openInstrument('A');
 fireEvent.click(screen.getByRole('button',{name:'Frequency',exact:true}));
 const input=screen.getByLabelText('Qualifier 1 column name');fireEvent.change(input,{target:{value:'Test frequency'}});fireEvent.blur(input);
 await waitFor(()=>expect(save.mock.calls.at(-1)?.[0].qualifierColumnNames).toEqual(['Test frequency']));
 fireEvent.click(document.querySelector('th[data-instrument-column="resolution"] .instrument-column-insert-button'));
 const name=await screen.findByLabelText('Column name');fireEvent.change(name,{target:{value:'Calibration date'}});fireEvent.blur(name);
 await waitFor(()=>expect(save.mock.calls.at(-1)?.[0].customColumns?.[0].label).toBe('Calibration date'));
 const saved=save.mock.calls.at(-1)[0];
 openInstrument('B');expect(screen.getByRole('button',{name:'Test frequency/Interval',exact:true})).toBeInTheDocument();
 fireEvent.pointerDown(document.querySelector('tr[data-instrument-id="A"]'),{button:0});
 expect(screen.getByRole('button',{name:'Test frequency/Interval',exact:true})).toBeInTheDocument();
 view.unmount();render(<Harness initial={[saved,b]}/>);openInstrument('A');
 expect(screen.getByRole('button',{name:'Test frequency',exact:true})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Calibration date',exact:true})).toBeInTheDocument();
 fireEvent.keyDown(window,{key:'Escape'});openInstrument('B');
 expect(screen.getByRole('button',{name:'Interval',exact:true})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Calibration date',exact:true})).not.toBeInTheDocument();
});
it('isolates library column widths and the tolerance heading from the workspace TMDE table',()=>{
 render(<><Harness/><UncertaintyPanel testPointData={{id:'target',viewMode:'session'}} sessionData={{id:'target',uuts:[],tmdes:[],testPoints:[],measurementAreas:[]}} onSessionSave={()=>{}} /></>);
 openInstrument('A');
 const modal=screen.getByRole('dialog',{name:'Instrument library'});
 const workspace=[...document.querySelectorAll('.instrument-equipment-table')].find(table=>!modal.contains(table)&&table.querySelector('th[data-instrument-column="distribution"]'));
 expect(workspace.querySelector('th[data-instrument-column="tolerance"]')).toHaveAccessibleName('Uncertainty');
 expect(modal.querySelector('th[data-instrument-column="tolerance"]')).toHaveAccessibleName('Tolerance/Uncertainty');
 const before=workspace.querySelector('col').getAttribute('style');
 fireEvent.keyDown(within(modal).getByRole('button',{name:'Resize Description column'}),{key:'ArrowRight'});
 expect(workspace.querySelector('col').getAttribute('style')).toBe(before);
 expect(localStorage.getItem('uncertalytics:library:tmde:instrument-column-widths:v2')).not.toBeNull();
 localStorage.removeItem('uncertalytics:library:tmde:instrument-column-widths:v2');
});

it('combines unique qualifier names while editing only the active instrument name',async()=>{
 const a=definition('A'),b=definition('B'),c=definition('C');
 for(const item of [a,b,c]) item.functions[0].ranges[0].qualifier={id:'q',text:'60'};
 a.qualifierColumnNames=['Frequency'];b.qualifierColumnNames=['Interval'];c.qualifierColumnNames=['Frequency'];
 const save=vi.fn();render(<Harness initial={[a,b,c]} save={save}/>);
 for(const id of ['A','B','C'])openInstrument(id);
 fireEvent.pointerDown(document.querySelector('tr[data-instrument-id="B"]'),{button:0});
 fireEvent.click(screen.getByRole('button',{name:'Frequency/Interval',exact:true}));
 const input=screen.getByLabelText('Qualifier 1 column name');
 expect(input).toHaveValue('Interval');
 fireEvent.change(input,{target:{value:'Time interval'}});
 await waitFor(()=>expect(save.mock.calls.at(-1)?.[0]).toMatchObject({id:'B',qualifierColumnNames:['Time interval']}));
 fireEvent.pointerDown(document.querySelector('tr[data-instrument-id="A"]'),{button:0});
 expect(screen.getByRole('button',{name:'Frequency/Time interval',exact:true})).toBeInTheDocument();
 expect(save.mock.calls.every(([item])=>item.id==='B')).toBe(true);
});

it('shows the same compact row, range choices and expanded specifications in the inbox and library', async () => {
 const meter = { ...definition('ReviewMeter', 'pending'), owner: 'analyst', reviewId: '71', reviewVersion: '3', qualifierColumnNames: ['Frequency'] };
 const originalRange = meter.functions[0].ranges[0];
 meter.functions[0].ranges = [
   { ...originalRange, qualifier: { text: '60 Hz' } },
   { ...originalRange, id: 'wide', max: 100, resolution: 0.1, qualifier: { text: '400 Hz' }, tolerances: { reading: { value: 2, unit: '%' } } },
 ];
 const other = { ...definition('Bridge', 'pending'), owner: 'other', reviewId: '72', reviewVersion: '1' };
 const save = vi.fn();
 axios.get.mockResolvedValue({ data: { canValidate: true, reviews: [meter, other] } });
 try {
   render(<InstrumentLibraryModal isOpen instruments={[meter]} onClose={vi.fn()} onSaveToLibrary={save}/>);
   const library = screen.getByRole('dialog', { name: 'Instrument library' });
   const inspect = surface => {
     const specs = () => within(surface).getByRole('button', { name: /instrument specifications .*ReviewMeter/i });
     expect(specs()).toHaveAttribute('aria-expanded', 'false');
     const compactRow = specs().closest('tr');
     const columns = table => within(table).getAllByRole('columnheader').map(cell => cell.dataset.instrumentColumn);
     const compactColumns = columns(compactRow.closest('table'));
     expect(compactColumns).toEqual(['description', 'sync']);
     const name = within(compactRow).getByRole('button', { name: /select instrument .*ReviewMeter/i });
     const range = within(compactRow).getByRole('button', { name: /range/i });
     fireEvent.click(range);
     const options = within(screen.getByRole('listbox')).getAllByRole('option');
     const rangeDescriptions = options.map(option => option.textContent);
     expect(rangeDescriptions).toEqual([expect.stringContaining('60 Hz'), expect.stringContaining('400 Hz')]);
     fireEvent.click(options[1]);
     expect(range).toHaveTextContent('0 to 100 V');
     fireEvent.click(specs());
     expect(specs()).toHaveAttribute('aria-expanded', 'true');
     const detailTable = specs().closest('table');
     if (surface !== library) {
       expect(within(detailTable).queryByTitle('Edit tolerance')).toBeNull();
       expect(within(detailTable).queryByRole('button', { name: 'Add range' })).toBeNull();
     }
     const detailColumns = columns(detailTable);
     expect(detailColumns).toEqual(expect.arrayContaining(['range', 'resolution', 'tolerance', 'qualifier']));
     const detailCells = [...detailTable.querySelectorAll('td.cell-value, [data-qualifier-cell], td.cell-distribution, td.cell-tolerance')].map(cell => {
       const content = cell.cloneNode(true);
       content.querySelectorAll('.range-row-controls').forEach(controls => controls.remove());
       return content.textContent.trim();
     });
     expect(detailCells).toEqual(expect.arrayContaining(['60 Hz', '400 Hz', '± 1% IV', '± 2% IV', expect.stringContaining('0.01')]));
     const tolerance = detailTable.querySelector('td.cell-tolerance');
     fireEvent.click(within(tolerance).getByTitle(surface === library ? 'Edit tolerance' : 'Inspect tolerance'));
     const toleranceInputs = [...tolerance.querySelectorAll('.inline-tolerance-input')];
     const toleranceValues = toleranceInputs.map(input => input.value);
     expect(toleranceValues).toContain('1');
     if (surface !== library) toleranceInputs.forEach(input => expect(input).toBeDisabled());
     fireEvent.click(specs());
     expect(specs()).toHaveAttribute('aria-expanded', 'false');
     return { name: name.textContent, compactColumns, rangeDescriptions, detailColumns, detailCells, toleranceValues };
   };
   const expected = inspect(library);
   fireEvent.click(await within(library).findByRole('button', { name: 'Validation inbox' }));
   const inbox = await within(library).findByRole('region', { name: 'Pending instrument validations' });
   const search = within(library).getByRole('textbox', { name: 'Search instruments' });
   expect(within(inbox).getByRole('button', { name: /instrument specifications .*Bridge/i })).toBeInTheDocument();
   fireEvent.change(search, { target: { value: 'ReviewMeter' } });
   expect(within(inbox).queryByRole('button', { name: /instrument specifications .*Bridge/i })).toBeNull();
   expect(inspect(inbox)).toEqual(expected);
   fireEvent.change(search, { target: { value: '' } });
   expect(within(inbox).getByRole('button', { name: /instrument specifications .*Bridge/i })).toBeInTheDocument();
   expect(save).not.toHaveBeenCalled();
 } finally {
   axios.get.mockResolvedValue({ data: { canValidate: false, reviews: [] } });
 }
});

it('publishes only the confirmed inbox submission when two authors submit the same instrument id', async () => {
 const review={...definition('ReviewMeter','pending'),owner:'analyst-a',reviewId:'71',reviewVersion:'3'};
 const other={...review,owner:'analyst-b',reviewId:'72',reviewVersion:'5',model:'Other meter',description:'Second submission'};
 const publish=vi.fn();
 axios.get.mockResolvedValue({data:{canValidate:true,reviews:[review,other]}});
 axios.post.mockClear();
 axios.post.mockResolvedValueOnce({data:{...review,scope:'validated'}});
 try {
   render(<InstrumentLibraryModal isOpen onClose={()=>{}} instruments={[]} onInstrumentSynced={publish}/>);
   const inbox=await screen.findByRole('button',{name:'Validation inbox'});
   fireEvent.click(inbox);
   const queue=await screen.findByRole('region',{name:'Pending instrument validations'});
   const reviewRow=within(queue).getByRole('button',{name:/instrument specifications .*ReviewMeter/i}).closest('tr');
   fireEvent.click(within(reviewRow).getByRole('button',{name:'Awaiting validation. Click to review and validate.'}));
   const confirm=screen.getByRole('alertdialog');
   expect(confirm).toHaveTextContent('publish these specifications');
   expect(axios.post).not.toHaveBeenCalled();
   expect(publish).not.toHaveBeenCalled();
   fireEvent.click(within(confirm).getByRole('button',{name:'Validate'}));
   await waitFor(()=>expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/instrument-reviews\/71\/validate\/$/),{reviewVersion:'3'},expect.any(Object)));
   await waitFor(()=>expect(publish).toHaveBeenCalledWith(expect.objectContaining({scope:'validated'}),'ReviewMeter'));
   expect(within(queue).queryByRole('button',{name:/instrument specifications .*ReviewMeter/i})).toBeNull();
   const remainingRow=within(queue).getByRole('button',{name:/instrument specifications .*Other meter/i}).closest('tr');
   expect(axios.post).toHaveBeenCalledTimes(1);
   fireEvent.click(within(screen.getByRole('alertdialog',{name:'Instrument validated'})).getByText('Close',{selector:'button'}));
   axios.post.mockResolvedValueOnce({data:{...other,scope:'validated'}});
   fireEvent.click(within(remainingRow).getByRole('button',{name:'Awaiting validation. Click to review and validate.'}));
   fireEvent.click(within(screen.getByRole('alertdialog',{name:'Validate instrument'})).getByRole('button',{name:'Validate'}));
   await waitFor(()=>expect(queue).toHaveTextContent('No instruments are awaiting validation.'));
   expect(axios.post).toHaveBeenLastCalledWith(expect.stringMatching(/\/instrument-reviews\/72\/validate\/$/),{reviewVersion:'5'},expect.any(Object));
 } finally {axios.get.mockResolvedValue({data:{canValidate:false,reviews:[]}});}
});

it('admits a reviewer from a pending library sync icon and keeps ordinary users out of the inbox', async () => {
 const item={...definition('LocalMeter','pending'),owner:'analyst',reviewVersion:'2'};
 const view=render(<InstrumentLibraryModal isOpen instruments={[item]} onClose={()=>{}}/>);
 expect(screen.queryByRole('button',{name:'Validation inbox'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Awaiting validation. Right-click to withdraw to My library.'}));
 expect(screen.queryByRole('alertdialog')).toBeNull();
 view.unmount();
 axios.get.mockResolvedValue({data:{canValidate:true,reviews:[item]}});
 try {
   render(<InstrumentLibraryModal isOpen instruments={[item]} onClose={()=>{}}/>);
   fireEvent.click(await screen.findByRole('button',{name:'Awaiting validation. Click to review and validate.'}));
   expect(await screen.findByRole('alertdialog')).toHaveTextContent('Validate Example LocalMeter');
 } finally {axios.get.mockResolvedValue({data:{canValidate:false,reviews:[]}});}
});

it('lets an ordinary user withdraw a pending library submission without a second library save', async () => {
 const pending={...definition('MySubmission','pending'),reviewVersion:'3'};
 const saved={...pending,scope:'local',reviewVersion:undefined,localOverride:true};
 const synced=vi.fn(), save=vi.fn();
 axios.post.mockReset();
 axios.post.mockResolvedValueOnce({data:saved});
 function SyncedLibrary(){
   const [instruments,setInstruments]=useState([pending]);
   return <InstrumentLibraryModal isOpen instruments={instruments} onClose={()=>{}} onSaveToLibrary={save}
     onInstrumentSynced={(record,id)=>{synced(record,id);flushSync(()=>setInstruments([record]));}}/>;
 }
 render(<SyncedLibrary/>);
 expect(screen.queryByRole('button',{name:'Validation inbox'})).toBeNull();
 fireEvent.contextMenu(screen.getByRole('button',{name:'Awaiting validation. Right-click to withdraw to My library.'}));
 await waitFor(()=>expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/instruments\/$/),
   expect.objectContaining({id:pending.id,scope:'local',action:'withdraw',reviewVersion:'3'}),expect.any(Object)));
 await waitFor(()=>expect(synced).toHaveBeenCalledWith(saved,pending.id));
 expect(await screen.findByRole('button',{name:'My library. Click to submit for SME validation.'})).toBeInTheDocument();
 expect(save).not.toHaveBeenCalled();
});

it('opens the latest submitted specs before approving an older library copy', async () => {
  const old = { ...definition('Meter', 'pending'), owner: 'analyst', reviewVersion: '1' };
  const latest = { ...old, model: 'Revised', reviewId: '93', reviewVersion: '2' };
  axios.get.mockResolvedValue({ data: { canValidate: true, reviews: [latest] } });
  try {
    render(<InstrumentLibraryModal isOpen instruments={[old]} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Awaiting validation. Click to review and validate.' }));
    const queue = await screen.findByRole('region', { name: 'Pending instrument validations' });
    expect(within(queue).getByRole('button', { name: /hide instrument specifications .*Revised/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(within(queue).getByRole('button', { name: 'Awaiting validation. Click to review and validate.' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Validate Example Revised');
  } finally { axios.get.mockResolvedValue({ data: { canValidate: false, reviews: [] } }); }
});
