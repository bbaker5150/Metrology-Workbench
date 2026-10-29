import React, { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import UncertaintyBudgetTable from './UncertaintyBudgetTable';
import { InlineToleranceCell, applyToleranceCaseChange, getSpecRows } from './UncertaintyPanel';
import { normalizeInlineManualComponent } from '../utils/manualComponentUtils';
import { switchBudgetUncertaintyKind } from '../utils/switchBudgetUncertaintyKind';
vi.mock('plotly.js-dist', () => ({ default: {} }));

it('switches a budget manual source through the shared table/equation editors and retains each draft', async () => {
  const referencePoint = { value: 10, unit: 'A' };
  let saved;
  function Harness() {
    const [component, setComponent] = useState(() => normalizeInlineManualComponent({ component: { id: 'parity' }, referencePoint,
      draft: { name: 'Variability', type: 'B', unit: 'ppm', inputMode: 'tolerance', errorDistributionDivisor: '1.732',
        tolerance: { floor: { high: 5, low: -5, unit: 'ppm', symmetric: true, distribution: '1.732' } } } }));
    saved = component;
    return <><button>Outside</button><UncertaintyBudgetTable components={[component]} referencePoint={referencePoint}
      ToleranceEditorComponent={InlineToleranceCell} applyToleranceChange={applyToleranceCaseChange} formatToleranceSummary={getSpecRows}
      onComponentUpdate={(id, update) => setComponent(current => update.uncertaintyKind
        ? switchBudgetUncertaintyKind(current, update.uncertaintyKind, referencePoint, update.typeDraft)
        : update.inlineManualDraft ? normalizeInlineManualComponent({ component: current, draft: update.inlineManualDraft, referencePoint })
          : { ...current, ...update })} /></>;
  }
  const { container } = render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit tolerance' }));
  const selectKind = label => {
    fireEvent.click(screen.getByRole('button', { name: 'Change uncertainty type' }));
    fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
    expect(container.querySelector('.instrument-tolerance-toolbar')).toBeInTheDocument();
  };
  selectKind('Table');
  expect(screen.getByRole('group', { name: 'Tabular uncertainty editor' })).toBeInTheDocument();
  fireEvent.paste(screen.getByLabelText('Measurement point row 1'), { clipboardData: { getData: () => '10\t.1\n20\t.2' } });
  expect(screen.getByLabelText('Uncertainty row 2')).toHaveValue('.2');
  expect(within(container.querySelector('.dynamic-tolerance-cell')).queryByRole('status')).toBeNull();
  selectKind('Equation');
  fireEvent.change(screen.getByLabelText('Uncertainty equation'), { target: { value: 'x * a' } });
  fireEvent.change(screen.getByLabelText('a nominal'), { target: { value: '.3' } });
  selectKind('Manual');
  expect(saved.originalInput.tolerance.floor.high).toBe(5);
  expect(saved.name).toBe('Variability');
  selectKind('Table');
  expect(screen.getByLabelText('Uncertainty row 2')).toHaveValue('.2');
  selectKind('Equation');
  expect(screen.getByLabelText('Uncertainty equation')).toHaveValue('x * a');
  expect(screen.getByLabelText('a nominal')).toHaveValue('.3');
  fireEvent.change(screen.getByLabelText('a nominal'), { target: { value: '.4' } });
  fireEvent.keyDown(screen.getByLabelText('a nominal'), { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Equation uncertainty editor' })).toBeNull());
  expect(saved.dynamicDefinition.variables.a.value).toBe('.4');
  expect(saved.dynamicDefinition.distribution).toBe('1.732');
});
