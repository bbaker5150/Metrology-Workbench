import React, { useMemo } from "react";
import { resolveMeasurementBias } from "../../../utils/measurementBias";
import { getUnitDisplayLabel } from "../../../utils/uncertaintyMath";
import "../../../components/common/MeasurementBias.css";

const display = value => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${Number(value.toPrecision(7))}` : "Not set";

/** Instrument biases live in tolerance/error-limit cells. Do not silently
 * discard overrides authored by the retired point and net-bias editors:
 * that would change saved risk results merely by opening a session. This notice
 * is absent for instrument-owned biases, including explicit zero and corrected
 * ranges. A user can explicitly return an old point to instrument inheritance.
 * Nulls intentionally survive serialization/merging as cleared overrides; no
 * instrument defaults, uncertainty terms or other point fields are modified.
 */
export default function LegacyPointBiasNotice({ point, session, calculatedAverage, onChange, netBiasEditable = false }) {
  const hasOverride = point.uutBias?.mode === "override" ||
    (!(netBiasEditable && point.measurementBias?.mode === "manual") &&
      (point.measurementBias?.mode === "manual" || Object.values(point.measurementBias?.sources || {}).some(spec => spec != null)));
  const result = useMemo(() => hasOverride
    ? resolveMeasurementBias(point, session, calculatedAverage) : null,
  [hasOverride, point, session, calculatedAverage]);
  if (!hasOverride) return null;
  const unit = getUnitDisplayLabel(point.testPointInfo?.parameter?.unit || "");
  return <div className="legacy-point-bias-notice" role="status">
    <span>Saved point bias overrides are active.
      {result.error ? ` ${result.error}` : ` UUT: ${result.uutOrigin === "unavailable" ? "Not applicable" : `${display(result.uutBias)} ${unit}`} · System: ${display(result.calBias)} ${unit}`}
    </span>
    <button type="button" className="bias-reset"
      title={netBiasEditable && point.measurementBias?.mode === "manual" ? "Use the UUT range bias; keep the Net Bias row" : "Clear this point’s saved overrides and use the UUT and TMDE instrument biases"}
      onClick={() => onChange({ uutBias: null, measurementBias:
        netBiasEditable && point.measurementBias?.mode === "manual"
          ? point.measurementBias : null })}>
      {netBiasEditable && point.measurementBias?.mode === "manual" ? "Use UUT instrument bias" : "Use instrument biases"}
    </button>
  </div>;
}
