import { describe, expect, it } from "vitest";
import {
  getRemainingCutPoints,
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
});

describe("getRemainingCutPoints", () => {
  it("removes moved points while retaining rejected points", () => {
    const clipboard = [{ id: "point-1" }, { id: "point-2" }];

    expect(getRemainingCutPoints(clipboard, [{ id: "point-1" }])).toEqual([
      { id: "point-2" },
    ]);
  });
});
