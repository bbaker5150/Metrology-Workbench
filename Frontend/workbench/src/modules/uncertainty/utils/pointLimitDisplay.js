import { getUutResolutionComponent, getBudgetComponentsFromTolerance } from "../features/analysis/utils/budgetUtils";
import { refreshTmdeInstancesFromMasters, reconcileTmdeInstances } from "./tmdeReconcile";
import { resolvePointBudgetComponents } from "./resolvePointBudgetComponents";
import { unitSystem, distributionDivisorValue } from "./uncertaintyMath";
import { getInstrumentRangeRows } from "./instrumentFunctionSelection";
import { dynamicMeasurementValue } from "./dynamicBudgetComponents";

export function matchingResolution(source, unit) {
  if (Array.isArray(source)) return finest(source.map(item => matchingResolution(item, unit)));
  const spec = { ...source, ...(source?.tolerances || source?.tolerance || {}) };
  const value = Number(spec.measuringResolution ?? spec.resolution);
  const from = spec.measuringResolutionUnit || spec.resolutionUnit || spec.unit || unit;
  if (!(value > 0) || !Number.isFinite(value)) return 0;
  if (from === unit) return value;
  const a = unitSystem.units[from], b = unitSystem.units[unit];
  return a && b && a.quantity === b.quantity ? value * a.to_si / b.to_si : 0;
}

const finest = values => { const valid = values.filter(value => Number.isFinite(value) && value > 0); return valid.length ? Math.min(...valid) : 0; };

// Resolve the range containing the nominal in today's instrument definition.
// An explicit selection only breaks ties between overlapping matching ranges.
export function resolutionRange(master, snapshot = {}, nominal = {}) {
  if (!master) return snapshot;
  const rows = getInstrumentRangeRows(master, { flattenTolerances: true });
  const id = snapshot.rangeId ?? snapshot.id;
  const explicit = id != null && rows.find(row => String(row.rangeId ?? row.id) === String(id) &&
    (!snapshot.functionId || !row.functionId || String(row.functionId) === String(snapshot.functionId)));
  const candidates = rows.filter(row => {
    if (snapshot.functionId && row.functionId && String(snapshot.functionId) !== String(row.functionId)) return false;
    const from = unitSystem.units[nominal.unit], to = unitSystem.units[row.unit];
    if (from && to && from.quantity !== to.quantity) return false;
    if (nominal.value === "" || nominal.value == null || !Number.isFinite(Number(nominal.value))) return false;
    const value = from && to ? dynamicMeasurementValue(nominal, row.unit) : Number(nominal.value);
    const filled = v => v != null && v !== "";
    if (row.isSingleValue) return value === Number(row.value ?? row.min);
    return (!filled(row.min) || value >= Number(row.min)) && (!filled(row.max) || value <= Number(row.max));
  });
  if (explicit && candidates.includes(explicit)) return explicit;
  if (candidates.length) return candidates[0];
  if (nominal.value === "" || nominal.value == null) return explicit || snapshot;
  // Do not borrow precision from a range that does not cover this nominal.
  return rows.length ? {} : snapshot;
}

export function pointDisplayResolution(point, session = {}, unit = point.testPointInfo?.parameter?.unit) {
  const components = resolvePointBudgetComponents(point, session);
  const nominal = point.testPointInfo?.parameter || {};
  const uutResolution = getUutResolutionComponent(point.uutTolerance || session.uutTolerance, nominal);
  if (uutResolution) components.push(uutResolution);
  const tmdes = refreshTmdeInstancesFromMasters(reconcileTmdeInstances(point.tmdeTolerances || [], session.tmdes || []), session.tmdes || []);
  for (const tmde of tmdes) {
    const symbol = Object.keys(point.variableMappings || {}).find(key => point.variableMappings[key] === tmde.variableType);
    const reference = point.measurementType === 'derived' ? point.variableNominals?.[symbol] : nominal;
    if (reference?.unit) components.push(...getBudgetComponentsFromTolerance(tmde.tolerance || tmde, reference));
  }
  return finest(components.filter(component => component.isResolution && !component.pendingReason).map(component => {
    if (Number(component.resolution) > 0) return matchingResolution(component, unit);
    const divisor = distributionDivisorValue(component.distributionDivisor);
    const usesFullLsd = ["3.464", "4.899"].includes(String(component.distributionDivisor));
    const lsd = Number(component.value_native) * divisor * (usesFullLsd ? 1 : 2);
    return matchingResolution({ resolution: lsd, resolutionUnit: component.unit_native }, unit);
  }));
}

export function formatPointLimit(value, resolution = 0) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "-";
  const number = Number(value);
  if (!(resolution > 0)) return String(Number(number.toPrecision(15)));
  const [mantissa, exponent = "0"] = Number(resolution).toPrecision(12).replace(/\.?0+e/, "e").split(/e/i);
  const fraction = (mantissa.split(".")[1] || "").replace(/0+$/, "").length;
  const decimals = Math.max(0, Math.min(100, fraction - Number(exponent)));
  const formatted = number.toFixed(decimals);
  return Number(formatted) === 0 ? (0).toFixed(decimals) : formatted;
}
