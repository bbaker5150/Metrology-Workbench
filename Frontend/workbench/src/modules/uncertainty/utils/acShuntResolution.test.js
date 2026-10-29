import { describe, it, expect } from 'vitest';
import { buildAcShuntBudget } from './acShuntBudget';
import { resolvePointBudgetComponents } from './resolvePointBudgetComponents';
import { isPpmBudget } from './budgetDisplay';

const phases = Object.fromEntries(['std', 'ti'].flatMap(side => ['ac_open', 'ac_close', 'dc_pos', 'dc_neg'].map(phase => [`${side}_${phase}`, phase === 'dc_neg' ? -1 : 1])));
const observation = { direction: 'Forward', cycleIndex: 1, phases, eta_std: 1, eta_ti: 1, rangeMode: '2.2', filterMode: 'FAST', hiresEnabled: true };
const reader = (serial = '', model = '5790B') => ({ id: `reader-${serial}`, scope: 'validated', manufacturer: 'Fluke', model, serialNumber: serial,
  functions: ['AC', 'DC'].map(mode => ({ id: mode, name: `${mode} Voltage`, unit: 'V', ranges: [{
    id: `${mode}-2.2`, min: 0, max: 2.2, unit: 'V', measuringResolution: 1e-7, measuringResolutionUnit: 'V',
    measuringResolutionDistribution: '3.464', includeResolutionInBudget: true,
    fluke5790Resolution: { highResolutionVolts: 1e-7, normalResolutionVolts: 1e-6 },
    tolerances: { reading: { high: 999, unit: 'ppm', distribution: '1.732' } },
  }] })) });
const shunt = (id, type) => ({ id, scope: 'validated', type, model: 'Y5020', serialNumber: id,
  functions: [{ id: 'current', name: 'Current', unit: 'A', ranges: [{ id: '10', min: 10, max: 10, unit: 'A',
    tolerances: { reading: { high: type === 'uut' ? 100 : 35, unit: 'ppm', distribution: '1.960' } } }] }] });
function build({ observations = [observation], models = {}, readers = [reader()], current = 10 } = {}) {
  return buildAcShuntBudget({ id: 1, name: 'Resolution test', instruments: {
    test_instrument_model: 'Y5020', test_instrument_serial: 'ti', standard_instrument_model: 'Y5020', standard_instrument_serial: 'ref',
    standard_reader_model: '5790B', standard_reader_serial: 'STD', test_reader_model: '5790B', test_reader_serial: 'TI', ...models,
  }, points: [{ current, frequency: 1000, sourcePointIds: [1, 2], readerPoints: observations,
    analytics: { pair_delta_uut_ppm: 3, pair_type_a_uncertainty_ppm: 2, n_pairs_used: 4 } }] },
  { instruments: [shunt('ti', 'uut'), shunt('ref', 'tmde'), ...readers] });
}
const resolved = session => resolvePointBudgetComponents(session.testPoints[0], session).filter(c => c.isResolution);

describe('5790 resolution in AC-shunt budgets', () => {
  it('propagates volts through the ratios, includes only resolution and keeps automatic ppm display', () => {
    const { session, warnings } = build();
    const rows = resolved(session);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(2);
    // Four |d(Vac/Vdc)/dVphase| = 0.5 / V at 1 V. Conservative
    // fully correlated phase sum: 2 * 0.1 microvolt / sqrt(12).
    for (const row of rows) {
      expect(row.value).toBeCloseTo(2 * .1 / Math.sqrt(12), 12);
      expect(row.value_native).toBeCloseTo(row.value * 10e-6, 15);
      expect(row.toleranceLimit_native).toBeCloseTo(10e-7, 15);
      expect(row.tmdeTransferSources).toHaveLength(4);
      expect(row.pendingReason).toBeNull();
    }
    expect(isPpmBudget(resolvePointBudgetComponents(session.testPoints[0], session))).toBe(true);
    expect(session.tmdes).toHaveLength(3);
  });
  it('uses saved HIRES and filter settings and supports the 5790A', () => {
    const normal = resolved(build({ observations: [{ ...observation, hiresEnabled: false }] }).session)[0].value;
    for (const settings of [{ hiresEnabled: true }, { hiresEnabled: false, filterMode: 'MEDIUM' }, { hiresEnabled: false, filterMode: 'SLOW' }]) {
      expect(resolved(build({ observations: [{ ...observation, ...settings }] }).session)[0].value).toBeCloseTo(normal / 10, 12);
    }
    const { session } = build({ models: { standard_reader_model: '5790A', test_reader_model: '34420A' }, readers: [reader('', '5790A')] });
    expect(resolved(session)).toHaveLength(1);
    expect(resolved(session)[0].name).toContain('5790A');
  });
  it('does not count repeated cycles twice or reduce resolution with sqrt(N), and conservatively combines a shared reader', () => {
    const value = resolved(build().session)[0].value;
    const { session } = build({ observations: [observation, { ...observation, direction: 'Reverse', cycleIndex: 2 }],
      models: { test_reader_serial: 'STD' } });
    expect(resolved(session)).toHaveLength(1);
    expect(resolved(session)[0].value).toBeCloseTo(value * 2, 12);
    expect(session.tmdes).toHaveLength(2);
  });
  it('keeps phase sensitivities tied to the saved voltages and eta, not nominal current alone', () => {
    const { session } = build({ observations: [{ ...observation, phases: Object.fromEntries(Object.entries(phases).map(([key, value]) => [key, value / 2])), eta_std: 2 }] });
    const [std, ti] = resolved(session);
    expect(ti.value).toBeCloseTo(std.value * 2, 12);
  });
  it('refreshes imported resolution from live linked library ranges without changing reader accuracy', () => {
    const { session } = build();
    const before = resolved(session)[0].value;
    const meter = session.tmdes[1];
    for (const fn of meter.instrument.functions) for (const row of fn.ranges) {
      row.measuringResolution *= 2;
      row.includeResolutionInBudget = false; // Explicit budget row remains opted in.
    }
    expect(resolved(session)[0].value).toBeCloseTo(before * 2, 12);
    expect(resolved(session)[1].value).toBeCloseTo(before, 12);
    expect(meter.instrument.functions[0].ranges[0].tolerances.reading.high).toBe(999);
  });
  it.each([
    ['missing phase data', []],
    ['missing one phase', [{ ...observation, phases: { ...phases, std_ac_open: null } }]],
    ['AUTO range', [{ ...observation, rangeMode: 'AUTO' }]],
    ['missing HIRES/filter', [{ ...observation, hiresEnabled: null, filterMode: null }]],
    ['missing fixed range', [{ ...observation, rangeMode: null }]],
  ])('keeps %s incomplete through subsequent recalculations', (_, observations) => {
    const { session, warnings } = build({ observations });
    expect(warnings.length).toBeGreaterThan(0);
    const row = resolved(session)[0];
    expect(row.pendingReason).toBeTruthy();
    expect(row.value_native).toBeNull();
    expect(row.tmdeTransferSources).toBeUndefined();
  });
  it('never substitutes another serial or ambiguous model-only definitions', () => {
    for (const readers of [[reader('OTHER')], [reader(), { ...reader(), id: 'duplicate' }]]) {
      expect(resolved(build({ readers }).session).every(row => row.pendingReason)).toBe(true);
    }
    expect(resolved(build({ readers: [reader('STD'), reader('TI')] }).session).every(row => !row.pendingReason)).toBe(true);
  });
});
