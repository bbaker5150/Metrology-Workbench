import React, {useState} from 'react';
import {fireEvent, render, screen, within} from '@testing-library/react';
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
  fireEvent.change(input,{target:{value:'a/b_t'}});
  if(method==='Enter') fireEvent.keyDown(input,{key:'Enter'}); else fireEvent.blur(input);
  const summary=await screen.findByRole('button',{name:'Edit uncertainty equation'});
  expect(summary.querySelector('.katex')).not.toBeNull();
  expect(summary.querySelector('.katex-display .mfrac')).not.toBeNull();
  expect(summary.querySelector('.msupsub')).not.toBeNull();
  expect(screen.queryByRole('textbox',{name:'Uncertainty equation'})).toBeNull();
  fireEvent.click(summary);
  expect(screen.getByRole('textbox',{name:'Uncertainty equation'})).toHaveValue('a/b_t');
});
it('leaves incomplete equations editable on blur and Enter',()=>{
  render(<Harness/>);
  const input=screen.getByRole('textbox',{name:'Uncertainty equation'});
  fireEvent.change(input,{target:{value:'a+'}});
  fireEvent.blur(input); fireEvent.keyDown(input,{key:'Enter'});
  expect(input).toHaveAttribute('aria-invalid','true');
  expect(screen.queryByRole('button',{name:'Edit uncertainty equation'})).toBeNull();
});

it('shows every link until the user chooses one and restores fixed values on unlink', () => {
  render(<Harness/>);
  fireEvent.change(screen.getByRole('textbox', {name:'Uncertainty equation'}), {target:{value:'x * a'}});
  const links = () => screen.getAllByRole('button', {name:/Use measurement point for/});
  expect(links()).toHaveLength(2);
  expect(links().every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true);
  const name = screen.getByRole('textbox', {name:'x name'}), value = screen.getByRole('textbox', {name:'x nominal'});
  expect(name).toHaveAttribute('placeholder','Description');
  expect(value).toHaveAttribute('placeholder','Value');
  expect(name).toHaveAttribute('data-has-value','false');
  expect(value).toHaveAttribute('data-has-value','false');
  fireEvent.change(name,{target:{value:'Fixed offset'}});
  fireEvent.change(value,{target:{value:'0'}});
  expect(name).toHaveAttribute('data-has-value','true');
  expect(value).toHaveAttribute('data-has-value','true');
  fireEvent.click(screen.getByRole('button',{name:'Use measurement point for x'}));
  expect(links()).toHaveLength(1);
  expect(links()[0]).toHaveAttribute('aria-pressed','true');
  expect(screen.queryByRole('button',{name:'Use measurement point for a',hidden:true})).toBeNull();
  fireEvent.click(links()[0]);
  expect(links()).toHaveLength(2);
  expect(screen.getByRole('textbox',{name:'x nominal'})).toHaveValue('0');
  expect(name).toHaveValue('Fixed offset');
  fireEvent.click(screen.getByRole('button',{name:'Use measurement point for a'}));
  expect(links().map(button=>button.getAttribute('aria-label'))).toEqual(['Use measurement point for a']);
});

it.each(['missing','stale'])('shows all link controls for a saved %s binding', binding => {
  const definition={...createDynamicDefinition('equation',{unit:'V'}), equation:'a+b',
    pointVariable:binding==='stale'?'removed':undefined,variables:{a:{name:'A',value:0},b:{name:'B',value:2}}};
  render(<DynamicUncertaintyFields definition={definition} referencePoint={{value:20,unit:'V'}} onChange={vi.fn()} UnitSelectComponent={()=>null}/>);
  expect(screen.getAllByRole('button',{name:/Use measurement point for/})).toHaveLength(2);
  expect(screen.getByRole('textbox',{name:'a nominal'})).toHaveValue('0');
  expect(screen.getByRole('textbox',{name:'a nominal'})).toHaveAttribute('data-has-value','true');
});

