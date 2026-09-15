import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import DynamicBudgetComponentRow from "./DynamicBudgetComponentRow";
import { createDynamicDefinition, createDynamicComponent } from "../../../utils/dynamicBudgetComponents";
const setup = (kind) => {
  const definition = createDynamicDefinition(kind,{unit:"V"});
  const onCommit=vi.fn();
  render(<><button>Outside</button><table><tbody><DynamicBudgetComponentRow component={createDynamicComponent(definition)} referencePoint={{value:100,unit:"V"}} onCommit={onCommit}/></tbody></table></>);
  fireEvent.click(document.querySelector('.dynamic-tolerance-cell button'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit error limit distribution' }));
  fireEvent.change(screen.getByLabelText('Error limit distribution'), { target: { value: '1.000' } });
  return {onCommit,definition};
};
it("starts with two columns and one row, grows with Tab, and commits on Enter",async()=>{
  const {onCommit}=setup('table');
  fireEvent.change(screen.getByLabelText('Measurement point row 1'),{target:{value:'100'}});
  const value=screen.getByLabelText('Uncertainty row 1');
  fireEvent.change(value,{target:{value:'.012'}});
  fireEvent.keyDown(value,{key:'Tab'});
  await waitFor(()=>expect(screen.getByLabelText('Measurement point row 2')).toHaveFocus());
  fireEvent.change(screen.getByLabelText('Measurement point row 2'),{target:{value:'200'}});
  fireEvent.change(screen.getByLabelText('Uncertainty row 2'),{target:{value:'.023'}});
  fireEvent.keyDown(screen.getByLabelText('Uncertainty row 2'),{key:'Enter'});
  expect(onCommit.mock.calls.at(-1)[0].rows).toHaveLength(2);
  expect(onCommit.mock.calls.at(-1)[0].rows[1].point).toBe('200');
});
it("pastes measurement and uncertainty columns while keeping one uncertainty per definition",()=>{
  const {onCommit}=setup('table');
  fireEvent.paste(screen.getByLabelText('Measurement point row 1'),{clipboardData:{getData:()=> '100\t.012\n200\t.023'}});
  expect(screen.getByLabelText('Uncertainty row 2')).toHaveValue('.023');
  expect(screen.queryByRole('button',{name:'Uncertainty column'})).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByLabelText('Measurement point row 1'),{key:'Enter'});
  expect(onCommit.mock.calls.at(-1)[0].columns).toHaveLength(1);
});
it("builds equation variables while typing with one measurement binding",()=>{
  const {onCommit}=setup('equation');
  fireEvent.change(screen.getByLabelText('Uncertainty equation'),{target:{value:'A*B+C'}});
  expect(screen.getByLabelText('Use measurement point for A')).toHaveAttribute('aria-pressed','true');
  fireEvent.change(screen.getByLabelText('B nominal'),{target:{value:'10'}});
  fireEvent.change(screen.getByLabelText('C nominal'),{target:{value:'2.2'}});
  expect(screen.getByRole('status')).toHaveTextContent('1002.2 V');
  fireEvent.keyDown(screen.getByLabelText('C nominal'),{key:'Enter'});
  expect(onCommit.mock.calls.at(-1)[0].pointVariable).toBe('A');
});

it("opens a new definition with a quiet centered source name", () => {
  const definition = createDynamicDefinition('table', { unit: 'V' });
  const opened = vi.fn();
  render(<table><tbody><DynamicBudgetComponentRow component={createDynamicComponent(definition)} referencePoint={{ value: 100, unit: 'V' }} onCommit={vi.fn()} autoEdit onEditorOpened={opened}/></tbody></table>);
  expect(screen.getByRole('group', { name: 'Tabular uncertainty editor' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Error source name')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Edit error source name' })).toHaveTextContent('Not Set');
  expect(opened).toHaveBeenCalledOnce();
});
it("keeps portaled selectors inside the editing session and Escape discards the draft", () => {
  const { onCommit } = setup('table');
  fireEvent.change(screen.getByLabelText('Measurement point row 1'), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: 'Uncertainty unit' }));
  const option = screen.getByRole('option', { name: 'mV' });
  option.focus();
  fireEvent.click(option);
  expect(screen.getByRole('group', { name: 'Tabular uncertainty editor' })).toBeInTheDocument();
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText('Measurement point row 1'), { key: 'Escape' });
  expect(screen.queryByRole('group', { name: 'Tabular uncertainty editor' })).not.toBeInTheDocument();
  expect(onCommit).not.toHaveBeenCalled();
});
it("applies the complete latest draft on outside click", async () => {
  const { onCommit } = setup('table');
  fireEvent.paste(screen.getByLabelText('Measurement point row 1'), { clipboardData: { getData: () => '100\t.012\n200\t.024' } });
  fireEvent.click(screen.getByRole('button', { name: 'Edit error source name' }));
  fireEvent.change(screen.getByLabelText('Error source name'), { target: { value: 'Calibration' } });
  fireEvent.click(screen.getByRole('button', { name: 'Outside' }));
  await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
  expect(onCommit.mock.calls[0][0].name).toBe('Calibration');
  expect(onCommit.mock.calls[0][0].rows).toHaveLength(2);
  expect(screen.queryByRole('group', { name: 'Tabular uncertainty editor' })).not.toBeInTheDocument();
});
it("preserves variable edits while an equation is incomplete and supports fixed values for every variable", () => {
  const { onCommit } = setup('equation');
  const equation = screen.getByLabelText('Uncertainty equation');
  fireEvent.change(equation, { target: { value: 'A*B' } });
  fireEvent.change(screen.getByLabelText('B nominal'), { target: { value: '0.02' } });
  fireEvent.change(screen.getByLabelText('B name'), { target: { value: 'Scale factor' } });
  fireEvent.change(equation, { target: { value: 'A*' } });
  expect(equation).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(equation, { target: { value: 'A*B+C' } });
  expect(screen.getByLabelText('B nominal')).toHaveValue('0.02');
  expect(screen.getByLabelText('B name')).toHaveValue('Scale factor');
  fireEvent.click(screen.getByLabelText('Use measurement point for A'));
  fireEvent.change(screen.getByLabelText('A nominal'), { target: { value: '50' } });
  fireEvent.change(screen.getByLabelText('C nominal'), { target: { value: '1.000' } });
  fireEvent.change(equation, { target: { value: 'A*B+C+1' } });
  expect(screen.getByLabelText('Use measurement point for A')).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('status')).toHaveTextContent('3 V');
  fireEvent.keyDown(screen.getByLabelText('C nominal'), { key: 'Enter' });
  expect(onCommit.mock.calls.at(-1)[0].pointVariable).toBe('');
});

