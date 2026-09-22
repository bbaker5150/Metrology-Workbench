import React, { useState } from "react";
import { InlineManualComponentRow } from "../../analysis/components/UncertaintyBudgetTable";
import DynamicBudgetComponentRow from "../../analysis/components/DynamicBudgetComponentRow";
import InlineMenuSelect from "../../../components/common/InlineMenuSelect";
import { UnitSelect, InlineToleranceCell, applyToleranceCaseChange, getSpecRows } from "../../analysis/components/UncertaintyPanel";
import { createInstrumentBudgetComponent } from "../../../utils/instrumentBudgetComponents";
import { normalizeInlineManualComponent } from "../../analysis/utils/manualComponentUtils";
import { resolveDynamicComponent } from "../../../utils/dynamicBudgetComponents";
export function TypeBAddMenu({ onAdd }) {
  return <InlineMenuSelect className="typeb-add-menu" width="26px" ariaLabel="Add Type B component" getDisplayLabel={() => "+"}
    options={[{ value: "manual", label: "Add manual component" }, { value: "table", label: "Add tabular component" }, { value: "equation", label: "Add equation component" }]}
    onChange={onAdd} showOptionMeta={false} />;
}
export default function ReusableTypeBEditor({ components, onChange, referenceUnit, onActivate, activeId, showAddButton = true }) {
  const [editingId, setEditingId] = useState(null);
  const point = { value: "", unit: referenceUnit };
  const update = (record, component) => onChange(components.map(item => item.id === record.id
    ? { ...record, name: component.dynamicDefinition?.name || component.name || "", budgetComponent: component } : item));
  const remove = record => onChange(components.filter(item => item.id !== record.id));
  const add = kind => { const record = createInstrumentBudgetComponent(kind, referenceUnit); onChange([...components, record]); setEditingId(record.id); onActivate?.(record.id); };
  return <div className="instrument-reusable-typeb">
    {showAddButton && <div className="spec-toolbar-actions"><TypeBAddMenu onAdd={add} /></div>}
    {components.some(item => item.budgetComponent) && <div className="budget-section-table-wrap"><table className="uncertainty-budget-table"><thead><tr><th>Error source</th><th>Error limits / equation</th><th>Distribution</th><th>Type</th><th>Standard uncertainty</th><th>Actions</th></tr></thead><tbody>
      {components.filter(item => item.budgetComponent).map(record => {
        const component = record.budgetComponent;
        if (component.dynamicDefinitionId) return <DynamicBudgetComponentRow key={record.id}
          component={resolveDynamicComponent(component, component.dynamicDefinition, point)} referencePoint={point} UnitSelectComponent={UnitSelect}
          autoEdit={editingId === record.id || (activeId === record.id && component.inlineDraft === true)} onEditorOpened={() => setEditingId(null)}
          onCommit={definition => update(record, { ...component, dynamicDefinition: definition, name: definition.name, inlineDraft: false })}
          onRemove={() => remove(record)} />;
        return <InlineManualComponentRow key={record.id} component={component} referencePoint={point} sigFigs={6}
          ToleranceEditorComponent={InlineToleranceCell} applyToleranceChange={applyToleranceCaseChange} formatToleranceSummary={getSpecRows}
          onCommit={draft => update(record, normalizeInlineManualComponent({ component, draft, referencePoint: point }))}
          onRemove={() => remove(record)} />;
      })}
    </tbody></table></div>}
  </div>;
}
