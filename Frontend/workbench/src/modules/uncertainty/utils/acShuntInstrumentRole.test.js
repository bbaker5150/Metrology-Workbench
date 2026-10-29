import { describe, expect, it } from 'vitest';
import { instrumentForRole } from './acShuntInstrumentRole';
import { buildAcShuntBudget } from './acShuntBudget';
import { buildSyncPayload, computeSyncState } from './instrumentSync';
import { reconcileImportedInstruments } from './importedInstrumentLibrary';
import { addLibraryInstrumentRows } from './libraryInstrumentDrag';
import { matchAcShuntInstrument } from './acShuntLibrary';

const functions = ppm => [{ id: 'current', name: 'Current', unit: 'A', ranges: [{
  id: '3:1000', value: 3, min: 3, max: 3, unit: 'A', isSingleValue: true,
  qualifier: { value: 1000, min: 1000, max: 1000, unit: 'Hz', isSingleValue: true },
  tolerances: { reading: { high: ppm, low: -ppm, unit: 'ppm', symmetric: true, distribution: ppm === 100 ? 'not_set' : '1.960' } },
}] }];
const shunt = () => ({ id: 'physical', manufacturer: 'Fluke', model: 'A40B', description: '450274742 5 A NIST',
  scope: 'validated', type: 'tmde', functions: functions(22),
  acShuntIdentity: { model: 'A40B', serial: '450274742', shuntRange: 5, isManual: false,
    roles: ['tmde', 'uut'], uutFunctions: functions(100), calibrationEvidence: [{ report: { id: 8 } }] },
});
const reading = item => item.functions[0].ranges[0].tolerances.reading.high;

describe('one shunt library entry with separate role specifications', () => {
  it('imports both roles from one physical definition and preserves the shared link on save', () => {
    const shared = shunt();
    const before = structuredClone(shared);
    const result = buildAcShuntBudget({ id: 1, name: 'Run', instruments: {
      test_instrument_model: 'A40B', test_instrument_serial: '450274742', standard_instrument_model: 'A40B',
      standard_instrument_serial: '450274742', shuntRange: 5, referenceReportIds: [8],
    }, points: [{ current: 3, frequency: 1000, sourcePointIds: [1, 2], analytics: {
      pair_delta_uut_ppm: 1, pair_type_a_uncertainty_ppm: 2, n_pairs_used: 4,
    } }] }, { instruments: [shared] });
    expect(result.uutInstrumentId).toBe('physical');
    expect(result.referenceId).toBe('physical');
    expect(reading(result.session.uuts[0].instrument)).toBe(100);
    expect(reading(result.session.tmdes[0].instrument)).toBe(22);
    expect(result.session.testPoints[0].uutTolerance.tolerances.reading.high).toBe(100);
    expect(result.warnings).toEqual([]);
    const restored = reconcileImportedInstruments(result.session, { sharedInstruments: [shared] }).session;
    expect(restored.uuts[0].instrument.sourceId).toBe('physical');
    expect(computeSyncState(restored.uuts[0].instrument)).toBe('green');
    expect(shared).toEqual(before);
  });

  it('uses 100 ppm for a UUT drop and reported uncertainty for a TMDE drop', () => {
    const source = shunt();
    const session = { uuts: [], tmdes: [], testPoints: [], measurementAreas: [] };
    const uut = addLibraryInstrumentRows(session, [source], 'uut').uuts[0];
    const ref = addLibraryInstrumentRows(session, [source], 'tmde').tmdes[0];
    expect(reading(uut.instrument)).toBe(100);
    expect(reading(ref.instrument)).toBe(22);
    expect(computeSyncState(uut.instrument)).toBe('green');
  });

  it('synchronizes edited TI limits without overwriting the reference specification', () => {
    const ti = instrumentForRole(shunt(), 'uut');
    ti.functions[0].ranges[0].tolerances.reading.high = 90;
    const payload = buildSyncPayload(ti, 'password');
    expect(reading(payload)).toBe(22);
    expect(payload.acShuntIdentity.uutFunctions[0].ranges[0].tolerances.reading.high).toBe(90);
    expect(payload.type).toBe('tmde');
    const restored = instrumentForRole(payload, 'uut');
    expect(reading(restored)).toBe(90);
    expect(computeSyncState(restored)).toBe('green');
  });

  it('uses a saved baseline report over a manual default and retains manual matching for legacy sessions', () => {
    const base = shunt();
    const manual = { ...shunt(), id: 'manual', description: '450274742 5 A MANUAL',
      acShuntIdentity: { ...shunt().acShuntIdentity, isManual: true, calibrationEvidence: [{ report: { id: 99 } }] } };
    const role = { kind: 'shunt', model: 'A40B', serial: '450274742', shuntRange: 5 };
    expect(matchAcShuntInstrument(role, [base, manual]).id).toBe('manual');
    expect(matchAcShuntInstrument({ ...role, reportIds: [8] }, [base, manual]).id).toBe('physical');
    expect(matchAcShuntInstrument({ ...role, reportIds: [99] }, [base, manual]).id).toBe('manual');
  });
});
