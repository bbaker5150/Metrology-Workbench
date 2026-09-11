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

export function pointDisplayResolution(point, session = {}, unit = point.testPointInfo?.parameter?.unit) {
  const sources = [point.uutTolerance, ...(point.tmdeTolerances || [])];
  for (const component of point.components || []) {
    if (!component.tmdeBudgetSourceId) continue;
    const master = (session.tmdes || []).find(item => String(item.id) === String(component.tmdeBudgetSourceId));
    if (!master) continue;
    const rows = getInstrumentRangeRows(master, { flattenTolerances: true });
    const row = rows.find(row => String(row.rangeId ?? row.id) === String(component.tmdeBudgetRangeId));
    if (row) sources.push(row);
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
