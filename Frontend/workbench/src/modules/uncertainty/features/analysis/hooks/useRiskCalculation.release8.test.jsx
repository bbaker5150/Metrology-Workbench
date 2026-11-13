import { renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useRiskCalculation } from "./useRiskCalculation";
import { unitSystem } from "../../../utils/uncertaintyMath";

// Final 8.00 MAIN row 5: use stored uncertainties, not the app's own calculation
// as an oracle. The hook must refresh the complete recommendation after a UUT
// resolution edit and clear it when no physical acceptance band remains.
test("selected flowmeter refreshes and clears V8 risk when its resolution changes", async () => {
  const session = {
    uncReq: {
      reliability: 85, measRelCalcAssumed: 85, reqPFA: 2,
      neededTUR: 4, calInt: 18, uncertaintyConfidence: 95,
    },
  };
  const nominal = { value: 160, unit: "gpm" };
  const tolerance = {
    floor: { high: 0.4, low: -0.4, unit: "gpm", symmetric: true },
    measuringResolution: 0.1,
    measuringResolutionUnit: "gpm",
  };
  const point = { id: "flowmeter", uutTolerance: tolerance };
  const tmde = [];
  const calc = {
    combined_uncertainty_absolute_base: unitSystem.toBaseUnit(0.15878570727031235, "gpm"),
    expanded_uncertainty_absolute_base: unitSystem.toBaseUnit(0.31121426750953196, "gpm"),
    calculatedNominalValue: null,
  };
  const changed = vi.fn();
  const { result, rerender } = renderHook(({ currentPoint, currentTolerance }) =>
    useRiskCalculation(session, currentPoint, currentTolerance, tmde, nominal, calc, "risk", changed),
    { initialProps: { currentPoint: point, currentTolerance: tolerance } },
  );
  await waitFor(() => expect(result.current.riskResults?.gbCalInt).toBeCloseTo(4.421331946491825, 6));
  expect(result.current.riskResults.gbObservedReop).toBeCloseTo(85, 8);
  expect(result.current.riskResults.gbMult).toBeCloseTo(75, 8);

  const continuous = { ...tolerance, measuringResolution: 0 };
  rerender({ currentPoint: { ...point, uutTolerance: continuous }, currentTolerance: continuous });
  await waitFor(() => expect(result.current.riskResults?.gbCalInt).toBeGreaterThan(11));

  const collapsed = { ...tolerance, measuringResolution: 1 };
  rerender({ currentPoint: { ...point, uutTolerance: collapsed }, currentTolerance: collapsed });
  await waitFor(() => expect(result.current.riskResults).toBeNull());
  expect(changed).toHaveBeenLastCalledWith(null);
  expect(result.current.notification?.title).toBe("Invalid Tolerance Limits");

  rerender({ currentPoint: point, currentTolerance: tolerance });
  await waitFor(() => expect(result.current.riskResults?.gbCalInt).toBeCloseTo(4.421331946491825, 6));
  expect(result.current.notification).toBeNull();
});

test.each(["low", "high"])("selected %s limit uses the same converted and rounded geometry as MAIN", async direction => {
  const session = { uncReq: { reliability: 85, measRelCalcAssumed: 85, reqPFA: 2, neededTUR: 4, calInt: 18 } };
  const nominal = { value: 10, unit: "V" };
  const tolerance = {
    singleSided: { direction, limit: direction === "low" ? 9050 : 10950, unit: "mV", measurement: "known" },
    measuringResolution: 100, measuringResolutionUnit: "mV",
  };
  const point = { id: "single", uutTolerance: tolerance };
  const tmde = [];
  const calc = { combined_uncertainty_absolute_base: 0.1, expanded_uncertainty_absolute_base: 0.2, calculatedNominalValue: null };
  const changed = vi.fn();
  const { result } = renderHook(() => useRiskCalculation(session, point, tolerance, tmde, nominal, calc, "risk", changed));
  await waitFor(() => expect(result.current.riskResults?.riskMethod).toBe("risk8-single-sided-known"));
  const expected = direction === "low" ? 9.1 : 10.9;
  expect(Number(direction === "low" ? result.current.riskInputs.LLow : result.current.riskInputs.LUp)).toBeCloseTo(expected, 12);
  expect(result.current.riskResults.tur).toBeCloseTo(4.5, 12);
  const input = result.current.riskResults.risk8.input;
  expect(Number(direction === "low" ? input.lowerLimit : input.upperLimit)).toBeCloseTo(expected, 12);
});
