import { describe, expect, it } from 'vitest';
import vectors from './biasWorkflowVectors.json';
import { workflows } from '../../../../../scripts/risk-bias-cases.mjs';
import { biasFixture } from '../measurementBias.fixtures';
import { resolveMeasurementBias } from '../measurementBias';
import { copyPointBudget, pastePointBudget } from '../../App';
import { runRisk8FromApp } from './riskAdapter8';
import { computeOneRow } from './computeOneRow8';
import { computeUnknownMeasurementBoundary8 } from './unknownMeasurementRisk8';

// The numeric oracle is Excel's private ComputeOneRow, captured read-only with
// full-precision Value2. The companion script hand-defines native bias totals
// and normalized K/L independently of the app; never regenerate expected values
// by evaluating this module or the JS risk engine.
const compareOutputs = (actual, vector) => {
  for (const [key, expected] of Object.entries(vector.expected)) {
    if (typeof expected === 'number') {
      expect(actual[key], `${vector.id}/${key}`).toBeTypeOf('number');
      expect(Math.abs(actual[key] - expected), `${vector.id}/${key}`)
        .toBeLessThanOrEqual(1e-10 + Math.abs(expected) * 1e-8);
    } else expect(actual[key], `${vector.id}/${key}`).toBe(expected);
  }
};

function makeWorkflow(id) {
  let { point, session } = biasFixture();
  session.uuts = [{ id: 'uut', ranges: [{ id: 'range', unit: 'A',
    tolerances: { bias: { value: 1, kind: 'percent', unit: 'A' } } }] }];
  point.activeUutId = 'uut';
  point.uutTolerance.rangeId = 'range';
  if (id === 'point-negative' || id === 'point-zero')
    point.uutBias = { mode: 'override', value: id === 'point-zero' ? 0 : -.4, unit: 'A' };
  if (id === 'source-corrected') point.measurementBias = { sources: {
    'tmde:resistance::resistance-range:Resistance': { value: .002, unit: 'Ohm', corrected: true },
  } };
  if (id.startsWith('manual-')) point.measurementBias = {
    mode: 'manual', value: -.3, unit: 'A', corrected: id === 'manual-corrected',
  };
  if (id === 'copied-point' || id === 'edited-copy') {
    point.measurementBias = { mode: 'sources', sources: {
      'tmde:voltage::voltage-range:Voltage': { value: 1, kind: 'percent', unit: 'V' },
    } };
    const target = { ...point, id: 'destination', uutBias: { mode: 'override', value: .4, unit: 'A' },
      variableNominals: { V: { value: 2, unit: 'V' }, R: { value: .1, unit: 'Ohm' } },
      testPointInfo: { parameter: { value: 20, unit: 'A' } } };
    point = pastePointBudget(target, copyPointBudget(point));
    if (id === 'edited-copy') {
      point.variableNominals.V.value = 3;
      point.testPointInfo.parameter.value = 30;
    }
    // Also verify persistence does not serialize a stale computed contribution.
    point = JSON.parse(JSON.stringify(point));
  }
  return { point, session };
}

describe('native bias workflow to actual Beta.7 workbook outputs', () => {
  it.each(vectors.cases.filter(v => !v.id.startsWith('unknown/')))('$id', vector => {
    const workflow = workflows.find(w => vector.id.startsWith(`${w.id}/`));
    const { point, session } = makeWorkflow(workflow.id);
    const bias = resolveMeasurementBias(point, session, workflow.nominal);
    expect(bias.error).toBeNull();
    expect(bias.uutBias).toBeCloseTo(workflow.uut, 12);
    expect(bias.calBias).toBeCloseTo(workflow.system, 12);
    const i = vector.input;
    const result = runRisk8FromApp({ nominal: point.testPointInfo.parameter.value,
      riskAverage: bias.riskAverage, calBias: bias.calBias,
      uutLowerLimit: i.lowerLimit, uutUpperLimit: i.upperLimit, initialGB: i.initialGB,
      uCalNative: i.uCal, tur: i.tur, assumedReop: i.reop, requiredReop: i.reopTarget,
      turNeeded: i.turNeeded, originalInterval: i.originalInterval, reqPFA: i.pfaTarget,
      decayModel: i.decayModel, weibullBeta: i.weibullBeta, resolution: i.resolution });
    expect(result.meta.mu).toBeCloseTo(workflow.mu, 12);
    expect(result.meta.xcal).toBeCloseTo(workflow.xcal, 12);
    compareOutputs(result.out, vector);
  });

  it.each(vectors.cases.filter(v => v.id.endsWith('/original')))('documents the unknown boundary extension: $id', original => {
    const [, direction, biasText] = original.id.split('/');
    const translated = vectors.cases.find(v => v.id === original.id.replace('/original', '/translated'));
    const bias = Number(biasText);
    // Literal backend parity is maintained: the workbook ignores K/L for 5/6.
    compareOutputs(computeOneRow(original.input), original);
    compareOutputs(computeOneRow({ ...original.input, xcal: 0 }), original);
    const result = computeUnknownMeasurementBoundary8({
      tolerance: { singleSided: { measurement: 'unknown', direction, limit: 10 } },
      uCalNative: .1, reqPFA: .02, calBias: bias, resolution: original.input.resolution,
    });
    // App extension matches Excel only after explicitly translating its physical
    // input. Retain the original true limit and prove the unchanged input differs.
    compareOutputs(result.out, translated);
    const key = direction === 'low' ? 'physGbLower' : 'physGbUpper';
    expect(result.out[key]).not.toBeCloseTo(original.expected[key], 10);
    expect(result[direction === 'low' ? 'lowerLimit' : 'upperLimit']).toBe(10);
  });
});
