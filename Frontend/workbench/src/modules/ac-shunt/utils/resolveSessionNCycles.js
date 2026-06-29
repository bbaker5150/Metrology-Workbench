// src/utils/resolveSessionNCycles.js
//
// Single source of truth for "how many AC-DC cycles does this session use?"
//
// n_cycles is stored per-direction (each Forward/Reverse TestPoint owns its
// own CalibrationSettings), but the operator thinks of it as one value for the
// whole session: whichever cycle count is set first (Forward or Reverse) is
// the value every direction should honor. Switching to a direction that has no
// settings yet must NOT fall back to a hardcoded default and silently change
// the session's cycle count — that turns already-complete points yellow.
//
// This helper scans every point's Forward/Reverse settings and returns the
// first persisted, valid cycle count it finds. Callers use it both to display
// the established value and as the completion target in the sidebar.

const MIN_CYCLES = 2;

const readN = (directionRow) => {
  const raw = directionRow?.settings?.n_cycles;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= MIN_CYCLES ? n : null;
};

/**
 * Resolve the session-wide cycle count from the ordered test points.
 *
 * @param {Array} orderedTestPoints - points shaped `{ forward, reverse }`,
 *   each direction optionally carrying `settings.n_cycles`.
 * @param {number|null} fallback - returned when no point has a value set.
 * @returns {number|null} the established cycle count, or `fallback`.
 */
export function resolveSessionNCycles(orderedTestPoints, fallback = null) {
  for (const point of orderedTestPoints || []) {
    const fwd = readN(point?.forward);
    if (fwd != null) return fwd;
    const rev = readN(point?.reverse);
    if (rev != null) return rev;
  }
  return fallback;
}

export default resolveSessionNCycles;
