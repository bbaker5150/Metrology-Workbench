import { describe, test, expect } from "vitest";
import { getBudgetComponentsFromTolerance } from "./budgetUtils";
import { DISTRIBUTION_NOT_SET } from "../../../utils/uncertaintyMath";

// Manual Type B components authored in the instrument builder are stored on
// tolerance.manualComponents and resolved into the budget against the point's
// nominal at budget time (so a reused instrument range scales correctly).
describe("getBudgetComponentsFromTolerance - manual Type B components", () => {
  const ref = { value: "10", unit: "psig" };

  test("absolute tolerance limit is divided by the distribution divisor", () => {
    const comps = getBudgetComponentsFromTolerance(
      {
        name: "UUT",
        manualComponents: [
          {
            id: "m1",
            name: "Cal Cert",
            unit: "psig",
            inputMode: "tolerance",
            toleranceLimit: "0.001",
            distribution: "1.732",
          },
        ],
      },
      ref,
    );
    const mc = comps.find((c) => c.isManual);
    expect(mc).toBeTruthy();
    expect(mc.name).toBe("UUT - Cal Cert");
    expect(mc.type).toBe("B");
    expect(mc.dof).toBe(Infinity);
    // 0.001 psig / 1.732 = 5.774e-4 psig of u_i; relative to 10 psig = 57.74 ppm
    expect(mc.value).toBeCloseTo(57.737, 2);
    expect(mc.value_native).toBeCloseTo(5.7737e-4, 7);
  });

  test("relative standard uncertainty is used directly (divisor 1)", () => {
    const comps = getBudgetComponentsFromTolerance(
      {
        name: "UUT",
        manualComponents: [
          {
            id: "m2",
            name: "Drift",
            unit: "%",
            inputMode: "standard",
            standardUncertainty: "0.05",
          },
        ],
      },
      ref,
    );
    const mc = comps.find((c) => c.isManual);
    // 0.05% of reading entered as a standard uncertainty -> 500 ppm
    expect(mc.value).toBeCloseTo(500, 3);
  });

  test("incomplete or non-positive components are skipped", () => {
    const comps = getBudgetComponentsFromTolerance(
      {
        name: "UUT",
        manualComponents: [
          { id: "a", name: "blank", unit: "psig", inputMode: "tolerance" },
          {
            id: "b",
            name: "zero",
            unit: "psig",
            inputMode: "tolerance",
            toleranceLimit: "0",
            distribution: "1.732",
          },
        ],
      },
      ref,
    );
    expect(comps.filter((c) => c.isManual)).toHaveLength(0);
  });

  test("not-set manual distribution is preserved as unresolved", () => {
    const comps = getBudgetComponentsFromTolerance(
      {
        name: "UUT",
        manualComponents: [
          {
            id: "m3",
            name: "Unvalidated",
            unit: "psig",
            inputMode: "tolerance",
            toleranceLimit: "0.001",
            distribution: DISTRIBUTION_NOT_SET,
          },
        ],
      },
      ref,
    );
    const mc = comps.find((c) => c.isManual);
    expect(mc.distribution).toBe("Not Set");
    expect(mc.distributionDivisor).toBe(DISTRIBUTION_NOT_SET);
    expect(Number.isNaN(mc.value)).toBe(true);
    expect(Number.isNaN(mc.value_native)).toBe(true);
  });
});

describe("getBudgetComponentsFromTolerance - unvalidated distribution", () => {
  const ref = { value: "10", unit: "V" };

  test("not-set accuracy distribution does not calculate as rectangular", () => {
    const comps = getBudgetComponentsFromTolerance(
      {
        name: "DMM",
        reading: {
          high: "0.1",
          low: "-0.1",
          unit: "%",
          distribution: DISTRIBUTION_NOT_SET,
          symmetric: true,
        },
      },
      ref,
    );
    const accuracy = comps.find((c) => c.name === "DMM - Accuracy");
    expect(accuracy.distribution).toBe("Not Set");
    expect(accuracy.distributionDivisor).toBe(DISTRIBUTION_NOT_SET);
    expect(Number.isNaN(accuracy.value)).toBe(true);
    expect(Number.isNaN(accuracy.value_native)).toBe(true);
  });
});

// Resolution joins the budget as a rectangular Type B component, u = LSD/(2*√3),
// and is RSS'd with the other components by the calculation hook.
describe("getBudgetComponentsFromTolerance - resolution component", () => {
  const ref = { value: "10", unit: "psig" };

  test("inline `resolution` + opt-in yields u = LSD/(2*sqrt(3))", () => {
    const comps = getBudgetComponentsFromTolerance(
      {
        name: "UUT",
        resolution: "0.01",
        resolutionUnit: "psig",
        includeResolutionInBudget: true,
      },
      ref,
    );
    const res = comps.find((c) => c.isResolution);
    expect(res).toBeTruthy();
    expect(res.name).toBe("UUT - Resolution");
    expect(res.type).toBe("B");
    expect(res.dof).toBe(Infinity);
    // u = 0.01 / 2 / sqrt(3) = 0.0028868 psig; relative to 10 psig = 288.68 ppm
    expect(res.value_native).toBeCloseTo(0.0028868, 6);
    expect(res.value).toBeCloseTo(288.68, 1);
  });

  test("no resolution component unless opted in", () => {
    const comps = getBudgetComponentsFromTolerance(
      { name: "UUT", resolution: "0.01", resolutionUnit: "psig" },
      ref,
    );
    expect(comps.find((c) => c.isResolution)).toBeFalsy();
  });

  test("measuringResolution is still honored and wins over resolution", () => {
    const comps = getBudgetComponentsFromTolerance(
      {
        name: "TMDE",
        resolution: "0.01",
        measuringResolution: "0.02",
        measuringResolutionUnit: "psig",
        includeResolutionInBudget: true,
      },
      ref,
    );
    const res = comps.find((c) => c.isResolution);
    // 0.02 / 2 / sqrt(3) = 0.0057735 psig
    expect(res.value_native).toBeCloseTo(0.0057735, 6);
  });
});
