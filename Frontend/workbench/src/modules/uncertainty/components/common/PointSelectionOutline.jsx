import { useLayoutEffect, useRef } from "react";
import { selectionPerimeter } from "../../utils/instrumentSelectionOutline";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Paint the union of selected point cells, using the instrument-table edge
 * cancellation algorithm. Shared UUT/section/qualifier cells participate in
 * every row of their run, so the outline follows their actual outer shape
 * without drawing seams through merged labels or between adjacent selections.
 * The overlay never participates in layout or intercepts an editor's pointer.
 */
export default function PointSelectionOutline() {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const overlay = ref.current;
    const content = overlay.parentElement;
    const scroller = content.parentElement;
    let frame = null;
    let previous = "";
    const sync = () => {
      frame = null;
      const bounds = content.getBoundingClientRect();
      if (!bounds.width) return;
      const scale = bounds.width / content.offsetWidth || 1;
      const groups = new Map();
      content.querySelectorAll(".point-grid-item").forEach(row => {
        const rowBounds = row.getBoundingClientRect();
        const selected = row.matches(".active, .active-point, .table-highlight");
        const columnOrder = getComputedStyle(row).gridTemplateAreas.replaceAll('"', '').split(/\s+/);
        const cells = [...row.querySelectorAll(":scope > [data-sidebar-column]")]
          .filter(cell => cell.getClientRects().length)
          .sort((a, b) => columnOrder.indexOf(a.dataset.sidebarColumn) - columnOrder.indexOf(b.dataset.sidebarColumn));
        const boxes = cells.map(cell => cell.getBoundingClientRect());
        const color = getComputedStyle(row).getPropertyValue("--sidebar-function-color").trim() || "var(--primary-color)";
        cells.forEach((cell, index) => {
          if (!selected && !cell.classList.contains("point-grouped-cell--highlighted")) return;
          // Tile the row, including its padding/gaps. Tiles abut exactly; their
          // opposing edges therefore cancel at any CSS/browser zoom level.
          const left = index ? (boxes[index - 1].right + boxes[index].left) / 2 : rowBounds.left;
          const right = index === cells.length - 1 ? rowBounds.right : (boxes[index].right + boxes[index + 1].left) / 2;
          if (right <= left) return;
          if (!groups.has(color)) groups.set(color, []);
          groups.get(color).push({
            left: (left - bounds.left) / scale, right: (right - bounds.left) / scale,
            top: (rowBounds.top - bounds.top) / scale, bottom: (rowBounds.bottom - bounds.top) / scale,
          });
        });
      });
      const paths = [...groups].map(([color, rectangles]) => ({ color,
        d: selectionPerimeter(rectangles).map(([x1, y1, x2, y2]) => `M${x1},${y1}L${x2},${y2}`).join(" "),
      }));
      const signature = JSON.stringify(paths);
      if (signature === previous) return;
      previous = signature;
      overlay.replaceChildren(...paths.map(({ color, d }) => {
        const path = document.createElementNS(SVG_NS, "path");
        path.style.setProperty("--instrument-function-color", color);
        path.setAttribute("d", d);
        return path;
      }));
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(sync); };
    // Ignore our own SVG mutations: observing the outline itself creates an
    // unnecessary repaint loop, the same class of issue as table hover jitter.
    const mutations = new MutationObserver(records => {
      if (records.some(record => !overlay.contains(record.target))) schedule();
    });
    mutations.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resize?.observe(content);
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    sync();
    return () => {
      mutations.disconnect(); resize?.disconnect();
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);
  return <svg ref={ref} className="instrument-selection-outline point-selection-outline" aria-hidden="true" />;
}
