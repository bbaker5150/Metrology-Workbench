import { inputSymbol, inputBinding, belongsToInput } from "./budgetScope";
import { evaluate, parse } from "./equationMath";
import { v4 as uuid } from "uuid";
import { unitSystem, getUnitDisplayLabel } from "./uncertaintyMath";
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

export const createDynamicDefinition = (kind, nominal = {}, measurementPoint = nominal) => ({
  id: uuid(), kind, name: "", measurementUnit: (kind === "equation" ? measurementPoint.unit : nominal.unit) || "", outputUnit: nominal.unit || "",
  mode: "tolerance", distribution: "", columns: [{ id: uuid(), name: "Uncertainty" }],
  rows: [{ id: uuid(), point: kind === "table" && filled(nominal.value) ? Number(nominal.value) : "", values: {} }], equation: "", variables: {}, pointVariable: "",
});
export const createDynamicComponent = (definition, outputId, scope) => ({
  id: uuid(), name: definition.name, type: "B", isManual: true, isCore: false,
  dynamicDefinitionId: definition.id, dynamicOutputId: outputId || definition.columns[0].id,
  dynamicDefinition: definition, value: null, value_native: null, dof: Infinity,
  ...inputBinding(scope),
});
// A portable definition carries its binding, never the source point's evaluated result.
export const clearDynamicComponentResults = component => {
  if (!component?.dynamicDefinitionId) return component;
  const { dynamicReferencePoint, dynamicSummary, pendingReason, ...authored } = component;
  return { ...authored, value: null, value_native: null };
};
export const getDynamicDefinition = (component, session = {}) =>
  (session.dynamicBudgetDefinitions || []).find(d => d.id === component.dynamicDefinitionId) || component.dynamicDefinition;
