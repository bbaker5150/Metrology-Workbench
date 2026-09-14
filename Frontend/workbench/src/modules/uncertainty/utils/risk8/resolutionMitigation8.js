/**
 * Beta.7 modRiskBackend › ApplyResolutionToMitigation_DS / _SS.
 * Resolution changes the acceptance region, so it must change the recommended
 * reliability and risks too. Round inward in physical units, normalize those
 * limits about nominal, and solve again at the requested observed reliability.
 * The caller subsequently evaluates the aging curve at the ORIGINAL guardband.
 */
import {
  MODE_TWO_SIDED, MODE_SS_LOWER,
  buildRecommendationCandidateDSFromLimits, buildRecommendationCandidateSSFromLimit,
  currentGBRatio, currentGBRatioSS, pfaPassesAtDisplayedPrecision,
} from './riskEngine8';
import {
  isBlankCell, isNumericCell, writePhysicalGBFromMultiplier,
  roundLimitUpToResolution, roundLimitDownToResolution,
} from './toleranceTypes8';

export function applyResolutionToMitigation(input, tolType, RR, params) {
  const { mode, TUR_in, TUR_solve, reqPFA, reqREOP, mu, XCAL, LTL, UTL, activeUUT } = params;
  const fail = { ok: false };
  if (isBlankCell(input.resolution)) return writePhysicalGBFromMultiplier(tolType, input, RR.recGB);
  if (!isNumericCell(input.resolution)) return fail;
  const res = Number(input.resolution);
  if (res <= 0) return writePhysicalGBFromMultiplier(tolType, input, RR.recGB);
  if (!isNumericCell(input.nominal)) return fail;
  const nominal = Number(input.nominal);
  let candidate, gbLower, gbUpper, ratio;
  if (mode === MODE_TWO_SIDED) {
    if (!isNumericCell(input.lowerLimit) || !isNumericCell(input.upperLimit)) return fail;
    const lower = Number(input.lowerLimit), upper = Number(input.upperLimit);
    if (!(lower < nominal && nominal < upper)) return fail;
    const midpoint = (lower + upper) / 2, half = (upper - lower) / 2;
    gbLower = roundLimitUpToResolution(midpoint - RR.recGB * half, res);
    gbUpper = roundLimitDownToResolution(midpoint + RR.recGB * half, res);
    if (gbLower >= gbUpper) return fail;
    const normalizedLower = (gbLower - nominal) / half;
    const normalizedUpper = (gbUpper - nominal) / half;
    candidate = buildRecommendationCandidateDSFromLimits(TUR_in, TUR_solve, reqREOP,
      normalizedLower, normalizedUpper, mu, LTL, UTL, XCAL);
    ratio = currentGBRatio(normalizedLower, normalizedUpper, LTL, UTL);
  } else {
    const lowerSided = mode === MODE_SS_LOWER;
    const limit = lowerSided ? input.lowerLimit : input.upperLimit;
    if (!isNumericCell(limit)) return fail;
    const span = lowerSided ? nominal - Number(limit) : Number(limit) - nominal;
    if (span <= 0) return fail;
    let rounded;
    if (lowerSided) {
      rounded = gbLower = roundLimitUpToResolution(nominal - RR.recGB * span, res);
      if (rounded >= nominal) return fail;
    } else {
      rounded = gbUpper = roundLimitDownToResolution(nominal + RR.recGB * span, res);
      if (rounded <= nominal) return fail;
    }
    const normalized = (rounded - nominal) / span;
    candidate = buildRecommendationCandidateSSFromLimit(TUR_in, TUR_solve, reqREOP,
      normalized, activeUUT, mode, mu, XCAL);
    ratio = currentGBRatioSS(normalized, activeUUT);
  }
  if (!candidate.ok || !pfaPassesAtDisplayedPrecision(candidate.r.pPFA, reqPFA)) return fail;
  // Mirrors VBA's ByRef RR update. No partially revised result escapes failure.
  RR.recREOP = candidate.recREOP ?? candidate.recREOP_single;
  RR.recGB = ratio;
  RR.pObs = candidate.r.pObs;
  RR.pPFA = candidate.r.pPFA;
  RR.pPFR = candidate.r.pPFR;
  return { ok: true, gbLower, gbUpper };
}
