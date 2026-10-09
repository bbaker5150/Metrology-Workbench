import { v4 as uuid } from "uuid";
import { getInstrumentRangeRows } from "./instrumentFunctionSelection";

const idOf = range => String(range?.rangeId ?? range?.id ?? "");
export const qualifierGroupKey = range => range?.qualifier ? String(range.qualifierGroupId || JSON.stringify([range.functionId || range.functionName, range.min, range.max, range.unit])) : null;
export const qualifierAt = (range, depth = 0) => {
  let node = range;
  for (let i = 0; i < depth && node; i++) node = node.qualifier;
  return node;
};
export const qualifierDepth = range => range?.qualifier ? 1 + qualifierDepth(range.qualifier) : 0;
export const instrumentQualifierDepth = items => Math.max(0, ...(items || []).flatMap(item => getInstrumentRangeRows(item).map(qualifierDepth)));
export const hasQualifierRanges = items => instrumentQualifierDepth(items) > 0;
const branchKey = (range, depth) => {
  const root = qualifierGroupKey(range);
  if (!root) return null;
  const path = [root];
  for (let i = 1; i <= depth; i++) {
    const node = qualifierAt(range, i);
    if (!node) return null;
    path.push(node.id || JSON.stringify([node.name, node.min, node.max, node.value, node.unit]));
  }
  return JSON.stringify(path);
};
export function qualifierRowSpan(rows, range, depth = 0) {
  const index = rows.findIndex(row => idOf(row) === idOf(range));
  const key = branchKey(range, depth);
  if (!key || index < 0) return 1;
  if (index > 0 && branchKey(rows[index - 1], depth) === key) return 0;
  let end = index + 1;
  while (end < rows.length && branchKey(rows[end], depth) === key) end++;
  return end - index;
}
const replaceAt = (range, depth, transform) => depth === 0 ? transform(range) : { ...range, qualifier: replaceAt(range.qualifier, depth - 1, transform) };
const blankQualifier = (source = {}) => ({ id: uuid(), name: source.name || "Qualifier", min: "", max: "", unit: source.unit || "" });

// Each leaf retains its own uncertainty. Ancestor IDs merge cells and keep
// edits to a shared ancestor consistent across all of its descendants.
export function editQualifierRange(item, rangeId, action, patch = {}, depth = 1) {
  let newRangeId;
  const transform = ranges => {
    const index = (ranges || []).findIndex(range => idOf(range) === String(rangeId));
    if (index < 0) return ranges;
    const range = ranges[index];
    const node = qualifierAt(range, depth);
    const key = branchKey(range, depth);
    const parentKey = branchKey(range, depth - 1);
    if (action === "patch") return ranges.map(row => branchKey(row, depth) === key ? replaceAt(row, depth, current => ({ ...current, ...patch })) : row);
    if (action === "enable") {
      newRangeId = idOf(range);
      return ranges.map((row, i) => (depth === 1 ? i === index : branchKey(row, depth - 1) === parentKey)
        ? replaceAt(row, depth - 1, parent => ({ ...parent, qualifierGroupId: parent.qualifierGroupId || uuid(), qualifier: { ...blankQualifier(depth === 1 ? { name: "Frequency", unit: "Hz" } : {}), ...patch } })) : row);
    }
    if (action === "add") {
      newRangeId = uuid();
      const copy = Object.fromEntries(Object.entries(range).filter(([field]) => ['min','max','value','isSingleValue','unit','unitless','functionId','functionName','functionUnit','resolution','resolutionUnit','resolutionDistribution','measuringResolution','measuringResolutionUnit','measuringResolutionDistribution','qualifier','qualifierGroupId'].includes(field)));
      const added = replaceAt({ ...copy, id: newRangeId, ...(range.rangeId ? { rangeId: newRangeId } : {}), tolerances: {} }, depth, () => blankQualifier(node));
      let end = index + 1;
      while (end < ranges.length && branchKey(ranges[end], depth) === key) end++;
      return [...ranges.slice(0, end), added, ...ranges.slice(end)];
    }
    if (action === "remove") {
      const siblings = ranges.filter(row => branchKey(row, depth - 1) === parentKey && branchKey(row, depth) !== key);
      if (siblings.length) return ranges.filter(row => branchKey(row, depth) !== key);
      let retained = false;
      return ranges.flatMap(row => {
        if (branchKey(row, depth - 1) !== parentKey) return [row];
        if (retained) return [];
        retained = true;
        return [replaceAt(row, depth - 1, parent => {
          const { qualifier, qualifierGroupId, ...plain } = parent;
          return plain;
        })];
      });
    }
    return ranges;
  };
  const inst = item.instrument || {};
  let updated;
  if (item.ranges?.some(range => idOf(range) === String(rangeId))) updated = { ...item, ranges: transform(item.ranges) };
  else if (inst.functions?.some(fn => fn.ranges?.some(range => idOf(range) === String(rangeId)))) updated = { ...item, instrument: { ...inst, functions: inst.functions.map(fn => ({ ...fn, ranges: transform(fn.ranges) })) } };
  else updated = { ...item, instrument: { ...inst, ranges: transform(inst.ranges) } };
  return { item: updated, newRangeId };
}
