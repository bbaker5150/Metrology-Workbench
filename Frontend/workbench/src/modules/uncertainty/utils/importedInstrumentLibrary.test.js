import { expect, it } from 'vitest';
import { reconcileImportedInstruments } from './importedInstrumentLibrary';
import { computeSyncState } from './instrumentSync';
const instrument = { id: 'meter', model: '20A', functions: [], owner: 'exporter' };
it.each(['local', 'validated', 'shared', 'session'])('imports %s as session only', scope => {
  const definition = { ...instrument, scope, sourceId: 'shared', libraryInstrumentId: 'shared', validatedSnapshot: instrument };
  const session = { uuts: [{ id: 'uut', libraryInstrumentId: 'shared', instrument: definition }], tmdes: [{ id: 'tmde', instrument: definition }], testPoints: [{ id: 'p', tmdeTolerances: [{ sourceInstrument: definition }] }] };
  const result = reconcileImportedInstruments(session, [definition], 'importer');
  const copy = result.session.uuts[0].instrument;
  expect(result.localInstruments).toEqual([]);
  expect(copy).toMatchObject({ scope: 'session', owner: null, sourceId: null, libraryInstrumentId: null, validatedSnapshot: null, model: '20A' });
  expect(copy.id).not.toBe(definition.id);
  expect(computeSyncState(copy)).toBe('red');
  expect(result.session.uuts[0].libraryInstrumentId).toBeNull();
  expect(result.session.tmdes[0].instrument).toBe(copy);
  expect(result.session.testPoints[0].tmdeTolerances[0].sourceInstrument).toBe(copy);
  expect(definition.scope).toBe(scope);
});
it('retains independent edits and detaches point-only instruments', () => {
  const result = reconcileImportedInstruments({ uuts: [{ instrument }], tmdes: [{ instrument: { ...instrument, model: 'Edited' } }], testPoints: [{ tmdeTolerances: [{ instrument: { ...instrument, id: 'point-only' } }] }] });
  expect(result.session.uuts[0].instrument.id).not.toBe(result.session.tmdes[0].instrument.id);
  expect(result.session.tmdes[0].instrument.model).toBe('Edited');
  expect(result.session.testPoints[0].tmdeTolerances[0].instrument.scope).toBe('session');
});
