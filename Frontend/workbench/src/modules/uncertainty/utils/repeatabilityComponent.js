import { convertToPPM, unitSystem } from "./uncertaintyMath";
import { budgetUnitMismatch, hasNominalValue } from "./incompleteBudget";

// Keep the observations in their authored unit. Re-resolve the contribution
// whenever its input/point changes, so fixing a mismatch clears the warning.
export function resolveRepeatabilityComponent(component, nominal = {}) {
  const data = component.savedInputs;
  if (!data || component.type !== "A") return component;
  const mismatch = budgetUnitMismatch(data.unit, nominal?.unit, unitSystem);
  const missing = !nominal?.unit ? "Assign a measurement unit before combining repeatability." : null;
  const converted = !mismatch && !missing && hasNominalValue(nominal) && Number(nominal.value) !== 0
    ? convertToPPM(data.stdDev, data.unit, nominal.value, nominal.unit, null, true) : null;
  const pendingReason = mismatch || missing || converted?.warning || null;
  return { ...component, value_native: data.stdDev, unit_native: data.unit,
    pendingReason, value: pendingReason ? null : converted?.value ?? unitSystem.toBaseUnit(data.stdDev, data.unit),
    isBaseUnitValue: !converted, distribution: "Normal", distributionDivisor: "1" };
}
