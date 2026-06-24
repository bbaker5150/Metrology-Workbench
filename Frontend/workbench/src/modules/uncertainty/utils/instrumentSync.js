/**
 * Pure helpers for the local/shared instrument-library sync model
 * (feature/inline-instrument-tables). No React, no I/O — unit-testable in
 * isolation. The hook `useInstrumentSync` layers persistence on top.
 *
 * Sync states (drive the row's green/red icon). There are only TWO states:
 * you are either on the shared (in-sync) version of an instrument, or on a
 * local (out-of-sync) version of it.
 *   - "green" : linked to the shared library and identical to the snapshot.
 *   - "red"   : everything else — a brand-new local-only instrument, a copy
 *               that diverged from its shared origin, or one explicitly marked
 *               local (e.g. dragged to a new measurement area).
 *
 * The "snapshot" is the validated instrument definition captured at load/sync
 * time (`validatedSnapshot`). We diff the live row's defining fields against it.
 *
 * `SYNC_NONE` is retained only for backwards-compatible imports; the resolver
 * never returns it anymore.
 */

export const SYNC_NONE = "none";
export const SYNC_GREEN = "green";
export const SYNC_RED = "red";

// The fields that DEFINE an instrument for divergence purposes. Session-context
// fields (measurementArea/color, assetId, quantity, owner) are deliberately
// excluded — they describe usage in a session, not the instrument itself.
export const SNAPSHOT_FIELDS = ["manufacturer", "model", "description", "functions"];

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
    snap[field] = instrument[field] ?? (field === "functions" ? [] : "");
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
    const live = instrument[field] ?? (field === "functions" ? [] : "");
    const snap = snapshot[field] ?? (field === "functions" ? [] : "");
    if (stableStringify(live) !== stableStringify(snap)) {
      diffs.push({ field, from: snap, to: live });
    }
  });
  return diffs;
};

/**
 * Resolve the sync indicator state for an instrument. Only ever green or red:
 *   - An explicit `localOverride` (e.g. set when an instrument is dragged into a
 *     new measurement area) forces red.
 *   - An instrument with no validated origin is a local-only / brand-new one, so
 *     it is out of sync (red) until the user syncs it to the shared library.
 *   - A linked instrument is green only while it still matches its snapshot.
 */
export const computeSyncState = (instrument = {}) => {
  if (instrument.localOverride) return SYNC_RED;
  if (!isValidatedLinked(instrument)) return SYNC_RED;
  // Linked but with no captured snapshot yet -> treat as in-sync (green): it
  // was just loaded/created as validated and hasn't been edited.
  if (!instrument.validatedSnapshot) return SYNC_GREEN;
  return diffFromSnapshot(instrument).length > 0 ? SYNC_RED : SYNC_GREEN;
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
