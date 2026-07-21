/**
 * toleranceTypes8.js — 8.0 tolerance typing, input coercion, IV/Range/Floor
 * builder, and resolution rounding.
 * =============================================================================
 * SOURCE OF TRUTH (two workbook modules; provenance marked per function):
 *   - `modRiskBackend` — the tolerance-type taxonomy (UpdateToleranceOutputs),
 *     the numeric-state helpers, and the Safe* input coercers.
 *   - `frmUUTTolerance` — the IV / Range / Floor tolerance builder and the
 *     resolution rounding helpers.
 *
 * The VBA versions read and write worksheet cells; these ports are pure —
 * doubles/strings in, plain objects out — so the row driver (computeOneRow8.js)
 * and the app bridge can place values wherever they need to. Porting rules are
 * the same as riskEngine8.js: names, constants and branch structure match the
 * workbook, VBA quoted inline.
 */

import { EPS, normalInvCDF } from "./riskEngine8";

/* =============================================================================
 * Tolerance-type constants  (modRiskBackend)
 * VBA:
 *   Private Const TOLTYPE_DS_SYM As Long = 1
 *   Private Const TOLTYPE_DS_ASYM As Long = 2
 *   Private Const TOLTYPE_SS_LOWER As Long = 3
 *   Private Const TOLTYPE_SS_UPPER As Long = 4
 *   Private Const TOLTYPE_SS_LOWER_UNKNOWN As Long = 5
 *   Private Const TOLTYPE_SS_UPPER_UNKNOWN As Long = 6
 *   Private Const SYM_CENTER_LIMIT# = 0.999
 * ========================================================================== */
export const TOLTYPE_DS_SYM = 1;
export const TOLTYPE_DS_ASYM = 2;
export const TOLTYPE_SS_LOWER = 3;
export const TOLTYPE_SS_UPPER = 4;
export const TOLTYPE_SS_LOWER_UNKNOWN = 5;
export const TOLTYPE_SS_UPPER_UNKNOWN = 6;

export const SYM_CENTER_LIMIT = 0.999;

/* =============================================================================
 * Cell-value helpers  (modRiskBackend)
 * ========================================================================== */

// ── modRiskBackend › IsBlankCell ─────────────────────────────────────────────
// VBA:
//   Private Function IsBlankCell(v As Variant) As Boolean
//       IsBlankCell = (Len(Trim$(CStr(v))) = 0)
//   End Function
// A JS `null`/`undefined`/"" (or all-whitespace) is a blank cell.
export function isBlankCell(v) {
  return String(v ?? "").trim().length === 0;
}

// ── modRiskBackend › IsNumericCell ───────────────────────────────────────────
// VBA:
//   Private Function IsNumericCell(v As Variant) As Boolean
//       IsNumericCell = (Not IsBlankCell(v) And IsNumeric(v))
//   End Function
// VBA IsNumeric accepts numeric strings ("1.5"); Number() mirrors that after the
// blank check, and we require a finite result (VBA IsNumeric rejects overflow).
export function isNumericCell(v) {
  if (isBlankCell(v)) return false;
  const n = Number(v);
  return Number.isFinite(n);
}

// ── modRiskBackend › GetNumericState ─────────────────────────────────────────
// VBA:
//   Private Function GetNumericState(ws, rowNum, colNum, ByRef outValue As Double) As Long
//       ' 0 = blank, 1 = numeric, -1 = nonblank but nonnumeric
//       v = ws.Cells(rowNum, colNum).Value
//       If IsBlankCell(v) Then GetNumericState = 0
//       ElseIf IsNumeric(v) Then outValue = CDbl(v) : GetNumericState = 1
//       Else GetNumericState = -1
//       End If
//   End Function
// Pure port returns { state, value } instead of a ByRef out-parameter.
export function getNumericState(v) {
  if (isBlankCell(v)) return { state: 0, value: 0 };
  if (isNumericCell(v)) return { state: 1, value: Number(v) };
  return { state: -1, value: 0 };
}

/* =============================================================================
 * Tolerance-type detection  (modRiskBackend › UpdateToleranceOutputs)
 * ========================================================================== */

