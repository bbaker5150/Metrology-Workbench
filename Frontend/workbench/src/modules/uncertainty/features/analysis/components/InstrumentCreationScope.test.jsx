import React, { useState } from 'react';
import { render, fireEvent, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import UncertaintyPanel, { localizeSharedInstrumentEdit } from './UncertaintyPanel';

vi.mock('plotly.js-dist', () => ({ default: {} }));
beforeEach(() => localStorage.clear());

function Harness({ viewMode, kind, saveInstrument }) {
  const [session, setSession] = useState({ id: 'session', uuts: [], tmdes: [], testPoints: [],
    measurementAreaGroups: [{ name: 'Torque', kind, color: '#16865b' }], uncReq: {} });
  return <><UncertaintyPanel sessionData={session} onSessionSave={setSession} onSaveInstrument={saveInstrument}
    testPointData={{ id: 'point', viewMode, components: [], tmdeTolerances: [], specifications: {},
      testPointInfo: { parameter: { name: 'Torque', value: 5, unit: 'N·m' } } }} tmdeTolerancesData={[]} />
    <output data-testid="session">{JSON.stringify(session)}</output></>;
}

it.each([['session', 'uut'], ['session', 'tmde'], ['point', 'uut'], ['point', 'tmde']])(
  'creates and edits a %s %s without saving it to the local library', async (viewMode, kind) => {
    const saveInstrument = vi.fn();
    render(<Harness viewMode={viewMode} kind={kind} saveInstrument={saveInstrument} />);
    fireEvent.click(screen.getByRole('button', { name: `Add ${kind.toUpperCase()} to this measurement area` }));
    const read = () => JSON.parse(screen.getByTestId('session').textContent)[kind === 'uut' ? 'uuts' : 'tmdes'][0];
    expect(read().instrument.scope).toBe('session');
    const row = document.querySelector(`tr[data-instrument-id="${read().id}"]`);
    const specifications = row.querySelector('.instrument-library-specifications');
    if (!row.querySelector('.inline-desc-combined') && specifications) fireEvent.click(specifications);
    fireEvent.mouseDown(row.querySelector('.inline-desc-combined'), { button: 0 });
    const model = within(row).getByPlaceholderText('Model', { exact: true });
    fireEvent.change(model, { target: { value: 'New torque meter' } });
    fireEvent.blur(model);
    await waitFor(() => expect(read().instrument.model).toBe('New torque meter'));
    expect(read().instrument.scope).toBe('session');
    expect(saveInstrument).not.toHaveBeenCalled();
  },
);

it('keeps unscoped unsaved definitions session-only while preserving known library definitions', () => {
  const item = { id: 'row', instrument: { id: 'new', model: 'Meter' } };
  expect(localizeSharedInstrumentEdit(item).instrument.scope).toBe('session');
  expect(localizeSharedInstrumentEdit(item, [{ id: 'new', scope: 'local' }]).instrument.scope).toBe('local');
});

it.each(['validated', 'shared'].flatMap(scope => ['session', 'point'].flatMap(viewMode => ['uut', 'tmde'].map(kind => [scope, viewMode, kind]))))(
  'keeps edits to a %s instrument in %s %s inside its session', async (scope, viewMode, kind) => {
    const saveInstrument = vi.fn();
    const definition = { id: 'shared-meter', scope, manufacturer: 'Example', model: 'Reference', description: 'Reference meter',
      functions: [{ id: 'volts', name: 'Voltage', unit: 'V', ranges: [{ id: 'range', min: 0, max: 10, unit: 'V', tolerances: { reading: { value: 1, unit: '%' } } }] }] };
    const original = { id: 'edited-row', name: 'Reference meter', description: 'Reference meter', measurementAreaNames: ['Voltage'], libraryInstrumentId: definition.id,
      definitionId: definition.id, instrumentId: definition.id, sourceInstrumentId: definition.id, sourceInstrument: definition, instrument: definition };
    const sibling = { ...original, id: 'untouched-row' };
    const initial = { id: 'session', uuts: kind === 'uut' ? [original, sibling] : [], tmdes: kind === 'tmde' ? [original, sibling] : [], testPoints: [], uncReq: {} };
    function EditingSession() {
      const [session, setSession] = useState(initial);
      return <><UncertaintyPanel sessionData={session} onSessionSave={setSession} instruments={[definition]} onSaveInstrument={saveInstrument}
        testPointData={{ id: 'point', viewMode, associatedUutIds: ['edited-row'], components: [], tmdeTolerances: [], specifications: {},
          testPointInfo: { parameter: { name: 'Voltage', value: 5, unit: 'V' } } }} tmdeTolerancesData={[]} />
        <output data-testid="edited-session">{JSON.stringify(session)}</output></>;
    }
    render(<EditingSession/>);
    const read = () => JSON.parse(screen.getByTestId('edited-session').textContent)[kind === 'uut' ? 'uuts' : 'tmdes'];
    const unchangedSibling = read()[1];
    const row = () => document.querySelector('tr[data-instrument-id="edited-row"]');
    const editModel = value => {
      if (!within(row()).queryByPlaceholderText('Model', { exact: true })) {
        if (!row().querySelector('.inline-desc-combined')) fireEvent.click(row().querySelector('.instrument-library-specifications'));
        fireEvent.mouseDown(row().querySelector('.inline-desc-combined'), { button: 0 });
      }
      const field = within(row()).getByPlaceholderText('Model', { exact: true });
      fireEvent.change(field, { target: { value } });
      fireEvent.blur(field);
    };
    editModel('Session-specific model');
    await waitFor(() => expect(read()[0].instrument.model).toBe('Session-specific model'));
    const edited = read()[0];
    expect(edited.instrument).toMatchObject({ scope: 'session', sourceId: definition.id, owner: '', localOverride: true,
      validatedSnapshot: { model: 'Reference', functions: definition.functions } });
    expect(edited.instrument.id).not.toBe(definition.id);
    for (const key of ['libraryInstrumentId', 'definitionId', 'instrumentId', 'sourceInstrumentId']) expect(edited[key]).toBe(edited.instrument.id);
    expect(edited.sourceInstrument.id).toBe(edited.instrument.id);
    expect(edited.instrument.libraryInstrumentId).toBe(edited.instrument.id);
    expect(read()[1]).toEqual(unchangedSibling);
    expect(definition.model).toBe('Reference');
    expect(row().querySelector('.inline-sync-badge')).toHaveClass('inline-sync-badge--red');
    editModel('Another session edit');
    await waitFor(() => expect(read()[0].instrument.model).toBe('Another session edit'));
    expect(read()[0].instrument.id).toBe(edited.instrument.id);
    expect(read()[1]).toEqual(unchangedSibling);
    expect(saveInstrument).not.toHaveBeenCalled();
  },
);

it('retains a private Local fork when shared specifications are edited in the library', () => {
  const shared = { id: 'shared', scope: 'validated', model: 'Original', functions: [] };
  const local = localizeSharedInstrumentEdit({ id: 'row', instrument: { ...shared, model: 'Library edit' } }, [shared], { libraryMode: true });
  expect(local.instrument).toMatchObject({ scope: 'local', model: 'Library edit', sourceId: 'shared', validatedSnapshot: { model: 'Original' } });
  expect(local.instrument.id).not.toBe(shared.id);
});

it.each(['session','point'])('keeps legacy point TMDE snapshots linked when shared specifications are edited in %s view', async viewMode => {
  const definition = { id: 'shared-meter', scope: 'validated', model: 'Reference', functions: [{ id: 'volts', name: 'Voltage', unit: 'V',
    ranges: [{ id: 'range', min: 0, max: 10, unit: 'V', tolerances: { reading: { value: 1, unit: '%' } } }] }] };
  const master = { id: 'master-row', name: 'Reference', instrument: definition };
  const other = { id: 'other-row', name: 'Other', instrument: { ...definition, id: 'another-definition', model: 'Other' } };
  const legacy = { id: 'legacy-snapshot', sourceInstrument: definition, measurementPoint: { value: 5, unit: 'V' }, variableType: 'A', quantity: 2 };
  const independent = { id: 'independent-snapshot', sourceId: other.id, instrument: other.instrument, measurementPoint: { value: 2, unit: 'V' }, variableType: 'B' };
  const saveInstrument=vi.fn();
  function LegacyPoints() {
    const [session,setSession]=useState({id:'session',uuts:[],tmdes:[master,other],testPoints:[
      {id:'active',tmdeTolerances:[legacy,independent],components:[],specifications:{},testPointInfo:{parameter:{name:'Voltage',value:5,unit:'V'}}},
      {id:'unopened',tmdeTolerances:[legacy,independent],components:[],specifications:{},testPointInfo:{parameter:{name:'Voltage',value:5,unit:'V'}}},
    ],uncReq:{}});
    const point=session.testPoints[0];
    return <><UncertaintyPanel sessionData={session} onSessionSave={setSession} instruments={[definition,other.instrument]} onSaveInstrument={saveInstrument}
      testPointData={{...point,viewMode}} tmdeTolerancesData={point.tmdeTolerances}
      onUpdateTestPoint={patch=>setSession(current=>({...current,testPoints:current.testPoints.map(p=>p.id===point.id?{...p,...patch}:p)}))}/>
      <output data-testid="legacy-session">{JSON.stringify(session)}</output></>;
  }
  render(<LegacyPoints/>);
  const row=document.querySelector('tr[data-instrument-id="master-row"]');
  if (!row.querySelector('.cell-tolerance')) fireEvent.click(row.querySelector('.instrument-library-specifications'));
  fireEvent.click(within(row).getByTitle('Edit tolerance'));
  const input=row.querySelector('.inline-tolerance-input');
  fireEvent.change(input,{target:{value:'2.5'}});
  fireEvent.blur(input);
  await waitFor(()=>{
    const session=JSON.parse(screen.getByTestId('legacy-session').textContent);
    expect(session.tmdes[0].instrument.scope).toBe('session');
    for(const point of session.testPoints) {
      expect(point.tmdeTolerances).toHaveLength(2);
      const instance=point.tmdeTolerances.find(item=>item.id===legacy.id);
      expect(instance).toMatchObject({sourceId:master.id,quantity:2,measurementPoint:legacy.measurementPoint});
      expect(instance.tolerance.reading.value).toBe('2.5');
      expect(instance.instrument.id).toBe(session.tmdes[0].instrument.id);
      expect(point.tmdeTolerances.find(item=>item.id===independent.id).instrument.model).toBe('Other');
    }
  });
  expect(saveInstrument).not.toHaveBeenCalled();
});
