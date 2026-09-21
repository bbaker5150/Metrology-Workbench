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
    if (parameter.unitSelectionExplicit && parameter.unit && !getMeasurementAreaUnits(session, point.testPointInfo?.measurementArea || parameter.name).includes(parameter.unit)) {
      changed = true;
      return { ...point, uutTolerance: null, testPointInfo: { ...point.testPointInfo,
        parameter: { ...parameter, unavailableUnit: parameter.unit, unit: "" } } };
    }
    const area = point.testPointInfo?.measurementArea || parameter.name;
    const firstUutUnit = previous && !(previous.uuts || []).some(uut =>
      instrumentHasMeasurementArea(uut, area) && getInstrumentRangeRows(uut).some(row => row.unit));
    // "Units" before the area has any UUT units is an unassigned placeholder.
    // An explicit Units choice after units exist is an intentional opt-out.
    if (parameter.unit || (parameter.unitSelectionExplicit && !firstUutUnit)) return point;
    const ids = point.activeUutId
      ? [point.activeUutId]
      : point.associatedUutIds || [];
    // Area-created points may not have a UUT assignment yet. A single unit
    // across that area's UUTs is unambiguous; TMDE units and other areas must
    // never decide the measurement point's output unit.
    const hasLiveAssignment = ids.some(id => (session.uuts || []).some(uut => String(uut.id) === String(id)));
    const uuts = (session.uuts || []).filter((uut) => hasLiveAssignment
      ? ids.some((id) => String(id) === String(uut.id))
      : instrumentHasMeasurementArea(uut, point.testPointInfo?.measurementArea || parameter.name));
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
