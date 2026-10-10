import PointNumericInput from "./PointNumericInput";
import React, { useState } from "react";
import { getPointRequirements, setPointRequirement } from "../../utils/pointRequirements";
import { commitFocusedPointField, isPointEditorPress } from "../../utils/pointEditorHandoff";

// Blank restores inheritance. Persist only the edited point's override so a
// calibration requirement never silently changes other points in the session.
export default function PointRequirementCell({ point, session, field, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const value = getPointRequirements(point, session)[field.name];
  const changed = Object.hasOwn(point.riskRequirements || {}, field.name);
  const isPercent = !["neededTUR", "calInt"].includes(field.name);
  const valid = draft.trim() === "" || (Number.isFinite(Number(draft)) && Number(draft) > 0 && (!isPercent || Number(draft) < 100));
  const commit = () => {
    if (!valid) return;
    onSave(setPointRequirement(point, session, field.name, draft));
    setEditing(false);
  };
  const open = event => {
    event.stopPropagation();
    event.preventDefault();
    commitFocusedPointField(event.currentTarget);
    setDraft(String(value));
    setEditing(true);
  };
  return <span className={`point-requirement-cell${changed ? " is-override" : " is-inherited"}${editing ? " point-value-editing" : ""}`} title={`${field.tooltip}${changed ? " — Point override" : " — Session default"}`}>
    <span className="point-edit-affordance">{editing ? <PointNumericInput autoFocus aria-label={field.label} aria-invalid={!valid}
      value={draft} onChange={event => setDraft(event.target.value)} onFocus={event => event.target.select()}
      onClick={event => event.stopPropagation()} onBlur={() => valid ? commit() : setEditing(false)}
      onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); commit(); } if (event.key === "Escape") setEditing(false); }} />
      : <button type="button" className="point-value-number" aria-label={`Edit ${field.label}`} data-point-editor-trigger
        onMouseDown={event => { if (isPointEditorPress(event)) open(event); }} onClick={open}>{value}</button>}
      </span>
  </span>;
}
