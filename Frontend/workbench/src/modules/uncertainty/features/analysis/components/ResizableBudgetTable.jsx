import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { preserveTableTextSelection } from "../../../utils/tableTextSelection";
import { measureTableColumnWidths } from "../../../utils/measureTableColumnWidths";
import { fillTrailingColumn } from "../../../utils/fillTrailingColumn";

const STORAGE_PREFIX = "uncertalytics:budget-column-widths:v1:";
const RESET_EVENT = "uncert-reset-ui-sizes";
const CHANGE_EVENT = "uncert-size-budget-column";
const minimumWidth = (key) => key === "actions" ? 36 : 60;
const EDITORS = "[data-budget-editor], .budget-inline-tolerance-cell .inline-tolerance-editor, .budget-range-selector";

function readWidths(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([, width]) => Number.isFinite(width) && width > 0))
      : null;
  } catch {
    return null;
  }
}

// Let the browser size every column from its content until the user resizes it.
// Capture all rendered widths on the first drag so adjacent columns stay put.
export default function ResizableBudgetTable({ scope, columns, children }) {
  const storageKey = STORAGE_PREFIX + scope;
  const tableRef = useRef(null);
  const dragCleanup = useRef(null);
  const [saved, setSaved] = useState(() => ({ key: storageKey, widths: readWidths(storageKey) }));
  const widths = saved.key === storageKey ? saved.widths : readWidths(storageKey);
  const fixed = Boolean(widths && columns.every(({ key }) => Number.isFinite(widths[key])));
  const [editorMinimums, setEditorMinimums] = useState({});
  const [viewportWidth, setViewportWidth] = useState(0);
  // Keep the action gutter compact; the last data column owns spare space.
  const trailingIndex = columns.findLastIndex(({ key }) => key !== "actions");
  const filledWidths = fixed ? fillTrailingColumn(columns.map(({ key }) => Math.max(widths[key], editorMinimums[key] || 0)), viewportWidth, trailingIndex) : null;
  const liveWidths = fixed ? Object.fromEntries(columns.map(({ key }, index) => [key, filledWidths[index]])) : null;

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const releaseTextSelection = preserveTableTextSelection(table);
    const measure = () => {
      const viewport = table.parentElement;
      if (viewport?.clientWidth) {
        const zoom = parseFloat(getComputedStyle(table).zoom) || 1;
        setViewportWidth(viewport.clientWidth / zoom);
        const minimum = `${viewport.clientWidth / zoom}px`;
        if (table.style.getPropertyValue("--budget-table-min-width") !== minimum) table.style.setProperty("--budget-table-min-width", minimum);
        const editorWidth = `${Math.max(320, Math.min(640, viewport.clientWidth / zoom - 28))}px`;
        if (table.style.getPropertyValue("--budget-editor-width") !== editorWidth) table.style.setProperty("--budget-editor-width", editorWidth);
      }
      const next = {};
      table.querySelectorAll(EDITORS).forEach(editor => {
        const cell = editor.closest("td");
        if (!cell || cell.closest("table") !== table) return;
        const style = getComputedStyle(cell);
        const key = editor.dataset.budgetEditor || (editor.matches(".budget-range-selector") ? "source" : "limit");
        next[key] = Math.max(next[key] || 0, Math.ceil(Math.max(editor.offsetWidth, editor.scrollWidth) + parseFloat(style.paddingLeft || 0) + parseFloat(style.paddingRight || 0) + 2));
      });
      setEditorMinimums(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const observeEditors = () => {
      resize?.disconnect();
      if (table.parentElement) resize?.observe(table.parentElement);
      table.querySelectorAll(EDITORS).forEach(editor => resize?.observe(editor));
      measure();
    };
    observeEditors();
    let frame = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; observeEditors(); });
    };
    const mutation = new MutationObserver(schedule);
    mutation.observe(table, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-budget-editor", "class"] });
    const zoomMutation = new MutationObserver(measure);
    zoomMutation.observe(table, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", measure);
    return () => { releaseTextSelection(); cancelAnimationFrame(frame); resize?.disconnect(); mutation.disconnect(); zoomMutation.disconnect(); window.removeEventListener("resize", measure); };
  }, []);


  const saveWidths = (next) => {
    setSaved({ key: storageKey, widths: next });
    try {
      if (next) localStorage.setItem(storageKey, JSON.stringify(next));
      else localStorage.removeItem(storageKey);
    } catch { /* Resizing still works when storage is unavailable. */ }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key: storageKey, widths: next } }));
  };

  useEffect(() => {
    const reset = () => {
      dragCleanup.current?.();
      // Clear hidden budget groups too, so the global reset is complete.
      try {
        Object.keys(localStorage).filter(key => key.startsWith(STORAGE_PREFIX)).forEach(key => localStorage.removeItem(key));
      } catch { /* Local state can always be reset. */ }
      setSaved({ key: storageKey, widths: null });
    };
    const sync = (event) => {
      if (event.detail?.key === storageKey) setSaved({ key: storageKey, widths: event.detail.widths });
    };
    window.addEventListener(RESET_EVENT, reset);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      dragCleanup.current?.();
      window.removeEventListener(RESET_EVENT, reset);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, [storageKey]);

  const snapshot = () => {
    const table = tableRef.current;
    const scale = table.offsetWidth ? table.getBoundingClientRect().width / table.offsetWidth : 1;
    const sizes = Object.fromEntries([...(table.tHead?.rows[0]?.cells || [])].map(th => [
      th.dataset.budgetColumn, th.getBoundingClientRect().width / (scale || 1),
    ]));
    return { scale: scale || 1, sizes };
  };
  const resizeColumn = (key, delta, sizes) => saveWidths({
    ...(fixed ? widths : sizes),
    [key]: Math.max(minimumWidth(key), sizes[key] + delta),
  });
  const fitColumn = key => {
    const measured = measureTableColumnWidths(tableRef.current, "budgetColumn");
    const { sizes } = snapshot();
    saveWidths({ ...sizes, [key]: Math.max(minimumWidth(key), measured[key] || sizes[key]) });
  };
  const startResize = (event, key) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragCleanup.current?.();
    const { scale, sizes } = snapshot();
    const start = event.clientX;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (e) => resizeColumn(key, (e.clientX - start) / scale, sizes);
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
      dragCleanup.current = null;
    };
    dragCleanup.current = finish;
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
  };

  return (
    <table
      ref={tableRef}
      className={`uncertainty-budget-table budget-resizable-table${fixed ? " has-custom-widths" : ""}`}
      style={fixed ? { width: columns.reduce((total, { key }) => total + liveWidths[key], 0) } : undefined}
    >
      {fixed && <colgroup>{columns.map(({ key }) => <col key={key} style={{ width: liveWidths[key] }} />)}</colgroup>}
      <thead><tr>{columns.map(({ key, label, accessibleLabel }) => (
        <th key={key} data-budget-column={key} aria-label={label || accessibleLabel} onDoubleClick={() => fitColumn(key)}>
          <span className="budget-resizable-header-content" title={label}>{label}</span>
          <button
            type="button"
            className="instrument-column-resize-handle budget-column-resize-handle"
            aria-label={`Resize ${label || accessibleLabel} column`}
            title={`Drag to resize ${label || accessibleLabel} column. Double-click to fit contents.`}
            onPointerDown={event => startResize(event, key)}
            onDoubleClick={event => { event.stopPropagation(); fitColumn(key); }}
            onKeyDown={event => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                resizeColumn(key, event.key === "ArrowLeft" ? -12 : 12, snapshot().sizes);
              }
            }}
          />
        </th>
      ))}</tr></thead>
      {children}
    </table>
  );
}
