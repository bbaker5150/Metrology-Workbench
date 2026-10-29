import { buildValidatedSnapshot } from './instrumentSync';
import { getInstrumentRangeRows, isDraftInstrumentRange } from './instrumentFunctionSelection';
import { assessRangeCompatibility } from './tmdeCompatibility';
import { unitSystem } from './uncertaintyMath';
import { instrumentForRole } from './acShuntInstrumentRole';

const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const shuntModel = value => normalized(String(value || '').match(/A40B|Y5020/i)?.[0] || value);
export const sharedAcShuntInstruments = instruments => instruments.filter(item => item.scope === 'validated');

export function acShuntInstrumentRoles(snapshot) {
  const meta = snapshot.instruments;
  const roles = [
    { key: 'uut', label: 'Unit under test', model: meta.test_instrument_model, serial: meta.test_instrument_serial },
    { key: 'shunt', label: 'Reference shunt', model: meta.standard_instrument_model, serial: meta.standard_instrument_serial },
  ];
  for (const [side, role] of [['std', 'standard'], ['ti', 'test']]) {
    const model = meta[`${role}_reader_model`], serial = meta[`${role}_reader_serial`];
    roles.push({ key: `reader:${model}:${serial || meta[`${role}_reader_address`] || side}`, label: `${role} reader`, model, serial });
    if (/A40B/i.test(meta.test_instrument_model || '')) roles.push({ key: `tvc:${meta[`${role}_tvc_serial`] || side}`, label: `${role} TVC`, model: 'TVC', serial: meta[`${role}_tvc_serial`] });
  }
  return roles.filter((role, index) => roles.findIndex(other => other.key === role.key) === index);
}

// Match physical identities, not just a model shared by several calibrated units.
// Older imported definitions stored the serial in `model` and model in description.
export function matchAcShuntInstrument(role, instruments) {
  if (!normalized(role.serial)) return null;
  let candidates = sharedAcShuntInstruments(instruments).filter(item => {
    if (role.kind === 'uut' && item.type === 'tmde' && !item.acShuntIdentity?.roles?.includes('uut')) return false;
    if (role.kind === 'shunt' && item.type === 'uut') return false;
    const sources = [item.acShuntIdentity, ...(item.functions || []).flatMap(fn => (fn.ranges || []).map(range => range.acShuntSource))].filter(Boolean);
    const physicalRanges = sources.map(source => source.shuntRange).filter(value => Number(value) > 0).map(Number);
    if (Number(role.shuntRange) > 0 && physicalRanges.length && !physicalRanges.some(value => Math.abs(value - Number(role.shuntRange)) < 1e-12)) return false;
    const serials = [item.serialNumber, item.assetId, item.model, ...sources.map(source => source.serial)].map(normalized);
    // Alias punctuation is significant: serial 5965004-2 is not serial 59650042.
    const aliasMatch = sources.some(source => (source.serialAliases || []).some(alias =>
      String(alias).trim().toLowerCase() === String(role.serial).trim().toLowerCase()));
    return (serials.includes(normalized(role.serial)) || aliasMatch || normalized(item.model) === normalized(`${role.model} ${role.serial}`)) &&
      [item.model, item.description, ...sources.map(source => source.model)].some(value => normalized(value).includes(shuntModel(role.model))) && Boolean(role.model);
  });
  const reports = (role.reportIds || []).map(String);
  const exactReports = reports.length ? candidates.filter(item =>
    (item.acShuntIdentity?.calibrationEvidence || []).some(row => reports.includes(String(row.report?.id))) ||
    (item.functions || []).some(fn => (fn.ranges || []).some(row => reports.includes(String(row.acShuntSource?.reportId))))) : [];
  // A saved report selection takes precedence; legacy sessions without one
  // use the same manual-first default as the AC-shunt module.
  if (exactReports.length) candidates = exactReports;
  else if (candidates.some(item => item.acShuntIdentity?.isManual)) candidates = candidates.filter(item => item.acShuntIdentity?.isManual);
  return candidates.length === 1 ? candidates[0] : null;
}

export function selectAcShuntDefinitions(snapshot, instruments, selections = {}) {
  const shared = sharedAcShuntInstruments(instruments);
  return acShuntInstrumentRoles(snapshot).map(role => ({ ...role,
    definition: Object.hasOwn(selections, role.key)
      ? shared.find(item => String(item.id) === String(selections[role.key])) || null
      : matchAcShuntInstrument(role, shared),
  }));
}

export function linkAcShuntDefinition(item, definition, role) {
  if (!definition) return item;
  const copy = JSON.parse(JSON.stringify(instrumentForRole(definition, role)));
  return { ...item, libraryInstrumentId: definition.id,
    instrument: { ...copy, sourceId: definition.id, validatedSnapshot: buildValidatedSnapshot(copy), localOverride: false } };
}

export function matchAcShuntRange(item, functionName, nominal, physicalRange) {
  let rows = getInstrumentRangeRows(item).filter(range => !isDraftInstrumentRange(range) &&
    assessRangeCompatibility(range, nominal).compatible);
  // AC and DC voltage ranges can have identical bounds. Never cross their functions.
  const named = rows.filter(row => normalized(row.functionName) === normalized(functionName));
  if (named.length) rows = named;
  else if (rows.some(row => /\b(ac|dc)\b/i.test(row.functionName || ''))) rows = rows.filter(row =>
    !/\b(ac|dc)\b/i.test(functionName) || (row.functionName || '').toLowerCase().includes(functionName.split(' ')[0].toLowerCase()));
  if (physicalRange === 'AUTO' && rows.length) {
    const bound = row => row.max != null && row.max !== '' ? unitSystem.toBaseUnit(Number(row.max), row.unit) : Infinity;
    const smallest = Math.min(...rows.map(bound));
    rows = rows.filter(row => bound(row) === smallest);
  } else if (physicalRange != null) {
    const physical = rows.filter(row => row.max != null && row.max !== '' &&
      Math.abs(unitSystem.toBaseUnit(Number(row.max), row.unit) - Number(physicalRange)) < 1e-12);
    rows = physical;
  }
  if (rows.length !== 1) throw new Error(`${item.name}: ${rows.length ? 'multiple shared ranges match' : 'no shared range matches'} ${nominal.value} ${nominal.unit}${nominal.qualifier ? ` / ${nominal.qualifier.value} ${nominal.qualifier.unit}` : ''} (${functionName}). Review the shared instrument ranges.`);
  return rows[0];
}
