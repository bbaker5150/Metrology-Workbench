export const getSidebarRangeKey = (groupId, range = {}) => {
  if (!range.functionId && !range.functionName && range._id !== undefined) {
    return `${groupId}-${range._id}`;
  }

  const functionPart =
    range.functionId ||
    (range.functionName ? `fn:${range.functionName}` : "fn:default");
  const rangePart =
    range.rangeId ||
    range.id ||
    range._id ||
    range._index ||
    "range:default";
  return `${groupId}-${functionPart}-${rangePart}`;
};

export const getVisibleSidebarPointOrder = (
  sidebarData,
  {
    expandedAreas = new Set(),
    expandedUuts = new Set(),
    expandedRanges = new Set(),
    uutsShowingAllRanges = new Set(),
  } = {},
  sortPoints = (points) => points,
) => {
  const entries = [];

  (sidebarData || []).forEach((area) => {
    if (!expandedAreas.has(area.id)) return;

    (area.uutGroups || []).forEach((group) => {
      if (!expandedUuts.has(group.id)) return;

      const rangeGroups = group.functionGroups?.length
        ? group.functionGroups.flatMap((fn) => fn.rangeGroups || [])
        : group.rangeGroups || [];

      rangeGroups.forEach((range) => {
        if (
          range.points?.length === 0 &&
          !uutsShowingAllRanges.has(group.id)
        ) {
          return;
        }

        const rangeKey = getSidebarRangeKey(group.id, range);
        if (!expandedRanges.has(rangeKey)) return;

        sortPoints(range.points || []).forEach((point) => {
          entries.push({ pointId: point.id, contextUutId: group.id });
        });
      });

      (group.uncategorizedPoints || []).forEach((point) => {
        entries.push({ pointId: point.id, contextUutId: group.id });
      });
    });

    (area.unassignedPoints || []).forEach((point) => {
      entries.push({ pointId: point.id, contextUutId: null });
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
