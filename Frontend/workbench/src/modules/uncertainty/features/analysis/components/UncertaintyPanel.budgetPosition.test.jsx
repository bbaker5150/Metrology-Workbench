import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import UncertaintyPanel from './UncertaintyPanel';
vi.mock('plotly.js-dist', () => ({ default: {} }));

it('keeps Add open through a layout-anchored scroll but closes it when the trigger moves with scrolling', () => {
  const point = { id: 'p', measurementType: 'direct', testPointInfo: { parameter: { name: 'Voltage', value: 10, unit: 'V' } }, components: [] };
  const { container } = render(<div className="analysis-content"><UncertaintyPanel testPointData={point}
    sessionData={{ id: 's', uuts: [], tmdes: [], testPoints: [point], measurementAreas: [], uncReq: {} }}
    uutNominal={point.testPointInfo.parameter} tmdeTolerancesData={[]} onAddManualComponent={vi.fn()}
    calcResults={{ combined_uncertainty: 0, expanded_uncertainty: 0, k_value: 2, effective_dof: Infinity }} /></div>);
  const trigger = screen.getByRole('button', { name: 'Add component to budget' });
  let top = 300;
  trigger.getBoundingClientRect = () => ({ left: 700, right: 724, top, bottom: top + 24 });
  fireEvent.click(trigger);
  const menu = screen.getByRole('dialog', { name: 'Add component to budget' });
  const scroller = container.querySelector('.analysis-content');
  scroller.scrollTop = 24; top += .8;
  fireEvent.scroll(scroller);
  expect(menu).toBeInTheDocument();
  // A subsequent viewport resize refreshes the stored screen anchor.
  top = 260; fireEvent(window, new Event('resize'));
  scroller.scrollTop = 28; top += .8;
  fireEvent.scroll(scroller);
  expect(menu).toBeInTheDocument();
  scroller.scrollTop = 68; top -= 40;
  fireEvent.scroll(scroller);
  expect(menu).not.toBeInTheDocument();
});
