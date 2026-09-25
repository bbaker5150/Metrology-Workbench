import React, { useMemo, useRef } from "react";
import { v4 as uuid } from "uuid";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTimes, faLink } from "@fortawesome/free-solid-svg-icons";
import GrowingNumericInput from "../../../components/common/GrowingNumericInput";
import { getUnitDisplayLabel } from "../../../utils/uncertaintyMath";
import { resolveDynamicComponent, validateBudgetEquation, dynamicMeasurementValue } from "../../../utils/dynamicBudgetComponents";

const emptyRow = () => ({ id: uuid(), point: "", values: {} });

// Shared uncertainty-value editor. Distribution belongs to the surrounding table column.
export default function DynamicUncertaintyFields({
  definition: draft, component = {}, referencePoint, measurementPoint = referencePoint,
  onChange, UnitSelectComponent, showPreview = true,
}) {
  const rowRef = useRef(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const variableCache = useRef(draft?.variables || {});
  const change = patch => {
    draftRef.current = { ...draftRef.current, ...patch };
    onChange(patch);
  };
  const validation = useMemo(() => draft?.kind === "equation" ? validateBudgetEquation(draft.equation) : null, [draft?.kind, draft?.equation]);
  if (!draft) return null;
  const preview = resolveDynamicComponent({ ...component, dynamicOutputId: component.dynamicOutputId || draft.columns?.[0]?.id }, draft, referencePoint || {}, measurementPoint || {});
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
  const unitField = (key, label) => (
    <div className="dynamic-inline-field">
      <span>{label}</span>
      <UnitSelectComponent ariaLabel={label} value={draft[key]} onChange={value => change({ [key]: value })} compact width="max-content" />
    </div>
  );
  return (<div ref={rowRef} className="dynamic-budget-editor" data-budget-editor="limit" role="group" aria-label={`${kindLabel} uncertainty editor`}>
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
                  style={{ "--equation-input-width": `calc(${Math.max(12, String(draft[key] || "").length + 1)}ch + 12px)` }}
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
            {showPreview && preview.pendingReason !== "This uncertainty column was removed from the shared table." && <div className="dynamic-editor-footer">
              <span className={`dynamic-editor-preview${preview.pendingReason ? " is-pending" : ""}`} role="status">
                {preview.pendingReason || <><span>This point</span> {preview.dynamicSummary}</>}
              </span>
            </div>}
          </div>);
}
