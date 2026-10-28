import { describe, expect, it } from 'vitest';
import { buildAcShuntBudget } from './acShuntBudget';
import { computeUncertaintyForPoint, computePointRiskMetrics } from './riskCompute';
import { resolvePointBudgetComponents } from './resolvePointBudgetComponents';
import { getInlineManualDraft, normalizeInlineManualComponent } from '../features/analysis/utils/manualComponentUtils';
import { isPpmBudget } from './budgetDisplay';

const snapshot = (points = [{ current: 10, frequency: 1000 }]) => ({
  id: 10, name: 'Saved run', createdAt: '2026-10-02',
  instruments: { test_instrument_model: 'Y5020', test_instrument_serial: 'TI', standard_instrument_model: 'Y5020', standard_instrument_serial: 'REF' },
  points: points.map((point, index) => ({ ...point, sourcePointIds: [index * 2 + 1, index * 2 + 2],
    analytics: { pair_type_a_uncertainty_ppm: 2, n_pairs_used: 4, pair_delta_uut_ppm: -3 } })),
});
const reference = { id: 'ref', scope: 'validated', manufacturer: 'Fluke', model: 'Y5020 · REF', description: 'NIST reference',
  functions: [{ id: 'current', name: 'Current', unit: 'A', ranges: [
    [10,60,38], [10,1000,35], [20,1000,46],
  ].map(([current, frequency, ppm]) => ({ id: `${current}:${frequency}`, min: current, max: current, unit: 'A',
    qualifier: { min: frequency, max: frequency, value: frequency, unit: 'Hz', isSingleValue: true },
    tolerances: { reading: { high: ppm, low: -ppm, unit: 'ppm', distribution: '1.960', symmetric: true } },
    acShuntSource: { serial: 'REF', model: 'Y5020' } })) }] };

