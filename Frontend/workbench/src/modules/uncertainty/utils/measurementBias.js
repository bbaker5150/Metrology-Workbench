import { calculateDerivedUncertainty, unitSystem } from "./uncertaintyMath";
import { getInstrumentRangeRows } from "./instrumentFunctionSelection";
import { resolvePointBudgetComponents } from "./resolvePointBudgetComponents";
import { reconcileTmdeInstances, refreshTmdeInstancesFromMasters } from "./tmdeReconcile";

const present = value => value !== undefined && value !== null && String(value).trim() !== "";
const configured = spec => present(spec?.value);
const same = (a, b) => present(a) && present(b) && String(a) === String(b);
const biasOf = source => source?.bias ?? source?.tolerances?.bias ?? source?.tolerance?.bias;

// Bias is an interval, including for Celsius/Fahrenheit: never apply a unit offset.
export function biasInUnit(spec, reference, outputUnit = reference?.unit) {
  if (!configured(spec) || spec.corrected) return 0;
  const value = Number(spec.value);
  if (!Number.isFinite(value)) throw new Error("Enter a finite signed bias.");
  const sourceUnit = spec.unit || reference?.unit;
  const fromQuantity = unitSystem.getQuantity(sourceUnit);
  const toQuantity = unitSystem.getQuantity(outputUnit);
  if (!fromQuantity || !toQuantity || fromQuantity !== toQuantity) throw new Error("Bias units must match the measured quantity.");
  const scale = unit => unitSystem.toBaseUnit(1, unit) - unitSystem.toBaseUnit(0, unit);
  if (spec.kind === "percent") {
    if (!present(reference?.value) || !Number.isFinite(Number(reference.value))) throw new Error("A measurement value is needed for a relative bias.");
    if (unitSystem.getQuantity(reference.unit) !== toQuantity) throw new Error("Bias units must match the measured quantity.");
    return value / 100 * Math.abs(Number(reference.value)) * scale(reference.unit) / scale(outputUnit);
  }
  return value * scale(sourceUnit) / scale(outputUnit);
}

function selectedRange(master, rangeId, functionId) {
  return getInstrumentRangeRows(master, { flattenTolerances: true }).find(range =>
    same(range.rangeId ?? range.id, rangeId) && (!functionId || !range.functionId || same(functionId, range.functionId)));
}

export function getUutBiasDefault(point = {}, session = {}) {
  const tolerance = point.uutTolerance || session.uutTolerance || {};
  const master = (session.uuts || []).find(item => same(item.id, point.activeUutId || point.associatedUutIds?.[0]));
  const range = master && selectedRange(master, tolerance.rangeId ?? tolerance.id, tolerance.functionId);
  return biasOf(range) ?? biasOf(tolerance) ?? biasOf(master);
}

// One source per included error-limit/component, not per calculated breakdown row.
// Resolution rows never inherit an instrument's bias a second time.
export function getPointBiasSources(point = {}, session = {}) {
  const nominal = point.testPointInfo?.parameter || {};
  const derived = point.measurementType === "derived";
  const sources = [];
  const add = (key, name, variableType, reference, spec, quantity = 1) => {
    if (sources.some(row => row.key === key)) return;
    const override = point.measurementBias?.sources?.[key];
    sources.push({ key, name, variableType, reference, inherited: spec, spec: override ?? spec, overridden: override != null, quantity: Number(quantity) || 1 });
  };
  const referenceFor = (variableType, fallback) => {
    const symbol = Object.keys(point.variableMappings || {}).find(symbol => point.variableMappings[symbol] === variableType);
    return derived ? point.variableNominals?.[symbol] || point.variableNominals?.[variableType] || fallback || nominal : nominal;
  };
  for (const component of resolvePointBudgetComponents(point, session)) {
    if (component.uutResolutionBudgetSource || component.isResolution || component.tmdeBudgetComponentKind === "Resolution") continue;
    const master = (session.tmdes || []).find(item => same(item.id, component.tmdeBudgetSourceId) || same(item.sourceId, component.tmdeBudgetSourceId));
    const range = master && selectedRange(master, component.tmdeBudgetRangeId, component.tmdeBudgetFunctionId);
    const key = component.tmdeBudgetSourceId
      ? `tmde:${component.tmdeBudgetSourceId}:${component.tmdeBudgetFunctionId || ""}:${component.tmdeBudgetRangeId || ""}:${component.variableType || ""}`
      : `component:${component.id}`;
    add(key, component.name || "Component", component.variableType, referenceFor(component.variableType), biasOf(range) ?? biasOf(component) ?? biasOf(master), component.quantity);
  }
  const instances = refreshTmdeInstancesFromMasters(reconcileTmdeInstances(point.tmdeTolerances || [], session.tmdes || []), session.tmdes || []);
  for (const instance of instances) {
    const master = (session.tmdes || []).find(item => same(item.id, instance.sourceId || instance.id));
    const range = master && selectedRange(master, instance.rangeId || instance.tolerance?.rangeId, instance.functionId);
    add(`instance:${instance.id}`, instance.name || master?.name || "TMDE", instance.variableType, referenceFor(instance.variableType, instance.measurementPoint), biasOf(range) ?? biasOf(instance) ?? biasOf(master), instance.quantity);
  }
  return sources;
}

