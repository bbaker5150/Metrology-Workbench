import { alignEmptyHintArrows } from "../utils/alignEmptyHintArrows";
import { claimWorkspaceSelection } from "../utils/workspaceSelection";
import { updateInstrumentCellHighlights } from "../utils/instrumentCellSelection";
import { attachInstrumentPointerDrag } from "../utils/instrumentPointerDrag";
import { useCallback, useLayoutEffect, useState } from "react";
import { preserveTableTextSelection } from "../utils/tableTextSelection";
import { createInstrumentSelectionOutline } from "../utils/instrumentSelectionOutline";

const EDITORS = ".inline-desc-fields, .inline-range-editor.is-editing, .qualifier-range-cell .inline-range-editor, .inline-tolerance-editor, .inline-resolution-editor, .inline-distribution-editor, .instrument-custom-field-input";
export const qualifierColumnKey = cell => {
  const depth = Number(cell.getAttribute('data-qualifier-cell')) || 1;
  return depth > 1 ? `qualifier${depth}` : 'qualifier';
};
const HOVER_CLASSES = new Set(['row-hovered', 'col-hovered', 'hovered-spec-row']);
const layoutClasses = value => (value || '').split(/\s+/).filter(name => name && !HOVER_CLASSES.has(name)).sort().join(' ');

// Measure a detached copy at its intrinsic width. Never feed an editor's
// allocated column width back into that column's next size requirement.
const equationEditorWidth = editor => {
  const host = document.createElement('div');
  host.className = 'uncertainty-module';
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:max-content;';
  const context = document.createElement('div');
  context.className = 'instrument-equipment-table';
  const probe = editor.cloneNode(true);
  probe.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  probe.style.cssText = 'width:max-content;min-width:0;max-width:none;';
  probe.querySelectorAll('.dynamic-table-scroll, .dynamic-variable-table').forEach(node => {
    node.style.width = 'max-content'; node.style.minWidth = '0'; node.style.maxWidth = 'none';
  });
  probe.querySelectorAll('.dynamic-variable-table').forEach(node => { node.style.tableLayout = 'auto'; });
  context.appendChild(probe); host.appendChild(context); document.body.appendChild(host);
  const width = Math.max(probe.offsetWidth, probe.scrollWidth);
  host.remove();
  return width;
};

export const instrumentMutationAffectsLayout = record =>
  record.type !== 'attributes' || record.attributeName !== 'class' ||
  layoutClasses(record.oldValue) !== layoutClasses(record.target.getAttribute('class'));

