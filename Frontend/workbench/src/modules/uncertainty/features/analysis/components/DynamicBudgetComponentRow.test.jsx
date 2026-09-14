import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import DynamicBudgetComponentRow from "./DynamicBudgetComponentRow";
import { createDynamicDefinition, createDynamicComponent } from "../../../utils/dynamicBudgetComponents";
const setup = (kind) => {
  const definition = createDynamicDefinition(kind,{unit:"V"});
  const onCommit=vi.fn();
  render(<><button>Outside</button><table><tbody><DynamicBudgetComponentRow component={createDynamicComponent(definition)} referencePoint={{value:100,unit:"V"}} onCommit={onCommit}/></tbody></table></>);
  fireEvent.click(screen.getByRole('button',{name:'Not Set'}));
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

it("opens a newly created definition directly and focuses its name", () => {
  const definition = createDynamicDefinition('table', { unit: 'V' });
  const opened = vi.fn();
  render(<table><tbody><DynamicBudgetComponentRow component={createDynamicComponent(definition)} referencePoint={{ value: 100, unit: 'V' }} onCommit={vi.fn()} autoEdit onEditorOpened={opened}/></tbody></table>);
  expect(screen.getByRole('group', { name: 'Tabular uncertainty editor' })).toBeInTheDocument();
  expect(screen.getByLabelText('Error source name')).toHaveFocus();
  expect(opened).toHaveBeenCalledOnce();
});
it("keeps portaled selectors inside the editing session and Escape discards the draft", () => {
  const { onCommit } = setup('table');
  fireEvent.change(screen.getByLabelText('Measurement point row 1'), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: 'Values represent' }));
  const option = screen.getByRole('option', { name: 'Error limit (±)' });
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
  fireEvent.change(screen.getByLabelText('Uncertainty column 1 name'), { target: { value: 'Calibration' } });
  fireEvent.click(screen.getByRole('button', { name: 'Outside' }));
  await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
  expect(onCommit.mock.calls[0][0].columns[0].name).toBe('Calibration');
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
  fireEvent.change(screen.getByLabelText('C nominal'), { target: { value: '1' } });
  fireEvent.change(equation, { target: { value: 'A*B+C+1' } });
  expect(screen.getByLabelText('Use measurement point for A')).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('status')).toHaveTextContent('3 V');
  fireEvent.keyDown(screen.getByLabelText('C nominal'), { key: 'Enter' });
  expect(onCommit.mock.calls.at(-1)[0].pointVariable).toBe('');
});
