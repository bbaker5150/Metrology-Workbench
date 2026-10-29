import { describe, expect, it } from 'vitest';
import { buildAcShuntBudget as buildBudget } from './acShuntBudget';
import { computeUncertaintyForPoint, computePointRiskMetrics } from './riskCompute';
import { resolvePointBudgetComponents } from './resolvePointBudgetComponents';
import { getInlineManualDraft, normalizeInlineManualComponent } from '../features/analysis/utils/manualComponentUtils';
import { isPpmBudget } from './budgetDisplay';
import { formatInstrumentIdentity } from './instrumentIdentity';
import { generic5790, nominalY5020Resolution } from './testFixtures/generic5790';

const snapshot = (points = [{ current: 10, frequency: 1000 }]) => ({
  id: 10, name: 'Saved run', createdAt: '2026-10-02',
  generic5790Instrument: structuredClone(generic5790),
  instruments: { test_instrument_model: 'Y5020', test_instrument_serial: 'TI', standard_instrument_model: 'Y5020', standard_instrument_serial: 'REF' },
  points: points.map((point, index) => ({ ...point, sourcePointIds: [index * 2 + 1, index * 2 + 2],
    readerResolution: nominalY5020Resolution(point.current),
    analytics: { pair_type_a_uncertainty_ppm: 2, n_pairs_used: 4, pair_delta_uut_ppm: -3 } })),
});
const reference = { id: 'ref', scope: 'validated', manufacturer: 'Fluke', model: 'Y5020 · REF', description: 'NIST reference',
  functions: [{ id: 'current', name: 'Current', unit: 'A', ranges: [
    [10,60,38], [10,1000,35], [20,1000,46],
  ].map(([current, frequency, ppm]) => ({ id: `${current}:${frequency}`, min: current, max: current, unit: 'A',
    qualifier: { min: frequency, max: frequency, value: frequency, unit: 'Hz', isSingleValue: true },
    tolerances: { reading: { high: ppm, low: -ppm, unit: 'ppm', distribution: '1.960', symmetric: true } },
    acShuntSource: { serial: 'REF', model: 'Y5020' } })) }] };

const testInstrument = source => ({ id: 'shared-ti', type: 'uut', scope: 'validated', manufacturer: 'Fluke',
  model: `${source.instruments.test_instrument_model} · ${source.instruments.test_instrument_serial}`, description: 'Lab TI',
  functions: [{ id: 'ti-current', name: 'Current', unit: 'A', ranges: source.points.map((point, i) => ({
    id: `ti-range-${i}`, min: point.current, max: point.current, unit: 'A', isSingleValue: true,
    qualifier: { value: point.frequency, min: point.frequency, max: point.frequency, unit: 'Hz', isSingleValue: true },
    tolerances: { reading: { high: 100, low: -100, unit: 'ppm', symmetric: true, distribution: 'not_set' } },
  })) }] });
const buildAcShuntBudget = (source, options = {}) => buildBudget(source, {
  ...options, instruments: [testInstrument(source), ...(options.instruments || [])],
});

