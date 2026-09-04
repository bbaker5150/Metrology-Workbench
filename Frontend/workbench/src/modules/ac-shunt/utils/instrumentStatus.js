export function normalizeInstrumentAddress(address) {
  return String(address ?? "")
    .trim()
    .replace(/\/+$/, "")
    .toUpperCase();
}

export function isSameInstrumentAddress(left, right) {
  const normalizedLeft = normalizeInstrumentAddress(left);
  const normalizedRight = normalizeInstrumentAddress(right);
  return Boolean(normalizedLeft && normalizedLeft === normalizedRight);
}

/**
 * Discovery already opens the VISA resource and obtains an identity.  Status
 * register polling is optional metadata (and is unsupported by several reader
 * models), so a status-register error must not reclassify a discovered device
 * as disconnected or lock its persisted role assignment.
 */
export function isDiscoveredInstrumentAvailable(instrument) {
  const identity = String(instrument?.identity ?? "").trim();
  return Boolean(
    normalizeInstrumentAddress(instrument?.address)
      && identity
      && !identity.toUpperCase().startsWith("N/A")
  );
}
