import DynamicUncertaintyFields from "./DynamicUncertaintyFields";
import { FLUSH_EDITORS } from "../../../hooks/usePageExitRecovery";
import { readEditorDraft, saveEditorDraft, clearEditorDraft } from "../../../utils/editorRecovery";
import { budgetDragProps } from "../../../utils/instrumentBudgetComponents";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes, faArrowUp, faArrowDown, faExclamationTriangle } from "@fortawesome/free-solid-svg-icons";
import InlineMenuSelect from "../../../components/common/InlineMenuSelect";
import InlineSourceNameEditor from "../../../components/common/InlineSourceNameEditor";
import { unitSystem, getUnitDisplayLabel } from "../../../utils/uncertaintyMath";
import { oldErrorDistributions } from "../utils/budgetUtils";
import { resolveDynamicComponent, dynamicMeasurementUnit, findDynamicTableRow } from "../../../utils/dynamicBudgetComponents";

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

  const openedAutomatically = useRef(false);
  useEffect(() => {
    if (!autoEdit) { openedAutomatically.current = false; return; }
    if (openedAutomatically.current) return;
    openedAutomatically.current = true;
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

  if (!draft) return null;
  const preview = resolveDynamicComponent(component, draft, referencePoint || {}, measurementPoint || {});
  const kindLabel = draft.kind === "table" ? "Tabular" : "Equation";
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
      <td {...budgetDragProps(component)} className="budget-source-cell has-order-controls">
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
          <DynamicUncertaintyFields definition={draft} component={component}
            referencePoint={referencePoint} measurementPoint={measurementPoint}
            onChange={change} UnitSelectComponent={UnitSelectComponent} />
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
