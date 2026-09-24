import { instrumentHasMeasurementArea } from "./measurementAreaGrouping";
import { instrumentFunctions } from "./functionGrouping";
import { getInstrumentRangeRows } from "./instrumentFunctionSelection";

// Only fill an absent unit. Explicit point units remain user-owned, including
// compatible units that differ from the instrument's display unit.
export const inheritMissingPointUnits = (session, previous) => {
  let changed = false;
  const testPoints = (session.testPoints || []).map((point) => {
    const parameter = point.testPointInfo?.parameter;
    if (!parameter) return point;
    const ids = point.activeUutId
      ? [point.activeUutId]
      : point.associatedUutIds || [];
    // Sharing an area never assigns an instrument or its unit to a point.
    // This also prevents load/migration from filling an explicitly unassigned
    // point using an unrelated UUT in that area.
    const uuts = (session.uuts || []).filter(uut => ids.some(id => String(id) === String(uut.id)));
    if (!uuts.length) return point;
    const previousPoint = previous?.testPoints?.find(item => item.id === point.id);
    const previousIds = previousPoint?.activeUutId ? [previousPoint.activeUutId] : previousPoint?.associatedUutIds || [];
    const firstUutUnit = previous && !(previous.uuts || []).some(uut =>
      previousIds.some(id => String(id) === String(uut.id)) && getInstrumentRangeRows(uut).some(row => row.unit));
    // Before assignment/first UUT unit, Units is a placeholder. Once assigned
    // units exist, deliberately selecting Units remains a persistent opt-out.
    if (parameter.unit || (parameter.unitSelectionExplicit && !firstUutUnit)) return point;
    const units = new Set();
    for (const uut of uuts) {
      const rows = getInstrumentRangeRows(uut);
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
    if (units.size !== 1) return point;
    changed = true;
    return {
      ...point,
      testPointInfo: {
        ...point.testPointInfo,
        parameter: { ...parameter, unit: [...units][0], ...(firstUutUnit ? { unitSelectionExplicit: false } : {}) },
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
