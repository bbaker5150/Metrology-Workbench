import { describe, it, expect } from 'vitest';
import { buildAcShuntBudget } from './acShuntBudget';
import { resolvePointBudgetComponents } from './resolvePointBudgetComponents';
import { isPpmBudget } from './budgetDisplay';
import { getInstrumentRangeRows } from './instrumentFunctionSelection';
import { getBudgetRangeWarnings } from './pointDiagnostics';

// Match the existing authored AC/DC-difference library shape, not a fabricated
// AC/DC voltage catalog: one 200 ppm range and a normal resolution field.
const reader = (serial = '', model = '5790B') => ({ id: `reader-${serial}`, scope: 'local', manufacturer: 'Fluke', model, serialNumber: serial,
  functions: [{ id: 'difference', name: 'AC/DC Difference', unit: 'ppm', ranges: [{
    id: 'existing-200-ppm', min: 0, max: 200, unit: 'ppm', measuringResolution: 1e-7, measuringResolutionUnit: 'V',
    measuringResolutionDistribution: '3.464', includeResolutionInBudget: true,
    tolerances: { reading: { high: 999, unit: 'ppm', distribution: '1.732' } },
  }] }] });
const shunt = (id, type) => ({ id, scope: 'validated', type, model: 'Y5020', serialNumber: id,
  functions: [{ id: 'current', name: 'Current', unit: 'A', ranges: [{ id: '10', min: 10, max: 10, unit: 'A',
    tolerances: { reading: { high: type === 'uut' ? 100 : 35, unit: 'ppm', distribution: '1.960' } } }] }] });
function build({ resolution = { std: { ppmPerVolt: 2e6, rangeVolts: 2.2 }, ti: { ppmPerVolt: 2e6, rangeVolts: 2.2 } },
  models = {}, readers = [reader()], current = 10 } = {}) {
  return buildAcShuntBudget({ id: 1, name: 'Resolution test', instruments: {
    test_instrument_model: 'Y5020', test_instrument_serial: 'ti', standard_instrument_model: 'Y5020', standard_instrument_serial: 'ref',
    standard_reader_model: '5790B', standard_reader_serial: '4449302', test_reader_model: '5790B', test_reader_serial: '4449302', ...models,
  }, points: [{ current, frequency: 1000, sourcePointIds: [1, 2], readerResolution: resolution,
    analytics: { pair_delta_uut_ppm: 3, pair_type_a_uncertainty_ppm: 2, n_pairs_used: 4 } }] },
  { instruments: [shunt('ti', 'uut'), shunt('ref', 'tmde'), ...readers] });
}
const resolved = session => resolvePointBudgetComponents(session.testPoints[0], session).filter(c => c.isResolution);