it.each(['tolerance','limits'])('clears a removed linked variable without retargeting in %s equations and retains its cached fixed input', mode => {
  function Equation(){
    const [definition,save]=useState({...createDynamicDefinition('equation',{unit:'V'}),mode,
      equation:'x+a',lowerEquation:'x+a',upperEquation:'b',pointVariable:'x',
      variables:{x:{name:'Original input',value:'7'},a:{name:'Offset',value:'2'},...(mode==='limits'?{b:{name:'Upper',value:'3'}}:{})}});
    return <DynamicUncertaintyFields definition={definition} referencePoint={{value:20,unit:'V'}} UnitSelectComponent={()=>null}
      onChange={patch=>save(previous=>({...previous,...patch}))}/>;
  }
  render(<Equation/>);
  expect(screen.getAllByRole('button',{name:/Use measurement point for/})).toHaveLength(1);
  const equation=screen.getByRole('textbox',{name:mode==='limits'?'Low error limit equation':'Uncertainty equation'});
  fireEvent.change(equation,{target:{value:'a'}});
  expect(screen.queryByRole('button',{name:'Use measurement point for x'})).toBeNull();
  expect(screen.getAllByRole('button',{name:/Use measurement point for/})).toHaveLength(mode==='limits'?2:1);
  fireEvent.change(equation,{target:{value:'x+a'}});
  expect(screen.getByRole('button',{name:'Use measurement point for x'})).toHaveAttribute('aria-pressed','false');
  expect(screen.getByRole('textbox',{name:'x nominal'})).toHaveValue('7');
  expect(screen.getByRole('textbox',{name:'x name'})).toHaveValue('Original input');
});

it('shows the evaluated scale only on the linked variable and keeps result units separate', () => {
  function UnitPicker({ ariaLabel, value, onChange }) {
    return <select aria-label={ariaLabel} value={value} onChange={event => onChange(event.target.value)}>
      {['V', 'mV'].map(unit => <option key={unit}>{unit}</option>)}
    </select>;
  }
  function Equation() {
    const [definition, save] = useState({
      ...createDynamicDefinition('equation', { unit: 'V' }), mode: 'standard',
      equation: 'x * a', pointVariable: 'x', variables: { x: { name: 'Point', value: '' }, a: { name: 'Factor', value: '2' } },
    });
    return <DynamicUncertaintyFields definition={definition} referencePoint={{ value: 500, unit: 'mV' }}
      UnitSelectComponent={UnitPicker} onChange={patch => save(previous => ({ ...previous, ...patch }))} />;
  }
  render(<Equation />);
  const linked = screen.getByRole('button', { name: 'Use measurement point for x' }).closest('tr');
  const fixed = screen.getByRole('textbox', { name: 'a nominal' }).closest('tr');
  expect(within(fixed).queryByRole('button', { name: 'Use measurement point for a' })).toBeNull();
  expect(within(screen.getByRole('columnheader', { name: 'Value' })).queryByRole('button')).toBeNull();
  expect(within(linked).getByText('0.5')).toBeInTheDocument();
  expect(within(fixed).queryByRole('button', { name: 'Edit linked point unit' })).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('1 V');
  fireEvent.click(within(linked).getByRole('button', { name: 'Edit linked point unit' }));
  fireEvent.change(within(linked).getByRole('combobox'), { target: { value: 'mV' } });
  expect(within(linked).getByText('500')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('1000 V');
  expect(screen.getByRole('button', { name: 'Edit uncertainty unit' })).toHaveTextContent('V');
  fireEvent.click(within(linked).getByRole('button', { name: 'Use measurement point for x' }));
  fireEvent.click(within(fixed).getByRole('button', { name: 'Use measurement point for a' }));
  expect(within(fixed).getByRole('button', { name: 'Edit linked point unit' })).toHaveTextContent('mV');
  expect(within(linked).queryByRole('combobox')).toBeNull();
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
