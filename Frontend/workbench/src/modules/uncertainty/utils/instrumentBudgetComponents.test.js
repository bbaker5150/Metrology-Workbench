import { expect, it } from "vitest";
import { associateBudgetComponent, canUseInstrumentBudgetComponent, createInstrumentBudgetComponent, instantiateInstrumentBudgetComponent, syncInstrumentBudgetComponents } from "./instrumentBudgetComponents";
import { resolveDynamicComponent } from "./dynamicBudgetComponents";
import { calculateDerivedUncertainty } from "./uncertaintyMath";
it("filters a reusable table by converted nominal without adding invented rows", () => {
 const record = createInstrumentBudgetComponent("table", "V");
 const definition = record.budgetComponent.dynamicDefinition;
 definition.rows[0].point = 1;
 expect(canUseInstrumentBudgetComponent(record, { value: 1000, unit: "mV" })).toBe(true);
 expect(canUseInstrumentBudgetComponent(record, { value: 2, unit: "V" })).toBe(false);
 expect(canUseInstrumentBudgetComponent(record, { value: 1, unit: "A" })).toBe(false);
 expect(canUseInstrumentBudgetComponent(record, { value: "", unit: "V" })).toBe(false);
 expect(definition.rows).toHaveLength(1);
});
it("associates portable definitions and rebinds equations to the destination point", () => {
 const record = createInstrumentBudgetComponent("equation", "V");
 const def = record.budgetComponent.dynamicDefinition;
 Object.assign(def, { equation: "x/10", pointVariable: "x", mode: "standard" });
 const next = associateBudgetComponent({ uuts: [{ id: "u", instrument: {} }] }, "uut", "u", { ...record.budgetComponent, variableSymbol: "source", value: 999 });
 const stored = next.uuts[0].instrument.typeBComponents[0];
 expect(stored.budgetComponent.variableSymbol).toBeUndefined();
 expect(stored.budgetComponent.value).toBeUndefined();
 const component = instantiateInstrumentBudgetComponent(stored, { kind: "input", variableSymbol: "target", variableType: "" });
 expect(component.variableSymbol).toBe("target");
 expect(resolveDynamicComponent(component, component.dynamicDefinition, { value: 20, unit: "V" }).value_native).toBe(2);
});
it.each([{ a: "", b: "" }, { a: "Same", b: "Same" }])("calculates inputs separately even when names collide: %j", mappings => {
 const result = calculateDerivedUncertainty("a+b", mappings, [], { value: 5, unit: "V", variableNominals: { a: { value: 2, unit: "V" }, b: { value: 3, unit: "V" } } }, [
 { variableSymbol: "a", value_native: 1, unit_native: "V" }, { variableSymbol: "b", value_native: 2, unit_native: "V" },
 ]);
 expect(result.error).toBeFalsy();
 expect(result.nominalResult).toBe(5);
 expect(result.combinedUncertaintyNative).toBeCloseTo(Math.sqrt(5));
 expect(result.breakdown.map(row => row.ui_absolute_base)).toEqual([1, 2]);
});

it("saves a stable instrument identity and synchronizes builder deletion without altering independent budgets", () => {
  const record = createInstrumentBudgetComponent("equation", "V");
  const associated = associateBudgetComponent({ uuts: [{ id: "u", instrument: {} }], testPoints: [{ components: [record.budgetComponent] }] }, "uut", "u", record.budgetComponent);
  expect(associated.uuts[0].instrument.id).toBe("u");
  const next = syncInstrumentBudgetComponents(associated, { id: "u", typeBComponents: [] });
  expect(next.uuts[0].instrument.typeBComponents).toEqual([]);
  expect(next.testPoints).toBe(associated.testPoints);
  expect(syncInstrumentBudgetComponents(associated, { id: "unrelated", typeBComponents: [] })).toBe(associated);
  const shared = { ...associated, uuts: [{ ...associated.uuts[0], instrument: { ...associated.uuts[0].instrument, scope: "shared" } }] };
  expect(syncInstrumentBudgetComponents(shared, { id: "u", typeBComponents: [] })).toBe(shared);
});


it("migrates legacy manual definitions losslessly and removes only empty placeholders", async () => {
  const { normalizeInstrumentTypeBComponents, withInstrumentEditorDrafts } = await import("./instrumentBudgetComponents");
  const legacy = { id: "legacy", name: "Head pressure", unit: "psig", distribution: "2.449", inputMode: "tolerance", scope: "range", functionId: "pressure", rangeId: "r1",
    tolerance: { floor: { high: ".01", low: "-.02", unit: "psig", distribution: "2.449", symmetric: false } } };
  const components = normalizeInstrumentTypeBComponents([{ id: "empty", unit: "V", toleranceLimit: "", name: "" }, legacy]);
  expect(components).toHaveLength(1);
  expect(components[0]).toMatchObject({ id: "legacy", scope: "range", functionId: "pressure", rangeId: "r1" });
  expect(components[0].budgetComponent.originalInput.tolerance.floor).toEqual(legacy.tolerance.floor);
  expect(withInstrumentEditorDrafts({ typeBComponents: [legacy] }).typeBComponents[0].budgetComponent).toBeDefined();
  const standard = normalizeInstrumentTypeBComponents([{ id: "std", name: "Standard", unit: "V", inputMode: "standard", standardUncertainty: ".2", distribution: "2" }])[0];
  expect(standard.budgetComponent.originalInput.tolerance.floor).toMatchObject({ high: "0.2", distribution: "1" });
});