// ── modRiskBackend › UpdateToleranceOutputs ──────────────────────────────────
// VBA (see modRiskBackend.bas lines ~254-330). Detects the tolerance type (1-6)
// from which of nominal (F), lower limit (G), upper limit (H) are numeric, and
// computes the asymmetry delta for a fully-specified double-sided tolerance:
//   delta = (upperLimit - 2*nominal + lowerLimit) / (upperLimit - lowerLimit)
// The VBA writes M (asymmetry) and N (tol type) back to the sheet and returns a
// Boolean; this pure port returns { ok, tolType, asymmetry }. On invalid input
// it returns { ok: false, tolType: "input error", asymmetry: null } to mirror
// the VBA `badInputs` branch that writes "input error" into N.
//
// asymmetry is null when the workbook would leave M blank (all-blank limits, and
// the single-sided cases); it is a number for the double-sided cases.
export function updateToleranceOutputs(nominalV, lowerV, upperV) {
  const badInputs = () => ({ ok: false, tolType: "input error", asymmetry: null });

  const sF = getNumericState(nominalV);
  const sG = getNumericState(lowerV);
  const sH = getNumericState(upperV);

  if (sF.state < 0 || sG.state < 0 || sH.state < 0) return badInputs();

  const nominal = sF.value;
  const lowerLimit = sG.value;
  const upperLimit = sH.value;

  let nNumeric = 0;
  if (sF.state === 1) nNumeric += 1;
  if (sG.state === 1) nNumeric += 1;
  if (sH.state === 1) nNumeric += 1;

  switch (nNumeric) {
    case 0:
      // VBA: N = TOLTYPE_DS_SYM (M left blank).
      return { ok: true, tolType: TOLTYPE_DS_SYM, asymmetry: null };

    case 3: {
      if (!(lowerLimit < nominal && nominal < upperLimit)) return badInputs();

      const delta = (upperLimit - 2 * nominal + lowerLimit) / (upperLimit - lowerLimit);

      if (Math.abs(delta) < EPS) {
        return { ok: true, tolType: TOLTYPE_DS_SYM, asymmetry: 0 };
      }
      if (delta > -1 && delta < 1) {
        return { ok: true, tolType: TOLTYPE_DS_ASYM, asymmetry: delta };
      }
      return badInputs();
    }

    case 2:
      if (sF.state === 1 && sG.state === 1 && sH.state === 0 && lowerLimit < nominal) {
        return { ok: true, tolType: TOLTYPE_SS_LOWER, asymmetry: null };
      }
      if (sF.state === 1 && sG.state === 0 && sH.state === 1 && upperLimit > nominal) {
        return { ok: true, tolType: TOLTYPE_SS_UPPER, asymmetry: null };
      }
      return badInputs();

    case 1:
      if (sF.state === 0 && sG.state === 0 && sH.state === 1) {
        return { ok: true, tolType: TOLTYPE_SS_UPPER_UNKNOWN, asymmetry: null };
      }
      if (sF.state === 0 && sG.state === 1 && sH.state === 0) {
        return { ok: true, tolType: TOLTYPE_SS_LOWER_UNKNOWN, asymmetry: null };
      }
      return badInputs();

    default:
      return badInputs();
  }
}

/* =============================================================================
 * Input coercers  (modRiskBackend › Safe*)
 * Each throws (VBA Err.Raise) on invalid input so the row driver's try/catch can
 * route to its bad-input branch, exactly as the worksheet macro does.
 * ========================================================================== */

// ── modRiskBackend › SafeAsymmetry ───────────────────────────────────────────
// VBA:
//   Private Function SafeAsymmetry(v As Variant) As Double
//       If Not IsNumericCell(v) Then Err.Raise 5, , "Asymmetry must be numeric."
//       d = CDbl(v)
//       If d <= -1# Or d >= 1# Then Err.Raise 5, , "Asymmetry must be greater than -1 and less than +1."
//       SafeAsymmetry = d
//   End Function
export function safeAsymmetry(v) {
  if (!isNumericCell(v)) throw new Error("Asymmetry must be numeric.");
  const d = Number(v);
  if (d <= -1 || d >= 1) throw new Error("Asymmetry must be greater than -1 and less than +1.");
  return d;
}

