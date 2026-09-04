/**
 * NIST TN 1297 uses U = k * u_c and the reporting form y +/- U.  NIST's
 * conventional approximately 95 % expanded uncertainty uses k = 2 when the
 * normal approximation is appropriate.  The stored Type A value remains a
 * standard uncertainty (k = 1) for propagation; this helper is presentation
 * only.
 */
export const TYPE_A_COVERAGE_FACTOR = 2;

export function expandedTypeAUncertainty(standardUncertainty) {
  if (standardUncertainty === null || standardUncertainty === undefined) {
    return null;
  }

  const numeric = Number(standardUncertainty);
  return Number.isFinite(numeric)
    ? numeric * TYPE_A_COVERAGE_FACTOR
    : null;
}
