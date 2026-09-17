import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTimes } from "@fortawesome/free-solid-svg-icons";
import BiasValueEditor from "../../../components/common/BiasValueEditor";
import { resolveMeasurementBias } from "../../../utils/measurementBias";

/** A net bias is a point-owned OUTPUT offset, never an equation variable or an
 * uncertainty component. Reuse the audited manual-net contract: it replaces
 * the source sum, leaves UUT bias independent, and preserves source overrides
 * so removing the row restores their previous automatic calculation. Starting
 * from the current source total avoids changing risk merely by adding the row.
 */
export function AddNetBiasButton({ point, session, onChange }) {
  if (point.measurementBias?.mode === "manual") return null;
  return <button type="button" className="btn-add-item" title="Add Net Bias" aria-label="Add Net Bias"
    onClick={() => {
      const { calBias } = resolveMeasurementBias(point, session);
      onChange({ measurementBias: { ...point.measurementBias, mode: "manual",
        value: Number.isFinite(calBias) ? String(calBias) : "0", kind: "absolute",
        unit: point.testPointInfo?.parameter?.unit || "", corrected: false } });
    }}><FontAwesomeIcon icon={faPlus} size="xs" /></button>;
}

export function NetBiasRow({ point, onChange }) {
  const spec = point.measurementBias;
  if (spec?.mode !== "manual") return null;
  return <tr className="measurement-net-bias-row">
    <td aria-label="Not an equation variable">—</td>
    <td>Net Bias <span className="measurement-net-bias-help">Replaces combined source bias</span></td>
    <td><div className="measurement-net-bias-value">
      <BiasValueEditor label="Net measurement system bias" value={spec}
        unit={point.testPointInfo?.parameter?.unit || ""}
        onChange={bias => onChange({ measurementBias: { ...bias, corrected: false } })} />
      <button type="button" className="btn-add-item" title="Remove Net Bias and use source biases"
        aria-label="Remove Net Bias" onClick={() => onChange({ measurementBias:
          Object.values(spec.sources || {}).some(value => value != null)
            ? { mode: "sources", sources: spec.sources } : null })}>
        <FontAwesomeIcon icon={faTimes} size="xs" />
      </button>
    </div>{spec.corrected && <span className="measurement-net-bias-help">Saved as corrected; editing the bias makes it active.</span>}</td>
  </tr>;
}
