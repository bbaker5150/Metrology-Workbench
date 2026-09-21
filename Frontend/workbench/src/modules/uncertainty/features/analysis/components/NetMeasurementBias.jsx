import React, { useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes } from "@fortawesome/free-solid-svg-icons";
import BiasValueEditor from "../../../components/common/BiasValueEditor";
import { resolveMeasurementBias } from "../../../utils/measurementBias";
import { getBiasToleranceFrame } from "../../../utils/biasToleranceFrame";
import { getUnitDisplayLabel } from "../../../utils/uncertaintyMath";

/** A net bias is a point-owned OUTPUT offset, never an equation variable or an
 * uncertainty component. Reuse the audited manual-net contract: it replaces
 * the source sum, leaves UUT bias independent, and preserves source overrides
 * so removing the override restores their previous automatic calculation. Starting
 * from the current source total avoids changing risk merely by enabling the field.
 */
export function NetBiasCell({ point, session, onChange, mode = "bias" }) {
  const [editing, setEditing] = useState(false);
  const root = useRef(null);
  const manual = point.measurementBias?.mode === "manual";
  const resolved = useMemo(() => resolveMeasurementBias(point, session), [point, session]);
  // Opening/focusing the editor must not freeze a live inherited source sum.
  // Only an explicit edit authors a point-owned net replacement.
  const spec = manual ? point.measurementBias : {
    ...point.measurementBias, mode: "manual", kind: "absolute",
    value: Number.isFinite(resolved?.calBias) ? String(resolved.calBias) : "",
    unit: point.testPointInfo?.parameter?.unit || "",
  };
  const restoreSources = () => onChange({ measurementBias:
    Object.values(spec.sources || {}).some(value => value != null)
      ? { mode: "sources", sources: spec.sources } : null });
  // Display basis is independent of the authored spec. In particular a saved
  // percent is converted using the final UUT tolerance, never nominal percent.
  // Nominal + Bias includes cal bias only; UUT bias remains a separate risk input.
  const parameter = point.testPointInfo?.parameter || {};
  const frame = mode === "percent" ? getBiasToleranceFrame(point, session) : null;
  const shown = mode === "percent" ? (frame ? resolved.calBias / frame.halfSpan * 100 : NaN)
    : mode === "adjusted" ? (parameter.value == null || parameter.value === "" ? NaN : Number(parameter.value) + resolved.calBias)
    : resolved.calBias;
  const unit = mode === "percent" ? "%" : getUnitDisplayLabel(parameter.unit || "");
  const summary = resolved.error ? "Not Set" : resolved.uutOrigin === "unavailable" || !Number.isFinite(shown) ? "—"
    : `${Number(shown.toPrecision(8))}${unit ? ` ${unit}` : ""}`;
  return <div ref={root} className={manual ? "net-bias-override" : "net-bias-inherited"}
    onBlur={event => {
      // Keep the editor open when moving between its value and portaled unit
      // selector. A valid Enter/Tab/outside blur returns to the selected summary.
      if (!root.current?.contains(event.relatedTarget) && !event.relatedTarget?.closest?.(".inline-unit-menu") && event.target.validity?.valid !== false) setEditing(false);
    }}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setEditing(false); } }}
    title={resolved.error || (manual ? "Output bias replaces the combined source biases" : "Combined source bias; edit to set a net override")}>
    <div className="measurement-net-bias-value">
      {editing ? <BiasValueEditor label="Net measurement system bias" value={spec} commitOnEdit={!manual} autoFocus
        unit={point.testPointInfo?.parameter?.unit || ""}
        onChange={bias => String(bias.value ?? "").trim() === "" ? restoreSources()
          : onChange({ measurementBias: { ...bias, mode: "manual", corrected: false } })} />
        : <button type="button" className="measurement-input-summary" aria-label="Edit net measurement system bias"
          onClick={() => setEditing(true)}>{summary}</button>}
      {manual && <button type="button" className="btn-add-item measurement-net-bias-remove" title="Remove Net Bias and use source biases"
        aria-label="Remove Net Bias" onClick={restoreSources}>
        <FontAwesomeIcon icon={faTimes} size="xs" />
      </button>}
    </div>{spec.corrected && <span className="measurement-net-bias-help">Saved as corrected; editing the bias makes it active.</span>}</div>;
}
