import { describe, expect, it } from "vitest";
import { resolvePointForUutContext } from "./App";

describe("resolvePointForUutContext", () => {
  it("replaces a stale carried tolerance with the matching UUT function range", () => {
    const point = {
      measurementAreaId: "flow-area",
      testPointInfo: {
        parameter: { name: "Angular Speed", value: "1100", unit: "rpm" },
      },
      uutTolerance: {
        functionName: "Flow",
        functionUnit: "gpm",
        min: "0",
        max: "5",
        unit: "gpm",
      },
    };
    const uut = {
      id: "encoder",
      measurementAreaId: "angular-area",
      instrument: {
        functions: [
          {
            name: "Angular Speed",
            unit: "rpm",
            ranges: [
              {
                id: "rpm-range",
                functionName: "Angular Speed",
                functionUnit: "rpm",
                min: "0",
                max: "12000",
                unit: "rpm",
              },
            ],
          },
        ],
      },
    };

    const resolved = resolvePointForUutContext(point, uut);

    expect(resolved.associatedUutIds).toEqual(["encoder"]);
    expect(resolved.measurementAreaId).toBe("angular-area");
    expect(resolved.uutTolerance).toMatchObject({
      id: "rpm-range",
      functionName: "Angular Speed",
      functionUnit: "rpm",
      unit: "rpm",
    });
  });

  it("keeps a carried tolerance when it already matches the point function", () => {
    const matchingTolerance = {
      functionName: "Resistance",
      functionUnit: "Ohm",
      min: "0",
      max: "100",
      unit: "Ohm",
    };
    const point = {
      testPointInfo: {
        parameter: { name: "Resistance", value: "10", unit: "Ohm" },
      },
      uutTolerance: matchingTolerance,
    };

    const resolved = resolvePointForUutContext(point, {
      id: "dmm",
      measurementAreaId: "resistance-area",
      instrument: {
        functions: [
          {
            name: "Resistance",
            unit: "Ohm",
            ranges: [{ id: "other", min: "0", max: "100", unit: "Ohm" }],
          },
        ],
      },
    });

    expect(resolved.uutTolerance).toBe(matchingTolerance);
  });
});