export const expandedInstrumentWidths = (weights, baseline, requirements, absolute = false, fillIndex = weights.length - 1) => {
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const scale = absolute ? 1 : baseline / total;
  // Preserve authored peers and editor requirements. Only the designated
  // trailing column absorbs unused viewport space; excess content scrolls.
  const widths = weights.map((weight, index) => Math.max(weight * scale, requirements[index] || 0));
  if (fillIndex >= 0) widths[fillIndex] += Math.max(0, baseline - widths.reduce((sum, width) => sum + width, 0));
  return widths;
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
    const claim = () => claimWorkspaceSelection("instruments");
    table.addEventListener("pointerdown", claim, true);
    const releaseTextSelection = preserveTableTextSelection(table);
    const releasePointerDrag = attachInstrumentPointerDrag(table);
    // A sibling overlay stays outside the table observer and cannot trigger
    // another layout pass when its perimeter changes.
    const selectionOutline = createInstrumentSelectionOutline(container, table);
    let hoveredRow = null;
    let hoveredCell = null;
    const hover = event => {
      const cell = event.target?.closest?.('td');
      let row = cell?.closest('tr[data-selection-key]') || null;
      if (row && cell.rowSpan > 1) {
        // Moving within a shared cell emits no new pointerover. Resolve the
        // physical range by Y so shared cells follow exactly that range.
        row = [...table.querySelectorAll('tr[data-selection-key]')].find(candidate => {
          const rect = candidate.getBoundingClientRect();
          return candidate.dataset.selectionKey === row.dataset.selectionKey && event.clientY >= rect.top && event.clientY < rect.bottom;
        }) || row;
      }
      if (row === hoveredRow && cell === hoveredCell) return;
      hoveredRow = row; hoveredCell = cell;
      updateInstrumentCellHighlights(table, hoveredRow, hoveredCell);
    };
    const leave = () => { hoveredRow = null; hoveredCell = null; updateInstrumentCellHighlights(table); };
    table.addEventListener("pointerover", hover);
    table.addEventListener("pointermove", hover);
    table.addEventListener("pointerleave", leave);
    const card = container.closest(".panel-card");
    let frame = null;
    const setProperty = (node, name, value) => {
      if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
    };
    const scrollAncestors = [];
    for (let parent = container.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll|hidden)/.test(getComputedStyle(parent).overflowY)) scrollAncestors.push(parent);
    }
    const tabs = container.closest(".analysis-container")?.querySelector(":scope > .analysis-tabs");
    const syncHeaderOffset = () => {
      if (!container.getClientRects().length) return;
      const zoom = parseFloat(getComputedStyle(table).zoom) || 1;
      // Sticky cells normally stop at their own scroller's top, even when that
      // scroller has moved behind the analysis tabs. Offset them to the visible
      // page edge; the native table/scroller still clips them at its bottom.
      const rect = container.getBoundingClientRect();
      const containerScale = rect.width / container.offsetWidth || 1;
      let top = 0;
      for (const parent of scrollAncestors) top = Math.max(top, parent.getBoundingClientRect().top + parent.clientTop);
      if (tabs) top = Math.max(top, tabs.getBoundingClientRect().bottom);
      const headerHeight = table.tHead?.getBoundingClientRect().height || 0;
      const offset = Math.min(
        Math.max(0, top - rect.top - container.clientTop * containerScale),
        Math.max(0, container.clientHeight * containerScale - headerHeight),
      );
      // Keep scroll-only styling outside the observed table subtree.
      setProperty(container, "--instrument-header-offset", `${offset / (containerScale * zoom)}px`);
      // Top-layer controls stay above the header without needing padding in
      // the scrolling container. Keep their DOM ownership in the header for
      // keyboard navigation, labels and the existing insertion workflow.
      table.querySelectorAll('.instrument-column-insert-button').forEach(button => {
        if (!button.showPopover) return;
        const header = button.closest('th').getBoundingClientRect();
        const center = header.right;
        const visible = center >= rect.left && center <= rect.right + 1 && header.bottom > top;
        if (!visible) {
          if (button.matches(':popover-open')) button.hidePopover();
          // A closed popover can still match the authored display:flex rule.
          // Its stale fixed coordinates then create phantom scroll overflow.
          setProperty(button, 'display', 'none');
          return;
        }
        setProperty(button, 'display', '');
        button.style.position = 'fixed';
        button.style.margin = '0';
        button.style.right = 'auto';
        button.style.bottom = 'auto';
        button.style.zoom = String(1 / (containerScale * zoom));
        button.style.left = `${Math.min(center - 8, rect.right - 17)}px`;
        button.style.top = `${header.top - 16}px`;
        if (!button.matches(':popover-open')) button.showPopover();
      });
    };
    const sync = () => {
      // Hidden tables (and non-layout test renderers) have no geometry to
      // synchronize. ResizeObserver will schedule again when they are shown.
      if (!container.getClientRects().length) return;
      const cols = [...table.querySelectorAll(":scope > colgroup > col")];
      const absolute = cols.every(col => col.style.width.endsWith("px"));
      // Editor requirements grow only their own columns. The panel fills the
      // workspace and scrolls when authored/editor widths exceed the viewport.
      const requirements = [];
      // Header rename inputs use the same intrinsic text measurement as their
      // collapsed labels; allocated column widths must not feed back into it.
      [...(table.tHead?.rows[0]?.cells || [])].forEach((header, index) => {
        if (!header.dataset.instrumentColumn?.startsWith('qualifier')) return;
        const label = header.querySelector('.instrument-custom-column-label, .instrument-custom-column-name-input');
        if (!label) return;
        const style = getComputedStyle(label);
        const probe = document.createElement('span');
        probe.style.cssText = 'position:fixed;left:-100000px;width:max-content;white-space:nowrap;visibility:hidden;';
        probe.style.font = style.font;
        probe.style.textTransform = style.textTransform;
        probe.style.letterSpacing = style.letterSpacing;
        probe.textContent = label.value ?? label.textContent;
        document.body.appendChild(probe);
        requirements[index] = probe.offsetWidth + 32;
        probe.remove();
      });
      if (!absolute) {
        // Preserve wrapping in descriptions, but reserve space for their badges.
        table.querySelectorAll('.uut-description-content').forEach(wrapper => {
          const badge = wrapper.querySelector('.instrument-usage-badge, .active-uut-badge');
          if (!badge) return;
          const cell = wrapper.closest('td'), style = getComputedStyle(cell);
          const index = [...table.tHead.rows[0].cells].findIndex(header => header.dataset.instrumentColumn === 'description');
          requirements[index] = Math.max(requirements[index] || 0, badge.scrollWidth + 100 + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight));
        });
      }
      table.querySelectorAll(EDITORS).forEach(editor => {
        const cell = editor.closest("td");
        if (!cell || cell.colSpan !== 1) return;
        const style = getComputedStyle(cell);
        // Include adjacent add/delete controls and the cell's real padding.
        const content = editor.closest(".range-row-cell") || editor;
        // scrollWidth/offsetWidth are layout pixels; client rects include CSS
        // zoom and cannot be mixed into colgroup widths.
        let width = Math.max(editor.scrollWidth, editor.offsetWidth);
        const equation = editor.querySelector('.dynamic-budget-editor[data-dynamic-kind="equation"]');
        if (equation) width = equationEditorWidth(editor);
        const lookup = editor.querySelector('.dynamic-budget-editor[data-dynamic-kind="table"] .dynamic-lookup-table');
        if (lookup) {
          // A full-width editor follows its assigned cell. Measuring that width
          // and adding cell padding would grow the column on every observer pass.
          // Resolve its authored content requirement outside the observed table.
          const lookupStyle = getComputedStyle(lookup);
          const probe = document.createElement('div');
          probe.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;';
          probe.style.font = lookupStyle.font;
          probe.style.setProperty('--dynamic-data-width', lookupStyle.getPropertyValue('--dynamic-data-width'));
          probe.style.setProperty('--dynamic-table-width', lookupStyle.getPropertyValue('--dynamic-table-width'));
          probe.style.width = 'calc(var(--dynamic-table-width) + 48px)';
          document.body.appendChild(probe);
          width = probe.offsetWidth;
          probe.remove();
          // Header controls grow when either unit summary opens. Measure their
          // intrinsic inline content, not the assigned table/column width.
          const headings = [...lookup.querySelectorAll('.dynamic-column-heading')];
          const headingWidth = Math.max(0, ...headings.map(heading => {
            const cellStyle = getComputedStyle(heading.closest('th'));
            return Math.max(heading.scrollWidth, heading.offsetWidth)
              + (parseFloat(cellStyle.paddingLeft) || 0) + (parseFloat(cellStyle.paddingRight) || 0) + 2;
          }));
          width = Math.max(width, headingWidth * headings.length + 96);
          const toolbar = editor.querySelector('.instrument-tolerance-toolbar');
          if (toolbar) {
            const toolbarStyle = getComputedStyle(toolbar);
            const children = [...toolbar.children].filter(node => node.getClientRects().length);
            const toolbarWidth = children.reduce((sum, node) => sum + Math.max(node.scrollWidth, node.offsetWidth), 0)
              + Math.max(0, children.length - 1) * (parseFloat(toolbarStyle.columnGap) || 0)
              + (parseFloat(toolbarStyle.paddingLeft) || 0) + (parseFloat(toolbarStyle.paddingRight) || 0);
            width = Math.max(width, toolbarWidth);
          }
          const editorStyle = getComputedStyle(editor);
          width += (parseFloat(editorStyle.paddingLeft) || 0) + (parseFloat(editorStyle.paddingRight) || 0);
        }

        const qualifier = cell.hasAttribute('data-qualifier-cell');
        if (qualifier && editor.classList.contains('is-editing')) width = equationEditorWidth(editor);
        const collapsedQualifier = qualifier && !editor.classList.contains('is-editing');
        if (collapsedQualifier) {
          // Summaries must reserve room for their adjacent actions too. Measure
          // text independently: the editor's assigned width would feed back.
          const summary = editor.querySelector('.inline-tolerance-summary');
          const summaryStyle = getComputedStyle(summary);
          const probe = document.createElement('span');
          probe.style.cssText = 'position:fixed;left:-100000px;white-space:nowrap;visibility:hidden;';
          probe.style.font = summaryStyle.font;
          probe.textContent = summary.textContent;
          document.body.appendChild(probe);
          width = probe.offsetWidth + (parseFloat(summaryStyle.paddingLeft) || 0) + (parseFloat(summaryStyle.paddingRight) || 0) + 2;
          probe.remove();
        }
        if (content !== editor) {
          // The range wrapper stretches to the cell. Measure intrinsic children,
          // never feed that already-expanded width back into its own requirement.
          const children = [...content.children].filter(node => node.getClientRects().length);
          width = children.reduce((sum, node) => sum + (node === editor && (qualifier || equation || lookup) ? width : Math.max(node.scrollWidth, node.offsetWidth)), 0)
            + Math.max(0, children.length - 1) * (parseFloat(getComputedStyle(content).columnGap) || 0);
        }
        if (editor.matches('.inline-desc-fields')) {
          const wrapper = editor.closest('.uut-description-content');
          const badge = wrapper?.querySelector('.instrument-usage-badge');
          if (badge) width += badge.offsetWidth + (parseFloat(getComputedStyle(wrapper).columnGap) || 0);
        }
        const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2;
        // Later range rows omit row-spanned description cells, so cellIndex
        // is not their logical column index. Resolve via the actual header.
        const key = editor.matches('.inline-desc-fields') ? 'description'
          : editor.matches('.inline-range-editor') ? (cell.hasAttribute('data-qualifier-cell') ? qualifierColumnKey(cell) : 'range')
          : editor.matches('.inline-tolerance-editor') ? 'tolerance'
          : editor.matches('.inline-resolution-editor') ? 'resolution' : editor.matches('.instrument-custom-field-input') ? cell.dataset.customColumn : 'distribution';
        const index = [...(table.tHead?.rows[0]?.cells || [])].findIndex(header => header.dataset.instrumentColumn === key);
        if (index >= 0) requirements[index] = Math.max(requirements[index] || 0, width + padding);
      });
      const zoom = parseFloat(getComputedStyle(table).zoom) || 1;
      const baseline = Math.max(container.clientWidth / zoom, parseFloat(table.style.minWidth) || 1200);
      const fillIndex = cols.findIndex(col => col.dataset.fill === "true");
      const naturalWidths = expandedInstrumentWidths(cols.map(col => parseFloat(col.style.width) || 1), parseFloat(table.style.minWidth) || 1200, requirements, absolute, fillIndex < 0 ? cols.length - 1 : fillIndex);
      setProperty(table, "--instrument-natural-table-width", `${naturalWidths.reduce((sum, width) => sum + width, 0)}px`);
      const widths = expandedInstrumentWidths(cols.map(col => parseFloat(col.style.width) || 1), baseline, requirements, absolute, fillIndex < 0 ? cols.length - 1 : fillIndex);
      cols.forEach((col, index) => setProperty(col, "--instrument-live-column-width", `${widths[index]}px`));
      const tableWidth = widths.reduce((sum, width) => sum + width, 0);
      setProperty(table, "--instrument-live-table-width", `${tableWidth}px`);
      card?.style.removeProperty("--instrument-panel-width");

      alignEmptyHintArrows(table);
      syncHeaderOffset();
      updateInstrumentCellHighlights(table, hoveredRow, hoveredCell);
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
    container.addEventListener("input", schedule);
    // Scroll only changes the sticky offset, not column widths. Update it in
    // the scroll event instead of deferring an entire table measurement a frame.
    const onScroll = event => {
      if (event.target !== document && event.target !== container && !scrollAncestors.includes(event.target)) return;
      alignEmptyHintArrows(table);
      syncHeaderOffset(); selectionOutline.sync();
    };
    const refreshColumnControls = event => {
      if (event.target.closest?.('th.instrument-resizable-header')) syncHeaderOffset();
    };
    table.addEventListener('pointerover', refreshColumnControls);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    sync();
    return () => {
      table.removeEventListener('pointerover', refreshColumnControls);
      table.removeEventListener("pointerover", hover);
      table.removeEventListener("pointermove", hover);
      table.removeEventListener("pointerleave", leave);
      table.removeEventListener("pointerdown", claim, true);
      releaseTextSelection();
      releasePointerDrag();
      selectionOutline.destroy();
      cancelAnimationFrame(frame);
      card?.style.removeProperty("--instrument-panel-width");
      mutation.disconnect();
      resize?.disconnect();
      container.removeEventListener("focusin", schedule);
      container.removeEventListener("input", schedule);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", schedule);
    };
  }, [container]);
  return attach;
}
