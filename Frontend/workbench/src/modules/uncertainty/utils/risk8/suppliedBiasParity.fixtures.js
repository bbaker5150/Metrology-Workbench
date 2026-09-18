// Reconstruct the supplied workbook inputs without importing the risk engine.
export function suppliedCase(vector, unit = 'V', kind = 'percent') {
  const h = 10;
  const tolerance = vector.type <= 2
    ? { floor: { low: vector.low - 100, high: vector.high - 100, symmetric: vector.type === 1, unit } }
    : { singleSided: { direction: vector.type % 2 ? 'low' : 'high', measurement: vector.type > 4 ? 'unknown' : 'known', limit: vector.low ?? vector.high, unit } };
  const range = { id: 'uut-range', unit, tolerances: { ...tolerance, bias: { value: vector.uutBias * (kind === "percent" ? 100 : h), kind, unit } } };
  const source = { id: 'reference-range', unit, tolerances: {
    floor: { low: -2.5, high: 2.5, symmetric: true, unit, distribution: '1.732' },
    bias: { value: vector.calBias * (kind === "percent" ? 100 : h), kind, unit },
  } };
  const point = { id: 'point', measurementType: 'direct', testPointInfo: { parameter: { value: 100, unit } },
    associatedUutIds: ['uut'], uutTolerance: { ...range, ...range.tolerances, rangeId: range.id },
    components: [{ id: 'component', tmdeBudgetSourceId: 'reference', tmdeBudgetRangeId: source.id, tmdeBudgetComponentKind: 'Accuracy' }] };
  const session = { uuts: [{ id: 'uut', ranges: [range] }], tmdes: [{ id: 'reference', ranges: [source] }],
    uncReq: { uncertaintyConfidence: 95, reliability: 85, calInt: 12, measRelCalcAssumed: 85, neededTUR: 4, reqPFA: 2, guardBandMultiplier: 1 } };
  return { point, session };
}
