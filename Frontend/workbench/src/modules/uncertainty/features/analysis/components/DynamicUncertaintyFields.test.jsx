import React, {useState} from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import DynamicUncertaintyFields from './DynamicUncertaintyFields';
import {createDynamicDefinition} from '../../../utils/dynamicBudgetComponents';

function Harness() {
  const [definition,setDefinition] = useState(createDynamicDefinition('equation',{value:20,unit:'A'}));
  return <DynamicUncertaintyFields definition={definition} referencePoint={{value:20,unit:'A'}} onChange={patch=>setDefinition(previous=>({...previous,...patch}))} UnitSelectComponent={()=>null}/>;
}
it.each(['Enter','blur'])('shows compact KaTeX after %s and reopens the unchanged equation for editing', async method=>{
  render(<Harness/>);
  const input=screen.getByRole('textbox',{name:'Uncertainty equation'});
  fireEvent.change(input,{target:{value:'a+b'}});
  if(method==='Enter') fireEvent.keyDown(input,{key:'Enter'}); else fireEvent.blur(input);
  const summary=await screen.findByRole('button',{name:'Edit uncertainty equation'});
  expect(summary.querySelector('.katex')).not.toBeNull();
  expect(screen.queryByRole('textbox',{name:'Uncertainty equation'})).toBeNull();
  fireEvent.click(summary);
  expect(screen.getByRole('textbox',{name:'Uncertainty equation'})).toHaveValue('a+b');
});
it('leaves incomplete equations editable on blur and Enter',()=>{
  render(<Harness/>);
  const input=screen.getByRole('textbox',{name:'Uncertainty equation'});
  fireEvent.change(input,{target:{value:'a+'}});
  fireEvent.blur(input); fireEvent.keyDown(input,{key:'Enter'});
  expect(input).toHaveAttribute('aria-invalid','true');
  expect(screen.queryByRole('button',{name:'Edit uncertainty equation'})).toBeNull();
});
it('opens and focuses from a KaTeX glyph without bubbling into the surrounding editor', async()=>{
  const parentClick=vi.fn(), parentPress=vi.fn();
  render(<div onClick={parentClick} onMouseDown={parentPress}><Harness/></div>);
  const input=screen.getByRole('textbox',{name:'Uncertainty equation'});
  fireEvent.change(input,{target:{value:'a+b'}}); fireEvent.keyDown(input,{key:'Enter'});
  const glyph=screen.getByRole('button',{name:'Edit uncertainty equation'}).querySelector('.katex .mord');
  fireEvent.mouseDown(glyph); fireEvent.click(glyph);
  expect(screen.getByRole('textbox',{name:'Uncertainty equation'})).toHaveFocus();
  expect(parentClick).not.toHaveBeenCalled(); expect(parentPress).not.toHaveBeenCalled();
});

it('does not collapse a refocused equation when a queued blur finishes', async()=>{
 render(<Harness/>);
 const input=screen.getByRole('textbox',{name:'Uncertainty equation'});
 fireEvent.change(input,{target:{value:'a+b'}});
 input.focus(); fireEvent.blur(input); fireEvent.focus(input);
 await new Promise(resolve=>requestAnimationFrame(resolve));
 expect(screen.getByRole('textbox',{name:'Uncertainty equation'})).toHaveValue('a+b');
});

it('shows the submitted equation as text or KaTeX without changing it', () => {
  const definition = { ...createDynamicDefinition('equation', { unit: 'V' }),
    equation: '2*x', variables: { x: { name: 'Input', value: '5' } } };
  const save = vi.fn();
  render(<DynamicUncertaintyFields definition={definition} readOnly onChange={save} showPreview={false} />);
  const input = screen.getByRole('textbox', { name: 'Uncertainty equation' });
  expect(input).toHaveAttribute('readonly');
  expect(screen.getByRole('textbox', { name: 'x nominal' })).toHaveValue('5');
  fireEvent.keyDown(input, { key: 'Enter' });
  const summary = screen.getByRole('button', { name: 'View uncertainty equation' });
  expect(summary.querySelector('.katex')).toBeInTheDocument();
  fireEvent.click(summary);
  expect(screen.getByRole('textbox', { name: 'Uncertainty equation' })).toHaveValue('2*x');
  expect(save).not.toHaveBeenCalled();
});

it('lets reviewers inspect tabular values without changing cells or adding rows', () => {
  const definition = createDynamicDefinition('table', { value: 10, unit: 'V' });
  definition.rows[0].values = { [definition.columns[0].id]: { value: '0.25' } };
  const save = vi.fn();
  render(<DynamicUncertaintyFields definition={definition} readOnly onChange={save} showPreview={false} />);
  const value = screen.getByRole('textbox', { name: 'Uncertainty row 1' });
  expect(value).toHaveValue('0.25');
  expect(value).toHaveAttribute('readonly');
  expect(screen.getByRole('button', { name: 'Add table row after row 1' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Point unit' })).toBeDisabled();
  expect(screen.getByTitle('Asymmetric tolerance')).toBeDisabled();
  fireEvent.paste(value, { clipboardData: { getData: () => '1\t2\n3\t4' } });
  fireEvent.keyDown(value, { key: 'Tab' });
  expect(screen.queryByRole('textbox', { name: 'Uncertainty row 2' })).toBeNull();
  expect(save).not.toHaveBeenCalled();
});
