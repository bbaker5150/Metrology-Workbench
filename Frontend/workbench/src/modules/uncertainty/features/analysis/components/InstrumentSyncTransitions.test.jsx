import React, {useState} from 'react';
import {render, fireEvent, screen, waitFor, act} from '@testing-library/react';
import {it, expect, vi} from 'vitest';
import axios from 'axios';
import UncertaintyPanel, {localizeSharedInstrumentEdit, synchronizeLocalInstrumentDefinitions} from './UncertaintyPanel';
import {computeSyncState, buildValidatedSnapshot} from '../../../utils/instrumentSync';
vi.mock('plotly.js-dist',()=>({default:{}}));

function Harness({viewMode,kind,onSaveInstrument,onDeleteLibraryInstrument=vi.fn().mockResolvedValue(undefined),setNotification,initialScope='validated',onInstrumentSynced,canDemoteSharedInstruments=true}) {
 const definition={id:initialScope==='pending'?'private':'shared',scope:initialScope,reviewVersion:initialScope==='pending'?'revision-3':undefined,manufacturer:'Example',model:'Meter',description:'Meter',functions:[{id:'f',name:'Current',unit:'A',ranges:[{id:'r',min:0,max:10,unit:'A',tolerances:{reading:{value:1,unit:'%'}}}]}]};
 definition.validatedSnapshot=buildValidatedSnapshot(definition);
 const [session,save]=useState({id:'s',uuts:kind==='uut'?[{id:'row',description:'Meter',instrument:definition}]:[],tmdes:kind==='tmde'?[{id:'row',name:'Meter',instrument:definition}]:[],testPoints:[],uncReq:{}});
 return <><UncertaintyPanel canDemoteSharedInstruments={canDemoteSharedInstruments} testPointData={{id:'p',viewMode,testPointInfo:{parameter:{name:'Current',value:5,unit:'A'}},associatedUutIds:kind==='uut'?['row']:[],components:[],tmdeTolerances:[],specifications:{}}} sessionData={session} onSessionSave={save} onSaveInstrument={onSaveInstrument} onInstrumentSynced={onInstrumentSynced} onDeleteLibraryInstrument={onDeleteLibraryInstrument} setNotification={setNotification} tmdeTolerancesData={[]} /><output data-testid="state">{JSON.stringify(session)}</output></>;
}

it.each([['session','uut'],['session','tmde'],['point','uut'],['point','tmde']])('keeps a shared instrument shared when a general user right-clicks its Status in %s %s', (viewMode, kind) => {
 const save=vi.fn(), remove=vi.fn();
 render(<Harness viewMode={viewMode} kind={kind} canDemoteSharedInstruments={false} onSaveInstrument={save} onDeleteLibraryInstrument={remove}/>);
 const badge=document.querySelector('.inline-sync-badge');
 const before=screen.getByTestId('state').textContent;
 expect(badge).toHaveAttribute('title','Validated shared.');
 fireEvent.contextMenu(badge);
 expect(screen.getByTestId('state').textContent).toBe(before);
 expect(save).not.toHaveBeenCalled();
 expect(remove).not.toHaveBeenCalled();
});

it.each([['session','uut'],['session','tmde'],['point','uut'],['point','tmde']])('withdraws a pending submission to Local without SME access in %s %s', async (viewMode, kind) => {
 const synced=vi.fn(), save=vi.fn(), remove=vi.fn();
 let finish;
 const post=vi.spyOn(axios,'post').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 try {
  render(<Harness viewMode={viewMode} kind={kind} initialScope="pending" canDemoteSharedInstruments={false} onSaveInstrument={save} onDeleteLibraryInstrument={remove} onInstrumentSynced={synced} setNotification={vi.fn()}/>);
  const badge=()=>document.querySelector('.inline-sync-badge');
  const state=()=>JSON.parse(screen.getByTestId('state').textContent)[kind==='uut'?'uuts':'tmdes'][0].instrument;
  const original=state();
  expect(badge()).toHaveAttribute('title','Awaiting validation. Right-click to withdraw to My library.');
  fireEvent.contextMenu(badge());
  fireEvent.contextMenu(badge());
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][1]).toEqual({id:'private',scope:'local',action:'withdraw',reviewVersion:'revision-3',owner:expect.any(String)});
  expect(state()).toEqual(original);
  const saved={...original,scope:'local',localOverride:true,reviewVersion:'revision-4'};
  await act(async()=>{finish({data:saved});});
  await waitFor(()=>expect(badge()).toHaveClass('inline-sync-badge--orange'));
  expect(state()).toMatchObject({id:'private',scope:'local',reviewVersion:'revision-4',functions:original.functions});
  expect(synced).toHaveBeenCalledExactlyOnceWith(saved,'private');
  expect(save).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
 } finally {post.mockRestore();}
});

