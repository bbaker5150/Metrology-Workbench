// src/modules/uncertainty/utils/tmdeReconcile.js
import { resolveInstrumentSelection } from "./instrumentFunctionSelection";

// Point snapshots created by older derived-session imports do not carry the
// session TMDE id in `sourceId`. They retain the embedded instrument definition
// under `sourceInstrument` instead. Newer snapshots use `sourceId`/`definitionId`
// and may carry the definition under `instrument`. Treat all of these stable
// identifiers as aliases so edits to a live TMDE master reach every snapshot.
const identityCandidates = (record) =>
  [
    record?.sourceId,
    record?.definitionId,
    record?.sourceInstrumentId,
    record?.instrumentId,
    record?.sourceInstrument?.id,
    record?.instrument?.id,
    record?.id,
  ].filter((value) => value !== undefined && value !== null && value !== "");

const identityKeys = (record) =>
  new Set(identityCandidates(record).map((value) => String(value)));

export const tmdeInstanceMatchesMaster = (instance, master) => {
  const masterKeys = identityKeys(master);
  return [...identityKeys(instance)].some((key) => masterKeys.has(key));
};

//
// Referential-integrity guard for a test point's TMDE instances.
//
// Each test point stores `tmdeTolerances`: per-point snapshots of the session's
// master TMDEs (`session.tmdes`), linked back by `sourceId` / `id`. The derived
// engine SUMS every instance mapped to an equation variable (additive
// composition — several deadweights summing to a load), so two failure modes
// silently corrupt a calculation by multiplying a variable's value:
//
//   1. Orphans  — an instance whose master was deleted (or re-created with a new
//      id). It no longer renders in the TMDE table (the table is keyed off the
//      live masters) yet is still summed by the math, so a phantom standard
//      keeps contributing. This is the BRG-3100 "6×" symptom: one visible row,
//      no quantity field, but the value is multiplied.
//   2. Stacking — the SAME master appearing on one point more than once for the
//      same derived variable/direct point, so a single standard contributes its
//      value repeatedly.
//
// `reconcileTmdeInstances` returns only the instances that map to a LIVE master,
// keeping at most one instance per master+variable (multiplicity belongs in
// `quantity`, never in duplicate rows). DISTINCT masters mapped to one variable
// — and the same master mapped once to several derived variables — are preserved
// untouched.
//
// Pure: never mutates its inputs. A deliberate no-op for orphan pruning when the
// master list is empty/unknown, so it can't wipe a point's instances while a
// session is still loading.

/** The id of the master a per-point instance was derived from. */
export const masterIdOf = (instance) =>
  instance == null ? undefined : identityCandidates(instance)[0];

const variableKeyOf = (instance) =>
  String(instance?.variableType || "").trim();

const instanceReconcileKey = (instance) =>
  `${String(masterIdOf(instance) ?? instance?.id ?? "")}::${variableKeyOf(instance)}`;

