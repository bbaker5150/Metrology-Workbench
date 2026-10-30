import { useLayoutEffect } from "react";
import { getAnchoredMenuPlacement } from "../utils/anchoredMenuPosition";

// The picker is portaled to body. Trigger rectangles are screen coordinates,
// while its fixed CSS offsets are affected by the document's UI zoom.
export default function useBudgetPickerPosition(menuRef, picker) {
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!picker || !menu) return;
    const position = () => {
      const zoomOf = element => parseFloat(getComputedStyle(element).zoom || element.style.zoom) || 1;
      const zoom = zoomOf(document.documentElement) * zoomOf(document.body);
      const viewport = window.visualViewport;
      const placement = getAnchoredMenuPlacement({
        anchorRect: picker.anchor?.getBoundingClientRect() || picker.rect,
        viewportWidth: viewport?.width || window.innerWidth,
        viewportHeight: viewport?.height || window.innerHeight,
        preferredWidth: 420 * zoom,
        preferredMaxHeight: Math.min(420, menu.scrollHeight || 420) * zoom,
      });
      for (const key of ["left", "top", "bottom", "width", "maxHeight"]) {
        menu.style[key] = placement[key] == null ? "auto" : `${placement[key] / zoom}px`;
      }
    };
    position();
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(position) : null;
    resize?.observe(menu);
    if (picker.anchor) resize?.observe(picker.anchor);
    const scale = new MutationObserver(position);
    for (const root of [document.documentElement, document.body]) scale.observe(root, { attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    return () => {
      resize?.disconnect(); scale.disconnect();
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
    };
  }, [menuRef, picker]);
}
