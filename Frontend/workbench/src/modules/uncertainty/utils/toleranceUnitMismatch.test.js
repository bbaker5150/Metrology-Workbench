import { formatSidebarUncertainty } from "./sidebarUncertainty";
import { describe, it, expect } from 'vitest';
import { toleranceUnitMismatch } from './incompleteBudget';
import { getAbsoluteLimits, calculateUncertaintyFromToleranceObject, unitSystem } from './uncertaintyMath';
import { computeUncertaintyForPoint, computePointRiskMetrics } from './riskCompute';
import { suppliedCase } from './risk8/suppliedBiasParity.fixtures';
import vectors from './risk8/suppliedBiasParityVectors.json';

// Matching numerical scales cannot authorize mixing different quantities.
// Cover both absolute floors and relative-only specs on an incompatible range,
// plus all six workbook geometries (including unknown-value boundary PFA).
it.each([1, 2, 3, 4, 5, 6])('suppresses limits, uncertainty and risk for incompatible UUT type %s', type => {
  const { point, session } = suppliedCase(vectors.cases.find(row => row.type === type));
  expect(computePointRiskMetrics(point, session, true)).not.toBeNull();
  const original = point.uutTolerance;
  point.uutTolerance = { ...original, unit: 'A' };
  expect(toleranceUnitMismatch(point.uutTolerance, 'V', unitSystem)).toMatch(/Unit mismatch/);
  expect(getAbsoluteLimits(point.uutTolerance, point.testPointInfo.parameter)).toMatchObject({ high: 'N/A', low: 'N/A' });
  expect(computeUncertaintyForPoint(point, session)).toBeNull();
  expect(formatSidebarUncertainty({ ...point, combined_uncertainty_absolute_base: .123 }, 'combined')).toBe('-');
  expect(computePointRiskMetrics(point, session, true)).toBeNull();
  point.uutTolerance = original;
  expect(computePointRiskMetrics(point, session, true)).not.toBeNull();
});

it('does not silently reinterpret floor units, even without an outer range unit', () => {
  const tolerance = { tolerances: { floor: { high: 1, low: -1, unit: 'A' } } };
  const nominal = { value: 100, unit: 'V' };
  expect(calculateUncertaintyFromToleranceObject(tolerance, nominal)).toMatchObject({ breakdown: [], standardUncertainty: NaN, error: expect.stringMatching(/Unit mismatch/) });
  expect(getAbsoluteLimits(tolerance, nominal).low).toBe('N/A');
  expect(toleranceUnitMismatch({ unit: '%', reading: { high: 1, unit: '%' } }, 'V', unitSystem)).toMatch(/Unit mismatch/);
  expect(toleranceUnitMismatch({ unit: 'A', reading: { high: 1, unit: '%' } }, 'V', unitSystem)).toMatch(/Unit mismatch/);
});

it.each(['in', 'inch', 'in.'])('blocks the reported voltage percentage tolerance on a %s point', unit => {
  const tolerance = { unit: 'V', tolerances: { reading: { high: 1, low: -1, unit: '%', distribution: '1.732' } } };
  const nominal = { value: 1, unit };
  expect(getAbsoluteLimits(tolerance, nominal)).toMatchObject({ low: 'N/A', high: 'N/A', reason: expect.stringMatching(/Unit mismatch/) });
  expect(calculateUncertaintyFromToleranceObject(tolerance, nominal)).toMatchObject({ standardUncertainty: NaN, error: expect.stringMatching(/Unit mismatch/) });
});

it('retains compatible scaled units, aliases, relative specs and blank native frames', () => {
  expect(getAbsoluteLimits({ unit: 'V', floor: { high: 100, low: -100, unit: 'mV' } }, { value: 1, unit: 'V' })).toMatchObject({ rawLow: '0.9', rawHigh: '1.1' });
  for (const [source, target] of [['mV','V'], ['ohm','Ohm'], ['degC','degF'], ['', ''], ['%', 'V']])
    expect(toleranceUnitMismatch({ floor: { high: 1, unit: source } }, target, unitSystem)).toBeNull();
  expect(toleranceUnitMismatch({ floor: { high: '', low: '', unit: 'A' }, reading: { high: 1, unit: '%' } }, 'V', unitSystem)).toBeNull();
});