describe('simple AC-shunt measurement import', () => {
  it('automatically matches proven tagged aliases without treating other tagged correction sets as equivalent', () => {
    const source = snapshot();
    source.instruments.standard_instrument_serial = '5965004-2';
    source.instruments.shuntRange = 20;
    const ref = {...reference, model:'Y5020', description:'5965004 20 A CHECK STD',
      acShuntIdentity:{model:'Y5020', serial:'5965004', shuntRange:20, serialAliases:['5965004-2']}};
    expect(buildAcShuntBudget(source,{instruments:[ref]}).referenceId).toBe('ref');
    source.instruments.standard_instrument_serial = '5965004-3';
    expect(buildAcShuntBudget(source,{instruments:[ref]}).referenceId).toBe('');
    source.instruments.standard_instrument_serial = '59650042';
    expect(buildAcShuntBudget(source,{instruments:[ref]}).referenceId).toBe('');
  });
  it('matches conventional library names by saved identity and physical range without changing uncertainties', () => {
    const source = snapshot();
    source.instruments.shuntRange = 20;
    source.instruments.test_instrument_model = 'Fluke Y5020';
    const ti = {...testInstrument(source),model:'Y5020',description:'TI 20 A CHECK STD',
      acShuntIdentity:{model:'Y5020',serial:'TI',shuntRange:20,standardType:'CHECK STD'}};
    const ref = {...reference,model:'Y5020',description:'REF 20 A NIST',
      acShuntIdentity:{model:'Y5020',serial:'REF',shuntRange:20,standardType:'NIST'}};
    const otherRange = {...ref,id:'ref-10',description:'REF 10 A NIST',acShuntIdentity:{...ref.acShuntIdentity,shuntRange:10}};
    const {session,referenceId} = buildBudget(source,{instruments:[ti,ref,otherRange]});
    expect(referenceId).toBe('ref');
    expect(formatInstrumentIdentity(session.uuts[0])).toBe('Fluke Y5020 TI 20 A CHECK STD');
    expect(formatInstrumentIdentity(session.tmdes[0])).toBe('Fluke Y5020 REF 20 A NIST');
    expect(session.testPoints[0].uutTolerance.tolerances.reading.high).toBe(100);
    expect(resolvePointBudgetComponents(session.testPoints[0],session)[2].value).toBeCloseTo(35/1.96,7);
    expect(buildBudget({...source,instruments:{...source.instruments,shuntRange:null}}, {instruments:[ti,ref,otherRange]}).referenceId).toBe('');
    const pending = buildBudget(source,{instruments:[ti,{...ref,functions:[]} ]});
    expect(pending.referenceId).toBe('ref');
    expect(pending.session.testPoints[0].components[2].pendingReason).toMatch(/no shared range matches/);
  });
  it('links the actual library TI with make, model, serial and library range IDs without modifying it', () => {
    const source = snapshot();
    const ti = testInstrument(source);
    ti.functions[0].ranges[0].tolerances.reading.high = 90;
    const before = JSON.stringify(ti);
    const { session, uutInstrumentId } = buildBudget(source, { instruments: [ti, reference] });
    expect(uutInstrumentId).toBe('shared-ti');
    expect(session.uuts[0]).toMatchObject({ libraryInstrumentId: 'shared-ti',
      description: 'Lab TI', name: 'Lab TI',
      instrument: { manufacturer: 'Fluke', model: 'Y5020 · TI', sourceId: 'shared-ti', localOverride: false } });
    expect(formatInstrumentIdentity(session.uuts[0])).toBe('Fluke Y5020 · TI Lab TI');
    expect(session.uuts[0].instrument.validatedSnapshot).toBeTruthy();
    expect(session.testPoints[0].uutTolerance).toMatchObject({ rangeId: 'ti-range-0', functionId: 'ti-current',
      tolerances: { reading: { high: 90 } } });
    expect(JSON.stringify(ti)).toBe(before);
  });
  it('requires a TI library match and never substitutes another serial or a reference', () => {
    const source = snapshot();
    const ti = testInstrument(source);
    expect(() => buildBudget(source)).toThrow(/Could not automatically match TI/);
    expect(() => buildBudget(source, { instruments: [{ ...ti, model: 'Y5020 · OTHER' }] })).toThrow(/Could not automatically match TI/);
    expect(() => buildBudget(source, { instruments: [{ ...ti, type: 'tmde' }] })).toThrow(/Could not automatically match TI/);
    expect(() => buildBudget(source, { instruments: [ti, { ...ti, id: 'duplicate' }] })).toThrow(/Could not automatically match TI/);
  });
  it('preserves the screenshot signed mean and full-precision standard Type A as separate quantities', () => {
    const source = snapshot();
    source.points[0].analytics = { pair_delta_uut_ppm: -0.070, pair_type_a_uncertainty_ppm: 0.6150070189859945, n_pairs_used: 5 };
    const point = buildAcShuntBudget(source).session.testPoints[0];
    expect(point.testPointInfo.acShuntSource.deltaPpm).toBe(-0.070);
    expect(point.components[0].originalInput.standardUncertainty).toBe(0.6150070189859945);
    expect(point.components[0].dof).toBe(4);
    expect(point.components[0].value_native).toBeCloseTo(0.6150070189859945 * 10e-6, 15);
  });
  it('imports current, frequency, signed result and Type A once without phase data or certificates', () => {
    const { session } = buildAcShuntBudget(snapshot());
    const point = session.testPoints[0];
    expect(point.measurementType).toBe('direct');
    expect(point.testPointInfo).toMatchObject({ measurementArea: 'Current',
      parameter: { value: 10, unit: 'A', qualifier: { value: 1000, unit: 'Hz' } },
      qualifier: { value: 1000, min: 1000, max: 1000, unit: 'Hz', isSingleValue: true },
      acShuntSource: { deltaPpm: -3, sessionId: 10, pointIds: [1,2] } });
    expect(point.components).toHaveLength(3);
    expect(point.components[0]).toMatchObject({ type: 'A', value: 2, dof: 3,
      originalInput: { standardUncertainty: 2, unit: 'ppm', useFiniteDof: true } });
    expect(point.components[0].value_native).toBeCloseTo(0.00002, 12);
    expect(point.equationString).toBeUndefined();
    expect(point.variableNominals).toBeUndefined();
    expect(session.tmdes).toHaveLength(1);
    expect(session.tmdes[0].instrument.id).toBe(generic5790.id);
    expect(point.components.some(c => c.tmdeTransferSources)).toBe(false);
    expect(isPpmBudget(point.components)).toBe(true);
  });
  it('uses editable ±5 ppm Rectangular variability independently at every point', () => {
    const { session } = buildAcShuntBudget(snapshot([{current:10,frequency:1000},{current:20,frequency:1000}]));
    const [first, second] = session.testPoints;
    const row = first.components[1];
    expect(row).toMatchObject({ name: 'Fluke 5790B Variability', type: 'B', isInlineManual: true, isManual: true,
      distribution: 'Rectangular', originalInput: { tolerance: { floor: { high: 5, low: -5, unit: 'ppm', distribution: '1.732' } } } });
    expect(row.value).toBeCloseTo(5/Math.sqrt(3), 8);
    expect(row.value_native).toBeCloseTo(10*5/Math.sqrt(3)*1e-6, 12);
    expect(second.components[1].value_native).toBeCloseTo(2*row.value_native, 12);
    const draft = getInlineManualDraft(row);
    const edited = normalizeInlineManualComponent({ component: row, referencePoint: first.testPointInfo.parameter,
      draft: { ...draft, tolerance: { floor: { ...draft.tolerance.floor, high: 9, low: -9 } } } });
    first.components[1] = edited;
    expect(computeUncertaintyForPoint(first,session).combined_uncertainty_absolute_base)
      .toBeCloseTo(Math.hypot(2,9/Math.sqrt(3),Math.SQRT2/Math.sqrt(12))*10e-6, 12);
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
    expect(session.tmdes).toHaveLength(2);
    session.testPoints.forEach((point,index) => {
      const rows = resolvePointBudgetComponents(point,session);
      expect(rows).toHaveLength(4);
      expect(rows[2].value).toBeCloseTo([38,35,46][index]/1.96, 7);
      expect(rows[2].tmdeBudgetSourceId).toBe(session.tmdes[0].id);
      expect(isPpmBudget(rows)).toBe(true);
    });
    expect(JSON.stringify(reference)).toBe(before);
  });
  it('adds exactly one generic reader for Y5020 regardless of physical reader serials or other library meters', () => {
    const source = snapshot([{current:10,frequency:1000},{current:20,frequency:1000}]);
    source.instruments.standard_reader_serial = '4449302';
    source.instruments.test_reader_serial = 'OTHER';
    const duplicates = [generic5790, {...generic5790,id:'legacy-meter'}, {...generic5790,id:'local-copy',scope:'local'}];
    const before = JSON.stringify(duplicates);
    const {session} = buildAcShuntBudget(source, {instruments:duplicates});
    expect(session.tmdes).toHaveLength(1);
    expect(formatInstrumentIdentity(session.tmdes[0])).toBe('Fluke 5790B');
    expect(session.tmdes[0].instrument.sourceId).toBe(generic5790.id);
    expect(session.tmdes[0].measurementAreaNames).toEqual(['Current']);
    for (const point of session.testPoints) {
      const rows = resolvePointBudgetComponents(point, session).filter(row => row.isResolution);
      expect(rows).toHaveLength(1);
      expect(rows[0].pendingReason).toBeNull();
      const current = point.testPointInfo.parameter.value;
      expect(rows[0].value).toBeCloseTo(Math.SQRT2*1e-7/(current*.01)/Math.sqrt(12)*1e6, 10);
      expect(rows[0].tmdeBudgetSourceId).toBe(session.tmdes[0].id);
    }
    expect(JSON.stringify(duplicates)).toBe(before);
  });
  it.each(['A40B', 'A40B-20A', 'Other'])('does not add a 5790 instrument or resolution for %s', model => {
    const source = snapshot();
    source.instruments.test_instrument_model = model;
    const {session} = buildAcShuntBudget(source, {instruments:[generic5790]});
    expect(session.tmdes).toEqual([]);
    expect(session.testPoints[0].components).toHaveLength(2);
    expect(session.testPoints[0].components.some(row => row.y5020Resolution)).toBe(false);
  });
  it('recalculates the linked resolution and risk after editing the TMDE resolution and saving', () => {
    const session = JSON.parse(JSON.stringify(buildAcShuntBudget(snapshot(), {instruments:[reference]}).session));
    const point = session.testPoints[0];
    const before = computeUncertaintyForPoint(point,session).combined_uncertainty_absolute_base;
    const risk = computePointRiskMetrics(point,session);
    const meter = session.tmdes.find(item => item.instrument.id === generic5790.id);
    const range = meter.instrument.functions[0].ranges[1];
    expect(range.resolution).toBe(1e-7);
    range.resolution = 1e-5;
    const rows = resolvePointBudgetComponents(point,session);
    expect(rows.at(-1).value).toBeCloseTo(Math.SQRT2*100/Math.sqrt(12), 9);
    expect(computeUncertaintyForPoint(point,session).combined_uncertainty_absolute_base).toBeGreaterThan(before);
    expect(computePointRiskMetrics(point,session).tur).toBeLessThan(risk.tur);
    range.resolution = '';
    expect(resolvePointBudgetComponents(point,session).at(-1).pendingReason).toMatch(/Set the resolution/);
    expect(computeUncertaintyForPoint(point,session)).toBeNull();
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
  it.each(['NIST reference AC shunt · 20 A', 'Fluke Y5020 · REF NIST reference AC shunt · 20 A'])('keeps the TMDE description separate from make/model: %s', description => {
    const {session} = buildAcShuntBudget(snapshot(), {instruments:[{...reference,description}]});
    expect(session.tmdes[0].name).toBe(description);
    expect(formatInstrumentIdentity(session.tmdes[0])).toBe('Fluke Y5020 · REF NIST reference AC shunt · 20 A');
    const rows = resolvePointBudgetComponents(session.testPoints[0],session);
    expect(rows[2].name.match(/Fluke Y5020 · REF/g)).toHaveLength(1);
    expect(session.tmdes[0].libraryInstrumentId).toBe('ref');
  });
  it('does not guess among duplicate reference identities', () => {
    const duplicate = { ...reference, id:'other' };
    expect(buildAcShuntBudget(snapshot(),{instruments:[reference,duplicate]}).referenceId).toBe('');
    expect(buildAcShuntBudget(snapshot(),{instruments:[reference,duplicate]}).warnings.join(' ')).toContain('Add your reference instrument');
  });
  it('rejects missing points and invalid point coordinates', () => {
    expect(()=>buildAcShuntBudget(snapshot([]))).toThrow(/no measurement points/);
    expect(()=>buildAcShuntBudget(snapshot([{current:10,frequency:null}]))).toThrow(/positive current and frequency/);
  });
});
