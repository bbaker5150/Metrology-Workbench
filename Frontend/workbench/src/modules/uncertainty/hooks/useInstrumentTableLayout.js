import { updateInstrumentCellHighlights } from "../utils/instrumentCellSelection";
import { useCallback, useLayoutEffect, useState } from "react";
import { preserveTableTextSelection } from "../utils/tableTextSelection";
import { createInstrumentSelectionOutline } from "../utils/instrumentSelectionOutline";

const EDITORS = ".inline-desc-fields, .inline-range-editor.is-editing, .inline-tolerance-editor, .inline-resolution-editor, .inline-distribution-editor, .instrument-custom-field-input";
const HOVER_CLASSES = new Set(['row-hovered', 'col-hovered', 'hovered-spec-row']);
const layoutClasses = value => (value || '').split(/\s+/).filter(name => name && !HOVER_CLASSES.has(name)).sort().join(' ');

export const instrumentMutationAffectsLayout = record =>
  record.type !== 'attributes' || record.attributeName !== 'class' ||
  layoutClasses(record.oldValue) !== layoutClasses(record.target.getAttribute('class'));

export const expandedInstrumentWidths = (weights, baseline, requirements, absolute = false) => {
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const scale = absolute ? Math.max(1, baseline / total) : baseline / total;
  return weights.map((weight, index) => Math.max(weight * scale, requirements[index] || 0));
};

// Keep saved proportional widths untouched. Only the live colgroup receives
// temporary pixel widths, so closing an editor restores the user's layout.
export default function useInstrumentTableLayout(containerRef) {
  const [container, setContainer] = useState(null);
  const attach = useCallback(node => {
    containerRef.current = node;
    setContainer(node);
  }, [containerRef]);
  useLayoutEffect(() => {
    const table = container?.querySelector(":scope > table");
    if (!table) return undefined;
    const releaseTextSelection = preserveTableTextSelection(table);
    // A sibling overlay stays outside the table observer and cannot trigger
    // another layout pass when its perimeter changes.
    const selectionOutline = createInstrumentSelectionOutline(container, table);
    let hoveredRow = null;
    const hover = event => {
      hoveredRow = event.target?.closest?.('tr[data-selection-key]') || null;
      updateInstrumentCellHighlights(table, hoveredRow);
    };
    const leave = () => { hoveredRow = null; updateInstrumentCellHighlights(table); };
    table.addEventListener("pointerover", hover);
    table.addEventListener("pointerleave", leave);
    const card = container.closest(".panel-card");
    let frame = null;
    const setProperty = (node, name, value) => {
      if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
    };
    const sync = () => {
      // Hidden tables (and non-layout test renderers) have no geometry to
      // synchronize. ResizeObserver will schedule again when they are shown.
      if (!container.getClientRects().length) return;
      const cols = [...table.querySelectorAll(":scope > colgroup > col")];
      const absolute = cols.every(col => col.style.width.endsWith("px"));
      // Reset proportions against the full available panel, not its last saved
      // pixel width. Distribute spare space so the full-width card stays filled.
      card?.style.removeProperty("--instrument-panel-width");
      const requirements = [];
      table.querySelectorAll(EDITORS).forEach(editor => {
        const cell = editor.closest("td");
        if (!cell || cell.colSpan !== 1) return;
        const style = getComputedStyle(cell);
        // Include adjacent add/delete controls and the cell's real padding.
        const content = editor.closest(".range-row-cell") || editor;
        // scrollWidth/offsetWidth are layout pixels; client rects include CSS
        // zoom and cannot be mixed into colgroup widths.
        let width = Math.max(content.scrollWidth, content.offsetWidth);
        if (editor.matches('.inline-desc-fields')) {
          const wrapper = editor.closest('.uut-description-content');
          const badge = wrapper?.querySelector('.instrument-usage-badge');
          if (badge) width += badge.offsetWidth + (parseFloat(getComputedStyle(wrapper).columnGap) || 0);
        }
        const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2;
        // Later range rows omit row-spanned description cells, so cellIndex
        // is not their logical column index. Resolve via the actual header.
        const key = editor.matches('.inline-desc-fields') ? 'description'
          : editor.matches('.inline-range-editor') ? 'range'
          : editor.matches('.inline-tolerance-editor') ? 'tolerance'
          : editor.matches('.inline-resolution-editor') ? 'resolution' : editor.matches('.instrument-custom-field-input') ? cell.dataset.customColumn : 'distribution';
        const index = [...(table.tHead?.rows[0]?.cells || [])].findIndex(header => header.dataset.instrumentColumn === key);
        if (index >= 0) requirements[index] = Math.max(requirements[index] || 0, width + padding);
      });
      const zoom = parseFloat(getComputedStyle(table).zoom) || 1;
      const baseline = Math.max(container.clientWidth / zoom, parseFloat(table.style.minWidth) || 1200);
      const widths = expandedInstrumentWidths(cols.map(col => parseFloat(col.style.width) || 1), baseline, requirements, absolute);
      cols.forEach((col, index) => setProperty(col, "--instrument-live-column-width", `${widths[index]}px`));
      const tableWidth = widths.reduce((sum, width) => sum + width, 0);
      setProperty(table, "--instrument-live-table-width", `${tableWidth}px`);

      // Sticky cells normally stop at their own scroller's top, even when that
      // scroller has moved behind the analysis tabs. Offset them to the visible
      // page edge; the native table/scroller still clips them at its bottom.
      const rect = container.getBoundingClientRect();
      const containerScale = rect.width / container.offsetWidth || 1;
      let top = 0;
      for (let parent = container.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll|hidden)/.test(getComputedStyle(parent).overflowY)) {
          top = Math.max(top, parent.getBoundingClientRect().top + parent.clientTop);
        }
      }
      const tabs = container.closest(".analysis-container")?.querySelector(":scope > .analysis-tabs");
      if (tabs) top = Math.max(top, tabs.getBoundingClientRect().bottom);
      const headerHeight = table.tHead?.getBoundingClientRect().height || 0;
      const offset = Math.min(
        Math.max(0, top - rect.top - container.clientTop * containerScale),
        Math.max(0, container.clientHeight * containerScale - headerHeight),
      );
      setProperty(table, "--instrument-header-offset", `${offset / (containerScale * zoom)}px`);
      updateInstrumentCellHighlights(table, hoveredRow);
      selectionOutline.sync();
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        sync();
      });
    };
    // Layout writes also notify this observer. Never recalculate in the
    // mutation microtask itself: drag/zoom changes must yield to input/paint,
    // and a burst of row changes only needs one measurement per frame.
    // Hover changes color only. Re-measuring every cell on mouse movement can
    // feed rounding/scrollbar changes back into the widths of a large table.
    const mutation = new MutationObserver(records => {
      if (!records || records.some(instrumentMutationAffectsLayout)) schedule();
    });
    mutation.observe(table, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class", "style", "rowspan", "colspan", "data-range-selected", "data-selection-mode"] });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resize?.observe(container);
    resize?.observe(table);
    container.addEventListener("focusin", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    sync();
    return () => {
      table.removeEventListener("pointerover", hover);
      table.removeEventListener("pointerleave", leave);
      releaseTextSelection();
      selectionOutline.destroy();
      cancelAnimationFrame(frame);
      card?.style.removeProperty("--instrument-panel-width");
      mutation.disconnect();
      resize?.disconnect();
      container.removeEventListener("focusin", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [container]);
  return attach;
}
