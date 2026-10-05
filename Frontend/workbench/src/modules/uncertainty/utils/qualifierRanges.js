import { v4 as uuid } from "uuid";
import { getInstrumentRangeRows } from "./instrumentFunctionSelection";

const idOf = range => String(range?.rangeId ?? range?.id ?? "");
export const qualifierGroupKey = range => range?.qualifier ? String(range.qualifierGroupId || JSON.stringify([range.functionId || range.functionName, range.min, range.max, range.unit])) : null;
export const hasQualifierRanges = items => (items || []).some(item => getInstrumentRangeRows(item).some(range => range.qualifier));

export function qualifierRowSpan(rows, range) {
  const index = rows.findIndex(row => idOf(row) === idOf(range));
  const key = qualifierGroupKey(range);
  if (!key || index < 0) return 1;
  if (index > 0 && qualifierGroupKey(rows[index - 1]) === key) return 0;
  let end = index + 1;
  while (end < rows.length && qualifierGroupKey(rows[end]) === key) end++;
  return end - index;
}

export function editQualifierRange(item, rangeId, action, patch = {}) {
  let newRangeId;
  const transform = ranges => {
    const index = (ranges || []).findIndex(range => idOf(range) === String(rangeId));
    if (index < 0) return ranges;
    const next = [...ranges], range = ranges[index];
    if (action === "patch") next[index] = { ...range, qualifier: { ...range.qualifier, ...patch } };
    if (action === "enable") next[index] = { ...range, qualifierGroupId: range.qualifierGroupId || uuid(), qualifier: { name: "Frequency", min: "", max: "", unit: "Hz", ...patch } };
    if (action === "add") {
      newRangeId = uuid();
      const group = range.qualifierGroupId || qualifierGroupKey(range) || uuid();
      next[index] = { ...range, qualifierGroupId: group };
      next.splice(index + 1, 0, { ...Object.fromEntries(Object.entries(range).filter(([key]) => ['min','max','value','isSingleValue','unit','unitless','functionId','functionName','functionUnit','resolution','resolutionUnit','resolutionDistribution','measuringResolution','measuringResolutionUnit','measuringResolutionDistribution'].includes(key))), id: newRangeId, ...(range.rangeId ? { rangeId: newRangeId } : {}), qualifierGroupId: group,
        qualifier: { name: range.qualifier?.name || "Frequency", min: "", max: "", unit: range.qualifier?.unit || "Hz" }, tolerances: {} });
    }
    if (action === "remove") {
      const peers = ranges.filter(candidate => qualifierGroupKey(candidate) === qualifierGroupKey(range));
      if (peers.length > 1) next.splice(index, 1);
      else { const { qualifier, qualifierGroupId, ...plain } = range; next[index] = plain; }
    }
    return next;
  };
  const inst = item.instrument || {};
  let updated;
  if (item.ranges?.some(range => idOf(range) === String(rangeId))) updated = { ...item, ranges: transform(item.ranges) };
  else if (inst.functions?.some(fn => fn.ranges?.some(range => idOf(range) === String(rangeId)))) updated = { ...item, instrument: { ...inst, functions: inst.functions.map(fn => ({ ...fn, ranges: transform(fn.ranges) })) } };
  else updated = { ...item, instrument: { ...inst, ranges: transform(inst.ranges) } };
  return { item: updated, newRangeId };
}
