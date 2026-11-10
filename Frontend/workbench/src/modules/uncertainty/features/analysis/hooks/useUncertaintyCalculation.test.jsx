import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useUncertaintyCalculation } from "./useUncertaintyCalculation";

const sessionData = {
  uncReq: { uncertaintyConfidence: 95 },
};

const directPoint = (overrides = {}) => ({
  id: "direct-point",
  measurementType: "direct",
  variableMappings: {},
  variableNominals: {},
  inputCorrelations: {},
  useEffectiveDofByGroup: {},
  ...overrides,
});

const tmdeAccuracy = {
  id: "tmde-instance",
  name: "Reference DMM",
  measurementPoint: { value: "10", unit: "V" },
  reading: {
    high: "0.1",
    low: "-0.1",
    unit: "%",
    distribution: "1.732",
    symmetric: true,
  },
};

const uutResolution = {
  includeResolutionInBudget: true,
  resolution: "0.01",
  resolutionUnit: "V",
  resolutionDistribution: "3.464",
};

it('clears every persisted uncertainty total when equation output units become incompatible, then recalculates', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  let point = directPoint({ measurementType: 'derived', equationString: 'a',
    variableMappings: { a: 'Voltage' }, variableNominals: { a: { value: 10, unit: 'V' } } });
  const sources = [{ ...tmdeAccuracy, variableType: 'Voltage' }];
  const tolerance = {}, manual = [];
  const save = vi.fn(patch => { point = { ...point, ...patch }; });
  const { result, rerender } = renderHook(({ nominal }) => useUncertaintyCalculation(
    point, sessionData, sources, tolerance, nominal, manual, save,
  ), { initialProps: { nominal: { value: 10, unit: 'V' } } });
  try {
    await waitFor(() => expect(point.is_detailed_uncertainty_calculated).toBe(true));
    const previousExpanded = point.expanded_uncertainty_absolute_base;
    expect(previousExpanded).toBeGreaterThan(0);
    rerender({ nominal: { value: 10, unit: 'A' } });
    await waitFor(() => expect(result.current.calculationError).not.toBeNull());
    expect(point).toMatchObject({
      is_detailed_uncertainty_calculated: false,
      combined_uncertainty: null, combined_uncertainty_absolute_base: null,
      combined_uncertainty_inputs_native: null, combined_uncertainty_inputs_base: null,
      expanded_uncertainty: null, expanded_uncertainty_absolute_base: null,
      effective_dof: null, k_value: null, calculatedNominalValue: null,
      calculatedBudgetComponents: [], calculatedBudgetGroups: [], risk8MonteCarloResult: null,
    });
    expect(result.current.calcResults.calculatedBudgetComponents.length).toBeGreaterThan(0);
    rerender({ nominal: { value: 10, unit: 'V' } });
    await waitFor(() => expect(point.is_detailed_uncertainty_calculated).toBe(true));
    expect(point.expanded_uncertainty_absolute_base).toBeCloseTo(previousExpanded);
    expect(result.current.calculationError).toBeNull();
  } finally { errors.mockRestore(); }
});

it('repairs already-invalid persisted totals once without repeatedly saving cleared results', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  let point = directPoint({ measurementType: 'derived', equationString: 'a',
    variableMappings: { a: 'Voltage' }, variableNominals: { a: { value: 10, unit: 'V' } },
    is_detailed_uncertainty_calculated: false,
    combined_uncertainty_absolute_base: .1, expanded_uncertainty_absolute_base: .2,
    risk8MonteCarloResult: { hash: 'old-result' } });
  const sources = [{ ...tmdeAccuracy, variableType: 'Voltage' }], tolerance = {}, manual = [];
  const nominal = { value: 10, unit: 'A' };
  const save = vi.fn(patch => { point = { ...point, ...patch }; });
  const { rerender } = renderHook(({ rows }) => useUncertaintyCalculation(
    point, sessionData, rows, tolerance, nominal, manual, save,
  ), { initialProps: { rows: sources } });
  try {
    await waitFor(() => expect(point.expanded_uncertainty_absolute_base).toBeNull());
    expect(point.combined_uncertainty_absolute_base).toBeNull();
    expect(point.risk8MonteCarloResult).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
    rerender({ rows: [...sources] });
    expect(save).toHaveBeenCalledTimes(1);
  } finally { errors.mockRestore(); }
});

const renderDirectCalculation = (
  pointOverrides = {},
  {
    tmdeTolerances = [tmdeAccuracy],
    uutTolerance = uutResolution,
    manualComponents = [],
    nominal = { value: "10", unit: "V", name: "Voltage" },
  } = {},
) => {
  const onDataSave = vi.fn();
  const pointData = directPoint(pointOverrides);
  const hook = renderHook(() =>
    useUncertaintyCalculation(
      pointData,
      sessionData,
      tmdeTolerances,
      uutTolerance,
      nominal,
      manualComponents,
      onDataSave,
    ),
  );
  return { ...hook, onDataSave };
};

