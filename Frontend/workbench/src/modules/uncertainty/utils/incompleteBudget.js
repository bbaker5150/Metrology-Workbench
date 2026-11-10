export const hasNominalValue = (point) =>
  point?.value !== "" &&
  point?.value != null &&
  Number.isFinite(Number(point.value));
export const MISSING_NOMINAL =
  "Enter a measurement value to calculate this value-dependent uncertainty.";
const relative = (unit) => ["%", "ppm", "ppb", "dB"].includes(unit);
const populated = (term) =>
  term &&
  [term.high, term.low, term.value].some(
    (v) => v !== "" && v != null && Number(v) !== 0,
  );
export const toleranceNeedsNominal = (tolerance) => {
  const t = tolerance?.tolerance || tolerance?.tolerances || tolerance || {};
  return ["reading", "floor", "readings_iv", "offset", "linearity", "db"].some(
    (key) => populated(t[key]) && (key === "db" || relative(t[key].unit)),
  );
};
export const unresolvedComponent = (component, reason = MISSING_NOMINAL) => ({
  ...component,
  value: null,
  value_native: null,
  pendingReason: reason,
});
// A unit reference is used only to resolve absolute terms through the existing
// converter. It is never substituted for the user's missing measurement.
export const absoluteBudgetComponent = (component, unitSystem) => component.pendingReason ? component : ({
  ...component,
  isBaseUnitValue: true,
  value:
    component.value_native == null
      ? null
      : component.value_native *
        (component.unit_native ? unitSystem.units[component.unit_native]?.to_si ?? NaN : 1),
  pendingReason: null,
});
export const relativeBudgetUnit = relative;

export const budgetUnitMismatch = (unit, target, unitSystem) => {
  if (!unit || !target || relative(unit)) return null;
  const quantity = unitSystem.getQuantity(unit);
  const targetQuantity = unitSystem.getQuantity(target);
  return quantity && targetQuantity && quantity !== targetQuantity
    ? `Unit mismatch: ${unit} cannot be combined in a ${target} uncertainty budget.`
    : null;
};

/** A TMDE uncertainty specification can be evaluated in the measurement frame:
 * reading-relative terms use that nominal, and physical terms carry their own
 * units. The instrument range frame participates only in an active relative
 * full-scale term. In particular, range.value is a reference, not an error.
 * UUT acceptance limits retain the stricter range validation below.
 */
export const budgetToleranceUnitMismatch = (raw, target, unitSystem) => {
  const outer = (Array.isArray(raw) ? raw[0] : raw) || {};
  const tolerance = { ...outer, ...(outer.tolerance || outer.tolerances || {}) };
  const active = (term, isRange = false) => term && [term.high, term.low, term.limit, ...(!isRange ? [term.value] : [])].some(value =>
    value != null && String(value).trim() !== "" && Number(value) !== 0);
  // Match effectiveFloorTerm: even an explicit zero floor overrides its legacy
  // alias, while an empty floor editor must not hide an authored readings_iv.
  const hasFloor = tolerance.floor && [tolerance.floor.high, tolerance.floor.low, tolerance.floor.value]
    .some(value => !Number.isNaN(parseFloat(value)));
  const terms = [tolerance.reading,
    hasFloor ? tolerance.floor : tolerance.readings_iv || tolerance.floor,
    tolerance.singleSided].filter(term => active(term));
  if (active(tolerance.range, true)) terms.push(tolerance.range);
  const mismatch = terms
    .map(term => budgetUnitMismatch(term.unit || target, target, unitSystem)).find(Boolean);
  if (mismatch) return mismatch;
  if (active(tolerance.range, true) && relative(tolerance.range.unit)) {
    const rangeUnit = tolerance.unit || tolerance.functionUnit;
    const quantity = rangeUnit && unitSystem.getQuantity(rangeUnit);
    const targetQuantity = target && unitSystem.getQuantity(target);
    if (quantity && targetQuantity && quantity !== targetQuantity)
      return `Unit mismatch: ${rangeUnit} cannot be combined in a ${target} uncertainty budget.`;
  }
  return null;
};

/** Validate the physical frame BEFORE evaluating any UUT limit or uncertainty.
 * Relative terms (%/ppm/ppb/dB) are dimensionless specifications; their parent
 * range unit still has to match the measured quantity. Only authored terms
 * participate, so an unused blank editor with an old unit cannot block results.
 * Empty native frames remain supported for the workbook's unitless cases.
 */
export const toleranceUnitMismatch = (raw, target, unitSystem) => {
  const outer = (Array.isArray(raw) ? raw[0] : raw) || {};
  const tolerance = { ...outer, ...(outer.tolerance || outer.tolerances || {}) };
  // A percent used as the measured quantity is not a relative spec: an
  // instrument range in % or dB cannot silently become a voltage range.
  for (const unit of [outer.unit, outer.functionUnit, tolerance.unit, tolerance.functionUnit]) {
    const quantity = unit && unitSystem.getQuantity(unit);
    const targetQuantity = target && unitSystem.getQuantity(target);
    if (quantity && targetQuantity && quantity !== targetQuantity)
      return `Unit mismatch: ${unit} cannot be combined in a ${target} uncertainty budget.`;
  }
  const units = [];
  const authored = term => term && [term.high, term.low, term.limit].some(value => value != null && String(value).trim() !== "");
  for (const key of ["reading", "range", "floor", "readings_iv", "singleSided"])
    if (authored(tolerance[key])) units.push(tolerance[key].unit);
  return units.map(unit => budgetUnitMismatch(unit, target, unitSystem)).find(Boolean) || null;
};
