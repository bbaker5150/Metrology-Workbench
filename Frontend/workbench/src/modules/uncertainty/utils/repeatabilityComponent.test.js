import { expect, it } from "vitest";
import { resolvePointBudgetComponents } from "./resolvePointBudgetComponents";
import { resolveRepeatabilityComponent } from "./repeatabilityComponent";

const component = { id: "repeatability-test", type: "A", savedInputs: { stdDev: .2, unit: "V", readings: [1, 1.2, 1.4], dof: 2 } };
it("keeps incompatible observations and warns until the point's units are corrected", () => {
  const result = resolveRepeatabilityComponent(component, { value: 10, unit: "A" });
  expect(result.pendingReason).toMatch(/Unit mismatch: V.*A/);
  expect(result.value).toBeNull();
  expect(result.savedInputs).toEqual(component.savedInputs);
  const point = { components: [result], testPointInfo: { parameter: { value: 10, unit: "V" } } };
  const resolved = resolvePointBudgetComponents(point, {})[0];
  expect(resolved.pendingReason).toBeNull();
  expect(resolved.value).toBeCloseTo(20000);
  expect(resolved.value_native).toBe(.2);
});
it("handles missing units, zero nominal, and converted SI prefixes without losing observations", () => {
  expect(resolveRepeatabilityComponent(component, { value: 10, unit: "" })).toMatchObject({pendingReason:null,value_native:.2,unit_native:"V"});
  const zero = resolveRepeatabilityComponent(component, { value: 0, unit: "V" });
  expect(zero).toMatchObject({ value: .2, isBaseUnitValue: true, pendingReason: null });
  expect(resolveRepeatabilityComponent(component, { value: 10000, unit: "mV" }).value).toBeCloseTo(20000);
});
it("resolves repeatability against its derived input, independently of the output unit", () => {
  const point = { measurementType: "derived", variableMappings: { x: "Voltage" }, variableNominals: { x: { value: 10, unit: "V" } },
    testPointInfo: { parameter: { value: 2, unit: "A" } }, components: [{ ...component, variableSymbol: "x" }] };
  expect(resolvePointBudgetComponents(point, {})[0]).toMatchObject({ value: 20000, pendingReason: null });
});
