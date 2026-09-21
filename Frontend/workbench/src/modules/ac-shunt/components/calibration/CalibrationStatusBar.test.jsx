import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { gsap } from 'gsap';
import CalibrationStatusBar from './CalibrationStatusBar';

vi.mock('gsap', () => ({gsap:{fromTo:vi.fn(), to:vi.fn(), timeline:vi.fn(), set:vi.fn()}}));

it('updates live samples without restarting text or progress animations', () => {
  const props = {
    activeRunningTP:{current:1, frequency:1000}, formatCurrent:String, formatFrequency:String,
    isCollecting:true, timerState:{isActive:false}, collectionProgress:{count:1},
    getStageName:() => 'AC Open', calibrationSettings:{num_samples:10, n_cycles:2},
    selectedTPs:new Set(), dropdownOptions:[],
  };
  const view = render(<CalibrationStatusBar {...props} />);
  const detail = screen.getByText('1 / 10 Samples');
  view.rerender(<CalibrationStatusBar {...props} collectionProgress={{count:2}} />);
  expect(screen.getByText('2 / 10 Samples')).toBe(detail);
  expect(screen.getByRole('progressbar')).toHaveStyle({width:'20%'});
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','20');
  view.rerender(<CalibrationStatusBar {...props} collectionProgress={{count:11}} />);
  expect(screen.getByRole('progressbar')).toHaveStyle({width:'100%'});
  for (const fn of Object.values(gsap)) expect(fn).not.toHaveBeenCalled();
});
