import { v4 as uuid } from 'uuid';
import { linkAcShuntDefinition } from './acShuntLibrary';
import { getInstrumentRangeRows } from './instrumentFunctionSelection';
import { getBudgetComponentsFromTolerance } from '../features/analysis/utils/budgetUtils';
import { formatInstrumentIdentity } from './instrumentIdentity';
import { unresolvedComponent } from './incompleteBudget';
import { distributionDivisorValue, resolveErrorDistribution, unitSystem } from './uncertaintyMath';

const modelOf = value => {
  const match = String(value || '').match(/5790\s*([AB])\b/i);
  return match ? `5790${match[1].toUpperCase()}` : null;
};
const identityText = item => [item.manufacturer, item.model, item.description].filter(Boolean).join(' ');
const serials = item => [item.serialNumber, item.assetId, item.serial, ...(identityText(item).match(/\b[\w-]*\d{5,}[\w-]*\b/g) || [])]
  .filter(Boolean).map(value => String(value).trim().toLowerCase());

export function linkAcShuntReaders(meta, instruments) {
  const readers = new Map();
  // The caller already supplies this workstation's visible library. Local
  // definitions are valid sources, including local copies of shared profiles.
  const visible = instruments.filter(item => !instruments.some(other => other.scope === 'local' && String(other.sourceId) === String(item.id)));
  for (const [side, prefix] of [['std', 'standard'], ['ti', 'test']]) {
    const model = modelOf(meta[`${prefix}_reader_model`]);
    if (!model) continue;
    const serial = String(meta[`${prefix}_reader_serial`] || '').trim();
    const identity = `${model}:${serial || meta[`${prefix}_reader_address`] || side}`;
    if (!readers.has(identity)) {
      const candidates = visible.filter(item => item.type !== 'uut' && modelOf(identityText(item)) === model);
      const exact = serial ? candidates.filter(item => serials(item).includes(serial.toLowerCase())) : [];
      const matches = exact.length ? exact : candidates.filter(item => !serials(item).length);
      if (matches.length !== 1) throw Error(`Select a unique existing Fluke ${model} definition in the instrument library before importing.`);
      const definition = matches[0];
      const item = { id: uuid(), name: definition.description || '', quantity: 1,
        isInstrumentBased: true, measurementAreaNames: ['Current'], libraryInstrumentId: definition.id };
      const linked = definition.scope === 'validated' ? linkAcShuntDefinition(item, definition)
        : { ...item, instrument: JSON.parse(JSON.stringify(definition)) };
      readers.set(identity, { sides: [], linked });
    }
    readers.get(identity).sides.push(side);
  }
  return [...readers.values()];
}

export function acShuntResolutionComponents(point, nominal, readers) {
  return readers.map(({ linked, sides }) => {
    const rows = getInstrumentRangeRows(linked, { flattenTolerances: true }).filter(row =>
      Number(row.measuringResolution ?? row.resolution) > 0);
    const ppm = rows.filter(row => row.unit === 'ppm');
    const physicalRange = point.readerResolution?.[sides[0]]?.rangeVolts;
    const volts = rows.filter(row => unitSystem.getQuantity(row.unit) === unitSystem.getQuantity('V') &&
      Math.abs(unitSystem.toBaseUnit(Number(row.max), row.unit) - Number(physicalRange)) < 1e-12);
    const ac = volts.filter(row => /\bac\b/i.test(row.functionName || ''));
    const matches = ppm.length ? ppm : ac.length ? ac : volts;
    if (matches.length !== 1) throw Error(`Set resolution on the existing ${formatInstrumentIdentity(linked)} range before importing.`);
    const range = matches[0];
    const coefficients = sides.map(side => point.readerResolution?.[side]?.ppmPerVolt);
    const id = uuid();
    const component = { id, componentId: id, name: `${formatInstrumentIdentity(linked)} - Resolution`,
      type: 'B', isCore: true, isBudgetInstance: true, isResolution: true, quantity: 1, dof: Infinity,
      sourceTmdeId: linked.id, tmdeBudgetSourceId: linked.id, tmdeBudgetRange: range,
      tmdeBudgetRangeId: range.rangeId, tmdeBudgetFunctionId: range.functionId,
      tmdeBudgetFunctionName: range.functionName, tmdeBudgetComponentKind: 'Resolution',
      acShuntResolution: { ppmPerVolt: coefficients.every(value => Number.isFinite(value) && value > 0)
        ? coefficients.reduce((sum, value) => sum + value, 0) : null },
      originalInput: { inputMode: 'tolerance', unit: 'ppm', useFiniteDof: false } };
    const resolved = resolveAcShuntResolution(component, { tmdes: [linked] }, nominal);
    if (resolved.pendingReason) throw Error(`${point.current} A / ${point.frequency} Hz: ${resolved.pendingReason}`);
    return resolved;
  });
}

// A normal linked TMDE resolution row, evaluated from the same field displayed
// on the instrument. Only the volts-to-ppm sensitivity is specific to AC shunts.
export function resolveAcShuntResolution(component, session, nominal) {
  const meter = session.tmdes?.find(item => String(item.id) === String(component.tmdeBudgetSourceId));
  const range = meter && getInstrumentRangeRows(meter, { flattenTolerances: true }).find(row =>
    String(row.rangeId) === String(component.tmdeBudgetRangeId) && String(row.functionId) === String(component.tmdeBudgetFunctionId));
  if (!range) return unresolvedComponent(component, 'The linked 5790 resolution range is missing.');
  const resolution = getBudgetComponentsFromTolerance({ ...range, includeResolutionInBudget: true,
    tolerances: { ...(range.tolerances || range.tolerance), includeResolutionInBudget: true } }, { value: 1, unit: 'V' }).find(row => row.isResolution);
  const unit = range.measuringResolutionUnit || range.resolutionUnit || range.unit;
  const coefficient = unit === 'ppm' ? 1e6 : component.acShuntResolution.ppmPerVolt;
  if (!resolution || resolution.pendingReason || !Number.isFinite(resolution.value_native)) {
    return unresolvedComponent(component, 'Set the resolution on the linked 5790 instrument.');
  }
  if (!(coefficient > 0) || !Number.isFinite(coefficient)) {
    return unresolvedComponent(component, 'Saved reader voltages or range are missing; the 5790 voltage resolution cannot yet be converted to ppm.');
  }
  const ppm = resolution.value_native * coefficient;
  const rawDivisor = distributionDivisorValue(resolution.distributionDivisor);
  const divisor = ['3.464', '4.899'].includes(String(resolution.distributionDivisor)) ? rawDivisor / 2 : rawDivisor;
  const distribution = resolveErrorDistribution(divisor);
  const limit = ppm * divisor;
  return { ...component, name: `${formatInstrumentIdentity(meter)} - Resolution`, pendingReason: null,
    value: ppm, value_native: Math.abs(Number(nominal.value)) * ppm * 1e-6, unit_native: nominal.unit,
    toleranceLimit_native: Math.abs(Number(nominal.value)) * limit * 1e-6,
    distribution: distribution?.label || resolution.distribution, distributionDivisor: distribution?.value || String(divisor),
    authoredTolerance: { floor: { high: limit, low: -limit, unit: 'ppm', symmetric: true, distribution: distribution?.value || String(divisor) } },
    isBaseUnitValue: false, resolution: resolution.resolution, resolutionUnit: resolution.resolutionUnit,
    originalInput: { ...component.originalInput, toleranceLimit: limit, unit: 'ppm' } };
}