export function resolveMeasurementBias(point = {}, session = {}, calculatedAverage, { includeSources = true } = {}) {
  const reference = point.testPointInfo?.parameter || {};
  const nominal = Number(reference.value);
  const result = { uutBias: 0, calBias: 0, riskAverage: Number.isFinite(calculatedAverage) ? calculatedAverage : nominal, sources: [], error: null, uutOrigin: "assumed" };
  try {
    const tolerance = point.uutTolerance || session.uutTolerance;
    const unknown = (tolerance?.singleSided || tolerance?.tolerances?.singleSided)?.measurement === "unknown";
    const spec = point.uutBias?.mode === "override" ? point.uutBias : getUutBiasDefault(point, session);
    if (unknown) {
      result.uutBias = 0;
      result.uutOrigin = "unavailable";
    } else if (point.uutBias?.mode === "override" || configured(spec)) {
      result.uutBias = biasInUnit(spec, reference);
      result.riskAverage = nominal + result.uutBias;
      result.uutOrigin = point.uutBias?.mode === "override" ? "point" : "range";
    } else {
      // Preserve existing sessions' derived/MC mean behavior until explicitly overridden.
      result.uutBias = result.riskAverage - nominal;
      result.uutOrigin = result.uutBias ? "calculated" : "assumed";
    }
    if (point.measurementBias?.mode === "manual") {
      result.calBias = biasInUnit(point.measurementBias, reference);
      return result;
    }
    // Most existing sessions have no authored source biases. Avoid resolving
    // their full uncertainty budgets a second time for every sidebar row.
    if (!includeSources && !Object.keys(point.measurementBias?.sources || {}).length &&
      !(point.components || []).some(row => configured(biasOf(row))) &&
      !(point.tmdeTolerances || []).some(row => configured(biasOf(row))) &&
      !(session.tmdes || []).some(master => configured(biasOf(master)) || getInstrumentRangeRows(master, { flattenTolerances: true }).some(range => configured(biasOf(range))))) return result;
    result.sources = getPointBiasSources(point, session);
    const active = result.sources.filter(row => configured(row.spec) && !row.spec.corrected);
    if (!active.length) return result;
    let breakdown = [];
    if (point.measurementType === "derived" && active.some(row => row.variableType)) {
      const instances = refreshTmdeInstancesFromMasters(reconcileTmdeInstances(point.tmdeTolerances || [], session.tmdes || []), session.tmdes || []);
      const derived = calculateDerivedUncertainty(point.equationString, point.variableMappings, instances,
        { ...reference, variableNominals: point.variableNominals || {} }, resolvePointBudgetComponents(point, session), { allowFiniteDifference: true });
      if (derived.error || derived.missingInputs) throw new Error(derived.error || "Set equation input values to calculate source bias.");
      breakdown = derived.breakdown || [];
    }
    for (const row of active) {
      const mapped = point.measurementType === "derived" && Object.values(point.variableMappings || {}).includes(row.variableType);
      const input = mapped ? breakdown.find(input => input.type === row.variableType) : null;
      if (mapped && (!input || !Number.isFinite(input.ci))) throw new Error(`Cannot calculate bias sensitivity for ${row.variableType}.`);
      const referencePoint = input ? { value: input.nominal, unit: input.unit } : reference;
      row.contribution = biasInUnit(row.spec, referencePoint, input?.unit || reference.unit) * (input?.ci ?? 1) * row.quantity;
      result.calBias += row.contribution;
    }
    if (!Number.isFinite(result.calBias)) throw new Error("The measurement system bias could not be calculated.");
  } catch (error) {
    result.error = error.message;
    result.calBias = NaN;
  }
  return result;
}
