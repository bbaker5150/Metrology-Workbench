/**
 * Stable per-device/user key for scoping the LOCAL instrument library
 * (feature/inline-instrument-tables). There is no auth yet, so each browser/
 * Electron install generates a key once and persists it; it travels as the
 * `owner` field on local instruments so a user only sees their own history.
 *
 * Swap this for a real user id when authentication lands — every call site
 * goes through getDeviceKey(), so nothing else changes.
 */
const STORAGE_KEY = "uncertainty.deviceKey";

let cached = null;
let ownerOverride = null;

/**
 * Replace the browser/device identity with an authenticated host identity.
 * The SharePoint build uses this before the uncertainty app mounts so local
 * instruments follow the Microsoft 365 user across browsers and devices.
 * Returns a cleanup function for tests/unmounts.
 */
export const setDeviceKeyOverride = (value) => {
  const next = String(value || "").trim() || null;
  ownerOverride = next;
  return () => {
    if (ownerOverride === next) ownerOverride = null;
  };
};

const randomKey = () => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return `dev-${crypto.randomUUID()}`;
    }
  } catch (_) {
    /* fall through */
  }
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const getDeviceKey = () => {
  if (ownerOverride) return ownerOverride;
  if (cached) return cached;
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) {
      cached = existing;
      return cached;
    }
    cached = randomKey();
    localStorage.setItem(STORAGE_KEY, cached);
    return cached;
  } catch (_) {
    // Private mode / storage disabled: fall back to an in-memory key so the
    // session still works (it just won't persist across reloads).
    cached = cached || randomKey();
    return cached;
  }
};
