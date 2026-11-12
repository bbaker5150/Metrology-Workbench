import { useLayoutEffect, useRef } from "react";
import { getAnchoredMenuPlacement, getDocumentZoom } from "../utils/anchoredMenuPosition";

// The picker is portaled to body. Trigger rectangles are screen coordinates,
// while its fixed CSS offsets are affected by the document's UI zoom.
export default function useBudgetPickerPosition(menuRef, picker) {
  const anchorRect = useRef(null);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!picker || !menu) return;
    anchorRect.current = picker.rect;
    const position = () => {
      const zoom = getDocumentZoom();
      const viewport = window.visualViewport;
      const liveRect = picker.anchor?.isConnected ? picker.anchor.getBoundingClientRect() : null;
      // A recalculation may replace or temporarily hide the originating header.
      // Detached/hidden nodes report a zero rectangle; keep the last visible
      // anchor instead of moving an open picker to the viewport's top-left.
      if (liveRect && (liveRect.right > liveRect.left || liveRect.bottom > liveRect.top)) anchorRect.current = liveRect;
      const placement = getAnchoredMenuPlacement({
        anchorRect: anchorRect.current,
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
  return anchorRect;
}
