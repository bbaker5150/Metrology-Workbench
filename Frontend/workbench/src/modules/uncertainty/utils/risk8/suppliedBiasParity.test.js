import { expect, it } from 'vitest';
import vectors from './suppliedBiasParityVectors.json';
import { computePointRiskMetrics } from '../riskCompute';
import { resolveMeasurementBias } from '../measurementBias';

// Independent oracle: full-precision cached cells in the supplied workbook,
// never JS-generated expected results. Percentages in Excel K/L are fractions
// of tolerance half-span, not fractions of the measurement's nominal value.
import { suppliedCase } from "./suppliedBiasParity.fixtures";

it.each(vectors.cases.filter(row => row.type <= 4))('matches all cached risk/mitigation outputs in MAIN row $row with the exact workbook bias percentages', vector => {
  const { point, session } = suppliedCase(vector);
  const bias = resolveMeasurementBias(point, session);
  expect(bias.error).toBeNull();
  expect(bias.uutBias).toBe(vector.uutBias * 10);
  expect(bias.calBias).toBe(vector.calBias * 10);
  const result = computePointRiskMetrics(point, session, true);
  const native = suppliedCase(vector, "V", "absolute");
  expect(result).toEqual(computePointRiskMetrics(native.point, native.session, true));
  for (const [key, expected] of Object.entries(vector.expected)) {
    expect(result[key], key).toBeTypeOf('number');
    expect(Math.abs(result[key] - expected), key).toBeLessThanOrEqual(1e-8 + Math.abs(expected) * 1e-8);
  }
});

it.each([1, 2, 3, 4, 5, 6])('calculates tolerance type %s in a unitless native-number frame', type => {
  const vector = vectors.cases.find(row => row.type === type);
  const physical = suppliedCase(vector), unitless = suppliedCase(vector, '');
  const actual = computePointRiskMetrics(unitless.point, unitless.session, true);
  const expected = computePointRiskMetrics(physical.point, physical.session, true);
  expect(actual).not.toBeNull();
  for (const key of ['pfa', 'pfr', 'tur', 'gbLow', 'gbHigh']) expect(actual[key]).toEqual(expected[key]);
});
