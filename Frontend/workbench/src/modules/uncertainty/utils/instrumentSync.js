import { v4 as uuid } from "uuid";
import { canonicalShuntDefinition } from './acShuntInstrumentRole';

export const SYNC_NONE = "none";
export const SYNC_GREEN = "green";
export const SYNC_RED = "red";
export const SYNC_ORANGE = "orange";
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
  "qualifierColumnNames",
  "customColumns",
];

// Defining fields that are arrays (default to [] rather than "" when absent).
const ARRAY_SNAPSHOT_FIELDS = new Set(["functions", "typeBComponents", "tmdeSecondaryUncertainties", "ranges", "qualifierColumnNames", "customColumns"]);

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
  ["shared", "validated"].includes(instrument.scope) ||
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
  if (instrument.scope === "session") return SYNC_RED;
  if (instrument.scope === "pending") return SYNC_YELLOW;
  const local = instrument.scope === "local" ? SYNC_ORANGE : SYNC_RED;
  if (instrument.localOverride || !isValidatedLinked(instrument)) return local;
  if (!instrument.validatedSnapshot) return SYNC_GREEN;
  return diffFromSnapshot(instrument).length > 0 ? local : SYNC_GREEN;
};

/** An edit to a shared definition needs its own private submission ID. */
export const buildSyncPayload = (instrument = {}) => {
  const definition = canonicalShuntDefinition(instrument);
  const shared = ["shared", "validated"].includes(definition.scope);
  return {
    ...definition,
    id: shared ? uuid() : definition.id,
    scope: "pending",
    sourceId: definition.sourceId || (shared ? definition.id : ""),
    localOverride: true,
  };
};
