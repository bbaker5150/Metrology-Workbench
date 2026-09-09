import {
  instrumentFunctions,
  makeFunctionKey,
  resolveSessionFunctions,
  FUNCTION_COLOR_PALETTE,
} from './functionGrouping';

// Organization belongs to the session row, never to its library definition.
// Names retain the old case-insensitive identity so saved colors, ordering and
// collapsed-section preferences survive the transition from function groups.
export const makeMeasurementAreaKey = makeFunctionKey;
const label = (name, units = []) => ({
  key: makeMeasurementAreaKey(name),
  name: String(name || '').trim() || 'Measurement',
  units: [...new Set(units.filter(Boolean))],
  unit: units.find(Boolean) || '',
});

export const instrumentMeasurementAreas = (item = {}) => {
  const units = instrumentFunctions(item).flatMap(fn => fn.units || []);
  // Missing assignments mean an older session. An explicit empty list means
  // unassigned, and must never be inferred again from the instrument function.
  if (!Array.isArray(item.measurementAreaNames)) return instrumentFunctions(item);
  return (item.measurementAreaNames.length ? item.measurementAreaNames : ['Measurement'])
    .map(name => label(name, units));
};

export const instrumentHasMeasurementArea = (item, key) =>
  instrumentMeasurementAreas(item).some(area => area.key === makeMeasurementAreaKey(key));

export const measurementAreaLabelOf = (point) => label(
  point?.testPointInfo?.measurementArea ?? point?.testPointInfo?.parameter?.name,
  [point?.testPointInfo?.parameter?.unit],
);
export const measurementAreaKeyOf = point => measurementAreaLabelOf(point).key;

export const migrateMeasurementAreas = (session) => {
  if (!session) return session;
  if (Array.isArray(session.measurementAreaGroups)) {
    let changed = false;
    const rows = items => (items || []).map(item => {
      if (Array.isArray(item.measurementAreaNames)) return item;
      changed = true;
      const area = (session.measurementAreas || []).find(a => a.id === item.measurementAreaId);
      return { ...item, measurementAreaNames: [area?.name || item.measurementArea || 'Measurement'] };
    });
    const uuts = rows(session.uuts), tmdes = rows(session.tmdes);
    const testPoints = (session.testPoints || []).map(point => {
      if (point.testPointInfo?.measurementArea !== undefined) return point;
      changed = true;
      const area = (session.measurementAreas || []).find(a => a.id === point.measurementAreaId);
      return { ...point, testPointInfo: { ...point.testPointInfo,
        measurementArea: area?.name || 'Measurement' } };
    });
    return changed ? { ...session, uuts, tmdes, testPoints } : session;
  }
  const groups = ['uut', 'tmde'].flatMap(kind =>
    resolveSessionFunctions(session, { kind }).map(area => ({
      ...(session.functionGroups || []).find(group =>
        makeFunctionKey(group.name) === area.key && (!group.kind || group.kind === kind)),
      ...area,
      kind,
    })),
  );
  return {
    ...session,
    measurementAreaGroups: groups,
    uuts: (session.uuts || []).map(item => ({ ...item,
      measurementAreaNames: instrumentMeasurementAreas(item).map(area => area.name) })),
    tmdes: (session.tmdes || []).map(item => ({ ...item,
      measurementAreaNames: instrumentMeasurementAreas(item).map(area => area.name) })),
    testPoints: (session.testPoints || []).map(point => ({ ...point,
      testPointInfo: { ...point.testPointInfo, measurementArea: measurementAreaLabelOf(point).name } })),
  };
};

export const resolveSessionMeasurementAreas = (data = {}, { kind = null } = {}) => {
  const session = migrateMeasurementAreas(data);
  const build = filter => {
    const map = new Map();
    const add = area => {
      const key = makeMeasurementAreaKey(area.name);
      const existing = map.get(key);
      map.set(key, existing ? { ...existing,
        units: [...new Set([...(existing.units || []), ...(area.units || [])])] }
        : { ...area, key });
    };
    (session.measurementAreaGroups || []).filter(a => !filter || !a.kind || a.kind === filter).forEach(add);
    [...(filter === 'tmde' ? [] : session.uuts || []), ...(filter === 'uut' ? [] : session.tmdes || [])]
      .forEach(item => instrumentMeasurementAreas(item).forEach(add));
    if (filter !== 'tmde') (session.testPoints || []).forEach(point => add(measurementAreaLabelOf(point)));
    return [...map.values()];
  };
  const colors = new Map(build(null).map((area, index) =>
    [area.key, area.color || FUNCTION_COLOR_PALETTE[index % FUNCTION_COLOR_PALETTE.length]]));
  return build(kind).map(area => ({ ...area, color: colors.get(area.key),
    unit: area.units?.[0] || area.unit || '' }));
};

