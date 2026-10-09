import React, {useState} from 'react';
import {render, fireEvent, screen, waitFor} from '@testing-library/react';
import {it, expect, vi} from 'vitest';
import axios from 'axios';
import UncertaintyPanel, {localizeSharedInstrumentEdit, synchronizeLocalInstrumentDefinitions} from './UncertaintyPanel';
import {computeSyncState, buildValidatedSnapshot} from '../../../utils/instrumentSync';
vi.mock('plotly.js-dist',()=>({default:{}}));

function Harness({viewMode,kind,onSaveInstrument,setNotification}) {
 const definition={id:'shared',scope:'validated',manufacturer:'Example',model:'Meter',description:'Meter',functions:[{id:'f',name:'Current',unit:'A',ranges:[{id:'r',min:0,max:10,unit:'A',tolerances:{reading:{value:1,unit:'%'}}}]}]};
 definition.validatedSnapshot=buildValidatedSnapshot(definition);
 const [session,save]=useState({id:'s',uuts:kind==='uut'?[{id:'row',description:'Meter',instrument:definition}]:[],tmdes:kind==='tmde'?[{id:'row',name:'Meter',instrument:definition}]:[],testPoints:[],uncReq:{}});
 return <><UncertaintyPanel testPointData={{id:'p',viewMode,testPointInfo:{parameter:{name:'Current',value:5,unit:'A'}},associatedUutIds:kind==='uut'?['row']:[],components:[],tmdeTolerances:[],specifications:{}}} sessionData={session} onSessionSave={save} onSaveInstrument={onSaveInstrument} setNotification={setNotification} tmdeTolerancesData={[]} /><output data-testid="state">{JSON.stringify(session)}</output></>;
}
it.each([['session','uut'],['session','tmde'],['point','uut'],['point','tmde']])('promotes and demotes one level in %s %s',async(viewMode,kind)=>{
 let notification;
 const save=vi.fn().mockResolvedValue(undefined);
 const post=vi.spyOn(axios,'post').mockImplementation(async(url,data)=>({data}));
 render(<Harness viewMode={viewMode} kind={kind} onSaveInstrument={save} setNotification={value=>{notification=value;}}/>);
 const state=()=>JSON.parse(screen.getByTestId('state').textContent)[kind==='uut'?'uuts':'tmdes'][0].instrument;
 const badge=()=>document.querySelector('.inline-sync-badge');
 expect(badge()).toHaveClass('inline-sync-badge--green');
 fireEvent.contextMenu(badge());
 await waitFor(()=>expect(badge()).toHaveClass('inline-sync-badge--yellow'));
 expect(save).toHaveBeenCalledTimes(1);
 expect(save.mock.calls[0][0]).toMatchObject({scope:'local',sourceId:'shared'});
 expect(state().id).not.toBe('shared');
 const localId=state().id;
 fireEvent.contextMenu(badge());
 await waitFor(()=>expect(badge()).toHaveClass('inline-sync-badge--red'));
 expect(state().scope).toBe('session');
 expect(state().id).not.toBe(localId);
 expect(save).toHaveBeenCalledTimes(1);
 fireEvent.contextMenu(badge());
 expect(save).toHaveBeenCalledTimes(1);
 fireEvent.click(badge());
 await waitFor(()=>expect(badge()).toHaveClass('inline-sync-badge--yellow'));
 expect(save).toHaveBeenCalledTimes(2);
 expect(post).not.toHaveBeenCalled();
 fireEvent.click(badge());
 expect(notification.inputLabel).toBe('Shared library password');
 await notification.onConfirm('password');
 await waitFor(()=>expect(badge()).toHaveClass('inline-sync-badge--green'));
 expect(post).toHaveBeenCalledTimes(1);
 fireEvent.click(badge());
 expect(post).toHaveBeenCalledTimes(1);
 post.mockRestore();
});
it('keeps detached session instruments session-only when edited or copied',()=>{
 const instrument={id:'session-definition',scope:'session',sourceId:'shared',localOverride:true,description:'Edited'};
 const item={id:'one',instrument};
 expect(localizeSharedInstrumentEdit(item)).toBe(item);
 const result=synchronizeLocalInstrumentDefinitions({uuts:[item,{...item,id:'two'}]},item,'uut');
 expect(result.uuts[0].instrument.scope).toBe('session');
 expect(computeSyncState(result.uuts[0].instrument)).toBe('red');
});
it('retains shared state if saving the local copy fails',async()=>{
 let notification;
 render(<Harness viewMode="session" kind="uut" onSaveInstrument={vi.fn().mockRejectedValue(new Error('offline'))} setNotification={value=>{notification=value;}}/>);
 fireEvent.contextMenu(document.querySelector('.inline-sync-badge'));
 await waitFor(()=>expect(notification?.title).toBe('Could not change sync state'));
 expect(document.querySelector('.inline-sync-badge')).toHaveClass('inline-sync-badge--green');
});
