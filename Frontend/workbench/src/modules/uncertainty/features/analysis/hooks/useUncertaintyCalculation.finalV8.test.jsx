import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useUncertaintyCalculation } from './useUncertaintyCalculation';

// Final v8.00 frmCalEquationUncertainty.CalculateFirstOrderVarianceAndSensitivity
// rejects an invalid correlation matrix before publishing a budget. Verify the
// live hook clears the formerly valid totals used by risk, not just the helper.
it('clears stale uncertainty after invalid correlation, preserves source rows, and recovers', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const mappings = { a: 'A', b: 'B', c: 'C' };
  const nominal = { value: 30, unit: 'V' };
  const variableNominals = Object.fromEntries(Object.keys(mappings).map(key => [key, { value: 10, unit: 'V' }]));
  const sources = Object.entries(mappings).map(([symbol, name]) => ({
    id: symbol, name: `Source ${name}`, variableType: name,
    measurementPoint: { value: 10, unit: 'V' },
    reading: { high: 1, low: -1, unit: '%', distribution: '1', symmetric: true },
  }));
  const session = { uncReq: { uncertaintyConfidence: 95 } };
  const tolerance = {}, manual = [];
  let point = { id: 'v8-correlation', measurementType: 'derived', equationString: 'a+b+c',
    variableMappings: mappings, variableNominals, inputCorrelations: {}, useEffectiveDofByGroup: {} };
  const save = vi.fn(patch => { point = { ...point, ...patch }; });
  const { result, rerender } = renderHook(({ correlations }) => useUncertaintyCalculation(
    { ...point, inputCorrelations: correlations }, session, sources, tolerance, nominal, manual, save,
  ), { initialProps: { correlations: {} } });
  try {
    await waitFor(() => expect(point.is_detailed_uncertainty_calculated).toBe(true));
    const goodExpanded = point.expanded_uncertainty_absolute_base;
    expect(goodExpanded).toBeGreaterThan(0);
    // Every pair is individually in [-1,1], and c^T R c is positive for
    // c=[1,1,1], but the complete matrix has a negative eigenvalue.
    rerender({ correlations: { 'A|B': .9, 'A|C': .9, 'B|C': -.9 } });
    await waitFor(() => expect(result.current.calculationError).toBe('The correlation matrix is not physically valid.'));
    expect(point).toMatchObject({ is_detailed_uncertainty_calculated: false,
      combined_uncertainty: null, combined_uncertainty_absolute_base: null,
      expanded_uncertainty: null, expanded_uncertainty_absolute_base: null,
      effective_dof: null, k_value: null, risk8MonteCarloResult: null });
    expect(result.current.calcResults.calculatedBudgetComponents.length).toBeGreaterThan(0);
    rerender({ correlations: {} });
    await waitFor(() => expect(point.is_detailed_uncertainty_calculated).toBe(true));
    expect(result.current.calculationError).toBeNull();
    expect(point.expanded_uncertainty_absolute_base).toBeCloseTo(goodExpanded, 10);
  } finally { errors.mockRestore(); }
});
