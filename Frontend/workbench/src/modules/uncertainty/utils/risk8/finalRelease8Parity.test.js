import { describe, expect, it } from 'vitest';
import { computeOneRow } from './computeOneRow8';
import { computeRiskRow8 } from './riskBridge8';
import release from './finalRelease8Vectors.json';

/**
 * Final V8.00 saved-result oracle — independent of the app implementation.
 *
 * Each expected number is a literal saved cell in the supplied release workbook,
 * read without executing VBA. The extractor checks MAIN against RISK_DATA and
 * preserves full numeric precision. See extract-final-release8-fixtures.py and
 * the fixture's SHA-256 / sourceMap for exact provenance and reproducibility.
 *
 * This is deliberately separate from beta7Vectors.json: a broad Beta.7 capture
 * remains historical evidence, not a substitute for final-release evidence.
 * The final workbook contains five distinct Type 1 / E1 cases plus a duplicate;
 * these tests do not claim to be a native-Excel capture of every type/model.
 *
 * The 160-point case includes the subtle acceptance-grid regression:
 *   UUT limits     159.6–160.4; resolution 0.1
 *   final GB       159.7–160.3; multiplier 0.75
 *   observed REOP  0.85 at the final limits
 *   Cal Int        4.421331946491825 (not the Beta.4 value 11.734263719927311)
 * Matching every saved output together detects a partial fix that rounds only
 * displayed limits while retaining a continuous multiplier, risk, or interval.
 */
function expectWorkbookNumber(actual, expected, location) {
  expect(typeof actual, `${location}: output must be numeric, not a cleared cell`).toBe('number');
  expect(Number.isFinite(actual), `${location}: output must be finite`).toBe(true);
  // Allow floating-point operation order, never display rounding (e.g. 2.00%).
  // At interval 18 this is < 2e-9 time units; probabilities remain <= 2e-10.
  const tolerance = 1e-10 + Math.abs(expected) * 1e-10;
  expect(Math.abs(actual - expected), `${location}: saved Excel=${expected}, app=${actual}`)
    .toBeLessThanOrEqual(tolerance);
}

describe('final V8.00 saved workbook parity', () => {
  it.each(release.cases)('$id: matches every populated numeric risk output', (vector) => {
    const actual = computeOneRow(vector.input);
    for (const [key, expected] of Object.entries(vector.expected)) {
      const cell = `${release.sourceMap.outputMainColumns[key]}${vector.source.mainRow}`;
      expectWorkbookNumber(actual[key], expected, `MAIN!${cell} (${key})`);
    }
    // MAIN has no status columns. Only the verified last scratch case carries
    // captured status expectations; do not invent an Excel capture for others.
    for (const [key, expected] of Object.entries(vector.expectedSavedStatuses ?? {})) {
      const cell = `${release.sourceMap.savedStatusScratchColumns[key]}${vector.source.scratchRow}`;
      expect(actual[key], `RISK_CALC_SCRATCH!${cell} (${key})`).toBe(expected);
    }
  });

  it.each(release.cases)('$id: exposes the same saved values under the workbook field names', (vector) => {
    const { fields } = computeRiskRow8(vector.input);
    for (const [key, expected] of Object.entries(vector.expected)) {
      // Type/asymmetry belong to the tolerance columns, not the risk-result map.
      if (key === 'tolType' || key === 'asymmetry') continue;
      // Names were read from MAIN row 4, independently of the app's field map.
      const field = release.sourceMap.outputMainFieldNames[key];
      expectWorkbookNumber(fields[field], expected, `${vector.id}/${field}`);
    }
  });
});
