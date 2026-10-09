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
