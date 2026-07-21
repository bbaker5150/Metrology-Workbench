/**
 * goldenVectors8.test.js — the workbook 1:1 harness.
 *
 * For every vector in goldenVectors8.js:
 *   - with `expected`: run the port and assert each expected field matches
 *     (numbers within the vector's tolerance, strings/blanks exactly). This is
 *     the bit-for-bit check against the workbook.
 *   - without `expected`: assert only structural sanity, so the input template
 *     is exercised until a workbook capture is pasted in.
 *
 * See goldenVectors8.js for how to capture real vectors. The `selfCapture`
 * vectors are the engine's own output (regression guards), NOT the workbook —
 * only `source: "workbook ..."` vectors constitute the 1:1 sign-off.
 */

import { describe, expect, test } from "vitest";
import { computeRiskRow8, RISK8_OUTPUT_FIELD_MAP } from "./riskBridge8";
import { GOLDEN_VECTORS } from "./goldenVectors8";

// Invert the output-key -> MAIN column map so expected vectors can be keyed by
// the RISK_DATA/MAIN column names the reviewer reads off the sheet.
const COL_TO_OUTKEY = Object.fromEntries(
  Object.entries(RISK8_OUTPUT_FIELD_MAP).map(([outKey, col]) => [col, outKey])
);
const STATUS_KEYS = new Set(["statusCore", "statusMit", "statusInt"]);

function resolveOutputValue(out, expectedKey) {
  if (expectedKey in COL_TO_OUTKEY) return out[COL_TO_OUTKEY[expectedKey]];
  if (STATUS_KEYS.has(expectedKey)) return out[expectedKey];
  if (expectedKey in out) return out[expectedKey]; // allow raw out keys too
  throw new Error(`Unknown expected field "${expectedKey}"`);
}

const PROB_KEYS = new Set([
  "REOP_At_Test_TUR", "Test_PFA", "Test_PFR", "Max_REOP_At_Test_TUR",
  "True_REOP_At_Test_TUR", "GB_Percent", "PFA_With_GB", "PFR_With_GB",
  "Target_REOP_With_GB", "PFA_REOP_Only", "PFR_REOP_Only", "Target_REOP_Only",
]);

describe("golden vectors (workbook 1:1)", () => {
  for (const v of GOLDEN_VECTORS) {
    const run = () =>
      computeRiskRow8(v.input, {
        resolution: v.resolution,
        enforceMinimumInputs: false,
      });

    if (v.expected) {
      test(`${v.name} — matches expected outputs`, () => {
        const { out } = run();
        const tol = typeof v.tol === "number" ? v.tol : 6;

        for (const [key, expectedVal] of Object.entries(v.expected)) {
          const actual = resolveOutputValue(out, key);
          if (typeof expectedVal === "number") {
            expect(typeof actual, `${key} should be numeric`).toBe("number");
            expect(actual, `${key}`).toBeCloseTo(expectedVal, tol);
          } else {
            // strings (statuses) and blanks ("") compared exactly
            expect(actual, `${key}`).toBe(expectedVal);
          }
        }
      });
    } else {
      test(`${v.name} — structural sanity (awaiting workbook capture)`, () => {
        const { out } = run();
        expect(out).toBeTruthy();
        // Probability-like outputs, when numeric, must be valid probabilities.
        for (const key of PROB_KEYS) {
          const val = resolveOutputValue(out, key);
          if (typeof val === "number") {
            expect(val, `${key} in [0,1]`).toBeGreaterThanOrEqual(0);
            expect(val, `${key} in [0,1]`).toBeLessThanOrEqual(1);
          }
        }
        // Statuses are always strings.
        for (const key of STATUS_KEYS) {
          expect(typeof out[key]).toBe("string");
        }
      });
    }
  }

  test("coverage report: workbook-sourced vs placeholder", () => {
    const workbook = GOLDEN_VECTORS.filter((v) => /^workbook/i.test(v.source || ""));
    const selfCapture = GOLDEN_VECTORS.filter((v) => v.selfCapture);
    const todo = GOLDEN_VECTORS.filter((v) => !v.expected);

    // Surfaced so a run makes the verification state obvious.
    // eslint-disable-next-line no-console
    console.log(
      `[golden vectors] workbook-sourced: ${workbook.length}, ` +
        `self-capture regression guards: ${selfCapture.length}, ` +
        `awaiting capture: ${todo.length} of ${GOLDEN_VECTORS.length} total`
    );

    // The suite is wired; real sign-off is tracked by workbook.length growing.
    expect(GOLDEN_VECTORS.length).toBeGreaterThan(0);
  });
});
