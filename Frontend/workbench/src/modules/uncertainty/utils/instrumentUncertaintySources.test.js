import { expect, it } from "vitest";
import { instrumentUncertaintySources, withInstrumentUncertaintySources } from "./instrumentUncertaintySources";
import { getInstrumentRangeRows, resolveInstrumentSelection } from "./instrumentFunctionSelection";
import { getBudgetComponentsFromTolerance } from "../features/analysis/utils/budgetUtils";

it("migrates legacy source ids once and resolves instrument sources for every real range", () => {
  const source = { id: "thermal", name: "Thermal error", kind: "parametric", tolerance: { floor: { high: .2, low: -.2, unit: "V", distribution: "1.732" } } };
  const item = { id: "tmde", instrument: { ranges: [1, 2].map(id => ({ id, min: 0, max: id * 10, unit: "V",
    tolerances: { floor: { high: .1, low: -.1, unit: "V", distribution: "1.732" }, ...(id === 1 ? { tmdeSecondaryUncertainties: [source] } : {}) } })) } };
  const migrated = withInstrumentUncertaintySources(item, instrumentUncertaintySources(item));
  expect(migrated.instrument.tmdeSecondaryUncertainties).toEqual([source]);
  expect(migrated.instrument.ranges[0].tolerances.tmdeSecondaryUncertainties).toBeUndefined();
  const rows = getInstrumentRangeRows(migrated, { flattenTolerances: true });
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    const components = getBudgetComponentsFromTolerance(row, { value: 5, unit: "V" });
    expect(components.filter(c => c.tmdeUncertaintySourceId === "thermal")).toHaveLength(1);
    expect(resolveInstrumentSelection(migrated, { rangeId: row.id }).specs.tmdeSecondaryUncertainties).toEqual([source]);
  }
  expect(instrumentUncertaintySources(withInstrumentUncertaintySources(migrated, []))).toEqual([]);
});
