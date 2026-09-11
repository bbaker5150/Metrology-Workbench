import React, { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTimes, faArrowUp, faArrowDown } from "@fortawesome/free-solid-svg-icons";
import { unitSystem, getUnitDisplayLabel } from "../../../utils/uncertaintyMath";
import { oldErrorDistributions } from "../utils/budgetUtils";
import { resolveDynamicComponent, validateBudgetEquation, dynamicMeasurementValue } from "../../../utils/dynamicBudgetComponents";

export default function DynamicBudgetComponentRow({ component, referencePoint, showDof, onCommit, onRemove, onMoveUp, onMoveDown }) {
  const [draft, setDraft] = useState(component.dynamicDefinition);
  const [editing, setEditing] = useState(false);
  const [naming, setNaming] = useState(false);
  const [error, setError] = useState("");
  const rowRef = useRef(null);
  const dirty = useRef(false);
  useEffect(() => { if (!editing) setDraft(component.dynamicDefinition); }, [component.dynamicDefinition, editing]);
  if (!draft) return null;
  const change = patch => { dirty.current = true; setDraft(previous => ({ ...previous, ...patch })); };
  const commit = () => { if (dirty.current) { onCommit(draft); dirty.current = false; } setEditing(false); setNaming(false); };
  let boundValue = "Not Set";
  try { boundValue = dynamicMeasurementValue(referencePoint, draft.measurementUnit); } catch { /* Preview explains incomplete inputs. */ }
  const preview = resolveDynamicComponent(component, draft, referencePoint || {});
  const unitSelect = (key, label) => <label>{label}<select aria-label={label} value={draft[key]} onChange={e => change({ [key]: e.target.value })}>
    <option value="">Choose unit</option>{Object.keys(unitSystem.units).map(unit => <option key={unit} value={unit}>{getUnitDisplayLabel(unit)}</option>)}
  </select></label>;
  const cells = [{ label: "Measurement point", key: "point" }, ...draft.columns.flatMap(column =>
    (draft.mode === "limits" ? ["low", "high"] : ["value"]).map(key => ({ column: column.id, key, label: `${column.name}${key === "low" ? " lower" : key === "high" ? " upper" : ""}` })))];
  const setCell = (rows, index, cell, value) => {
    const row = rows[index];
    rows[index] = cell.key === "point" ? { ...row, point: value } : { ...row, values: { ...row.values, [cell.column]: { ...row.values?.[cell.column], [cell.key]: value } } };
  };
  const buildEquation = () => {
    const validation = validateBudgetEquation(draft.equation);
    if (validation.status !== "ok") { setError(validation.error || "Enter an equation."); return; }
    setError("");
    change({ variables: Object.fromEntries(validation.variables.map(symbol => [symbol, draft.variables[symbol] || { name: "", value: "" }])),
      pointVariable: validation.variables.includes(draft.pointVariable) ? draft.pointVariable : validation.variables[0] || "" });
  };
  return <tr ref={rowRef} className={`budget-dynamic-row${editing ? " is-editing" : ""}`}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) commit(); }}
    onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); dirty.current = false; setDraft(component.dynamicDefinition); setEditing(false); setNaming(false); e.target.blur(); } else if (e.key === "Enter" && e.target.tagName !== "BUTTON") { e.preventDefault(); commit(); e.target.blur(); } }}>
    <td className="budget-source-cell has-order-controls">
      <div className="budget-order-controls"><button type="button" title="Move component up" onClick={onMoveUp}><FontAwesomeIcon icon={faArrowUp}/></button><button type="button" title="Move component down" onClick={onMoveDown}><FontAwesomeIcon icon={faArrowDown}/></button></div>
      {!draft.name || naming ? <input autoFocus={naming} className="dynamic-source-name" aria-label="Error source name" placeholder="Error source name" value={draft.name} onChange={e => { setNaming(true); change({ name: e.target.value }); }}/> : <button type="button" className="inline-tolerance-summary dynamic-source-label" onClick={() => setNaming(true)}>{draft.name}</button>}
      <span className="dynamic-component-kind">{draft.kind === "table" ? "Table" : "Equation"}{draft.columns.length > 1 ? ` · ${draft.columns.find(c => c.id === component.dynamicOutputId)?.name || "Removed column"}` : ""}</span>
    </td>
    <td className="dynamic-tolerance-cell">
      {!editing ? <button type="button" className="inline-tolerance-summary" title={preview.pendingReason || "Edit shared uncertainty definition"} onClick={() => setEditing(true)}>{preview.dynamicSummary || "Not Set"}</button> :
        <div className="dynamic-budget-editor" aria-label={draft.kind === "table" ? "Tabular uncertainty editor" : "Equation uncertainty editor"}>
          <div className="dynamic-budget-options">{unitSelect("measurementUnit", "Measurement unit")}{unitSelect("outputUnit", "Uncertainty unit")}
            <label>Values represent<select aria-label="Values represent" value={draft.mode} onChange={e => change({ mode: e.target.value, distribution: e.target.value === "standard" ? "1" : "1.732" })}>
              <option value="standard">Standard uncertainty</option><option value="tolerance">Tolerance limit (±)</option>{draft.kind === "table" && <option value="limits">Lower / upper error limits</option>}
            </select></label>
          </div>
          {draft.kind === "table" ? <>
            <div className="dynamic-table-scroll"><table className="dynamic-input-table"><thead><tr>{cells.map((cell, i) => <th key={i}>{cell.label}</th>)}<th/></tr></thead><tbody>
              {draft.rows.map((row, index) => <tr key={row.id}>{cells.map((cell, col) => <td key={col}><input inputMode="decimal" aria-label={`${cell.label} row ${index + 1}`} value={cell.key === "point" ? row.point : row.values?.[cell.column]?.[cell.key] ?? ""}
                onChange={e => { const rows = [...draft.rows]; setCell(rows, index, cell, e.target.value); change({ rows }); }}
                onPaste={e => {
                  const text = e.clipboardData.getData("text/plain"); if (!/[\t\n]/.test(text)) return;
                  e.preventDefault(); const matrix = text.replace(/\r?\n$/, "").split(/\r?\n/).slice(0, 1000).map(line => line.split("\t")); const rows = [...draft.rows];
                  matrix.forEach((values, r) => { while (rows.length <= index + r) rows.push({ id: uuid(), point: "", values: {} }); values.slice(0, cells.length - col).forEach((value, c) => setCell(rows, index + r, cells[col + c], value)); }); change({ rows });
                }}
                onKeyDown={e => { if (e.key === "Tab" && !e.shiftKey && index === draft.rows.length - 1 && col === cells.length - 1) { e.preventDefault(); change({ rows: [...draft.rows, { id: uuid(), point: "", values: {} }] }); requestAnimationFrame(() => rowRef.current?.querySelector(`[aria-label="Measurement point row ${index + 2}"]`)?.focus()); } }}/></td>)}
                <td><button type="button" aria-label={`Delete table row ${index + 1}`} onClick={() => change({ rows: draft.rows.length === 1 ? [{ id: uuid(), point: "", values: {} }] : draft.rows.filter(r => r.id !== row.id) })}><FontAwesomeIcon icon={faTimes}/></button></td></tr>)}
            </tbody></table></div>
            <div className="dynamic-editor-actions"><button type="button" onClick={() => change({ rows: [...draft.rows, { id: uuid(), point: "", values: {} }] })}><FontAwesomeIcon icon={faPlus}/> Row</button>
              <button type="button" onClick={() => change({ columns: [...draft.columns, { id: uuid(), name: `Uncertainty ${draft.columns.length + 1}` }] })}><FontAwesomeIcon icon={faPlus}/> Uncertainty column</button></div>
            {draft.columns.length > 1 && <div className="dynamic-column-names">{draft.columns.map((column, index) => <label key={column.id}>Column {index + 1}<input aria-label={`Uncertainty column ${index + 1} name`} value={column.name} onChange={e => change({ columns: draft.columns.map(c => c.id === column.id ? { ...c, name: e.target.value } : c) })}/></label>)}</div>}
          </> : <>
            <div className="dynamic-equation-entry"><input aria-label="Uncertainty equation" placeholder="A * B + C" value={draft.equation} onChange={e => change({ equation: e.target.value })} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); buildEquation(); } }}/><button type="button" aria-label="Set uncertainty equation" onClick={buildEquation}><FontAwesomeIcon icon={faPlus}/></button></div>
            <table className="dynamic-input-table"><thead><tr><th>Variable</th><th>Name</th><th>Nominal</th></tr></thead><tbody>{Object.entries(draft.variables).map(([symbol, variable]) => <tr key={symbol}>
              <td>{symbol}</td><td><input aria-label={`${symbol} name`} value={variable.name} onChange={e => change({ variables: { ...draft.variables, [symbol]: { ...variable, name: e.target.value } } })}/></td>
              <td><label className="dynamic-variable-binding"><input type="radio" aria-label={`Use measurement point for ${symbol}`} checked={draft.pointVariable === symbol} onChange={() => change({ pointVariable: symbol })}/>Measurement point</label>
                {draft.pointVariable === symbol ? <span>{boundValue} {getUnitDisplayLabel(draft.measurementUnit)}</span> : <input inputMode="decimal" aria-label={`${symbol} nominal`} value={variable.value} onChange={e => change({ variables: { ...draft.variables, [symbol]: { ...variable, value: e.target.value } } })}/> }</td>
            </tr>)}</tbody></table>{error && <div role="alert">{error}</div>}
          </>}
          <div className="dynamic-editor-preview" role="status">{preview.pendingReason || `This point: ${preview.dynamicSummary}`}</div>
          <p className="dynamic-editor-hint">Shared across budgets that use this component. Enter or click outside to apply.</p>
        </div>}
      {!editing && preview.pendingReason && <span className="dynamic-component-pending" title={preview.pendingReason}>{preview.pendingReason}</span>}
    </td>
    <td><select aria-label="Dynamic component distribution" value={draft.mode === "standard" ? "1" : draft.distribution} disabled={draft.mode === "standard"}
      onChange={e => { const next = { ...draft, distribution: e.target.value }; setDraft(next); onCommit(next); }}>
      {draft.mode === "standard" ? <option value="1">Normal (k=1)</option> : oldErrorDistributions.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
    </select></td><td>B</td>{showDof && <td>∞</td>}<td>{preview.value_native == null ? "—" : `${Number(preview.value_native.toPrecision(6))} ${getUnitDisplayLabel(preview.unit_native)}`}</td>
    <td className="action-cell"><button type="button" title="Remove component from this budget" aria-label="Remove dynamic component" onClick={() => onRemove?.(component.id, component)}><FontAwesomeIcon icon={faTimes}/></button></td>
  </tr>;
}
