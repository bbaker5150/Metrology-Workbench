import { expect, it } from 'vitest';
import vectors from './suppliedBiasParityVectors.json';
import { computePointRiskMetrics } from '../riskCompute';
import { resolveMeasurementBias } from '../measurementBias';

// Independent oracle: full-precision cached cells in the supplied workbook,
// never JS-generated expected results. Percentages in Excel K/L are fractions
// of tolerance half-span, not fractions of the measurement's nominal value.
export function suppliedCase(vector, unit = 'V') {
  const h = 10;
  const tolerance = vector.type <= 2
    ? { floor: { low: vector.low - 100, high: vector.high - 100, symmetric: vector.type === 1, unit } }
    : { singleSided: { direction: vector.type % 2 ? 'low' : 'high', measurement: vector.type > 4 ? 'unknown' : 'known', limit: vector.low ?? vector.high, unit } };
  const range = { id: 'uut-range', unit, tolerances: { ...tolerance, bias: { value: vector.uutBias * h, unit } } };
  const source = { id: 'reference-range', unit, tolerances: {
    floor: { low: -2.5, high: 2.5, symmetric: true, unit, distribution: '1.732' },
    bias: { value: vector.calBias * h, unit },
  } };
  const point = { id: 'point', measurementType: 'direct', testPointInfo: { parameter: { value: 100, unit } },
    associatedUutIds: ['uut'], uutTolerance: { ...range, ...range.tolerances, rangeId: range.id },
    components: [{ id: 'component', tmdeBudgetSourceId: 'reference', tmdeBudgetRangeId: source.id, tmdeBudgetComponentKind: 'Accuracy' }] };
  const session = { uuts: [{ id: 'uut', ranges: [range] }], tmdes: [{ id: 'reference', ranges: [source] }],
    uncReq: { uncertaintyConfidence: 95, reliability: 85, calInt: 12, measRelCalcAssumed: 85, neededTUR: 4, reqPFA: 2, guardBandMultiplier: 1 } };
  return { point, session };
}

it.each(vectors.cases.filter(row => row.type <= 4))('matches all cached risk/mitigation outputs in MAIN row $row with equivalent physical bias', vector => {
  const { point, session } = suppliedCase(vector);
  const bias = resolveMeasurementBias(point, session);
  expect(bias.error).toBeNull();
  expect(bias.uutBias).toBe(vector.uutBias * 10);
  expect(bias.calBias).toBe(vector.calBias * 10);
  const result = computePointRiskMetrics(point, session, true);
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