describe("useUncertaintyCalculation direct budgets", () => {
  it("keeps the final budget limited to physical source components", async () => {
    const { result } = renderDirectCalculation();

    await waitFor(() => expect(result.current.calcResults).not.toBeNull());
    const finalBudget = result.current.calcResults.calculatedBudgetGroups.find(
      (group) => group.kind === "final",
    );
    const names = finalBudget.components.map((component) => component.name);

    expect(names).toContain("Reference DMM - TMDE Error");
    expect(names).toContain("UUT Resolution");
    expect(names).not.toContain("Taylor Series Approximation");
    expect(finalBudget.components.some((component) => component.isPropagationSummary)).toBe(
      false,
    );
  });

  it("materializes legacy repeated TMDE uses as independent budget rows", async () => {
    const { result } = renderDirectCalculation(
      {},
      {
        tmdeTolerances: [{ ...tmdeAccuracy, quantity: 2 }],
        uutTolerance: {},
      },
    );

    await waitFor(() => expect(result.current.calcResults).not.toBeNull());
    const finalBudget = result.current.calcResults.calculatedBudgetGroups.find(
      (group) => group.kind === "final",
    );
    const accuracyRows = finalBudget.components.filter(
      (component) => component.name === "Reference DMM - TMDE Error",
    );

    expect(accuracyRows).toHaveLength(2);
    expect(new Set(accuracyRows.map((component) => component.id)).size).toBe(2);
    expect(accuracyRows.every((component) => component.quantity === 1)).toBe(true);
  });

  it("keeps repeated saved accuracy and resolution uses as independent rows", async () => {
    const repeatedComponents = [
      {
        id: "accuracy-use-1",
        componentId: "accuracy-use-1",
        name: "Reference DMM - TMDE Error",
        value: 100,
        value_native: 0.001,
        unit_native: "V",
        tmdeBudgetSourceId: "tmde-1",
        sourceTmdeId: "tmde-1",
        isBudgetInstance: true,
        quantity: 1,
      },
      {
        id: "accuracy-use-2",
        componentId: "accuracy-use-2",
        name: "Reference DMM - TMDE Error",
        value: 100,
        value_native: 0.001,
        unit_native: "V",
        tmdeBudgetSourceId: "tmde-1",
        sourceTmdeId: "tmde-1",
        isBudgetInstance: true,
        quantity: 1,
      },
      {
        id: "resolution-use-1",
        componentId: "resolution-use-1",
        name: "UUT Resolution",
        value: 50,
        value_native: 0.0005,
        unit_native: "V",
        isResolution: true,
        uutResolutionBudgetSource: true,
        isBudgetInstance: true,
        quantity: 1,
      },
      {
        id: "resolution-use-2",
        componentId: "resolution-use-2",
        name: "UUT Resolution",
        value: 50,
        value_native: 0.0005,
        unit_native: "V",
        isResolution: true,
        uutResolutionBudgetSource: true,
        isBudgetInstance: true,
        quantity: 1,
      },
    ];
    const { result } = renderDirectCalculation(
      {},
      {
        tmdeTolerances: [],
        uutTolerance: {},
        manualComponents: repeatedComponents,
      },
    );

    await waitFor(() => expect(result.current.calcResults).not.toBeNull());
    const finalBudget = result.current.calcResults.calculatedBudgetGroups.find(
      (group) => group.kind === "final",
    );

    expect(finalBudget.components.map((component) => component.id)).toEqual(
      repeatedComponents.map((component) => component.id),
    );
    expect(
      finalBudget.components.filter(
        (component) => component.name === "Reference DMM - TMDE Error",
      ),
    ).toHaveLength(2);
    expect(
      finalBudget.components.filter(
        (component) => component.name === "UUT Resolution",
      ),
    ).toHaveLength(2);
  });

  it("ignores and clears a legacy direct Monte Carlo selection", async () => {
    const { result, onDataSave } = renderDirectCalculation({
      budgetPropagationMethod: "montecarlo",
      monteCarloTrials: 10000,
      risk8MonteCarloResult: { hash: "legacy-direct-result" },
    });

    await waitFor(() => expect(result.current.calcResults).not.toBeNull());
    const finalBudget = result.current.calcResults.calculatedBudgetGroups.find(
      (group) => group.kind === "final",
    );

    expect(finalBudget.components.map((component) => component.name)).toEqual(
      expect.arrayContaining(["Reference DMM - TMDE Error", "UUT Resolution"]),
    );
    expect(finalBudget.components.some((component) => component.isPropagationSummary)).toBe(
      false,
    );
    expect(result.current.calcResults.propagationMethod).toBe("linear");
    expect(result.current.calcResults.monteCarlo).toBeNull();
    await waitFor(() =>
      expect(onDataSave).toHaveBeenCalledWith(
        expect.objectContaining({
          budgetPropagationMethod: "linear",
          risk8MonteCarloResult: null,
        }),
      ),
    );
  });

  it("converts compatible source units before combining a direct budget", async () => {
    const oneInchTolerance = {
      id: "length-reference",
      name: "Length reference",
      measurementPoint: { value: "10", unit: "ft" },
      floor: {
        high: "1",
        low: "-1",
        unit: "in",
        distribution: "1.732",
        symmetric: true,
      },
    };
    const { result } = renderDirectCalculation(
      {},
      {
        tmdeTolerances: [oneInchTolerance],
        uutTolerance: {},
        nominal: { value: "10", unit: "ft", name: "Length" },
      },
    );

    await waitFor(() => expect(result.current.calcResults).not.toBeNull());
    const finalBudget = result.current.calcResults.calculatedBudgetGroups.find(
      (group) => group.kind === "final",
    );

    // A ±1 in rectangular tolerance has u = 1/sqrt(3) in. The final result
    // is displayed in the point's feet, so the expected value is divided by 12.
    expect(finalBudget.results.combined).toBeCloseTo(
      1 / (12 * Math.sqrt(3)),
      10,
    );
    expect(result.current.calcResults.combined_uncertainty_absolute_base).toBeCloseTo(
      0.0254 / Math.sqrt(3),
      10,
    );
  });
});

