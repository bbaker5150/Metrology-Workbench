import React from "react";
import { biasInUnit, getPointBiasSources } from "../../../utils/measurementBias";
import { getUnitDisplayLabel } from "../../../utils/uncertaintyMath";

/** Input bias is the signed sum in that input's units, BEFORE sensitivity
 * propagation into output units. A manual net override belongs to the output
 * and must not be redistributed across inputs or added to them a second time.
 * Percent display uses |nominal|, matching the instrument bias entry contract.
 */
export function measurementInputBias(point, session, variable) {
  const reference = { value: variable.value, unit: variable.unit || "" };
  return getPointBiasSources(point, session)
    .filter(source => source.variableType === variable.name || source.variableType === variable.symbol)
    .reduce((sum, source) => sum + biasInUnit(source.spec, reference, reference.unit) * source.quantity, 0);
}

export default function MeasurementInputBias({ point, session, variable, mode }) {
  try {
    const bias = measurementInputBias(point, session, variable);
    const nominal = Number(variable.value);
    const hasNominal = variable.value != null && variable.value !== "" && Number.isFinite(nominal);
    const value = mode === "percent" ? (hasNominal && nominal !== 0 ? bias / Math.abs(nominal) * 100 : NaN)
      : mode === "adjusted" ? (hasNominal ? nominal + bias : NaN) : bias;
    const unit = mode === "percent" ? "%" : getUnitDisplayLabel(variable.unit || "");
    return <span title={mode === "percent" && !Number.isFinite(value) ? "A nonzero nominal is needed for a percentage." : "Calculated from this input's source biases"}>
      {Number.isFinite(value) ? `${Number(value.toPrecision(8))}${unit ? ` ${unit}` : ""}` : "—"}
    </span>;
  } catch (error) {
    return <span className="pending-component-warning" title={error.message}>Not Set</span>;
  }
}