export const reconcileTmdeInstances = (tmdeTolerances, masterTmdes) => {
  if (!Array.isArray(tmdeTolerances)) return [];

  const validIds = new Set(
    (masterTmdes || []).flatMap((master) => [...identityKeys(master)]),
  );
  // Only prune orphans when we actually know the master list. An empty set means
  // "masters not loaded yet" — pruning then would wrongly blank every instance.
  const knowMasters = validIds.size > 0;

  const seenMasters = new Set();
  const reconciled = [];
  let prunedOrphan = false;

  for (const inst of tmdeTolerances) {
    if (!inst) continue;
    const linkedToLiveMaster = [...identityKeys(inst)].some((key) =>
      validIds.has(key),
    );

    // Orphan: the master this instance came from is gone from the session.
    if (knowMasters && !linkedToLiveMaster) {
      prunedOrphan = true;
      continue;
    }

    // Stacking: this master+variable is already represented on the point.
    // Multiplicity is expressed via `quantity`, so a second instance with the
    // same key is a duplicate that would double-count the value. The same
    // master on a different derived variable is legitimate: it reuses that
    // TMDE's tolerance in a separate input budget.
    const key = instanceReconcileKey(inst);
    if (key && seenMasters.has(key)) continue;
    seenMasters.add(key);

    reconciled.push(inst);
  }

  // Safety net: if EVERY instance got pruned as an "orphan" while masters do
  // exist, that's almost certainly an id-scheme mismatch (instances linked to
  // their masters by a different id, e.g. a fixture without `sourceId`) rather
  // than genuinely-deleted masters. Wiping the whole budget — and silently
  // zeroing its uncertainty and risk — is far worse than keeping the instances,
  // so fall back to a de-duplicated copy of the originals (still collapsing any
  // stacked duplicates, so the "6×" double-counting stays fixed).
  if (reconciled.length === 0 && prunedOrphan && tmdeTolerances.length > 0) {
    const seen = new Set();
    return tmdeTolerances.filter((inst) => {
      if (!inst) return false;
      const key = instanceReconcileKey(inst);
      if (key && seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return reconciled;
};

const firstPresent = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const findMasterForInstance = (instance, masterTmdes = []) => {
  return (masterTmdes || []).find(
    (master) => tmdeInstanceMatchesMaster(instance, master),
  );
};

const nestedToleranceOf = (instance = {}) => {
  if (instance?.tolerance && typeof instance.tolerance === "object") {
    return instance.tolerance;
  }
  if (
    instance?.tolerances &&
    typeof instance.tolerances === "object" &&
    !Array.isArray(instance.tolerances)
  ) {
    return instance.tolerances;
  }
  return instance || {};
};

const preservePointOverrides = (freshSpecs = {}, instance = {}) => {
  const source = nestedToleranceOf(instance);
  const next = { ...freshSpecs };

  [
    "includeResolutionInBudget",
    "measuringResolutionDistribution",
    "resolutionDistribution",
  ].forEach((key) => {
    const value = firstPresent(instance[key], source?.[key]);
    if (value !== undefined) next[key] = value;
  });

  ["reading", "readings_iv", "range", "floor", "db"].forEach((key) => {
    const existing = source?.[key];
    if (!existing || typeof existing !== "object") return;
    const hasOverride = Object.keys(existing).some((field) =>
      field.startsWith("spec"),
    );
    if (hasOverride) {
      next[key] = {
        ...(next[key] || {}),
        ...existing,
      };
    }
  });

  return next;
};

/**
 * Point TMDE entries are snapshots of session TMDE masters. Reconcile keeps the
 * links valid; this overlays the live master instrument/range definition so
 * edits to an instrument's name, function, range, tolerance, or resolution are
 * reflected in the budget immediately without moving point-specific fields.
 */
export const refreshTmdeInstancesFromMasters = (
  tmdeTolerances,
  masterTmdes = [],
) => {
  if (!Array.isArray(tmdeTolerances)) return [];
  if (!Array.isArray(masterTmdes) || masterTmdes.length === 0) {
    return tmdeTolerances;
  }

  return tmdeTolerances.map((instance) => {
    const master = findMasterForInstance(instance, masterTmdes);
    if (!master) return instance;

    // Legacy derived snapshots embed the selected instrument as
    // `sourceInstrument`, including its function metadata, but do not copy the
    // function/range ids onto the instance. Use the embedded function as a
    // stable fallback so the refreshed master resolves the same function.
    const sourceInstrument = instance?.sourceInstrument || instance?.instrument || {};
    const sourceFunction = Array.isArray(sourceInstrument.functions)
      ? sourceInstrument.functions[0]
      : null;

    const selection = {
      userFunctionId: firstPresent(
        instance.userFunctionId,
        instance.functionId,
        sourceFunction?.id,
      ),
      userFunctionName: firstPresent(
        instance.userFunctionName,
        instance.functionName,
        sourceFunction?.name,
      ),
      userFunctionUnit: firstPresent(
        instance.userFunctionUnit,
        instance.functionUnit,
        instance.unit,
        sourceFunction?.unit,
        sourceFunction?.units?.[0],
      ),
      userRangeId: firstPresent(
        instance.userRangeId,
        instance.rangeId,
        nestedToleranceOf(instance)?.rangeId,
      ),
      userRangeIndex: firstPresent(instance.userRangeIndex, instance._index),
    };
    const resolved = resolveInstrumentSelection(master, selection);
    const freshSpecs = preservePointOverrides(resolved.specs || {}, instance);

    return {
      ...master,
      ...freshSpecs,
      id: instance.id,
      sourceId: master.id ?? instance.sourceId,
      tolerance: freshSpecs,
      variableType: instance.variableType,
      quantity: instance.quantity ?? 1,
      measurementPoint: instance.measurementPoint || master.measurementPoint,
      ...(instance.userFunctionId ? { userFunctionId: instance.userFunctionId } : {}),
      ...(instance.userFunctionName
        ? { userFunctionName: instance.userFunctionName }
        : {}),
      ...(instance.userFunctionUnit
        ? { userFunctionUnit: instance.userFunctionUnit }
        : {}),
      ...(instance.userRangeId ? { userRangeId: instance.userRangeId } : {}),
      ...(instance.userRangeIndex !== undefined
        ? { userRangeIndex: instance.userRangeIndex }
        : {}),
    };
  });
};

/**
 * True when reconciliation would change the array (orphans or stacked
 * duplicates are present). Used to decide whether to persist a cleaned copy.
 */
export const tmdeInstancesNeedReconcile = (tmdeTolerances, masterTmdes) =>
  Array.isArray(tmdeTolerances) &&
  reconcileTmdeInstances(tmdeTolerances, masterTmdes).length !==
    tmdeTolerances.length;
