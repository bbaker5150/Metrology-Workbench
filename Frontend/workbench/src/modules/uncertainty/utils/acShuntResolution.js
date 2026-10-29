import { v4 as uuid } from 'uuid';
import { linkAcShuntDefinition, matchAcShuntInstrument, matchAcShuntRange } from './acShuntLibrary';
import { readerTransferInputs } from './acShuntReaderSpecs';
import { resolveTmdeTransferComponent } from './tmdeTransferComponent';
import { unresolvedComponent } from './incompleteBudget';

const modelOf = value => String(value || '').match(/\b5790[AB]\b/i)?.[0].toUpperCase();

export function linkAcShuntReaders(meta, shared) {
  const readers = new Map();
  for (const [side, prefix] of [['std', 'standard'], ['ti', 'test']]) {
    const model = modelOf(meta[`${prefix}_reader_model`]);
    if (!model) continue;
    const serial = meta[`${prefix}_reader_serial`];
    const identity = `${model}:${serial || meta[`${prefix}_reader_address`] || side}`;
    if (!readers.has(identity)) {
      let definition = matchAcShuntInstrument({ model, serial }, shared);
      // A model-only library definition is a valid resolution profile. Never
      // substitute a different physical serial or arbitrarily pick duplicates.
      if (!definition) {
        const generic = shared.filter(item => !item.serialNumber && !item.assetId &&
          new RegExp(`^(?:Fluke\\s+)?${model}$`, 'i').test(String(item.model || '').trim()));
        if (generic.length === 1) definition = generic[0];
      }
      const name = `Fluke ${model}${serial ? ` ${serial}` : ''}`;
      readers.set(identity, { model, name, sides: [], linked: definition ? linkAcShuntDefinition({
        id: uuid(), name, quantity: 1, isInstrumentBased: true, measurementAreaNames: ['Current'],
      }, definition) : null });
    }
    readers.get(identity).sides.push(side);
  }
  return [...readers.values()];
}

export function acShuntResolutionComponents(point, nominal, readers, source, warnings) {
  return readers.map(reader => {
    const component = { id: uuid(), name: `${reader.name} Resolution`, type: 'B', isResolution: true,
      isCore: true, isBudgetInstance: true, quantity: 1, dof: Infinity,
      tmdeTransferSources: [], tmdeTransferOutputUnit: 'ppm',
      originalInput: { unit: 'ppm', inputMode: 'tolerance', useFiniteDof: false },
      acShuntSource: { ...source, resolutionMethod: 'Full reporting increment / sqrt(12); sum absolute phase sensitivities, largest accepted cycle/direction per role; no averaging credit or assumed cancellation.' } };
    try {
      if (!reader.linked) throw Error(`Match ${reader.name} to a unique instrument library definition with voltage resolution.`);
      if (!point.readerPoints?.length) throw Error('Saved accepted reader phase averages are unavailable. Re-import a session with saved voltage readings.');
      for (const saved of point.readerPoints) {
        if (!Number.isFinite(Number(saved.rangeMode)) || !(Number(saved.rangeMode) > 0)) {
          throw Error('The actual 5790 voltage range was not saved (AUTO or missing). Resolution needs a recorded fixed range.');
        }
        const high = saved.hiresEnabled === true || /^(MEDIUM|SLOW)$/i.test(saved.filterMode || '');
        if (!high && (saved.hiresEnabled !== false || !/^(OFF|FAST)$/i.test(saved.filterMode || ''))) {
          throw Error('Saved 5790 HIRES/filter settings are incomplete.');
        }
        for (const side of reader.sides) {
          const inputs = readerTransferInputs(reader.model, side, { ...saved, [`eta_${side}`]: saved[`eta_${side}`] ?? 1 });
          inputs.voltages.forEach((voltage, index) => {
            const input = { value: Math.abs(Number(voltage)), unit: 'V',
              ...(index < 2 ? { qualifier: nominal.qualifier } : {}) };
            const physicalRange = index < 2 ? Number(saved.rangeMode) : Math.max(.22, Number(saved.rangeMode));
            const range = matchAcShuntRange(reader.linked, inputs.functionNames[index], input, physicalRange);
            const profile = range.fluke5790Resolution;
            if (!profile || !(profile.highResolutionVolts > 0) || !(profile.normalResolutionVolts > 0)) {
              throw Error('The 5790 voltage resolution setup is missing from the library. Restart the backend, then re-import.');
            }
            component.tmdeTransferSources.push({ sourceId: reader.linked.id, rangeId: range.rangeId,
              functionId: range.functionId, nominal: input,
              sensitivity: Number(nominal.value) * inputs.sensitivities[index],
              resolutionMultiplier: high ? 1 : profile.normalResolutionVolts / profile.highResolutionVolts,
              role: side, direction: `${saved.direction}:${saved.cycleIndex ?? 'aggregate'}`,
              phase: ['ac_open', 'ac_close', 'dc_pos', 'dc_neg'][index],
              settings: { rangeMode: saved.rangeMode, filterMode: saved.filterMode, hiresEnabled: saved.hiresEnabled } });
          });
        }
      }
      const resolved = resolveTmdeTransferComponent(component, { tmdes: [reader.linked] }, nominal);
      if (resolved.pendingReason) throw Error(resolved.pendingReason);
      return resolved;
    } catch (error) {
      warnings.push(`${point.current} A / ${point.frequency} Hz: ${reader.name} resolution: ${error.message}`);
      // Discard partial sources: no later recalculation may turn a partially
      // constructed contribution into an apparently complete uncertainty.
      const { tmdeTransferSources, ...pending } = component;
      return unresolvedComponent(pending, error.message);
    }
  });
}
