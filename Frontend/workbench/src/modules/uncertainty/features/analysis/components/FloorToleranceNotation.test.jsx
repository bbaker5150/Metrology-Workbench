import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { InlineToleranceCell, applyToleranceCaseChange, applyToleranceEditorMode, getSpecRows } from './UncertaintyPanel';
import { calculateUncertaintyFromToleranceObject, getToleranceSummary } from '../../../utils/uncertaintyMath';

vi.mock('plotly.js-dist', () => ({default:{}}));

const initial = {floor:{high:'0.1',low:'-0.1',unit:'ft',symmetric:true,distribution:'1.732'}};
function Harness({saved = initial}) {
  const [tolerance,setTolerance] = useState(saved);
  return <><output data-testid="saved">{JSON.stringify(tolerance)}</output><InlineToleranceCell
    tolerance={tolerance} activeRange={{id:'range',unit:'ft',max:'10'}} editable
    onCommit={(key,component)=>setTolerance(current=>applyToleranceCaseChange(current,key,component))}/></>;
}

it.each(['3.472e-9','3.472E-09','0.000000003472','0.00001'])('retains authored floor notation %s after editing, serialization, and reopening', raw => {
  const mounted=render(<Harness/>);
  fireEvent.click(screen.getByTitle('Edit tolerance'));
  const input=mounted.container.querySelectorAll('.inline-tolerance-term')[2].querySelector('input.inline-tolerance-input');
  fireEvent.change(input,{target:{value:raw}});fireEvent.blur(input);
  const saved=JSON.parse(screen.getByTestId('saved').textContent);
  expect(saved.floor).toMatchObject({high:raw,low:`-${raw}`,unit:'ft'});
  expect(getSpecRows(saved,'ft')).toEqual([`± ${raw} ft`]);
  expect(getToleranceSummary(saved)).toBe(`±${raw} ft`);
  const [entered, numeric] = [saved, {floor:{...saved.floor,high:Number(raw),low:-Number(raw)}}]
    .map(tolerance=>calculateUncertaintyFromToleranceObject(tolerance,{value:1,unit:'ft'},true));
  expect(entered).toEqual(numeric);
  mounted.unmount();
  const reopened=render(<Harness saved={saved}/>);
  expect(screen.getByTitle('Edit tolerance')).toHaveTextContent(raw);
  fireEvent.click(screen.getByTitle('Edit tolerance'));
  expect(reopened.container.querySelectorAll('.inline-tolerance-term')[2].querySelector('input.inline-tolerance-input')).toHaveValue(raw);
});

it('replaces scientific notation with decimal when the user retypes the same magnitude', () => {
  const {container}=render(<Harness saved={{floor:{...initial.floor,high:'1e-9',low:'-1e-9'}}}/>);
  fireEvent.click(screen.getByTitle('Edit tolerance'));
  const input=container.querySelectorAll('.inline-tolerance-term')[2].querySelector('input.inline-tolerance-input');
  fireEvent.change(input,{target:{value:'0.000000001'}});fireEvent.blur(input);
  const saved=JSON.parse(screen.getByTestId('saved').textContent);
  expect(saved.floor.high).toBe('0.000000001');
  expect(getSpecRows(saved,'ft')).toEqual(['± 0.000000001 ft']);
});

it('preserves tiny asymmetric bounds, explicit zero, and notation through shape changes', () => {
  const asymmetric={floor:{...initial.floor,high:'3.472e-12',low:'-0.000000000001234',symmetric:false}};
  expect(getSpecRows(asymmetric,'ft')).toEqual(['(+3.472e-12/-0.000000000001234) ft']);
  const symmetric=applyToleranceEditorMode(asymmetric,{shape:'symmetric'});
  expect(symmetric.floor).toMatchObject({high:'3.472e-12',low:'-3.472e-12'});
  const restored=applyToleranceEditorMode(symmetric,{shape:'asymmetric'});
  expect(restored.floor).toMatchObject({high:'3.472e-12',low:'-3.472e-12'});
  expect(getSpecRows({floor:{...initial.floor,high:'0',low:'-3.472e-12',symmetric:false}},'ft')).toEqual(['(+0/-3.472e-12) ft']);
  expect(getSpecRows({floor:{...initial.floor,high:'0e-9',low:'0e-9'}},'ft')).toEqual(['± 0e-9 ft']);
  expect(getSpecRows({floor:{...initial.floor,high:3.472e-9,low:-3.472e-9}},'ft')).toEqual(['± 0.000000003472 ft']);
  expect(getSpecRows({floor:{...initial.floor,high:'3.472e-13',low:'',thresholdSide:'high',symmetric:false}},'ft')).toEqual(['≤ +3.472e-13 ft']);
  expect(getSpecRows({floor:{...initial.floor,high:'',low:'-3.472e-13',thresholdSide:'low',symmetric:false}},'ft')).toEqual(['≥ −3.472e-13 ft']);
});

it.each([
  ['-0.13','-0.14','-0.13','-0.14'],
  ['0.14','0.13','+0.14','+0.13'],
  ['-1.3e-4','-1.4e-4','-1.3e-4','-1.4e-4'],
  ['1.4E-4','1.3E-4','+1.4E-4','+1.3E-4'],
  ['1.3e-4','-1.4e-4','+1.3e-4','-1.4e-4'],
])('preserves signed floor bounds %s / %s in summaries and rendered stacks', (high, low, shownHigh, shownLow) => {
  const tolerance={floor:{...initial.floor,high,low,symmetric:false}};
  expect(getSpecRows(tolerance,'ft')).toEqual([`(${shownHigh}/${shownLow}) ft`]);
  expect(getToleranceSummary(tolerance)).toBe(`${shownHigh}/${shownLow} ft`);
  const {container}=render(<Harness saved={tolerance}/>);
  const stack=container.querySelector('.stacked-tolerance-limits');
  expect(stack).toHaveAttribute('aria-label',`Upper limit ${shownHigh}; lower limit ${shownLow}`);
  expect([...stack.children].map(node=>node.textContent)).toEqual([shownHigh,shownLow]);
  const {breakdown}=calculateUncertaintyFromToleranceObject(tolerance,{value:0,unit:'ft'},true);
  expect(breakdown).toHaveLength(1);
  expect(breakdown[0].absoluteHigh).toBeCloseTo(Number(high),12);
  expect(breakdown[0].absoluteLow).toBeCloseTo(Number(low),12);
});
