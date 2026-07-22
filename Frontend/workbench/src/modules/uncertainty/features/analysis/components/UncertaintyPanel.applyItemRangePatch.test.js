import { describe, expect, it } from "vitest";
import {
  applyItemRangeFunction,
  applyItemRangePatch,
  applyRangeUnitChange,
  countTmdeBudgetUses,
  incrementDirectTmdeBudgetQuantity,
  getTmdeAccuracyReadiness,
  getItemRangeTolerance,
  rangeIdOf,
} from "./UncertaintyPanel";
import { refreshTmdeInstancesFromMasters } from "../../../utils/tmdeReconcile";
import { getBudgetComponentsFromTolerance } from "../utils/budgetUtils";

// A freshly added inline instrument has `functions: []`, so its row renders a
// synthetic { id: "default" } range. Editing the unit/min/max/resolution must
// materialize a real range instead of being silently dropped.
describe("applyItemRangePatch on a new instrument with no ranges", () => {
  const newInstrument = () => ({
    id: "uut-1",
    instrument: { id: "inst-1", manufacturer: "", model: "", functions: [] },
  });

  it("materializes a range carrying a unit edit", () => {
    const patched = applyItemRangePatch(newInstrument(), "default", {
      unit: "SCCM",
    });
    const ranges = patched.instrument.functions.flatMap((fn) => fn.ranges);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].unit).toBe("SCCM");
    expect(ranges[0].id).toBeTruthy();
    expect(ranges[0].id).not.toBe("default");
  });

  it("materializes a range carrying a bound edit", () => {
    const patched = applyItemRangePatch(newInstrument(), "default", {
      min: "0",
    });
    const ranges = patched.instrument.functions.flatMap((fn) => fn.ranges);
    expect(ranges[0].min).toBe("0");
  });

  it("still routes a pure tolerance edit to the flat tolerance home", () => {
    const tol = { floor: { high: "1" } };
    const patched = applyItemRangePatch(newInstrument(), "default", {
      tolerances: tol,
    });
    expect(patched.tolerance).toEqual(tol);
    expect(patched.instrument.functions).toHaveLength(0);
  });

  it("patches in place when a real matching range exists", () => {
    const item = {
      id: "uut-2",
      instrument: {
        functions: [{ id: "fn1", unit: "V", ranges: [{ id: "r1", unit: "V" }] }],
      },
    };
    const patched = applyItemRangePatch(item, "r1", { unit: "mV" });
    expect(patched.instrument.functions[0].ranges[0].unit).toBe("mV");
    // No extra range was created.
    expect(patched.instrument.functions[0].ranges).toHaveLength(1);
  });

  it("keeps absolute tolerance terms synchronized with a changed range unit", () => {
    const item = {
      id: "uut-length",
      instrument: {
        functions: [
          {
            id: "fn-length",
            unit: "in",
            ranges: [
              {
                id: "r-length",
                unit: "in",
                tolerances: {
                  reading: { high: "1", low: "-1", unit: "%" },
                  range: { high: "0.5", low: "-0.5", unit: "%" },
                  floor: { high: "0.01", low: "-0.01", unit: "in" },
                  singleSided: { limit: "10", unit: "in" },
                  db: { high: "1", low: "-1" },
                },
              },
            ],
          },
        ],
      },
    };

    const patched = applyRangeUnitChange(item, "r-length", "ft");
    const [range] = patched.instrument.functions[0].ranges;
    expect(range.unit).toBe("ft");
    expect(range.tolerances.floor.unit).toBe("ft");
    expect(range.tolerances.singleSided.unit).toBe("ft");
    expect(range.tolerances.reading.unit).toBe("%");
    expect(range.tolerances.range.unit).toBe("%");
    expect(range.tolerances.db).not.toHaveProperty("unit");
  });

  it("materializes a unit-only unbounded range while synchronizing its flat tolerance", () => {
    const item = {
      id: "uut-unbounded-length",
      tolerance: {
        floor: { high: "0.01", low: "-0.01", unit: "in" },
      },
      instrument: {
        functions: [{ id: "fn-length", name: "Length", unit: "in", ranges: [] }],
      },
    };

    const patched = applyRangeUnitChange(item, "default", "ft");
    const [range] = patched.instrument.functions[0].ranges;
    expect(range).toMatchObject({ min: "", max: "", unit: "ft" });
    expect(range.tolerances.floor.unit).toBe("ft");
  });

  it("stores a function tolerance on an unbounded range for all values", () => {
    const item = {
      id: "uut-unbounded",
      instrument: {
        functions: [{ id: "fn-voltage", name: "Voltage", unit: "V", ranges: [] }],
      },
    };
    const tolerance = {
      reading: { high: "1", low: "-1", unit: "%", distribution: "1.732" },
    };

    const patched = applyItemRangePatch(item, "default", {
      tolerances: tolerance,
    });
    const [range] = patched.instrument.functions[0].ranges;

    expect(range).toMatchObject({ min: "", max: "", unit: "V" });
    expect(getItemRangeTolerance(patched, range.id)).toEqual(tolerance);
  });

  it("reads and patches legacy ranges identified by rangeId", () => {
    const item = {
      id: "tmde-legacy-range",
      instrument: {
        functions: [
          {
            id: "fn1",
            unit: "lb",
            ranges: [
              {
                rangeId: "legacy-r1",
                min: 0,
                max: 10,
                tolerances: {
                  reading: { high: "1", low: "-1", distribution: "1.732" },
                },
              },
            ],
          },
        ],
      },
    };

    expect(rangeIdOf(item.instrument.functions[0].ranges[0])).toBe("legacy-r1");
    expect(getItemRangeTolerance(item, "legacy-r1")).toMatchObject({
      reading: { distribution: "1.732" },
    });
    const patched = applyItemRangePatch(item, "legacy-r1", {
      tolerances: {
        reading: { high: "1", low: "-1", distribution: "2.449" },
      },
    });
    expect(patched.instrument.functions[0].ranges[0].tolerances.reading.distribution).toBe(
      "2.449",
    );
    expect(patched.instrument.functions[0].ranges).toHaveLength(1);
  });

  it("matches either stored range identity when both id forms are present", () => {
    const item = {
      id: "tmde-dual-range",
      instrument: {
        functions: [
          {
            id: "fn1",
            ranges: [
              {
                id: "row-id",
                rangeId: "master-range-id",
                tolerances: {
                  reading: { high: "1", low: "-1", distribution: "1.732" },
                },
              },
            ],
          },
        ],
      },
    };

    expect(
      getItemRangeTolerance(item, "row-id").reading.distribution,
    ).toBe("1.732");
    const patched = applyItemRangePatch(item, "row-id", {
      tolerances: {
        reading: { high: "1", low: "-1", distribution: "2.449" },
      },
    });
    expect(
      patched.instrument.functions[0].ranges[0].tolerances.reading.distribution,
    ).toBe("2.449");
  });

  it("updates a legacy derived TMDE snapshot when its master distribution is edited", () => {
    const master = {
      id: "tmde-weight",
      instrument: {
        id: "inst-weight",
        functions: [
          {
            id: "fn-weight",
            name: "Weight",
            unit: "ozf",
            ranges: [
              {
                id: "range-weight",
                min: 0,
                max: 1,
                unit: "ozf",
                tolerances: {
                  reading: {
                    high: "0.0002",
                    low: "-0.0002",
                    unit: "ozf",
                    distribution: "not_set",
                    symmetric: true,
                  },
                },
              },
            ],
          },
        ],
      },
    };
    const updatedMaster = applyItemRangePatch(
      master,
      "range-weight",
      {
        tolerances: {
          reading: {
            ...getItemRangeTolerance(master, "range-weight").reading,
            distribution: "1.960",
          },
        },
      },
    );
    const instance = {
      id: "point-weight",
      variableType: "Weight",
      measurementPoint: { value: "0.5", unit: "ozf" },
      sourceInstrument: { id: "inst-weight", functions: [{ name: "Weight" }] },
      reading: {
        high: "0.0002",
        low: "-0.0002",
        unit: "ozf",
        distribution: "not_set",
        symmetric: true,
      },
    };
    const [refreshed] = refreshTmdeInstancesFromMasters([instance], [updatedMaster]);
    const [component] = getBudgetComponentsFromTolerance(
      refreshed,
      instance.measurementPoint,
    );

    expect(
      updatedMaster.instrument.functions[0].ranges[0].tolerances.reading.distribution,
    ).toBe("1.960");
    expect(refreshed.reading.distribution).toBe("1.960");
    expect(component.distributionDivisor).toBe("1.960");
    expect(component.value_native).toBeCloseTo(0.0002 / 1.96, 10);
  });
});

