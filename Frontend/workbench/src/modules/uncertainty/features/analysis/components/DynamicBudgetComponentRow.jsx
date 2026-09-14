import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTimes, faArrowUp, faArrowDown, faLink } from "@fortawesome/free-solid-svg-icons";
import InlineMenuSelect from "../../../components/common/InlineMenuSelect";
import { unitSystem, getUnitDisplayLabel } from "../../../utils/uncertaintyMath";
import { oldErrorDistributions } from "../utils/budgetUtils";
import { resolveDynamicComponent, validateBudgetEquation, dynamicMeasurementValue } from "../../../utils/dynamicBudgetComponents";

const emptyRow = () => ({ id: uuid(), point: "", values: {} });
const MODE_OPTIONS = [
  { value: "standard", label: "Standard uncertainty" },
  { value: "tolerance", label: "Error limit (±)" },
  { value: "limits", label: "Lower / upper error limits" },
];
const DISTRIBUTIONS = oldErrorDistributions.map(option => ({ value: option.value, label: option.label }));
const UNIT_OPTIONS = Object.keys(unitSystem.units).map(unit => ({ value: unit, label: getUnitDisplayLabel(unit) }));
const FallbackUnitSelect = props => <InlineMenuSelect {...props} options={UNIT_OPTIONS} width="max-content" />;
const isEditorPortal = target => target instanceof Element && Boolean(target.closest(".inline-unit-menu"));

