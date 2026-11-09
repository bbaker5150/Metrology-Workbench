import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import UncertaintyPanel from "./UncertaintyPanel";
import { createInstrumentBudgetComponent } from "../../../utils/instrumentBudgetComponents";
import { clearEditorDraft, readEditorDraft, saveEditorDraft } from "../../../utils/editorRecovery";

vi.mock("plotly.js-dist", () => ({ default: {} }));

function dynamicSource(kind, name) {
  const record = createInstrumentBudgetComponent(kind, "V");
  const component = record.budgetComponent;
  const definition = component.dynamicDefinition;
  Object.assign(definition, {
    name, equation: "x / 25", variables: { x: { name: "Reading", value: "" } }, pointVariable: "x",
    rows: [{ id: "entry", point: "18", values: { [definition.columns[0].id]: { value: "0.75" } } }],
  });
  return { ...record, name, budgetComponent: { ...component, name, inlineDraft: false } };
}

it('inspects only submitted Type B data from collapsed and expanded review rows, preserving local editor drafts', () => {
  const tabular = dynamicSource("table", "Certificate points");
  const equation = dynamicSource("equation", "Thermal correction");
  const manual = {id:"legacy", name:"Cable loss", inputMode:"tolerance", toleranceLimit:"0.3", unit:"V", distribution:"2.449"};
  const submitted = {id:"submitted", sourceId:"catalog", scope:"pending", description:"Meter", typeBComponents:[manual,tabular,equation]};
  const row = {id:"review-42", name:"Meter", instrument:submitted};
  const localDraft = { ...equation.budgetComponent.dynamicDefinition, name:"Unsubmitted local edit", equation:"2000" };
  const recoveryKey = `dynamic:${equation.budgetComponent.id}`;
  saveEditorDraft(recoveryKey, localDraft);
  const onSave = vi.fn();
  function panel(expanded, displayed = row) {
    return <UncertaintyPanel libraryMode libraryReviewMode libraryExpandedIds={expanded ? [displayed.id] : []}
      testPointData={{id:"review", viewMode:"session"}} sessionData={{id:"inbox", uuts:[], tmdes:[displayed], testPoints:[]}}
      instruments={[{id:"catalog", typeBComponents:[{...manual,name:"Unsubmitted catalog component"}]}]}
      onSessionSave={onSave} onSaveInstrument={onSave} />;
  }
  try {
    const view = render(panel(false));
    for (const expanded of [false, true]) {
      view.rerender(panel(expanded));
      fireEvent.contextMenu(view.container.querySelector('[data-instrument-id="review-42"]'));
      fireEvent.click(screen.getByText("View associated Type B"));
      const dialog = within(screen.getByRole("dialog", {name:/Associated Type B/}));
      expect(dialog.getByText("Cable loss")).toBeInTheDocument();
      expect(dialog.queryByText("Unsubmitted catalog component")).toBeNull();
      expect(dialog.queryByText("Unsubmitted local edit")).toBeNull();
      expect(dialog.queryByRole("button",{name:/add|remove|move component/i})).toBeNull();
      expect(dialog.queryByRole("columnheader",{name:"Actions"})).toBeNull();
      const inspect = name => {
        const row = dialog.getByText(name).closest("tr");
        fireEvent.click(row.cells[1].querySelector("button"));
        return within(row);
      };
      for (const field of inspect("Cable loss").getAllByDisplayValue("0.3")) expect(field).toBeDisabled();
      expect(inspect("Certificate points").getByLabelText("Uncertainty row 1")).toHaveValue("0.75");
      expect(inspect("Thermal correction").getByLabelText("Uncertainty equation")).toHaveValue("x / 25");
      expect(dialog.getByLabelText("Uncertainty equation")).toHaveAttribute("readonly");
      fireEvent.click(dialog.getByRole("button", {name:"Close associated Type B"}));
      expect(readEditorDraft(recoveryKey)).toEqual(localDraft);
    }
    view.rerender(panel(false,{...row,instrument:{id:"submitted",sourceId:"catalog",scope:"pending"}}));
    fireEvent.contextMenu(view.container.querySelector('[data-instrument-id="review-42"]'));
    expect(screen.queryByText("View associated Type B")).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  } finally {
    clearEditorDraft(recoveryKey);
  }
});
