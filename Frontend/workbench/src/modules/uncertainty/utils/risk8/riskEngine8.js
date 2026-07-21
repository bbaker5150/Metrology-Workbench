/**
 * riskEngine8.js — literal port of the 8.0 workbook risk engine
 * =============================================================================
 * SOURCE OF TRUTH: `Unc_Tool_v8.00Beta` › VBA module `modRiskBackend` (the
 * "STANDARD MODULE: Module1" math half). The workbook VBA is authoritative;
 * this file must reproduce it function-for-function. Where a function is ported
 * its governing VBA is quoted verbatim in the comment directly above it so a
 * reviewer can read the workbook and this file side-by-side.
 *
 * PORTING RULES (do not "improve" the math):
 *   - Keep the same function names, order, constants, iteration counts and
 *     tolerances as the VBA. Numerical fidelity is part of "mirror exactly."
 *   - `NormalCDF` is the Abramowitz-Stegun 5-term approximation the workbook
 *     uses (max abs error ~7.5e-8). Do NOT replace it with erf — the workbook's
 *     tail probabilities are defined by this approximation.
 *   - VBA intrinsics map as: Sqr->Math.sqrt, Exp->Math.exp, Log->Math.log
 *     (natural log), Abs->Math.abs, `^`->**, Application.Max/Min->Math.max/min.
 *   - VBA `Err.Raise` -> `throw`. VBA `On Error GoTo fail` in the evaluators is
 *     modelled with try/catch that returns an OK:false RiskResult.
 *
 * This module is intentionally pure: doubles in, doubles/plain-objects out. It
 * knows nothing about React, units, Monte Carlo, or the app's data shapes —
 * exactly like the VBA standard module. App wiring lives in riskBridge8.js.
 *
 * Phase 1 scope: distribution primitives, sigma solvers, PCA integration, and
 * the two core evaluators (EvaluateCase_DS / EvaluateCase_SS). Mitigation,
 * interval decay, tolerance typing and the row driver land in later phases.
 */

/* =============================================================================
 * Module-level constants
 * VBA:
 *   Private Const PI# = 3.14159265358979
 *   Private Const T_CUTOFF# = 12#
 *   Private Const SOLVE_TOL# = 0.000000000001
 *   Private Const EPS# = 0.0000000001
 *   Private Const REC_TOL# = 0.0000005
 *   Private Const MODE_INVALID As Long = -1
 *   Private Const MODE_TWO_SIDED As Long = 0
 *   Private Const MODE_SS_LOWER As Long = 1
 *   Private Const MODE_SS_UPPER As Long = 2
 * Note: VBA's PI is the literal 3.14159265358979 (14 sig figs), not
 * Math.PI. NormalPDF divides by Sqr(2*PI); the difference vs Math.PI is ~1e-15
 * and below SOLVE_TOL, but we keep the literal to match the workbook exactly.
 * ========================================================================== */
export const PI = 3.14159265358979;
export const T_CUTOFF = 12;
export const SOLVE_TOL = 0.000000000001;
export const EPS = 0.0000000001;
export const REC_TOL = 0.0000005;

export const MODE_INVALID = -1;
export const MODE_TWO_SIDED = 0;
export const MODE_SS_LOWER = 1;
export const MODE_SS_UPPER = 2;

/**
 * RiskResult — mirror of the VBA `Private Type RiskResult`.
 * VBA:
 *   Private Type RiskResult
 *       OK As Boolean
 *       msg As String
 *       pTrue As Double
 *       pObs As Double
 *       pPCA As Double
 *       pPFA As Double
 *       pPFR As Double
 *       pPCR As Double
 *       maxREOP_solve As Double
 *       maxREOP_input As Double
 *       sc_in As Double
 *       sc_solve As Double
 *       so_ref As Double
 *       su As Double
 *       sobs_in As Double
 *       reopMet As Boolean
 *   End Type
 * VBA value-types default to 0/False; we mirror that so an OK:false result has
 * the same "empty" numeric fields the VBA would return.
 */
export function newRiskResult() {
  return {
    OK: false,
    msg: "",
    pTrue: 0,
    pObs: 0,
    pPCA: 0,
    pPFA: 0,
    pPFR: 0,
    pPCR: 0,
    maxREOP_solve: 0,
    maxREOP_input: 0,
    sc_in: 0,
    sc_solve: 0,
    so_ref: 0,
    su: 0,
    sobs_in: 0,
    reopMet: false,
  };
}

/* =============================================================================
 * Normal PDF / CDF / inverse CDF
 * ========================================================================== */

// ── modRiskBackend › NormalPDF ───────────────────────────────────────────────
// VBA:
//   Private Function NormalPDF(z As Double) As Double
//       NormalPDF = Exp(-0.5 * z * z) / Sqr(2# * PI)
//   End Function
export function normalPDF(z) {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * PI);
}

// ── modRiskBackend › NormalCDF ───────────────────────────────────────────────
// VBA:
//   Private Function NormalCDF(z As Double) As Double
//       Const p# = 0.2316419
//       Const b1# = 0.31938153
//       Const b2# = -0.356563782
//       Const b3# = 1.781477937
//       Const b4# = -1.821255978
//       Const b5# = 1.330274429
//       Dim t As Double
//       Dim poly As Double
//       If z >= 0# Then
//           t = 1# / (1# + p * z)
//           poly = (((((b5 * t + b4) * t + b3) * t + b2) * t + b1) * t)
//           NormalCDF = 1# - NormalPDF(z) * poly
//       Else
//           NormalCDF = 1# - NormalCDF(-z)
//       End If
//   End Function
// Abramowitz & Stegun 26.2.17. Authoritative for the workbook; keep as-is.
export function normalCDF(z) {
  const p = 0.2316419;
  const b1 = 0.31938153;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;

  if (z >= 0) {
    const t = 1 / (1 + p * z);
    const poly = (((((b5 * t + b4) * t + b3) * t + b2) * t + b1) * t);
    return 1 - normalPDF(z) * poly;
  }
  return 1 - normalCDF(-z);
}

