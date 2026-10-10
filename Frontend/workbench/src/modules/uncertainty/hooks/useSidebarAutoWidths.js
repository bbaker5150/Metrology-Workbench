import { alignEmptyHintArrows } from "../utils/alignEmptyHintArrows";
import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export const sidebarMutationAffectsWidths = record => {
  const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
  if (target?.closest('.point-selection-outline')) return false;
  if (target?.closest('.point-grid-item')) return true;
  return [...(record.addedNodes || []), ...(record.removedNodes || [])].some(node =>
    node.nodeType === 1 && (node.matches('.point-grid-item') || node.querySelector('.point-grid-item')));
};

// Measure rendered content without its current column constraints. Auto widths
// stay transient; only explicit user resizing is stored in session preferences.
export default function useSidebarAutoWidths(rootRef) {
  const [widths, setWidths] = useState({});
  const measurementsRef = useRef({ context: null, cells: new Map() });
  const measuredFontsRef = useRef(null);
  useLayoutEffect(() => {
    const root = rootRef.current?.querySelector(".results-sidebar") || rootRef.current;
    if (!root) return;
    let frame;
    let disposed = false;
    const alignHints = () => alignEmptyHintArrows(root);
    const measure = () => {
      alignHints();
      // Opening one editor must not clone and force layout for every metric.
      // Reuse unchanged cell measurements across both local editor mutations
      // and owner renders. Theme, typography, zoom and viewport changes still
      // invalidate the cache; each pass retains only cells currently present.
      const context = JSON.stringify([
        document.body.className, getComputedStyle(root).font,
        window.innerWidth, window.innerHeight,
        root.querySelector('.measurement-points-zoom-surface > .scoped-zoom-content')?.style.cssText,
      ]);
      const previousMeasurements = measurementsRef.current.context === context
        ? measurementsRef.current.cells : new Map();
      const measurements = new Map();
      // A selection-only render normally reuses all measurements. Do not
      // mutate the document (and dirty layout) unless a cell needs measuring.
      let host;
      const next = {};
      const seen = new Set();
      root.querySelectorAll(".point-grid-item > [data-sidebar-column]").forEach(cell => {
        if (!cell.getClientRects().length) return;
        const key = cell.dataset.sidebarColumn;
        const signature = `${key}:${cell.className}:${cell.innerHTML}`;
        if (seen.has(signature)) return;
        seen.add(signature);
        const cachedWidth = previousMeasurements.get(signature);
        if (cachedWidth !== undefined) {
          measurements.set(signature, cachedWidth);
          next[key] = Math.max(next[key] || 44, cachedWidth);
          return;
        }
        if (!host) {
          host = document.createElement("div");
          host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:max-content;contain:layout style;";
          host.setAttribute("aria-hidden", "true");
          document.body.appendChild(host);
        }
        const clone = cell.cloneNode(true);
        const sources = [cell, ...cell.querySelectorAll("*")];
        const copies = [clone, ...clone.querySelectorAll("*")];
        sources.forEach((source, index) => {
          const copy = copies[index];
          const style = getComputedStyle(source);
          for (const property of ["display", "font", "font-variant-numeric", "font-feature-settings", "text-transform", "letter-spacing", "padding", "border-width", "border-style", "box-sizing", "gap", "flex-direction", "align-items", "margin", "line-height"]) copy.style.setProperty(property, style.getPropertyValue(property));
          if (style.display === "grid") copy.style.gridTemplateColumns = `repeat(${style.gridTemplateColumns.split(" ").length}, max-content)`;
          if (source.matches('.point-value-with-unit > .point-edit-affordance')) {
            copy.style.display = 'flex';
            copy.style.flexDirection = 'row';
            copy.style.flexWrap = 'nowrap';
          }
          copy.removeAttribute("id");
          copy.style.setProperty("width", "max-content");
          copy.style.setProperty("min-width", "0");
          copy.style.setProperty("max-width", "none");
          // These inputs overlay a sizing mirror. Counting both as in-flow
          // content doubles Section/Qualifier width whenever editing opens.
          copy.style.setProperty("position", source.matches(".point-value-input-slot > input, .point-label-editing > input") ? "absolute" : "static");
          copy.style.setProperty("transform", "none");
          copy.style.setProperty("white-space", "nowrap");
          copy.style.setProperty("flex", "none");
          if (source.tagName === "INPUT") {
            copy.style.width = `${Math.max(1, source.value.length)}ch`;
            copy.value = source.value;
          }
          if (source.matches(".point-unit-control .inline-unit-combobox")) {
            // Shared picker buttons have authored widths beyond their text width.
            copy.style.width = style.width;
            copy.style.minWidth = style.width;
          }
          if (source.tagName === "SELECT") {
            copy.replaceChildren(new Option(source.selectedOptions[0]?.textContent || ""));
            // Unit selects have an authored width including their picker arrow.
            // Native intrinsic sizing alone can be narrower than the live control.
            copy.style.width = style.width;
            copy.style.minWidth = style.width;
            copy.style.appearance = style.appearance;
          }
          if (source.tagName.toLowerCase() === "svg") {
            copy.style.width = style.width;
            copy.style.height = style.height;
          }
        });
        host.appendChild(clone);
        const measuredWidth = clone.offsetWidth + 2;
        measurements.set(signature, measuredWidth);
        next[key] = Math.max(next[key] || 44, measuredWidth);
        clone.remove();
      });
      host?.remove();
      measurementsRef.current = { context, cells: measurements };
      setWidths(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { if (disposed) return; cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    // Child editors update independently of this hook's owner. Reconcile their
    // intrinsic widths in the mutation microtask, before the browser paints a
    // new editor into the previous editor's column widths.
    const observer = new MutationObserver(records => {
      if (!disposed && records.some(sidebarMutationAffectsWidths)) flushSync(measure);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", schedule);
    root.addEventListener("scroll", alignHints, true);
    const fontLoading = document.fonts?.ready;
    const fontsReady = () => {
      if (disposed || measuredFontsRef.current === fontLoading) return;
      measuredFontsRef.current = fontLoading;
      measurementsRef.current.context = null;
      schedule();
    };
    fontLoading?.then(fontsReady);
    measure();
    return () => { root.removeEventListener("scroll", alignHints, true); disposed = true; observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", schedule); };
  });
  return widths;
}
