import { formatInstrumentIdentity } from './instrumentIdentity';
import { getInstrumentRangeRows } from './instrumentFunctionSelection';
import { reconcileTmdeInstances, refreshTmdeInstancesFromMasters, tmdeInstanceMatchesMaster } from './tmdeReconcile';
import { resolutionRange, matchingResolution, formatPointLimit } from './pointLimitDisplay';
import { calculateUncertaintyFromToleranceObject, getAbsoluteLimits, getUnitDisplayLabel, unitSystem } from './uncertaintyMath';
import { dynamicMeasurementValue } from './dynamicBudgetComponents';
import { resolveY5020Resolution } from './y5020Resolution';

// Stable, CSS-grid-safe keys: renaming an instrument must not reset its columns.
const instrumentKey = id => String(id).split('').map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
export const isTmdePointColumn = key => /^tmde_[0-9a-f]+_(limits|uncertainty)$/.test(key);
export function getTmdePointColumns(tmdes = []) {
  const names = new Map();
  return tmdes.flatMap(master => {
    if (master.id == null) return [];
    const identity = formatInstrumentIdentity(master, 'TMDE');
    const count = (names.get(identity) || 0) + 1;
    names.set(identity, count);
    const name = count > 1 ? `${identity} (${count})` : identity;
    return ['limits', 'uncertainty'].map(kind => ({
      key: `tmde_${instrumentKey(master.id)}_${kind}`, masterId: master.id, kind,
      label: `${name} ${kind === 'limits' ? 'Limits' : 'Uncertainty'}`,
    }));
  });
}

export function availableTmdePointColumns(columns, definitions) {
  const available = new Set(definitions.map(column => column.key));
  return Object.fromEntries(Object.entries(columns).map(([key, shown]) => [key,
    key === 'tmdeLow' || key === 'tmdeHigh' ? false : shown && (!isTmdePointColumn(key) || available.has(key))]));
}

