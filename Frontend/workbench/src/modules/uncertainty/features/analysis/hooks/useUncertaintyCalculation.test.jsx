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

const renderDirectCalculation = (pointOverrides = {}) => {
  const onDataSave = vi.fn();
  const pointData = directPoint(pointOverrides);
  const tmdeTolerances = [tmdeAccuracy];
  const nominal = { value: "10", unit: "V", name: "Voltage" };
  const manualComponents = [];
  const hook = renderHook(() =>
    useUncertaintyCalculation(
      pointData,
      sessionData,
      tmdeTolerances,
      uutResolution,
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

    expect(names).toContain("Reference DMM - Accuracy");
    expect(names).toContain("UUT Resolution");
    expect(names).not.toContain("Taylor Series Approximation");
    expect(finalBudget.components.some((component) => component.isPropagationSummary)).toBe(
      false,
    );
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
      expect.arrayContaining(["Reference DMM - Accuracy", "UUT Resolution"]),
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
});
