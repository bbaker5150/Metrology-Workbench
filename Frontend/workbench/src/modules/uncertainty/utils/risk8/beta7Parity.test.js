import { describe, it, expect } from 'vitest';
import { computeOneRow } from './computeOneRow8';
import vectors from './beta7Vectors.json';
import { computeRiskRow8 } from './riskBridge8';
import { buildKnownMeasurementDiagnostics, buildKnownTwoSidedDiagnostics, toKnownMeasurementSummary, toKnownRiskDistribution } from './knownMeasurementRisk8';

// Expected values come from Excel's own VBA execution. The capture script records
// the workbook hash and reads Value2 (full precision), including empty cells and
// status strings. Test tolerances cover floating-point evaluation order only;
// they never round probabilities to their displayed percentages.
describe('Beta.7 workbook parity', () => {
  it('matches every core and mitigation output across the captured matrix', () => {
    const failures = [];
    for (const vector of vectors.cases) {
      const actual = computeOneRow(vector.input);
      for (const [key, expected] of Object.entries(vector.expected)) {
        const received = actual[key];
        const tolerance = 1e-10 + Math.abs(expected) * 1e-8;
        const equal = typeof expected === 'number'
          ? typeof received === 'number' && Number.isFinite(received) && Math.abs(received - expected) <= tolerance
          : received === expected;
        if (!equal) failures.push(`${vector.id} ${key}: Excel=${JSON.stringify(expected)} App=${JSON.stringify(received)}`);
      }
    }
    expect(failures.slice(0, 35), `${failures.length} mismatched outputs across ${vectors.cases.length} cases`).toEqual([]);
  }, 120000);

  it('keeps bridge outputs and displayed probability diagnostics on the same rounded limits', () => {
    for (const vector of vectors.cases) {
      const { input } = vector;
      const result = computeRiskRow8(input, { enforceMinimumInputs: false });
      expect(result.out, vector.id).toEqual(computeOneRow(input));
      const { out } = result;
      if (out.statusCore !== 'OK' || out.tolType > 4) continue;
      const twoSided = out.tolType <= 2;
      const halfSpan = twoSided ? (input.upperLimit - input.lowerLimit) / 2
        : out.tolType === 3 ? input.nominal - input.lowerLimit : input.upperLimit - input.nominal;
      const enriched = { ...result, input, meta: { frame: { center: input.nominal, halfSpan } } };
      const diagnostics = twoSided ? buildKnownTwoSidedDiagnostics(enriched)
        : buildKnownMeasurementDiagnostics(enriched, out.tolType === 3 ? 'low' : 'high');
      for (const withGuardband of [false, true]) {
        if (withGuardband && !diagnostics.recommended) continue;
        const physical = toKnownRiskDistribution({ ...enriched, diagnostics }, withGuardband);
        expect(physical.uDev ** 2, `${vector.id}/physical variance`).toBeCloseTo(physical.uUUT ** 2 + physical.riskCalSigma ** 2, 7);
        if (withGuardband) {
          if (typeof out.physGbLower === 'number') expect(physical.ALow).toBe(out.physGbLower);
          if (typeof out.physGbUpper === 'number') expect(physical.AUp).toBe(out.physGbUpper);
        }
      }
      for (const [state, pfa, pfr, obs] of [
        ['core', 'pfa', 'pfr', 'obs'], ['recommended', 'mitPfa', 'mitPfr', 'mitObs'],
        ['reopOnly', 'intPfa', 'intPfr', 'intObs'],
      ]) {
        if (typeof out[pfa] !== 'number') continue;
        expect(diagnostics[state]?.pPFA, `${vector.id}/${state}/PFA`).toBeCloseTo(out[pfa], 8);
        expect(diagnostics[state]?.pPFR, `${vector.id}/${state}/PFR`).toBeCloseTo(out[pfr], 8);
        expect(diagnostics[state]?.pObs, `${vector.id}/${state}/observed`).toBeCloseTo(out[obs], 8);
      }
      expect(result.fields.Observed_REOP_With_GB).toBe(out.mitObs);
      expect(result.fields.Observed_REOP_Interval_Only).toBe(out.intObs);
    }
  });

  it('preserves equivalent physical biased and asymmetric tolerance results', () => {
    for (const vector of vectors.cases.filter(v => v.id.startsWith('equivalent/symmetric/'))) {
      const counterpart = vectors.cases.find(v => v.id === vector.id.replace('/symmetric/', '/asymmetric/'));
      const first = computeOneRow(vector.input), second = computeOneRow(counterpart.input);
      for (const key of ['pfa', 'pfr', 'obs', 'trueReop', 'gbMult', 'physGbLower', 'physGbUpper',
        'mitPfa', 'mitPfr', 'mitReop', 'mitObs', 'gbInterval', 'intPfa', 'intPfr', 'intInterval']) {
        if (typeof first[key] === 'number') expect(second[key], `${vector.id}/${key}`).toBeCloseTo(first[key], 7);
        else expect(second[key]).toBe(first[key]);
      }
    }
  });

  it('publishes unavailable risk, not zero or stale risk, for an impossible assumed reliability', () => {
    const input = vectors.cases.find(v => v.id === 'symmetric/assumed-0.99').input;
    const result = computeRiskRow8(input);
    expect(result.out.statusCore).toBe('Assumed REOP exceeds MAX REOP');
    const summary = toKnownMeasurementSummary(result);
    expect(summary.riskAvailability).toBe('unavailable');
    for (const field of ['pfa', 'pfr', 'observedReop', 'trueReop', 'gbPfa', 'gbCalInt', 'noGbPfa'])
      expect(summary[field], field).toBeUndefined();
    expect(summary.maxReop).toBeTypeOf('number');
  });
});
