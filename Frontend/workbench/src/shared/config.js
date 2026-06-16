// ---------------------------------------------------------------------
// Shared workbench config — backend host / base URL derivation.
// ---------------------------------------------------------------------
// Cross-cutting across every module: they all talk to the same Django
// backend, whose host follows the page origin (so a remote observer who
// opened the app at 10.x.x.x:3000 hits the backend at 10.x.x.x:8000).
// Electron's file:// origin and localhost both fall back to "localhost".
//
// Phase 2 introduces per-module API namespaces (/api/ac-shunt, ...). For
// now every module shares the single /api root via API_BASE_URL.
// ---------------------------------------------------------------------
const getBaseIp = () => {
  const hostname = window.location.hostname;

  // Ignore empty hostnames (Electron file://) and explicit localhosts.
  if (
    hostname &&
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== ""
  ) {
    return hostname;
  }

  // Default to local execution for the Host PC.
  return "localhost";
};

export const baseIp = getBaseIp();
export const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT ?? "8000";
export const USE_SAME_ORIGIN_API = import.meta.env.VITE_API_SAME_ORIGIN === "1";

export const API_BASE_URL = USE_SAME_ORIGIN_API
  ? "/api"
  : `http://${baseIp}:${BACKEND_PORT}/api`;
export const WS_BASE_URL = USE_SAME_ORIGIN_API
  ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${
      window.location.host
    }/ws`
  : `ws://${baseIp}:${BACKEND_PORT}/ws`;