describe('simple AC-shunt measurement import', () => {
  it('imports current, frequency, signed result and Type A once without phase data or certificates', () => {
    const { session } = buildAcShuntBudget(snapshot());
    const point = session.testPoints[0];
    expect(point.measurementType).toBe('direct');
    expect(point.testPointInfo).toMatchObject({ measurementArea: 'Current',
      parameter: { value: 10, unit: 'A', qualifier: { value: 1000, unit: 'Hz' } },
      qualifier: { value: 1000, min: 1000, max: 1000, unit: 'Hz', isSingleValue: true },
      acShuntSource: { deltaPpm: -3, sessionId: 10, pointIds: [1,2] } });
    expect(point.components).toHaveLength(2);
    expect(point.components[0]).toMatchObject({ type: 'A', value: 2, dof: 3,
      originalInput: { standardUncertainty: 2, unit: 'ppm', useFiniteDof: true } });
    expect(point.components[0].value_native).toBeCloseTo(0.00002, 12);
    expect(point.equationString).toBeUndefined();
    expect(point.variableNominals).toBeUndefined();
    expect(session.tmdes).toEqual([]);
    expect(point.components.some(c => c.tmdeTransferSources)).toBe(false);
    expect(isPpmBudget(point.components)).toBe(true);
  });
  it('uses editable ±5 ppm Rectangular variability independently at every point', () => {
    const { session } = buildAcShuntBudget(snapshot([{current:10,frequency:1000},{current:20,frequency:1000}]));
    const [first, second] = session.testPoints;
    const row = first.components[1];
    expect(row).toMatchObject({ name: 'Variability', type: 'B', isInlineManual: true, isManual: true,
      distribution: 'Rectangular', originalInput: { tolerance: { floor: { high: 5, low: -5, unit: 'ppm', distribution: '1.732' } } } });
    expect(row.value).toBeCloseTo(5/Math.sqrt(3), 8);
    expect(row.value_native).toBeCloseTo(10*5/Math.sqrt(3)*1e-6, 12);
    expect(second.components[1].value_native).toBeCloseTo(2*row.value_native, 12);
    const draft = getInlineManualDraft(row);
    const edited = normalizeInlineManualComponent({ component: row, referencePoint: first.testPointInfo.parameter,
      draft: { ...draft, tolerance: { floor: { ...draft.tolerance.floor, high: 9, low: -9 } } } });
    first.components[1] = edited;
    expect(computeUncertaintyForPoint(first,session).combined_uncertainty_absolute_base)
      .toBeCloseTo(Math.hypot(2,9/Math.sqrt(3))*10e-6, 12);
    expect(second.components[1].originalInput.tolerance.floor.high).toBe(5);
    expect(row.id).not.toBe(second.components[1].id);
  });
  it.each(['Y5020','A40B','Other'])('applies lab ±100 ppm TI limits for %s without measured bias', model => {
    const source = snapshot();
    source.instruments.test_instrument_model = model;
    source.points[0].analytics.pair_delta_uut_ppm = -900;
    const {session} = buildAcShuntBudget(source);
    const point = session.testPoints[0];
    expect(point.uutTolerance).toMatchObject({ qualifier: { value: 1000, unit: 'Hz' },
      tolerances: { reading: { high:100, low:-100, unit:'ppm', distribution:'not_set' } } });
    expect(point.uutTolerance.tolerances.bias).toBeUndefined();
    expect(point.components[0].value).toBe(2);
  });
  it('uses each library current/frequency uncertainty without modifying the master', () => {
    const source = snapshot([{current:10,frequency:60},{current:10,frequency:1000},{current:20,frequency:1000}]);
    const before = JSON.stringify(reference);
    const { session, referenceId } = buildAcShuntBudget(source, { instruments: [reference] });
    expect(referenceId).toBe('ref');
    expect(session.tmdes).toHaveLength(1);
    session.testPoints.forEach((point,index) => {
      const rows = resolvePointBudgetComponents(point,session);
      expect(rows).toHaveLength(3);
      expect(rows[2].value).toBeCloseTo([38,35,46][index]/1.96, 7);
      expect(rows[2].tmdeBudgetSourceId).toBe(session.tmdes[0].id);
      expect(isPpmBudget(rows)).toBe(true);
    });
    expect(JSON.stringify(reference)).toBe(before);
  });
  it('keeps missing reference frequencies incomplete rather than using another frequency', () => {
    const { session, warnings } = buildAcShuntBudget(snapshot([{current:10,frequency:6000}]), { instruments:[reference] });
    expect(warnings.join(' ')).toContain('no shared range matches');
    expect(computeUncertaintyForPoint(session.testPoints[0],session)).toBeNull();
  });
  it('keeps reference edits linked after persistence and recalculates uncertainty and risk', () => {
    const session = JSON.parse(JSON.stringify(buildAcShuntBudget(snapshot(), { instruments: [reference] }).session));
    const point = session.testPoints[0];
    const before = computePointRiskMetrics(point, session);
    for (const field of ['tur', 'pfa', 'pfr']) expect(Number.isFinite(before[field])).toBe(true);
    const uncertaintyBefore = computeUncertaintyForPoint(point, session).combined_uncertainty_absolute_base;
    const range = session.tmdes[0].instrument.functions[0].ranges[1];
    range.tolerances.reading.high = 70;
    range.tolerances.reading.low = -70;
    expect(computeUncertaintyForPoint(point, session).combined_uncertainty_absolute_base).toBeGreaterThan(uncertaintyBefore);
    expect(computePointRiskMetrics(point, session).tur).toBeLessThan(before.tur);
    expect(point.components[1].originalInput.tolerance.floor.high).toBe(5);
  });
  it('preserves zero Type A and leaves missing Type A pending', () => {
    const source = snapshot();
    source.points[0].analytics.pair_type_a_uncertainty_ppm = 0;
    expect(buildAcShuntBudget(source).session.testPoints[0].components[0]).toMatchObject({value:0,dof:3});
    source.points[0].analytics.n_pairs_used = 1;
    const { session } = buildAcShuntBudget(source);
    expect(session.testPoints[0].components[0].pendingReason).toMatch(/two accepted/);
    expect(computeUncertaintyForPoint(session.testPoints[0],session)).toBeNull();
  });
  it('allows an explicit reference choice without guessing among duplicate identities', () => {
    const duplicate = { ...reference, id:'other' };
    expect(buildAcShuntBudget(snapshot(),{instruments:[reference,duplicate]}).referenceId).toBe('');
    expect(buildAcShuntBudget(snapshot(),{instruments:[reference,duplicate],referenceId:'other'}).referenceId).toBe('other');
  });
  it('rejects missing points and invalid point coordinates', () => {
    expect(()=>buildAcShuntBudget(snapshot([]))).toThrow(/no measurement points/);
    expect(()=>buildAcShuntBudget(snapshot([{current:10,frequency:null}]))).toThrow(/positive current and frequency/);
  });
});
