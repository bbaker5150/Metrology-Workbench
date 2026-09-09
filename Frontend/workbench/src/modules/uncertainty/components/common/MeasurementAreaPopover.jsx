import React, { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getAnchoredMenuPlacement } from "../../utils/anchoredMenuPosition";

// Area menus must escape the shared table's scrolling/clipping boundary.
export default function MeasurementAreaPopover({ anchorRef, children }) {
  const [placement, setPlacement] = useState(null);
  useLayoutEffect(() => {
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      setPlacement({ ...getAnchoredMenuPlacement({
        anchorRect: anchor.getBoundingClientRect(), viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight, preferredWidth: 330, preferredMaxHeight: 320,
      }), accent: getComputedStyle(anchor).getPropertyValue("--sidebar-function-color") });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [anchorRef]);
  if (!placement) return null;
  return createPortal(React.cloneElement(children, { style: {
    ...children.props.style, position: "fixed", left: placement.left,
    top: placement.top ?? "auto", bottom: placement.bottom ?? "auto", right: "auto",
    width: placement.width, maxHeight: placement.maxHeight, overflowY: "auto",
    boxSizing: "border-box", zIndex: 10020, "--sidebar-function-color": placement.accent,
    "--function-input-accent": placement.accent,
  } }), document.body);
}
