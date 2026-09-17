import { instrumentHasMeasurementArea } from './measurementAreaGrouping';

/** Move existing rows, not clipboard copies. Reordering must retain instrument
 * identities, range definitions, budget links and other area memberships.
 * Only slots belonging to the displayed area change; unrelated areas keep
 * their order. A multi-selection moves as a stable block in session order.
 */
export function reorderInstrumentRows(session, kind, areaKey, ids, targetId, position = 'after') {
  const listKey = kind === 'uut' ? 'uuts' : 'tmdes';
  const list = session[listKey] || [];
  const selected = new Set(ids.map(String));
  const scoped = list.filter(item => instrumentHasMeasurementArea(item, areaKey));
  const moving = scoped.filter(item => selected.has(String(item.id)));
  if (!moving.length || (targetId != null && selected.has(String(targetId)))) return session;
  const remaining = scoped.filter(item => !selected.has(String(item.id)));
  const targetIndex = remaining.findIndex(item => String(item.id) === String(targetId));
  if (targetId != null && targetIndex < 0) return session;
  const at = targetId == null ? remaining.length : targetIndex + (position === 'after' ? 1 : 0);
  remaining.splice(at, 0, ...moving);
  let index = 0;
  const next = list.map(item => instrumentHasMeasurementArea(item, areaKey) ? remaining[index++] : item);
  return next.every((item, i) => item === list[i]) ? session : { ...session, [listKey]: next };
}

/** Expanded ranges are one instrument drop target. Using the whole group's
 * bounds gives the same before/after decision over a row-spanned description
 * cell as over any of its range cells, without changing row geometry on hover.
 */
export function instrumentDropPosition(event) {
  const row = event.currentTarget;
  const rows = [...(row.closest('table')?.querySelectorAll('tr[data-instrument-id]') || [])]
    .filter(candidate => candidate.dataset.instrumentId === row.dataset.instrumentId &&
      candidate.dataset.measurementArea === row.dataset.measurementArea);
  const bounds = (rows.length ? rows : [row]).map(candidate => candidate.getBoundingClientRect());
  const top = Math.min(...bounds.map(rect => rect.top));
  const bottom = Math.max(...bounds.map(rect => rect.bottom));
  return event.clientY < (top + bottom) / 2 ? 'before' : 'after';
}
