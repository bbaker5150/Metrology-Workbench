import { useLayoutEffect, useState } from "react";

// Measure rendered content without its current column constraints. Auto widths
// stay transient; only explicit user resizing is stored in session preferences.
export default function useSidebarAutoWidths(rootRef) {
  const [widths, setWidths] = useState({});
  useLayoutEffect(() => {
    const root = rootRef.current?.querySelector(".results-sidebar") || rootRef.current;
    if (!root) return;
    let frame;
    let disposed = false;
    const measure = () => {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:max-content;contain:layout style;";
      host.setAttribute("aria-hidden", "true");
      document.body.appendChild(host);
      const next = {};
      const seen = new Set();
      root.querySelectorAll(".point-grid-item > [data-sidebar-column]").forEach(cell => {
        if (!cell.getClientRects().length) return;
        const key = cell.dataset.sidebarColumn;
        const signature = `${key}:${cell.innerHTML}`;
        if (seen.has(signature)) return;
        seen.add(signature);
        const clone = cell.cloneNode(true);
        const sources = [cell, ...cell.querySelectorAll("*")];
        const copies = [clone, ...clone.querySelectorAll("*")];
        sources.forEach((source, index) => {
          const copy = copies[index];
          const style = getComputedStyle(source);
          for (const property of ["display", "font", "font-variant-numeric", "font-feature-settings", "text-transform", "letter-spacing", "padding", "border-width", "border-style", "box-sizing", "gap", "flex-direction", "align-items", "margin", "line-height"]) copy.style.setProperty(property, style.getPropertyValue(property));
          if (style.display === "grid") copy.style.gridTemplateColumns = `repeat(${style.gridTemplateColumns.split(" ").length}, max-content)`;
          copy.removeAttribute("id");
          copy.style.setProperty("width", "max-content");
          copy.style.setProperty("min-width", "0");
          copy.style.setProperty("max-width", "none");
          copy.style.setProperty("position", "static");
          copy.style.setProperty("transform", "none");
          copy.style.setProperty("white-space", "nowrap");
          copy.style.setProperty("flex", "none");
          if (source.tagName === "INPUT") {
            copy.style.width = `${Math.max(1, source.value.length)}ch`;
            copy.value = source.value;
          }
          if (source.tagName === "SELECT") {
            copy.replaceChildren(new Option(source.selectedOptions[0]?.textContent || ""));
          }
          if (source.tagName.toLowerCase() === "svg") {
            copy.style.width = style.width;
            copy.style.height = style.height;
          }
        });
        host.appendChild(clone);
        next[key] = Math.max(next[key] || 44, clone.offsetWidth + 2);
        clone.remove();
      });
      host.remove();
      setWidths(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { if (disposed) return; cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", schedule);
    document.fonts?.ready.then(schedule);
    schedule();
    return () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", schedule); };
  });
  return widths;
}
