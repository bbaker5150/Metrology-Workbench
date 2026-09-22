import React, { useState } from "react";
import { InlineManualComponentRow } from "../../analysis/components/UncertaintyBudgetTable";
import DynamicBudgetComponentRow from "../../analysis/components/DynamicBudgetComponentRow";
import { InlineToleranceCell, applyToleranceCaseChange, getSpecRows } from "../../analysis/components/UncertaintyPanel";
import { createInstrumentBudgetComponent } from "../../../utils/instrumentBudgetComponents";
import { normalizeInlineManualComponent } from "../../analysis/utils/manualComponentUtils";
import { resolveDynamicComponent } from "../../../utils/dynamicBudgetComponents";
export default function ReusableTypeBEditor({ components, onChange, referenceUnit, onActivate }) {
  const [editingId, setEditingId] = useState(null);
  const point = { value: "", unit: referenceUnit };
  const update = (record, component) => onChange(components.map(item => item.id === record.id
    ? { ...record, name: component.dynamicDefinition?.name || component.name || "", budgetComponent: component } : item));
  const remove = record => onChange(components.filter(item => item.id !== record.id));
  const add = kind => { const record = createInstrumentBudgetComponent(kind, referenceUnit); onChange([...components, record]); setEditingId(record.id); onActivate?.(record.id); };
  return <div className="instrument-reusable-typeb">
    <p>Reusable components are offered in each budget’s Add component menu. Tabular components appear only for matching measurement points.</p>
    <div className="spec-toolbar-actions">{["manual", "table", "equation"].map(kind => <button type="button" className="lib-pill-btn" key={kind} onClick={() => add(kind)}>Add {kind === "table" ? "tabular" : kind}</button>)}</div>
    {components.some(item => item.budgetComponent) && <div className="budget-section-table-wrap"><table className="uncertainty-budget-table"><thead><tr><th>Error source</th><th>Error limits / equation</th><th>Distribution</th><th>Type</th><th>Standard uncertainty</th><th>Actions</th></tr></thead><tbody>
      {components.filter(item => item.budgetComponent).map(record => {
        const component = record.budgetComponent;
        if (component.dynamicDefinitionId) return <DynamicBudgetComponentRow key={record.id}
          component={resolveDynamicComponent(component, component.dynamicDefinition, point)} referencePoint={point}
          autoEdit={editingId === record.id} onEditorOpened={() => setEditingId(null)}
          onCommit={definition => update(record, { ...component, dynamicDefinition: definition, name: definition.name })}
          onRemove={() => remove(record)} />;
        return <InlineManualComponentRow key={record.id} component={component} referencePoint={point} sigFigs={6}
          ToleranceEditorComponent={InlineToleranceCell} applyToleranceChange={applyToleranceCaseChange} formatToleranceSummary={getSpecRows}
          onCommit={draft => update(record, normalizeInlineManualComponent({ component, draft, referencePoint: point }))}
          onRemove={() => remove(record)} />;
      })}
    </tbody></table></div>}
  </div>;
}
