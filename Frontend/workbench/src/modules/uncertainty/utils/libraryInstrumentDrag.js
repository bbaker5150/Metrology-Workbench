import { v4 as uuidv4 } from 'uuid';
import { instrumentMeasurementAreas, resolveSessionMeasurementAreas } from './measurementAreaGrouping';
import { instrumentForRole } from './acShuntInstrumentRole';
import { buildValidatedSnapshot } from './instrumentSync';

export const LIBRARY_INSTRUMENT_MIME = 'application/x-workbench-library-instruments';
const isLibraryDrag = transfer => transfer?.types?.includes(LIBRARY_INSTRUMENT_MIME) || Boolean(transfer?.getData(LIBRARY_INSTRUMENT_MIME));

// Library drops create session instances, preserving definition identity and
// sync metadata. They never cut a library record or replace an existing row.
export function addLibraryInstrumentRows(session, definitions, kind, areaKey) {
  const area = resolveSessionMeasurementAreas(session).find(item => item.key === areaKey);
  const rows = definitions.map(definition => {
    const instrument = structuredClone(instrumentForRole(definition, kind));
    if (instrument.acShuntIdentity?.usageRole === 'uut') instrument.validatedSnapshot = buildValidatedSnapshot(instrument);
    const name = instrument.description || [instrument.manufacturer, instrument.model].filter(Boolean).join(' ') || 'Instrument';
    return {
      id: uuidv4(), instrument,
      ...(kind === 'uut' ? { description: name } : { name, quantity: 1, assetId: '', isInstrumentBased: true }),
      measurementAreaNames: area ? [area.name] : instrumentMeasurementAreas({ instrument }).map(item => item.name),
      ...(area ? { measurementArea: area.name, measurementAreaId: area.id, measurementAreaColor: area.color } : {}),
      ...(instrument.customFields ? { customFields: structuredClone(instrument.customFields) } : {}),
      ...(instrument.rangeCustomFields ? { rangeCustomFields: structuredClone(instrument.rangeCustomFields) } : {}),
    };
  });
  const key = kind === 'uut' ? 'uuts' : 'tmdes';
  return { ...session, [key]: [...(session[key] || []), ...rows] };
}

export function libraryInstrumentDropHandlers(sessionRef, onSave, kind, disabled = false, defaultAreaKey) {
  return {
    onDragOverCapture(event) {
      if (!isLibraryDrag(event.dataTransfer)) return;
      event.stopPropagation();
      if (!disabled && onSave) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
    },
    onDropCapture(event) {
      if (!isLibraryDrag(event.dataTransfer)) return;
      event.preventDefault(); event.stopPropagation();
      if (disabled || !onSave) return;
      let definitions;
      try { definitions = JSON.parse(event.dataTransfer.getData(LIBRARY_INSTRUMENT_MIME)); } catch { return; }
      if (!Array.isArray(definitions) || !definitions.length || !definitions.every(item => item && typeof item === 'object' && item.id != null)) return;
      const areaKey = event.target.closest?.('[data-measurement-area]')?.dataset.measurementArea || defaultAreaKey;
      onSave(addLibraryInstrumentRows(sessionRef.current, definitions, kind, areaKey));
    },
  };
}
