import { evaluate, parse } from "mathjs";
import { v4 as uuid } from "uuid";
import { unitSystem } from "./uncertaintyMath";
import { validateEquation } from "./equationValidation";
import { unresolvedComponent } from "./incompleteBudget";

const filled = value => value !== "" && value != null && Number.isFinite(Number(value));
const functions = new Set(["abs", "sqrt", "cbrt", "pow", "exp", "log", "log10", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "min", "max", "hypot", "floor", "ceil", "round"]);
export const validateBudgetEquation = equation => {
  if (String(equation).length > 2000) return { status: "invalid", error: "Keep the equation under 2,000 characters." };
  const result = validateEquation(equation);
  if (result.status !== "ok") return result;
  let count = 0, error;
  parse(result.expression).traverse(node => {
    count++;
    if (node.isFunctionNode && !functions.has(node.fn.name)) error = `Function ${node.fn.name} is not supported here.`;
  });
  if (count > 200 || result.variables.length > 32) error = "Simplify this equation (maximum 32 variables).";
  return error ? { ...result, status: "invalid", error } : result;
};

export const createDynamicDefinition = (kind, nominal = {}) => ({
  id: uuid(), kind, name: "", measurementUnit: nominal.unit || "", outputUnit: nominal.unit || "",
  mode: "standard", distribution: "1", columns: [{ id: uuid(), name: "Uncertainty" }],
  rows: [{ id: uuid(), point: "", values: {} }], equation: "", variables: {}, pointVariable: "",
});
export const createDynamicComponent = (definition, outputId, scope) => ({
  id: uuid(), name: definition.name, type: "B", isManual: true, isCore: false,
  dynamicDefinitionId: definition.id, dynamicOutputId: outputId || definition.columns[0].id,
  dynamicDefinition: definition, value: null, value_native: null, dof: Infinity,
  ...(scope?.kind === "input" ? { variableType: scope.variableType } : {}),
});
export const getDynamicDefinition = (component, session = {}) =>
  (session.dynamicBudgetDefinitions || []).find(d => d.id === component.dynamicDefinitionId) || component.dynamicDefinition;
