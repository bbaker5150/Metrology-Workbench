import { describe, expect, it } from "vitest";
import { createInstanceFromDefinition, standardizeRangeSpecs } from "./instrumentFactory";
import {
  getInstrumentRangeRows,
  resolveInstrumentSelection,
} from "./instrumentFunctionSelection";

const multifunctionDmm = {
  id: "inst-dmm",
  manufacturer: "Example",
  model: "DMM-1",
  description: "Multifunction DMM",
  functions: [
    {
      id: "fn-dcv",
      name: "DC Voltage",
      unit: "V",
      ranges: [
        {
          id: "rng-dcv-10v",
          range: "10 V",
          min: 0,
          max: 10,
          resolution: 0.001,
          tolerances: {
            reading: { high: 0.01, low: -0.01, unit: "%", symmetric: true },
            range: { high: 0.005, low: -0.005, unit: "%", value: 10 },
          },
        },
        {
          id: "rng-dcv-100v",
          range: "100 V",
          min: 10,
          max: 100,
          resolution: 0.01,
          tolerances: {
            reading: { high: 0.02, low: -0.02, unit: "%", symmetric: true },
          },
        },
      ],
    },
    {
      id: "fn-res",
      name: "Resistance",
      unit: "Ohm",
      ranges: [
        {
          id: "rng-res-600",
          range: "600 Ohm",
          min: 0,
          max: 600,
          resolution: 0.1,
          tolerances: {
            floor: { high: 0.2, low: -0.2, unit: "Ohm", symmetric: true },
          },
        },
      ],
    },
  ],
};

describe("resolveInstrumentSelection", () => {
  it("builds sidebar-ready range rows with stable function and range ids", () => {
    const rows = getInstrumentRangeRows({ instrument: multifunctionDmm });

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.rangeId)).toEqual([
      "rng-dcv-10v",
      "rng-dcv-100v",
      "rng-res-600",
    ]);
    expect(rows[0]).toMatchObject({
      functionId: "fn-dcv",
      functionName: "DC Voltage",
      functionUnit: "V",
      unit: "V",
      source: "function",
      _index: 0,
    });
    expect(rows[2]).toMatchObject({
      functionId: "fn-res",
      functionName: "Resistance",
      functionUnit: "Ohm",
      unit: "Ohm",
      source: "function",
      _index: 2,
    });
  });

  it("can flatten range tolerances while preserving original range ids", () => {
    const rows = getInstrumentRangeRows(
      { instrument: multifunctionDmm },
      { flattenTolerances: true },
    );

    expect(rows[0].id).toBe("rng-dcv-10v");
    expect(rows[0].rangeId).toBe("rng-dcv-10v");
    expect(rows[0].reading.high).toBe(0.01);
    expect(rows[2].floor.high).toBe(0.2);
  });

  it("uses range id to select the owning function on a multifunction instrument", () => {
    const selection = resolveInstrumentSelection(multifunctionDmm, {
      userRangeId: "rng-res-600",
    });

    expect(selection.functionId).toBe("fn-res");
    expect(selection.functionName).toBe("Resistance");
    expect(selection.rangeId).toBe("rng-res-600");
    expect(selection.specs.unit).toBe("Ohm");
    expect(selection.specs.functionId).toBe("fn-res");
    expect(selection.specs.rangeId).toBe("rng-res-600");
    expect(selection.specs.floor.high).toBe(0.2);
  });

  it("keeps legacy function name and range index selection working", () => {
    const selection = resolveInstrumentSelection(multifunctionDmm, {
      userFunctionName: "DC Voltage",
      userRangeIndex: 1,
    });

    expect(selection.functionId).toBe("fn-dcv");
    expect(selection.functionName).toBe("DC Voltage");
    expect(selection.rangeId).toBe("rng-dcv-100v");
    expect(selection.rangeIndex).toBe(1);
    expect(selection.specs.unit).toBe("V");
  });
});

describe("instrumentFactory function/range metadata", () => {
  it("stamps selected function and range ids onto TMDE instances", () => {
    const instance = createInstanceFromDefinition(
      { id: "tmde-master", name: "Bench DMM", instrument: multifunctionDmm },
      {
        userFunctionId: "fn-res",
        userRangeId: "rng-res-600",
      },
    );

    expect(instance.definitionId).toBe("tmde-master");
    expect(instance.sourceId).toBe("tmde-master");
    expect(instance.functionId).toBe("fn-res");
    expect(instance.functionName).toBe("Resistance");
    expect(instance.functionUnit).toBe("Ohm");
    expect(instance.rangeId).toBe("rng-res-600");
    expect(instance._index).toBe(0);
    expect(instance.measurementPoint).toEqual({ value: "", unit: "Ohm" });
    expect(instance.floor.high).toBe(0.2);
  });

  it("standardizes a UUT range with function context", () => {
    const standardized = standardizeRangeSpecs(
      {
        id: "rng-current-1a",
        functionId: "fn-current",
        min: 0,
        max: 1,
        resolution: 0.0001,
        tolerances: {
          reading: { high: 0.1, low: -0.1, unit: "%", symmetric: true },
        },
      },
      "Current",
      "A",
    );

    expect(standardized.functionId).toBe("fn-current");
    expect(standardized.functionName).toBe("Current");
    expect(standardized.functionUnit).toBe("A");
    expect(standardized.rangeId).toBe("rng-current-1a");
    expect(standardized.unit).toBe("A");
    expect(standardized.reading.high).toBe(0.1);
  });
});
