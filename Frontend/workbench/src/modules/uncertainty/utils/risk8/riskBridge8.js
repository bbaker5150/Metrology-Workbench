/**
 * riskBridge8.js — front-end / back-end bridge for the 8.0 risk engine
 * =============================================================================
 * SOURCE OF TRUTH: `modRiskBackend` › the "Front-End / Back-End Bridge" section
 * (ComputeRiskForMainRow, RB_RowHasMinimumRiskInputs, RB_ApplyResolutionToScratchGB,
 * RB_CopyScratchOutputsToMain / ...ToRiskTable).
 *
 * In the workbook this layer reads a row of tblMain, copies the inputs onto a
 * hidden fixed-column scratch row, runs ComputeOneRow, snaps the physical guard-
 * band limits to the UUT's measuring resolution, then writes the outputs back to
 * tblMain and tblRisk. This module is the pure equivalent: it takes the
 * fixed-column input object (see computeOneRow8.js), applies the same minimum-
 * input gate and resolution snap, and returns the outputs both raw and keyed by
 * the workbook's MAIN/RISK column names.
 *
 * NOTE (for the reviewer): this module deliberately does NOT compute TUR or
 * normalize bias from raw app data — in the workbook those are produced by the
 * front-end tolerance/uncertainty forms and stored in tblMain before the risk
 * back-end runs. The app-side adapter that assembles this contract from a test
 * point's uncertainty budget and tolerance lives with the hook wiring (Phase 5),
 * so the normalization can be reviewed against the workbook's front end.
 */

import { blankOutput, computeOneRow } from "./computeOneRow8";
import {
  isBlankCell,
  isNumericCell,
  updateToleranceOutputs,
  TOLTYPE_DS_SYM,
  TOLTYPE_DS_ASYM,
  TOLTYPE_SS_LOWER,
  TOLTYPE_SS_UPPER,
  TOLTYPE_SS_LOWER_UNKNOWN,
  TOLTYPE_SS_UPPER_UNKNOWN,
  roundLimitUpToResolution,
  roundLimitDownToResolution,
} from "./toleranceTypes8";

/**
 * Output key -> workbook MAIN/RISK column name.
 * VBA source: RB_CopyScratchOutputsToMain / RB_CopyScratchOutputsToRiskTable.
 * The status fields (AX/AY/AZ) are internal to the scratch sheet and are not
 * copied to MAIN/RISK, so they have no column here.
 */
export const RISK8_OUTPUT_FIELD_MAP = Object.freeze({
  obs: "REOP_At_Test_TUR",
  pfa: "Test_PFA",
  pfr: "Test_PFR",
  maxReop: "Max_REOP_At_Test_TUR",
  trueReop: "True_REOP_At_Test_TUR",
  gbMult: "GB_Percent",
  physGbLower: "GB_LL",
  physGbUpper: "GB_UL",
  mitPfa: "PFA_With_GB",
  mitPfr: "PFR_With_GB",
  gbInterval: "Interval_With_GB",
  mitReop: "Target_REOP_With_GB",
  intPfa: "PFA_REOP_Only",
  intPfr: "PFR_REOP_Only",
  intInterval: "Interval_REOP_Only",
  intReop: "Target_REOP_Only",
});

