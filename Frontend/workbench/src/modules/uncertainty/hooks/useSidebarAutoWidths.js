import { alignEmptyHintArrows } from "../utils/alignEmptyHintArrows";
import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

const PAINT_CLASSES = new Set(['is-cell-hovered', 'active', 'active-point', 'table-highlight', 'point-grouped-cell--highlighted']);
const widthClasses = value => (value || '').split(/\s+/).filter(name => name && !PAINT_CLASSES.has(name)).sort().join(' ');
const widthStyles = value => (value || '').split(';').map(rule => rule.trim())
  .filter(rule => rule && !rule.startsWith('--point-hover-')).sort().join(';');

export const sidebarMutationAffectsWidths = record => {
  const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
  if (target?.closest('.point-selection-outline')) return false;
  if (record.type === 'attributes' && record.attributeName === 'class' &&
    widthClasses(record.oldValue) === widthClasses(target.getAttribute('class'))) return false;
  if (record.type === 'attributes' && record.attributeName === 'style' &&
    widthStyles(record.oldValue) === widthStyles(target.getAttribute('style'))) return false;
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
  const layoutRef = useRef(null);
  useLayoutEffect(() => {
    const root = rootRef.current?.querySelector(".results-sidebar") || rootRef.current;
    if (layoutRef.current && layoutRef.current.root === root) {
      layoutRef.current.check();
      return;
    }
    layoutRef.current?.dispose();
    layoutRef.current = null;
    if (!root) return;
    let frame;
    let disposed = false;
    const alignHints = () => alignEmptyHintArrows(root);
    const measurementContext = () => JSON.stringify([
      document.body.className, getComputedStyle(root).font,
      Boolean(root.getClientRects().length),
      window.innerWidth, window.innerHeight,
      root.querySelector('.measurement-points-zoom-surface > .scoped-zoom-content')?.style.cssText,
    ]);
    const measure = () => {
      alignHints();
      // Opening one editor must not clone and force layout for every metric.
      // Reuse unchanged cell measurements across both local editor mutations
      // and owner renders. Theme, typography, zoom and viewport changes still
      // invalidate the cache; each pass retains only cells currently present.
      const context = measurementContext();
      const previousMeasurements = measurementsRef.current.context === context
        ? measurementsRef.current.cells : new Map();
      const measurements = new Map();
      // A selection-only render normally reuses all measurements. Do not
      // mutate the document (and dirty layout) unless a cell needs measuring.
      let host;
      const probes = [];
      const next = {};
      const seen = new Set();
      root.querySelectorAll(".point-grid-item > [data-sidebar-column]").forEach(cell => {
        if (!cell.getClientRects().length) return;
        const key = cell.dataset.sidebarColumn;
        next[key] ||= 44;
        const signature = `${key}:${widthClasses(cell.className)}:${widthStyles(cell.getAttribute('style'))}:${cell.innerHTML}`;
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
          host.style.display = 'contents';
          host.setAttribute("aria-hidden", "true");
        }
        // Retain the same isolated containing block for each cell. Sharing a
        // block between probes can change intrinsic widths and sibling rules.
        const probeHost = document.createElement('div');
        probeHost.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:max-content;contain:layout style;";
        probeHost.setAttribute('data-sidebar-width-probe', '');
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
        probeHost.appendChild(clone);
        host.appendChild(probeHost);
        probes.push({ clone, signature, key });
      });
      if (host) {
        // Finish reading source styles before attaching any probes. A large
        // session now needs one intrinsic layout, rather than alternating DOM
        // writes and forced layouts once for every distinct point/metric cell.
        document.body.appendChild(host);
        try {
          for (const { clone, signature, key } of probes) {
            const measuredWidth = clone.offsetWidth + 2;
            measurements.set(signature, measuredWidth);
            next[key] = Math.max(next[key] || 44, measuredWidth);
          }
        } finally { host.remove(); }
      }
      measurementsRef.current = { context, cells: measurements };
      setWidths(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { if (disposed) return; cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    // Layout refreshes can change a descendant's font without changing the
    // viewport or root font (for example, a newly applied typography rule).
    // Recheck intrinsic sizes on resize while keeping point selection cached.
    const resize = () => { measurementsRef.current.context = null; schedule(); };
    // Child editors update independently of this hook's owner. Reconcile their
    // intrinsic widths in the mutation microtask, before the browser paints a
    // new editor into the previous editor's column widths.
    const observer = new MutationObserver(records => {
      if (!disposed && records.some(sidebarMutationAffectsWidths)) flushSync(measure);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true,
      attributeFilter: ['class', 'style', 'value', 'hidden', 'data-sidebar-column'] });
    const theme = new MutationObserver(resize);
    theme.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener("resize", resize);
    document.fonts?.addEventListener('loadingdone', resize);
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
    layoutRef.current = {
      root,
      check() {
        // Keep subscriptions alive across owner renders. React has already
        // committed DOM updates, so consume only relevant pending mutations;
        // unrelated menus, cursor state and save status no longer walk all cells.
        const changed = observer.takeRecords().some(sidebarMutationAffectsWidths);
        theme.takeRecords();
        if (changed || measurementsRef.current.context !== measurementContext()) measure();
      },
      dispose() {
        root.removeEventListener("scroll", alignHints, true);
        disposed = true;
        observer.disconnect(); theme.disconnect();
        cancelAnimationFrame(frame);
        window.removeEventListener("resize", resize);
        document.fonts?.removeEventListener('loadingdone', resize);
      },
    };
  });
  useLayoutEffect(() => () => { layoutRef.current?.dispose(); layoutRef.current = null; }, []);
  return widths;
}
