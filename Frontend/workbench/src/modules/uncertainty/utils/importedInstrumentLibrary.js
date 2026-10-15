import { v4 as uuid } from 'uuid';
import { buildValidatedSnapshot } from './instrumentSync';

// Importing specifications never grants library membership. Promotion is an
// explicit user action, even when a matching definition already exists.
export function reconcileImportedInstruments(session, { sharedInstruments = [] } = {}) {
  const copies = new Map();
  const detach = instrument => {
    // Only the AC-shunt workflow explicitly supplies the live shared library.
    // Ordinary file imports still detach, even if they carry shared-looking IDs.
    const shared = sharedInstruments.find(item => item.scope === 'validated' &&
      String(item.id) === String(instrument.sourceId));
    if (shared && JSON.stringify(instrument.validatedSnapshot) === JSON.stringify(buildValidatedSnapshot(shared))) {
      return { ...instrument, libraryInstrumentId: shared.id };
    }
    const key = JSON.stringify([instrument.id, buildValidatedSnapshot(instrument)]);
    if (!copies.has(key)) copies.set(key, {
      ...instrument, id: uuid(), scope: 'session', owner: null,
      importedSourceId: instrument.importedSourceId || instrument.sourceId || instrument.id,
      libraryInstrumentId: null, sourceId: null, validatedSnapshot: null, localOverride: true,
    });
    return copies.get(key);
  };
  const reconcile = item => {
    const instrument = item.instrument && detach(item.instrument);
    const sourceInstrument = item.sourceInstrument && detach(item.sourceInstrument);
    return { ...item, libraryInstrumentId: instrument?.libraryInstrumentId || sourceInstrument?.libraryInstrumentId || null,
      ...(instrument ? { instrument } : {}), ...(sourceInstrument ? { sourceInstrument } : {}) };
  };
  return { session: { ...session,
    uuts: (session.uuts || []).map(reconcile),
    tmdes: (session.tmdes || []).map(reconcile),
    testPoints: (session.testPoints || []).map(point => ({ ...point,
      tmdeTolerances: (point.tmdeTolerances || []).map(reconcile),
    })),
  }, localInstruments: [] };
}
