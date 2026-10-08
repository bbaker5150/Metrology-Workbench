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
    const key = instrument.id || item.libraryInstrumentId || item.id;
    let copy = copies.get(key);
    if (!copy) {
      const ids = [instrument.sourceId, instrument.id, item.libraryInstrumentId].filter(Boolean).map(String);
      const shared = library.find(candidate => ['validated', 'shared'].includes(candidate.scope) &&
        ids.includes(String(candidate.sourceId || candidate.id)));
      const matches = shared && diffFromSnapshot({ ...instrument, validatedSnapshot: buildValidatedSnapshot(shared) }).length === 0;
      copy = matches ? { ...instrument, id: shared.id, sourceId: shared.sourceId || shared.id,
        scope: 'validated', validatedSnapshot: buildValidatedSnapshot(shared), localOverride: false }
        : { ...instrument, id: uuid(), scope: 'local', owner,
          sourceId: shared?.sourceId || shared?.id || null,
          validatedSnapshot: shared ? buildValidatedSnapshot(shared) : null, localOverride: true };
      copies.set(key, copy);
      if (!matches) localInstruments.push(copy);
    }
    return { ...item, libraryInstrumentId: copy.id, instrument: copy };
  };
  return { session: { ...session, uuts: (session.uuts || []).map(reconcile), tmdes: (session.tmdes || []).map(reconcile) }, localInstruments };
}
