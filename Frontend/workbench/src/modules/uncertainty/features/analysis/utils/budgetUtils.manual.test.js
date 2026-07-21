import { describe, test, expect } from "vitest";
import {
  getBudgetComponentsFromTolerance,
  getUutResolutionComponent,
  refreshLinkedTypeBComponents,
} from "./budgetUtils";
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
    // Persisted "1.732" is calculated as exact √3, matching Risk 8.0.
    expect(mc.value).toBeCloseTo((0.001 / Math.sqrt(3) / 10) * 1e6, 8);
    expect(mc.value_native).toBeCloseTo(0.001 / Math.sqrt(3), 12);
  });

  test("resolves the canonical inline tolerance shape for Type B components", () => {
    const comps = getBudgetComponentsFromTolerance(
      {
        name: "UUT",
      },
      ref,
      [
        {
            id: "structured",
            name: "Cal cert",
            inputMode: "tolerance",
            tolerance: {
              floor: {
                high: "0.001",
                low: "-0.001",
                unit: "psig",
                distribution: "1.732",
                symmetric: true,
              },
            },
        },
      ],
    );

    expect(comps).toHaveLength(1);
    expect(comps[0].value_native).toBeCloseTo(0.001 / Math.sqrt(3), 12);
    expect(comps[0].manualInputMode).toBe("tolerance");
    expect(comps[0].manualRawValue.floor.high).toBe("0.001");
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

  test("only includes scoped instrument Type B components for the active function/range", () => {
    const components = [
      {
        id: "function-match",
        name: "Pressure head",
        scope: "function",
        functionId: "pressure",
        unit: "psig",
        inputMode: "tolerance",
        toleranceLimit: "0.001",
        distribution: "1.732",
      },
      {
        id: "range-miss",
        name: "Other range",
        scope: "range",
        functionId: "pressure",
        rangeId: "r-2",
        unit: "psig",
        inputMode: "tolerance",
        toleranceLimit: "0.001",
        distribution: "1.732",
      },
    ];

    const resolved = getBudgetComponentsFromTolerance(
      { name: "TMDE", functionId: "pressure", rangeId: "r-1" },
      ref,
      components,
    );

    expect(resolved.map((component) => component.manualSourceId)).toEqual([
      "function-match",
    ]);
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

// Instrument-level associated Type B components (e.g. head pressure on a
// pressure gage) are passed as the 3rd argument and resolved with the same math
// as per-range manual components, but tagged fromInstrument so they can be
// distinguished. They are opted into the budget explicitly (addBudgetTypeB),
// which resolves them through this same path.
describe("getBudgetComponentsFromTolerance - instrument-associated Type B", () => {
  const ref = { value: "10", unit: "psig" };

  test("associated Type B resolves alongside per-range accuracy", () => {
    const comps = getBudgetComponentsFromTolerance(
      {
        name: "Gage",
        reading: { high: "0.1", low: "-0.1", unit: "%", distribution: "1.732" },
      },
      ref,
      [
        {
          id: "hp1",
          name: "Head Pressure",
          unit: "psig",
          inputMode: "tolerance",
          toleranceLimit: "0.001",
          distribution: "1.732",
        },
      ],
    );
    const accuracy = comps.find((c) => c.name === "Gage - Accuracy");
    const typeB = comps.find((c) => c.fromInstrument);
    expect(accuracy).toBeTruthy();
    expect(typeB).toBeTruthy();
    expect(typeB.name).toBe("Gage - Head Pressure");
    expect(typeB.type).toBe("B");
    expect(typeB.isManual).toBe(true);
    expect(typeB.id).toContain("instrTypeB");
    // 0.001 psig / 1.732 = 5.774e-4 psig; relative to 10 psig = 57.74 ppm
    expect(typeB.value).toBeCloseTo(57.737, 2);
  });

  test("no associated Type B when none are provided", () => {
    const comps = getBudgetComponentsFromTolerance(
      { name: "Gage", reading: { high: "0.1", low: "-0.1", unit: "%", distribution: "1.732" } },
      ref,
    );
    expect(comps.some((c) => c.fromInstrument)).toBe(false);
  });

  test("associated Type B supports rectangular resolution divisor", () => {
    const comps = getBudgetComponentsFromTolerance(
      { name: "Gage" },
      ref,
      [
        {
          id: "res-typeb",
          name: "Display Resolution",
          unit: "psig",
          inputMode: "tolerance",
          toleranceLimit: "0.003464",
          distribution: "3.464",
        },
      ],
    );
    const typeB = comps.find((c) => c.fromInstrument);
    expect(typeB.distribution).toBe("Rectangular (resolution)");
    expect(typeB.distributionDivisor).toBe("3.464");
    expect(typeB.value_native).toBeCloseTo(0.003464 / Math.sqrt(12), 12);
  });

  test("resolution supports the triangular full-LSD divisor", () => {
    const comps = getBudgetComponentsFromTolerance(
      {
        name: "UUT",
        includeResolutionInBudget: true,
        resolution: "0.003",
        resolutionUnit: "psig",
        resolutionDistribution: "4.899",
      },
      ref,
    );
    const resolution = comps.find((c) => c.isResolution);
    expect(resolution.distribution).toBe("Triangular (resolution)");
    expect(resolution.distributionDivisor).toBe("4.899");
    expect(resolution.value_native).toBeCloseTo(0.003 / Math.sqrt(24), 12);
  });

  test("resolution-specific rectangular divisor uses the full LSD once", () => {
    const resolution = getUutResolutionComponent(
      {
        includeResolutionInBudget: true,
        measuringResolution: "0.01",
        measuringResolutionUnit: "psig",
        measuringResolutionDistribution: "3.464",
      },
      ref,
    );

    expect(resolution.distribution).toBe("Rectangular (resolution)");
    expect(resolution.value_native).toBeCloseTo(0.01 / Math.sqrt(12), 12);
  });
});

describe("refreshLinkedTypeBComponents", () => {
  const ref = { value: "10", unit: "psig" };

  test("refreshes a stored budget Type B from the live instrument definition", () => {
    const refreshed = refreshLinkedTypeBComponents({
      components: [
        {
          id: "budget-typeb",
          name: "Head Pressure",
          type: "B",
          value: 57.737,
          value_native: 5.7737e-4,
          unit_native: "psig",
          distribution: "Rectangular",
          typeBSourceId: "hp1",
          typeBSourceTmdeId: "tmde-instance-1",
          sourcePointLabel: "Head Pressure",
          originalInput: {
            inputMode: "tolerance",
            toleranceLimit: "0.001",
            errorDistributionDivisor: "1.732",
            unit: "psig",
          },
        },
      ],
      tmdeTolerances: [
        {
          id: "tmde-instance-1",
          sourceId: "tmde-master-1",
        },
      ],
      sessionTmdes: [
        {
          id: "tmde-master-1",
          instrument: {
            typeBComponents: [
              {
                id: "hp1",
                name: "Nozzle Pressure",
                unit: "psig",
                inputMode: "tolerance",
                toleranceLimit: "0.002",
                distribution: "1.732",
              },
            ],
          },
        },
      ],
      getReferencePoint: () => ref,
    });

    expect(refreshed[0].name).toBe("Nozzle Pressure");
    expect(refreshed[0].sourcePointLabel).toBe("Nozzle Pressure");
    expect(refreshed[0].originalInput.toleranceLimit).toBe("0.002");
    expect(refreshed[0].value_native).toBeCloseTo(0.0011547, 7);
    expect(refreshed[0].value).toBeCloseTo(115.47, 2);
  });

  test("drops a linked budget Type B when the live instrument no longer has it", () => {
    const refreshed = refreshLinkedTypeBComponents({
      components: [
        {
          id: "budget-typeb",
          name: "Head Pressure",
          typeBSourceId: "hp1",
          typeBSourceTmdeId: "tmde-instance-1",
        },
      ],
      tmdeTolerances: [
        {
          id: "tmde-instance-1",
          sourceId: "tmde-master-1",
        },
      ],
      sessionTmdes: [
        {
          id: "tmde-master-1",
          instrument: {
            typeBComponents: [],
          },
        },
      ],
      getReferencePoint: () => ref,
    });

    expect(refreshed).toEqual([]);
  });

  test("recovers an instrument Type B link lost by an older backend round-trip", () => {
    const refreshed = refreshLinkedTypeBComponents({
      components: [
        {
          id: "budget-typeb",
          name: "Nozzle Pressure",
          type: "B",
          value: 115.47,
          value_native: 0.0011547,
          unit_native: "psig",
          distribution: "Rectangular",
          originalInput: {
            inputMode: "tolerance",
            toleranceLimit: "0.002",
            errorDistributionDivisor: "1.732",
            unit: "psig",
          },
        },
      ],
      tmdeTolerances: [
        {
          id: "tmde-instance-1",
          sourceId: "tmde-master-1",
        },
      ],
      sessionTmdes: [
        {
          id: "tmde-master-1",
          instrument: {
            typeBComponents: [
              {
                id: "hp1",
                name: "Nozzle Pressure",
                unit: "psig",
                inputMode: "tolerance",
                toleranceLimit: "0.002",
                distribution: "1.732",
              },
            ],
          },
        },
      ],
      getReferencePoint: () => ref,
    });

    expect(refreshed[0].typeBSourceId).toBe("hp1");
    expect(refreshed[0].typeBSourceTmdeId).toBe("tmde-instance-1");
    expect(refreshed[0].name).toBe("Nozzle Pressure");
    expect(refreshed[0].originalInput.errorDistributionDivisor).toBe("1.732");
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