export default function DynamicBudgetComponentRow({
  component, referencePoint, showDof, onCommit, onRemove, onMoveUp, onMoveDown,
  UnitSelectComponent = FallbackUnitSelect, autoEdit = false, onEditorOpened,
}) {
  const [draft, setDraft] = useState(component.dynamicDefinition);
  const [editing, setEditing] = useState(autoEdit);
  const [naming, setNaming] = useState(false);
  const rowRef = useRef(null);
  const triggerRef = useRef(null);
  const draftRef = useRef(draft);
  const definitionRef = useRef(component.dynamicDefinition);
  const commitRef = useRef(onCommit);
  const dirty = useRef(false);
  const variableCache = useRef(draft?.variables || {});
  definitionRef.current = component.dynamicDefinition;
  commitRef.current = onCommit;

  useEffect(() => {
    if (!editing && !naming) {
      draftRef.current = component.dynamicDefinition;
      setDraft(component.dynamicDefinition);
      variableCache.current = component.dynamicDefinition?.variables || {};
    }
  }, [component.dynamicDefinition, editing, naming]);

  const change = useCallback(patch => {
    const next = { ...draftRef.current, ...patch };
    dirty.current = true;
    draftRef.current = next;
    setDraft(next);
  }, []);
  const finish = useCallback((cancel = false) => {
    if (cancel) {
      draftRef.current = definitionRef.current;
      setDraft(definitionRef.current);
      variableCache.current = definitionRef.current?.variables || {};
    } else if (dirty.current) {
      commitRef.current?.(draftRef.current);
    }
    dirty.current = false;
    setEditing(false);
    setNaming(false);
  }, []);

  useEffect(() => {
    if (!autoEdit) return;
    setEditing(true);
    onEditorOpened?.();
    // New components begin in the name field; Tab continues into the definition.
    rowRef.current?.querySelector('[aria-label="Error source name"]')?.focus();
  }, [autoEdit, onEditorOpened]);

  useEffect(() => {
    if (!editing && !naming) return;
    let pending;
    const outside = event => {
      if (rowRef.current?.contains(event.target) || isEditorPortal(event.target)) return;
      if (event.target?.closest?.(".instrument-column-resize-handle")) return;
      // Let the destination receive its click before collapsing the row.
      clearTimeout(pending);
      pending = setTimeout(() => finish(), 0);
    };
    document.addEventListener("click", outside, true);
    document.addEventListener("focusin", outside, true);
    return () => {
      clearTimeout(pending);
      document.removeEventListener("click", outside, true);
      document.removeEventListener("focusin", outside, true);
    };
  }, [editing, naming, finish]);

  const validation = useMemo(() => draft?.kind === "equation" ? validateBudgetEquation(draft.equation) : null, [draft?.kind, draft?.equation]);
  if (!draft) return null;
  const preview = resolveDynamicComponent(component, draft, referencePoint || {});
  let boundValue = "Not Set";
  try { boundValue = dynamicMeasurementValue(referencePoint, draft.measurementUnit); } catch { /* The live preview explains incomplete inputs. */ }
  const kindLabel = draft.kind === "table" ? "Tabular" : "Equation";
  const cells = [{ label: "Measurement point", key: "point" }, ...draft.columns.flatMap(column =>
    (draft.mode === "limits" ? ["low", "high"] : ["value"]).map(key => ({ column: column.id, key, label: `${column.name}${key === "low" ? " lower" : key === "high" ? " upper" : ""}` })))];
  const setCell = (rows, index, cell, value) => {
    const row = rows[index];
    rows[index] = cell.key === "point" ? { ...row, point: value } : { ...row, values: { ...row.values, [cell.column]: { ...row.values?.[cell.column], [cell.key]: value } } };
  };
  const focusCell = (row, col = 0) => requestAnimationFrame(() => rowRef.current?.querySelector(`[data-dynamic-cell="${row}:${col}"]`)?.focus());
  const addRow = () => {
    const nextIndex = draftRef.current.rows.length;
    change({ rows: [...draftRef.current.rows, emptyRow()] });
    focusCell(nextIndex);
  };
  const updateEquation = equation => {
    const result = validateBudgetEquation(equation);
    const current = draftRef.current;
    variableCache.current = { ...variableCache.current, ...current.variables };
    if (result.status === "empty") { change({ equation, variables: {}, pointVariable: "" }); return; }
    if (result.status !== "ok") { change({ equation }); return; }
    change({
      equation,
      variables: Object.fromEntries(result.variables.map(symbol => [symbol, variableCache.current[symbol] || { name: "", value: "" }])),
      pointVariable: result.variables.includes(current.pointVariable) ? current.pointVariable
        : current.pointVariable || Object.keys(current.variables).length === 0 ? result.variables[0] || "" : "",
    });
  };
  const changeDistribution = distribution => {
    change({ distribution });
    if (!editing && !naming) {
      commitRef.current?.(draftRef.current);
      dirty.current = false;
    }
  };
  const openEditor = () => {
    setEditing(true);
    requestAnimationFrame(() => rowRef.current?.querySelector(draft.kind === "table" ? '[data-dynamic-cell="0:0"]' : '[aria-label="Uncertainty equation"]')?.focus());
  };
  const unitField = (key, label) => (
    <div className="dynamic-inline-field">
      <span>{label}</span>
      <UnitSelectComponent ariaLabel={label} value={draft[key]} onChange={value => change({ [key]: value })} compact width="max-content" />
    </div>
  );
  return (
    <tr ref={rowRef} className={`budget-dynamic-row${editing ? " is-editing" : ""}`}
      onKeyDown={event => {
        if (event.defaultPrevented || isEditorPortal(event.target)) return;
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation(); finish(true);
          requestAnimationFrame(() => triggerRef.current?.focus());
        } else if (event.key === "Enter" && event.target.tagName === "INPUT") {
          event.preventDefault(); event.stopPropagation(); finish();
          requestAnimationFrame(() => triggerRef.current?.focus());
        }
      }}>
      <td className="budget-source-cell has-order-controls">
        <div className="budget-order-controls">
          <button type="button" title="Move component up" aria-label="Move component up" onClick={onMoveUp}><FontAwesomeIcon icon={faArrowUp} /></button>
          <button type="button" title="Move component down" aria-label="Move component down" onClick={onMoveDown}><FontAwesomeIcon icon={faArrowDown} /></button>
        </div>
        <div className={editing || naming ? "dynamic-source-editor" : "dynamic-source-content"} data-budget-editor={editing || naming ? "source" : undefined}>
        {!draft.name || naming || editing ? (
          <input autoFocus={naming} className="dynamic-source-name" aria-label="Error source name" placeholder="Error source name" value={draft.name}
            onFocus={() => { if (!editing) setNaming(true); }}
            onChange={event => { if (!editing) setNaming(true); change({ name: event.target.value }); }} />
        ) : <button type="button" className="inline-tolerance-summary dynamic-source-label" title="Edit error source name" onClick={() => setNaming(true)}>{draft.name}</button>}
        <span className="dynamic-component-kind">{kindLabel}{draft.columns.length > 1 ? ` · ${draft.columns.find(column => column.id === component.dynamicOutputId)?.name || "Removed column"}` : ""}</span>
        </div>
      </td>
      <td className="dynamic-tolerance-cell">
        {!editing ? (
          <button ref={triggerRef} type="button" className={`inline-tolerance-summary${preview.pendingReason ? " is-empty" : ""}`}
            title={preview.pendingReason || `Edit ${kindLabel.toLowerCase()} uncertainty`} onClick={openEditor}>
            {preview.pendingReason ? "Not Set" : preview.dynamicSummary}
          </button>
        ) : (
          <div className="dynamic-budget-editor" data-budget-editor="limit" role="group" aria-label={`${kindLabel} uncertainty editor`}>
            <div className="dynamic-budget-options">
              {unitField("measurementUnit", "Measurement unit")}
              {unitField("outputUnit", "Uncertainty unit")}
              <div className="dynamic-inline-field"><span>Values represent</span>
                <InlineMenuSelect ariaLabel="Values represent" value={draft.mode} width="max-content" menuWidth={245} showOptionMeta={false}
                  options={draft.kind === "table" ? MODE_OPTIONS : MODE_OPTIONS.slice(0, 2)}
                  onChange={mode => change({ mode, distribution: mode === "standard" ? "1" : draft.mode === "standard" ? "1.732" : draft.distribution })} />
              </div>
            </div>
            {draft.kind === "table" ? <>
              <div className="dynamic-table-scroll"><table className="dynamic-input-table"><thead>
                <tr><th rowSpan={draft.mode === "limits" ? 2 : 1}>Measurement point <span className="dynamic-header-unit">{getUnitDisplayLabel(draft.measurementUnit)}</span></th>
                  {draft.columns.map((column, index) => <th key={column.id} colSpan={draft.mode === "limits" ? 2 : 1}>
                    <div className="dynamic-column-heading"><input aria-label={`Uncertainty column ${index + 1} name`} value={column.name}
                      onChange={event => change({ columns: draft.columns.map(c => c.id === column.id ? { ...c, name: event.target.value } : c) })} />
                      <span className="dynamic-header-unit">{getUnitDisplayLabel(draft.outputUnit)}</span></div>
                  </th>)}<th rowSpan={draft.mode === "limits" ? 2 : 1} aria-label="Row actions" /></tr>
                {draft.mode === "limits" && <tr>{draft.columns.flatMap(column => [<th key={`${column.id}-low`}>Lower</th>, <th key={`${column.id}-high`}>Upper</th>])}</tr>}
              </thead><tbody>
                {draft.rows.map((row, index) => <tr key={row.id}>
                  {cells.map((cell, col) => <td key={`${cell.column || "point"}:${cell.key}`}>
                    <input inputMode="decimal" data-dynamic-cell={`${index}:${col}`} aria-label={`${cell.label} row ${index + 1}`}
                      placeholder="—" value={cell.key === "point" ? row.point : row.values?.[cell.column]?.[cell.key] ?? ""}
                      onChange={event => { const rows = [...draft.rows]; setCell(rows, index, cell, event.target.value); change({ rows }); }}
                      onPaste={event => {
                        const text = event.clipboardData.getData("text/plain");
                        if (!/[\t\n]/.test(text)) return;
                        event.preventDefault();
                        const matrix = text.replace(/\r?\n$/, "").split(/\r?\n/).slice(0, 1000).map(line => line.split("\t"));
                        const rows = [...draft.rows];
                        matrix.forEach((values, r) => {
                          while (rows.length <= index + r) rows.push(emptyRow());
                          values.slice(0, cells.length - col).forEach((value, c) => setCell(rows, index + r, cells[col + c], value));
                        });
                        change({ rows });
                      }}
                      onKeyDown={event => {
                        if (event.key === "Tab" && !event.shiftKey && index === draft.rows.length - 1 && col === cells.length - 1 && (row.point !== "" || event.currentTarget.value !== "")) {
                          event.preventDefault(); event.stopPropagation(); addRow();
                        } else if (["ArrowUp", "ArrowDown"].includes(event.key)) {
                          const next = index + (event.key === "ArrowUp" ? -1 : 1);
                          if (next >= 0 && next < draft.rows.length) { event.preventDefault(); focusCell(next, col); }
                        }
                      }} />
                  </td>)}
                  <td className="dynamic-row-action-cell"><button type="button" className="dynamic-inline-action dynamic-row-remove" title="Remove row" aria-label={`Delete table row ${index + 1}`}
                    onClick={() => change({ rows: draft.rows.length === 1 ? [emptyRow()] : draft.rows.filter(r => r.id !== row.id) })}><FontAwesomeIcon icon={faTimes} /></button></td>
                </tr>)}
              </tbody></table></div>
              <div className="dynamic-editor-actions">
                <button type="button" className="dynamic-inline-action" onClick={addRow}><FontAwesomeIcon icon={faPlus} /> Row</button>
                <button type="button" className="dynamic-inline-action" onClick={() => {
                  const index = draft.columns.length;
                  change({ columns: [...draft.columns, { id: uuid(), name: `Uncertainty ${index + 1}` }] });
                  requestAnimationFrame(() => rowRef.current?.querySelector(`[aria-label="Uncertainty column ${index + 1} name"]`)?.select());
                }}><FontAwesomeIcon icon={faPlus} /> Uncertainty column</button>
              </div>
            </> : <>
              <div className="dynamic-equation-entry">
                <span aria-hidden="true">f(x)</span>
                <input aria-label="Uncertainty equation" placeholder="a * x + b" value={draft.equation}
                  aria-invalid={Boolean(draft.equation && validation?.status === "invalid")}
                  onChange={event => updateEquation(event.target.value)}
                  onKeyDown={event => {
                    if (event.key !== "Enter" || validation?.status !== "ok") return;
                    const next = Object.keys(draft.variables).find(symbol => symbol !== draft.pointVariable && draft.variables[symbol].value === "");
                    if (next) {
                      event.preventDefault(); event.stopPropagation();
                      rowRef.current?.querySelector(`[data-dynamic-nominal="${next}"]`)?.focus();
                    }
                  }} />
              </div>
              {Object.keys(draft.variables).length > 0 && <div className="dynamic-table-scroll"><table className="dynamic-input-table dynamic-variable-table">
                <thead><tr><th>Variable</th><th>Description</th><th>Value</th></tr></thead>
                <tbody>{Object.entries(draft.variables).map(([symbol, variable]) => <tr key={symbol}>
                  <td className="dynamic-variable-symbol">{symbol}</td>
                  <td><input aria-label={`${symbol} name`} placeholder="Description" value={variable.name}
                    onChange={event => change({ variables: { ...draft.variables, [symbol]: { ...variable, name: event.target.value } } })} /></td>
                  <td><div className="dynamic-variable-value">
                    {draft.pointVariable === symbol ? <span className="dynamic-bound-value">{boundValue} {getUnitDisplayLabel(draft.measurementUnit)}</span> :
                      <input inputMode="decimal" placeholder="Value" data-dynamic-nominal={symbol} aria-label={`${symbol} nominal`} value={variable.value}
                        onChange={event => change({ variables: { ...draft.variables, [symbol]: { ...variable, value: event.target.value } } })} />}
                    <button type="button" className="dynamic-inline-action dynamic-variable-binding" data-ui-toggle aria-pressed={draft.pointVariable === symbol}
                      aria-label={`Use measurement point for ${symbol}`} title={draft.pointVariable === symbol ? "Linked to this measurement point · click to enter a fixed value" : "Use this measurement point"}
                      onClick={() => change({ pointVariable: draft.pointVariable === symbol ? "" : symbol })}><FontAwesomeIcon icon={faLink} /></button>
                  </div></td>
                </tr>)}</tbody>
              </table></div>}
            </>}
            <div className="dynamic-editor-footer">
              <span className={`dynamic-editor-preview${preview.pendingReason ? " is-pending" : ""}`} role="status">
                {preview.pendingReason || <><span>This point</span> {preview.dynamicSummary}</>}
              </span>
              <span className="dynamic-shared-note" title="Edits apply to every budget using this shared component."><FontAwesomeIcon icon={faLink} /> Shared component</span>
            </div>
          </div>
        )}
      </td>
      <td>{draft.mode === "standard" ? <span>Normal (k=1)</span> :
        <InlineMenuSelect ariaLabel="Dynamic component distribution" value={draft.distribution} options={DISTRIBUTIONS} onChange={changeDistribution} width="max-content" showOptionMeta={false} />}</td>
      <td>B</td>{showDof && <td>∞</td>}
      <td>{preview.value_native == null ? "—" : `${Number(preview.value_native.toPrecision(6))} ${getUnitDisplayLabel(preview.unit_native)}`}</td>
      <td className="action-cell"><button type="button" title="Remove component from this budget" aria-label="Remove dynamic component" onClick={() => onRemove?.(component.id, component)}><FontAwesomeIcon icon={faTimes} /></button></td>
    </tr>
  );
}
