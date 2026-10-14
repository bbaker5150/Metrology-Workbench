import { v4 as uuid } from 'uuid';
import { buildValidatedSnapshot } from './instrumentSync';

// Importing specifications never grants library membership. Promotion is an
// explicit user action, even when a matching definition already exists.
export function reconcileImportedInstruments(session) {
  const copies = new Map();
  const detach = instrument => {
    const key = JSON.stringify([instrument.id, buildValidatedSnapshot(instrument)]);
    if (!copies.has(key)) copies.set(key, {
      ...instrument, id: uuid(), scope: 'session', owner: null,
      importedSourceId: instrument.importedSourceId || instrument.sourceId || instrument.id,
      libraryInstrumentId: null, sourceId: null, validatedSnapshot: null, localOverride: true,
    });
    return copies.get(key);
  };
  const reconcile = item => ({ ...item, libraryInstrumentId: null,
    ...(item.instrument ? { instrument: detach(item.instrument) } : {}),
    ...(item.sourceInstrument ? { sourceInstrument: detach(item.sourceInstrument) } : {}),
  });
  return { session: { ...session,
    uuts: (session.uuts || []).map(reconcile),
    tmdes: (session.tmdes || []).map(reconcile),
    testPoints: (session.testPoints || []).map(point => ({ ...point,
      tmdeTolerances: (point.tmdeTolerances || []).map(reconcile),
    })),
  }, localInstruments: [] };
}