describe("incomplete measurement budgets", () => {
  it("retains value-dependent rows and suppresses totals, while showing absolute resolution", async () => {
    const { result } = renderDirectCalculation({}, { nominal: { value: "", unit: "V" } });
    await waitFor(() => expect(result.current.calcResults).not.toBeNull());
    const group = result.current.calcResults.calculatedBudgetGroups[0];
    expect(group.components.find(c => c.name.includes("TMDE Error")).pendingReason).toMatch(/measurement value/);
    expect(group.components.find(c => c.isResolution).value_native).toBeGreaterThan(0);
    expect(group.results.combined).toBeNull();
    expect(group.results.pendingReason).toMatch(/measurement value/);
    expect(result.current.calcResults.is_detailed_uncertainty_calculated).toBe(false);
  });
  it("calculates a nominal-independent budget without inventing a measurement value", async () => {
    const { result } = renderDirectCalculation({}, { nominal: { value: "", unit: "V" }, tmdeTolerances: [],
      uutTolerance: {}, manualComponents: [{ id: "absolute", value_native: 2, unit_native: "V", value: 2, isBaseUnitValue: true }] });
    await waitFor(() => expect(result.current.calcResults).not.toBeNull());
    expect(result.current.calcResults.calculatedBudgetGroups[0].results.combined).toBe(2);
    expect(result.current.calcResults.is_detailed_uncertainty_calculated).toBe(false);
  });
});

it("keeps derived input budgets visible while their nominal values are incomplete", async () => {
  const { result } = renderDirectCalculation({ measurementType: "derived", equationString: "x*y", variableMappings: { x: "Length", y: "Force" }, variableNominals: { x: { value: "", unit: "m" }, y: { value: 5, unit: "N" } } }, { nominal: { value: "", unit: "N-m" }, tmdeTolerances: [], uutTolerance: {}, manualComponents: [] });
  await waitFor(() => expect(result.current.calcResults).not.toBeNull());
  expect(result.current.calcResults.calculatedBudgetGroups.map(g => g.variableType || g.kind)).toEqual(["Length", "Force", "final"]);
  expect(result.current.calcResults.calculatedBudgetGroups.at(-1).results.pendingReason).toMatch(/equation input/);
});

it("calculates a manual unitless direct budget without instruments", async () => {
  const { result } = renderDirectCalculation({}, {
    tmdeTolerances: [], uutTolerance: null, nominal: { value: "10", unit: "" },
    manualComponents: [{ id: "a", name: "Manual", value: 2, value_native: 2, unit_native: "", isBaseUnitValue: true, dof: Infinity }],
  });
  await waitFor(() => expect(result.current.calcResults.combined_uncertainty_absolute_base).toBe(2));
  expect(result.current.calcResults.expanded_uncertainty_absolute_base).toBeCloseTo(3.9199, 3);
});


