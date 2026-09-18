import React, { useState } from "react";
import { getPointRequirements, getPointRequirementOverrides, setPointRequirement } from "../../utils/pointRequirements";

// Blank restores inheritance. Persist only the edited point's override so a
// calibration requirement never silently changes other points in the session.
export default function PointRequirementCell({ point, session, field, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const value = getPointRequirements(point, session)[field.name];
  const changed = getPointRequirementOverrides(point, session).some(item => item.name === field.name);
  const isPercent = !["neededTUR", "calInt"].includes(field.name);
  const valid = draft.trim() === "" || (Number.isFinite(Number(draft)) && Number(draft) > 0 && (!isPercent || Number(draft) < 100));
  const commit = () => {
    if (!valid) return;
    onSave(setPointRequirement(point, session, field.name, draft));
    setEditing(false);
  };
  return <span className="point-requirement-cell" title={`${field.tooltip}${changed ? " — Differs from session default" : " — Session default"}`}>
    {editing ? <input autoFocus type="number" step="any" aria-label={field.label} aria-invalid={!valid}
      value={draft} onChange={event => setDraft(event.target.value)} onFocus={event => event.target.select()}
      onClick={event => event.stopPropagation()} onBlur={() => valid ? commit() : setEditing(false)}
      onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); commit(); } if (event.key === "Escape") setEditing(false); }} />
      : <button type="button" aria-label={`Edit ${field.label}`} onClick={event => { event.stopPropagation(); setDraft(String(value)); setEditing(true); }}>{value}{changed && <span className="point-requirement-override" aria-label="Differs from session default"> ⚠</span>}</button>}
  </span>;
}
