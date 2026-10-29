import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import UncertaintyPanel, { EditableDescriptionCell } from './UncertaintyPanel';
import { buildAcShuntBudget } from '../../../utils/acShuntBudget';
import { generic5790, qualified5790, nominalY5020Resolution } from '../../../utils/testFixtures/generic5790';
import { resolvePointBudgetComponents } from '../../../utils/resolvePointBudgetComponents';

vi.mock('plotly.js-dist',()=>({default:{}}));

it.each(['session', 'point'].flatMap(viewMode=>[generic5790,qualified5790].map(reader=>({viewMode,reader}))))('shows editable 5790 resolution in $viewMode with version $reader.generic5790.version qualifiers', async ({viewMode,reader}) => {
  const ti = { id:'ti',type:'uut',scope:'validated',manufacturer:'Fluke',model:'Y5020 · TI',
    functions:[{id:'current',name:'Current',unit:'A',ranges:[{id:'10A',min:10,max:10,unit:'A',
      qualifier:{value:1000,unit:'Hz',isSingleValue:true},
      tolerances:{reading:{high:100,low:-100,unit:'ppm',symmetric:true,distribution:'not_set'}}}]}] };
  const {session} = buildAcShuntBudget({id:1,name:'Resolution table',generic5790Instrument:reader,
    instruments:{test_instrument_model:'Y5020',test_instrument_serial:'TI'},
    points:[{current:10,frequency:1000,readerResolution:nominalY5020Resolution(10),
      analytics:{pair_delta_uut_ppm:1,pair_type_a_uncertainty_ppm:2,n_pairs_used:5}}]}, {instruments:[ti]});
  const point = session.testPoints[0];
  const save = vi.fn();
  const {container, rerender} = render(<UncertaintyPanel testPointData={{...point,viewMode}}
    sessionData={session} onSessionSave={save} tmdeTolerancesData={[]} uutNominal={point.testPointInfo.parameter}/>);
  const colorInput = container.querySelector('[data-tour="uut-table"] input[type="color"]');
  fireEvent.input(colorInput, {target:{value:'#ff0000'}});
  const recolored = save.mock.calls.at(-1)[0];
  expect(recolored.measurementAreaGroups[0].color).toBe('#ff0000');
  expect(recolored.measurementAreas[0].color).toBe('#ff0000');
  rerender(<UncertaintyPanel testPointData={{...point,viewMode}}
    sessionData={recolored} onSessionSave={save} tmdeTolerancesData={[]} uutNominal={point.testPointInfo.parameter}/>);
  expect(container.querySelector('[data-tour="uut-table"] input[type="color"]')).toHaveValue('#ff0000');
  expect(container.querySelector('[data-tour="tmde-table"] input[type="color"]')).toHaveValue('#ff0000');
  const group = `[data-range-group="tmde:${session.tmdes[0].id}"]`;
  expect(container.querySelector(group).querySelector('.inline-desc-combined')).toHaveTextContent('Fluke 5790B');
  // Both views show every stored range. Edit the 2.2 V range used by this point.
  const row = container.querySelector(`${group}[data-range-id="${generic5790.functions[0].ranges[1].id}"]`);
  if (reader.generic5790.version === 2) {
    const rows = [...container.querySelectorAll(group)];
    expect(rows[0].querySelector('[data-range-cell]')).toHaveAttribute('rowspan','6');
    expect(container.querySelector('[data-tour="tmde-table"]')).toHaveTextContent('Medium/Slow or HIRES On');
    expect(container.querySelector('[data-tour="tmde-table"]')).toHaveTextContent('Fast/Off, HIRES Off');
    for (const interval of ['90 Days','1 Year','2 Years']) expect(container.querySelector('[data-tour="tmde-table"]')).toHaveTextContent(interval);
  }
  const resolution = row.querySelector('[title="Edit resolution"]');
  expect(resolution).toBeInTheDocument();
  expect(resolution).toHaveTextContent(/0\.0000001.*V/);
  fireEvent.click(resolution);
  const input = row.querySelector('.inline-resolution-input');
  fireEvent.change(input,{target:{value:'0.0000002'}});
  fireEvent.blur(input);
  await waitFor(() => expect(save).toHaveBeenCalled());
  const updated = save.mock.calls.at(-1)[0];
  const changed = updated.tmdes[0].instrument.functions.flatMap(fn=>fn.ranges).find(r=>r.id===generic5790.functions[0].ranges[1].id);
  expect(Number(changed.resolution)).toBe(2e-7);
  expect(Number(changed.measuringResolution)).toBe(2e-7);
  expect(resolvePointBudgetComponents(point,updated).at(-1).value)
    .toBeCloseTo(2*Math.SQRT2/Math.sqrt(12), 10);
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
