/**
 * Native-unit bias ownership and propagation (app layer, not workbook VBA).
 * ==========================================================================
 * Workbook authority: modRiskBackend.ComputeOneRow consumes normalized UUT_Bias
 * (K, mu) and Cal_Bias (L, XCAL); its observed mean is mu + XCAL. The app stores
 * signed residual errors in physical units and lets riskAdapter8 normalize them:
 *   riskAverage = nominal + bUUT; mu = bUUT / h; XCAL = bSystem / h.
 * h is the tolerance half-span, or nominal-to-limit distance for known SS.
 * Positive bSystem means the evaluated result reads high. Bias is a mean shift,
 * never an uncertainty component: it must not be added in quadrature or change
 * TUR, TAR, coverage factors, or the uncertainty retained after a correction.
 *
 * Persisted specs: { value, kind: "absolute" | "percent", unit, corrected? }.
 * UUT ownership: point.uutBias(mode=override) > selected UUT range > legacy mean.
 * System ownership: manual net replaces all sources; otherwise source overrides
 * replace inherited defaults, then signed source contributions are summed.
 * Blank means no authored bias; explicit zero is meaningful and stops inheritance.
 * The UI authors instrument-range defaults plus an optional Measurement Inputs
 * net-bias row using the manual contract below. Other point overrides are a
 * compatibility contract for saved sessions from the former bias menu; ownership
 * remains intact, with the corrected percentage basis below. LegacyPointBiasNotice offers an explicit
 * reset to instrument inheritance, rather than silently ignoring those values.
 * Percent entries use the final UUT tolerance frame for both UUT and cal bias,
 * including source entries inside derived equations. Absolute source entries
 * retain signed sensitivity propagation. Types 5/6 ignore both biases like VBA.
 */
import { calculateDerivedUncertainty, unitSystem } from "./uncertaintyMath";
import { getInstrumentRangeRows } from "./instrumentFunctionSelection";
import { resolvePointBudgetComponents } from "./resolvePointBudgetComponents";
import { reconcileTmdeInstances, refreshTmdeInstancesFromMasters } from "./tmdeReconcile";
import { getBiasToleranceFrame } from "./biasToleranceFrame";

const present = value => value !== undefined && value !== null && String(value).trim() !== "";
const configured = spec => present(spec?.value);
const same = (a, b) => present(a) && present(b) && String(a) === String(b);
const biasOf = source => source?.bias ?? source?.tolerances?.bias ?? source?.tolerance?.bias;

/**
 * Convert a residual error, not an absolute temperature coordinate. Subtracting
 * base(0) from base(1) cancels affine offsets (1.8 degF error = 1 degC error).
 * A percentage uses the workbook UUT tolerance frame, supplied explicitly by
 * the owning point. A stale unit saved beside a percentage is only a UI hint.
 * Corrected sources contribute zero systematic error; their original uncertainty
 * is untouched because this module does not mutate budget components.
 */
export function biasInUnit(spec, reference, outputUnit = reference?.unit, toleranceFrame) {
  if (!configured(spec) || spec.corrected) return 0;
  const value = Number(spec.value);
  if (!Number.isFinite(value)) throw new Error("Enter a finite signed bias.");
  if (spec.kind === "percent") {
    // Explicit zero remains usable while an instrument's limits are incomplete.
    if (value === 0) return 0;
    if (!(toleranceFrame?.halfSpan > 0)) throw new Error("Set valid UUT tolerance limits to calculate percentage bias.");
    return biasInUnit({ value: value / 100 * toleranceFrame.halfSpan, unit: toleranceFrame.unit },
      { value: toleranceFrame.center, unit: toleranceFrame.unit }, outputUnit);
  }
  const sourceUnit = spec.unit || reference?.unit;
  const unitless = !sourceUnit && !outputUnit && !reference?.unit;
  const fromQuantity = unitless ? "Unitless" : unitSystem.getQuantity(sourceUnit);
  const toQuantity = unitless ? "Unitless" : unitSystem.getQuantity(outputUnit);
  if (!fromQuantity || !toQuantity || fromQuantity !== toQuantity) throw new Error("Bias units must match the measured quantity.");
  const scale = unit => unitSystem.toBaseUnit(1, unit) - unitSystem.toBaseUnit(0, unit);
  return value * scale(sourceUnit) / scale(outputUnit);
}

function selectedRange(master, rangeId, functionId) {
  // A range ID can recur across instrument functions. Respect both identifiers
  // when available; legacy sessions lacking function IDs retain range matching.
  return getInstrumentRangeRows(master, { flattenTolerances: true }).find(range =>
    same(range.rangeId ?? range.id, rangeId) && (!functionId || !range.functionId || same(functionId, range.functionId)));
}

export function getUutBiasDefault(point = {}, session = {}) {
  // Read live masters on each calculation. Saved point tolerances are fallback
  // snapshots, not a cache that may hide a subsequent instrument-range edit.
  const tolerance = point.uutTolerance || session.uutTolerance || {};
  const master = (session.uuts || []).find(item => same(item.id, point.activeUutId || point.associatedUutIds?.[0]));
  const range = master && selectedRange(master, tolerance.rangeId ?? tolerance.id, tolerance.functionId);
  return biasOf(range) ?? biasOf(tolerance) ?? biasOf(master);
}

