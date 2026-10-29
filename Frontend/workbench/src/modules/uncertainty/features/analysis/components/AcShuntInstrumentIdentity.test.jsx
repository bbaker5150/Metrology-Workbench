import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import UncertaintyPanel, { EditableDescriptionCell } from './UncertaintyPanel';
import { buildAcShuntBudget } from '../../../utils/acShuntBudget';
import { resolvePointBudgetComponents } from '../../../utils/resolvePointBudgetComponents';
import { applyItemRangePatch } from './UncertaintyPanel';

vi.mock('plotly.js-dist',()=>({default:{}}));

it.each(['session', 'point'])('shows the existing 5790 and its populated resolution in the actual %s TMDE table', viewMode => {
  const shunt = (id, type) => ({id, type, scope:'validated',model:'Y5020',serialNumber:id,
    functions:[{id:'current',name:'Current',unit:'A',ranges:[{id:'10',min:10,max:10,unit:'A',
      tolerances:{reading:{high:100,low:-100,unit:'ppm',distribution:'1.960'}}}]}]});
  const reader={id:'existing-reader',scope:'local',manufacturer:'Fluke',model:'5790B',functions:[{
    id:'difference',name:'AC/DC Difference',unit:'ppm',ranges:[{id:'200-ppm',min:0,max:200,unit:'ppm',
      measuringResolution:1e-7,measuringResolutionUnit:'V',measuringResolutionDistribution:'3.464',includeResolutionInBudget:true}]}]};
  const {session}=buildAcShuntBudget({id:1,name:'Reader display',instruments:{test_instrument_model:'Y5020',test_instrument_serial:'ti',
    standard_instrument_model:'Y5020',standard_instrument_serial:'ref',standard_reader_model:'5790B',standard_reader_serial:'4449302'},
    points:[{current:10,frequency:1000,analytics:{pair_delta_uut_ppm:1,pair_type_a_uncertainty_ppm:2,n_pairs_used:5},
      readerResolution:{std:{ppmPerVolt:2e6,rangeVolts:2.2}}}]}, {instruments:[shunt('ti','uut'),shunt('ref','tmde'),reader]});
  const point=session.testPoints[0], meter=session.tmdes[1];
  const {container,rerender}=render(<UncertaintyPanel testPointData={{...point,viewMode}} sessionData={session}
    onSessionSave={vi.fn()} tmdeTolerancesData={[]} uutNominal={point.testPointInfo.parameter}/>);
  const row=container.querySelector(`[data-range-group="tmde:${meter.id}"]`);
  expect(row).toHaveTextContent('Fluke 5790B');
  expect(row).toHaveTextContent('0.0000001 V');
  const before=resolvePointBudgetComponents(point,session).find(row=>row.isResolution).value;
  session.tmdes[1]=applyItemRangePatch(meter,'200-ppm',{resolution:2e-7});
  rerender(<UncertaintyPanel testPointData={{...point,viewMode}} sessionData={{...session}}
    onSessionSave={vi.fn()} tmdeTolerancesData={[]} uutNominal={point.testPointInfo.parameter}/>);
  expect(container.querySelector(`[data-range-group="tmde:${meter.id}"]`)).toHaveTextContent('0.0000002 V');
  expect(resolvePointBudgetComponents(point,session).find(row=>row.isResolution).value).toBeCloseTo(before*2,12);
});

it.each([
  'NIST reference AC shunt · 20 A',
  'Fluke Y5020 · 5965004 Fluke Y5020 · 5965004 NIST reference AC shunt · 20 A',
])('displays one TMDE identity for new and previously imported names: %s', name => {
  const onCommit = vi.fn();
  render(<EditableDescriptionCell make="Fluke" model="Y5020 · 5965004" name={name} onCommit={onCommit}/>);
  const label = screen.getByRole('button', {name:'Fluke Y5020 · 5965004 NIST reference AC shunt · 20 A'});
  expect(label.textContent.match(/Fluke Y5020 · 5965004/g)).toHaveLength(1);
  expect(onCommit).not.toHaveBeenCalled();
});

it.each(['session','point'].flatMap(viewMode => ['new','legacy','edited','conventional'].map(state => ({viewMode,state}))))
  ('uses the same identity format for UUT and TMDE in $viewMode view ($state budget)', ({viewMode,state}) => {
    const instrument = (type, serial, description) => ({id:serial,type,scope:'validated',manufacturer:'Fluke',
      model:state==='conventional'?'Y5020':`Y5020 · ${serial}`,
      description:state==='conventional'?`${serial} 20 A ${type==='uut'?'CHECK STD':'NIST'}`:description,
      acShuntIdentity:{model:'Y5020',serial,shuntRange:20},functions:[{id:`${serial}-current`,name:'Current',unit:'A',ranges:[{
        id:`${serial}-range`,min:10,max:10,unit:'A',qualifier:{value:1000,min:1000,max:1000,unit:'Hz',isSingleValue:true},
        tolerances:{reading:{high:100,low:-100,unit:'ppm',symmetric:true,distribution:type==='uut'?'not_set':'1.960'}}}]}]});
    const {session} = buildAcShuntBudget({id:1,name:'Identity check',instruments:{
      test_instrument_model:'Y5020',test_instrument_serial:'3845014',standard_instrument_model:'Y5020',standard_instrument_serial:'5965004'},
      points:[{current:10,frequency:1000,analytics:{pair_delta_uut_ppm:1,pair_type_a_uncertainty_ppm:2,n_pairs_used:5}}]},
    {instruments:[instrument('uut','3845014','AC shunt TI · Lab ±100 ppm'),instrument('tmde','5965004','NIST reference AC shunt · 20 A')]});
    const uut = session.uuts[0], tmde = session.tmdes[0];
    if (state==='legacy') {
      uut.name='Fluke Y5020 · 3845014 AC shunt TI · Lab ±100 ppm';
      uut.description='';
    } else if (state==='edited') uut.description='Custom TI description';
    const onSessionSave = vi.fn();
    const {container} = render(<UncertaintyPanel testPointData={{...session.testPoints[0],viewMode}}
      sessionData={session} onSessionSave={onSessionSave} tmdeTolerancesData={[]}
      uutNominal={session.testPoints[0].testPointInfo.parameter} />);
    const uutLabel = container.querySelector(`[data-range-group="uut:${uut.id}"] .inline-desc-combined`);
    const tmdeLabel = container.querySelector(`[data-range-group="tmde:${tmde.id}"] .inline-desc-combined`);
    expect(uutLabel).toHaveTextContent(state==='conventional'?'Fluke Y5020 3845014 20 A CHECK STD':`Fluke Y5020 · 3845014 ${state==='edited'?'Custom TI description':'AC shunt TI · Lab ±100 ppm'}`);
    expect(tmdeLabel).toHaveTextContent(state==='conventional'?'Fluke Y5020 5965004 20 A NIST':'Fluke Y5020 · 5965004 NIST reference AC shunt · 20 A');
    expect(uutLabel.textContent.match(/Fluke Y5020/g)).toHaveLength(1);
    expect(onSessionSave).not.toHaveBeenCalled();
  });
