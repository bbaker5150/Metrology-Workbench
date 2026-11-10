import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useUncertaintyCalculation } from './useUncertaintyCalculation';
import { getBudgetComponentsFromTolerance } from '../utils/budgetUtils';
import { budgetToleranceUnitMismatch } from '../../../utils/incompleteBudget';
import { calculateDerivedUncertainty, calculateUncertaintyFromToleranceObject, getToleranceErrorSummary, getTmdeAbsoluteLimits, getTmdeAbsoluteLimitEntries, unitSystem } from '../../../utils/uncertaintyMath';
import { computeUncertaintyForPoint } from '../../../utils/riskCompute';
import { resolvePointBudgetComponents } from '../../../utils/resolvePointBudgetComponents';
import { computePointTmdeLimits } from '../../../utils/pointTmdeLimits';
import { getPointTmdeSpecifications } from '../../../utils/pointTmdeColumns';

const nominal = { value: 100, unit: 'gpm' };
const relativeHalfSpan = nominal.value * 20 / 1e6;
const floorHalfSpan = 6e-15;
const flowScale = unitSystem.units.gpm.to_si;
const specification = (fs = '0') => ({
  id: 'frequency-range', name: 'Function Generator', unit: 'Hz', max: 1000000,
  reading: { high: 20, low: -20, unit: 'ppm', symmetric: true, distribution: '2.000' },
  range: { high: fs, low: fs === '' ? '' : -Number(fs), value: 1000000, unit: '%', symmetric: true, distribution: '2.000' },
  floor: { high: floorHalfSpan, low: -floorHalfSpan, unit: 'gpm', symmetric: true, distribution: '2.000' },
});
const pointFor = (measurementType, source) => ({
  id: 'flow-point', measurementType, testPointInfo: { parameter: nominal },
  equationString: 'q', variableMappings: measurementType === 'derived' ? { q: 'Flow' } : {},
  variableNominals: measurementType === 'derived' ? { q: nominal } : {},
  tmdeTolerances: [{ ...source, variableType: 'Flow', measurementPoint: nominal }],
  components: [], uutTolerance: {},
});
const session = { uncReq: { uncertaintyConfidence: 95 }, tmdes: [] };

