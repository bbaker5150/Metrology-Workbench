import { describe, it, expect } from "vitest";
import {
  reconcileTmdeInstances,
  refreshTmdeInstancesFromMasters,
  tmdeInstancesNeedReconcile,
  masterIdOf,
} from "./tmdeReconcile";

const masters = [{ id: "weight" }, { id: "length" }];

describe("reconcileTmdeInstances", () => {
  it("keeps a clean single-instance set untouched", () => {
    const tols = [
      { id: "weight", sourceId: "weight", variableType: "Weight" },
      { id: "length", sourceId: "length", variableType: "Length" },
    ];
    expect(reconcileTmdeInstances(tols, masters)).toHaveLength(2);
    expect(tmdeInstancesNeedReconcile(tols, masters)).toBe(false);
  });

  it("drops orphaned instances whose master no longer exists (the 6x bug)", () => {
    const tols = [
      { id: "weight", sourceId: "weight", variableType: "Weight" },
      { id: "length", sourceId: "length", variableType: "Length" },
      // Five stray weight instances left behind by a deleted/re-created master.
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `ghost-${i}`,
        sourceId: "deleted-weight",
        variableType: "Weight",
      })),
    ];
    const out = reconcileTmdeInstances(tols, masters);
    expect(out).toHaveLength(2);
    expect(out.map((t) => t.variableType).sort()).toEqual(["Length", "Weight"]);
    expect(tmdeInstancesNeedReconcile(tols, masters)).toBe(true);
  });

  it("collapses duplicate instances of the SAME master and variable (no stacking)", () => {
    const tols = [
      { id: "weight", sourceId: "weight", variableType: "Weight" },
      { id: "weight", sourceId: "weight", variableType: "Weight" },
      { id: "weight", sourceId: "weight", variableType: "Weight" },
    ];
    expect(reconcileTmdeInstances(tols, masters)).toHaveLength(1);
  });

  it("preserves the same master assigned to separate derived variables", () => {
    const tols = [
      { id: "weight::A", sourceId: "weight", variableType: "A" },
      { id: "weight::B", sourceId: "weight", variableType: "B" },
      { id: "length", sourceId: "length", variableType: "Length" },
    ];
    const out = reconcileTmdeInstances(tols, masters);
    expect(out).toHaveLength(3);
    expect(out.map((t) => t.variableType).sort()).toEqual(["A", "B", "Length"]);
    expect(tmdeInstancesNeedReconcile(tols, masters)).toBe(false);
  });

  it("preserves DISTINCT masters mapped to one variable (additive composition)", () => {
    const additiveMasters = [{ id: "w1" }, { id: "w2" }, { id: "len" }];
    const tols = [
      { id: "w1", sourceId: "w1", variableType: "Weight" },
      { id: "w2", sourceId: "w2", variableType: "Weight" }, // second deadweight
      { id: "len", sourceId: "len", variableType: "Length" },
    ];
    const out = reconcileTmdeInstances(tols, additiveMasters);
    expect(out).toHaveLength(3);
  });

  it("keeps instances (de-duped) when EVERY one looks orphaned (id-scheme mismatch)", () => {
    // Instances linked to their masters by a scheme the masters don't share
    // (e.g. a fixture without sourceId, numeric ids vs slug masters). This is a
    // mismatch, not genuine deletion — wiping the whole budget (zeroing its
    // uncertainty + risk) would be wrong, so all distinct instances are kept.
    const slugMasters = [{ id: "tmde_beam" }, { id: "tmde_weight" }];
    const tols = [
      { id: 1749465600161, variableType: "Length" },
      { id: 1749465600162, variableType: "Weight" },
      { id: 1749465600162, variableType: "Weight" }, // stacked dup still collapses
    ];
    const out = reconcileTmdeInstances(tols, slugMasters);
    expect(out).toHaveLength(2);
    expect(out.map((t) => t.variableType).sort()).toEqual(["Length", "Weight"]);
  });

  it("is a no-op when the master list is unknown (still loading)", () => {
    const tols = [{ id: "weight", sourceId: "weight" }];
    expect(reconcileTmdeInstances(tols, [])).toHaveLength(1);
    expect(reconcileTmdeInstances(tols, undefined)).toHaveLength(1);
  });

  it("handles non-array / empty input safely", () => {
    expect(reconcileTmdeInstances(null, masters)).toEqual([]);
    expect(reconcileTmdeInstances(undefined, masters)).toEqual([]);
    expect(reconcileTmdeInstances([], masters)).toEqual([]);
  });

  it("masterIdOf prefers sourceId, falls back to id", () => {
    expect(masterIdOf({ id: "a", sourceId: "b" })).toBe("b");
    expect(masterIdOf({ id: "a" })).toBe("a");
    expect(masterIdOf(null)).toBeUndefined();
  });
});

