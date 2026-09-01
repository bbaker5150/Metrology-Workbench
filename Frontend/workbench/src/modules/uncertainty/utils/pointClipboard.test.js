import { describe, expect, it } from "vitest";
import {
  getRemainingCutPoints,
  hasDerivedNominalMismatch,
  preparePointForPaste,
} from "./pointClipboard";

const point = {
  id: "point-1",
  measurementAreaId: "area-1",
  associatedUutIds: ["uut-1"],
  uutTolerance: { max: 10 },
};

describe("preparePointForPaste", () => {
  it("removes the ID when copying a point", () => {
    expect(
      preparePointForPaste(point, {
        mode: "copy",
        targetUutId: "uut-2",
        targetAreaId: "area-2",
        targetTolerance: { max: 100 },
      }),
    ).toEqual({
      measurementAreaId: "area-2",
      associatedUutIds: ["uut-2"],
      uutTolerance: { max: 100 },
      is_detailed_uncertainty_calculated: false,
    });
  });

  it("preserves the ID when cutting a point", () => {
    expect(
      preparePointForPaste(point, {
        mode: "cut",
        targetUutId: "uut-2",
        targetAreaId: "area-2",
        targetTolerance: { max: 100 },
      }),
    ).toEqual({
      id: "point-1",
      measurementAreaId: "area-2",
      associatedUutIds: ["uut-2"],
      uutTolerance: { max: 100 },
      is_detailed_uncertainty_calculated: false,
    });
  });

  it("clears cached calculation results so the paste recomputes", () => {
    const calculatedPoint = {
      ...point,
      is_detailed_uncertainty_calculated: true,
      calculatedNominalValue: 42,
      calculatedBudgetComponents: [{ id: "c1" }],
      calculatedBudgetGroups: [{ id: "g1" }],
      combined_uncertainty: 1.2,
      expanded_uncertainty: 2.4,
      k_value: 2,
      effective_dof: 10,
      secondOrder: { u: 0.1 },
    };

    const prepared = preparePointForPaste(calculatedPoint, {
      mode: "copy",
      targetUutId: "uut-2",
      targetAreaId: "area-2",
      targetTolerance: { max: 100 },
    });

    expect(prepared.is_detailed_uncertainty_calculated).toBe(false);
    expect(prepared).not.toHaveProperty("calculatedNominalValue");
    expect(prepared).not.toHaveProperty("calculatedBudgetComponents");
    expect(prepared).not.toHaveProperty("calculatedBudgetGroups");
    expect(prepared).not.toHaveProperty("combined_uncertainty");
    expect(prepared).not.toHaveProperty("expanded_uncertainty");
    expect(prepared).not.toHaveProperty("k_value");
    expect(prepared).not.toHaveProperty("effective_dof");
    expect(prepared).not.toHaveProperty("secondOrder");
  });

  it("preserves the copied point's resolution budget settings", () => {
    const sourcePoint = {
      ...point,
      uutTolerance: {
        max: 10,
        includeResolutionInBudget: true,
        measuringResolution: "0.001",
        measuringResolutionUnit: "V",
        measuringResolutionDistribution: "1.732",
      },
    };

    expect(
      preparePointForPaste(sourcePoint, {
        mode: "copy",
        targetUutId: "uut-2",
        targetAreaId: "area-2",
        targetTolerance: {
          max: 100,
          measuringResolution: "0.01",
          measuringResolutionUnit: "V",
        },
      }).uutTolerance,
    ).toEqual({
      max: 100,
      includeResolutionInBudget: true,
      measuringResolution: "0.01",
      measuringResolutionUnit: "V",
      measuringResolutionDistribution: "1.732",
    });
  });

  it("keeps the source tolerance when paste cannot resolve a target range", () => {
    const sourcePoint = {
      ...point,
      uutTolerance: {
        max: 10,
        includeResolutionInBudget: true,
        measuringResolution: "0.001",
      },
    };

    expect(
      preparePointForPaste(sourcePoint, {
        mode: "copy",
        targetUutId: "uut-2",
        targetAreaId: "area-2",
        targetTolerance: null,
      }).uutTolerance,
    ).toEqual({
      max: 10,
      includeResolutionInBudget: true,
      measuringResolution: "0.001",
    });
  });
});

describe("getRemainingCutPoints", () => {
  it("removes moved points while retaining rejected points", () => {
    const clipboard = [{ id: "point-1" }, { id: "point-2" }];

    expect(getRemainingCutPoints(clipboard, [{ id: "point-1" }])).toEqual([
      { id: "point-2" },
    ]);
  });
});

describe("hasDerivedNominalMismatch", () => {
  const derivedPoint = {
    measurementType: "derived",
    equationString: "A + B",
    variableMappings: { A: "Input A", B: "Input B" },
    variableNominals: {
      A: { value: "3", unit: "V" },
      B: { value: "5", unit: "V" },
    },
    tmdeTolerances: [],
    testPointInfo: { parameter: { value: "8", unit: "V" } },
  };

  it("accepts a derived point whose inputs equal its nominal", () => {
    expect(hasDerivedNominalMismatch(derivedPoint)).toBe(false);
  });

  it("warns when a pasted derived point's inputs do not equal its nominal", () => {
    expect(
      hasDerivedNominalMismatch({
        ...derivedPoint,
        testPointInfo: { parameter: { value: "6", unit: "V" } },
      }),
    ).toBe(true);
  });

  it("ignores direct points and incomplete derived inputs", () => {
    expect(
      hasDerivedNominalMismatch({ ...derivedPoint, measurementType: "direct" }),
    ).toBe(false);
    expect(
      hasDerivedNominalMismatch({
        ...derivedPoint,
        variableNominals: { A: { value: "3", unit: "V" } },
      }),
    ).toBe(false);
  });
});
