// Build each consecutive run once. All members share the same immutable id
// list; scanning and allocating it again for every row is quadratic on shunt
// sessions whose points all belong to the same UUT.
export function buildConsecutiveSidebarCellGroups(points, valueForPoint, groupEmpty = false) {
  const values = points.map(point => String(valueForPoint(point) ?? "").trim());
  const groups = new Array(points.length);
  for (let start = 0; start < points.length;) {
    let end = start + 1;
    while ((groupEmpty || values[start] !== "") && end < points.length && values[end] === values[start]) end++;
    const pointIds = points.slice(start, end).map(point => point.id);
    const pointIdSet = new Set(pointIds.map(String));
    const key = pointIds.join("|");
    for (let index = start; index < end; index++) groups[index] = {
      isStart: index === start, isEnd: index === end - 1, span: end - start, pointIds, pointIdSet, key,
    };
    start = end;
  }
  return groups;
}

export function buildSidebarCellGroups(points, diagnostics, pendingEdit, formatQualifier) {
  const editedValue = (point, field, value) => pendingEdit?.field === field && String(pendingEdit.pointId) === String(point.id)
    ? `\u0000sidebar-edit-member:${field}:${point.id}` : value;
  const columns = {
    warningIcons: buildConsecutiveSidebarCellGroups(points, point => diagnostics[point.id]?.length ? `point:${point.id}` : "", true),
    uut: buildConsecutiveSidebarCellGroups(points, point => point.associatedUutIds?.[0] ?? ""),
    section: buildConsecutiveSidebarCellGroups(points, point => editedValue(point, "section", point.section)),
    qualifier: buildConsecutiveSidebarCellGroups(points, point => editedValue(point, "qualifier", formatQualifier(point.testPointInfo?.qualifier))),
  };
  return points.map((_, index) => Object.fromEntries(Object.entries(columns).map(([name, groups]) => [name, groups[index]])));
}