// Display the actual source specifications at their own input nominals. This
// does not aggregate instruments, change the budget, or apply output-unit limits
// to a meter reading a different physical quantity.
export function getPointTmdeSpecifications(point, master, session = {}) {
  const entries = [], seen = new Set();
  const nominal = point.testPointInfo?.parameter || {};
  const referenceFor = source => point.measurementType === 'derived'
    ? point.variableNominals?.[Object.keys(point.variableMappings || {}).find(key => point.variableMappings[key] === source.variableType)]
    : source.measurementPoint || nominal;
  const add = (range, reference, label = '', quantity = 1, resolutionOnly = false) => {
    const key = JSON.stringify([range?.functionId, range?.rangeId ?? range?.id, reference, label, resolutionOnly]);
    if (seen.has(key)) return;
    seen.add(key);
    const entry = { key, range, reference, label: [label, quantity > 1 ? `×${quantity}` : ''].filter(Boolean).join(' '), limits: '—' };
    if (!range) { entries.push({ ...entry, reason: 'The linked TMDE range is missing.' }); return; }
    const targetUnit = range.unit || range.functionUnit;
    const from = unitSystem.units[reference?.unit], to = unitSystem.units[targetUnit];
    const validNominal = reference?.value !== '' && reference?.value != null && Number.isFinite(Number(reference.value));
    if (validNominal && from && to && from.quantity === to.quantity) {
      entry.reference = { ...reference, value: dynamicMeasurementValue(reference, targetUnit), unit: targetUnit };
    }
    if (resolutionOnly) {
      const resolution = range.measuringResolution ?? range.resolution;
      const unit = range.measuringResolutionUnit || range.resolutionUnit || targetUnit;
      entry.specification = Number(resolution) > 0 ? `Resolution: ${resolution} ${getUnitDisplayLabel(unit)}` : 'Resolution: Not Set';
      entry.reason = 'Only resolution is used from this instrument at this point; no accuracy limits are applied.';
    } else if (validNominal && from && (!to || from.quantity === to.quantity)) {
      try {
        const tolerance = { ...range, ...(range.tolerance || range.tolerances || {}) };
        const breakdown = calculateUncertaintyFromToleranceObject(tolerance, entry.reference).breakdown || [];
        if (tolerance.singleSided || breakdown.some(row => row.absoluteLow != null && row.absoluteHigh != null)) {
          const bounds = getAbsoluteLimits(tolerance, entry.reference, { snap: false });
          if (bounds.reason || bounds.rawLow == null || bounds.rawHigh == null) {
            entry.reason = bounds.reason || 'The linked specification has no usable limits.';
          } else {
            const resolution = matchingResolution(range, entry.reference.unit);
            const format = value => value === '—' ? value : formatPointLimit(value, resolution);
            entry.limits = `${format(bounds.rawLow)} to ${format(bounds.rawHigh)} ${getUnitDisplayLabel(entry.reference.unit)}`;
            entry.fullLimits = `${bounds.low} to ${bounds.high}`;
          }
        } else entry.reason = 'The linked range has no specification limits.';
      } catch { entry.reason = 'The linked specification cannot be evaluated at this input.'; }
    } else entry.reason = 'A compatible TMDE input value and unit are required to calculate limits.';
    entries.push(entry);
  };
  const instances = refreshTmdeInstancesFromMasters(reconcileTmdeInstances(point.tmdeTolerances || [], session.tmdes || []), session.tmdes || []);
  for (const instance of instances.filter(source => tmdeInstanceMatchesMaster(source, master))) {
    add(instance.tolerance || instance, referenceFor(instance), instance.variableType, Number(instance.quantity) || 1);
  }
  let ranges;
  const findRange = source => {
    ranges ||= getInstrumentRangeRows(master, { flattenTolerances: true,
      rangeIds: (point.components || []).flatMap(component => component.tmdeTransferSources
        ? component.tmdeTransferSources.map(input => input.rangeId) : [component.tmdeBudgetRangeId]).filter(id => id != null) });
    return ranges.find(range => String(range.rangeId ?? range.id) === String(source.rangeId)
      && (!source.functionId || String(range.functionId) === String(source.functionId)));
  };
  for (const component of point.components || []) {
    if (component.tmdeTransferSources) {
      for (const source of component.tmdeTransferSources.filter(source => String(source.sourceId) === String(master.id))) {
        add(findRange(source), source.nominal, [source.role, source.direction].filter(Boolean).join(' / '), 1, component.isResolution);
      }
      continue;
    }
    if (![master.id, master.sourceId].some(id => id != null && String(id) === String(component.tmdeBudgetSourceId))) continue;
    if (component.y5020Resolution) {
      const resolved = resolveY5020Resolution(component, session, nominal);
      if (resolved.pendingReason) entries.push({ key: component.id, limits: '—', specification: 'Not Set', reason: resolved.pendingReason });
      else add(resolved.tmdeBudgetRange, null, '', 1, true);
      continue;
    }
    const reference = referenceFor(component);
    const range = component.tmdeBudgetRangeId
      ? findRange({ rangeId: component.tmdeBudgetRangeId, functionId: component.tmdeBudgetFunctionId })
      : resolutionRange(master, { functionId: component.tmdeBudgetFunctionId }, reference || {});
    // Accuracy and resolution contributions may refer to the same range.
    // Their shared specification needs only one row in the point list.
    const isResolution = source => source.isResolution || source.tmdeBudgetComponentKind === 'Resolution';
    const resolutionOnly = isResolution(component)
      && !instances.some(source => tmdeInstanceMatchesMaster(source, master) && source.variableType === component.variableType)
      && !(point.components || []).some(source => !isResolution(source)
        && source.tmdeBudgetSourceId === component.tmdeBudgetSourceId
        && source.tmdeBudgetRangeId === component.tmdeBudgetRangeId
        && source.variableType === component.variableType);
    add(range, reference, component.variableType, Number(component.quantity) || 1, Boolean(resolutionOnly));
  }
  return entries;
}
