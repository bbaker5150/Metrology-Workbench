// Walk the Function -> UUT -> Point tree in visual order, emitting only the
// points currently visible (their function and UUT nodes are expanded). The
// Unassigned bucket is a pseudo-function whose single pseudo-UUT carries the
// points; its points are emitted with a null context.
export const getVisibleSidebarPointOrder = (
  sidebarData,
  { expandedFunctions = new Set(), expandedUuts = new Set() } = {},
  sortPoints = (points) => points,
) => {
  const entries = [];

  (sidebarData || []).forEach((fnGroup) => {
    if (!expandedFunctions.has(fnGroup.id)) return;

    // Current measurement-point tables are function-scoped and preserve point
    // chronology; the owning UUT is selected in the row itself. Retain the
    // legacy nested traversal below for older fixtures/saved view models.
    if (Array.isArray(fnGroup.points)) {
      sortPoints(fnGroup.points).forEach((point) => {
        entries.push({
          pointId: point.id,
          contextUutId: point.associatedUutIds?.[0] || null,
        });
      });
      return;
    }

    (fnGroup.uutGroups || []).forEach((group) => {
      const isUnassigned = fnGroup.isUnassigned || group.isUnassigned;
      // The Unassigned bucket renders points directly under the function node,
      // so it follows the function's expansion rather than a per-UUT key.
      if (!isUnassigned && !expandedUuts.has(`${fnGroup.id}::${group.id}`)) {
        return;
      }

      sortPoints(group.points || []).forEach((point) => {
        entries.push({
          pointId: point.id,
          contextUutId: isUnassigned ? null : group.id,
        });
      });
    });
  });

  return entries;
};

export const findSidebarPointOccurrence = (
  entries,
  pointId,
  contextUutId,
) =>
  entries.findIndex(
    (entry) =>
      entry.pointId === pointId &&
      (entry.contextUutId || null) === (contextUutId || null),
  );

export const getSidebarPointRange = (entries, anchor, target) => {
  if (!anchor || !target) return [];

  const anchorIndex = findSidebarPointOccurrence(
    entries,
    anchor.pointId,
    anchor.contextUutId,
  );
  const targetIndex = findSidebarPointOccurrence(
    entries,
    target.pointId,
    target.contextUutId,
  );
  if (anchorIndex === -1 || targetIndex === -1) return [];

  const low = Math.min(anchorIndex, targetIndex);
  const high = Math.max(anchorIndex, targetIndex);
  return Array.from(
    new Set(entries.slice(low, high + 1).map((entry) => entry.pointId)),
  );
};
