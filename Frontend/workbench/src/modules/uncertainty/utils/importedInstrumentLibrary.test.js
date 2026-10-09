import { expect, it } from 'vitest';
import { reconcileImportedInstruments } from './importedInstrumentLibrary';
import { computeSyncState, diffFromSnapshot } from './instrumentSync';

const instrument = { id: 'meter', manufacturer: 'Example', model: '20A', functions: [], typeBComponents: [], scope: 'local', owner: 'exporter' };
const session = { uuts: [{ id: 'uut', instrument }], tmdes: [{ id: 'tmde', instrument }], testPoints: [{ id: 'point' }] };

it('imports another user’s local instruments into the importing user’s library once', () => {
  const result = reconcileImportedInstruments(session, [], 'importer');
  expect(result.localInstruments).toHaveLength(1);
  const copy = result.localInstruments[0];
  expect(copy).toMatchObject({ scope: 'local', owner: 'importer', sourceId: null });
  expect(copy.id).not.toBe('meter');
  expect(result.session.uuts[0].instrument).toBe(result.session.tmdes[0].instrument);
  expect(result.session.tmdes[0].id).toBe('tmde');
  expect(computeSyncState(copy)).toBe('yellow');
  expect(instrument.owner).toBe('exporter');
});

it('recognizes an instrument synced after the session was exported', () => {
  const shared = { ...instrument, scope: 'validated', sourceId: 'meter' };
  const result = reconcileImportedInstruments(session, [shared], 'importer');
  expect(result.localInstruments).toHaveLength(0);
  expect(computeSyncState(result.session.uuts[0].instrument)).toBe('green');
});

it('preserves provenance through a local import and later export before syncing', () => {
  const first = reconcileImportedInstruments(session, [], 'importer');
  const next = reconcileImportedInstruments(first.session, [{ ...instrument, scope: 'validated' }], 'third-user');
  expect(next.localInstruments).toHaveLength(0);
  expect(computeSyncState(next.session.uuts[0].instrument)).toBe('green');
});

it('preserves independently edited definitions even when exported ids match', () => {
  const result = reconcileImportedInstruments({ ...session, tmdes: [{ id: 'tmde', instrument: { ...instrument, model: 'Edited' } }] }, [], 'importer');
  expect(result.localInstruments).toHaveLength(2);
  expect(result.session.tmdes[0].instrument.model).toBe('Edited');
  expect(result.session.uuts[0].instrument.model).toBe('20A');
});

it('does not trust exported sync metadata when the shared record is absent or changed', () => {
  const exported = { ...session, uuts: [{ id: 'uut', instrument: { ...instrument, scope: 'validated', sourceId: 'meter', validatedSnapshot: instrument } }] };
  for (const library of [[], [{ ...instrument, scope: 'validated', model: 'Different' }]]) {
    const result = reconcileImportedInstruments(exported, library, 'importer');
    expect(result.session.uuts[0].instrument).toMatchObject({ scope: 'local', owner: 'importer' });
    expect(result.localInstruments).toContain(result.session.uuts[0].instrument);
    expect(result.session.uuts[0].instrument.localOverride).toBe(true);
    expect(computeSyncState(result.session.uuts[0].instrument)).toBe('yellow');
    expect(result.session.uuts[0].instrument.model).toBe('20A');
  }
});

it('includes secondary uncertainty sources when checking whether specifications match', () => {
  const result = reconcileImportedInstruments(session, [{ ...instrument, scope: 'validated', tmdeSecondaryUncertainties: [{ id: 'extra', name: 'Thermal' }] }], 'importer');
  const copy = result.session.uuts[0].instrument;
  expect(result.localInstruments).toEqual([copy]);
  expect(copy).toMatchObject({ scope: 'local', owner: 'importer', localOverride: true });
  expect(diffFromSnapshot(copy).map(diff => diff.field)).toEqual(['tmdeSecondaryUncertainties']);
  expect(computeSyncState(copy)).toBe('yellow');
});