// ── modRiskBackend › SafeToleranceType ───────────────────────────────────────
// VBA:
//   Private Function SafeToleranceType(v As Variant) As Long
//       If Not IsNumericCell(v) Then Err.Raise 5, , "Tolerance Type must be numeric."
//       x = CDbl(v) : n = CLng(x)
//       If Abs(x - CDbl(n)) > EPS Then Err.Raise 5, , "Tolerance Type must be an integer."
//       Select Case n
//           Case 1..6: SafeToleranceType = n
//           Case Else: Err.Raise 5, , "Tolerance Type must be 1 through 6."
//       End Select
//   End Function
export function safeToleranceType(v) {
  if (!isNumericCell(v)) throw new Error("Tolerance Type must be numeric.");
  const x = Number(v);
  const n = Math.trunc(x); // CLng rounds, but the integrality check below makes trunc/round equivalent
  if (Math.abs(x - n) > EPS) throw new Error("Tolerance Type must be an integer.");

  switch (n) {
    case TOLTYPE_DS_SYM:
    case TOLTYPE_DS_ASYM:
    case TOLTYPE_SS_LOWER:
    case TOLTYPE_SS_UPPER:
    case TOLTYPE_SS_LOWER_UNKNOWN:
    case TOLTYPE_SS_UPPER_UNKNOWN:
      return n;
    default:
      throw new Error("Tolerance Type must be 1 through 6.");
  }
}

// ── modRiskBackend › SafeSingleSidedSwitch ───────────────────────────────────
// VBA:
//   Private Function SafeSingleSidedSwitch(v As Variant) As Long
//       If Not IsNumericCell(v) Then SafeSingleSidedSwitch = 0 : Exit Function
//       x = CDbl(v)
//       If Abs(x + 1#) < EPS Then SafeSingleSidedSwitch = -1
//       ElseIf Abs(x) < EPS Then SafeSingleSidedSwitch = 0
//       ElseIf Abs(x - 1#) < EPS Then SafeSingleSidedSwitch = 1
//       Else SafeSingleSidedSwitch = 0
//       End If
//   End Function
// Defined in modRiskBackend; not referenced by ComputeOneRow. Ported for a
// complete 1:1 module mapping.
export function safeSingleSidedSwitch(v) {
  if (!isNumericCell(v)) return 0;
  const x = Number(v);
  if (Math.abs(x + 1) < EPS) return -1;
  if (Math.abs(x) < EPS) return 0;
  if (Math.abs(x - 1) < EPS) return 1;
  return 0;
}

// ── modRiskBackend › SafeInitialGB ───────────────────────────────────────────
// VBA:
//   Private Function SafeInitialGB(v As Variant) As Double
//       If Not IsNumericCell(v) Then SafeInitialGB = 1# : Exit Function
//       g = CDbl(v)
//       If g < 0# Then g = 1#
//       SafeInitialGB = g
//   End Function
export function safeInitialGB(v) {
  if (!isNumericCell(v)) return 1;
  let g = Number(v);
  if (g < 0) g = 1;
  return g;
}

// ── modRiskBackend › SafeOptionalDouble ──────────────────────────────────────
// VBA:
//   Private Function SafeOptionalDouble(v As Variant, defaultValue As Double) As Double
//       If IsBlankCell(v) Then SafeOptionalDouble = defaultValue
//       ElseIf IsNumeric(v) Then SafeOptionalDouble = CDbl(v)
//       Else Err.Raise 5, , "Expected numeric input."
//       End If
//   End Function
export function safeOptionalDouble(v, defaultValue) {
  if (isBlankCell(v)) return defaultValue;
  if (isNumericCell(v)) return Number(v);
  throw new Error("Expected numeric input.");
}

/* =============================================================================
 * IV / Range / Floor tolerance builder  (frmUUTTolerance)
 * ========================================================================== */

// ── frmUUTTolerance › IVTerm ─────────────────────────────────────────────────
// VBA:
//   Private Function IVTerm(nominal As Double, x As Double, unitMode As String) As Double
//       Select Case unitMode
//           Case "percent": IVTerm = Abs(nominal) * x / 100#
//           Case "ppm":     IVTerm = Abs(nominal) * x / 1000000#
//           Case "units":   IVTerm = x
//           Case Else:      Err.Raise vbObjectError + 2001, , "Invalid IV tolerance unit mode."
//       End Select
//   End Function
// IV = "input value" term: a fraction of the reading (nominal), or an absolute.
export function ivTerm(nominal, x, unitMode) {
  switch (unitMode) {
    case "percent":
      return Math.abs(nominal) * x / 100;
    case "ppm":
      return Math.abs(nominal) * x / 1000000;
    case "units":
      return x;
    default:
      throw new Error("Invalid IV tolerance unit mode.");
  }
}

