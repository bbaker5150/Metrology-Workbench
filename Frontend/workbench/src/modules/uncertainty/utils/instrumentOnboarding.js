import { instrumentHasMeasurementArea, makeMeasurementAreaKey } from "./measurementAreaGrouping";

export function trackInstrumentOnboarding(session, previous) {
  if (!session) return session;
  const state = { ...session.instrumentOnboarding };
  for (const kind of ["uut", "tmde"]) {
    const saved = state[kind] || previous?.instrumentOnboarding?.[kind];
    const items = session[kind === "uut" ? "uuts" : "tmdes"] || [];
    const groups = (session.measurementAreaGroups || []).filter(g => !g.kind || g.kind === kind);
    const firstAreaKey = saved?.firstAreaKey || (groups[0] && makeMeasurementAreaKey(groups[0].name));
    if (!firstAreaKey && !items.length) continue;
    state[kind] = {
      firstAreaKey,
      completed: Boolean(previous?.instrumentOnboarding?.[kind]?.completed || saved?.completed || (!saved && items.length) ||
        items.some(item => instrumentHasMeasurementArea(item, firstAreaKey))),
    };
  }
  return JSON.stringify(state) === JSON.stringify(session.instrumentOnboarding || {})
    ? session : { ...session, instrumentOnboarding: state };
}

export function showFirstInstrumentHint(session, kind, areaKey) {
  const state = trackInstrumentOnboarding(session).instrumentOnboarding?.[kind];
  return Boolean(state && !state.completed && state.firstAreaKey === areaKey);
}
