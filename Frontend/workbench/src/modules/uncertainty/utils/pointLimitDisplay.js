import { unitSystem } from "./uncertaintyMath";
import { getInstrumentRangeRows } from "./instrumentFunctionSelection";

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

// Resolve the selected range from today's instrument definition, not a stale
// point snapshot or a finer resolution on an unrelated range.
export function resolutionRange(master, snapshot = {}, nominal = {}) {
  if (!master) return snapshot;
  const rows = getInstrumentRangeRows(master, { flattenTolerances: true });
  const id = snapshot.rangeId ?? snapshot.id;
  const explicit = id != null && rows.find(row => String(row.rangeId ?? row.id) === String(id) &&
    (!snapshot.functionId || !row.functionId || String(row.functionId) === String(snapshot.functionId)));
  if (explicit) return explicit;
  const candidates = rows.filter(row => {
    const from = unitSystem.units[nominal.unit], to = unitSystem.units[row.unit];
    if (from && to && from.quantity !== to.quantity) return false;
    if (nominal.value === "" || nominal.value == null || !Number.isFinite(Number(nominal.value))) return false;
    const value = from && to ? unitSystem.fromBaseUnit(unitSystem.toBaseUnit(Number(nominal.value), nominal.unit), row.unit) : Number(nominal.value);
    const filled = v => v != null && v !== "";
    if (row.isSingleValue) return value === Number(row.value ?? row.min);
    return (!filled(row.min) || value >= Number(row.min)) && (!filled(row.max) || value <= Number(row.max));
  });
  return candidates[0] || snapshot;
}

export function pointDisplayResolution(point, session = {}, unit = point.testPointInfo?.parameter?.unit) {
  const nominal = point.testPointInfo?.parameter || {};
  const uutId = point.activeUutId || point.associatedUutIds?.[0];
  const uut = (session.uuts || []).find(item => String(item.id) === String(uutId));
  const sources = [resolutionRange(uut, point.uutTolerance || {}, nominal)];
  for (const instance of point.tmdeTolerances || []) {
    const master = (session.tmdes || []).find(item => [instance.sourceId, instance.id].some(id => id != null && String(item.id) === String(id)));
    sources.push(resolutionRange(master, { ...instance, ...(instance.tolerance || {}) }, nominal));
  }
  for (const component of point.components || []) {
    if (!component.tmdeBudgetSourceId) continue;
    const master = (session.tmdes || []).find(item => String(item.id) === String(component.tmdeBudgetSourceId));
    if (!master) continue;
    sources.push(resolutionRange(master, { rangeId: component.tmdeBudgetRangeId, functionId: component.tmdeBudgetFunctionId }, nominal));
  }
  return finest(sources.map(source => matchingResolution(source, unit)));
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
