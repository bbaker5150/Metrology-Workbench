import { suppliedCase } from '../src/modules/uncertainty/utils/risk8/suppliedBiasParity.fixtures.js';

// The same two physical sources remain in the budget for both source and net
// modes. Splitting the rectangular uncertainty by sqrt(2) preserves the
// workbook's combined standard uncertainty, independently of the bias inputs.
// Their worst-case error spans add, so TAR is 4/sqrt(2), not the single-source
// workbook TAR=4. TAR is a specification-bound metric, not a bias calculation.
export function multiSourceCase(vector, derived = false) {
  const { point, session } = suppliedCase(vector);
  session.tmdes = ['first', 'second'].map((name, index) => ({
    id: name, description: `Reference ${name}`, measurementAreaNames: ['Voltage'],
    ranges: [{ id: `${name}-range`, min: 0, max: 200, unit: 'V', tolerances: {
      floor: { low: -2.5 / Math.sqrt(2), high: 2.5 / Math.sqrt(2), symmetric: true, unit: 'V', distribution: '1.732' },
      bias: { value: index === 0 ? 30 : vector.calBias * 100 - 30, kind: 'percent', unit: 'V' },
    } }],
  }));
  point.components = session.tmdes.map(source => ({ id: `component-${source.id}`, name: source.description,
    tmdeBudgetSourceId: source.id, tmdeBudgetRangeId: source.ranges[0].id, tmdeBudgetComponentKind: 'Accuracy',
    ...(derived ? { variableType: source.id } : {}),
  }));
  if (derived) Object.assign(point, { measurementType: 'derived', equationString: 'a+b', variableMappings: { a: 'first', b: 'second' },
    variableNominals: { a: { value: 40, unit: 'V' }, b: { value: 60, unit: 'V' } } });
  return { point, session };
}