export const componentReferencePoint = (component, point) => {
  if (component.variableType && point.measurementType === "derived") {
    const symbol = Object.keys(point.variableMappings || {}).find(key => point.variableMappings[key] === component.variableType);
    return point.variableNominals?.[symbol] || {};
  }
  return point.testPointInfo?.parameter || {};
};
export const dynamicMeasurementValue = (nominal, unit) => {
  if (!filled(nominal?.value)) throw Error("Enter a measurement point value.");
  if (!unit || !unitSystem.units[unit] || !unitSystem.units[nominal.unit]) throw Error("Choose valid measurement and output units.");
  if (unitSystem.units[unit].quantity !== unitSystem.units[nominal.unit].quantity) throw Error("The component's measurement unit is incompatible with this point.");
  // Nominal temperatures need offsets; uncertainty magnitudes below use only scale.
  if (unitSystem.units[unit].quantity === "Temperature") {
    const source = unitSystem.units[nominal.unit], target = unitSystem.units[unit];
    const celsius = source === unitSystem.units.degF ? (Number(nominal.value) - 32) * 5 / 9
      : source === unitSystem.units.K ? Number(nominal.value) - 273.15 : Number(nominal.value);
    return target === unitSystem.units.degF ? celsius * 9 / 5 + 32 : target === unitSystem.units.K ? celsius + 273.15 : celsius;
  }
  return unitSystem.fromBaseUnit(unitSystem.toBaseUnit(Number(nominal.value), nominal.unit), unit);
};
export const findDynamicTableRow = (definition, nominal) => {
  const value = dynamicMeasurementValue(nominal, definition.measurementUnit);
  const matches = (definition.rows || []).filter(row => filled(row.point) && Math.abs(Number(row.point) - value) <= Number.EPSILON * 32 * Math.max(Number.MIN_VALUE, Math.abs(value), Math.abs(Number(row.point))));
  if (matches.length > 1) throw Error("Duplicate measurement values in the table; keep one row for this point.");
  if (!matches.length) throw Error(`No table entry for ${value} ${definition.measurementUnit}. Add this point to the table.`);
  return matches[0];
};
export const resolveDynamicComponent = (component, definition, nominal) => {
  if (!definition) return unresolvedComponent(component, "This shared uncertainty definition is missing.");
  const column = definition.columns.find(c => c.id === component.dynamicOutputId);
  const base = { ...component, dynamicDefinition: definition,
    name: definition.name ? `${definition.name}${definition.columns.length > 1 && column ? ` — ${column.name}` : ""}` : "",
    distributionDivisor: definition.mode === "standard" ? "1" : definition.distribution,
    distribution: definition.mode === "standard" ? "Standard uncertainty" : `k=${definition.distribution}`,
    unit_native: definition.outputUnit, isBaseUnitValue: true, dynamicSummary: null,
  };
  try {
    if (!column) throw Error("This uncertainty column was removed from the shared table.");
    if (!unitSystem.units[definition.outputUnit] || !unitSystem.units[nominal?.unit]) throw Error("Choose a valid output unit.");
    if (unitSystem.units[definition.outputUnit].quantity !== unitSystem.units[nominal.unit].quantity) throw Error("The output unit is incompatible with this budget.");
    let magnitude, summary;
    if (definition.kind === "table") {
      const row = findDynamicTableRow(definition, nominal);
      const values = row.values?.[column.id] || {};
      if (definition.mode === "limits") {
        if (!filled(values.low) || !filled(values.high)) throw Error("Enter both error limits for this measurement point.");
        if (Number(values.high) < Number(values.low)) throw Error("The upper error limit must be at least the lower limit.");
        magnitude = (Number(values.high) - Number(values.low)) / 2;
        summary = `${values.low} to ${values.high}`;
      } else {
        if (!filled(values.value)) throw Error("Enter an uncertainty value for this measurement point.");
        magnitude = Number(values.value); summary = String(magnitude);
      }
    } else {
      const validation = validateBudgetEquation(definition.equation);
      if (validation.status !== "ok") throw Error(validation.error || "Enter an equation.");
      const scope = new Map();
      for (const symbol of validation.variables) {
        const value = symbol === definition.pointVariable ? dynamicMeasurementValue(nominal, definition.measurementUnit) : definition.variables?.[symbol]?.value;
        if (!filled(value)) throw Error(`Enter a nominal value for ${symbol}.`);
        scope.set(symbol, Number(value));
      }
      magnitude = evaluate(validation.expression, scope);
      if (typeof magnitude !== "number" || !Number.isFinite(magnitude)) throw Error("The equation must produce one finite real number.");
      summary = String(Number(magnitude.toPrecision(8)));
    }
    if (magnitude < 0) throw Error("Uncertainty cannot be negative.");
    const divisor = definition.mode === "standard" ? 1 : Number(definition.distribution);
    if (!Number.isFinite(divisor) || divisor <= 0) throw Error("Choose an error-limit distribution.");
    const standard = magnitude / divisor;
    return { ...base, pendingReason: null, value_native: standard,
      value: standard * unitSystem.units[definition.outputUnit].to_si,
      dynamicSummary: `${summary} ${definition.outputUnit}`,
    };
  } catch (error) { return unresolvedComponent(base, error.message); }
};
export const resolveDynamicComponents = (components, point, session) => (components || []).map(component =>
  component.dynamicDefinitionId ? resolveDynamicComponent(component, getDynamicDefinition(component, session), componentReferencePoint(component, point)) : component);

// Keep a portable snapshot in every linked instance as well as the session
// library. Budget/point copies and exported sessions retain the same link.
export const updateDynamicDefinition = (session, definition) => ({
  ...session,
  dynamicBudgetDefinitions: [...(session.dynamicBudgetDefinitions || []).filter(d => d.id !== definition.id), definition],
  testPoints: (session.testPoints || []).map(point => ({ ...point,
    components: (point.components || []).map(component => component.dynamicDefinitionId === definition.id
      ? { ...component, dynamicDefinition: definition } : component),
  })),
});
export const availableDynamicDefinitions = session => {
  const definitions = new Map();
  for (const point of session.testPoints || []) for (const c of point.components || []) if (c.dynamicDefinition) definitions.set(c.dynamicDefinition.id, c.dynamicDefinition);
  for (const definition of session.dynamicBudgetDefinitions || []) definitions.set(definition.id, definition);
  return [...definitions.values()];
};
