import { v4 as uuid } from 'uuid';
import { buildValidatedSnapshot, diffFromSnapshot } from './instrumentSync';

// Exported ownership and sync badges are historical claims. Only the live
// library can establish a shared origin; preserve imported specifications.
export function reconcileImportedInstruments(session, library, owner) {
  const localInstruments = [];
  const copies = new Map();
  const reconcile = item => {
    if (!item.instrument) return item;
    const instrument = item.instrument;
    const key = JSON.stringify([instrument.id || item.libraryInstrumentId || item.id, buildValidatedSnapshot(instrument)]);
    let copy = copies.get(key);
    if (!copy) {
      const ids = [instrument.sourceId, instrument.importedSourceId, instrument.id, item.libraryInstrumentId].filter(Boolean).map(String);
      const shared = library.find(candidate => ['validated', 'shared'].includes(candidate.scope) &&
        ids.includes(String(candidate.sourceId || candidate.id)));
      const matches = shared && diffFromSnapshot({ ...instrument, validatedSnapshot: buildValidatedSnapshot(shared) }).length === 0;
      copy = matches ? { ...instrument, id: shared.id, sourceId: shared.sourceId || shared.id,
        scope: 'validated', validatedSnapshot: buildValidatedSnapshot(shared), localOverride: false }
        : { ...instrument, id: uuid(), scope: 'local', owner,
          importedSourceId: instrument.importedSourceId || instrument.sourceId || instrument.id || item.libraryInstrumentId,
          sourceId: shared?.sourceId || shared?.id || null,
          validatedSnapshot: shared ? buildValidatedSnapshot(shared) : null, localOverride: true };
      copies.set(key, copy);
      if (!matches) localInstruments.push(copy);
    }
    return { ...item, libraryInstrumentId: copy.id, instrument: copy };
  };
  const uuts = (session.uuts || []).map(reconcile), tmdes = (session.tmdes || []).map(reconcile);
  const testPoints = (session.testPoints || []).map(point => ({ ...point,
    tmdeTolerances: (point.tmdeTolerances || []).map(instance => {
      const embedded = instance.sourceInstrument || instance.instrument;
      if (!embedded) return instance;
      const copy = copies.get(JSON.stringify([embedded.id, buildValidatedSnapshot(embedded)]));
      return copy ? { ...instance, ...(instance.sourceInstrument ? { sourceInstrument: copy } : {}),
        ...(instance.instrument ? { instrument: copy } : {}) } : instance;
    }),
  }));
  return { session: { ...session, uuts, tmdes, testPoints }, localInstruments };
}