describe('5790 resolution from existing instruments', () => {
  it('imports the local instrument into TMDE with its existing populated resolution range and a normal linked budget row', () => {
    const definition = reader();
    const before = JSON.stringify(definition);
    const { session, warnings } = build({ readers: [definition] });
    expect(warnings).toEqual([]);
    expect(session.tmdes).toHaveLength(2);
    const meter = session.tmdes[1];
    expect(meter.libraryInstrumentId).toBe(definition.id);
    expect(meter.instrument.scope).toBe('local');
    expect(meter.instrument.functions).toEqual(definition.functions);
    const [range] = getInstrumentRangeRows(meter);
    expect(range).toMatchObject({ rangeId: 'existing-200-ppm', measuringResolution: 1e-7, measuringResolutionUnit: 'V', includeResolutionInBudget: true });
    const [row] = resolved(session);
    expect(resolved(session)).toHaveLength(1);
    expect(row).toMatchObject({ tmdeBudgetSourceId: meter.id, tmdeBudgetRangeId: range.rangeId, tmdeBudgetComponentKind: 'Resolution', pendingReason: null });
    expect(row.tmdeTransferSources).toBeUndefined();
    expect(row.value).toBeCloseTo(.4 / Math.sqrt(12), 12);
    expect(row.value_native).toBeCloseTo(row.value * 10e-6, 15);
    expect(session.testPoints[0].combined_uncertainty_absolute_base).toBeCloseTo(
      Math.hypot(2, 5 / Math.sqrt(3), 35 / 1.96, .4 / Math.sqrt(12)) * 10e-6, 12);
    expect(row.authoredTolerance.floor.high).toBeCloseTo(.2, 12);
    expect(row.originalInput.toleranceLimit).toBeCloseTo(.2, 12);
    expect(getBudgetRangeWarnings({ components: resolved(session), tmdes: session.tmdes, directNominal: { value: 10, unit: 'A' } })).toEqual({});
    expect(isPpmBudget(resolvePointBudgetComponents(session.testPoints[0], session))).toBe(true);
    expect(JSON.stringify(definition)).toBe(before);
  });
  it.each([
    { model: '5790B', description: '4449302' },
    { model: '4449302', description: 'Fluke 5790B' },
    { model: '5790B · 4449302', description: '' },
    { model: 'Fluke 5790 B', description: '' },
  ])('matches existing library naming $model / $description', identity => {
    const { session, warnings } = build({ readers: [{ ...reader(), ...identity }] });
    expect(warnings).toEqual([]);
    expect(session.tmdes[1].instrument.model).toBe(identity.model);
    expect(resolved(session)[0].value).toBeGreaterThan(0);
  });
  it('uses the visible local copy of a shared model and preserves its resolution', () => {
    const shared = { ...reader(), id: 'shared', scope: 'validated' };
    const local = { ...reader(), id: 'local', sourceId: shared.id };
    local.functions[0].ranges[0].measuringResolution = 2e-7;
    const { session } = build({ readers: [shared, local] });
    expect(session.tmdes[1].libraryInstrumentId).toBe('local');
    expect(resolved(session)[0].value).toBeCloseTo(.8 / Math.sqrt(12), 12);
  });
  it('uses distinct reader definitions once each and supports the 5790A', () => {
    const { session } = build({ models: { test_reader_model: '5790A', test_reader_serial: '4449303' },
      readers: [reader('4449302'), reader('4449303', '5790A')] });
    expect(session.tmdes).toHaveLength(3);
    for (const row of resolved(session)) expect(row.value).toBeCloseTo(.2 / Math.sqrt(12), 12);
  });
  it('recalculates directly from resolution edits on the TMDE and retains its accuracy terms', () => {
    const { session } = build();
    const before = resolved(session)[0].value;
    const range = session.tmdes[1].instrument.functions[0].ranges[0];
    range.measuringResolution *= 2;
    range.includeResolutionInBudget = false; // Explicit budget row remains included.
    expect(resolved(session)[0].value).toBeCloseTo(before * 2, 12);
    expect(range.tolerances.reading.high).toBe(999);
    range.measuringResolution = '';
    expect(resolved(session)[0].pendingReason).toMatch(/Set the resolution/);
    expect(resolved(session)[0].value_native).toBeNull();
    expect(getBudgetRangeWarnings({ components: resolved(session), tmdes: session.tmdes, directNominal: { value: 10, unit: 'A' } }).final[0].reason).toMatch(/Set the resolution/);
  });
  it('does not create an orphan budget source or repeat matching warnings for every point', () => {
    expect(() => build({ readers: [] })).toThrow(/unique existing/);
    expect(() => build({ readers: [reader('OTHER')] })).toThrow(/unique existing/);
    expect(() => build({ readers: [reader(), { ...reader(), id: 'duplicate' }] })).toThrow(/unique existing/);
    const empty = reader();
    empty.functions[0].ranges[0].measuringResolution = '';
    expect(() => build({ readers: [empty] })).toThrow(/Set resolution on the existing/);
  });
  it('does not invent a volts-to-ppm conversion when the saved observations are incomplete', () => {
    expect(() => build({ resolution: { std: { ppmPerVolt: null }, ti: { ppmPerVolt: 2e6 } } })).toThrow(/Saved reader voltages/);
  });
});
