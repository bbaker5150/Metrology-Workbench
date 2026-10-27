import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UncertaintyBudgetTable from './UncertaintyBudgetTable';
import { normalizeInlineManualComponent } from '../utils/manualComponentUtils';
import { createDynamicDefinition, createDynamicComponent } from '../../../utils/dynamicBudgetComponents';
import { getBudgetComponentsFromTolerance } from '../utils/budgetUtils';

const components = [{ id: 'reader', name: 'Reader uncertainty', type: 'B', isCore: true,
  value_native: .00002, unit_native: 'A', distribution: 'Normal', distributionDivisor: 2 }];
const calcResults = { combined_uncertainty: .00002, expanded_uncertainty: .00004, k_value: 2, effective_dof: 9 };

function Budget({ initialMode = 'absolute', value = 10, measurementType = 'direct', onChange = () => {}, ...props }) {
  const [mode, setMode] = useState(initialMode);
  return <UncertaintyBudgetTable components={components} calcResults={calcResults}
    referencePoint={{ name: 'Current', value, unit: 'A' }} measurementType={measurementType}
    uncertaintyDisplayMode={mode} onUncertaintyDisplayModeChange={next => { setMode(next); onChange(next); }} {...props} />;
}

describe('direct budget display selection', () => {
  it('automatically displays an all-ppm budget in ppm, retaining an explicit absolute override', () => {
    const rows = [35, 5].flatMap((value, index) => getBudgetComponentsFromTolerance({ id: `source${index}`,
      floor: { high: value, low: -value, unit: 'ppm', distribution: '1.960' } }, { value: 10, unit: 'A' }));
    expect(rows).toHaveLength(2);
    const combined = Math.hypot(...rows.map(row => row.value_native));
    const results = { ...calcResults, combined_uncertainty: combined, expanded_uncertainty: combined * 1.96, k_value: 1.96 };
    const { container } = render(<Budget initialMode="auto" components={rows} calcResults={results} riskResults={{ pfa: 2.263, pfr: 3.636, tur: 4 }} />);
    expect(screen.getByRole('option', { name: 'Auto (ppm)' })).toBeInTheDocument();
    expect(within(container.querySelector('.budget-results-card')).getByText('18.038438 ppm')).toBeInTheDocument();
    const riskBefore = container.querySelector('.budget-decision-zoom-surface').textContent;
    fireEvent.change(screen.getByLabelText('Uncertainty display'), { target: { value: 'absolute' } });
    expect(within(container.querySelector('.budget-results-card')).getByText('0.00018038438 A')).toBeInTheDocument();
    expect(container.querySelector('.budget-decision-zoom-surface').textContent).toBe(riskBefore);
  });
  it('uses absolute display automatically for mixed source units', () => {
    const manual = normalizeInlineManualComponent({ component: { id: 'ppm' }, referencePoint: { value: 10, unit: 'A' },
      draft: { name: 'Relative source', type: 'A', inputMode: 'standard', standardUncertainty: 2, unit: 'ppm' } });
    const { container } = render(<Budget initialMode="auto" components={[manual, ...components]} />);
    expect(screen.getByRole('option', { name: 'Auto (absolute)' })).toBeInTheDocument();
    expect(within(container.querySelector('.budget-results-card')).getByText('0.00002 A')).toBeInTheDocument();
  });
  it('converts manual and equation-based standard uncertainties without modifying their definitions', () => {
    const point = { value: 10, unit: 'A' };
    const manual = normalizeInlineManualComponent({ component: { id: 'manual' }, referencePoint: point,
      draft: { name: 'AC/DC repeatability', type: 'A', inputMode: 'standard', standardUncertainty: 2, unit: 'ppm' } });
    const definition = { ...createDynamicDefinition('equation', { unit: 'A' }), name: 'Equation source',
      mode: 'standard', distribution: '1', equation: 'x*0.000002', pointVariable: 'x', variables: { x: { value: 10 } } };
    const dynamic = createDynamicComponent(definition);
    const sourceRows = [manual, dynamic];
    const before = JSON.stringify(sourceRows);
    render(<Budget initialMode="ppm" components={sourceRows} />);
    const manualRow = screen.getByText('AC/DC repeatability').closest('tr');
    expect(within(manualRow).getByText('± 2.000 ppm')).toBeInTheDocument();
    const equationRow = screen.getByText('Equation source').closest('tr');
    expect(within(equationRow).getByText('± 2 ppm')).toBeInTheDocument();
    expect(JSON.stringify(sourceRows)).toBe(before);
  });
  it('switches standard uncertainties and results to ppm without changing source data', () => {
    const before = JSON.stringify({ components, calcResults });
    const onChange = vi.fn();
    const { container } = render(<Budget onChange={onChange} />);
    const results = container.querySelector('.budget-results-card');
    expect(within(results).getByText('0.00002 A')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Uncertainty display'), { target: { value: 'ppm' } });
    expect(onChange).toHaveBeenCalledWith('ppm');
    expect(within(results).getByText('2 ppm')).toBeInTheDocument();
    expect(within(results).getByText('4 ppm')).toBeInTheDocument();
    expect(within(screen.getByText('Reader uncertainty').closest('tr')).getByText('± 2.000 ppm')).toBeInTheDocument();
    expect(JSON.stringify({ components, calcResults })).toBe(before);
    fireEvent.change(screen.getByLabelText('Uncertainty display'), { target: { value: 'absolute' } });
    expect(within(results).getByText('0.00004 A')).toBeInTheDocument();
  });
  it('restores a saved relative display and references negative points by magnitude', () => {
    const { container } = render(<Budget initialMode="ppm" value={-10} />);
    expect(screen.getByLabelText('Uncertainty display')).toHaveValue('ppm');
    expect(within(container.querySelector('.budget-results-card')).getByText('2 ppm')).toBeInTheDocument();
  });
  it('falls back to absolute display at zero and disables relative mode', () => {
    const { container } = render(<Budget initialMode="ppm" value={0} />);
    expect(screen.getByLabelText('Uncertainty display')).toHaveValue('absolute');
    expect(screen.getByRole('option', { name: 'Relative (ppm)' })).toBeDisabled();
    expect(within(container.querySelector('.budget-results-card')).getByText('0.00002 A')).toBeInTheDocument();
  });
  it('leaves derived budgets unchanged', () => {
    render(<Budget measurementType="derived" initialMode="ppm" />);
    expect(screen.queryByLabelText('Uncertainty display')).not.toBeInTheDocument();
  });
});
