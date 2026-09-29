import React, { useState } from 'react';
import { render, fireEvent, screen, within } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { SidebarPointItem } from './App';
import UncertaintyBudgetTable from './features/analysis/components/UncertaintyBudgetTable';
import { UnitSelect } from './features/analysis/components/UncertaintyPanel';
import { normalizeInlineManualComponent } from './features/analysis/utils/manualComponentUtils';
import { unitSystem } from './utils/uncertaintyMath';
import BuilderUnitSelect from './features/instruments/components/BuilderUnitSelect';
vi.mock('plotly.js-dist', () => ({ default: {} }));

it('offers one Units entry in the builder and retains its prefix control', () => {
  function Harness() {
    const [unit,setUnit]=useState('kUnits');
    return <BuilderUnitSelect value={unit} onChange={setUnit} ariaLabel="Builder unit" options={['Units','kUnits','mUnits','V'].map(value=>({value,label:value}))}/>;
  }
  render(<Harness/>);
  fireEvent.click(screen.getByRole('button',{name:'Builder unit base unit',exact:true}));
  expect(screen.getAllByRole('option',{name:/Units/})).toHaveLength(1);
  fireEvent.click(screen.getByRole('option',{name:/Units/}));
  expect(screen.getByRole('button',{name:'Builder unit prefix'})).toHaveTextContent('Base');
});

it('opens one value field and retains the value while choosing a unit and prefix', () => {
  function Harness() {
    const [point, save] = useState({id:'p',testPointInfo:{parameter:{value:'2',unit:''}}});
    return <><SidebarPointItem point={point} onSave={save} onSelect={()=>{}} visibleColumns={{value:true}}/><output>{JSON.stringify(point.testPointInfo.parameter)}</output></>;
  }
  render(<Harness/>);
  expect(screen.queryByRole('button',{name:'Measurement point unit base unit'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Edit measurement point value'}));
  fireEvent.change(screen.getByPlaceholderText('Value'),{target:{value:'5'}});
  fireEvent.click(screen.getByRole('button',{name:'Measurement point unit prefix'}));
  fireEvent.click(screen.getByRole('option',{name:/Kilo/}));
  expect(screen.getByRole('status')).toHaveTextContent('"value":"5","unit":"kUnits"');
  expect(unitSystem.toBaseUnit(5,'kUnits')).toBe(5000);
  screen.getByPlaceholderText('Value').focus();
  fireEvent.keyDown(screen.getByPlaceholderText('Value'),{key:'Enter'});
  expect(screen.getByRole('button',{name:'Edit measurement point value'})).toHaveTextContent('5 kUnits');
});

it('uses a changed manual floor unit as the full-scale reference for an unassigned point', () => {
  const result = normalizeInlineManualComponent({ component:{id:'manual'}, referencePoint:{value:10,unit:''},
    draft:{name:'Manual',type:'B',unit:'V',inputMode:'tolerance',errorDistributionDivisor:'1.732',tolerance:{
      floor:{high:'1',low:'-1',unit:'A',distribution:'1.732'},
      range:{high:'1',low:'-1',value:'100',unit:'%',distribution:'1.732'}
    }} });
  expect(result.unit_native).toBe('A');
  expect(result.pendingReason).toBeFalsy();
  expect(result.value_native).toBeGreaterThan(0);
});

it('allows mixed budget source types to move in the displayed order', () => {
  const rows=[{id:'tmde',name:'Instrument',type:'B',value_native:1,unit_native:'V',distribution:'Rectangular'},
    {id:'manual',name:'Manual',isInlineManual:true,isManual:true,type:'B',value_native:1,unit_native:'V'},
    {id:'repeatability',name:'Repeatability',type:'A',value_native:1,unit_native:'V'}];
  function Harness() {
    const [order,setOrder]=useState(rows.map(r=>r.id));
    return <UncertaintyBudgetTable components={rows} componentOrder={order} measurementType="direct"
      referencePoint={{value:10,unit:'V'}} calcResults={{}} UnitSelectComponent={UnitSelect}
      onMoveComponent={(id,direction,ids)=>{const next=[...ids];const i=next.indexOf(id),j=i+direction;if(j<0||j>=next.length)return;[next[i],next[j]]=[next[j],next[i]];setOrder(next);}}/>;
  }
  const {container}=render(<Harness/>);
  const names=()=>[...container.querySelectorAll('.component-group-tbody > tr')].map(row=>row.cells[0].textContent);
  fireEvent.click(within(container.querySelectorAll('.component-group-tbody > tr')[1]).getByRole('button',{name:'Move component up'}));
  expect(names()[0]).toContain('Manual');
  fireEvent.click(within(container.querySelectorAll('.component-group-tbody > tr')[2]).getByRole('button',{name:'Move component up'}));
  expect(names()[1]).toContain('Repeatability');
  expect(screen.getByRole('button',{name:'Edit repeatability measurements'})).toHaveTextContent('± 1.000 V');
});
