import React from "react";
import { biasInUnit, resolveMeasurementBias, getPointBiasSources } from "../../../utils/measurementBias";
import { getBiasToleranceFrame } from "../../../utils/biasToleranceFrame";
import { getUnitDisplayLabel } from "../../../utils/uncertaintyMath";

// Visibility follows authored input-source biases, including explicit zero and
// invalid entries needing correction, not their sum (opposite biases can cancel).
// UUT bias belongs to the final measurement and does not create an input column.
export function hasMeasurementInputBias(point, session, variables, resolved) {
  if (point.measurementBias?.mode === "manual") return true;
  const sources = resolved?.sources?.length ? resolved.sources : getPointBiasSources(point, session);
  return sources.some(source => source.spec?.value != null && String(source.spec.value).trim() !== "" &&
    variables.some(variable => source.variableType === (variable.name || variable.symbol)));
}

/** Native display is the input-equivalent signed offset. Percentage display
 * is that input's OUTPUT contribution divided by the final UUT tolerance frame,
 * exactly the workbook Cal_Bias basis. A manual net override remains separate;
 * it must never be allocated across inputs or counted a second time.
 */
export function measurementInputBias(point, session, variable, mode = "bias", resolved) {
  const result = resolved || resolveMeasurementBias(point, session, undefined, { ignoreManual: true });
  if (result.error) throw new Error(result.error);
  const sources = result.sources.filter(source => source.variableType === variable.name || source.variableType === variable.symbol);
  if (result.uutOrigin === "unavailable") return NaN;
  if (mode === "percent") {
    const frame = getBiasToleranceFrame(point, session);
    return frame ? sources.reduce((sum, source) => sum + (source.contribution || 0), 0) / frame.halfSpan * 100 : NaN;
  }
  const reference = { value: variable.value, unit: variable.unit || "" };
  // A nonzero final-output percentage at zero sensitivity has no finite input
  // equivalent. Show unavailable instead of inventing an input value.
  if (sources.some(source => source.inputBias === null && source.contribution !== 0)) return NaN;
  const bias = sources.reduce((sum, source) => sum + biasInUnit({ value: source.inputBias ?? 0, unit: source.inputUnit }, reference), 0);
  if (mode !== "adjusted") return bias;
  const nominal = variable.value == null || variable.value === "" ? NaN : Number(variable.value);
  return nominal + bias;
}

export default function MeasurementInputBias({ point, session, variable, mode, resolved }) {
  try {
    const value = measurementInputBias(point, session, variable, mode, resolved);
    const unit = mode === "percent" ? "%" : getUnitDisplayLabel(variable.unit || "");
    const title = mode === "percent" ? "Signed output contribution as a percent of the final UUT tolerance (Excel MUA basis)"
      : "Input-equivalent bias; unavailable when no finite equivalent exists";
    return <span title={title}>{Number.isFinite(value) ? `${Number(value.toPrecision(8))}${unit ? ` ${unit}` : ""}` : "—"}</span>;
  } catch (error) {
    return <span className="pending-component-warning" title={error.message}>Not Set</span>;
  }
}
