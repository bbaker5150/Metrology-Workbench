/**
 * toleranceShape.js — single-sided (threshold) detection for tolerance objects.
 *
 * A "threshold" tolerance term (workbook single-sided, Types 3/4) has one bounded
 * limit and leaves the other side unbounded. The tolerance editor encodes it with
 * an explicit `thresholdSide` marker; legacy "+n/-0" data (one side pinned to 0)
 * is read as the same thing (the zero side is the unbounded direction).
 *
 * Keep `termUnboundedSide` in sync with `toleranceTermMode` in UncertaintyPanel.
 */

// The unbounded direction of a single tolerance TERM: "low" (open below, i.e. a
// "≤ upper" threshold), "high" (open above, a "≥ lower" threshold), or "" when
// the term is two-sided (symmetric/asymmetric) or blank.
export const termUnboundedSide = (component = {}) => {
  if (component?.thresholdSide === "high") return "low"; // bounded on high => open below
  if (component?.thresholdSide === "low") return "high"; // bounded on low => open above

  const high = parseFloat(component?.high);
  const low = parseFloat(component?.low);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return ""; // blank => symmetric
  const hZero = Math.abs(high) < 1e-12;
  const lZero = Math.abs(low) < 1e-12;
  if (hZero && lZero) return "";
  if (lZero) return "low"; // +n/-0 => open below
  if (hZero) return "high"; // +0/-n => open above
  return "";
};

const TERM_KEYS = ["reading", "range", "floor", "db", "offset", "linearity", "readings_iv"];

/**
 * The unbounded side of a tolerance OBJECT, or "" if it is two-sided. If any of
 * its terms is a threshold, the whole acceptance band is single-sided on that
 * side (the first threshold term wins). Handles the nested `.tolerances` shape
 * and an array-wrapped tolerance.
 */
export const toleranceUnboundedSide = (toleranceObj = {}) => {
  let tol = toleranceObj;
  if (Array.isArray(tol)) tol = tol[0] || {};
  if (tol?.tolerances && typeof tol.tolerances === "object") tol = tol.tolerances;
  if (!tol || typeof tol !== "object") return "";

  // Workbook-style single-sided rows carry the actual physical acceptance
  // limit, rather than a relative tolerance component. "low" means the lower
  // limit is active (open above); "high" means the upper limit is active (open
  // below). Unknown-measurement cases use the same active-side mapping.
  if (Number.isFinite(parseFloat(tol.singleSided?.limit))) {
    return tol.singleSided.direction === "low" ? "high" : "low";
  }

  for (const k of TERM_KEYS) {
    const side = termUnboundedSide(tol[k]);
    if (side) return side;
  }
  return "";
};
