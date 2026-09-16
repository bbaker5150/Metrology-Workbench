import { API_BASE_URL } from "../constants/constants";
const KEY = `ac-shunt:observed-session:v1:${API_BASE_URL}`;

export function readObservation() {
  try {
    const id = sessionStorage.getItem(KEY);
    return id && /^\d+$/.test(id) ? id : null;
  } catch { return null; }
}

export function saveObservation(sessionId) {
  try {
    if (sessionId != null) sessionStorage.setItem(KEY, String(sessionId));
    else sessionStorage.removeItem(KEY);
  } catch { /* Observation still works when browser storage is unavailable. */ }
}

export function reportLifecycle(event, details = {}) {
  const body = JSON.stringify({ event, visibility: document.visibilityState, route: location.hash.split('?')[0] || location.pathname, ...details });
  const url = `${API_BASE_URL}/diagnostics/events/`;
  try {
    if (event === "pagehide" && navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }))) return;
    Promise.resolve(fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true })).catch(() => {});
  } catch { /* Diagnostics cannot interrupt a calibration or reconnect. */ }
}
