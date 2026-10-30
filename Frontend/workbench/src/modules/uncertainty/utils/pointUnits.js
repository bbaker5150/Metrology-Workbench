import { instrumentHasMeasurementArea } from "./measurementAreaGrouping";
import { instrumentFunctions } from "./functionGrouping";
import { getInstrumentRangeRows } from "./instrumentFunctionSelection";

// Only fill an absent unit. Explicit point units remain user-owned, including
// compatible units that differ from the instrument's display unit.
export const inheritMissingPointUnits = (session, previous) => {
  let changed = false;
  const previousPoints = new Map();
  for (const point of previous?.testPoints || []) {
    if (!previousPoints.has(point.id)) previousPoints.set(point.id, point);
  }
  const rangeRows = new Map();
  const rowsFor = uut => {
    if (!rangeRows.has(uut)) rangeRows.set(uut, getInstrumentRangeRows(uut));
    return rangeRows.get(uut);
  };
  const testPoints = (session.testPoints || []).map((point) => {
    const parameter = point.testPointInfo?.parameter;
    if (!parameter) return point;
    const ids = point.activeUutId
      ? [point.activeUutId]
      : point.associatedUutIds || [];
    const previousPoint = previousPoints.get(point.id);
    const previousIds = previousPoint?.activeUutId ? [previousPoint.activeUutId] : previousPoint?.associatedUutIds || [];
    const assignmentChanged = previous && (!previousPoint || ids.some(id => !previousIds.some(oldId => String(oldId) === String(id))));
    // Most edits keep assigned units. Resolve rows only for an assignment change
    // or a point that can still inherit a unit from its UUT.
    if (!assignmentChanged && parameter.unit) return point;
    // Sharing an area never assigns an instrument or its unit to a point.
    // This also prevents load/migration from filling an explicitly unassigned
    // point using an unrelated UUT in that area.
    const uuts = (session.uuts || []).filter(uut => ids.some(id => String(id) === String(uut.id)));
    if (!uuts.length) return point;
    const firstUutUnit = previous && !(previous.uuts || []).some(uut =>
      previousIds.some(id => String(id) === String(uut.id)) && rowsFor(uut).some(row => row.unit));
    // Assigning a UUT supplies a new default; subsequent user choices remain owned by the point.
    // Before assignment/first UUT unit, Units is a placeholder. Once assigned
    // units exist, deliberately selecting Units remains a persistent opt-out.
    if (!assignmentChanged && (parameter.unit || (parameter.unitless && !(firstUutUnit && !parameter.unitSelectionExplicit)) || (parameter.unitSelectionExplicit && !firstUutUnit))) return point;
    const units = new Set();
    for (const uut of uuts) {
      const rows = rowsFor(uut);
      const selected = rows.find(
        (row) =>
          point.uutTolerance?.rangeId != null &&
          String(row.rangeId ?? row.id) === String(point.uutTolerance.rangeId),
      );
      const candidates = selected ? [selected] : rows;
      candidates.forEach((row) => {
        if (row.unit) units.add(row.unit);
      });
      if (!candidates.length) {
        const definition = uut.instrument || uut;
        if (definition.unit) units.add(definition.unit);
        (definition.functions || []).forEach((fn) => {
          if (fn.unit) units.add(fn.unit);
        });
      }
    }
    if (assignmentChanged && units.size === 0) units.add("");
    if (units.size !== 1) return point;
    changed = true;
    return {
      ...point,
      testPointInfo: {
        ...point.testPointInfo,
        parameter: { ...parameter, unit: [...units][0], ...((firstUutUnit || assignmentChanged) ? { unitSelectionExplicit: false, unitless: ![...units][0] } : {}) },
      },
    };
  });
  return changed ? { ...session, testPoints } : session;
};

export const getMeasurementAreaUnits = (session = {}, areaName) => [...new Set(
  [...(session.uuts || []), ...(session.tmdes || [])]
    .filter(item => instrumentHasMeasurementArea(item, areaName))
    .flatMap(item => instrumentFunctions(item).flatMap(fn => fn.units || []))
    .filter(Boolean),
)];