it("uses the point unit in the header and supports symmetric and asymmetric table entries", () => {
  const { onCommit } = setup('table');
  expect(screen.queryByRole('button', { name: 'Measurement unit' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Values represent' })).not.toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Measurement point V' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: '± V' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Measurement point row 1'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Uncertainty row 1'), { target: { value: '.2' } });
  fireEvent.click(screen.getByTitle('Asymmetric tolerance'));
  expect(screen.getByLabelText('Low row 1')).toHaveValue('-0.2');
  expect(screen.getByLabelText('High row 1')).toHaveValue('.2');
  fireEvent.change(screen.getByLabelText('Low row 1'), { target: { value: '-.1' } });
  fireEvent.keyDown(screen.getByLabelText('High row 1'), { key: 'Enter' });
  expect(onCommit.mock.calls.at(-1)[0].mode).toBe('limits');
});

it("displays shared table points in the current point unit without changing their stored scale", () => {
  const definition = createDynamicDefinition('table', { unit: 'V' });
  definition.rows[0].point = 1;
  const commit = vi.fn();
  render(<table><tbody><DynamicBudgetComponentRow component={createDynamicComponent(definition)} referencePoint={{ value: 1000, unit: 'mV' }} onCommit={commit} autoEdit /></tbody></table>);
  expect(screen.getByRole('columnheader', { name: 'Measurement point mV' })).toBeInTheDocument();
  const input = screen.getByLabelText('Measurement point row 1');
  expect(input).toHaveValue('1000');
  fireEvent.change(input, { target: { value: '2000' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(commit.mock.calls.at(-1)[0].rows[0].point).toBe(2);
});

it("supports low and high equations and warns about incompatible output units", () => {
  setup('equation');
  fireEvent.change(screen.getByLabelText('Uncertainty equation'), { target: { value: 'x/100' } });
  fireEvent.click(screen.getByTitle('Asymmetric tolerance'));
  fireEvent.change(screen.getByLabelText('High error limit equation'), { target: { value: 'x/50' } });
  expect(screen.getByRole('status')).toHaveTextContent('-1 to 2 V');
  fireEvent.click(screen.getByRole('button', { name: 'Uncertainty unit' }));
  fireEvent.click(screen.getByRole('option', { name: 'A' }));
  expect(screen.getByRole('img', { name: /incompatible/ })).toBeInTheDocument();
});


it.each(["Enter", "collapse"])("saves a symmetric table limit and distribution on %s", async action => {
  const definition = createDynamicDefinition("table", { value: 1, unit: "degF" });
  const onCommit = vi.fn();
  const component = createDynamicComponent(definition);
  render(<><button>Outside</button><table><tbody><DynamicBudgetComponentRow component={component}
    referencePoint={{ value: 1, unit: "degF" }} onCommit={onCommit} autoEdit /></tbody></table></>);
  expect(screen.getByLabelText('Measurement point row 1')).toHaveValue('1');
  fireEvent.change(screen.getByLabelText('Uncertainty row 1'), { target: { value: '.2' } });
  fireEvent.click(screen.getByTitle('Asymmetric tolerance'));
  fireEvent.click(screen.getByTitle('Symmetric tolerance'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit error limit distribution' }));
  fireEvent.change(screen.getByLabelText('Error limit distribution'), { target: { value: '1.732' } });
  if (action === 'Enter') fireEvent.keyDown(screen.getByLabelText('Uncertainty row 1'), { key: 'Enter' });
  else fireEvent.click(screen.getByRole('button', { name: 'Outside' }));
  await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
  expect(onCommit.mock.calls[0][0]).toMatchObject({ mode: 'tolerance', distribution: '1.732' });
  expect(document.querySelector('.dynamic-tolerance-cell button')).toHaveTextContent('± 0.2 degF');
  expect(document.querySelector('.budget-standard-uncertainty')).toHaveTextContent('0.115473 °F');
});


it("keeps the saved error limit visible when distribution is selected after Enter", () => {
  const definition = createDynamicDefinition("table", { value: 0, unit: "V" });
  const component = createDynamicComponent(definition), commit = vi.fn();
  render(<table><tbody><DynamicBudgetComponentRow component={component} referencePoint={{ value: 0, unit: "V" }} onCommit={commit} autoEdit /></tbody></table>);
  expect(screen.getByLabelText('Measurement point row 1')).toHaveValue('0');
  fireEvent.change(screen.getByLabelText('Uncertainty row 1'), { target: { value: '.2' } });
  fireEvent.keyDown(screen.getByLabelText('Uncertainty row 1'), { key: 'Enter' });
  expect(document.querySelector('.dynamic-tolerance-cell button')).toHaveTextContent('± 0.2 V');
  expect(document.querySelector('.dynamic-tolerance-cell button')).toHaveAttribute('title', 'Choose an error-limit distribution.');
  expect(document.querySelector('.budget-standard-uncertainty')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit error limit distribution' }));
  fireEvent.change(screen.getByLabelText('Error limit distribution'), { target: { value: '2.000' } });
  expect(document.querySelector('.dynamic-tolerance-cell button')).toHaveTextContent('± 0.2 V');
  expect(document.querySelector('.budget-standard-uncertainty')).toHaveTextContent('0.1 V');
  expect(commit.mock.calls.at(-1)[0].rows[0]).toMatchObject({ point: 0, values: { [definition.columns[0].id]: { value: '.2' } } });
});
