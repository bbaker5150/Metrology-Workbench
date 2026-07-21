/**
 * computeOneRow8.js — pure port of modRiskBackend › ComputeOneRow
 * =============================================================================
 * SOURCE OF TRUTH: `modRiskBackend` › ComputeOneRow and its row-output helpers
 * (HandleUnknownMeasuredValue, CoreStatusText, StatusWithIssue, the interval
 * read helpers). The worksheet macro reads a fixed-column scratch row and writes
 * results back into cells; this port takes a plain inputs object and returns a
 * plain outputs object keyed by meaning, so the bridge (Phase 4) can map to/from
 * the app's data and the RISK_DATA / MAIN tables.
 *
 * The fixed-column contract (matches RB_CopyMainInputsToScratch /
 * RB_CopyScratchOutputsToMain):
 *   inputs : nominal(F) lowerLimit(G) upperLimit(H) initialGB(I) uCal(J) mu(K)
 *            xcal(L) tur(S) reop(T) turNeeded(U) originalInterval(Z)
 *            pfaTarget(AA) reopTarget(AB) decayModel(AC) weibullBeta(AD)
 *   outputs: obs(AG) pfa(AH) pfr(AI) maxReop(AJ) trueReop(AK) gbMult(AL)
 *            physGbLower(AM) physGbUpper(AN) mitPfa(AO) mitPfr(AP)
 *            gbInterval(AQ) mitReop(AR) intPfa(AS) intPfr(AT) intInterval(AU)
 *            intReop(AV) statusCore(AX) statusMit(AY) statusInt(AZ)
 *   plus the VBA-controlled tolerance outputs asymmetry(M) and tolType(N).
 *
 * Blank/cleared cells are represented by "" (empty string); flag strings like
 * "check inputs" / "input error" pass through as strings; numeric outputs are
 * numbers. Resolution snapping of the physical GB limits is intentionally NOT
 * done here — the workbook applies it in RB_ApplyResolutionToScratchGB after
 * ComputeOneRow, so it belongs to the bridge (Phase 4).
 */

import {
  MODE_TWO_SIDED,
  MODE_SS_LOWER,
  MODE_SS_UPPER,
  evaluateCaseDS,
  evaluateCaseSS,
  recommendMitigationDS,
  recommendMitigationSS,
  recommendREOPOnlyDS,
  recommendREOPOnlySS,
  actualReferenceREOPForInterval,
  validateDecayModel,
  intervalFromFinalRisk,
} from "./riskEngine8";
import {
  TOLTYPE_DS_SYM,
  TOLTYPE_DS_ASYM,
  TOLTYPE_SS_LOWER,
  TOLTYPE_SS_UPPER,
  TOLTYPE_SS_LOWER_UNKNOWN,
  TOLTYPE_SS_UPPER_UNKNOWN,
  SYM_CENTER_LIMIT,
  isBlankCell,
  isNumericCell,
  updateToleranceOutputs,
  safeToleranceType,
  safeAsymmetry,
  safeInitialGB,
  safeOptionalDouble,
  writePhysicalGBFromMultiplier,
  writePhysicalGBForUnknownMeasuredValue,
} from "./toleranceTypes8";

// Sentinel used to model the VBA `GoTo badInput` (mirrors riskEngine8's _FAIL).
const _BAD_INPUT = Symbol("ComputeOneRow.badInput");

/** All output cells cleared — the blank/empty row state. */
export function blankOutput() {
  return {
    tolType: "",
    asymmetry: "",
    obs: "",
    pfa: "",
    pfr: "",
    maxReop: "",
    trueReop: "",
    gbMult: "",
    physGbLower: "",
    physGbUpper: "",
    mitPfa: "",
    mitPfr: "",
    mitReop: "",
    gbInterval: "",
    intPfa: "",
    intPfr: "",
    intInterval: "",
    statusCore: "",
    statusMit: "",
    statusInt: "",
  };
}

// ── modRiskBackend › CoreStatusText ──────────────────────────────────────────
// VBA:
//   Private Function CoreStatusText(r As RiskResult) As String
//       If r.reopMet Then CoreStatusText = "OK" Else CoreStatusText = "input exceeds MAX REOP"
//   End Function
function coreStatusText(r) {
  return r.reopMet ? "OK" : "input exceeds MAX REOP";
}

// ── modRiskBackend › StatusWithIssue ─────────────────────────────────────────
// VBA:
//   Private Function StatusWithIssue(baseStatus As String, issueText As String) As String
//       If Len(Trim$(baseStatus)) = 0 Then StatusWithIssue = issueText
//       ElseIf Len(Trim$(issueText)) = 0 Then StatusWithIssue = baseStatus
//       Else StatusWithIssue = baseStatus & "; " & issueText
//       End If
//   End Function
function statusWithIssue(baseStatus, issueText) {
  if (String(baseStatus ?? "").trim().length === 0) return issueText;
  if (String(issueText ?? "").trim().length === 0) return baseStatus;
  return `${baseStatus}; ${issueText}`;
}

