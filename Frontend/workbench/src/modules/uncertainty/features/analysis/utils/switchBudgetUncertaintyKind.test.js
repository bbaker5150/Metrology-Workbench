import { expect, it } from "vitest";
import { createInlineManualComponent, getInlineManualDraft } from "./manualComponentUtils";
import { switchBudgetUncertaintyKind } from "./switchBudgetUncertaintyKind";
import { createDynamicComponent, createDynamicDefinition } from "../../../utils/dynamicBudgetComponents";
const point = { value: 100, unit: "V" };
it("preserves identity, scope, name, distribution and notes across all types and restores authored values", () => {
  const manual = { ...createInlineManualComponent({ id: "m", referencePoint: point }), notes: "Keep me", customColumns: { note: "Checked" }, variableSymbol: "x" };
  const draft = { ...getInlineManualDraft(manual), name: "Thermal", errorDistributionDivisor: "2.000",
    tolerance: { floor: { high: 4, low: -4, unit: "V", distribution: "2.000" } } };
  const table = switchBudgetUncertaintyKind(manual, "table", point, draft);
  expect(table).toMatchObject({ id: "m", name: "Thermal", notes: "Keep me", customColumns: manual.customColumns, variableSymbol: "x" });
  expect(table.dynamicDefinition.distribution).toBe("2.000");
  const editedTable = { ...table.dynamicDefinition, name: "Changed name", rows: [{ id: "r", point: 100, values: { [table.dynamicOutputId]: { value: 3 } } }] };
  const equation = switchBudgetUncertaintyKind(table, "equation", point, editedTable);
  expect(equation.dynamicDefinition.name).toBe("Changed name");
  const restoredTable = switchBudgetUncertaintyKind(equation, "table", point);
  expect(restoredTable.dynamicDefinition.rows).toEqual(editedTable.rows);
  const restoredManual = switchBudgetUncertaintyKind(restoredTable, "parametric", point);
  expect(restoredManual.name).toBe("Changed name");
  expect(restoredManual.originalInput.tolerance.floor.high).toBe(4);
  expect(restoredManual.originalInput.errorDistributionDivisor).toBe("2.000");
  expect(restoredManual.dynamicDefinitionId).toBeUndefined();
});
it("does not change a shared table when one budget row switches to equation", () => {
  const definition = { ...createDynamicDefinition("table", point), name: "Shared", distribution: "1.732" };
  const component = createDynamicComponent(definition);
  const before = JSON.stringify(component);
  const next = switchBudgetUncertaintyKind(component, "equation", point);
  expect(JSON.stringify(component)).toBe(before);
  expect(next.dynamicDefinitionId).not.toBe(definition.id);
  expect(next.dynamicDefinition.kind).toBe("equation");
});