// ── frmUUTTolerance › RangeTerm ──────────────────────────────────────────────
// VBA:
//   Private Function RangeTerm(rangeValue As Double, x As Double, unitMode As String) As Double
//       Select Case unitMode
//           Case "percent": RangeTerm = Abs(rangeValue) * x / 100#
//           Case "ppm":     RangeTerm = Abs(rangeValue) * x / 1000000#
//           Case Else:      Err.Raise vbObjectError + 2002, , "Invalid range tolerance unit mode."
//       End Select
//   End Function
export function rangeTerm(rangeValue, x, unitMode) {
  switch (unitMode) {
    case "percent":
      return Math.abs(rangeValue) * x / 100;
    case "ppm":
      return Math.abs(rangeValue) * x / 1000000;
    default:
      throw new Error("Invalid range tolerance unit mode.");
  }
}

// ── frmUUTTolerance › FloorTerm ──────────────────────────────────────────────
// VBA:
//   Private Function FloorTerm(x As Double, unitMode As String) As Double
//       Select Case unitMode
//           Case "Value (microunits)": FloorTerm = x / 1000000#
//           Case "Value (milliunits)": FloorTerm = x / 1000#
//           Case "Value (units)":      FloorTerm = x
//           Case Else:                 Err.Raise vbObjectError + 2003, , "Invalid floor tolerance unit mode."
//       End Select
//   End Function
export function floorTerm(x, unitMode) {
  switch (unitMode) {
    case "Value (microunits)":
      return x / 1000000;
    case "Value (milliunits)":
      return x / 1000;
    case "Value (units)":
      return x;
    default:
      throw new Error("Invalid floor tolerance unit mode.");
  }
}

/* =============================================================================
 * Resolution rounding  (frmUUTTolerance)
 * ========================================================================== */

// ── frmUUTTolerance › IsNearInteger ──────────────────────────────────────────
// VBA:
//   Private Function IsNearInteger(q As Double, ByRef nOut As Double) As Boolean
//       nOut = Round(q, 0)
//       EPS = 0.0000000001 * Abs(q)
//       If EPS < 0.0000000001 Then EPS = 0.0000000001
//       IsNearInteger = (Abs(q - nOut) <= EPS)
//   End Function
// VBA Round is banker's rounding, but it is immaterial here: nOut is only used
// when q is within eps (~1e-10) of an integer, where all rounding modes agree.
// Returns { near, nOut }.
export function isNearInteger(q) {
  const nOut = Math.round(q);
  let eps = 0.0000000001 * Math.abs(q);
  if (eps < 0.0000000001) eps = 0.0000000001;
  return { near: Math.abs(q - nOut) <= eps, nOut };
}

// ── frmUUTTolerance › CleanResolutionValue ───────────────────────────────────
// VBA:
//   Private Function CleanResolutionValue(x As Double) As Double
//       CleanResolutionValue = CDbl(Format$(x, "0.###############"))
//   End Function
// Format "0.###############" rounds to 15 decimals and drops trailing zeros;
// Number(x.toFixed(15)) reproduces that for the magnitudes tolerances occupy.
export function cleanResolutionValue(x) {
  return Number(x.toFixed(15));
}

// ── frmUUTTolerance › RoundLimitUpToResolution ───────────────────────────────
// VBA:
//   Private Function RoundLimitUpToResolution(x As Double, res As Double) As Double
//       If res <= 0# Then RoundLimitUpToResolution = x : Exit Function
//       q = x / res
//       If IsNearInteger(q, n) Then RoundLimitUpToResolution = CleanResolutionValue(n * res)
//       Else RoundLimitUpToResolution = CleanResolutionValue((-Int(-q)) * res)
//       End If
//   End Function
// VBA Int() floors toward -infinity, so -Int(-q) = ceil(q); rounds the limit
// OUTWARD (up) to the next resolution step unless it already sits on one.
export function roundLimitUpToResolution(x, res) {
  if (res <= 0) return x;
  const q = x / res;
  const { near, nOut } = isNearInteger(q);
  if (near) return cleanResolutionValue(nOut * res);
  const ceilQ = -Math.floor(-q);
  return cleanResolutionValue(ceilQ * res);
}

// ── frmUUTTolerance › RoundLimitDownToResolution ─────────────────────────────
// VBA:
//   Private Function RoundLimitDownToResolution(x As Double, res As Double) As Double
//       If res <= 0# Then RoundLimitDownToResolution = x : Exit Function
//       q = x / res
//       If IsNearInteger(q, n) Then RoundLimitDownToResolution = CleanResolutionValue(n * res)
//       Else RoundLimitDownToResolution = CleanResolutionValue(Int(q) * res)
//       End If
//   End Function
export function roundLimitDownToResolution(x, res) {
  if (res <= 0) return x;
  const q = x / res;
  const { near, nOut } = isNearInteger(q);
  if (near) return cleanResolutionValue(nOut * res);
  return cleanResolutionValue(Math.floor(q) * res);
}

