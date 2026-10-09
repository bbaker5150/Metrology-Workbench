/** Library status: red is unsynced, yellow is local, green matches shared. */

export const SYNC_NONE = "none";
export const SYNC_GREEN = "green";
export const SYNC_RED = "red";
export const SYNC_YELLOW = "yellow";

// The fields that DEFINE an instrument for divergence purposes. Session-context
// fields (measurementArea/color, assetId, quantity, owner) are deliberately
// excluded — they describe usage in a session, not the instrument itself.
// `typeBComponents` (instrument-associated Type B uncertainties) are part of the
// definition, so editing them diverges from the shared snapshot like any spec.
export const SNAPSHOT_FIELDS = [
  "manufacturer",
  "model",
  "description",
  "functions",
  "typeBComponents",
  "tmdeSecondaryUncertainties",
  "ranges",
];

// Defining fields that are arrays (default to [] rather than "" when absent).
const ARRAY_SNAPSHOT_FIELDS = new Set(["functions", "typeBComponents", "tmdeSecondaryUncertainties", "ranges"]);

const stableStringify = (value) => {
  // Order-independent JSON so key ordering can't produce false divergence.
  const seen = new WeakSet();
  const norm = (v) => {
    if (v === null || typeof v !== "object") return v === undefined ? null : v;
    if (seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) return v.map(norm);
    return Object.keys(v)
      .sort()
      .reduce((acc, k) => {
        acc[k] = norm(v[k]);
        return acc;
      }, {});
  };
  return JSON.stringify(norm(value));
};

/** Capture the validated-definition snapshot from an instrument's current state. */
export const buildValidatedSnapshot = (instrument = {}) =>
  SNAPSHOT_FIELDS.reduce((snap, field) => {
    snap[field] = instrument[field] ?? (ARRAY_SNAPSHOT_FIELDS.has(field) ? [] : "");
    return snap;
  }, {});

/** True when the instrument is linked to a validated origin (so it can diverge). */
export const isValidatedLinked = (instrument = {}) =>
  instrument.scope === "validated" ||
  Boolean(instrument.sourceId) ||
  (instrument.validatedSnapshot != null &&
    typeof instrument.validatedSnapshot === "object" &&
    Object.keys(instrument.validatedSnapshot).length > 0);

/**
 * Field-by-field diff of the live instrument against its validated snapshot.
 * Returns [{ field, from, to }] for every defining field that changed.
 */
export const diffFromSnapshot = (instrument = {}) => {
  const snapshot = instrument.validatedSnapshot || buildValidatedSnapshot(instrument);
  const diffs = [];
  SNAPSHOT_FIELDS.forEach((field) => {
    const fallback = ARRAY_SNAPSHOT_FIELDS.has(field) ? [] : "";
    const live = instrument[field] ?? fallback;
    const snap = snapshot[field] ?? fallback;
    if (stableStringify(live) !== stableStringify(snap)) {
      diffs.push({ field, from: snap, to: live });
    }
  });
  return diffs;
};

export const computeSyncState = (instrument = {}) => {
  const local = instrument.scope === "local" ? SYNC_YELLOW : SYNC_RED;
  if (instrument.localOverride || !isValidatedLinked(instrument)) return local;
  if (!instrument.validatedSnapshot) return SYNC_GREEN;
  return diffFromSnapshot(instrument).length > 0 ? local : SYNC_GREEN;
};

/**
 * Build the payload that re-syncs a (diverged) instrument up to the validated
 * library: promote to validated scope, attach the password, and re-snapshot the
 * current definition so the row goes green again. Pure — the caller POSTs it.
 */
export const buildSyncPayload = (instrument = {}, password = "") => ({
  ...instrument,
  id: instrument.sourceId || instrument.id,
  scope: "validated",
  sourceId: instrument.sourceId || instrument.id,
  validatedSnapshot: buildValidatedSnapshot(instrument),
  // Syncing reconciles the local copy with the shared library, so any local
  // override (e.g. a drag-induced area change) is no longer "out of sync".
  localOverride: false,
  password,
});
