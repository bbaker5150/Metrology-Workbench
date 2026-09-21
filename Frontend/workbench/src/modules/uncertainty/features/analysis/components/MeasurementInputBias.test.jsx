import { it, expect } from 'vitest';
import { hasMeasurementInputBias } from './MeasurementInputBias';
import { biasFixture } from '../../../utils/measurementBias.fixtures';
it('hides absent input bias, but retains explicit zero, cancelling sources and net bias', () => {
  const { point, session } = biasFixture();
  const variables = [{ symbol: 'V', name: 'Voltage' }, { symbol: 'R', name: 'Resistance' }];
  expect(hasMeasurementInputBias(point, session, variables)).toBe(true);
  for (const tmde of session.tmdes) delete tmde.instrument.functions[0].ranges[0].tolerances.bias;
  point.uutBias = { mode: 'override', value: 2, kind: 'percent' };
  expect(hasMeasurementInputBias(point, session, variables)).toBe(false);
  session.tmdes[0].instrument.functions[0].ranges[0].tolerances.bias = { value: 0, kind: 'percent' };
  expect(hasMeasurementInputBias(point, session, variables)).toBe(true);
  delete session.tmdes[0].instrument.functions[0].ranges[0].tolerances.bias;
  point.measurementBias = { mode: 'manual', value: 0, kind: 'percent' };
  expect(hasMeasurementInputBias(point, session, variables)).toBe(true);
});