/* =============================================================================
 * Physical guard-band acceptance limits  (modRiskBackend)
 * These convert a dimensionless guard-band multiplier g (or, for types 5/6, a
 * PFA-boundary alpha) into physical acceptance limits about the nominal.
 * ========================================================================== */

// ── modRiskBackend › WritePhysicalGBFromMultiplier ───────────────────────────
// VBA (see modRiskBackend.bas lines ~1826-1866). Types 1-4:
//   GB lower = nominal - g*(nominal - lowerLimit)
//   GB upper = nominal + g*(upperLimit - nominal)
// The VBA writes AM/AN and returns a Boolean; missing nominal returns False
// silently (limits left blank), missing a needed limit routes to "check inputs".
// Pure port returns:
//   { ok: true, gbLower?, gbUpper? }              on success
//   { ok: false, checkInputs: false }             nominal missing (leave blank)
//   { ok: false, checkInputs: true, tolType }     needed limit missing/bad
export function writePhysicalGBFromMultiplier(tolType, inputs, g) {
  const { nominal, lowerLimit, upperLimit } = inputs;

  const need = (v) => isNumericCell(v);

  switch (tolType) {
    case TOLTYPE_DS_SYM:
    case TOLTYPE_DS_ASYM:
      if (!need(nominal)) return { ok: false, checkInputs: false };
      if (!need(lowerLimit) || !need(upperLimit)) return { ok: false, checkInputs: true, tolType };
      return {
        ok: true,
        gbLower: Number(nominal) - g * (Number(nominal) - Number(lowerLimit)),
        gbUpper: Number(nominal) + g * (Number(upperLimit) - Number(nominal)),
      };

    case TOLTYPE_SS_LOWER:
      if (!need(nominal)) return { ok: false, checkInputs: false };
      if (!need(lowerLimit)) return { ok: false, checkInputs: true, tolType };
      return { ok: true, gbLower: Number(nominal) - g * (Number(nominal) - Number(lowerLimit)) };

    case TOLTYPE_SS_UPPER:
      if (!need(nominal)) return { ok: false, checkInputs: false };
      if (!need(upperLimit)) return { ok: false, checkInputs: true, tolType };
      return { ok: true, gbUpper: Number(nominal) + g * (Number(upperLimit) - Number(nominal)) };

    default:
      return { ok: false, checkInputs: false };
  }
}

// ── modRiskBackend › WritePhysicalGBForUnknownMeasuredValue ──────────────────
// VBA (see modRiskBackend.bas lines ~1868-1903). Types 5/6 (single-sided,
// unknown measured value) — a PFA-only worst-case boundary method:
//   z_alpha = NormalInvCDF(alpha)          (alpha is the PFA target, in (0,0.5))
//   Type 5 (lower): GB lower = lowerLimit - U_cal * z_alpha / 1.96
//   Type 6 (upper): GB upper = upperLimit + U_cal * z_alpha / 1.96
// Requires TUR blank (this method uses U_cal directly) and U_cal > 0.
// Returns { ok, gbLower? / gbUpper? } or { ok: false, checkInputs: true, tolType }.
export function writePhysicalGBForUnknownMeasuredValue(tolType, inputs, alpha) {
  const { uCal, lowerLimit, upperLimit, turBlank } = inputs;
  const fail = { ok: false, checkInputs: true, tolType };

  if (!turBlank) return fail;
  if (!isNumericCell(uCal)) return fail;
  if (Number(uCal) <= 0) return fail;
  if (!(alpha > 0 && alpha < 0.5)) return fail;

  const zAlpha = normalInvCDF(alpha);

  switch (tolType) {
    case TOLTYPE_SS_LOWER_UNKNOWN:
      if (!isNumericCell(lowerLimit)) return fail;
      return { ok: true, gbLower: Number(lowerLimit) - Number(uCal) * zAlpha / 1.96 };

    case TOLTYPE_SS_UPPER_UNKNOWN:
      if (!isNumericCell(upperLimit)) return fail;
      return { ok: true, gbUpper: Number(upperLimit) + Number(uCal) * zAlpha / 1.96 };

    default:
      return fail;
  }
}
