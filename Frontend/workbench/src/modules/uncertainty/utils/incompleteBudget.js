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
export const absoluteBudgetComponent = (component, unitSystem) => ({
  ...component,
  isBaseUnitValue: true,
  value:
    component.value_native == null
      ? null
      : component.value_native *
        (unitSystem.units[component.unit_native]?.to_si ?? NaN),
  pendingReason: null,
});
export const relativeBudgetUnit = relative;