// ── modRiskBackend › ReadOriginalInterval (validation half) ──────────────────
// VBA (see modRiskBackend.bas lines ~1987-2008): blank -> "interval missing";
// non-numeric -> "interval input error"; <= 0 -> "interval input error".
function readOriginalInterval(v) {
  if (isBlankCell(v)) return { ok: false, value: 0, issue: "interval missing" };
  if (!isNumericCell(v)) return { ok: false, value: 0, issue: "interval input error" };
  const value = Number(v);
  if (value <= 0) return { ok: false, value: 0, issue: "interval input error" };
  return { ok: true, value, issue: "" };
}

// ── modRiskBackend › ReadWeibullBeta (validation half) ───────────────────────
// VBA (see modRiskBackend.bas lines ~2010-2031): blank -> "beta missing";
// non-numeric -> "beta input error"; <= 0 -> "beta input error".
function readWeibullBeta(v) {
  if (isBlankCell(v)) return { ok: false, value: 0, issue: "beta missing" };
  if (!isNumericCell(v)) return { ok: false, value: 0, issue: "beta input error" };
  const value = Number(v);
  if (value <= 0) return { ok: false, value: 0, issue: "beta input error" };
  return { ok: true, value, issue: "" };
}

// ── modRiskBackend › RowInputsBlank ──────────────────────────────────────────
// VBA (see modRiskBackend.bas lines ~1666-1684): true when every physical input
// column is blank (M/N and the calculated outputs are excluded).
function rowInputsBlank(input) {
  const cols = [
    input.nominal, input.lowerLimit, input.upperLimit, input.initialGB, input.uCal,
    input.mu, input.xcal, input.tur, input.reop, input.turNeeded,
    input.originalInterval, input.pfaTarget, input.reopTarget, input.decayModel, input.weibullBeta,
  ];
  return cols.every((v) => isBlankCell(v));
}

// ── modRiskBackend › HandleUnknownMeasuredValue ──────────────────────────────
// VBA (see modRiskBackend.bas lines ~1905-1958). Types 5/6 are a PFA-only
// worst-case boundary method: no core risk is computed, AL (gbMult) is left
// blank, and AM/AN hold the physical guard-band acceptance limit. The PFA target
// (AA) doubles as the boundary alpha and is echoed into AO (mitPfa).
function handleUnknownMeasuredValue(input, tolType, out) {
  const vPFATarget = input.pfaTarget;

  const writeCheckInputs = () => {
    if (tolType === TOLTYPE_SS_LOWER_UNKNOWN) out.physGbLower = "check inputs";
    else if (tolType === TOLTYPE_SS_UPPER_UNKNOWN) out.physGbUpper = "check inputs";
  };

  if (isBlankCell(vPFATarget) || !isNumericCell(vPFATarget)) {
    writeCheckInputs();
    out.statusMit = "PFA target missing";
    out.statusInt = "not used";
    return out;
  }

  const alpha = Number(vPFATarget);

  if (!(alpha > 0 && alpha < 0.5)) {
    writeCheckInputs();
    out.statusMit = "target input error";
    out.statusInt = "not used";
    return out;
  }

  const gb = writePhysicalGBForUnknownMeasuredValue(
    tolType,
    {
      uCal: input.uCal,
      lowerLimit: input.lowerLimit,
      upperLimit: input.upperLimit,
      turBlank: isBlankCell(input.tur),
    },
    alpha
  );

  if (!gb.ok) {
    writeCheckInputs();
    out.statusCore = "check inputs";
    out.statusMit = "check inputs";
    out.statusInt = "not used";
    return out;
  }

  if (gb.gbLower !== undefined) out.physGbLower = gb.gbLower;
  if (gb.gbUpper !== undefined) out.physGbUpper = gb.gbUpper;

  // Type 5/6 remains a PFA-only worst-case boundary method.
  out.mitPfa = alpha;
  out.statusMit = "OK";
  out.statusInt = "not used";
  return out;
}

/**
 * computeOneRow — pure port of modRiskBackend › ComputeOneRow.
 *
 * @param {object} input  fixed-column inputs (see file header for keys/columns)
 * @returns {object} outputs keyed by meaning (see blankOutput for the shape)
 */