describe("getTmdeAccuracyReadiness", () => {
  it("identifies a missing tolerance", () => {
    expect(getTmdeAccuracyReadiness({ tolerances: {} })).toEqual({
      ready: false,
      reason: "tolerance",
    });
  });

  it("identifies a tolerance whose distribution is not set", () => {
    expect(
      getTmdeAccuracyReadiness({
        tolerances: { reading: { high: "1", low: "-1", unit: "%" } },
      }),
    ).toEqual({ ready: false, reason: "distribution" });
  });

  it("accepts a populated tolerance with a band distribution", () => {
    expect(
      getTmdeAccuracyReadiness({
        tolerances: {
          reading: { high: "1", low: "-1", unit: "%" },
          bandDistribution: "1.960",
        },
      }),
    ).toEqual({ ready: true, reason: null });
  });

  it("recognizes a single-sided limit and still requires its distribution", () => {
    expect(
      getTmdeAccuracyReadiness({
        tolerances: {
          singleSided: { limit: "10", unit: "V" },
          bandDistribution: "1.732",
        },
      }),
    ).toEqual({ ready: true, reason: null });
  });
});

describe("countTmdeBudgetUses", () => {
  it("counts repeated budget rows linked to the same TMDE master", () => {
    const components = [
      { id: "accuracy-1", sourceTmdeId: "tmde-weight" },
      { id: "accuracy-2", sourceTmdeId: "tmde-weight" },
      { id: "resolution", isResolution: true },
      { id: "other", sourceTmdeId: "tmde-length" },
    ];

    expect(
      countTmdeBudgetUses(components, {
        id: "tmde-weight",
      }),
    ).toBe(2);
    expect(
      countTmdeBudgetUses(components, {
        id: "instance-id",
        sourceId: "tmde-length",
      }),
    ).toBe(1);
  });
});

