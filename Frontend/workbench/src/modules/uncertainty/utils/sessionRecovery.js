import { recoveryNamespace } from "./recoveryNamespace";
const key = () => `uncertainty:recovery:v1:${recoveryNamespace()}`;
export function readRecovery() {
  try { return JSON.parse(localStorage.getItem(key()) || "{}") || {}; }
  catch { return {}; }
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
  write({ ...readRecovery(), navigation: { sessionId, pointId } });
}
