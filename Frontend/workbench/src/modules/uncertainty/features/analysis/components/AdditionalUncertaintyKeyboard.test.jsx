import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import UncertaintyPanel, { InlineToleranceCell, applyToleranceCaseChange } from './UncertaintyPanel';
function Editor({kind}) {
  const [tolerance,setTolerance]=useState(kind==='parametric'?{}:{tmdeUncertaintyDefinition:{id:'d',kind,mode:'tolerance',columns:[{id:'c',name:'Uncertainty'}],rows:[{id:'r',point:0,values:{}}],variables:{},equation:''}});
  return <InlineToleranceCell tolerance={tolerance} activeRange={{id:'r',unit:'V'}} referencePoint={{value:1,unit:'V'}} biasRole="source" editable openRequested onCommit={(type,value)=>setTolerance(current=>applyToleranceCaseChange(current,type,value))}/>;
}
describe('additional uncertainty keyboard collapse',()=>{
  it.each(['parametric','table','equation'].flatMap(kind=>['Enter','Escape'].map(key=>[kind,key])))('collapses %s with %s and can reopen it', (kind,key)=>{
    const {container}=render(<Editor kind={kind}/>);
    const input=container.querySelector('.inline-tolerance-editor input');
    expect(input).not.toBeNull();
    input.focus();
    fireEvent.change(input,{target:{value:'2'}});
    fireEvent.keyDown(input,{key});
    expect(container.querySelector('.inline-tolerance-editor')).toBeNull();
    fireEvent.click(screen.getByTitle(/Set tolerance|Edit tolerance/));
    expect(container.querySelector('.inline-tolerance-editor')).not.toBeNull();
    expect(container.querySelector('.inline-tolerance-editor input').value).toBe('2');
  });
});

it('uses temperature symbols in the calculated and target summary',()=>{
  const point={id:'p',measurementType:'derived',equationString:'t',variableMappings:{t:'Temperature'},variableNominals:{t:{value:72,unit:'degF'}},components:[],testPointInfo:{parameter:{value:72,unit:'degF'}}};
  const {container}=render(<UncertaintyPanel testPointData={point} sessionData={{id:'s',uuts:[],tmdes:[],testPoints:[point]}} uutNominal={point.testPointInfo.parameter} calcResults={{calculatedNominalValue:72}} tmdeTolerancesData={[]}/>);
  expect(container.querySelector('.measurement-equation-status-main')).toHaveTextContent('°F');
  expect(container.querySelector('.measurement-equation-status-target')).toHaveTextContent('°F');
  expect(container.querySelector('.measurement-equation-status')).not.toHaveTextContent('degF');
});
