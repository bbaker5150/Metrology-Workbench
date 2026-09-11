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
it("pastes two spreadsheet columns and creates a second uncertainty column",()=>{
  const {onCommit}=setup('table');
  fireEvent.paste(screen.getByLabelText('Measurement point row 1'),{clipboardData:{getData:()=> '100\t.012\n200\t.023'}});
  expect(screen.getByLabelText('Uncertainty row 2')).toHaveValue('.023');
  fireEvent.click(screen.getByRole('button',{name:'Uncertainty column'}));
  expect(screen.getByLabelText('Uncertainty 2 row 1')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByLabelText('Measurement point row 1'),{key:'Enter'});
  expect(onCommit.mock.calls.at(-1)[0].columns).toHaveLength(2);
});
it("builds an equation variable table with one measurement binding",()=>{
  const {onCommit}=setup('equation');
  fireEvent.change(screen.getByLabelText('Uncertainty equation'),{target:{value:'A*B+C'}});
  fireEvent.click(screen.getByRole('button',{name:'Set uncertainty equation'}));
  expect(screen.getByLabelText('Use measurement point for A')).toBeChecked();
  fireEvent.change(screen.getByLabelText('B nominal'),{target:{value:'10'}});
  fireEvent.change(screen.getByLabelText('C nominal'),{target:{value:'2.2'}});
  expect(screen.getByRole('status')).toHaveTextContent('1002.2 V');
  fireEvent.keyDown(screen.getByLabelText('C nominal'),{key:'Enter'});
  expect(onCommit.mock.calls.at(-1)[0].pointVariable).toBe('A');
});