describe('inactive full-scale units in TMDE uncertainty budgets', () => {
  it.each(['0', 0, ''])('evaluates the reported Hz range and gpm uncertainty with FS=%j', fs => {
    const source = specification(fs);
    expect(budgetToleranceUnitMismatch(source, 'gpm', unitSystem)).toBeNull();
    const [component] = getBudgetComponentsFromTolerance(source, nominal);
    expect(component.pendingReason).toBeUndefined();
    expect(component.unit_native).toBe('gpm');
    expect(component.value_native).toBeCloseTo((relativeHalfSpan + floorHalfSpan) / 2, 16);
    expect(component.value).toBeCloseTo((relativeHalfSpan + floorHalfSpan) / 2 / nominal.value * 1e6, 10);
    const calculated = calculateUncertaintyFromToleranceObject(source, nominal, true, { unitContext: 'budget' });
    expect(calculated.error).toBeUndefined();
    expect(calculated.breakdown).toHaveLength(2);
    expect(calculated.standardUncertainty).toBeCloseTo(Math.hypot(relativeHalfSpan, floorHalfSpan) / 2 / nominal.value * 1e6, 10);
  });

  it('ignores inactive physical term units and a legacy floor shadowed by an explicit zero floor', () => {
    const source = specification('');
    source.range.unit = 'A';
    source.floor = { high: 0, low: 0, unit: 'A' };
    source.readings_iv = { high: 10, low: -10, unit: 'Hz' };
    const [component] = getBudgetComponentsFromTolerance(source, nominal);
    expect(component.pendingReason).toBeUndefined();
    expect(component.value_native).toBeCloseTo(relativeHalfSpan / 2, 12);
    source.floor = { high: '', low: '', unit: 'A' };
    expect(budgetToleranceUnitMismatch(source, 'gpm', unitSystem)).toMatch(/Hz/);
  });

  it('validates legacy non-range values and defaults missing term units to the measurement frame', () => {
    expect(budgetToleranceUnitMismatch({ unit: 'Hz', floor: { value: .1, unit: 'Hz' } }, 'gpm', unitSystem)).toMatch(/Unit mismatch/);
    expect(budgetToleranceUnitMismatch({ unit: 'Hz', reading: { value: 20, unit: 'ppm' } }, 'gpm', unitSystem)).toBeNull();
    const source = specification();
    delete source.floor.unit;
    const [component] = getBudgetComponentsFromTolerance(source, nominal);
    expect(component.pendingReason).toBeUndefined();
    expect(component.unit_native).toBe('gpm');
    expect(component.value_native).toBeCloseTo((relativeHalfSpan + floorHalfSpan) / 2, 16);
  });

  it('does not multiply an inactive FS term by a missing full-scale reference', () => {
    const source = specification();
    source.max = '';
    source.range.value = '';
    const [component] = getBudgetComponentsFromTolerance(source, nominal);
    expect(component.pendingReason).toBeUndefined();
    expect(component.value_native).toBeCloseTo((relativeHalfSpan + floorHalfSpan) / 2, 16);
    expect(calculateUncertaintyFromToleranceObject(source, nominal, true, { unitContext: 'budget' }).standardUncertainty).toBeCloseTo(10, 10);
  });

  it.each(['Hz', 'gpm'])('validates manual Type B units independently of the valid %s parent specification', parentUnit => {
    const manualComponents = ['Hz', 'gpm'].map(unit => ({ id: unit, name: unit, unit,
      inputMode: 'tolerance', toleranceLimit: .1, distribution: '2.000' }));
    for (const instrumentLevel of [false, true]) {
      const rows = getBudgetComponentsFromTolerance({ ...specification(), unit: parentUnit,
        manualComponents: instrumentLevel ? [] : manualComponents }, nominal, instrumentLevel ? manualComponents : []);
      const incompatible = rows.find(row => row.manualUnit === 'Hz');
      expect(incompatible).toMatchObject({ value: null, value_native: null, unit_native: 'Hz',
        pendingReason: expect.stringMatching(/Unit mismatch/) });
      const compatible = rows.find(row => row.manualUnit === 'gpm');
      expect(compatible.pendingReason).toBeUndefined();
      expect(compatible.unit_native).toBe('gpm');
      expect(compatible.value_native).toBeCloseTo(.05, 12);
      expect(rows.find(row => !row.isManual).pendingReason).toBeUndefined();
    }
  });

  it.each([
    ['Hz', 'gpm', true],
    ['gpm', 'Hz', false],
  ])('validates the effective resolution unit %s before its stale alias %s', (measuringResolutionUnit, resolutionUnit, blocked) => {
    const source = { ...specification(), includeResolutionInBudget: true,
      measuringResolution: .01, resolution: 99, measuringResolutionUnit, resolutionUnit };
    const rows = getBudgetComponentsFromTolerance(source, nominal);
    const resolution = rows.find(row => row.isResolution);
    expect(rows.find(row => !row.isResolution).pendingReason).toBeUndefined();
    expect(resolution.resolutionUnit).toBe(measuringResolutionUnit);
    expect(resolution.resolution).toBe(.01);
    if (blocked) {
      expect(resolution).toMatchObject({ value_native: null, value: null, unit_native: 'Hz',
        pendingReason: expect.stringMatching(/Unit mismatch/),
        authoredTolerance: { floor: { high: .01, unit: 'Hz' } } });
    } else {
      expect(resolution.pendingReason).toBeUndefined();
      expect(resolution.unit_native).toBe('gpm');
      expect(resolution.value_native).toBeCloseTo(.01 / Math.sqrt(12), 12);
    }
  });

  it('retains the resolution evaluator measurement-unit fallback when both unit aliases are absent', () => {
    const source = { ...specification(), includeResolutionInBudget: true, measuringResolution: .01 };
    const resolution = getBudgetComponentsFromTolerance(source, nominal).find(row => row.isResolution);
    expect(resolution.pendingReason).toBeUndefined();
    expect(resolution).toMatchObject({ resolutionUnit: 'gpm', unit_native: 'gpm' });
    expect(resolution.value_native).toBeCloseTo(.01 / Math.sqrt(12), 12);
  });

  it.each([
    ['nonzero full scale', source => { source.range.high = .1; source.range.low = -.1; }],
    ['nonzero physical floor', source => { source.floor.unit = 'Hz'; }],
  ])('keeps incompatible %s unresolved in ordinary and greatest-term budgets', (_, change) => {
    const source = specification(); change(source);
    for (const whicheverIsGreater of [false, true]) {
      const candidate = { ...source, whicheverIsGreater };
      expect(budgetToleranceUnitMismatch(candidate, 'gpm', unitSystem)).toMatch(/Unit mismatch/);
      const components = getBudgetComponentsFromTolerance(candidate, nominal);
      expect(components.length).toBeGreaterThan(0);
      expect(components.every(component => component.value_native === null && /Unit mismatch/.test(component.pendingReason))).toBe(true);
      expect(calculateUncertaintyFromToleranceObject(candidate, nominal, true, { unitContext: 'budget' }))
        .toMatchObject({ standardUncertainty: NaN, error: expect.stringMatching(/Unit mismatch/) });
      expect(computeUncertaintyForPoint(pointFor('direct', candidate), session)).toBeNull();
      expect(computeUncertaintyForPoint(pointFor('derived', candidate), session)).toBeNull();
    }
  });

  it('chooses the greatest active term in the measurement frame without an inactive range blocking it', () => {
    const source = { ...specification(''), whicheverIsGreater: true };
    const [component] = getBudgetComponentsFromTolerance(source, nominal);
    expect(component.pendingReason).toBeUndefined();
    expect(component.value_native).toBeCloseTo(relativeHalfSpan / 2, 12);
    expect(calculateUncertaintyFromToleranceObject(source, nominal, true, { unitContext: 'budget' }).standardUncertainty).toBeCloseTo(10, 10);
    expect(getToleranceErrorSummary(source, nominal, { unitContext: 'budget' })).toMatch(/0.002.*gpm/);
  });

  it('continues to reject the same mismatched range when used as a UUT acceptance specification', () => {
    expect(calculateUncertaintyFromToleranceObject(specification(), nominal))
      .toMatchObject({ standardUncertainty: NaN, error: expect.stringMatching(/Unit mismatch/) });
  });

  it('uses the selected dynamic source without validating inactive parametric FS units', () => {
    const definition = { id: 'flow-table', kind: 'table', measurementUnit: 'gpm', outputUnit: 'gpm',
      mode: 'standard', columns: [{ id: 'u' }], rows: [{ point: 100, values: { u: { value: .003 } } }] };
    const rows = getBudgetComponentsFromTolerance({ ...specification('.1'), tmdeUncertaintyDefinition: definition }, nominal);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pendingReason: null, value_native: .003, unit_native: 'gpm' });
  });

  it('uses the measurement frame for legacy derived TMDE inputs', () => {
    const point = pointFor('derived', specification());
    const result = calculateDerivedUncertainty('q', point.variableMappings, point.tmdeTolerances,
      { ...nominal, variableNominals: point.variableNominals }, [], { strictUnitValidation: true });
    expect(result.error).toBeNull();
    expect(result.nominalResult).toBeCloseTo(nominal.value, 10);
    expect(result.combinedUncertaintyNative).toBeCloseTo(Math.hypot(relativeHalfSpan, floorHalfSpan) / 2, 12);
  });

  it('refreshes saved linked sources and their specification columns in gpm', () => {
    const source = specification();
    const master = { id: 'generator', name: 'Function Generator', instrument: { functions: [
      { id: 'frequency', unit: 'Hz', ranges: [{ id: source.id, min: .000001, max: 1000000, tolerances: source }] },
    ] } };
    const linkedSession = { ...session, tmdes: [master] };
    const point = { ...pointFor('direct', source), tmdeTolerances: [], components: [
      { id: 'linked-accuracy', tmdeBudgetSourceId: master.id, tmdeBudgetRangeId: source.id,
        tmdeBudgetFunctionId: 'frequency', tmdeBudgetComponentKind: 'Accuracy' },
    ] };
    const [component] = resolvePointBudgetComponents(point, linkedSession);
    expect(component.pendingReason).toBeNull();
    expect(component.unit_native).toBe('gpm');
    expect(component.value_native).toBeCloseTo((relativeHalfSpan + floorHalfSpan) / 2, 16);
    expect(computeUncertaintyForPoint(point, linkedSession).combined_uncertainty_absolute_base / flowScale)
      .toBeCloseTo(component.value_native, 14);
    const limits = computePointTmdeLimits(point, linkedSession);
    expect(limits.reason).toBeNull();
    expect(limits.low).toBeCloseTo(nominal.value - relativeHalfSpan - floorHalfSpan, 12);
    expect(limits.high).toBeCloseTo(nominal.value + relativeHalfSpan + floorHalfSpan, 12);
    const [column] = getPointTmdeSpecifications(point, master, linkedSession);
    expect(column.reason).toBeUndefined();
    expect(column.limits).toContain('gpm');
    expect(column.limits).not.toContain('Hz');
    const legacySources = pointFor('direct', source).tmdeTolerances;
    expect(getTmdeAbsoluteLimits(legacySources, nominal)).toMatchObject({ low: expect.stringContaining('99.998'), high: expect.stringContaining('100.002') });
    expect(getTmdeAbsoluteLimitEntries(legacySources)[0]).toMatchObject({ low: expect.stringContaining('99.998'), high: expect.stringContaining('100.002') });
  });

  it.each(['direct', 'derived'])('keeps the open %s point and sidebar numeric and clears them when FS becomes active', async measurementType => {
    const save = vi.fn();
    const manual = [];
    let point = pointFor(measurementType, specification(''));
    const { result, rerender } = renderHook(({ current }) => useUncertaintyCalculation(
      current, session, current.tmdeTolerances, current.uutTolerance, nominal, manual, save,
    ), { initialProps: { current: point } });
    await waitFor(() => expect(result.current.calcResults?.is_detailed_uncertainty_calculated).toBe(true));
    const valid = result.current.calcResults;
    const sidebar = computeUncertaintyForPoint(point, session);
    expect(valid.combined_uncertainty_absolute_base).toBeGreaterThan(0);
    expect(sidebar.combined_uncertainty_absolute_base).toBeCloseTo(valid.combined_uncertainty_absolute_base, 15);
    expect(sidebar.expanded_uncertainty_absolute_base).toBeCloseTo(valid.expanded_uncertainty_absolute_base, 15);
    expect(valid.calculatedBudgetGroups.find(group => group.kind === 'final').results.combined).toBeGreaterThan(0);
    point = { ...valid, ...pointFor(measurementType, specification('.1')) };
    rerender({ current: point });
    await waitFor(() => expect(result.current.calcResults?.is_detailed_uncertainty_calculated).not.toBe(true));
    expect(computeUncertaintyForPoint(point, session)).toBeNull();
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ expanded_uncertainty_absolute_base: null }));
    point = pointFor(measurementType, specification('0'));
    rerender({ current: point });
    await waitFor(() => expect(result.current.calcResults?.is_detailed_uncertainty_calculated).toBe(true));
    expect(result.current.calcResults.combined_uncertainty_absolute_base).toBeCloseTo(valid.combined_uncertainty_absolute_base, 15);
  });
});
