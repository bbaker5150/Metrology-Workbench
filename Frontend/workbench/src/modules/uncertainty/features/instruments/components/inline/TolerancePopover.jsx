import React, { useLayoutEffect, useRef, useState, useEffect } from "react";
import ReactDOM from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes } from "@fortawesome/free-solid-svg-icons";
import ToleranceForm from "../../../../components/common/ToleranceForm";
// The popover's own styling (.inline-tol-popover, width cap, scroll). Imported
// here so the styles load wherever the popover is used, independent of the
// retired InstrumentTable that previously pulled this CSS in.
import "./inlineTable.css";

/**
 * Anchored popover that hosts the existing ToleranceForm so a rich tolerance
 * (reading/range/floor/db + manual components + resolution) can be edited
 * without a full modal. Spike for the inline-tables redesign — this is the
 * single biggest UX risk, so we prototype it first.
 *
 * Positions itself next to `anchorRect`, flips above when it would overflow
 * the viewport, and closes on click-away / Escape.
 */
const TolerancePopover = ({
  anchorRect,
  tolerance,
  setTolerance,
  referencePoint,
  isUUT = false,
  onClose,
}) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });

  useLayoutEffect(() => {
    if (!anchorRect || !ref.current) return;
    const popH = ref.current.offsetHeight;
    const popW = ref.current.offsetWidth;
    const margin = 8;
    const spaceBelow = window.innerHeight - anchorRect.bottom;

    // Prefer below the cell; flip above if there's more room there.
    let top =
      spaceBelow < popH + margin && anchorRect.top > spaceBelow
        ? anchorRect.top - popH - margin
        : anchorRect.bottom + margin;

    // Clamp into the viewport so a tall popover never spills off-screen
    // (it scrolls internally via max-height).
    top = Math.min(top, window.innerHeight - popH - margin);
    top = Math.max(margin, top);

    let left = anchorRect.left;
    if (left + popW > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - popW - margin);
    }
    setPos({ top, left });
  }, [anchorRect, tolerance]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener("keydown", onKey);
    // Defer so the opening click doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener("mousedown", onClick), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
      clearTimeout(t);
    };
  }, [onClose]);

  return ReactDOM.createPortal(
    <div
      ref={ref}
      className="inline-tol-popover"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="inline-tol-popover-header">
        <h5>Tolerance / Error Limits</h5>
        <button className="inline-icon-btn" onClick={onClose} title="Done">
          <FontAwesomeIcon icon={faTimes} />
        </button>
      </div>
      <ToleranceForm
        tolerance={tolerance || {}}
        setTolerance={setTolerance}
        isUUT={isUUT}
        referencePoint={referencePoint}
        showResolution={isUUT}
        showManualComponents={true}
      />
    </div>,
    document.body
  );
};

export default TolerancePopover;