it("keeps unnamed incomplete equation inputs distinct from the final measurement budget", async () => {
  const { result } = renderDirectCalculation({ measurementType: "derived", equationString: "x*y",
    variableMappings: { x: "", y: "Force" }, variableNominals: { x: { value: "", unit: "m" }, y: { value: 5, unit: "N" } },
  }, { nominal: { value: "", unit: "N-m" }, tmdeTolerances: [], uutTolerance: {}, manualComponents: [] });
  await waitFor(() => expect(result.current.calcResults).not.toBeNull());
  const groups = result.current.calcResults.calculatedBudgetGroups;
  expect(groups.map(group => group.kind)).toEqual(["input", "input", "final"]);
  expect(groups[0]).toMatchObject({ id: "input_x", label: "x Uncertainty Budget", unit: "m" });
  expect(groups.at(-1)).toMatchObject({ id: "final_budget", unit: "N-m" });
});

it('keeps the budget calculated when only the UUT tolerance unit differs', async () => {
  const { result, onDataSave } = renderDirectCalculation({ is_detailed_uncertainty_calculated: true }, {
    uutTolerance: { unit: 'A', reading: { high: 1, low: -1, unit: '%' } },
  });
  await waitFor(() => expect(result.current.calcResults?.is_detailed_uncertainty_calculated).toBe(true));
  expect(result.current.calculationError).toBeNull();
  const final = result.current.calcResults.calculatedBudgetGroups.at(-1);
  expect(final.results.combined).toBeGreaterThan(0);
  expect(final.components.some(component => component.name === 'Reference DMM - TMDE Error')).toBe(true);
  expect(onDataSave).toHaveBeenCalledWith(expect.objectContaining({ is_detailed_uncertainty_calculated: true }));
});

it('keeps a mismatched budget source visible while withholding the total', async () => {
  const { result } = renderDirectCalculation({}, {
    tmdeTolerances: [{ ...tmdeAccuracy, reading: { ...tmdeAccuracy.reading, unit: 'A' } }],
    uutTolerance: { unit: 'A', reading: { high: 1, low: -1, unit: '%' } },
  });
  await waitFor(() => expect(result.current.calcResults).not.toBeNull());
  const final = result.current.calcResults.calculatedBudgetGroups.at(-1);
  expect(final.components.some(component => component.pendingReason?.includes('Unit mismatch'))).toBe(true);
  expect(final.results.combined).toBeNull();
});

it('keeps an ampere budget present when the UUT range is A and its floor tolerance is V', async () => {
  const { result } = renderDirectCalculation({}, {
    nominal: { value: '5', unit: 'A', name: 'Current' },
    uutTolerance: { min: 0, max: 10, unit: 'A', floor: { high: 1, low: -1, unit: 'V', distribution: '1.732' } },
  });
  await waitFor(() => expect(result.current.calcResults?.is_detailed_uncertainty_calculated).toBe(true));
  expect(result.current.calculationError).toBeNull();
  const budget = result.current.calcResults.calculatedBudgetGroups.at(-1);
  expect(budget.unit).toBe('A');
  expect(budget.components.length).toBeGreaterThan(0);
  expect(budget.results.combined).toBeGreaterThan(0);
});


it("keeps manual, tabular and equation components in only their unnamed input budget", async () => {
 const components = ["manual", "table", "equation"].map((name, index) => ({ id: name, name, variableSymbol: ["a", "b", "d"][index], variableType: "", pendingReason: "Set input nominal" }));
 const { result } = renderDirectCalculation({ measurementType: "derived", equationString: "a+b+d+d/c", variableMappings: { a: "", b: "", c: "", d: "" }, variableNominals: {} }, { nominal: { value: "", unit: "" }, tmdeTolerances: [], uutTolerance: {}, manualComponents: components });
 await waitFor(() => expect(result.current.calcResults).not.toBeNull());
 expect(result.current.calcResults.calculatedBudgetGroups.map(group => [group.variable, group.components.map(c => c.id)])).toEqual([
 ["a", ["manual"]], ["b", ["table"]], ["c", []], ["d", ["equation"]], [undefined, []],
 ]);
});

it("keeps a complete budget when the UUT range uses A and its tolerance uses V", async () => {
  const { result } = renderDirectCalculation({}, { uutTolerance: {
    unit: "A", min: 0, max: 20, floor: { high: 1, low: -1, unit: "V", distribution: "1.732" },
  } });
  await waitFor(() => expect(result.current.calcResults?.calculatedBudgetGroups).toHaveLength(1));
  expect(result.current.calcResults.calculatedBudgetGroups[0].components).toHaveLength(1);
  expect(result.current.calcResults.calculatedBudgetGroups[0].components[0].name).toContain("Reference DMM");
});