describe("refreshTmdeInstancesFromMasters", () => {
  it("refreshes a point snapshot from the live master range", () => {
    const pointInstances = [
      {
        id: "tmde-1",
        sourceId: "tmde-1",
        name: "Old Pressure Gage",
        functionName: "Pressure",
        rangeId: "range-1",
        reading: { toleranceLimit: "0.001", distribution: "1.732" },
        tolerance: {
          reading: { toleranceLimit: "0.001", distribution: "1.732" },
        },
        measurementPoint: { value: "100", unit: "psi" },
        quantity: 2,
      },
    ];
    const masterTmdes = [
      {
        id: "tmde-1",
        name: "Nozzle Pressure Gage",
        instrument: {
          manufacturer: "Acme",
          model: "P100",
          functions: [
            {
              id: "fn-pressure",
              name: "Pressure",
              unit: "psi",
              ranges: [
                {
                  id: "range-1",
                  min: "0",
                  max: "100",
                  unit: "psi",
                  tolerances: {
                    reading: {
                      toleranceLimit: "0.002",
                      distribution: "1.960",
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    ];

    const refreshed = refreshTmdeInstancesFromMasters(
      pointInstances,
      masterTmdes,
    );

    expect(refreshed[0].name).toBe("Nozzle Pressure Gage");
    expect(refreshed[0].reading.toleranceLimit).toBe("0.002");
    expect(refreshed[0].reading.distribution).toBe("1.960");
    expect(refreshed[0].tolerance.reading.toleranceLimit).toBe("0.002");
    expect(refreshed[0].measurementPoint).toEqual({ value: "100", unit: "psi" });
    expect(refreshed[0].quantity).toBe(2);
    expect(refreshed[0].id).toBe("tmde-1");
    expect(refreshed[0].sourceId).toBe("tmde-1");
  });

  it("preserves point-level resolution opt-ins while refreshing the master spec", () => {
    const refreshed = refreshTmdeInstancesFromMasters(
      [
        {
          id: "tmde-1",
          sourceId: "tmde-1",
          functionName: "Voltage",
          includeResolutionInBudget: true,
          measuringResolutionDistribution: "3.464",
        },
      ],
      [
        {
          id: "tmde-1",
          instrument: {
            functions: [
              {
                name: "Voltage",
                unit: "V",
                ranges: [
                  {
                    id: "v-range",
                    tolerances: {
                      reading: { toleranceLimit: "0.01" },
                      measuringResolution: "0.001",
                      measuringResolutionDistribution: "1.732",
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    );

    expect(refreshed[0].includeResolutionInBudget).toBe(true);
    expect(refreshed[0].tolerance.includeResolutionInBudget).toBe(true);
    expect(refreshed[0].measuringResolutionDistribution).toBe("3.464");
    expect(refreshed[0].tolerance.measuringResolutionDistribution).toBe("3.464");
    expect(refreshed[0].reading.toleranceLimit).toBe("0.01");
  });
});
