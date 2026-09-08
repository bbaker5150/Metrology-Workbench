import { describe, expect, it } from 'vitest';
import { instrumentFunctions, resolveSessionFunctions } from './functionGrouping';
import {
  migrateMeasurementAreas, resolveSessionMeasurementAreas, measurementAreaKeyOf,
  addInstrumentMeasurementArea, renameMeasurementArea, deleteMeasurementArea,
} from './measurementAreaGrouping';

const device = (id, name, unit) => ({ id, instrument: {
  id: `library-${id}`, scope: 'validated',
  functions: [{ id: name, name, ranges: [{ id: `${id}-range`, min: 0, max: 10, unit }] }],
} });
const session = () => ({
  measurementAreaGroups: [{ name: 'Torque', kind: 'uut', color: '#abcdef', pointCreationSettings: { mode: 'derived' } },
    { name: 'Torque', kind: 'tmde', color: '#abcdef' }],
  uuts: [{ ...device('u1', 'Length', 'm'), measurementAreaNames: ['Torque', 'Inspection'] }],
  tmdes: [{ ...device('t1', 'Weight', 'kg'), measurementAreaNames: ['Torque'] }],
  testPoints: [{ id: 'p1', associatedUutIds: ['u1'], testPointInfo: {
    measurementArea: 'Torque', parameter: { name: 'Torque', value: 5, unit: 'N·m' },
  } }],
});

describe('user measurement areas', () => {
  it('groups different instrument functions together without deriving extra groups', () => {
    const data = session();
    expect(resolveSessionMeasurementAreas(data).map(a => a.name)).toEqual(['Torque', 'Inspection']);
    expect(resolveSessionMeasurementAreas(data, { kind: 'tmde' }).map(a => a.name)).toEqual(['Torque']);
    expect(instrumentFunctions(data.uuts[0])[0].name).toBe('Length');
    expect(instrumentFunctions(data.tmdes[0])[0].name).toBe('Weight');
    expect(measurementAreaKeyOf(data.testPoints[0])).toBe('torque');
  });

  it('renames both tables and sidebar without rewriting any specification or parameter', () => {
    const data = session();
    const next = renameMeasurementArea(data, { key: 'torque', kind: 'uut' }, 'Lever calibration');
    expect(next.uuts[0].measurementAreaNames).toEqual(['Lever calibration', 'Inspection']);
    expect(next.tmdes[0].measurementAreaNames).toEqual(['Lever calibration']);
    expect(next.testPoints[0].testPointInfo.measurementArea).toBe('Lever calibration');
    expect(next.testPoints[0].testPointInfo.parameter).toEqual(data.testPoints[0].testPointInfo.parameter);
    expect(next.uuts[0].instrument).toBe(data.uuts[0].instrument);
    expect(next.tmdes[0].instrument).toBe(data.tmdes[0].instrument);
    expect(next.measurementAreaGroups[0].pointCreationSettings).toEqual({ mode: 'derived' });
    expect(resolveSessionMeasurementAreas(next)[0].color).toBe('#abcdef');
  });

  it('adds an area assignment on drag, keeping the shared instrument definition intact', () => {
    const data = session();
    const next = addInstrumentMeasurementArea(data.tmdes[0], { name: 'Inspection', key: 'inspection' });
    expect(next.measurementAreaNames).toEqual(['Torque', 'Inspection']);
    expect(next.instrument).toBe(data.tmdes[0].instrument);
    expect(addInstrumentMeasurementArea(next, { name: 'Inspection' })).toBe(next);
  });

  it('deletes a table area while retaining other memberships and complete instrument definitions', () => {
    const data = session();
    const next = deleteMeasurementArea(data, { key: 'torque', kind: 'uut' });
    expect(next.uuts[0].measurementAreaNames).toEqual(['Inspection']);
    expect(next.uuts[0].instrument).toBe(data.uuts[0].instrument);
    expect(next.tmdes).toBe(data.tmdes);
    expect(next.testPoints).toEqual([]);
    expect(next.measurementAreaGroups.map(a => a.kind)).toEqual(['tmde']);
  });

  it('migrates legacy groups once, preserving order, colors, settings and multi-function membership', () => {
    const uut = device('u1', 'Length', 'm');
    uut.instrument.functions.push(device('u2', 'Weight', 'kg').instrument.functions[0]);
    const legacy = { functionGroups: [{ name: 'Weight', kind: 'uut', color: '#123456', pointCreationSettings: { mode: 'derived' } }],
      uuts: [uut], tmdes: [], testPoints: [{ id: 1, testPointInfo: { parameter: { name: 'Weight', unit: 'kg' } } }] };
    const next = migrateMeasurementAreas(legacy);
    expect(next.uuts[0].measurementAreaNames).toEqual(['Length', 'Weight']);
    expect(next.uuts[0].instrument).toBe(uut.instrument);
    expect(resolveSessionMeasurementAreas(next).map(a => [a.key, a.color]))
      .toEqual(resolveSessionFunctions(legacy).map(a => [a.key, a.color]));
    expect(next.measurementAreaGroups[0].pointCreationSettings).toEqual({ mode: 'derived' });
    const reloaded = JSON.parse(JSON.stringify(next));
    reloaded.uuts[0].instrument.functions[0].name = 'Changed in builder';
    expect(migrateMeasurementAreas(reloaded)).toBe(reloaded);
    expect(resolveSessionMeasurementAreas(reloaded).map(a => a.name)).toEqual(['Weight', 'Length']);
  });

  it('does not infer a new session row area from the picked instrument function', () => {
    const next = migrateMeasurementAreas({ measurementAreaGroups: [], uuts: [device('u', 'Length', 'm')] });
    expect(next.uuts[0].measurementAreaNames).toEqual(['Measurement']);
    expect(resolveSessionMeasurementAreas(next).map(a => a.name)).toEqual(['Measurement']);
  });
});