/**
 * Enumerate actual budget sources, not calculated breakdown rows. Resolution
 * derived from the same instrument must never inherit its bias a second time.
 * Linked accuracy components use stable provenance keys so copy/paste preserves
 * overrides; variableType distinguishes one instrument used at different inputs.
 * Legacy instances retain their instance identity and use the same reconciliation
 * as uncertainty evaluation. Component definitions and masters are resolved live.
 */
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
    // Re-read destination input values rather than storing a numeric bias during
    // copy/paste. Relative errors therefore track edits to the receiving point.
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

export function resolveMeasurementBias(point = {}, session = {}, calculatedAverage, { includeSources = true, limits, ignoreManual = false } = {}) {
  const reference = point.testPointInfo?.parameter || {};
  const nominal = Number(reference.value);
  const result = { uutBias: 0, calBias: 0, riskAverage: Number.isFinite(calculatedAverage) ? calculatedAverage : nominal, sources: [], error: null, uutOrigin: "assumed" };
  try {
    const tolerance = point.uutTolerance || session.uutTolerance;
    const unknown = (tolerance?.singleSided || tolerance?.tolerances?.singleSided)?.measurement === "unknown";
    // Workbook ComputeOneRow types 5/6 ignore BOTH K and L: there is no known
    // measurement/tolerance normalization frame. Retain authored values for a
    // later switch to known measurement, but do not translate this boundary.
    if (unknown) { result.uutOrigin = "unavailable"; return result; }
    let frame;
    const frameFor = spec => spec?.kind === "percent" ? (frame ||= getBiasToleranceFrame(point, session, limits)) : undefined;
    const spec = point.uutBias?.mode === "override" ? point.uutBias : getUutBiasDefault(point, session);
    if (point.uutBias?.mode === "override" || configured(spec)) {
      result.uutBias = biasInUnit(spec, reference, reference.unit, frameFor(spec));
      result.riskAverage = nominal + result.uutBias;
      result.uutOrigin = point.uutBias?.mode === "override" ? "point" : "range";
    } else {
      // Preserve existing sessions' derived/MC mean behavior until explicitly overridden.
      result.uutBias = result.riskAverage - nominal;
      result.uutOrigin = result.uutBias ? "calculated" : "assumed";
    }
    if (point.measurementBias?.mode === "manual" && !ignoreManual) {
      // This is the measured/estimated NET residual. Adding source offsets here
      // would count those effects twice; saved source settings remain restorable.
      result.calBias = biasInUnit(point.measurementBias, reference, reference.unit, frameFor(point.measurementBias));
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
      // Reuse the uncertainty evaluator's nominal units and SIGNED derivatives.
      // This is first-order propagation b_y = sum(q_i * df/dx_i * b_i), not RSS
      // and not f(x+b)-f(x). Large biases/nonlinear equations need user review.
      const derived = calculateDerivedUncertainty(point.equationString, point.variableMappings, instances,
        { ...reference, variableNominals: point.variableNominals || {} }, resolvePointBudgetComponents(point, session), { allowFiniteDifference: true });
      // Editing a variable's name/nominal temporarily leaves its sensitivity
      // unresolved. Preserve that pending state for the UI: risk still fails
      // closed, but ordinary inline editing must not launch a modal warning.
      if (derived.missingInputs) result.missingInputs = true;
      if (derived.error || derived.missingInputs) throw new Error(derived.error || "Set equation input values to calculate source bias.");
      breakdown = derived.breakdown || [];
    }
    for (const row of active) {
      const mapped = point.measurementType === "derived" && Object.values(point.variableMappings || {}).includes(row.variableType);
      const input = mapped ? breakdown.find(input => input.type === row.variableType) : null;
      if (mapped && (!input || !Number.isFinite(input.ci))) throw new Error(`Cannot calculate bias sensitivity for ${row.variableType}.`);
      const referencePoint = input ? { value: input.nominal, unit: input.unit } : reference;
      // Convert b_i to the derivative's input unit before multiplication; ci then
      // produces output units. An output-level/direct source has sensitivity 1.
      row.sensitivity = input?.ci ?? 1;
      row.inputUnit = input?.unit || reference.unit;
      if (row.spec.kind === "percent") {
        // Workbook Cal_Bias is ALREADY normalized in final-output tolerance
        // units. Multiplying by df/dx again would change its meaning (and sign).
        // The input-equivalent value below is display-only; never feed it back
        // into the output sum, especially at zero sensitivity.
        row.contribution = biasInUnit(row.spec, reference, reference.unit, frameFor(row.spec)) * row.quantity;
        row.inputBias = row.sensitivity === 0 ? null : row.contribution / row.sensitivity;
      } else {
        row.inputBias = biasInUnit(row.spec, referencePoint, row.inputUnit) * row.quantity;
        row.contribution = row.inputBias * row.sensitivity;
      }
      result.calBias += row.contribution;
    }
    if (!Number.isFinite(result.calBias)) throw new Error("The measurement system bias could not be calculated.");
  } catch (error) {
    // Fail closed: callers clear risk results on error. A missing sensitivity,
    // incompatible unit, or invalid entry must not masquerade as zero bias.
    result.error = error.message;
    result.calBias = NaN;
  }
  return result;
}
