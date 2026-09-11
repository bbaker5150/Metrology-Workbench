import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import CalibrationChart from './CalibrationChart';
const captured = vi.hoisted(() => ({ data: null }));
vi.mock('react-chartjs-2', () => ({
  Line: ({ data }) => { captured.data = data; return <div />; },
  Bar: ({ data }) => { captured.data = data; return <div />; },
}));
const data = { datasets: [{ label: 'AC Open', data: [
  {x:1,y:1,cycle:1}, {x:2,y:1,cycle:1}, {x:3,y:1,cycle:1},
  {x:4,y:2,cycle:2,is_stable:false}, {x:5,y:2,cycle:2},
] }] };
const props = { chartData:data, theme:'dark', chartType:'line', title:'Standard', instrumentType:'std' };
it('submits the displayed cycle and cycle-local sample range after switching cycles', () => {
  const save=vi.fn();
  const { rerender, container }=render(<CalibrationChart {...props} selectedCycle={1} onMarkStability={save} />);
  fireEvent.click(screen.getByTitle('Update Reading Stability'));
  expect(container.querySelector('input[name="end"]')).toHaveValue(3);
  rerender(<CalibrationChart {...props} selectedCycle={2} onMarkStability={save} />);
  expect(container.querySelector('input[name="end"]')).toHaveValue(2);
  fireEvent.click(screen.getByRole('button', {name:/Apply/i}));
  expect(save).toHaveBeenCalledWith({type:'AC Open',start:1,end:2,mark_as:'unstable',cycle:2},'std');
});
it('keeps original sample numbers when unstable samples are hidden and rejects out-of-range edits', () => {
  const {container}=render(<CalibrationChart {...props} selectedCycle={2} onMarkStability={vi.fn()} />);
  fireEvent.click(screen.getByTitle('Update Reading Stability'));
  const checkbox=screen.getByLabelText('Hide Unstable Readings');
  if (!checkbox.checked) fireEvent.click(checkbox);
  expect(captured.data.datasets[0].data.map(p=>p.x)).toEqual([2]);
  fireEvent.change(container.querySelector('input[name="end"]'),{target:{value:'3'}});
  expect(screen.getByRole('button',{name:/Apply/i})).toBeDisabled();
});
it('resolves auto to the active cycle when submitting', () => {
  const save=vi.fn();
  render(<CalibrationChart {...props} activeCycle={2} onMarkStability={save} />);
  fireEvent.click(screen.getByTitle('Update Reading Stability'));
  fireEvent.click(screen.getByRole('button',{name:/Apply/i}));
  expect(save.mock.calls[0][0].cycle).toBe(2);
});
