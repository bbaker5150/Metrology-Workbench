import { FLUSH_EDITORS } from "../../../hooks/usePageExitRecovery";
import { readEditorDraft, saveEditorDraft, clearEditorDraft } from "../../../utils/editorRecovery";
import { budgetDragProps } from "../../../utils/instrumentBudgetComponents";
import GrowingNumericInput from "../../../components/common/GrowingNumericInput";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTimes, faArrowUp, faArrowDown, faLink, faExclamationTriangle } from "@fortawesome/free-solid-svg-icons";
import InlineMenuSelect from "../../../components/common/InlineMenuSelect";
import InlineSourceNameEditor from "../../../components/common/InlineSourceNameEditor";
import { unitSystem, getUnitDisplayLabel } from "../../../utils/uncertaintyMath";
import { oldErrorDistributions } from "../utils/budgetUtils";
import { resolveDynamicComponent, validateBudgetEquation, dynamicMeasurementValue, dynamicMeasurementUnit, findDynamicTableRow } from "../../../utils/dynamicBudgetComponents";

const emptyRow = () => ({ id: uuid(), point: "", values: {} });
const DISTRIBUTIONS = oldErrorDistributions.map(option => ({ value: option.value, label: option.label }));
const UNIT_OPTIONS = Object.keys(unitSystem.units).map(unit => ({ value: unit, label: getUnitDisplayLabel(unit) }));
const FallbackUnitSelect = props => <InlineMenuSelect {...props} options={UNIT_OPTIONS} width="max-content" />;
const isEditorPortal = target => target instanceof Element && Boolean(target.closest(".inline-unit-menu"));
const implicitUnits = (definition, point) => definition && ({ ...definition, measurementUnit: dynamicMeasurementUnit(definition, point), outputUnit: definition.outputUnit || point?.unit || "" });

