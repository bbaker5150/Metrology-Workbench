import { useCallback, useLayoutEffect, useState } from "react";

const EDITORS = ".inline-desc-fields, .inline-range-editor.is-editing, .inline-tolerance-editor, .inline-resolution-editor, .inline-distribution-editor";

export const expandedInstrumentWidths = (weights, baseline, requirements) => {
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return weights.map((weight, index) => Math.max(baseline * weight / total, requirements[index] || 0));
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
    let frame;
    const setProperty = (node, name, value) => {
      if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
    };
    const sync = () => {
      // Hidden tables (and non-layout test renderers) have no geometry to
      // synchronize. ResizeObserver will schedule again when they are shown.
      if (!container.getClientRects().length) return;
      const cols = [...table.querySelectorAll(":scope > colgroup > col")];
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
          : editor.matches('.inline-resolution-editor') ? 'resolution' : 'distribution';
        const index = [...(table.tHead?.rows[0]?.cells || [])].findIndex(header => header.dataset.instrumentColumn === key);
        if (index >= 0) requirements[index] = Math.max(requirements[index] || 0, width + padding);
      });
      const zoom = parseFloat(getComputedStyle(table).zoom) || 1;
      const baseline = Math.max(container.clientWidth / zoom, parseFloat(table.style.minWidth) || 1200);
      const widths = expandedInstrumentWidths(cols.map(col => parseFloat(col.style.width) || 1), baseline, requirements);
      cols.forEach((col, index) => setProperty(col, "--instrument-live-column-width", `${widths[index]}px`));
      setProperty(table, "--instrument-live-table-width", `${widths.reduce((sum, width) => sum + width, 0)}px`);

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
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    const mutation = new MutationObserver(schedule);
    mutation.observe(table, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resize?.observe(container);
    container.addEventListener("focusin", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      mutation.disconnect();
      resize?.disconnect();
      container.removeEventListener("focusin", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [container]);
  return attach;
}
