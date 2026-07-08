// Cached uncertainty-calculation outputs. These are derived from the point's
// inputs (equation, nominals, tolerances) AND its target UUT range, so they go
// stale the moment a point is copied or moved to a different UUT/range. Only the
// point currently open in the Detailed View recomputes, so a pasted point would
// otherwise keep displaying the SOURCE point's numbers until it is opened. We
// clear them on paste so the copy reads "not calculated" and recomputes cleanly
// when opened, rather than silently showing a stale/wrong result.
const CALCULATION_CACHE_FIELDS = [
  "is_detailed_uncertainty_calculated",
  "calculatedNominalValue",
  "calculatedBudgetComponents",
  "calculatedBudgetGroups",
  "combined_uncertainty",
  "combined_uncertainty_absolute_base",
  "combined_uncertainty_inputs_native",
  "combined_uncertainty_inputs_base",
  "effective_dof",
  "k_value",
  "expanded_uncertainty",
  "expanded_uncertainty_absolute_base",
  "secondOrder",
];

const POINT_RESOLUTION_FIELDS = [
  "includeResolutionInBudget",
  "measuringResolution",
  "measuringResolutionUnit",
  "measuringResolutionDistribution",
  "resolution",
  "resolutionUnit",
  "resolutionDistribution",
];

const hasValue = (value) => value !== undefined && value !== null && value !== "";

const resolvePastedTolerance = (sourceTolerance, targetTolerance) => {
  if (!sourceTolerance) return targetTolerance;

  const resolved = targetTolerance
    ? { ...targetTolerance }
    : { ...sourceTolerance };

  POINT_RESOLUTION_FIELDS.forEach((field) => {
    const sourceValue = sourceTolerance[field];
    if (!hasValue(sourceValue)) return;
    if (field === "includeResolutionInBudget" || !hasValue(resolved[field])) {
      resolved[field] = sourceValue;
    }
  });

  return resolved;
};

export const preparePointForPaste = (
  point,
  { mode, targetUutId, targetAreaId, targetTolerance },
) => {
  const preparedPoint = {
    ...point,
    measurementAreaId: targetAreaId,
    associatedUutIds: [targetUutId],
    uutTolerance: resolvePastedTolerance(point.uutTolerance, targetTolerance),
  };

  // A pasted point may land on a different UUT/range than the source, so any
  // cached calculation is no longer valid — drop it and let it recompute.
  CALCULATION_CACHE_FIELDS.forEach((field) => {
    delete preparedPoint[field];
  });
  preparedPoint.is_detailed_uncertainty_calculated = false;

  if (mode === "copy") {
    delete preparedPoint.id;
  }

  return preparedPoint;
};

export const getRemainingCutPoints = (clipboardPoints, movedPoints) => {
  const movedIds = new Set((movedPoints || []).map((point) => point.id));
  return (clipboardPoints || []).filter((point) => !movedIds.has(point.id));
};