export default function DynamicBudgetComponentRow({
  component, referencePoint, measurementPoint = referencePoint, showDof, onCommit, onRemove, onMoveUp, onMoveDown,
  UnitSelectComponent = FallbackUnitSelect, autoEdit = false, onEditorOpened,
}) {
  const draftKey = `dynamic:${component.id}`;
  const recovered = useRef(readEditorDraft(draftKey));
  const [draft, setDraft] = useState(() => recovered.current || implicitUnits(component.dynamicDefinition, referencePoint, measurementPoint));
  const [editing, setEditing] = useState(autoEdit || Boolean(recovered.current));
  const [naming, setNaming] = useState(false);
  const [distributionEditing, setDistributionEditing] = useState(false);
  const editorActive = editing || naming || distributionEditing;
  const rowRef = useRef(null);
  const triggerRef = useRef(null);
  const draftRef = useRef(draft);
  const definitionRef = useRef(component.dynamicDefinition);
  const commitRef = useRef(onCommit);
  const dirty = useRef(Boolean(recovered.current));
  const pendingCommit = useRef(null);
  const variableCache = useRef(draft?.variables || {});
  definitionRef.current = component.dynamicDefinition;
  commitRef.current = onCommit;

  useEffect(() => {
    if (!editing && !naming) {
      // A SharePoint save may not have reached the parent yet. Do not replace
      // the just-committed table/equation with its older empty definition and
      // flash "Not Set" on collapse. Accept the next changed saved definition.
      if (pendingCommit.current && JSON.stringify(component.dynamicDefinition) === pendingCommit.current.previous) return;
      pendingCommit.current = null;
      draftRef.current = implicitUnits(component.dynamicDefinition, referencePoint, measurementPoint);
      setDraft(draftRef.current);
      variableCache.current = component.dynamicDefinition?.variables || {};
    }
  }, [component.dynamicDefinition, referencePoint?.unit, measurementPoint?.unit, editing, naming]);

  const change = useCallback(patch => {
    const next = { ...draftRef.current, ...patch };
    dirty.current = true;
    draftRef.current = next;
    setDraft(next);
    saveEditorDraft(draftKey, next);
  }, [draftKey]);
  const finish = useCallback((cancel = false) => {
    if (cancel) {
      draftRef.current = definitionRef.current;
      setDraft(definitionRef.current);
      variableCache.current = definitionRef.current?.variables || {};
    } else if (dirty.current) {
      pendingCommit.current = { previous: JSON.stringify(definitionRef.current) };
      commitRef.current?.(draftRef.current);
    }
    clearEditorDraft(draftKey);
    dirty.current = false;
    setEditing(false);
    setNaming(false);
    setDistributionEditing(false);
  }, [draftKey]);

  useEffect(() => {
    if (!editorActive) return;
    const flush = () => finish();
    window.addEventListener(FLUSH_EDITORS, flush);
    return () => window.removeEventListener(FLUSH_EDITORS, flush);
  }, [editorActive, finish]);

  const focusEditor = useCallback(() => {
    requestAnimationFrame(() => {
      const definition = draftRef.current;
      if (definition?.kind !== "table") {
        rowRef.current?.querySelector('[aria-label="Uncertainty equation"], [aria-label="Low error limit equation"]')?.focus();
        return;
      }
      let index = 0;
      try { index = definition.rows.indexOf(findDynamicTableRow(definition, referencePoint)); } catch { /* Show incomplete entries for editing. */ }
      const column = definition.rows[index]?.point === "" ? 0 : 1;
      rowRef.current?.querySelector(`[data-dynamic-cell="${index}:${column}"]`)?.focus();
    });
  }, [referencePoint?.value, referencePoint?.unit]);

  useEffect(() => {
    if (!autoEdit) return;
    setEditing(true);
    onEditorOpened?.();
    focusEditor();
  }, [autoEdit, onEditorOpened, focusEditor]);

  useEffect(() => {
    if (!editorActive) return;
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
  }, [editorActive, finish]);

  const validation = useMemo(() => draft?.kind === "equation" ? validateBudgetEquation(draft.equation) : null, [draft?.kind, draft?.equation]);
  if (!draft) return null;
  const preview = resolveDynamicComponent(component, draft, referencePoint || {}, measurementPoint || {});
  let boundValue = "Not Set";
  try { boundValue = dynamicMeasurementValue(draft.kind === "equation" ? measurementPoint : referencePoint, draft.measurementUnit); } catch { /* The live preview explains incomplete inputs. */ }
  const kindLabel = draft.kind === "table" ? "Tabular" : "Equation";
  const measurementUnit = (draft.kind === "equation" ? measurementPoint?.unit : referencePoint?.unit) || draft.measurementUnit;
  const displayPoint = value => {
    if (value === "" || value == null || measurementUnit === draft.measurementUnit) return value;
    try { return Number(dynamicMeasurementValue({ value, unit: draft.measurementUnit }, measurementUnit).toPrecision(14)); } catch { return value; }
  };
  const displayColumns = draft.columns.filter(column => column.id === (component.dynamicOutputId || draft.columns[0]?.id));
  const cells = [{ label: "Measurement point", key: "point" }, ...displayColumns.flatMap(column =>
    (draft.mode === "limits" ? ["low", "high"] : ["value"]).map(key => ({ column: column.id, key, label: key === "low" ? "Low" : key === "high" ? "High" : "Uncertainty" })))];
  const setCell = (rows, index, cell, value) => {
    const row = rows[index];
    let point = value;
    if (cell.key === "point" && value !== "" && Number.isFinite(Number(value)) && measurementUnit !== draft.measurementUnit) {
      try { point = dynamicMeasurementValue({ value, unit: measurementUnit }, draft.measurementUnit); } catch { /* Validation remains visible. */ }
    }
    rows[index] = cell.key === "point" ? { ...row, point } : { ...row, values: { ...row.values, [cell.column]: { ...row.values?.[cell.column], [cell.key]: value } } };
  };
  const focusCell = (row, col = 0) => requestAnimationFrame(() => rowRef.current?.querySelector(`[data-dynamic-cell="${row}:${col}"]`)?.focus());
  const addRow = () => {
    const nextIndex = draftRef.current.rows.length;
    change({ rows: [...draftRef.current.rows, emptyRow()] });
    focusCell(nextIndex);
  };
  const updateEquation = (equation, key = "equation") => {
    const current = draftRef.current;
    const next = { ...current, [key]: equation };
    const results = (next.mode === "limits" ? [next.lowerEquation, next.upperEquation] : [next.equation]).map(value => validateBudgetEquation(value || ""));
    const result = { status: results.every(value => value.status === "empty") ? "empty" : results.some(value => value.status === "invalid") ? "invalid" : "ok", variables: [...new Set(results.flatMap(value => value.variables || []))] };
    variableCache.current = { ...variableCache.current, ...current.variables };
    if (result.status === "empty") { change({ [key]: equation, variables: {}, pointVariable: "" }); return; }
    if (result.status !== "ok") { change({ [key]: equation }); return; }
    change({
      [key]: equation,
      variables: Object.fromEntries(result.variables.map(symbol => [symbol, variableCache.current[symbol] || { name: "", value: "" }])),
      pointVariable: result.variables.includes(current.pointVariable) ? current.pointVariable
        : current.pointVariable || Object.keys(current.variables).length === 0 ? result.variables[0] || "" : "",
    });
  };
  const changeSymmetry = asymmetric => {
    const current = draftRef.current;
    if (asymmetric === (current.mode === "limits")) return;
    const patch = { mode: asymmetric ? "limits" : "tolerance",
      ...(current.kind === "equation" && asymmetric ? {
        lowerEquation: current.lowerEquation ?? (current.equation ? `-(${current.equation})` : ""),
        upperEquation: current.upperEquation ?? current.equation,
      } : {}),
      rows: current.rows.map(row => ({ ...row, values: Object.fromEntries(Object.entries(row.values || {}).map(([id, values]) => [id, asymmetric
        ? { ...values, low: values.low ?? (values.value !== "" && values.value != null ? -Number(values.value) : ""), high: values.high ?? values.value ?? "" }
        : { ...values, value: values.low !== "" && values.high !== "" && values.low != null && values.high != null ? Math.max(Math.abs(Number(values.low)), Math.abs(Number(values.high))) : "" }])) })),
    };
    if (current.kind === "equation") {
      if (!asymmetric && !current.equation && current.lowerEquation && current.upperEquation) patch.equation = `max(abs(${current.lowerEquation}), abs(${current.upperEquation}))`;
      const next = { ...current, ...patch };
      const symbols = [...new Set((asymmetric ? [next.lowerEquation, next.upperEquation] : [next.equation]).flatMap(equation => validateBudgetEquation(equation || "").variables || []))];
      variableCache.current = { ...variableCache.current, ...current.variables };
      patch.variables = Object.fromEntries(symbols.map(symbol => [symbol, variableCache.current[symbol] || { name: "", value: "" }]));
      patch.pointVariable = symbols.includes(current.pointVariable) ? current.pointVariable : "";
    }
    change(patch);
  };
  const changeDistribution = distribution => {
    // Choosing an error-limit distribution also makes the interpretation
    // explicit; a standard-uncertainty entry must not silently divide by k.
    change(distribution === "standard" ? { mode: "standard", distribution: "1" }
      : { mode: draftRef.current.mode === "standard" ? "tolerance" : draftRef.current.mode, distribution });
    if (!editing && !naming) {
      pendingCommit.current = { previous: JSON.stringify(definitionRef.current) };
      commitRef.current?.(draftRef.current);
      dirty.current = false;
    }
  };
  const openEditor = () => {
    setEditing(true);
    focusEditor();
  };
  const unitField = (key, label) => (
    <div className="dynamic-inline-field">
      <span>{label}</span>
      <UnitSelectComponent ariaLabel={label} value={draft[key]} onChange={value => change({ [key]: value })} compact width="max-content" />
    </div>
  );
  return (
    <tr ref={rowRef} className={`budget-dynamic-row budget-inline-manual-row${editorActive ? ` is-editing is-editing-${editing ? "tolerance" : naming ? "name" : "distribution"}` : ""}${preview.pendingReason ? " has-warning" : ""}`}
      onClick={event => {
        // Match manual rows: cell whitespace is an edit target too. Explicit
        // controls (especially remove/reorder) retain their own behavior.
        if (editorActive || event.target.closest("button, input, select, textarea, .action-cell, .budget-order-controls")) return;
        const cell = event.target.closest("td")?.cellIndex;
        if (cell === 0) setNaming(true);
        else if (cell === 2) setDistributionEditing(true);
        else openEditor();
      }}
      onKeyDown={event => {
        if (event.defaultPrevented || isEditorPortal(event.target)) return;
        const restoreTriggerFocus = () => requestAnimationFrame(() => {
          const trigger = naming ? rowRef.current?.querySelector('[aria-label="Edit error source name"]') : triggerRef.current;
          trigger?.focus({ preventScroll: true });
        });
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation(); finish(true);
          restoreTriggerFocus();
        } else if (event.key === "Enter" && ["INPUT", "TEXTAREA"].includes(event.target.tagName)) {
          event.preventDefault(); event.stopPropagation(); finish();
          restoreTriggerFocus();
        }
      }}>
      <td className="budget-source-cell has-order-controls"><span className="budget-component-drag" {...budgetDragProps(component)} aria-label="Drag Type B component">⠿</span>
        <div className="budget-order-controls">
          <button type="button" title="Move component up" aria-label="Move component up" onClick={onMoveUp}><FontAwesomeIcon icon={faArrowUp} /></button>
          <button type="button" title="Move component down" aria-label="Move component down" onClick={onMoveDown}><FontAwesomeIcon icon={faArrowDown} /></button>
        </div>
        {/* Names wrap within their existing column; they never request the
            temporary column expansion used by multi-control limit editors. */}
        <div className={naming ? "dynamic-source-editor" : "dynamic-source-content"}>
        {naming ? (
          <InlineSourceNameEditor autoFocus className="budget-inline-input budget-inline-name dynamic-source-name" aria-label="Error source name" placeholder="Not Set" value={draft.name}
            onBlur={() => editing ? setNaming(false) : finish()}
            onFocus={() => { if (!editing) setNaming(true); }}
            onChange={event => { if (!editing) setNaming(true); change({ name: event.target.value }); }} />
        ) : <button type="button" className={`inline-tolerance-summary dynamic-source-label${draft.name ? "" : " is-empty"}`} aria-label="Edit error source name" onMouseDown={event => { event.preventDefault(); setNaming(true); }} onClick={() => setNaming(true)}>{draft.name || "Not Set"}</button>}
        </div>
      </td>
      <td className="dynamic-tolerance-cell">
        {!editing ? (
          <button ref={triggerRef} type="button" className={`inline-tolerance-summary${preview.dynamicSummary ? "" : " is-empty"}`}
            title={preview.pendingReason || `Edit ${kindLabel.toLowerCase()} uncertainty`} onClick={openEditor}>
            {preview.dynamicSummary || "Not Set"}
          </button>
        ) : (
          <div className="dynamic-budget-editor" data-budget-editor="limit" role="group" aria-label={`${kindLabel} uncertainty editor`}>
            <div className="dynamic-budget-options">
              {unitField("outputUnit", "Uncertainty unit")}
              <div className="inline-tolerance-mini-toggle" role="group" aria-label="Error limit symmetry">
                <button type="button" title="Symmetric tolerance" aria-pressed={draft.mode !== "limits"} className={draft.mode !== "limits" ? "is-active" : ""} onClick={() => changeSymmetry(false)}>±</button>
                <button type="button" title="Asymmetric tolerance" aria-pressed={draft.mode === "limits"} className={draft.mode === "limits" ? "is-active" : ""} onClick={() => changeSymmetry(true)}>+/−</button>
              </div>
            </div>
            {draft.kind === "table" ? <>
              <div className="dynamic-table-scroll"><table className="dynamic-input-table"><thead>
                <tr><th>Measurement point <span className="dynamic-header-unit">{getUnitDisplayLabel(measurementUnit)}</span></th>
                  {cells.slice(1).map(cell => <th key={`${cell.column}:${cell.key}`}>{cell.key === "value" ? "±" : cell.label}<span className="dynamic-header-unit">{getUnitDisplayLabel(draft.outputUnit)}</span></th>)}<th aria-label="Row actions" /></tr>
              </thead><tbody>
                {draft.rows.map((row, index) => <tr key={row.id}>
                  {cells.map((cell, col) => <td key={`${cell.column || "point"}:${cell.key}`}>
                    <GrowingNumericInput inputMode="decimal" data-dynamic-cell={`${index}:${col}`} aria-label={`${cell.label} row ${index + 1}`}
                      placeholder="—" value={cell.key === "point" ? displayPoint(row.point) : row.values?.[cell.column]?.[cell.key] ?? ""}
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

              </div>
            </> : <>
              {(draft.mode === "limits" ? ["lowerEquation", "upperEquation"] : ["equation"]).map(key => <div className="dynamic-equation-entry" key={key}>
                <span>{key === "equation" ? "±" : key === "lowerEquation" ? "Low" : "High"}</span>
                <input aria-label={key === "equation" ? "Uncertainty equation" : key === "lowerEquation" ? "Low error limit equation" : "High error limit equation"} placeholder="a * x + b" value={draft[key] || ""}
                  aria-invalid={Boolean(draft[key] && validateBudgetEquation(draft[key]).status === "invalid")}
                  onChange={event => updateEquation(event.target.value, key)}
                  onKeyDown={event => {
                    if (event.key !== "Enter" || validation?.status !== "ok") return;
                    const next = Object.keys(draft.variables).find(symbol => symbol !== draft.pointVariable && draft.variables[symbol].value === "");
                    if (next) {
                      event.preventDefault(); event.stopPropagation();
                      rowRef.current?.querySelector(`[data-dynamic-nominal="${next}"]`)?.focus();
                    }
                  }} />
              </div>)}
              {Object.keys(draft.variables).length > 0 && <div className="dynamic-table-scroll"><table className="dynamic-input-table dynamic-variable-table">
                <thead><tr><th>Variable</th><th>Description</th><th>Value</th></tr></thead>
                <tbody>{Object.entries(draft.variables).map(([symbol, variable]) => <tr key={symbol}>
                  <td className="dynamic-variable-symbol">{symbol}</td>
                  <td><input aria-label={`${symbol} name`} placeholder="Description" value={variable.name}
                    onChange={event => change({ variables: { ...draft.variables, [symbol]: { ...variable, name: event.target.value } } })} /></td>
                  <td><div className="dynamic-variable-value">
                    {draft.pointVariable === symbol ? <span className="dynamic-bound-value">{displayPoint(boundValue)} {getUnitDisplayLabel(measurementUnit)}</span> :
                      <GrowingNumericInput inputMode="decimal" placeholder="Value" data-dynamic-nominal={symbol} aria-label={`${symbol} nominal`} value={variable.value}
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
            </div>
          </div>
        )}
      </td>
      <td>{distributionEditing ? <select autoFocus className="mini-select budget-inline-distribution" aria-label="Error limit distribution" value={draft.mode === "standard" ? "standard" : draft.distribution}
        onChange={event => { changeDistribution(event.target.value); setDistributionEditing(false); }}>
        <option value="" disabled>Not Set</option>{draft.mode === "standard" && <option value="standard">Standard uncertainty (k=1)</option>}
        {DISTRIBUTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select> : <button type="button" className={`inline-tolerance-summary${draft.distribution ? "" : " is-empty"}`} aria-label="Edit error limit distribution" onClick={() => setDistributionEditing(true)}>{draft.mode === "standard" ? "Standard uncertainty (k=1)" : DISTRIBUTIONS.find(option => option.value === draft.distribution)?.label || "Not Set"}</button>}</td>
      <td>B</td>{showDof && <td>∞</td>}
      <td>{/incompatible|No unit is set/i.test(preview.pendingReason || "") ? <span role="img" aria-label={preview.pendingReason} title={preview.pendingReason} className="budget-pending-uncertainty" style={{ color: "var(--status-warning, #b58100)" }}><FontAwesomeIcon icon={faExclamationTriangle} /></span> : <span className={preview.value_native == null ? "inline-tolerance-summary is-empty budget-inline-not-set" : "budget-standard-uncertainty"} title={preview.pendingReason || undefined}>{preview.value_native == null ? "Not Set" : `± ${Number(preview.value_native.toPrecision(6))} ${getUnitDisplayLabel(preview.unit_native)}`}</span>}</td>
      <td className="action-cell"><button type="button" title="Remove component from this budget" aria-label="Remove dynamic component" onClick={() => onRemove?.(component.id, component)}><FontAwesomeIcon icon={faTimes} /></button></td>
    </tr>
  );
}