describe("incrementDirectTmdeBudgetQuantity", () => {
  it("increments an existing direct-budget TMDE instead of suppressing a repeat", () => {
    const instances = [
      { id: "tmde-weight", name: "F-Class Weight", quantity: 1 },
      { id: "tmde-length", name: "Calibration Beam" },
    ];

    const updated = incrementDirectTmdeBudgetQuantity(instances, "tmde-weight");

    expect(updated).toEqual([
      { id: "tmde-weight", name: "F-Class Weight", quantity: 2 },
      { id: "tmde-length", name: "Calibration Beam" },
    ]);
    expect(instances[0].quantity).toBe(1);
  });

  it("treats a legacy instance without quantity as one existing use", () => {
    expect(
      incrementDirectTmdeBudgetQuantity(
        [{ id: "tmde-instance", sourceId: "tmde-master" }],
        "tmde-master",
      ),
    ).toEqual([
      { id: "tmde-instance", sourceId: "tmde-master", quantity: 2 },
    ]);
  });

  it("returns null when the TMDE has not been added yet", () => {
    expect(
      incrementDirectTmdeBudgetQuantity(
        [{ id: "tmde-length" }],
        "tmde-weight",
      ),
    ).toBeNull();
  });
});

describe("applyItemRangeFunction", () => {
  it("creates the first function and materializes a range for a blank instrument", () => {
    const patched = applyItemRangeFunction(
      {
        id: "uut-blank",
        instrument: { id: "inst-blank", functions: [] },
      },
      "default",
      "Resistance",
    );

    expect(patched.instrument.functions).toHaveLength(1);
    expect(patched.instrument.functions[0].name).toBe("Resistance");
    expect(patched.instrument.functions[0].ranges).toHaveLength(1);
  });

  it("renames the function that owns the active range", () => {
    const item = {
      id: "uut-dmm",
      instrument: {
        functions: [
          { id: "fn-v", name: "Voltage", ranges: [{ id: "r-v" }] },
          { id: "fn-r", name: "Resistance", ranges: [{ id: "r-r" }] },
        ],
      },
    };

    const patched = applyItemRangeFunction(item, "r-r", "Ohms");

    expect(patched.instrument.functions[1].name).toBe("Ohms");
    expect(patched.instrument.functions[0].name).toBe("Voltage");
  });

  it("moves a range when the committed name matches another function", () => {
    const item = {
      id: "uut-dmm",
      instrument: {
        functions: [
          { id: "fn-v", name: "Voltage", unit: "V", ranges: [{ id: "r-v" }] },
          { id: "fn-r", name: "Resistance", unit: "ohm", ranges: [{ id: "r-r" }] },
        ],
      },
    };

    const patched = applyItemRangeFunction(item, "r-r", "Voltage");

    expect(patched.instrument.functions).toHaveLength(1);
    expect(patched.instrument.functions[0].ranges.map((range) => range.id)).toEqual([
      "r-v",
      "r-r",
    ]);
  });
});