export const componentReferencePoint = (component, point) => {
  if ((component.variableSymbol || component.variableType) && point.measurementType === "derived") {
    const symbol = inputSymbol(component, point.variableMappings);
    return point.variableNominals?.[symbol] || {};
  }
  return point.testPointInfo?.parameter || {};
};
export const dynamicMeasurementValue = (nominal, unit) => {
  if (!filled(nominal?.value)) throw Error("Enter a measurement point value.");
  if (!unit || !unitSystem.units[unit] || !unitSystem.units[nominal.unit]) throw Error("Choose valid measurement and output units.");
  if (unitSystem.units[unit].quantity !== unitSystem.units[nominal.unit].quantity) throw Error("The component's measurement unit is incompatible with this point.");
  if (nominal.unit === unit) return Number(nominal.value);
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
  const value = dynamicMeasurementValue(nominal, definition.measurementUnit || nominal?.unit);
  const matches = (definition.rows || []).filter(row => filled(row.point) && Math.abs(Number(row.point) - value) <= Number.EPSILON * 32 * Math.max(Number.MIN_VALUE, Math.abs(value), Math.abs(Number(row.point))));
  if (matches.length > 1) throw Error("Duplicate measurement values in the table; keep one row for this point.");
  if (!matches.length) throw Error(`No table entry for ${value} ${getUnitDisplayLabel(definition.measurementUnit)}. Add this point to the table.`);
  return matches[0];
};
// Older equation definitions could bind a derived input to the final point's
// physical quantity. Restore the input/output quantity without changing units
// on correctly authored definitions (whose coefficients may depend on scale).
export const dynamicMeasurementUnit = (definition, nominal) => {
  const measurement = unitSystem.units[definition.measurementUnit];
  const output = unitSystem.units[definition.outputUnit];
  if (definition.kind === "equation" && measurement && output && measurement.quantity !== output.quantity && output.quantity === unitSystem.units[nominal?.unit]?.quantity) return definition.outputUnit;
  return definition.measurementUnit || nominal?.unit || "";
};
export const resolveDynamicComponent = (component, definition, nominal, measurementPoint = nominal) => {
  if (!definition) return unresolvedComponent(component, "This shared uncertainty definition is missing.");
  definition = { ...definition, measurementUnit: dynamicMeasurementUnit(definition, nominal), outputUnit: definition.outputUnit || nominal?.unit || "" };
  const column = definition.columns.find(c => c.id === component.dynamicOutputId);
  const base = { ...component, dynamicDefinition: definition,
    name: definition.name ? `${definition.name}${definition.columns.length > 1 && column ? ` — ${column.name}` : ""}` : "",
    distributionDivisor: definition.mode === "standard" ? "1" : definition.distribution,
    distribution: definition.mode === "standard" ? "Standard uncertainty" : `k=${definition.distribution}`,
    unit_native: definition.outputUnit, isBaseUnitValue: true, dynamicSummary: null,
    dynamicReferencePoint: nominal,
  };
  try {
    if (!nominal?.unit) throw Error(`No unit is set for ${component.variableType || "this measurement point"}. Set its unit to calculate uncertainty.`);
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
      const equations = definition.mode === "limits" ? [definition.lowerEquation, definition.upperEquation] : [definition.equation];
      const validations = equations.map(equation => validateBudgetEquation(equation || ""));
      const invalid = validations.find(validation => validation.status !== "ok");
      if (invalid) throw Error(invalid.error || (definition.mode === "limits" ? "Enter both error-limit equations." : "Enter an equation."));
      const scope = new Map();
      for (const symbol of new Set(validations.flatMap(validation => validation.variables))) {
        const value = symbol === definition.pointVariable ? dynamicMeasurementValue(measurementPoint, definition.measurementUnit) : definition.variables?.[symbol]?.value;
        if (!filled(value)) throw Error(`Enter a nominal value for ${symbol}.`);
        scope.set(symbol, Number(value));
      }
      const values = validations.map(validation => evaluate(validation.expression, scope));
      if (values.some(value => typeof value !== "number" || !Number.isFinite(value))) throw Error("The equation must produce one finite real number.");
      if (definition.mode === "limits" && values[1] < values[0]) throw Error("The upper error limit must be at least the lower limit.");
      magnitude = definition.mode === "limits" ? (values[1] - values[0]) / 2 : values[0];
      summary = values.map(value => String(Number(value.toPrecision(8)))).join(" to ");
    }
    if (magnitude < 0) throw Error("Uncertainty cannot be negative.");
    // The authored error limit is valid before a distribution is selected.
    // Keep it visible while standard uncertainty still needs its divisor.
    base.dynamicSummary = `${definition.mode === "limits" ? "" : "± "}${summary} ${getUnitDisplayLabel(definition.outputUnit)}`;
    const divisor = definition.mode === "standard" ? 1 : Number(definition.distribution);
    if (!Number.isFinite(divisor) || divisor <= 0) throw Error("Choose an error-limit distribution.");
    const standard = magnitude / divisor;
    return { ...base, pendingReason: null, value_native: standard,
      value: standard * unitSystem.units[definition.outputUnit].to_si,
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
  return [...definitions.values()].filter(definition => !definition.hiddenFromPicker);
};

// Removing a reusable choice must not silently subtract uncertainty from an
// existing budget. Used definitions keep their shared identity and portable
// snapshots, but disappear from creation/reuse menus (including after reload).
// Unused definitions can be removed outright. Editing a retained definition
// preserves this flag, so an old point cannot resurrect the deleted choice.
export const removeDynamicDefinitionFromPicker = (session, id) => {
  const definition = availableDynamicDefinitions(session).find(item => item.id === id);
  if (!definition) return session;
  const used = (session.testPoints || []).some(point => (point.components || []).some(component =>
    component.dynamicDefinitionId === id || component.dynamicDefinition?.id === id));
  return used ? updateDynamicDefinition(session, { ...definition, hiddenFromPicker: true })
    : { ...session, dynamicBudgetDefinitions: (session.dynamicBudgetDefinitions || []).filter(item => item.id !== id) };
};


export const dynamicDefinitionLabel = (definition, index = 0) => definition.name?.trim() || `${definition.kind === "table" ? "Tabular" : "Equation"} component ${index + 1}`;
const sameQuantity = (a, b) => Boolean(unitSystem.units[a] && unitSystem.units[b] && unitSystem.units[a].quantity === unitSystem.units[b].quantity);
export const canUseDynamicDefinition = (definition, nominal) =>
  (!definition.outputUnit || !nominal?.unit || sameQuantity(definition.outputUnit, nominal.unit)) &&
  (!nominal?.unit || sameQuantity(dynamicMeasurementUnit(definition, nominal), nominal.unit));
const isEmptyDefinition = definition => definition.kind === "equation"
  ? ![definition.equation, definition.lowerEquation, definition.upperEquation].some(value => String(value || "").trim())
  : !(definition.rows || []).some(row => Object.values(row.values || {}).some(values => Object.values(values).some(filled)));
const nextDefinitionName = (kind, definitions) => {
  const names = new Set(definitions.map(d => d.name));
  let index = 0, name;
  do { name = dynamicDefinitionLabel({ kind }, index++); } while (names.has(name));
  return name;
};

// One definition per shared component; each point holds only one use per budget.
// Repeated creation resumes an unfinished definition rather than accumulating drafts.
export function attachDynamicComponent(session, pointId, kind, scope, existing, outputId) {
  const point = (session.testPoints || []).find(point => String(point.id) === String(pointId));
  if (!point) return { session, component: null };
  const nominal = componentReferencePoint(inputBinding(scope), point);
  const definitions = availableDynamicDefinitions(session);
  let definition = existing ? definitions.find(d => d.id === existing.id) || existing
    : definitions.find(d => d.kind === kind && isEmptyDefinition(d) && canUseDynamicDefinition(d, nominal));
  definition ||= createDynamicDefinition(kind, nominal);
  definition = { ...definition, measurementUnit: dynamicMeasurementUnit(definition, nominal), outputUnit: definition.outputUnit || nominal?.unit || "" };
  if (!definition.name?.trim()) definition = { ...definition, name: nextDefinitionName(kind, [...definitions, ...(session.dynamicBudgetDefinitions || [])]) };
  if (kind === 'table' && unitSystem.units[nominal?.unit] && unitSystem.units[definition.measurementUnit] && filled(nominal.value) && canUseDynamicDefinition(definition, nominal)) {
    const value = dynamicMeasurementValue(nominal, definition.measurementUnit);
    const matches = definition.rows.some(row => filled(row.point) && Math.abs(Number(row.point) - value) <= Number.EPSILON * 32 * Math.max(Number.MIN_VALUE, Math.abs(value), Math.abs(Number(row.point))));
    if (!matches) definition = { ...definition, rows: [...definition.rows, { id: uuid(), point: value, values: {} }] };
  }
  const variableType = scope?.kind === 'input' ? scope.variableType : undefined;
  const column = outputId || definition.columns[0].id;
  const component = (point.components || []).find(c => c.dynamicDefinitionId === definition.id && (c.dynamicOutputId || definition.columns[0].id) === column && belongsToInput(c, inputSymbol(inputBinding(scope), point.variableMappings), point.variableMappings)) || createDynamicComponent(definition, column, scope);
  const next = updateDynamicDefinition(session, definition);
  const openEditor = !existing || kind !== 'table' || Boolean(resolveDynamicComponent(component, definition, nominal).pendingReason);
  return { component, openEditor, session: { ...next, testPoints: next.testPoints.map(p => String(p.id) !== String(point.id) || p.components?.some(c => c.id === component.id) ? p : { ...p, components: [...(p.components || []), component] }) } };
}

// Remove the definition only after its final budget use is removed. Instrument
// associations hold independent portable copies and are not deleted here.
export function removeDynamicBudgetComponent(session, pointId, componentId) {
  const point = session.testPoints?.find(p => String(p.id) === String(pointId));
  const component = point?.components?.find(c => c.id === componentId);
  const id = component?.dynamicDefinitionId;
  const testPoints = (session.testPoints || []).map(p => String(p.id) === String(pointId)
    ? { ...p, components: (p.components || []).filter(c => c.id !== componentId) } : p);
  const stillUsed = testPoints.some(p => p.components?.some(c => c.dynamicDefinitionId === id));
  return { ...session, testPoints, dynamicBudgetDefinitions: id && !stillUsed
    ? (session.dynamicBudgetDefinitions || []).filter(d => d.id !== id) : session.dynamicBudgetDefinitions };
}