it.each([['session','tmde'],['point','uut']])('keeps a failed withdrawal pending with shareable error details in %s %s', async (viewMode, kind) => {
 let notification;
 const synced=vi.fn();
 const post=vi.spyOn(axios,'post').mockRejectedValue({response:{status:409,data:{detail:'This submission has already been approved. Refresh the library.'}}});
 try {
  render(<Harness viewMode={viewMode} kind={kind} initialScope="pending" onInstrumentSynced={synced} setNotification={value=>{notification=value;}}/>);
  fireEvent.contextMenu(document.querySelector('.inline-sync-badge'));
  await waitFor(()=>expect(notification).toMatchObject({title:'Could not withdraw instrument',copyable:true}));
  expect(notification.message).toContain('already been approved');
  expect(notification.message).toContain('409');
  expect(document.querySelector('.inline-sync-badge')).toHaveClass('inline-sync-badge--yellow');
  expect(synced).not.toHaveBeenCalled();
 } finally {post.mockRestore();}
});
it.each([['session','uut'],['session','tmde'],['point','uut'],['point','tmde']])('demotes and reports a rejected promotion before a successful retry in %s %s',async(viewMode,kind)=>{
 let notification;
 const save=vi.fn().mockResolvedValue(undefined);
 const remove=vi.fn().mockResolvedValue(undefined);
 const post=vi.spyOn(axios,'post').mockImplementation(async(url,data)=>({data}));
 render(<Harness viewMode={viewMode} kind={kind} onSaveInstrument={save} onDeleteLibraryInstrument={remove} setNotification={value=>{notification=value;}}/>);
 const state=()=>JSON.parse(screen.getByTestId('state').textContent)[kind==='uut'?'uuts':'tmdes'][0].instrument;
 const badge=()=>document.querySelector('.inline-sync-badge');
 expect(badge()).toHaveClass('inline-sync-badge--green');
 fireEvent.contextMenu(badge());
 await waitFor(()=>expect(badge()).toHaveClass('inline-sync-badge--orange'));
 expect(save).toHaveBeenCalledTimes(1);
 expect(save.mock.calls[0][0]).toMatchObject({scope:'local',sourceId:'shared',action:'demote-shared'});
 expect(state().id).not.toBe('shared');
 expect(state().action).toBeUndefined();
 const localId=state().id;
 fireEvent.contextMenu(badge());
 await waitFor(()=>expect(badge()).toHaveClass('inline-sync-badge--red'));
 expect(state().scope).toBe('session');
 expect(remove).toHaveBeenCalledExactlyOnceWith(localId);
 expect(state().id).not.toBe(localId);
 expect(save).toHaveBeenCalledTimes(1);
 fireEvent.contextMenu(badge());
 expect(save).toHaveBeenCalledTimes(1);
 const sessionDefinition = state();
 const detail = "Access denied when adding an item to Uncertalytics - Instrument Drafts.";
 save.mockRejectedValueOnce(Object.assign(new Error("Request failed with status code 403"), {
   response: { status: 403, data: { detail } },
 }));
 fireEvent.click(badge());
 await waitFor(() => expect(notification).toMatchObject({
   title: "Could not save instrument to Local",
   copyable: true,
 }));
 expect(notification.message).toContain(detail);
 expect(notification.message).toContain("403");
 expect(badge()).toHaveClass('inline-sync-badge--red');
 expect(state()).toEqual(sessionDefinition);
 expect(save).toHaveBeenLastCalledWith(expect.objectContaining({
   id: sessionDefinition.id, scope: "local",
 }), { requireSaved: true });
 fireEvent.click(badge());
 await waitFor(()=>expect(badge()).toHaveClass('inline-sync-badge--orange'));
 expect(save).toHaveBeenCalledTimes(3);
 expect(post).not.toHaveBeenCalled();
 fireEvent.click(badge());
 expect(notification.inputLabel).toBeUndefined();
 expect(notification.confirmText).toBe('Submit');
 await notification.onConfirm();
 await waitFor(()=>expect(badge()).toHaveClass('inline-sync-badge--yellow'));
 expect(notification.title).toBe('Submitted for validation');
 expect(post).toHaveBeenCalledTimes(1);
 fireEvent.click(badge());
 expect(post).toHaveBeenCalledTimes(1);
 post.mockRestore();
});

it.each([['session', 'tmde'], ['point', 'uut']])('reports a submission conflict and retains the local draft in %s %s', async (viewMode, kind) => {
  const detail = "This instrument has already been submitted. Reopen it to edit the current submission.";
  const post = vi.spyOn(axios, 'post').mockRejectedValueOnce({
    response: { status: 409, data: { detail } },
  });
  try {
    let notification;
    render(<Harness viewMode={viewMode} kind={kind} onSaveInstrument={vi.fn().mockResolvedValue(undefined)}
      setNotification={value => { notification = value; }} />);
    const badge = document.querySelector('.inline-sync-badge');
    fireEvent.contextMenu(badge);
    await waitFor(() => expect(badge).toHaveClass('inline-sync-badge--orange'));
    fireEvent.click(badge);
    expect(notification.confirmText).toBe('Submit');
    await notification.onConfirm();
    expect(notification).toMatchObject({ title: "Could not submit instrument for validation", copyable: true });
    expect(notification.message).toContain(detail);
    expect(notification.message).toContain("409");
    expect(badge).toHaveClass('inline-sync-badge--orange');
  } finally {
    post.mockRestore();
  }
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
 await waitFor(()=>expect(notification).toMatchObject({ title: 'Could not save instrument to Local', copyable: true }));
 expect(notification.message).toContain('offline');
 expect(document.querySelector('.inline-sync-badge')).toHaveClass('inline-sync-badge--green');
});

it.each([['session','uut'],['session','tmde'],['point','uut'],['point','tmde']])('retains local status if removal fails in %s %s', async(viewMode,kind)=>{
 let notification;
 const remove=vi.fn().mockRejectedValue(new Error('Offline'));
 render(<Harness viewMode={viewMode} kind={kind} onSaveInstrument={vi.fn().mockResolvedValue(undefined)} onDeleteLibraryInstrument={remove} setNotification={value=>{notification=value;}}/>);
 const badge=()=>document.querySelector('.inline-sync-badge');
 fireEvent.contextMenu(badge());
 await waitFor(()=>expect(badge()).toHaveClass('inline-sync-badge--orange'));
 fireEvent.contextMenu(badge());
 await waitFor(()=>expect(notification).toMatchObject({ title: 'Could not return instrument to Session', copyable: true }));
 expect(notification.message).toContain('Offline');
 expect(badge()).toHaveClass('inline-sync-badge--orange');
});