// ── modRiskBackend › RB_RowHasMinimumRiskInputs ──────────────────────────────
// VBA (see modRiskBackend.bas lines ~2600-2649). Gate that decides whether a row
// is complete enough to compute; if not, the workbook clears the row's risk
// outputs and deletes its RISK record.
//
// APPROVED BETA.4 BRIDGE CORRECTION: the workbook's literal bridge requires TUR,
// Assumed_REOP, PFA_Required and REOP_Required for every type. Its dedicated
// HandleUnknownMeasuredValue path, however, requires TUR to be blank and only
// consumes ExpandedUncertainty (U_cal), the active physical limit, and the PFA
// target for types 5/6. The product owner confirmed that the intended PFA-only
// handler is authoritative. We therefore validate unknown-measurement rows
// against the inputs that handler actually uses, before applying the generic
// TUR/REOP gate to types 1-4. This is a deliberate, documented correction to
// Beta.4's unreachable MAIN-table path, not an unreviewed math change.
export function rowHasMinimumRiskInputs(input) {
  // The workbook reads MAIN.TolType (written by the tolerance form). We derive
  // the same type from the physical limits so the gate is self-contained.
  const tol = updateToleranceOutputs(input.nominal, input.lowerLimit, input.upperLimit);
  if (!tol.ok) return false;
  const t = tol.tolType;

  switch (t) {
    case TOLTYPE_DS_SYM:
    case TOLTYPE_DS_ASYM:
      if (!isNumericCell(input.nominal)) return false;
      if (!isNumericCell(input.lowerLimit)) return false;
      if (!isNumericCell(input.upperLimit)) return false;
      break;

    case TOLTYPE_SS_LOWER:
      if (!isNumericCell(input.nominal)) return false;
      if (!isNumericCell(input.lowerLimit)) return false;
      break;

    case TOLTYPE_SS_UPPER:
      if (!isNumericCell(input.nominal)) return false;
      if (!isNumericCell(input.upperLimit)) return false;
      break;

    case TOLTYPE_SS_LOWER_UNKNOWN:
      if (!isNumericCell(input.lowerLimit)) return false;
      // Unknown-measurement risk is a PFA-only acceptance-boundary method.
      // TUR must remain blank because there is no measured value from which to
      // derive it; U_cal and alpha are the only numeric risk inputs it needs.
      if (!isBlankCell(input.tur)) return false;
      if (!isNumericCell(input.uCal)) return false;
      if (!isNumericCell(input.pfaTarget)) return false;
      return true;

    case TOLTYPE_SS_UPPER_UNKNOWN:
      if (!isNumericCell(input.upperLimit)) return false;
      if (!isBlankCell(input.tur)) return false;
      if (!isNumericCell(input.uCal)) return false;
      if (!isNumericCell(input.pfaTarget)) return false;
      return true;

    default:
      return false;
  }

  // Full core-risk and mitigation inputs are required only for types 1-4.
  if (!isNumericCell(input.tur)) return false;
  if (!isNumericCell(input.reop)) return false;
  if (!isNumericCell(input.pfaTarget)) return false;
  if (!isNumericCell(input.reopTarget)) return false;

  return true;
}

// ── modRiskBackend › RB_ApplyResolutionToScratchGB ───────────────────────────
// VBA (see modRiskBackend.bas lines ~2709-2758). Snaps the physical guard-band
// acceptance limits to the UUT's measuring resolution: the lower limit rounds UP
// (inward), the upper limit rounds DOWN (inward). If the snapped limits cross,
// both are replaced with "resolution too coarse". Non-numeric GB cells (e.g.
// "check inputs") and a missing/invalid resolution are left untouched.
// Mutates and returns `out`.
export function applyResolutionToGB(out, resolution) {
  if (isBlankCell(resolution) || !isNumericCell(resolution)) return out;

  const res = Number(resolution);
  if (res <= 0) return out;

  const hasLL = isNumericCell(out.physGbLower);
  const hasUL = isNumericCell(out.physGbUpper);

  let roundedLL;
  let roundedUL;

  if (hasLL) roundedLL = roundLimitUpToResolution(Number(out.physGbLower), res);
  if (hasUL) roundedUL = roundLimitDownToResolution(Number(out.physGbUpper), res);

  if (hasLL && hasUL) {
    if (roundedLL >= roundedUL) {
      out.physGbLower = "resolution too coarse";
      out.physGbUpper = "resolution too coarse";
      return out;
    }
  }

  if (hasLL) out.physGbLower = roundedLL;
  if (hasUL) out.physGbUpper = roundedUL;

  return out;
}

/**
 * Map a computeOneRow output object to the workbook's MAIN/RISK field names.
 * Blank ("") outputs are passed through so a caller can clear the target cells.
 * VBA source: RB_CopyScratchOutputsToMain.
 */
export function toMainRiskFields(out) {
  const fields = {};
  for (const [key, colName] of Object.entries(RISK8_OUTPUT_FIELD_MAP)) {
    fields[colName] = out[key];
  }
  return fields;
}

/**
 * computeRiskRow8 — pure equivalent of ComputeRiskForMainRow.
 *
 * Applies the minimum-input gate, runs ComputeOneRow, snaps the physical guard
 * band to `resolution`, and returns both the raw output object and the
 * MAIN/RISK-named field object.
 *
 * @param {object} input        fixed-column inputs (see computeOneRow8.js)
 * @param {object} [options]
 * @param {number|string} [options.resolution]  UUT measuring resolution
 * @param {boolean} [options.enforceMinimumInputs=true]  apply the RB gate
 * @returns {{ out: object, fields: object, computed: boolean }}
 */
export function computeRiskRow8(input, options = {}) {
  const { resolution, enforceMinimumInputs = true } = options;

  if (enforceMinimumInputs && !rowHasMinimumRiskInputs(input)) {
    // VBA: RB_ClearMainRiskOutputs + DeleteRiskRecordsByID — the row is cleared.
    const cleared = blankOutput();
    return { out: cleared, fields: toMainRiskFields(cleared), computed: false };
  }

  const out = computeOneRow(input);
  applyResolutionToGB(out, resolution);

  return { out, fields: toMainRiskFields(out), computed: true };
}
