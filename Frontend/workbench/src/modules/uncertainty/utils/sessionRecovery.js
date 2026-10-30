import { recoveryNamespace } from "./recoveryNamespace";
const key = () => `uncertainty:recovery:v1:${recoveryNamespace()}`;
const navigationKey = () => `uncertainty:navigation:v1:${recoveryNamespace()}`;
export function readRecovery() {
  let state = {};
  try { state = JSON.parse(localStorage.getItem(key()) || "{}") || {}; } catch { /* Recover navigation independently. */ }
  try {
    const navigation = JSON.parse(localStorage.getItem(navigationKey()) || "null");
    if (navigation && Object.hasOwn(navigation, "sessionId") && Object.hasOwn(navigation, "pointId")) state.navigation = navigation;
  } catch { /* Older journals still contain usable navigation. */ }
  return state;
}
function write(state) {
  try { localStorage.setItem(key(), JSON.stringify(state)); }
  catch (error) { console.warn("Unable to retain browser session recovery", error); }
}
export function journalSession(kind, id, payload) {
  const state = readRecovery();
  if (kind === "saves") {
    const images = [...(state.saves?.[id]?.images || []), ...(payload.images || [])];
    payload = { ...payload, images: [...new Map(images.map(image => [image.id, image])).values()] };
  }
  const entry = { ...payload, token: `${Date.now()}:${Math.random()}` };
  state[kind] = { ...state[kind], [id]: entry };
  if (kind === "deletes") { delete state.saves?.[id]; delete state.notes?.[id]; }
  if (kind === "saves") delete state.deletes?.[id];
  write(state);
  return entry.token;
}
export function acknowledgeSession(kind, id, token) {
  const state = readRecovery();
  if (state[kind]?.[id]?.token === token) { delete state[kind][id]; write(state); }
}
export function recoverSessions(remote, recovery = readRecovery()) {
  const sessions = new Map(remote.map(session => [String(session.id), session]));
  for (const [id, entry] of Object.entries(recovery.saves || {})) sessions.set(id, entry.session);
  for (const [id, entry] of Object.entries(recovery.notes || {})) {
    if (sessions.has(id)) sessions.set(id, { ...sessions.get(id), notes: entry.notes });
  }
  for (const id of Object.keys(recovery.deletes || {})) sessions.delete(id);
  return [...sessions.values()];
}
export function saveNavigation(sessionId, pointId) {
  // Point selection must not parse/serialize pending sessions with large instruments.
  try { localStorage.setItem(navigationKey(), JSON.stringify({ sessionId, pointId })); }
  catch (error) { console.warn("Unable to retain browser navigation", error); }
}
