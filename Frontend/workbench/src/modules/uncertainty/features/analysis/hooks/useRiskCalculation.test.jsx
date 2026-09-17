import vectors from "../../../utils/risk8/beta7Vectors.json";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useRiskCalculation } from "./useRiskCalculation";
import { unitSystem } from "../../../utils/uncertaintyMath";

const session = {
  uutDescription: "Voltage UUT",
  uncReq: {
    reqPFA: 2,
    reliability: 95,
    calInt: 12,
    measRelCalcAssumed: 85,
    neededTUR: 4,
    guardBandMultiplier: 1,
  },
};

describe("useRiskCalculation single-sided validation", () => {
  test("clears risk on an empty budget and restores identical results without changing points", async () => {
    const tolerance = { floor: { high: 1, low: -1, unit: 'V', symmetric: true } };
    const nominal = { value: 10, unit: 'V' };
    const point = { id: 'same-point', uutTolerance: tolerance };
    const tmde = [];
    const calc = { combined_uncertainty_absolute_base: .1, expanded_uncertainty_absolute_base: .196, calculatedNominalValue: null };
    const changed = vi.fn();
    const { result, rerender } = renderHook(({ calculation, mode }) =>
      useRiskCalculation(session, point, tolerance, tmde, nominal, calculation, mode, changed),
      { initialProps: { calculation: calc, mode: 'uncertaintyTool' } });
    await waitFor(() => expect(result.current.riskResults?.pfa).toBeTypeOf('number'));
    const original = result.current.riskResults;
    rerender({ calculation: null, mode: 'uncertaintyTool' });
    await waitFor(() => expect(result.current.riskResults).toBeNull());
    expect(changed).toHaveBeenLastCalledWith(null);
    rerender({ calculation: calc, mode: 'uncertaintyTool' });
    await waitFor(() => expect(result.current.riskResults).toEqual(original));
    expect(changed).toHaveBeenLastCalledWith(original);
    // Leaving/reentering risk must reset the same de-duplication cache too.
    rerender({ calculation: calc, mode: 'other' });
    await waitFor(() => expect(result.current.riskResults).toBeNull());
    rerender({ calculation: calc, mode: 'uncertaintyTool' });
    await waitFor(() => expect(result.current.riskResults).toEqual(original));
  });
  test("routes the workbook Type 1 pressure mitigation row through Risk 8.0", async () => {
    const symmetricSession = {
      ...session,
      uncReq: {
        ...session.uncReq,
        reliability: 85,
        measRelCalcAssumed: 85,
        reqPFA: 2,
        guardBandMultiplier: 1,
      },
    };
    const tolerance = {
      floor: { high: 0.2, low: -0.2, unit: "psig", symmetric: true },
      measuringResolution: 0.1,
      measuringResolutionUnit: "psig",
    };
    const combinedNative = 0.03227486;
    const expandedNative = 0.063257566;
    const testPointData = { uutTolerance: tolerance };
    const tmdeTolerances = [];
    const nominal = { value: 25, unit: "psig" };
    const calculationResults = {
      combined_uncertainty_absolute_base: unitSystem.toBaseUnit(
        combinedNative,
        "psig",
      ),
      expanded_uncertainty_absolute_base: unitSystem.toBaseUnit(
        expandedNative,
        "psig",
      ),
      calculatedNominalValue: null,
    };
    const { result } = renderHook(() =>
      useRiskCalculation(
        symmetricSession,
        testPointData,
        tolerance,
        tmdeTolerances,
        nominal,
        calculationResults,
        "risk",
        vi.fn(),
      ),
    );

    await waitFor(() => {
      expect(result.current.riskResults?.riskMethod).toBe(
        "risk8-two-sided-symmetric",
      );
    });
    expect(result.current.riskResults.pfa).toBeCloseTo(2.07, 2);
    expect(result.current.riskResults.pfr).toBeCloseTo(3.18, 2);
    const expected = vectors.cases.find(v => v.id === 'physical/pressure').expected;
    expect(result.current.riskResults.gbPfa).toBeCloseTo(expected.mitPfa * 100, 8);
    expect(result.current.riskResults.gbPfr).toBeCloseTo(expected.mitPfr * 100, 8);
    expect(result.current.riskResults.gbCalInt).toBeCloseTo(expected.gbInterval, 8);
    expect(result.current.riskResults.noGbCalInt).toBeCloseTo(expected.intInterval, 8);
  });

  test("routes a Type 2 asymmetric UUT through the Risk 8.0 engine", async () => {
    const asymmetricSession = {
      ...session,
      uncReq: {
        ...session.uncReq,
        reliability: 85,
        measRelCalcAssumed: 85,
      },
    };
    const tolerance = {
      reading: { high: 25, low: -5, unit: "%" },
    };
    const nominal = { value: 20, unit: "V" };
    const calcResults = {
      combined_uncertainty_absolute_base: 0.577357486,
      expanded_uncertainty_absolute_base: 1.13159879,
      calculatedNominalValue: null,
    };
    const { result } = renderHook(() =>
      useRiskCalculation(
        asymmetricSession,
        { uutTolerance: tolerance },
        tolerance,
        [],
        nominal,
        calcResults,
        "risk",
        vi.fn(),
      ),
    );

    await waitFor(() => {
      expect(result.current.riskResults?.riskMethod).toBe(
        "risk8-two-sided-asymmetric",
      );
    });
    expect(result.current.riskResults.pfa).toBeCloseTo(3.42, 1);
    expect(result.current.riskResults.pfr).toBeCloseTo(7.69, 1);
    expect(result.current.riskResults.gbResults.GBPFA).toBeCloseTo(2.005, 7);
  });

  test("calculates a direct 2 V point with a known ≥1 V lower limit", async () => {
    const tolerance = {
      singleSided: {
        direction: "low",
        measurement: "known",
        limit: 1,
        unit: "V",
      },
    };
    const testPointData = { uutTolerance: tolerance };
    const tmdeTolerances = [];
    const nominal = { value: 2, unit: "V" };
    const calcResults = {
      combined_uncertainty_absolute_base: 0.0101,
      expanded_uncertainty_absolute_base: 0.0202,
      calculatedNominalValue: null,
    };
    const onRiskResultsChange = vi.fn();
    const { result } = renderHook(() =>
      useRiskCalculation(
        session,
        testPointData,
        tolerance,
        tmdeTolerances,
        nominal,
        calcResults,
        "risk",
        onRiskResultsChange,
      ),
    );

    await waitFor(() => {
      expect(result.current.riskResults?.riskMethod).toBe(
        "risk8-single-sided-known",
      );
    });
    expect(result.current.riskResults.pfa).toBeTypeOf("number");
    expect(result.current.riskResults.pfr).toBeTypeOf("number");
    expect(result.current.riskResults.tur).toBeGreaterThan(40);
  });

  test("calculates two-sided risk for a negative derived result with %IV limits", async () => {
    const tolerance = {
      reading: {
        high: 1,
        low: -1,
        unit: "%",
        symmetric: true,
        distribution: "1.7320508075688772",
      },
    };
    const nominal = { value: 2 * Math.cos(3), unit: "W" };
    const calcResults = {
      combined_uncertainty_absolute_base: 0.01483,
      expanded_uncertainty_absolute_base: 0.02906,
      calculatedNominalValue: 2 * Math.cos(3),
    };
    const { result } = renderHook(() =>
      useRiskCalculation(
        session,
        { uutTolerance: tolerance },
        tolerance,
        [],
        nominal,
        calcResults,
        "risk",
        vi.fn(),
      ),
    );

    await waitFor(() => {
      expect(result.current.riskResults?.pfa).toBeTypeOf("number");
    });
    expect(result.current.riskResults.pfr).toBeTypeOf("number");
    expect(result.current.riskResults.tur).toBeGreaterThan(0);
    expect(result.current.riskInputs.LLow).toBeLessThan(
      result.current.riskInputs.LUp,
    );
  });

  test("a dismissed invalid-geometry warning stays dismissed", async () => {
    const onRiskResultsChange = vi.fn();
    const tolerance = {
      singleSided: {
        direction: "high",
        measurement: "known",
        limit: 1,
        unit: "V",
      },
    };
    const testPointData = { uutTolerance: tolerance };
    const tmdeTolerances = [];
    const nominal = { value: 2, unit: "V" };
    const calcResults = {
      combined_uncertainty_absolute_base: 0.01,
      expanded_uncertainty_absolute_base: 0.02,
      calculatedNominalValue: null,
    };
    const { result, rerender } = renderHook(() =>
      useRiskCalculation(
        session,
        testPointData,
        tolerance,
        tmdeTolerances,
        nominal,
        calcResults,
        "risk",
        onRiskResultsChange,
      ),
    );

    await waitFor(() => {
      expect(result.current.notification?.title).toBe(
        "Invalid Single-Sided Tolerance",
      );
    });

    act(() => result.current.dismissNotification());
    expect(result.current.notification).toBeNull();

    rerender();
    expect(result.current.notification).toBeNull();
  });
});