// ── modRiskBackend › NormalInvCDF ────────────────────────────────────────────
// VBA:
//   Private Function NormalInvCDF(pValue As Double) As Double
//       Dim lo As Double, hi As Double, mid As Double, i As Long
//       If Not (pValue > 0# And pValue < 1#) Then
//           Err.Raise 5, , "Probability must be in (0,1)."
//       End If
//       lo = -12# : hi = 12#
//       For i = 1 To 120
//           mid = 0.5 * (lo + hi)
//           If NormalCDF(mid) < pValue Then lo = mid Else hi = mid
//       Next i
//       NormalInvCDF = 0.5 * (lo + hi)
//   End Function
// 120-iteration bisection on [-12, 12] against the A&S NormalCDF (not a rational
// approximation); reproduce the iteration count exactly.
export function normalInvCDF(pValue) {
  if (!(pValue > 0 && pValue < 1)) {
    throw new Error("Probability must be in (0,1).");
  }

  let lo = -12;
  let hi = 12;

  for (let i = 1; i <= 120; i++) {
    const mid = 0.5 * (lo + hi);
    if (normalCDF(mid) < pValue) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return 0.5 * (lo + hi);
}

// ── modRiskBackend › ProbBetween ─────────────────────────────────────────────
// VBA:
//   Private Function ProbBetween(a As Double, b As Double, mu As Double, sigma As Double) As Double
//       If a >= b Then
//           ProbBetween = 0#
//       ElseIf sigma < 0# Then
//           ProbBetween = 0#
//       ElseIf sigma = 0# Then
//           If mu >= a And mu <= b Then ProbBetween = 1# Else ProbBetween = 0#
//       Else
//           ProbBetween = NormalCDF((b - mu) / sigma) - NormalCDF((a - mu) / sigma)
//       End If
//   End Function
export function probBetween(a, b, mu, sigma) {
  if (a >= b) return 0;
  if (sigma < 0) return 0;
  if (sigma === 0) {
    return mu >= a && mu <= b ? 1 : 0;
  }
  return normalCDF((b - mu) / sigma) - normalCDF((a - mu) / sigma);
}

// ── modRiskBackend › ProbSinglePass ──────────────────────────────────────────
// VBA:
//   Private Function ProbSinglePass(limitValue As Double, mode As Long, mu As Double, sigma As Double) As Double
//       If sigma < 0# Then ProbSinglePass = 0# : Exit Function
//       If sigma = 0# Then
//           Select Case mode
//               Case MODE_SS_UPPER
//                   If mu <= limitValue Then ProbSinglePass = 1# Else ProbSinglePass = 0#
//               Case MODE_SS_LOWER
//                   If mu >= limitValue Then ProbSinglePass = 1# Else ProbSinglePass = 0#
//               Case Else
//                   ProbSinglePass = 0#
//           End Select
//           Exit Function
//       End If
//       Select Case mode
//           Case MODE_SS_UPPER
//               ProbSinglePass = NormalCDF((limitValue - mu) / sigma)
//           Case MODE_SS_LOWER
//               ProbSinglePass = 1# - NormalCDF((limitValue - mu) / sigma)
//           Case Else
//               ProbSinglePass = 0#
//       End Select
//   End Function
export function probSinglePass(limitValue, mode, mu, sigma) {
  if (sigma < 0) return 0;

  if (sigma === 0) {
    switch (mode) {
      case MODE_SS_UPPER:
        return mu <= limitValue ? 1 : 0;
      case MODE_SS_LOWER:
        return mu >= limitValue ? 1 : 0;
      default:
        return 0;
    }
  }

  switch (mode) {
    case MODE_SS_UPPER:
      return normalCDF((limitValue - mu) / sigma);
    case MODE_SS_LOWER:
      return 1 - normalCDF((limitValue - mu) / sigma);
    default:
      return 0;
  }
}

// ── modRiskBackend › Clamp01 ─────────────────────────────────────────────────
// VBA:
//   Private Function Clamp01(x As Double) As Double
//       If x < 0# Then Clamp01 = 0#
//       ElseIf x > 1# Then Clamp01 = 1#
//       Else Clamp01 = x
//       End If
//   End Function
export function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/* =============================================================================
 * s_cal from TUR / U_cal
 * ========================================================================== */

// ── modRiskBackend › SigmaCAL_FromTUR ────────────────────────────────────────
// VBA:
//   Private Function SigmaCAL_FromTUR(TUR As Double) As Double
//       SigmaCAL_FromTUR = 1# / (TUR * 1.96)
//   End Function
// 1.96 is the fixed 95% k-factor the workbook uses everywhere; do not swap in a
// df-based Student-t. sigma_cal is normalized to the one-sided tolerance span.
export function sigmaCalFromTUR(TUR) {
  return 1 / (TUR * 1.96);
}

// ── modRiskBackend › SigmaCAL_FromUCal ───────────────────────────────────────
// VBA:
//   Private Function SigmaCAL_FromUCal(UCalNormalized As Double) As Double
//       ' UCalNormalized is the 95% expanded calibration-process uncertainty
//       ' normalized to the active one-sided tolerance span.
//       ' Therefore UCalNormalized = 1.96 * sigma_cal.
//       SigmaCAL_FromUCal = UCalNormalized / 1.96
//   End Function
export function sigmaCalFromUCal(UCalNormalized) {
  return UCalNormalized / 1.96;
}

/* =============================================================================
 * Invert area -> sigma  (assumes the center is inside the interval)
 * ========================================================================== */

// ── modRiskBackend › SigmaFromArea ───────────────────────────────────────────
// VBA:
//   Public Function SigmaFromArea(a As Double, b As Double, mu As Double, Target As Double, Optional tol As Double = SOLVE_TOL) As Double
//       If Not (Target > 0# And Target < 1#) Then Err.Raise 5, , "REOP must be in (0,1)."
//       If Not (a < mu And mu < b) Then Err.Raise 5, , "Require a < mu < b."
//       Dim lo, hi, mid, gLo, gHi, gMid, base As Double
//       Dim k As Long, i As Long
//       base = 1#
//       If Abs(b - a) > base Then base = Abs(b - a)
//       If Abs(b - mu) > base Then base = Abs(b - mu)
//       If Abs(mu - a) > base Then base = Abs(mu - a)
//       lo = 0.000000001 * base
//       hi = 1000# * base
//       gLo = ProbBetween(a, b, mu, lo) - Target
//       gHi = ProbBetween(a, b, mu, hi) - Target
//       Do While gLo * gHi > 0# And k < 12
//           hi = hi * 10#
//           gHi = ProbBetween(a, b, mu, hi) - Target
//           k = k + 1
//       Loop
//       If gLo * gHi > 0# Then Err.Raise 5, , "Failed to bracket sigma."
//       For i = 1 To 200
//           mid = 0.5 * (lo + hi)
//           gMid = ProbBetween(a, b, mu, mid) - Target
//           If Abs(gMid) < tol Or (hi - lo) / (Abs(mid) + 1#) < tol Then Exit For
//           If gMid > 0# Then lo = mid Else hi = mid
//       Next i
//       SigmaFromArea = mid
//   End Function
// Note: gLo is NOT refreshed inside the 200-iter bisection (the VBA only tests
// the sign of gMid). ProbBetween is monotonically decreasing in sigma when
// a < mu < b, so gMid > 0 (too much area) means sigma is too small -> raise lo.
export function sigmaFromArea(a, b, mu, target, tol = SOLVE_TOL) {
  if (!(target > 0 && target < 1)) throw new Error("REOP must be in (0,1).");
  if (!(a < mu && mu < b)) throw new Error("Require a < mu < b.");

  let base = 1;
  if (Math.abs(b - a) > base) base = Math.abs(b - a);
  if (Math.abs(b - mu) > base) base = Math.abs(b - mu);
  if (Math.abs(mu - a) > base) base = Math.abs(mu - a);

  let lo = 0.000000001 * base;
  let hi = 1000 * base;

  const gLo = probBetween(a, b, mu, lo) - target;
  let gHi = probBetween(a, b, mu, hi) - target;

  let k = 0;
  while (gLo * gHi > 0 && k < 12) {
    hi = hi * 10;
    gHi = probBetween(a, b, mu, hi) - target;
    k = k + 1;
  }

  if (gLo * gHi > 0) throw new Error("Failed to bracket sigma.");

  let mid = 0;
  for (let i = 1; i <= 200; i++) {
    mid = 0.5 * (lo + hi);
    const gMid = probBetween(a, b, mu, mid) - target;

    if (Math.abs(gMid) < tol || (hi - lo) / (Math.abs(mid) + 1) < tol) break;

    if (gMid > 0) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return mid;
}

// ── modRiskBackend › SolveSigmaObsSingle ─────────────────────────────────────
// VBA:
//   Private Function SolveSigmaObsSingle(limitValue As Double, mode As Long, muObs As Double, TargetSingle As Double, minSigma As Double, Optional tol As Double = SOLVE_TOL) As Double
//       Dim lo, hi, mid, gLo, gHi, gMid, base, pLo, pInf As Double
//       Dim k As Long, i As Long
//       If Not (TargetSingle > 0# And TargetSingle < 1#) Then Err.Raise 5, , "Single-sided REOP must be in (0,1)."
//       If minSigma < 0# Then Err.Raise 5, , "Minimum sigma must be nonnegative."
//       pInf = 0.5
//       base = 1#
//       If Abs(limitValue) > base Then base = Abs(limitValue)
//       If Abs(muObs) > base Then base = Abs(muObs)
//       If Abs(limitValue - muObs) > base Then base = Abs(limitValue - muObs)
//       lo = Application.Max(minSigma, 0.000000000001 * base)
//       pLo = ProbSinglePass(limitValue, mode, muObs, lo)
//       If Abs(pLo - TargetSingle) < tol Then SolveSigmaObsSingle = lo : Exit Function
//       If Abs(TargetSingle - pInf) < tol Then Err.Raise 5, , "Single-sided REOP of 50% requires infinite sigma."
//       If (pLo - TargetSingle) * (pInf - TargetSingle) > 0# Then Err.Raise 5, , "Requested single-sided REOP is outside the feasible range."
//       hi = Application.Max(1000# * base, 2# * lo)
//       gLo = pLo - TargetSingle
//       gHi = ProbSinglePass(limitValue, mode, muObs, hi) - TargetSingle
//       Do While gLo * gHi > 0# And k < 80
//           hi = hi * 2#
//           gHi = ProbSinglePass(limitValue, mode, muObs, hi) - TargetSingle
//           k = k + 1
//       Loop
//       If gLo * gHi > 0# Then Err.Raise 5, , "Failed to bracket single-sided sigma."
//       For i = 1 To 200
//           mid = 0.5 * (lo + hi)
//           gMid = ProbSinglePass(limitValue, mode, muObs, mid) - TargetSingle
//           If Abs(gMid) < tol Or (hi - lo) / (Abs(mid) + 1#) < tol Then Exit For
//           If gLo * gMid > 0# Then lo = mid : gLo = gMid Else hi = mid
//       Next i
//       SolveSigmaObsSingle = mid
//   End Function
// Unlike SigmaFromArea, this DOES refresh gLo inside the bisection.
export function solveSigmaObsSingle(limitValue, mode, muObs, targetSingle, minSigma, tol = SOLVE_TOL) {
  if (!(targetSingle > 0 && targetSingle < 1)) throw new Error("Single-sided REOP must be in (0,1).");
  if (minSigma < 0) throw new Error("Minimum sigma must be nonnegative.");

  const pInf = 0.5;

  let base = 1;
  if (Math.abs(limitValue) > base) base = Math.abs(limitValue);
  if (Math.abs(muObs) > base) base = Math.abs(muObs);
  if (Math.abs(limitValue - muObs) > base) base = Math.abs(limitValue - muObs);

  let lo = Math.max(minSigma, 0.000000000001 * base);
  const pLo = probSinglePass(limitValue, mode, muObs, lo);

  if (Math.abs(pLo - targetSingle) < tol) return lo;

  // As sigma -> infinity, one-sided pass probability approaches 50%.
  if (Math.abs(targetSingle - pInf) < tol) {
    throw new Error("Single-sided REOP of 50% requires infinite sigma.");
  }

  if ((pLo - targetSingle) * (pInf - targetSingle) > 0) {
    throw new Error("Requested single-sided REOP is outside the feasible range.");
  }

  let hi = Math.max(1000 * base, 2 * lo);
  let gLo = pLo - targetSingle;
  let gHi = probSinglePass(limitValue, mode, muObs, hi) - targetSingle;

  let k = 0;
  while (gLo * gHi > 0 && k < 80) {
    hi = hi * 2;
    gHi = probSinglePass(limitValue, mode, muObs, hi) - targetSingle;
    k = k + 1;
  }

  if (gLo * gHi > 0) throw new Error("Failed to bracket single-sided sigma.");

  let mid = 0;
  for (let i = 1; i <= 200; i++) {
    mid = 0.5 * (lo + hi);
    const gMid = probSinglePass(limitValue, mode, muObs, mid) - targetSingle;

    if (Math.abs(gMid) < tol || (hi - lo) / (Math.abs(mid) + 1) < tol) break;

    if (gLo * gMid > 0) {
      lo = mid;
      gLo = gMid;
    } else {
      hi = mid;
    }
  }

  return mid;
}

// ── modRiskBackend › MaxAchievableSinglePass ─────────────────────────────────
// VBA:
//   Private Function MaxAchievableSinglePass(limitValue As Double, mode As Long, muObs As Double, minSigma As Double) As Double
//       Dim pAtMinSigma As Double
//       pAtMinSigma = ProbSinglePass(limitValue, mode, muObs, minSigma)
//       If pAtMinSigma >= 0.5 Then MaxAchievableSinglePass = pAtMinSigma Else MaxAchievableSinglePass = 0.5
//   End Function
export function maxAchievableSinglePass(limitValue, mode, muObs, minSigma) {
  const pAtMinSigma = probSinglePass(limitValue, mode, muObs, minSigma);
  return pAtMinSigma >= 0.5 ? pAtMinSigma : 0.5;
}

// ── modRiskBackend › MinAchievableSinglePass ─────────────────────────────────
// VBA:
//   Private Function MinAchievableSinglePass(limitValue As Double, mode As Long, muObs As Double, minSigma As Double) As Double
//       Dim pAtMinSigma As Double
//       pAtMinSigma = ProbSinglePass(limitValue, mode, muObs, minSigma)
//       If pAtMinSigma <= 0.5 Then MinAchievableSinglePass = pAtMinSigma Else MinAchievableSinglePass = 0.5
//   End Function
export function minAchievableSinglePass(limitValue, mode, muObs, minSigma) {
  const pAtMinSigma = probSinglePass(limitValue, mode, muObs, minSigma);
  return pAtMinSigma <= 0.5 ? pAtMinSigma : 0.5;
}

/* =============================================================================
 * PCA machinery: two-sided
 * Integrate in dimensionless t = (y - mu) / s_uut
 * ========================================================================== */

// ── modRiskBackend › Ppass_given_y_DS ────────────────────────────────────────
// VBA:
//   Private Function Ppass_given_y_DS(y As Double, lgb As Double, ugb As Double, sc As Double, xc As Double) As Double
//       If sc <= 0# Then
//           If y + xc >= lgb And y + xc <= ugb Then Ppass_given_y_DS = 1# Else Ppass_given_y_DS = 0#
//       Else
//           Ppass_given_y_DS = NormalCDF((ugb - (y + xc)) / sc) - NormalCDF((lgb - (y + xc)) / sc)
//       End If
//   End Function
export function ppassGivenYDS(y, lgb, ugb, sc, xc) {
  if (sc <= 0) {
    return y + xc >= lgb && y + xc <= ugb ? 1 : 0;
  }
  return normalCDF((ugb - (y + xc)) / sc) - normalCDF((lgb - (y + xc)) / sc);
}

// ── modRiskBackend › PCA_IntegrandT_DS ───────────────────────────────────────
// VBA:
//   Private Function PCA_IntegrandT_DS(t As Double, mu As Double, su As Double, lgb As Double, ugb As Double, sc As Double, xc As Double) As Double
//       Dim y As Double
//       y = mu + su * t
//       PCA_IntegrandT_DS = NormalPDF(t) * Ppass_given_y_DS(y, lgb, ugb, sc, xc)
//   End Function
export function pcaIntegrandTDS(t, mu, su, lgb, ugb, sc, xc) {
  const y = mu + su * t;
  return normalPDF(t) * ppassGivenYDS(y, lgb, ugb, sc, xc);
}

// ── modRiskBackend › PCA_Integral_DS ─────────────────────────────────────────
// VBA:
//   Public Function PCA_Integral_DS(mu As Double, su As Double, lgb As Double, ugb As Double, sc As Double, a As Double, b As Double, xc As Double) As Double
//       Dim lo, hi, ta, tb, m, fa, fm, fb As Double
//       If a >= b Or su < 0# Then PCA_Integral_DS = 0# : Exit Function
//       If su = 0# Then
//           If mu >= a And mu <= b Then PCA_Integral_DS = Ppass_given_y_DS(mu, lgb, ugb, sc, xc) Else PCA_Integral_DS = 0#
//           Exit Function
//       End If
//       If sc = 0# Then
//           lo = Application.Max(a, lgb - xc)
//           hi = Application.Min(b, ugb - xc)
//           PCA_Integral_DS = ProbBetween(lo, hi, mu, su)
//           Exit Function
//       End If
//       ta = (a - mu) / su
//       tb = (b - mu) / su
//       ta = Application.Max(ta, -T_CUTOFF)
//       tb = Application.Min(tb, T_CUTOFF)
//       If ta >= tb Then PCA_Integral_DS = 0# : Exit Function
//       m = 0.5 * (ta + tb)
//       fa = PCA_IntegrandT_DS(ta, mu, su, lgb, ugb, sc, xc)
//       fm = PCA_IntegrandT_DS(m, mu, su, lgb, ugb, sc, xc)
//       fb = PCA_IntegrandT_DS(tb, mu, su, lgb, ugb, sc, xc)
//       PCA_Integral_DS = AS_RecT_DS(ta, tb, fa, fm, fb, 0.00000001, mu, su, lgb, ugb, sc, xc, 0)
//   End Function
export function pcaIntegralDS(mu, su, lgb, ugb, sc, a, b, xc) {
  if (a >= b || su < 0) return 0;

  if (su === 0) {
    return mu >= a && mu <= b ? ppassGivenYDS(mu, lgb, ugb, sc, xc) : 0;
  }

  if (sc === 0) {
    const lo = Math.max(a, lgb - xc);
    const hi = Math.min(b, ugb - xc);
    return probBetween(lo, hi, mu, su);
  }

  let ta = (a - mu) / su;
  let tb = (b - mu) / su;

  ta = Math.max(ta, -T_CUTOFF);
  tb = Math.min(tb, T_CUTOFF);

  if (ta >= tb) return 0;

  const m = 0.5 * (ta + tb);
  const fa = pcaIntegrandTDS(ta, mu, su, lgb, ugb, sc, xc);
  const fm = pcaIntegrandTDS(m, mu, su, lgb, ugb, sc, xc);
  const fb = pcaIntegrandTDS(tb, mu, su, lgb, ugb, sc, xc);

  return asRecTDS(ta, tb, fa, fm, fb, 0.00000001, mu, su, lgb, ugb, sc, xc, 0);
}

// ── modRiskBackend › AS_RecT_DS ──────────────────────────────────────────────
// VBA:
//   Private Function AS_RecT_DS(a, b, fa, fm, fb, tol, mu, su, lgb, ugb, sc, xc, depth) As Double
//       Const MAX_DEPTH As Long = 20
//       Dim m, h, lm, rm, flm, frm, s, Sleft, Sright, S2 As Double
//       m = 0.5 * (a + b)
//       h = b - a
//       lm = 0.5 * (a + m)
//       rm = 0.5 * (m + b)
//       flm = PCA_IntegrandT_DS(lm, mu, su, lgb, ugb, sc, xc)
//       frm = PCA_IntegrandT_DS(rm, mu, su, lgb, ugb, sc, xc)
//       s = (h / 6#) * (fa + 4# * fm + fb)
//       Sleft = (h / 12#) * (fa + 4# * flm + fm)
//       Sright = (h / 12#) * (fm + 4# * frm + fb)
//       S2 = Sleft + Sright
//       If depth >= MAX_DEPTH Or Abs(S2 - s) < 15# * tol Then
//           AS_RecT_DS = S2 + (S2 - s) / 15#
//       Else
//           AS_RecT_DS = AS_RecT_DS(a, m, fa, flm, fm, tol / 2#, ...) + AS_RecT_DS(m, b, fm, frm, fb, tol / 2#, ...)
//       End If
//   End Function
// Adaptive Simpson with Richardson extrapolation (+ (S2-s)/15), MAX_DEPTH = 20.
export function asRecTDS(a, b, fa, fm, fb, tol, mu, su, lgb, ugb, sc, xc, depth) {
  const MAX_DEPTH = 20;

  const m = 0.5 * (a + b);
  const h = b - a;
  const lm = 0.5 * (a + m);
  const rm = 0.5 * (m + b);

  const flm = pcaIntegrandTDS(lm, mu, su, lgb, ugb, sc, xc);
  const frm = pcaIntegrandTDS(rm, mu, su, lgb, ugb, sc, xc);

  const s = (h / 6) * (fa + 4 * fm + fb);
  const sLeft = (h / 12) * (fa + 4 * flm + fm);
  const sRight = (h / 12) * (fm + 4 * frm + fb);
  const S2 = sLeft + sRight;

  if (depth >= MAX_DEPTH || Math.abs(S2 - s) < 15 * tol) {
    return S2 + (S2 - s) / 15;
  }
  return (
    asRecTDS(a, m, fa, flm, fm, tol / 2, mu, su, lgb, ugb, sc, xc, depth + 1) +
    asRecTDS(m, b, fm, frm, fb, tol / 2, mu, su, lgb, ugb, sc, xc, depth + 1)
  );
}

/* =============================================================================
 * PCA machinery: true single-sided
 * No two-sided half-probability mapping is used here.
 * ========================================================================== */

// ── modRiskBackend › Ppass_given_y_SS ────────────────────────────────────────
// VBA:
//   Private Function Ppass_given_y_SS(y As Double, gb As Double, sc As Double, xc As Double, mode As Long) As Double
//       Dim m As Double
//       m = y + xc
//       If sc <= 0# Then
//           Select Case mode
//               Case MODE_SS_UPPER
//                   If m <= gb Then Ppass_given_y_SS = 1# Else Ppass_given_y_SS = 0#
//               Case MODE_SS_LOWER
//                   If m >= gb Then Ppass_given_y_SS = 1# Else Ppass_given_y_SS = 0#
//               Case Else
//                   Ppass_given_y_SS = 0#
//           End Select
//           Exit Function
//       End If
//       Select Case mode
//           Case MODE_SS_UPPER
//               Ppass_given_y_SS = NormalCDF((gb - m) / sc)
//           Case MODE_SS_LOWER
//               Ppass_given_y_SS = 1# - NormalCDF((gb - m) / sc)
//           Case Else
//               Ppass_given_y_SS = 0#
//       End Select
//   End Function
export function ppassGivenYSS(y, gb, sc, xc, mode) {
  const m = y + xc;

  if (sc <= 0) {
    switch (mode) {
      case MODE_SS_UPPER:
        return m <= gb ? 1 : 0;
      case MODE_SS_LOWER:
        return m >= gb ? 1 : 0;
      default:
        return 0;
    }
  }

  switch (mode) {
    case MODE_SS_UPPER:
      return normalCDF((gb - m) / sc);
    case MODE_SS_LOWER:
      return 1 - normalCDF((gb - m) / sc);
    default:
      return 0;
  }
}

// ── modRiskBackend › PCA_IntegrandT_SS ───────────────────────────────────────
// VBA:
//   Private Function PCA_IntegrandT_SS(t As Double, mu As Double, su As Double, gb As Double, sc As Double, uutLim As Double, xc As Double, mode As Long) As Double
//       Dim y As Double
//       y = mu + su * t
//       PCA_IntegrandT_SS = NormalPDF(t) * Ppass_given_y_SS(y, gb, sc, xc, mode)
//   End Function
export function pcaIntegrandTSS(t, mu, su, gb, sc, uutLim, xc, mode) {
  const y = mu + su * t;
  return normalPDF(t) * ppassGivenYSS(y, gb, sc, xc, mode);
}

// ── modRiskBackend › PCA_Integral_SS ─────────────────────────────────────────
// VBA:
//   Public Function PCA_Integral_SS(mu As Double, su As Double, gb As Double, sc As Double, uutLim As Double, xc As Double, mode As Long) As Double
//       Dim lo, hi, ta, tb, m, fa, fm, fb As Double
//       If su < 0# Then PCA_Integral_SS = 0# : Exit Function
//       If su = 0# Then
//           Select Case mode
//               Case MODE_SS_UPPER
//                   If mu <= uutLim Then PCA_Integral_SS = Ppass_given_y_SS(mu, gb, sc, xc, mode) Else PCA_Integral_SS = 0#
//               Case MODE_SS_LOWER
//                   If mu >= uutLim Then PCA_Integral_SS = Ppass_given_y_SS(mu, gb, sc, xc, mode) Else PCA_Integral_SS = 0#
//               Case Else
//                   PCA_Integral_SS = 0#
//           End Select
//           Exit Function
//       End If
//       If sc = 0# Then
//           Select Case mode
//               Case MODE_SS_UPPER
//                   hi = Application.Min(uutLim, gb - xc)
//                   PCA_Integral_SS = ProbSinglePass(hi, MODE_SS_UPPER, mu, su)
//               Case MODE_SS_LOWER
//                   lo = Application.Max(uutLim, gb - xc)
//                   PCA_Integral_SS = ProbSinglePass(lo, MODE_SS_LOWER, mu, su)
//               Case Else
//                   PCA_Integral_SS = 0#
//           End Select
//           Exit Function
//       End If
//       Select Case mode
//           Case MODE_SS_UPPER
//               ta = -T_CUTOFF
//               tb = (uutLim - mu) / su
//               tb = Application.Min(tb, T_CUTOFF)
//           Case MODE_SS_LOWER
//               ta = (uutLim - mu) / su
//               ta = Application.Max(ta, -T_CUTOFF)
//               tb = T_CUTOFF
//           Case Else
//               PCA_Integral_SS = 0# : Exit Function
//       End Select
//       If ta >= tb Then PCA_Integral_SS = 0# : Exit Function
//       m = 0.5 * (ta + tb)
//       fa = PCA_IntegrandT_SS(ta, mu, su, gb, sc, uutLim, xc, mode)
//       fm = PCA_IntegrandT_SS(m, mu, su, gb, sc, uutLim, xc, mode)
//       fb = PCA_IntegrandT_SS(tb, mu, su, gb, sc, uutLim, xc, mode)
//       PCA_Integral_SS = AS_RecT_SS(ta, tb, fa, fm, fb, 0.00000001, mu, su, gb, sc, uutLim, xc, mode, 0)
//   End Function
export function pcaIntegralSS(mu, su, gb, sc, uutLim, xc, mode) {
  if (su < 0) return 0;

  if (su === 0) {
    switch (mode) {
      case MODE_SS_UPPER:
        return mu <= uutLim ? ppassGivenYSS(mu, gb, sc, xc, mode) : 0;
      case MODE_SS_LOWER:
        return mu >= uutLim ? ppassGivenYSS(mu, gb, sc, xc, mode) : 0;
      default:
        return 0;
    }
  }

  if (sc === 0) {
    switch (mode) {
      case MODE_SS_UPPER: {
        const hi = Math.min(uutLim, gb - xc);
        return probSinglePass(hi, MODE_SS_UPPER, mu, su);
      }
      case MODE_SS_LOWER: {
        const lo = Math.max(uutLim, gb - xc);
        return probSinglePass(lo, MODE_SS_LOWER, mu, su);
      }
      default:
        return 0;
    }
  }

  let ta;
  let tb;
  switch (mode) {
    case MODE_SS_UPPER:
      ta = -T_CUTOFF;
      tb = (uutLim - mu) / su;
      tb = Math.min(tb, T_CUTOFF);
      break;
    case MODE_SS_LOWER:
      ta = (uutLim - mu) / su;
      ta = Math.max(ta, -T_CUTOFF);
      tb = T_CUTOFF;
      break;
    default:
      return 0;
  }

  if (ta >= tb) return 0;

  const m = 0.5 * (ta + tb);
  const fa = pcaIntegrandTSS(ta, mu, su, gb, sc, uutLim, xc, mode);
  const fm = pcaIntegrandTSS(m, mu, su, gb, sc, uutLim, xc, mode);
  const fb = pcaIntegrandTSS(tb, mu, su, gb, sc, uutLim, xc, mode);

  return asRecTSS(ta, tb, fa, fm, fb, 0.00000001, mu, su, gb, sc, uutLim, xc, mode, 0);
}

// ── modRiskBackend › AS_RecT_SS ──────────────────────────────────────────────
// VBA:
//   Private Function AS_RecT_SS(a, b, fa, fm, fb, tol, mu, su, gb, sc, uutLim, xc, mode, depth) As Double
//       Const MAX_DEPTH As Long = 20
//       Dim m, h, lm, rm, flm, frm, s, Sleft, Sright, S2 As Double
//       m = 0.5 * (a + b)
//       h = b - a
//       lm = 0.5 * (a + m)
//       rm = 0.5 * (m + b)
//       flm = PCA_IntegrandT_SS(lm, mu, su, gb, sc, uutLim, xc, mode)
//       frm = PCA_IntegrandT_SS(rm, mu, su, gb, sc, uutLim, xc, mode)
//       s = (h / 6#) * (fa + 4# * fm + fb)
//       Sleft = (h / 12#) * (fa + 4# * flm + fm)
//       Sright = (h / 12#) * (fm + 4# * frm + fb)
//       S2 = Sleft + Sright
//       If depth >= MAX_DEPTH Or Abs(S2 - s) < 15# * tol Then
//           AS_RecT_SS = S2 + (S2 - s) / 15#
//       Else
//           AS_RecT_SS = AS_RecT_SS(a, m, fa, flm, fm, tol / 2#, ...) + AS_RecT_SS(m, b, fm, frm, fb, tol / 2#, ...)
//       End If
//   End Function
export function asRecTSS(a, b, fa, fm, fb, tol, mu, su, gb, sc, uutLim, xc, mode, depth) {
  const MAX_DEPTH = 20;

  const m = 0.5 * (a + b);
  const h = b - a;
  const lm = 0.5 * (a + m);
  const rm = 0.5 * (m + b);

  const flm = pcaIntegrandTSS(lm, mu, su, gb, sc, uutLim, xc, mode);
  const frm = pcaIntegrandTSS(rm, mu, su, gb, sc, uutLim, xc, mode);

  const s = (h / 6) * (fa + 4 * fm + fb);
  const sLeft = (h / 12) * (fa + 4 * flm + fm);
  const sRight = (h / 12) * (fm + 4 * frm + fb);
  const S2 = sLeft + sRight;

  if (depth >= MAX_DEPTH || Math.abs(S2 - s) < 15 * tol) {
    return S2 + (S2 - s) / 15;
  }
  return (
    asRecTSS(a, m, fa, flm, fm, tol / 2, mu, su, gb, sc, uutLim, xc, mode, depth + 1) +
    asRecTSS(m, b, fm, frm, fb, tol / 2, mu, su, gb, sc, uutLim, xc, mode, depth + 1)
  );
}

/* =============================================================================
 * Core evaluator: two-sided
 * ========================================================================== */

// ── modRiskBackend › EvaluateCase_DS ─────────────────────────────────────────
// VBA:
//   Private Function EvaluateCase_DS(TUR_in As Double, REOP_ref As Double, TUR_solve As Double, _
//                                    GB_L As Double, GB_H As Double, _
//                                    mu As Double, LTL As Double, UTL As Double, XCAL As Double) As RiskResult
//       Dim r As RiskResult
//       Dim pTrueRaw, pObsRaw, pPCARaw, muObs As Double
//       On Error GoTo fail
//       muObs = mu + XCAL
//       If TUR_in <= 0# Then GoTo fail
//       If TUR_solve <= 0# Then GoTo fail
//       If Not (REOP_ref > 0# And REOP_ref < 1#) Then GoTo fail
//       If Not (GB_L < GB_H) Then GoTo fail
//       If Not (LTL < UTL) Then GoTo fail
//       If Not (LTL < muObs And muObs < UTL) Then GoTo fail
//       r.sc_solve = SigmaCAL_FromTUR(TUR_solve)
//       r.sc_in = SigmaCAL_FromTUR(TUR_in)
//       r.maxREOP_solve = ProbBetween(LTL, UTL, muObs, r.sc_solve)
//       r.maxREOP_input = ProbBetween(GB_L, GB_H, muObs, r.sc_in)
//       If REOP_ref <= r.maxREOP_solve + EPS Then
//           r.so_ref = SigmaFromArea(LTL, UTL, muObs, REOP_ref)
//           If r.so_ref < r.sc_solve Then r.so_ref = r.sc_solve
//           r.su = Sqr(Application.Max(0#, r.so_ref ^ 2 - r.sc_solve ^ 2))
//           r.reopMet = True
//       Else
//           r.su = 0#
//           r.so_ref = r.sc_solve
//           r.reopMet = False
//       End If
//       r.sobs_in = Sqr(r.su ^ 2 + r.sc_in ^ 2)
//       pObsRaw = ProbBetween(GB_L, GB_H, muObs, r.sobs_in)
//       pTrueRaw = ProbBetween(LTL, UTL, mu, r.su)
//       pPCARaw = PCA_Integral_DS(mu, r.su, GB_L, GB_H, r.sc_in, LTL, UTL, XCAL)
//       r.pPCA = Clamp01(pPCARaw)
//       If r.pPCA > pTrueRaw Then r.pPCA = Clamp01(pTrueRaw)
//       If r.pPCA > pObsRaw Then r.pPCA = Clamp01(pObsRaw)
//       r.pPFA = Clamp01(pObsRaw - r.pPCA)
//       r.pPFR = Clamp01(pTrueRaw - r.pPCA)
//       r.pPCR = Clamp01(1# - r.pPCA - r.pPFA - r.pPFR)
//       r.pObs = Clamp01(r.pPCA + r.pPFA)
//       r.pTrue = Clamp01(r.pPCA + r.pPFR)
//       r.maxREOP_solve = Clamp01(r.maxREOP_solve)
//       r.maxREOP_input = Clamp01(r.maxREOP_input)
//       r.OK = True
//       EvaluateCase_DS = r
//       Exit Function
//   fail:
//       r.OK = False
//       r.msg = "Input error: check TUR>0, REOP in (0,1), GB_L<GB_H, LTL<UTL, and LTL < mu+mu_cal < UTL."
//       EvaluateCase_DS = r
//   End Function
// The VBA `On Error GoTo fail` catches both the explicit `GoTo fail` guards and
// any runtime error raised by SigmaFromArea; we model both with the sentinel
// `_FAIL` thrown into the surrounding try/catch.
const _FAIL = Symbol("EvaluateCase.fail");

export function evaluateCaseDS(TUR_in, REOP_ref, TUR_solve, GB_L, GB_H, mu, LTL, UTL, XCAL) {
  const r = newRiskResult();

  try {
    const muObs = mu + XCAL;

    if (TUR_in <= 0) throw _FAIL;
    if (TUR_solve <= 0) throw _FAIL;
    if (!(REOP_ref > 0 && REOP_ref < 1)) throw _FAIL;
    if (!(GB_L < GB_H)) throw _FAIL;
    if (!(LTL < UTL)) throw _FAIL;
    if (!(LTL < muObs && muObs < UTL)) throw _FAIL;

    r.sc_solve = sigmaCalFromTUR(TUR_solve);
    r.sc_in = sigmaCalFromTUR(TUR_in);

    r.maxREOP_solve = probBetween(LTL, UTL, muObs, r.sc_solve);
    r.maxREOP_input = probBetween(GB_L, GB_H, muObs, r.sc_in);

    if (REOP_ref <= r.maxREOP_solve + EPS) {
      r.so_ref = sigmaFromArea(LTL, UTL, muObs, REOP_ref);
      if (r.so_ref < r.sc_solve) r.so_ref = r.sc_solve;
      r.su = Math.sqrt(Math.max(0, r.so_ref ** 2 - r.sc_solve ** 2));
      r.reopMet = true;
    } else {
      r.su = 0;
      r.so_ref = r.sc_solve;
      r.reopMet = false;
    }

    r.sobs_in = Math.sqrt(r.su ** 2 + r.sc_in ** 2);

    const pObsRaw = probBetween(GB_L, GB_H, muObs, r.sobs_in);
    const pTrueRaw = probBetween(LTL, UTL, mu, r.su);
    const pPCARaw = pcaIntegralDS(mu, r.su, GB_L, GB_H, r.sc_in, LTL, UTL, XCAL);

    r.pPCA = clamp01(pPCARaw);
    if (r.pPCA > pTrueRaw) r.pPCA = clamp01(pTrueRaw);
    if (r.pPCA > pObsRaw) r.pPCA = clamp01(pObsRaw);

    r.pPFA = clamp01(pObsRaw - r.pPCA);
    r.pPFR = clamp01(pTrueRaw - r.pPCA);
    r.pPCR = clamp01(1 - r.pPCA - r.pPFA - r.pPFR);

    r.pObs = clamp01(r.pPCA + r.pPFA);
    r.pTrue = clamp01(r.pPCA + r.pPFR);
    r.maxREOP_solve = clamp01(r.maxREOP_solve);
    r.maxREOP_input = clamp01(r.maxREOP_input);

    r.OK = true;
    return r;
  } catch (e) {
    r.OK = false;
    r.msg = "Input error: check TUR>0, REOP in (0,1), GB_L<GB_H, LTL<UTL, and LTL < mu+mu_cal < UTL.";
    return r;
  }
}

/* =============================================================================
 * Core evaluator: true single-sided
 * Entered REOP and TURs are single-sided. mu and mu_cal are included.
 * ========================================================================== */

// ── modRiskBackend › EvaluateCase_SS ─────────────────────────────────────────
// VBA:
//   Private Function EvaluateCase_SS(TUR_in As Double, REOP_ref_single As Double, TUR_solve As Double, _
//                                    activeGB As Double, activeUUT As Double, mode As Long, _
//                                    mu As Double, XCAL As Double) As RiskResult
//       Dim r As RiskResult
//       Dim muObs, pTrueRaw, pObsRaw, pPCARaw, minREOP, maxREOP, pAtMinSigma As Double
//       On Error GoTo fail
//       muObs = mu + XCAL
//       If TUR_in <= 0# Then GoTo fail
//       If TUR_solve <= 0# Then GoTo fail
//       If Not (REOP_ref_single > 0# And REOP_ref_single < 1#) Then GoTo fail
//       If mode <> MODE_SS_UPPER And mode <> MODE_SS_LOWER Then GoTo fail
//       r.sc_solve = SigmaCAL_FromTUR(TUR_solve)
//       r.sc_in = SigmaCAL_FromTUR(TUR_in)
//       r.maxREOP_solve = MaxAchievableSinglePass(activeUUT, mode, muObs, r.sc_solve)
//       r.maxREOP_input = MaxAchievableSinglePass(activeGB, mode, muObs, r.sc_in)
//       minREOP = MinAchievableSinglePass(activeUUT, mode, muObs, r.sc_solve)
//       maxREOP = MaxAchievableSinglePass(activeUUT, mode, muObs, r.sc_solve)
//       pAtMinSigma = ProbSinglePass(activeUUT, mode, muObs, r.sc_solve)
//       If REOP_ref_single >= minREOP - EPS And REOP_ref_single <= maxREOP + EPS Then
//           r.so_ref = SolveSigmaObsSingle(activeUUT, mode, muObs, REOP_ref_single, r.sc_solve)
//           If r.so_ref < r.sc_solve Then r.so_ref = r.sc_solve
//           r.su = Sqr(Application.Max(0#, r.so_ref ^ 2 - r.sc_solve ^ 2))
//           r.reopMet = True
//       ElseIf Abs(pAtMinSigma - maxREOP) < EPS And REOP_ref_single > maxREOP + EPS Then
//           r.su = 0# : r.so_ref = r.sc_solve : r.reopMet = False
//       ElseIf Abs(pAtMinSigma - minREOP) < EPS And REOP_ref_single < minREOP - EPS Then
//           r.su = 0# : r.so_ref = r.sc_solve : r.reopMet = False
//       Else
//           GoTo fail
//       End If
//       r.sobs_in = Sqr(r.su ^ 2 + r.sc_in ^ 2)
//       pObsRaw = ProbSinglePass(activeGB, mode, muObs, r.sobs_in)
//       pTrueRaw = ProbSinglePass(activeUUT, mode, mu, r.su)
//       pPCARaw = PCA_Integral_SS(mu, r.su, activeGB, r.sc_in, activeUUT, XCAL, mode)
//       r.pPCA = Clamp01(pPCARaw)
//       If r.pPCA > pTrueRaw Then r.pPCA = Clamp01(pTrueRaw)
//       If r.pPCA > pObsRaw Then r.pPCA = Clamp01(pObsRaw)
//       r.pPFA = Clamp01(pObsRaw - r.pPCA)
//       r.pPFR = Clamp01(pTrueRaw - r.pPCA)
//       r.pPCR = Clamp01(1# - r.pPCA - r.pPFA - r.pPFR)
//       r.pObs = Clamp01(r.pPCA + r.pPFA)
//       r.pTrue = Clamp01(r.pPCA + r.pPFR)
//       r.maxREOP_solve = Clamp01(r.maxREOP_solve)
//       r.maxREOP_input = Clamp01(r.maxREOP_input)
//       r.OK = True
//       EvaluateCase_SS = r
//       Exit Function
//   fail:
//       r.OK = False
//       r.msg = "Input error: in single-sided mode, use one matching blank pair for the inactive side, TUR>0, REOP in (0,1), and a feasible single-sided REOP for the active limit, mu, and mu_cal."
//       EvaluateCase_SS = r
//   End Function
export function evaluateCaseSS(TUR_in, REOP_ref_single, TUR_solve, activeGB, activeUUT, mode, mu, XCAL) {
  const r = newRiskResult();

  try {
    const muObs = mu + XCAL;

    if (TUR_in <= 0) throw _FAIL;
    if (TUR_solve <= 0) throw _FAIL;
    if (!(REOP_ref_single > 0 && REOP_ref_single < 1)) throw _FAIL;
    if (mode !== MODE_SS_UPPER && mode !== MODE_SS_LOWER) throw _FAIL;

    r.sc_solve = sigmaCalFromTUR(TUR_solve);
    r.sc_in = sigmaCalFromTUR(TUR_in);

    r.maxREOP_solve = maxAchievableSinglePass(activeUUT, mode, muObs, r.sc_solve);
    r.maxREOP_input = maxAchievableSinglePass(activeGB, mode, muObs, r.sc_in);

    const minREOP = minAchievableSinglePass(activeUUT, mode, muObs, r.sc_solve);
    const maxREOP = maxAchievableSinglePass(activeUUT, mode, muObs, r.sc_solve);
    const pAtMinSigma = probSinglePass(activeUUT, mode, muObs, r.sc_solve);

    if (REOP_ref_single >= minREOP - EPS && REOP_ref_single <= maxREOP + EPS) {
      r.so_ref = solveSigmaObsSingle(activeUUT, mode, muObs, REOP_ref_single, r.sc_solve);
      if (r.so_ref < r.sc_solve) r.so_ref = r.sc_solve;
      r.su = Math.sqrt(Math.max(0, r.so_ref ** 2 - r.sc_solve ** 2));
      r.reopMet = true;
    } else if (Math.abs(pAtMinSigma - maxREOP) < EPS && REOP_ref_single > maxREOP + EPS) {
      // Usual case: mean is on the passing side, requested REOP exceeds the cal-limited maximum.
      r.su = 0;
      r.so_ref = r.sc_solve;
      r.reopMet = false;
    } else if (Math.abs(pAtMinSigma - minREOP) < EPS && REOP_ref_single < minREOP - EPS) {
      // Mean is on the failing side, requested REOP below the cal-limited minimum.
      r.su = 0;
      r.so_ref = r.sc_solve;
      r.reopMet = false;
    } else {
      throw _FAIL;
    }

    r.sobs_in = Math.sqrt(r.su ** 2 + r.sc_in ** 2);

    const pObsRaw = probSinglePass(activeGB, mode, muObs, r.sobs_in);
    const pTrueRaw = probSinglePass(activeUUT, mode, mu, r.su);
    const pPCARaw = pcaIntegralSS(mu, r.su, activeGB, r.sc_in, activeUUT, XCAL, mode);

    r.pPCA = clamp01(pPCARaw);
    if (r.pPCA > pTrueRaw) r.pPCA = clamp01(pTrueRaw);
    if (r.pPCA > pObsRaw) r.pPCA = clamp01(pObsRaw);

    r.pPFA = clamp01(pObsRaw - r.pPCA);
    r.pPFR = clamp01(pTrueRaw - r.pPCA);
    r.pPCR = clamp01(1 - r.pPCA - r.pPFA - r.pPFR);

    r.pObs = clamp01(r.pPCA + r.pPFA);
    r.pTrue = clamp01(r.pPCA + r.pPFR);
    r.maxREOP_solve = clamp01(r.maxREOP_solve);
    r.maxREOP_input = clamp01(r.maxREOP_input);

    r.OK = true;
    return r;
  } catch (e) {
    r.OK = false;
    r.msg =
      "Input error: in single-sided mode, use one matching blank pair for the inactive side, TUR>0, REOP in (0,1), and a feasible single-sided REOP for the active limit, mu, and mu_cal.";
    return r;
  }
}

/* =============================================================================
 * PHASE 2 — Mitigation solvers and interval-decay models
 * Continues the literal port of modRiskBackend.bas. Guard-band recommendation,
 * REOP-only recommendation, and the five interval-decay models (E1/E2/D/W1/W2).
 * ========================================================================== */

/**
 * RecResult — mirror of the VBA `Private Type RecResult`.
 * VBA:
 *   Private Type RecResult
 *       Active As Boolean
 *       Found As Boolean
 *       AlreadyCompliant As Boolean
 *       recREOP As Double
 *       recGB As Double
 *       pObs As Double
 *       pPFA As Double
 *       pPFR As Double
 *       Status As String
 *   End Type
 */
export function newRecResult() {
  return {
    Active: false,
    Found: false,
    AlreadyCompliant: false,
    recREOP: 0,
    recGB: 0,
    pObs: 0,
    pPFA: 0,
    pPFR: 0,
    Status: "",
  };
}

/* -----------------------------------------------------------------------------
 * Guard-band ratio helpers
 * -------------------------------------------------------------------------- */

// ── modRiskBackend › CurrentGBRatio ──────────────────────────────────────────
// VBA:
//   Private Function CurrentGBRatio(GB_L As Double, GB_H As Double, LTL As Double, UTL As Double) As Double
//       If UTL <= LTL Then CurrentGBRatio = 0#
//       Else CurrentGBRatio = (GB_H - GB_L) / (UTL - LTL)
//       End If
//   End Function
export function currentGBRatio(GB_L, GB_H, LTL, UTL) {
  if (UTL <= LTL) return 0;
  return (GB_H - GB_L) / (UTL - LTL);
}

// ── modRiskBackend › CurrentGBRatio_SS ───────────────────────────────────────
// VBA:
//   Private Function CurrentGBRatio_SS(activeGB As Double, activeUUT As Double) As Double
//       If activeUUT = 0# Then CurrentGBRatio_SS = 0#
//       Else CurrentGBRatio_SS = Abs(activeGB / activeUUT)
//       End If
//   End Function
export function currentGBRatioSS(activeGB, activeUUT) {
  if (activeUUT === 0) return 0;
  return Math.abs(activeGB / activeUUT);
}

// ── modRiskBackend › GuardbandFromRatio ──────────────────────────────────────
// VBA:
//   Private Sub GuardbandFromRatio(LTL As Double, UTL As Double, g As Double, ByRef GB_L As Double, ByRef GB_H As Double)
//       GB_L = g * LTL
//       GB_H = g * UTL
//   End Sub
// VBA writes GB_L/GB_H by-ref; the JS port returns them as { GB_L, GB_H }.
export function guardbandFromRatio(LTL, UTL, g) {
  return { GB_L: g * LTL, GB_H: g * UTL };
}

// ── modRiskBackend › SingleToEffectiveREOP ───────────────────────────────────
// VBA:
//   Private Function SingleToEffectiveREOP(rSingle As Double) As Double
//       SingleToEffectiveREOP = 2# * rSingle - 1#
//   End Function
export function singleToEffectiveREOP(rSingle) {
  return 2 * rSingle - 1;
}

// ── modRiskBackend › EffectiveToSingleREOP ───────────────────────────────────
// VBA:
//   Private Function EffectiveToSingleREOP(rEff As Double) As Double
//       EffectiveToSingleREOP = 0.5 * (rEff + 1#)
//   End Function
export function effectiveToSingleREOP(rEff) {
  return 0.5 * (rEff + 1);
}

/* -----------------------------------------------------------------------------
 * Recommendation candidate + solver: two-sided
 * -------------------------------------------------------------------------- */

// ── modRiskBackend › BuildRecommendationCandidate_DS ─────────────────────────
// VBA:
//   Private Function BuildRecommendationCandidate_DS(TUR_in, TUR_solve, reqAdjREOP, g, mu, LTL, UTL, XCAL, _
//                                                    ByRef recREOP, ByRef GB_L, ByRef GB_H, ByRef r) As Boolean
//       Dim sc_in, sc_solve, maxAdjREOP, sobs_in, su, so_ref, muObs As Double
//       On Error GoTo fail
//       muObs = mu + XCAL
//       GuardbandFromRatio LTL, UTL, g, GB_L, GB_H
//       If Not (reqAdjREOP > 0# And reqAdjREOP < 1#) Then BuildRecommendationCandidate_DS = False : Exit Function
//       If Not (LTL < muObs And muObs < UTL) Then BuildRecommendationCandidate_DS = False : Exit Function
//       sc_in = SigmaCAL_FromTUR(TUR_in)
//       sc_solve = SigmaCAL_FromTUR(TUR_solve)
//       If Not (GB_L < muObs And muObs < GB_H) Then BuildRecommendationCandidate_DS = False : Exit Function
//       maxAdjREOP = ProbBetween(GB_L, GB_H, muObs, sc_in)
//       If reqAdjREOP > maxAdjREOP + EPS Then BuildRecommendationCandidate_DS = False : Exit Function
//       If maxAdjREOP - reqAdjREOP <= EPS Then
//           su = 0# : so_ref = sc_solve : recREOP = ProbBetween(LTL, UTL, muObs, so_ref)
//       Else
//           sobs_in = SigmaFromArea(GB_L, GB_H, muObs, reqAdjREOP)
//           If sobs_in < sc_in Then sobs_in = sc_in
//           su = Sqr(Application.Max(0#, sobs_in ^ 2 - sc_in ^ 2))
//           so_ref = Sqr(su ^ 2 + sc_solve ^ 2)
//           recREOP = ProbBetween(LTL, UTL, muObs, so_ref)
//       End If
//       r = EvaluateCase_DS(TUR_in, recREOP, TUR_solve, GB_L, GB_H, mu, LTL, UTL, XCAL)
//       If Not r.OK Then BuildRecommendationCandidate_DS = False : Exit Function
//       BuildRecommendationCandidate_DS = True
//       Exit Function
//   fail:
//       BuildRecommendationCandidate_DS = False
//   End Function
// Returns { ok, recREOP, GB_L, GB_H, r } (the VBA by-ref outputs).
export function buildRecommendationCandidateDS(TUR_in, TUR_solve, reqAdjREOP, g, mu, LTL, UTL, XCAL) {
  try {
    const muObs = mu + XCAL;

    const { GB_L, GB_H } = guardbandFromRatio(LTL, UTL, g);

    if (!(reqAdjREOP > 0 && reqAdjREOP < 1)) return { ok: false };
    if (!(LTL < muObs && muObs < UTL)) return { ok: false };

    const sc_in = sigmaCalFromTUR(TUR_in);
    const sc_solve = sigmaCalFromTUR(TUR_solve);

    if (!(GB_L < muObs && muObs < GB_H)) return { ok: false };

    const maxAdjREOP = probBetween(GB_L, GB_H, muObs, sc_in);

    if (reqAdjREOP > maxAdjREOP + EPS) return { ok: false };

    let recREOP;
    if (maxAdjREOP - reqAdjREOP <= EPS) {
      const so_ref = sc_solve;
      recREOP = probBetween(LTL, UTL, muObs, so_ref);
    } else {
      let sobs_in = sigmaFromArea(GB_L, GB_H, muObs, reqAdjREOP);
      if (sobs_in < sc_in) sobs_in = sc_in;

      const su = Math.sqrt(Math.max(0, sobs_in ** 2 - sc_in ** 2));
      const so_ref = Math.sqrt(su ** 2 + sc_solve ** 2);
      recREOP = probBetween(LTL, UTL, muObs, so_ref);
    }

    const r = evaluateCaseDS(TUR_in, recREOP, TUR_solve, GB_L, GB_H, mu, LTL, UTL, XCAL);
    if (!r.OK) return { ok: false };

    return { ok: true, recREOP, GB_L, GB_H, r };
  } catch (e) {
    return { ok: false };
  }
}

// ── modRiskBackend › RecommendMitigation_DS ──────────────────────────────────
// VBA (structure preserved exactly; see modRiskBackend.bas lines ~1128-1263):
//   Private Function RecommendMitigation_DS(TUR_in, REOP_current, TUR_solve, GB_L_cur, GB_H_cur, _
//                                           mu, LTL, UTL, XCAL, reqPFA, reqAdjREOP) As RecResult
//       ' Guard: reqPFA in [0,1), reqAdjREOP in (0,1) -> "target input error"
//       ' Try g = 1. If PFA <= reqPFA + REC_TOL -> Found, recGB = 1.
//       ' Else bracket the smallest feasible g in [0,1] (80-iter bisection when
//       ' g = 0 is infeasible), require PFA <= reqPFA + REC_TOL, then tighten g
//       ' upward (80-iter) keeping the largest g that still meets PFA.
//   End Function
// REOP_current is part of the VBA signature but unused in the body; kept for a
// 1:1 signature match with the workbook.
export function recommendMitigationDS(TUR_in, REOP_current, TUR_solve, GB_L_cur, GB_H_cur, mu, LTL, UTL, XCAL, reqPFA, reqAdjREOP) {
  const RR = newRecResult();
  RR.Active = true;

  if (!(reqPFA >= 0 && reqPFA < 1)) {
    RR.Status = "target input error";
    return RR;
  }

  if (!(reqAdjREOP > 0 && reqAdjREOP < 1)) {
    RR.Status = "target input error";
    return RR;
  }

  // First try g = 1 (acceptance == tolerance, no guard band).
  let cand = buildRecommendationCandidateDS(TUR_in, TUR_solve, reqAdjREOP, 1, mu, LTL, UTL, XCAL);
  if (!cand.ok) {
    RR.Status = "solution not found";
    return RR;
  }

  if (cand.r.pPFA <= reqPFA + REC_TOL) {
    RR.Found = true;
    RR.recREOP = cand.recREOP;
    RR.recGB = 1;
    RR.pObs = cand.r.pObs;
    RR.pPFA = cand.r.pPFA;
    RR.pPFR = cand.r.pPFR;
    RR.Status = "solution found"; // VBA collapses both if/else branches to this
    return RR;
  }

  let gLow = 0;
  let gHigh = 1;

  cand = buildRecommendationCandidateDS(TUR_in, TUR_solve, reqAdjREOP, gLow, mu, LTL, UTL, XCAL);
  if (!cand.ok) {
    // Bisect to find the smallest guard-band ratio that yields a valid candidate.
    for (let i = 1; i <= 80; i++) {
      const gMid = 0.5 * (gLow + gHigh);
      const c = buildRecommendationCandidateDS(TUR_in, TUR_solve, reqAdjREOP, gMid, mu, LTL, UTL, XCAL);
      if (c.ok) {
        gHigh = gMid;
      } else {
        gLow = gMid;
      }
    }

    gLow = gHigh;

    cand = buildRecommendationCandidateDS(TUR_in, TUR_solve, reqAdjREOP, gLow, mu, LTL, UTL, XCAL);
    if (!cand.ok) {
      RR.Status = "solution not found";
      return RR;
    }
  }

  if (cand.r.pPFA > reqPFA + REC_TOL) {
    RR.Status = "solution not found";
    return RR;
  }

  let bestGB = gLow;
  let bestREOP = cand.recREOP;
  let Rbest = cand.r;

  gHigh = 1;

  // Tighten: keep the largest g that still meets the PFA target.
  for (let i = 1; i <= 80; i++) {
    const gMid = 0.5 * (bestGB + gHigh);
    const c = buildRecommendationCandidateDS(TUR_in, TUR_solve, reqAdjREOP, gMid, mu, LTL, UTL, XCAL);
    if (c.ok) {
      if (c.r.pPFA <= reqPFA + REC_TOL) {
        bestGB = gMid;
        bestREOP = c.recREOP;
        Rbest = c.r;
      } else {
        gHigh = gMid;
      }
    } else {
      gHigh = gMid;
    }
  }

  RR.Found = true;
  RR.recREOP = bestREOP;
  RR.recGB = bestGB;
  RR.pObs = Rbest.pObs;
  RR.pPFA = Rbest.pPFA;
  RR.pPFR = Rbest.pPFR;
  RR.Status = "solution found";
  return RR;
}

/* -----------------------------------------------------------------------------
 * Recommendation candidate + solver: true single-sided
 * -------------------------------------------------------------------------- */

// ── modRiskBackend › BuildRecommendationCandidate_SS ─────────────────────────
// VBA:
//   Private Function BuildRecommendationCandidate_SS(TUR_in, TUR_solve, reqAdjREOP_single, g, activeUUT, mode, _
//                                                    mu, XCAL, ByRef recREOP_single, ByRef activeGB, ByRef r) As Boolean
//       On Error GoTo fail
//       muObs = mu + XCAL
//       If Not (reqAdjREOP_single > 0# And reqAdjREOP_single < 1#) Then ... = False : Exit Function
//       If mode <> MODE_SS_UPPER And mode <> MODE_SS_LOWER Then ... = False : Exit Function
//       If Not (g >= 0# And g <= 1#) Then ... = False : Exit Function
//       activeGB = g * activeUUT
//       sc_in = SigmaCAL_FromTUR(TUR_in) : sc_solve = SigmaCAL_FromTUR(TUR_solve)
//       sobs_in = SolveSigmaObsSingle(activeGB, mode, muObs, reqAdjREOP_single, sc_in)
//       If sobs_in < sc_in Then sobs_in = sc_in
//       su = Sqr(Application.Max(0#, sobs_in ^ 2 - sc_in ^ 2))
//       so_ref = Sqr(su ^ 2 + sc_solve ^ 2)
//       recREOP_single = ProbSinglePass(activeUUT, mode, muObs, so_ref)
//       r = EvaluateCase_SS(TUR_in, recREOP_single, TUR_solve, activeGB, activeUUT, mode, mu, XCAL)
//       If Not r.OK Then ... = False : Exit Function
//       BuildRecommendationCandidate_SS = True
//   fail:
//       BuildRecommendationCandidate_SS = False
//   End Function
// Returns { ok, recREOP_single, activeGB, r }.
export function buildRecommendationCandidateSS(TUR_in, TUR_solve, reqAdjREOP_single, g, activeUUT, mode, mu, XCAL) {
  try {
    const muObs = mu + XCAL;

    if (!(reqAdjREOP_single > 0 && reqAdjREOP_single < 1)) return { ok: false };
    if (mode !== MODE_SS_UPPER && mode !== MODE_SS_LOWER) return { ok: false };
    if (!(g >= 0 && g <= 1)) return { ok: false };

    // Keeps the worksheet convention: upper limit positive, lower negative,
    // GB ratio scales the active limit toward zero.
    const activeGB = g * activeUUT;

    const sc_in = sigmaCalFromTUR(TUR_in);
    const sc_solve = sigmaCalFromTUR(TUR_solve);

    let sobs_in = solveSigmaObsSingle(activeGB, mode, muObs, reqAdjREOP_single, sc_in);
    if (sobs_in < sc_in) sobs_in = sc_in;

    const su = Math.sqrt(Math.max(0, sobs_in ** 2 - sc_in ** 2));
    const so_ref = Math.sqrt(su ** 2 + sc_solve ** 2);
    const recREOP_single = probSinglePass(activeUUT, mode, muObs, so_ref);

    const r = evaluateCaseSS(TUR_in, recREOP_single, TUR_solve, activeGB, activeUUT, mode, mu, XCAL);
    if (!r.OK) return { ok: false };

    return { ok: true, recREOP_single, activeGB, r };
  } catch (e) {
    return { ok: false };
  }
}

// ── modRiskBackend › RecommendMitigation_SS ──────────────────────────────────
// VBA (structure preserved exactly; see modRiskBackend.bas lines ~1332-1453).
// Same two-stage guard-band search as the DS solver, but single-sided. Note the
// SS solver keeps the workbook's special status text on the exact-g=1 branch.
// REOP_current_single is in the signature but unused in the body.
export function recommendMitigationSS(TUR_in, REOP_current_single, TUR_solve, activeGB_cur, activeUUT, mode, mu, XCAL, reqPFA_single, reqAdjREOP_single) {
  const RR = newRecResult();
  RR.Active = true;

  try {
    if (TUR_in <= 0) throw _FAIL;
    if (TUR_solve <= 0) throw _FAIL;
    if (mode !== MODE_SS_UPPER && mode !== MODE_SS_LOWER) throw _FAIL;

    if (!(reqAdjREOP_single > 0 && reqAdjREOP_single < 1)) throw _FAIL;
    if (!(reqPFA_single >= 0 && reqPFA_single < 1)) throw _FAIL;

    let cand = buildRecommendationCandidateSS(TUR_in, TUR_solve, reqAdjREOP_single, 1, activeUUT, mode, mu, XCAL);
    if (!cand.ok) {
      RR.Status = "solution not found";
      return RR;
    }

    if (cand.r.pPFA <= reqPFA_single + REC_TOL) {
      RR.Found = true;
      RR.recREOP = cand.recREOP_single;
      RR.recGB = 1;
      RR.pObs = cand.r.pObs;
      RR.pPFA = cand.r.pPFA;
      RR.pPFR = cand.r.pPFR;

      if (Math.abs(cand.r.pPFA - reqPFA_single) <= 0.0001) {
        RR.Status = "solution found";
      } else {
        RR.Status = "GB + interval solution. REOP met exactly; PFA falls below target.";
      }

      return RR;
    }

    let gLow = 0;
    let gHigh = 1;

    cand = buildRecommendationCandidateSS(TUR_in, TUR_solve, reqAdjREOP_single, gLow, activeUUT, mode, mu, XCAL);
    if (!cand.ok) {
      for (let i = 1; i <= 80; i++) {
        const gMid = 0.5 * (gLow + gHigh);
        const c = buildRecommendationCandidateSS(TUR_in, TUR_solve, reqAdjREOP_single, gMid, activeUUT, mode, mu, XCAL);
        if (c.ok) {
          gHigh = gMid;
        } else {
          gLow = gMid;
        }
      }

      gLow = gHigh;

      cand = buildRecommendationCandidateSS(TUR_in, TUR_solve, reqAdjREOP_single, gLow, activeUUT, mode, mu, XCAL);
      if (!cand.ok) {
        RR.Status = "solution not found";
        return RR;
      }
    }

    if (cand.r.pPFA > reqPFA_single + REC_TOL) {
      RR.Status = "solution not found";
      return RR;
    }

    let bestGB = gLow;
    let bestREOP = cand.recREOP_single;
    let Rbest = cand.r;

    gHigh = 1;

    for (let i = 1; i <= 80; i++) {
      const gMid = 0.5 * (bestGB + gHigh);
      const c = buildRecommendationCandidateSS(TUR_in, TUR_solve, reqAdjREOP_single, gMid, activeUUT, mode, mu, XCAL);
      if (c.ok) {
        if (c.r.pPFA <= reqPFA_single + REC_TOL) {
          bestGB = gMid;
          bestREOP = c.recREOP_single;
          Rbest = c.r;
        } else {
          gHigh = gMid;
        }
      } else {
        gHigh = gMid;
      }
    }

    RR.Found = true;
    RR.recREOP = bestREOP;
    RR.recGB = bestGB;
    RR.pObs = Rbest.pObs;
    RR.pPFA = Rbest.pPFA;
    RR.pPFR = Rbest.pPFR;
    RR.Status = "solution found";
    return RR;
  } catch (e) {
    RR.Found = false;
    RR.Status = "target input error";
    return RR;
  }
}

/* -----------------------------------------------------------------------------
 * REOP-only mitigation solver
 * Finds the minimum REOP target, with the current GB unchanged, such that
 * adjusted REOP >= target and PFA <= target.
 * -------------------------------------------------------------------------- */

// ── modRiskBackend › RiskTargetsMet ──────────────────────────────────────────
// VBA:
//   Private Function RiskTargetsMet(r As RiskResult, reqPFA As Double, reqAdjREOP As Double) As Boolean
//       If Not r.OK Then RiskTargetsMet = False
//       ElseIf r.pObs >= reqAdjREOP - REC_TOL And r.pPFA <= reqPFA + REC_TOL Then RiskTargetsMet = True
//       Else RiskTargetsMet = False
//       End If
//   End Function
export function riskTargetsMet(r, reqPFA, reqAdjREOP) {
  if (!r.OK) return false;
  if (r.pObs >= reqAdjREOP - REC_TOL && r.pPFA <= reqPFA + REC_TOL) return true;
  return false;
}

// ── modRiskBackend › RecommendREOPOnly_DS ────────────────────────────────────
// VBA (see modRiskBackend.bas lines ~1470-1555):
//   Private Function RecommendREOPOnly_DS(TUR_in, REOP_current, TUR_solve, GB_L_cur, GB_H_cur, _
//                                         mu, LTL, UTL, XCAL, reqPFA, reqAdjREOP) As RecResult
//       ' Hold the current GB fixed. Bracket REOP in (1e-9, maxREOP_solve]; if
//       ' the top of the range fails the targets -> "solution not found".
//       ' 90-iter bisection for the minimum REOP meeting both targets. If the
//       ' current REOP already complies, flag AlreadyCompliant.
//   End Function
export function recommendREOPOnlyDS(TUR_in, REOP_current, TUR_solve, GB_L_cur, GB_H_cur, mu, LTL, UTL, XCAL, reqPFA, reqAdjREOP) {
  const RR = newRecResult();
  RR.Active = true;

  try {
    if (!(reqPFA >= 0 && reqPFA < 1)) throw _FAIL;
    if (!(reqAdjREOP > 0 && reqAdjREOP < 1)) throw _FAIL;
    if (!(REOP_current > 0 && REOP_current < 1)) throw _FAIL;

    const Rcur = evaluateCaseDS(TUR_in, REOP_current, TUR_solve, GB_L_cur, GB_H_cur, mu, LTL, UTL, XCAL);
    if (!Rcur.OK) throw _FAIL;

    let hi = Rcur.maxREOP_solve;
    hi = Math.min(Math.max(hi, 0.000000001), 0.999999999);

    const Rhi = evaluateCaseDS(TUR_in, hi, TUR_solve, GB_L_cur, GB_H_cur, mu, LTL, UTL, XCAL);
    if (!riskTargetsMet(Rhi, reqPFA, reqAdjREOP)) {
      RR.Found = false;
      RR.Status = "solution not found";
      return RR;
    }

    let lo = 0.000000001;
    const Rlo = evaluateCaseDS(TUR_in, lo, TUR_solve, GB_L_cur, GB_H_cur, mu, LTL, UTL, XCAL);

    if (riskTargetsMet(Rlo, reqPFA, reqAdjREOP)) {
      RR.Found = true;
      RR.recREOP = lo;
      RR.pObs = Rlo.pObs;
      RR.pPFA = Rlo.pPFA;
      RR.pPFR = Rlo.pPFR;
      RR.Status = "solution found";
      return RR;
    }

    let Rbest = Rhi;

    for (let i = 1; i <= 90; i++) {
      const mid = 0.5 * (lo + hi);
      const Rmid = evaluateCaseDS(TUR_in, mid, TUR_solve, GB_L_cur, GB_H_cur, mu, LTL, UTL, XCAL);

      if (riskTargetsMet(Rmid, reqPFA, reqAdjREOP)) {
        hi = mid;
        Rbest = Rmid;
      } else {
        lo = mid;
      }
    }

    RR.Found = true;
    RR.recREOP = hi;
    RR.pObs = Rbest.pObs;
    RR.pPFA = Rbest.pPFA;
    RR.pPFR = Rbest.pPFR;

    if (riskTargetsMet(Rcur, reqPFA, reqAdjREOP)) {
      RR.AlreadyCompliant = true;
      RR.Status = "solution found; current inputs already compliant";
    } else {
      RR.Status = "solution found";
    }

    return RR;
  } catch (e) {
    RR.Found = false;
    RR.Status = "input error";
    return RR;
  }
}

// ── modRiskBackend › RecommendREOPOnly_SS ────────────────────────────────────
// VBA (see modRiskBackend.bas lines ~1557-1651). Single-sided analogue: the
// REOP search range is bounded by Min/MaxAchievableSinglePass, and the low end
// is nudged off the exact one-sided 50% asymptote.
export function recommendREOPOnlySS(TUR_in, REOP_current, TUR_solve, activeGB, activeUUT, mode, mu, XCAL, reqPFA, reqAdjREOP) {
  const RR = newRecResult();
  RR.Active = true;

  try {
    if (!(reqPFA >= 0 && reqPFA < 1)) throw _FAIL;
    if (!(reqAdjREOP > 0 && reqAdjREOP < 1)) throw _FAIL;
    if (!(REOP_current > 0 && REOP_current < 1)) throw _FAIL;

    const Rcur = evaluateCaseSS(TUR_in, REOP_current, TUR_solve, activeGB, activeUUT, mode, mu, XCAL);
    if (!Rcur.OK) throw _FAIL;

    const muObs = mu + XCAL;
    const minFeasible = minAchievableSinglePass(activeUUT, mode, muObs, Rcur.sc_solve);
    const maxFeasible = maxAchievableSinglePass(activeUUT, mode, muObs, Rcur.sc_solve);

    let lo = Math.max(minFeasible, 0.000000001);
    let hi = Math.min(maxFeasible, 0.999999999);

    if (hi <= lo) throw _FAIL;

    const Rhi = evaluateCaseSS(TUR_in, hi, TUR_solve, activeGB, activeUUT, mode, mu, XCAL);
    if (!riskTargetsMet(Rhi, reqPFA, reqAdjREOP)) {
      RR.Found = false;
      RR.Status = "solution not found";
      return RR;
    }

    // Avoid exact one-sided 50% when it is only an asymptotic solution.
    if (Math.abs(lo - 0.5) < 0.000000001) lo = lo + 0.000000001;

    let Rmid = evaluateCaseSS(TUR_in, lo, TUR_solve, activeGB, activeUUT, mode, mu, XCAL);
    if (riskTargetsMet(Rmid, reqPFA, reqAdjREOP)) {
      RR.Found = true;
      RR.recREOP = lo;
      RR.pObs = Rmid.pObs;
      RR.pPFA = Rmid.pPFA;
      RR.pPFR = Rmid.pPFR;
      RR.Status = "solution found";
      return RR;
    }

    let Rbest = Rhi;

    for (let i = 1; i <= 90; i++) {
      const mid = 0.5 * (lo + hi);
      Rmid = evaluateCaseSS(TUR_in, mid, TUR_solve, activeGB, activeUUT, mode, mu, XCAL);

      if (riskTargetsMet(Rmid, reqPFA, reqAdjREOP)) {
        hi = mid;
        Rbest = Rmid;
      } else {
        lo = mid;
      }
    }

    RR.Found = true;
    RR.recREOP = hi;
    RR.pObs = Rbest.pObs;
    RR.pPFA = Rbest.pPFA;
    RR.pPFR = Rbest.pPFR;

    if (riskTargetsMet(Rcur, reqPFA, reqAdjREOP)) {
      RR.AlreadyCompliant = true;
      RR.Status = "solution found; current inputs already compliant";
    } else {
      RR.Status = "solution found";
    }

    return RR;
  } catch (e) {
    RR.Found = false;
    RR.Status = "input error";
    return RR;
  }
}

/* -----------------------------------------------------------------------------
 * Interval-decay models (E1/E2/D/W1/W2)
 * Each pure computation returns { ok, newInterval, issue } mirroring the VBA
 * ByRef (newInterval, issueText) + Boolean return.
 * -------------------------------------------------------------------------- */

// ── modRiskBackend › ComputeLogInterval ──────────────────────────────────────
// VBA:
//   Private Function ComputeLogInterval(originalInterval, originalR, newTargetR, ByRef newInterval, ByRef issueText) As Boolean
//       If originalInterval <= 0# Then issueText = "interval input error" : ComputeLogInterval = False : Exit Function
//       If Not (originalR > 0# And originalR < 1#) Then issueText = "original R outside (0,1)" : ... = False : Exit Function
//       If Not (newTargetR > 0# And newTargetR < 1#) Then issueText = "target R outside (0,1)" : ... = False : Exit Function
//       If Abs(Log(originalR)) < EPS Then issueText = "original R outside (0,1)" : ... = False : Exit Function
//       newInterval = originalInterval * Log(newTargetR) / Log(originalR)
//       If newInterval <= 0# Then issueText = "interval result error" : ... = False Else issueText = "" : ... = True
//   End Function
// Log() is VBA natural log. This is the E1/E2 model (exponential reliability decay).
export function computeLogInterval(originalInterval, originalR, newTargetR) {
  if (originalInterval <= 0) return { ok: false, issue: "interval input error" };
  if (!(originalR > 0 && originalR < 1)) return { ok: false, issue: "original R outside (0,1)" };
  if (!(newTargetR > 0 && newTargetR < 1)) return { ok: false, issue: "target R outside (0,1)" };
  if (Math.abs(Math.log(originalR)) < EPS) return { ok: false, issue: "original R outside (0,1)" };

  const newInterval = originalInterval * Math.log(newTargetR) / Math.log(originalR);

  if (newInterval <= 0) return { ok: false, issue: "interval result error" };
  return { ok: true, newInterval, issue: "" };
}

// ── modRiskBackend › ComputeWeibullInterval ──────────────────────────────────
// VBA:
//   Private Function ComputeWeibullInterval(originalInterval, originalR, newTargetR, betaValue, ByRef newInterval, ByRef issueText) As Boolean
//       ' guards: originalInterval > 0, originalR in (0,1), newTargetR in (0,1), betaValue > 0, |Log(originalR)| >= EPS
//       ratio = Log(newTargetR) / Log(originalR)
//       If ratio <= 0# Then issueText = "interval result error" : ... = False : Exit Function
//       newInterval = originalInterval * (ratio ^ (1# / betaValue))
//       If newInterval <= 0# Then ... = False Else ... = True
//   End Function
export function computeWeibullInterval(originalInterval, originalR, newTargetR, betaValue) {
  if (originalInterval <= 0) return { ok: false, issue: "interval input error" };
  if (!(originalR > 0 && originalR < 1)) return { ok: false, issue: "original R outside (0,1)" };
  if (!(newTargetR > 0 && newTargetR < 1)) return { ok: false, issue: "target R outside (0,1)" };
  if (betaValue <= 0) return { ok: false, issue: "beta input error" };
  if (Math.abs(Math.log(originalR)) < EPS) return { ok: false, issue: "original R outside (0,1)" };

  const ratio = Math.log(newTargetR) / Math.log(originalR);
  if (ratio <= 0) return { ok: false, issue: "interval result error" };

  const newInterval = originalInterval * ratio ** (1 / betaValue);

  if (newInterval <= 0) return { ok: false, issue: "interval result error" };
  return { ok: true, newInterval, issue: "" };
}

// ── modRiskBackend › ComputeDiffusionInterval ────────────────────────────────
// VBA:
//   Private Function ComputeDiffusionInterval(originalInterval, sigmaOriginal, sigmaTarget, ByRef newInterval, ByRef issueText) As Boolean
//       If originalInterval <= 0# Then issueText = "interval input error" : ... = False : Exit Function
//       If sigmaOriginal <= 0# Then issueText = "diffusion sigma error" : ... = False : Exit Function
//       If sigmaTarget < 0# Then issueText = "diffusion sigma error" : ... = False : Exit Function
//       newInterval = originalInterval * (sigmaTarget ^ 2) / (sigmaOriginal ^ 2)
//       If newInterval < 0# Then issueText = "interval result error" : ... = False Else issueText = "" : ... = True
//   End Function
// The D model: interval scales with the variance (sigma^2) ratio. sigma here is
// the UUT population sigma (RiskResult.su) at base vs final risk.
export function computeDiffusionInterval(originalInterval, sigmaOriginal, sigmaTarget) {
  if (originalInterval <= 0) return { ok: false, issue: "interval input error" };
  if (sigmaOriginal <= 0) return { ok: false, issue: "diffusion sigma error" };
  if (sigmaTarget < 0) return { ok: false, issue: "diffusion sigma error" };

  const newInterval = originalInterval * sigmaTarget ** 2 / sigmaOriginal ** 2;

  if (newInterval < 0) return { ok: false, issue: "interval result error" };
  return { ok: true, newInterval, issue: "" };
}

// ── modRiskBackend › ActualReferenceREOPForInterval ──────────────────────────
// VBA:
//   Private Function ActualReferenceREOPForInterval(ByVal inputREOP As Double, ByRef RBase As RiskResult) As Double
//       If RBase.reopMet Then ActualReferenceREOPForInterval = inputREOP
//       Else ActualReferenceREOPForInterval = RBase.maxREOP_solve
//       End If
//   End Function
export function actualReferenceREOPForInterval(inputREOP, RBase) {
  return RBase.reopMet ? inputREOP : RBase.maxREOP_solve;
}

// ── modRiskBackend › GetRPairForInterval ─────────────────────────────────────
// VBA:
//   Private Sub GetRPairForInterval(modelCode As String, ByRef RBase As RiskResult, ByRef RFinal As RiskResult, _
//                                   originalReferenceREOP As Double, targetReferenceREOP As Double, _
//                                   ByRef originalR As Double, ByRef newTargetR As Double)
//       Select Case modelCode
//           Case "E2", "W2"
//               originalR = RBase.pTrue : newTargetR = RFinal.pTrue
//           Case Else
//               originalR = RBase.pObs : newTargetR = RFinal.pObs
//       End Select
//   End Sub
// E2/W2 decay on the TRUE (population-in-tolerance) reliability; E1/W1 decay on
// the OBSERVED (accepted) reliability. originalReferenceREOP/targetReferenceREOP
// are in the VBA signature but unused by the body; returns { originalR, newTargetR }.
export function getRPairForInterval(modelCode, RBase, RFinal, originalReferenceREOP, targetReferenceREOP) {
  switch (modelCode) {
    case "E2":
    case "W2":
      return { originalR: RBase.pTrue, newTargetR: RFinal.pTrue };
    default:
      return { originalR: RBase.pObs, newTargetR: RFinal.pObs };
  }
}

// ── modRiskBackend › ReadIntervalDecayModel (validation half) ────────────────
// VBA:
//   s = UCase$(Trim$(CStr(ws.Cells(rowNum, COL_DECAY_MODEL).Value)))
//   If Len(s) = 0 Then s = "E1"
//   Select Case s
//       Case "E1", "E2", "D", "W1", "W2"
//           modelCode = s : issueText = "" : ReadIntervalDecayModel = True
//       Case Else
//           modelCode = "" : issueText = "interval model error" : ReadIntervalDecayModel = False
//   End Select
// The worksheet-read half lives in the row driver (Phase 3); this is the pure
// normalize/validate half. Blank -> E1 (the workbook default).
export function validateDecayModel(raw) {
  let s = String(raw ?? "").trim().toUpperCase();
  if (s.length === 0) s = "E1";

  switch (s) {
    case "E1":
    case "E2":
    case "D":
    case "W1":
    case "W2":
      return { ok: true, modelCode: s, issue: "" };
    default:
      return { ok: false, modelCode: "", issue: "interval model error" };
  }
}

// ── modRiskBackend › WriteIntervalFromFinalRisk (pure decision half) ─────────
// VBA (see modRiskBackend.bas lines ~2188-2244). The workbook version writes the
// interval and status into cells; this pure port reproduces the SAME decision
// tree and returns { ok, interval, issue } for the row driver (Phase 3) to
// place. modelOK/intervalInputOK/betaOK plus their issue strings mirror the VBA
// ByVal flags produced by ReadIntervalDecayModel / ReadOriginalInterval /
// ReadWeibullBeta. originalReferenceREOP/targetReferenceREOP are passed through
// to GetRPairForInterval to match the VBA signature (unused there).
export function intervalFromFinalRisk(
  modelCode,
  modelOK,
  modelIssue,
  intervalInputOK,
  originalInterval,
  intervalIssue,
  betaOK,
  betaValue,
  betaIssue,
  originalReferenceREOP,
  targetReferenceREOP,
  RBase,
  RFinal
) {
  if (!modelOK) return { ok: false, issue: modelIssue };
  if (!intervalInputOK) return { ok: false, issue: intervalIssue };
  if (!RFinal.OK) return { ok: false, issue: "interval recompute error" };

  if (modelCode === "D") {
    const res = computeDiffusionInterval(originalInterval, RBase.su, RFinal.su);
    return res.ok
      ? { ok: true, interval: res.newInterval, issue: "" }
      : { ok: false, issue: res.issue };
  }

  const { originalR, newTargetR } = getRPairForInterval(
    modelCode,
    RBase,
    RFinal,
    originalReferenceREOP,
    targetReferenceREOP
  );

  if (modelCode === "W1" || modelCode === "W2") {
    if (!betaOK) return { ok: false, issue: betaIssue };
    const res = computeWeibullInterval(originalInterval, originalR, newTargetR, betaValue);
    return res.ok
      ? { ok: true, interval: res.newInterval, issue: "" }
      : { ok: false, issue: res.issue };
  }

  const res = computeLogInterval(originalInterval, originalR, newTargetR);
  return res.ok
    ? { ok: true, interval: res.newInterval, issue: "" }
    : { ok: false, issue: res.issue };
}
