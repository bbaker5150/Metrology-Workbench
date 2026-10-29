export const generic5790 = {
  id: 'fluke-5790b-generic', manufacturer: 'Fluke', model: '5790B', description: '',
  type: 'tmde', scope: 'validated', measurementArea: 'Voltage',
  generic5790: { version: 1, serialIndependent: true },
  functions: ['medium-slow', 'fast'].map(mode => ({
    id: `fluke-5790b-generic-${mode}`, name: `Voltage (${mode})`, unit: 'V',
    ranges: [.22, 2.2].map(value => ({
      id: `fluke-5790b-generic-${mode}-${value}`, min: 0, max: value, unit: 'V',
      resolution: mode === 'fast' && value === 2.2 ? 1e-6 : 1e-7, resolutionUnit: 'V',
      resolutionDistribution: '3.464', includeResolutionInBudget: true, tolerances: {},
    })),
  })),
};
export const nominalY5020Resolution = current => ({
  method: 'independent-phase-rounding-max-cycle', nominalVoltageFallback: true,
  cases: [{ functionId: 'fluke-5790b-generic-medium-slow', rangeId: 'fluke-5790b-generic-medium-slow-2.2',
    ppmPerVolt: Math.SQRT2 * 1e6 / (current * .01) }],
});
