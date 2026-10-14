import { expect, it, vi } from 'vitest';
import { addLibraryInstrumentRows, libraryInstrumentDropHandlers, LIBRARY_INSTRUMENT_MIME } from './libraryInstrumentDrag';

it('copies complete definitions into the target area without mutating the source or existing rows',()=>{
 const original={id:'shared',scope:'validated',description:'Reference',functions:[{name:'Current',ranges:[{id:'range',qualifier:{text:'60 Hz'}}]}],tmdeSecondaryUncertainties:[{id:'thermal',kind:'equation'}],customFields:{note:'Keep'}};
 const session={uuts:[],tmdes:[{id:'existing'}],measurementAreaGroups:[{name:'Voltage',key:'voltage',color:'#abc'}]};
 const next=addLibraryInstrumentRows(session,[original],'tmde','voltage');
 expect(next.tmdes[0]).toBe(session.tmdes[0]);
 expect(next.tmdes[1].measurementAreaNames).toEqual(['Voltage']);
 expect(next.tmdes[1].instrument).toEqual(original);
 next.tmdes[1].instrument.functions[0].ranges[0].qualifier.text='400 Hz';
 expect(original.functions[0].ranges[0].qualifier.text).toBe('60 Hz');
 expect(session.tmdes).toHaveLength(1);
});
it('ignores malformed payloads and prevents library-to-library drops',()=>{
 const save=vi.fn();const event={dataTransfer:{types:[LIBRARY_INSTRUMENT_MIME],getData:()=>'{broken'},preventDefault:vi.fn(),stopPropagation:vi.fn()};
 libraryInstrumentDropHandlers({current:{}},save,'uut').onDropCapture(event);
 event.dataTransfer.getData=()=>JSON.stringify([{id:'one'}]);
 libraryInstrumentDropHandlers({current:{}},save,'uut',true).onDropCapture(event);
 expect(save).not.toHaveBeenCalled();
 expect(event.stopPropagation).toHaveBeenCalledTimes(2);
});