export function computeOneRow(input) {
  const out = blankOutput();

  try {
    // RowInputsBlank -> clear tolerance + row outputs and exit.
    if (rowInputsBlank(input)) {
      return out;
    }

    // UpdateToleranceOutputs: detect tolType (N) and asymmetry (M).
    const tol = updateToleranceOutputs(input.nominal, input.lowerLimit, input.upperLimit);
    if (!tol.ok) {
      out.tolType = "input error";
      throw _BAD_INPUT;
    }
    out.tolType = tol.tolType;
    if (tol.asymmetry !== null) out.asymmetry = tol.asymmetry;

    // SafeToleranceType(N) — validates the just-written type.
    const tolType = safeToleranceType(tol.tolType);

    // Types 5/6: unknown measured value -> PFA-only boundary method.
    if (tolType === TOLTYPE_SS_LOWER_UNKNOWN || tolType === TOLTYPE_SS_UPPER_UNKNOWN) {
      return handleUnknownMeasuredValue(input, tolType, out);
    }

    // Core risk requires TUR (S) and assumed REOP (T).
    if (isBlankCell(input.tur) || isBlankCell(input.reop)) {
      out.statusCore = "missing required input";
      return out;
    }

    const TUR_in = Number(input.tur);
    const REOP_ref = Number(input.reop);
    const vTURNeeded = input.turNeeded;
    const gInit = safeInitialGB(input.initialGB);
    const mu = safeOptionalDouble(input.mu, 0);
    const XCAL = safeOptionalDouble(input.xcal, 0);

    let mode;
    let LTL;
    let UTL;
    let GB_L;
    let GB_H;
    let activeGB;
    let activeUUT;

    switch (tolType) {
      case TOLTYPE_DS_SYM:
        mode = MODE_TWO_SIDED;
        LTL = -1;
        UTL = 1;
        GB_L = -gInit;
        GB_H = gInit;
        if (Math.abs(mu + XCAL) >= SYM_CENTER_LIMIT) throw _BAD_INPUT;
        break;

      case TOLTYPE_DS_ASYM: {
        mode = MODE_TWO_SIDED;
        // VBA reads SafeAsymmetry(M); UpdateToleranceOutputs already wrote it.
        const delta = safeAsymmetry(tol.asymmetry);
        LTL = delta - 1;
        UTL = delta + 1;
        GB_L = gInit * LTL;
        GB_H = gInit * UTL;
        break;
      }

      case TOLTYPE_SS_LOWER:
        mode = MODE_SS_LOWER;
        activeUUT = -1;
        activeGB = -gInit;
        break;

      case TOLTYPE_SS_UPPER:
        mode = MODE_SS_UPPER;
        activeUUT = 1;
        activeGB = gInit;
        break;

      default:
        throw _BAD_INPUT;
    }

    // TUR needed (U): defaults to the actual TUR when blank.
    let TUR_solve;
    if (isBlankCell(vTURNeeded)) {
      TUR_solve = TUR_in;
    } else {
      TUR_solve = Number(vTURNeeded);
      if (TUR_solve <= 0) throw _BAD_INPUT;
    }

    // Core evaluation.
    let r;
    if (mode === MODE_TWO_SIDED) {
      r = evaluateCaseDS(TUR_in, REOP_ref, TUR_solve, GB_L, GB_H, mu, LTL, UTL, XCAL);
    } else {
      r = evaluateCaseSS(TUR_in, REOP_ref, TUR_solve, activeGB, activeUUT, mode, mu, XCAL);
    }

    if (!r.OK) throw _BAD_INPUT;

    out.obs = r.pObs;
    out.pfa = r.pPFA;
    out.pfr = r.pPFR;
    out.maxReop = r.maxREOP_input;
    out.trueReop = r.pTrue;
    out.statusCore = coreStatusText(r);

    // Interval read/validation (used by the interval writers below).
    const model = validateDecayModel(input.decayModel);
    const origInt = readOriginalInterval(input.originalInterval);
    const beta = readWeibullBeta(input.weibullBeta);
    const originalReferenceREOP = actualReferenceREOPForInterval(REOP_ref, r);

    // Mitigation is active only when BOTH targets are present.
    const vPFATarget = input.pfaTarget;
    const vREOPTarget = input.reopTarget;

    if (isBlankCell(vPFATarget) || isBlankCell(vREOPTarget)) {
      out.statusMit = "mitigation target missing";
      out.statusInt = "mitigation target missing";
      return out;
    }

    if (!isNumericCell(vPFATarget) || !isNumericCell(vREOPTarget)) {
      out.statusMit = "target input error";
      out.statusInt = "target input error";
      return out;
    }

    const reqPFA = Number(vPFATarget);
    const reqREOP = Number(vREOPTarget);

    // ---- GB + REOP mitigation ------------------------------------------------
    let RR;
    if (mode === MODE_TWO_SIDED) {
      RR = recommendMitigationDS(TUR_in, REOP_ref, TUR_solve, GB_L, GB_H, mu, LTL, UTL, XCAL, reqPFA, reqREOP);
    } else {
      RR = recommendMitigationSS(TUR_in, REOP_ref, TUR_solve, activeGB, activeUUT, mode, mu, XCAL, reqPFA, reqREOP);
    }

    if (RR.Found) {
      out.gbMult = RR.recGB;

      const gb = writePhysicalGBFromMultiplier(
        tolType,
        { nominal: input.nominal, lowerLimit: input.lowerLimit, upperLimit: input.upperLimit },
        RR.recGB
      );
      if (gb.ok) {
        if (gb.gbLower !== undefined) out.physGbLower = gb.gbLower;
        if (gb.gbUpper !== undefined) out.physGbUpper = gb.gbUpper;
      } else if (gb.checkInputs) {
        // Mirror WriteCheckInputsForPhysicalGB for the sides that apply.
        if (tolType === TOLTYPE_DS_SYM || tolType === TOLTYPE_DS_ASYM) {
          out.physGbLower = "check inputs";
          out.physGbUpper = "check inputs";
        } else if (tolType === TOLTYPE_SS_LOWER) {
          out.physGbLower = "check inputs";
        } else if (tolType === TOLTYPE_SS_UPPER) {
          out.physGbUpper = "check inputs";
        }
      }

      out.mitPfa = RR.pPFA;
      out.mitPfr = RR.pPFR;
      out.mitReop = RR.recREOP;
      out.statusMit = RR.Status;

      // Interval stays on the ORIGINAL/current GB curve (not the recommended GB).
      let RFinalGB;
      if (mode === MODE_TWO_SIDED) {
        RFinalGB = evaluateCaseDS(TUR_in, RR.recREOP, TUR_solve, GB_L, GB_H, mu, LTL, UTL, XCAL);
      } else {
        RFinalGB = evaluateCaseSS(TUR_in, RR.recREOP, TUR_solve, activeGB, activeUUT, mode, mu, XCAL);
      }

      const iv = intervalFromFinalRisk(
        model.modelCode, model.ok, model.issue,
        origInt.ok, origInt.value, origInt.issue,
        beta.ok, beta.value, beta.issue,
        originalReferenceREOP, RR.recREOP,
        r, RFinalGB
      );
      if (iv.ok) {
        out.gbInterval = iv.interval;
        out.statusMit = RR.Status;
      } else {
        out.gbInterval = "";
        out.statusMit = statusWithIssue(RR.Status, iv.issue);
      }
    } else {
      out.statusMit = RR.Status;
    }

    // ---- REOP-only mitigation (current GB held fixed) ------------------------
    let RR2;
    if (mode === MODE_TWO_SIDED) {
      RR2 = recommendREOPOnlyDS(TUR_in, REOP_ref, TUR_solve, GB_L, GB_H, mu, LTL, UTL, XCAL, reqPFA, reqREOP);
    } else {
      RR2 = recommendREOPOnlySS(TUR_in, REOP_ref, TUR_solve, activeGB, activeUUT, mode, mu, XCAL, reqPFA, reqREOP);
    }

    if (RR2.Found) {
      out.intPfa = RR2.pPFA;
      out.intPfr = RR2.pPFR;
      out.intReop = RR2.recREOP;
      out.statusInt = RR2.Status;

      let RFinalInt;
      if (mode === MODE_TWO_SIDED) {
        RFinalInt = evaluateCaseDS(TUR_in, RR2.recREOP, TUR_solve, GB_L, GB_H, mu, LTL, UTL, XCAL);
      } else {
        RFinalInt = evaluateCaseSS(TUR_in, RR2.recREOP, TUR_solve, activeGB, activeUUT, mode, mu, XCAL);
      }

      const iv = intervalFromFinalRisk(
        model.modelCode, model.ok, model.issue,
        origInt.ok, origInt.value, origInt.issue,
        beta.ok, beta.value, beta.issue,
        originalReferenceREOP, RR2.recREOP,
        r, RFinalInt
      );
      if (iv.ok) {
        out.intInterval = iv.interval;
        out.statusInt = RR2.Status;
      } else {
        out.intInterval = "";
        out.statusInt = statusWithIssue(RR2.Status, iv.issue);
      }
    } else {
      out.statusInt = RR2.Status;
    }

    return out;
  } catch (e) {
    // VBA badInput: clear outputs, set the three bad-input statuses. tolType (N)
    // keeps whatever UpdateToleranceOutputs wrote (e.g. "input error").
    const tolTypeSoFar = out.tolType;
    const blanked = blankOutput();
    blanked.tolType = tolTypeSoFar;
    blanked.statusCore = "bad input";
    blanked.statusMit = "solution not found";
    blanked.statusInt = "solution not found";
    return blanked;
  }
}
