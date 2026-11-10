const present = value => value != null && String(value).trim() !== "";

export const rangeMaximum = range => {
  if (present(range?.max)) return range.max;
  if (!range?.isSingleValue) return "";
  return present(range.value) ? range.value : range.min ?? "";
};

// Older instrument editors stored the then-current maximum as if it had
// been typed. New explicit overrides are marked, even when equal to the max.
export const isAutomaticFullScale = (term, maximum) => !present(term?.value) ||
  (!term.fullScaleManual && present(maximum) && Number(term.value) === Number(maximum));

const migrateFullScale = (spec, maximum) => {
  if (!spec || typeof spec !== "object") return spec;
  let next = spec;
  if (present(spec.range?.value) && !spec.range.fullScaleManual) {
    const term = isAutomaticFullScale(spec.range, maximum)
      ? { ...spec.range, value: "" } : { ...spec.range, fullScaleManual: true };
    next = { ...next, range: term };
  }
  for (const key of ["tolerance", "tolerances", "_doubleSidedTerms"]) {
    const migrated = migrateFullScale(spec[key], maximum);
    if (migrated !== spec[key]) next = { ...next, [key]: migrated };
  }
  if (Array.isArray(spec.tmdeSecondaryUncertainties)) {
    const sources = spec.tmdeSecondaryUncertainties.map(source => migrateFullScale(source, maximum));
    if (sources.some((source, i) => source !== spec.tmdeSecondaryUncertainties[i])) {
      next = { ...next, tmdeSecondaryUncertainties: sources };
    }
  }
  return next;
};

export const patchInstrumentRange = (range, patch) => {
  const next = { ...range, ...patch };
  const previousMax = rangeMaximum(range);
  return rangeMaximum(next) === previousMax ? next : migrateFullScale(next, previousMax);
};
