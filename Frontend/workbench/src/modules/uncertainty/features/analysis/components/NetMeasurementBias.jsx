import React, { useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes } from "@fortawesome/free-solid-svg-icons";
import BiasValueEditor from "../../../components/common/BiasValueEditor";
import { resolveMeasurementBias } from "../../../utils/measurementBias";

/** A net bias is a point-owned OUTPUT offset, never an equation variable or an
 * uncertainty component. Reuse the audited manual-net contract: it replaces
 * the source sum, leaves UUT bias independent, and preserves source overrides
 * so removing the override restores their previous automatic calculation. Starting
 * from the current source total avoids changing risk merely by enabling the field.
 */
export function NetBiasCell({ point, session, onChange }) {
  const manual = point.measurementBias?.mode === "manual";
  const automatic = useMemo(() => manual ? null : resolveMeasurementBias(point, session), [point, session, manual]);
  // Opening/focusing the editor must not freeze a live inherited source sum.
  // Only an explicit edit authors a point-owned net replacement.
  const spec = manual ? point.measurementBias : {
    ...point.measurementBias, mode: "manual", kind: "absolute",
    value: Number.isFinite(automatic?.calBias) ? String(automatic.calBias) : "",
    unit: point.testPointInfo?.parameter?.unit || "",
  };
  const restoreSources = () => onChange({ measurementBias:
    Object.values(spec.sources || {}).some(value => value != null)
      ? { mode: "sources", sources: spec.sources } : null });
  return <div className={manual ? "net-bias-override" : "net-bias-inherited"}
    title={manual ? "Output bias replaces the combined source biases" : automatic?.error || "Combined source bias; edit to set a net override"}>
    <div className="measurement-net-bias-value">
      <BiasValueEditor label="Net measurement system bias" value={spec} commitOnEdit={!manual}
        unit={point.testPointInfo?.parameter?.unit || ""}
        onChange={bias => String(bias.value ?? "").trim() === "" ? restoreSources()
          : onChange({ measurementBias: { ...bias, mode: "manual", corrected: false } })} />
      {manual && <button type="button" className="btn-add-item measurement-net-bias-remove" title="Remove Net Bias and use source biases"
        aria-label="Remove Net Bias" onClick={restoreSources}>
        <FontAwesomeIcon icon={faTimes} size="xs" />
      </button>}
    </div>{spec.corrected && <span className="measurement-net-bias-help">Saved as corrected; editing the bias makes it active.</span>}</div>;
}