export const addInstrumentMeasurementArea = (item, area) => {
  if (instrumentHasMeasurementArea(item, area.key || area.name)) return item;
  return { ...item, measurementAreaNames: [...instrumentMeasurementAreas(item).map(a => a.name), area.name] };
};

export const renameMeasurementArea = (data, area, name) => {
  const session = migrateMeasurementAreas(data);
  const rename = item => ({ ...item, measurementAreaNames:
    instrumentMeasurementAreas(item).map(a => a.key === area.key ? name : a.name) });
  return { ...session,
    ...(session.instrumentOnboarding ? { instrumentOnboarding: Object.fromEntries(
      Object.entries(session.instrumentOnboarding).map(([kind, state]) => [kind,
        state.firstAreaKey === area.key ? { ...state, firstAreaKey: makeMeasurementAreaKey(name) } : state])
    ) } : {}),
    measurementAreaGroups: session.measurementAreaGroups.map(a =>
      makeMeasurementAreaKey(a.name) === area.key ? { ...a, name, key: makeMeasurementAreaKey(name) } : a),
    uuts: (session.uuts || []).map(rename),
    tmdes: (session.tmdes || []).map(rename),
    testPoints: (session.testPoints || []).map(point => measurementAreaKeyOf(point) === area.key
      ? { ...point, testPointInfo: { ...point.testPointInfo, measurementArea: name } } : point),
  };
};

export const getMeasurementAreaDependencies = (session = {}, area = {}) => ({
  uuts: area.kind === 'tmde' ? [] : (session.uuts || []).filter(item => instrumentHasMeasurementArea(item, area.key)),
  tmdes: area.kind === 'uut' ? [] : (session.tmdes || []).filter(item => instrumentHasMeasurementArea(item, area.key)),
  measurementPoints: area.kind === 'tmde' ? [] : (session.testPoints || []).filter(point => measurementAreaKeyOf(point) === area.key),
});
export const getMeasurementAreaDeletionConfirmationMessage = (dependencies, area) => {
  const counts = [['uuts', 'UUT'], ['tmdes', 'TMDE'], ['measurementPoints', 'measurement point']]
    .filter(([key]) => dependencies[key]?.length)
    .map(([key, name]) => `${dependencies[key].length} ${name}${dependencies[key].length === 1 ? '' : 's'}`);
  return `Delete the ${area.name} measurement area${counts.length ? ` and its ${counts.join(', ')}` : ''}? Instruments assigned to other areas will remain there with all their functions and specifications.`;
};
export const deleteMeasurementArea = (data, area) => {
  const session = migrateMeasurementAreas(data);
  const remove = (items = []) => items.flatMap(item => {
    const names = instrumentMeasurementAreas(item).filter(a => a.key !== area.key).map(a => a.name);
    return names.length ? [{ ...item, measurementAreaNames: names }] : [];
  });
  return { ...session,
    measurementAreaGroups: session.measurementAreaGroups.filter(a =>
      makeMeasurementAreaKey(a.name) !== area.key || (a.kind && area.kind && a.kind !== area.kind)),
    uuts: area.kind === 'tmde' ? session.uuts : remove(session.uuts),
    tmdes: area.kind === 'uut' ? session.tmdes : remove(session.tmdes),
    testPoints: area.kind === 'tmde' ? session.testPoints : (session.testPoints || []).filter(p => measurementAreaKeyOf(p) !== area.key),
  };
};

// One color per area across the point list and both instrument tables.
export const setMeasurementAreaColor = (session, area, color) => {
  const key = makeMeasurementAreaKey(area.name);
  const existing = session.measurementAreaGroups || [];
  const found = existing.some(group => makeMeasurementAreaKey(group.name) === key);
  const groups = existing.map(group => makeMeasurementAreaKey(group.name) === key ? { ...group, color } : group);
  if (!found) groups.push({ name: area.name, unit: area.unit || "", units: area.units || [], color });
  return { ...session, measurementAreaGroups: groups };
};
