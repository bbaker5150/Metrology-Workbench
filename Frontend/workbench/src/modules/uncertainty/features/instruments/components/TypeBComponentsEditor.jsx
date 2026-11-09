import React, { useMemo } from "react";
import ReusableTypeBEditor from "./ReusableTypeBEditor";
import { normalizeInstrumentTypeBComponents } from "../../../utils/instrumentBudgetComponents";

// All associated components use the same manual/table/equation rows as budgets.
export default function TypeBComponentsEditor({ components = [], onChange, referenceUnit = "", showAddButton = true, activeId, onActivate, readOnly = false }) {
  const normalized = useMemo(() => normalizeInstrumentTypeBComponents(components), [components]);
  return <div className="typeb-editor"><ReusableTypeBEditor components={normalized} onChange={onChange} readOnly={readOnly}
    referenceUnit={referenceUnit} showAddButton={showAddButton} activeId={activeId} onActivate={onActivate} /></div>;
}
