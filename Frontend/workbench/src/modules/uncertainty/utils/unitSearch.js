/**
 * Ranking for the searchable unit pickers.
 *
 * Units were previously grouped under function headings and filtered by a plain
 * substring test, so searching "in" buried `in.` under whichever function
 * happened to come first and scattered the obvious matches down the list.
 *
 * A search now produces one flat list, ordered by how well each unit answers
 * the query:
 *
 *   1. the unit itself starts with the query      in., in2, inHg, inWa, inH2O
 *   2. the unit contains the query                min, L/min, kg/min
 *   3. its function starts with the query         Inductance: H, mH, uH
 *   4. its function contains the query            Illuminance: lx, fc
 *
 * Within a tier the shortest unit comes first - the shorter the label, the more
 * of it the query accounts for - and equal lengths fall back to alphabetical so
 * the order is stable.
 */

// Units and function names are compared with punctuation and spacing removed,
// so "in." matches "in", and "L/min" is still found by "min".
export const normalizeUnitSearch = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, "");

/** Flatten react-select style groups into options carrying their function. */
export const flattenUnitGroups = (groups = []) =>
  (Array.isArray(groups) ? groups : []).flatMap((group) => {
    const options = group?.options ? group.options : [group];
    return options
      .filter(Boolean)
      .map((option) => ({ ...option, functionName: group?.label || "" }));
  });

const MATCH_NONE = 0;
const MATCH_CONTAINS = 1;
const MATCH_STARTS = 2;

const matchStrength = (haystack, needle) => {
  if (!haystack || !needle) return MATCH_NONE;
  if (haystack.startsWith(needle)) return MATCH_STARTS;
  return haystack.includes(needle) ? MATCH_CONTAINS : MATCH_NONE;
};

// Tier 1..4 as documented above; 0 means the option does not match at all.
const tierFor = (option, needle) => {
  const unitStrength = Math.max(
    matchStrength(normalizeUnitSearch(option.label), needle),
    matchStrength(normalizeUnitSearch(option.value), needle),
  );
  if (unitStrength === MATCH_STARTS) return 1;
  if (unitStrength === MATCH_CONTAINS) return 2;

  const functionStrength = matchStrength(
    normalizeUnitSearch(option.functionName),
    needle,
  );
  if (functionStrength === MATCH_STARTS) return 3;
  if (functionStrength === MATCH_CONTAINS) return 4;

  return 0;
};

const byLengthThenAlphabetical = (a, b) => {
  const aLabel = String(a.label ?? "");
  const bLabel = String(b.label ?? "");
  if (aLabel.length !== bLabel.length) return aLabel.length - bLabel.length;
  return aLabel.localeCompare(bLabel);
};

/**
 * Flat, ranked unit options for a query. With no query the incoming group order
 * is preserved (callers put the reference unit's own function first), so
 * browsing still opens on the units most likely to be wanted.
 */
export const rankUnitOptions = (groups = [], query = "") => {
  const options = flattenUnitGroups(groups);
  const needle = normalizeUnitSearch(query);
  if (!needle) return options;

  const tiers = new Map();
  options.forEach((option) => {
    const tier = tierFor(option, needle);
    if (!tier) return;
    if (!tiers.has(tier)) tiers.set(tier, []);
    tiers.get(tier).push(option);
  });

  return [...tiers.keys()]
    .sort((a, b) => a - b)
    .flatMap((tier) => tiers.get(tier).sort(byLengthThenAlphabetical));
};
