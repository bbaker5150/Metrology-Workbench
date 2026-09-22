import { readEditorDraft } from "./editorRecovery";
import { v4 as uuid } from "uuid";
import { createDynamicDefinition, createDynamicComponent, canUseDynamicDefinition, findDynamicTableRow } from "./dynamicBudgetComponents";
import { createInlineManualComponent, normalizeInlineManualComponent } from "../features/analysis/utils/manualComponentUtils";
import { inputBinding } from "./budgetScope";
export const BUDGET_COMPONENT_MIME = "application/x-workbench-budget-component";
export function portableBudgetComponent(component) {
  // Only authored fields travel; derived results, variable bindings and source
  // instrument links must be resolved afresh at the destination.
  const fields = ["name", "type", "isManual", "isInlineManual", "originalInput", "manualInputMode", "manualRawValue", "manualUnit", "distribution", "distributionDivisor", "dof", "dynamicDefinition", "dynamicDefinitionId", "dynamicOutputId"];
  const result = Object.fromEntries(fields.filter(key => component[key] !== undefined).map(key => [key, component[key]]));
  result.id = uuid(); result.type = "B"; result.isCore = false;
  if (result.dynamicDefinition) {
    result.dynamicDefinition = { ...result.dynamicDefinition, id: uuid() };
    result.dynamicDefinitionId = result.dynamicDefinition.id;
  }
  return result;
}
export function createInstrumentBudgetComponent(kind, unit = "") {
  const point = { value: "", unit };
  const component = kind === "manual" ? createInlineManualComponent({ id: uuid(), referencePoint: point })
    : createDynamicComponent(createDynamicDefinition(kind, point));
  return { id: uuid(), kind, name: "", budgetComponent: component };
}
export function associateBudgetComponent(session, kind, instrumentId, component) {
  const list = kind === "uut" ? "uuts" : "tmdes";
  const portable = portableBudgetComponent(component);
  const record = { id: uuid(), kind: portable.dynamicDefinition?.kind || "manual", name: portable.name || "", budgetComponent: portable };
  return { ...session, [list]: (session[list] || []).map(item => String(item.id) !== String(instrumentId) ? item : {
    ...item, instrument: { ...item.instrument, typeBComponents: [...(item.instrument?.typeBComponents || []), record] },
  }) };
}
export function canUseInstrumentBudgetComponent(record, nominal) {
  if (!record.budgetComponent) return false;
  const definition = record.budgetComponent.dynamicDefinition;
  if (!definition) return true;
  if (!canUseDynamicDefinition(definition, nominal)) return false;
  if (definition.kind === "table") { try { findDynamicTableRow(definition, nominal); } catch { return false; } }
  return true;
}
export function instantiateInstrumentBudgetComponent(record, scope) {
  const component = { ...record.budgetComponent, id: uuid(), ...inputBinding(scope), inlineDraft: false };
  // Keep a portable snapshot. Changes to the instance use the same editors as
  // any authored component, without changing the instrument specification.
  return { ...component, associatedTypeBId: record.id };
}
export function budgetDragProps(component) {
  return { draggable: component.type !== "A", hidden: component.type === "A", title: "Drag to a UUT or TMDE to associate this Type B component",
    onDragStart: event => {
      if (component.type === "A") { event.preventDefault(); return; }
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(BUDGET_COMPONENT_MIME, JSON.stringify(portableBudgetComponent(component)));
    }, onClick: event => event.stopPropagation() };
}

// Saving the instrument includes the active editor even when its click-away
// commit is still queued. Escape removes that draft and preserves the baseline.
export function withInstrumentEditorDrafts(instrument) {
  return { ...instrument, typeBComponents: (instrument.typeBComponents || []).map(record => {
    const component = record.budgetComponent;
    if (!component) return record;
    const draft = readEditorDraft(`${component.dynamicDefinitionId ? "dynamic" : "manual"}:${component.id}`);
    if (!draft) return record;
    const updated = component.dynamicDefinitionId ? { ...component, dynamicDefinition: draft, name: draft.name }
      : normalizeInlineManualComponent({ component, draft, referencePoint: { value: "", unit: component.unit_native || instrument.functions?.[0]?.unit || "" } });
    return { ...record, name: updated.name, budgetComponent: updated };
  }) };
}
