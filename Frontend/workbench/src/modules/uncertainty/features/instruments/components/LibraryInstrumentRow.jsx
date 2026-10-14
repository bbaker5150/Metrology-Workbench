import React, { useState } from "react";
import { v4 as uuid } from "uuid";
import BuilderSpecificationRow from "./BuilderSpecificationRow";
import BuilderUnitSelect from "./BuilderUnitSelect";
import { unitSystem } from "../../../utils/uncertaintyMath";
import TypeBComponentsEditor from "./TypeBComponentsEditor";
import { applyToleranceCaseChange, localizeSharedInstrumentEdit } from "../../analysis/components/UncertaintyPanel";
import { validateInstrumentSpecifications } from "../../../utils/instrumentValidation";

export default function LibraryInstrumentRow({ instrument, selected, onSelect, onEdit, onSave, sourceBadge, draft: managedDraft, setDraft: setManagedDraft }) {
  const [localDraft, setLocalDraft] = useState(null);
  const draft = setManagedDraft ? managedDraft : localDraft;
  const setDraft = setManagedDraft || setLocalDraft;
  const [expanded, setExpanded] = useState({});
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const value = draft || instrument;
  const patch = update => setDraft(previous => ({ ...(previous || instrument), ...update }));
  const patchFunction = (index, update) => patch({ functions: (value.functions || []).map((fn, i) => i === index ? { ...fn, ...update } : fn) });
  const patchRange = (fi, ri, update) => patchFunction(fi, { ranges: value.functions[fi].ranges.map((range, i) => i === ri ? { ...range, ...update } : range) });
  const save = async () => {
    const issues = validateInstrumentSpecifications(value);
    if (issues.length) { setError(issues.map(issue => issue.message || String(issue)).join(" ")); return; }
    setSaving(true); setError("");
    try {
      const normalized = { ...value, scope: value.scope === "shared" ? "validated" : value.scope };
      const local = localizeSharedInstrumentEdit({ instrument: normalized }, [instrument]).instrument;
      await onSave({ ...local, type: "library" }, { requireSaved: true });
      setDraft(null); setEditing(null);
    } catch (failure) { setError(failure.message || "Could not save instrument. Try again."); }
    finally { setSaving(false); }
  };
  return <>
    <tr className={`hover-row ${selected ? "row-selected" : ""}`} tabIndex={0} aria-selected={selected}
      title="Select instrument" onClick={onSelect} onDoubleClick={() => !draft && onEdit(instrument)}>
      {["manufacturer", "model", "description"].map(field => <td key={field}>
        {editing === field ? <input autoFocus className="library-inline-input" aria-label={field}
          value={value[field] || ""} disabled={saving} onClick={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()} onChange={event => patch({ [field]: event.target.value })}
          onBlur={() => setEditing(null)} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter" || event.key === "Escape") setEditing(null); }} />
          : <button className="library-inline-value" onClick={event => { event.stopPropagation(); setEditing(field); }}
              onDoubleClick={event => { event.stopPropagation(); if (!draft) onEdit(instrument); }}
              aria-label={`Edit ${field}: ${value[field] || "Not set"}`}>{value[field] || "—"}</button>}
      </td>)}
      <td>{sourceBadge}</td>
      <td onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
        {(value.functions || []).map((fn, i) => <button key={fn.id || i} className="status-pill" aria-expanded={!!expanded[i]}
          onClick={() => setExpanded(previous => ({ ...previous, [i]: !previous[i] }))}>{fn.name} {expanded[i] ? "▴" : "▾"}</button>)}
        <button className="status-pill" aria-expanded={!!expanded.typeB} onClick={() => setExpanded(previous => ({ ...previous, typeB: !previous.typeB }))}>Type B</button>
        <button className="status-pill" aria-label={`Add function to ${value.model || "instrument"}`} disabled={saving} onClick={() => {
          const index = (value.functions || []).length;
          patch({ functions: [...(value.functions || []), { id: uuid(), name: "Measurement", unit: "", ranges: [] }] });
          setExpanded(previous => ({ ...previous, [index]: true }));
        }}>+ Function</button>
      </td>
    </tr>
    {(value.functions || []).map((fn, fi) => expanded[fi] && <tr className="detail-row" key={fn.id || fi}><td colSpan="5">
      <fieldset disabled={saving} className="library-inline-specs">
        <div className="function-spec-header">
          <input className="library-inline-input" aria-label="Function name" value={fn.name || ""} onChange={event => patchFunction(fi, { name: event.target.value })} />
          <BuilderUnitSelect value={fn.unit || ""} ariaLabel="Function unit" options={Object.keys(unitSystem.units).map(unit => ({ value: unit, label: unit }))} onChange={unit => patchFunction(fi, { unit })} />
          <button className="lib-pill-btn" onClick={() => patchFunction(fi, { ranges: [...(fn.ranges || []), { id: uuid(), min: "", max: "", unit: fn.unit || "", tolerances: {} }] })}>+ Range</button>
        </div>
        <table className="ranges-table builder-spec-table"><thead><tr><th>Range</th><th>Tolerance</th><th>Distribution</th><th>Resolution</th><th /></tr></thead><tbody>
          {(fn.ranges || []).map((range, ri) => <BuilderSpecificationRow key={range.id || ri} range={range} fn={fn}
            onPatch={update => patchRange(fi, ri, update)}
            onToleranceCommit={(key, component) => patchRange(fi, ri, { tolerances: applyToleranceCaseChange(range.tolerances || {}, key, component) })}
            distribution={Object.values(range.tolerances || {}).find(component => component?.distribution)?.distribution || range.tolerances?.bandDistribution}
            onDistributionChange={distribution => patchRange(fi, ri, { tolerances: Object.fromEntries([
              ...Object.entries(range.tolerances || {}).map(([key, component]) => [key, component && typeof component === "object" ? { ...component, distribution } : component]), ["bandDistribution", distribution]]) })}
            onDelete={() => patchFunction(fi, { ranges: fn.ranges.filter((_, i) => i !== ri) })} />)}
        </tbody></table>
      </fieldset>
    </td></tr>)}
    {expanded.typeB && <tr className="detail-row"><td colSpan="5"><fieldset disabled={saving} className="library-inline-specs">
      <TypeBComponentsEditor components={value.typeBComponents || []} onChange={typeBComponents => patch({ typeBComponents })} />
    </fieldset></td></tr>}
    {(draft || error) && <tr><td colSpan="5"><div className="library-inline-actions">
      <button className="lib-pill-btn" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>
      <button className="lib-pill-btn" disabled={saving} onClick={() => { setDraft(null); setError(""); }}>Discard changes</button>
      {["shared", "validated"].includes(instrument.scope) && <span>Changes are saved as a local copy.</span>}
      {error && <span role="alert">{error}</span>}
    </div></td></tr>}
  </>;
}
