import { describe, expect, it } from "vitest";
import { makeFunctionKey } from "../../../utils/functionGrouping";
import {
  addBlankFunctionToInstrument,
  countTmdeBudgetUses,
  getDeleteSelectionTarget,
  getUsableBudgetRangeChoices,
  localizeSharedInstrumentEdit,
  rangeIsBlank,
  removeRangeFromItem,
  removeSelectedRangesFromItem,
  resolveUutRangeHelper,
  sortRangesAscending,
  sortRangesInItem,
  synchronizeLocalInstrumentDefinitions,
} from "./UncertaintyPanel";

describe("shared instrument inline editing", () => {
  it("forks an edited shared definition to a linked local copy", () => {
    const sharedDefinition = {
      id: "shared-dmm",
      scope: "validated",
      manufacturer: "Acme",
      model: "DMM-1",
      description: "Shared DMM",
      functions: [
        {
          id: "voltage",
          name: "Voltage",
          unit: "V",
          ranges: [{ id: "range-1", min: 0, max: 10, unit: "V" }],
        },
      ],
    };
    const editedItem = {
      id: "uut-row",
      description: "Shared DMM",
      instrument: {
        ...sharedDefinition,
        functions: [
          {
            ...sharedDefinition.functions[0],
            ranges: [
              ...sharedDefinition.functions[0].ranges,
              { id: "range-2", min: 10, max: 20, unit: "V" },
            ],
          },
        ],
      },
    };

    const localized = localizeSharedInstrumentEdit(editedItem, [sharedDefinition]);

    expect(localized.id).toBe("uut-row");
    expect(localized.instrument).toEqual(
      expect.objectContaining({
        scope: "local",
        sourceId: "shared-dmm",
        libraryInstrumentId: "shared-dmm",
        localOverride: true,
      }),
    );
    expect(localized.instrument.id).not.toBe("shared-dmm");
    expect(localized.instrument.functions[0].ranges).toHaveLength(2);
    expect(localized.instrument.validatedSnapshot.functions[0].ranges).toHaveLength(1);

    const synchronized = synchronizeLocalInstrumentDefinitions(
      { uuts: [{ ...editedItem, instrument: sharedDefinition }], tmdes: [] },
      localized,
      "uut",
    );
    expect(synchronized.uuts[0].instrument.scope).toBe("local");
    expect(synchronized.uuts[0].instrument.functions[0].ranges).toHaveLength(2);
  });

  it("replaces the exact shared TMDE row after it is localized", () => {
    const sharedDefinition = {
      id: "shared-meter",
      scope: "validated",
      functions: [
        {
          id: "current",
          name: "Current",
          unit: "A",
          ranges: [{ id: "range-1", min: 0, max: 1, unit: "A" }],
        },
      ],
    };
    const sharedRow = {
      id: "tmde-row",
      name: "Shared Meter",
      instrument: sharedDefinition,
    };
    const editedRow = {
      ...sharedRow,
      instrument: {
        ...sharedDefinition,
        functions: [
          {
            ...sharedDefinition.functions[0],
            ranges: [
              ...sharedDefinition.functions[0].ranges,
              { id: "range-2", min: 1, max: 10, unit: "A" },
            ],
          },
        ],
      },
    };
    const localized = localizeSharedInstrumentEdit(editedRow, [sharedDefinition]);
    const synchronized = synchronizeLocalInstrumentDefinitions(
      { uuts: [], tmdes: [sharedRow] },
      localized,
      "tmde",
    );

    expect(synchronized.tmdes[0].instrument.scope).toBe("local");
    expect(synchronized.tmdes[0].instrument.sourceId).toBe("shared-meter");
    expect(synchronized.tmdes[0].instrument.functions[0].ranges).toHaveLength(2);
  });
});

describe("add-to-budget range filtering", () => {
  const multiFunctionInstrument = {
    id: "multi-function",
    functions: [
      {
        id: "weight",
        name: "Weight",
        unit: "kg",
        ranges: [
          {
            id: "weight-range",
            min: 0,
            max: 100,
            unit: "kg",
            tolerance: {
              floor: { high: 0.1, low: -0.1, unit: "kg", distribution: "1.732" },
            },
          },
        ],
      },
      {
        id: "voltage",
        name: "DC Voltage",
        unit: "V",
        ranges: [
          {
            id: "voltage-range",
            min: 0,
            max: 10,
            unit: "V",
            tolerance: {
              floor: { high: 0.01, low: -0.01, unit: "V", distribution: "1.732" },
            },
          },
        ],
      },
    ],
  };

  it("shows only accuracy ranges that resolve for the budget quantity", () => {
    const choices = getUsableBudgetRangeChoices(
      multiFunctionInstrument,
      { value: 5, unit: "kg" },
      {
        functionKey: makeFunctionKey("Weight", "kg"),
        requireFunctionMatch: true,
      },
    );

    expect(choices.map((range) => range.id)).toEqual(["weight-range"]);
  });

  it("does not offer an incompatible voltage accuracy to a weight budget", () => {
    expect(
      getUsableBudgetRangeChoices(
        {
          id: "voltage-only",
          functions: multiFunctionInstrument.functions.slice(1),
        },
        { value: 5, unit: "kg" },
      ),
    ).toEqual([]);
  });
});

describe("local instrument role synchronization", () => {
  it("uses one edited definition for matching local UUT and TMDE rows", () => {
    const originalDefinition = {
      id: "local-dmm",
      scope: "local",
      manufacturer: "Acme",
      model: "DMM-1",
      description: "Bench DMM",
      functions: [
        {
          id: "voltage",
          name: "Voltage",
          ranges: [{ id: "v1", min: 0, max: 10, tolerances: {} }],
        },
      ],
    };
    const session = {
      uuts: [
        {
          id: "uut-row",
          description: "Bench DMM",
          instrument: originalDefinition,
        },
      ],
      tmdes: [
        {
          id: "tmde-row",
          name: "Bench DMM",
          instrument: {
            ...originalDefinition,
            measurementArea: "Electrical",
            measurementAreaColor: "#123456",
          },
        },
      ],
    };
    const updatedTmde = {
      ...session.tmdes[0],
      instrument: {
        ...session.tmdes[0].instrument,
        functions: [
          {
            ...session.tmdes[0].instrument.functions[0],
            ranges: [
              {
                id: "v1",
                min: 0,
                max: 10,
                tolerances: { floor: { high: "0.1", low: "-0.1" } },
              },
            ],
          },
        ],
      },
    };

    const synchronized = synchronizeLocalInstrumentDefinitions(
      session,
      updatedTmde,
      "tmde",
    );

    expect(synchronized.tmdes[0]).toBe(updatedTmde);
    expect(
      synchronized.uuts[0].instrument.functions[0].ranges[0].tolerances.floor.high,
    ).toBe("0.1");
    expect(synchronized.tmdes[0].instrument.measurementArea).toBe("Electrical");
  });

  it("preserves the TMDE distribution when tolerance is edited from the UUT table", () => {
    const uutDefinition = {
      id: "local-voltmeter",
      scope: "local",
      description: "Local Voltmeter",
      functions: [
        {
          id: "voltage",
          name: "Voltage",
          ranges: [
            {
              id: "v1",
              min: 0,
              max: 10,
              tolerances: {
                reading: {
                  high: "0.1",
                  low: "-0.1",
                  distribution: "not_set",
                },
              },
            },
          ],
        },
      ],
    };
    const tmdeDefinition = {
      ...uutDefinition,
      functions: [
        {
          ...uutDefinition.functions[0],
          ranges: [
            {
              ...uutDefinition.functions[0].ranges[0],
              tolerances: {
                reading: {
                  high: "0.1",
                  low: "-0.1",
                  distribution: "2.449",
                },
              },
            },
          ],
        },
      ],
    };
    const session = {
      uuts: [
        {
          id: "uut-row",
          description: "Local Voltmeter",
          instrument: uutDefinition,
        },
      ],
      tmdes: [
        {
          id: "tmde-row",
          name: "Local Voltmeter",
          instrument: tmdeDefinition,
        },
      ],
    };
    const updatedUut = {
      ...session.uuts[0],
      instrument: {
        ...uutDefinition,
        functions: [
          {
            ...uutDefinition.functions[0],
            ranges: [
              {
                ...uutDefinition.functions[0].ranges[0],
                tolerances: {
                  reading: {
                    high: "0.2",
                    low: "-0.2",
                    distribution: "not_set",
                  },
                },
              },
            ],
          },
        ],
      },
    };

    const synchronized = synchronizeLocalInstrumentDefinitions(
      session,
      updatedUut,
      "uut",
    );

    const uutReading =
      synchronized.uuts[0].instrument.functions[0].ranges[0].tolerances.reading;
    const tmdeReading =
      synchronized.tmdes[0].instrument.functions[0].ranges[0].tolerances.reading;
    expect(uutReading).toMatchObject({
      high: "0.2",
      low: "-0.2",
      distribution: "2.449",
    });
    expect(tmdeReading).toEqual(uutReading);
  });

  it("keeps a TMDE distribution edit authoritative for both local roles", () => {
    const definition = {
      id: "local-meter",
      scope: "local",
      functions: [
        {
          id: "voltage",
          name: "Voltage",
          ranges: [
            {
              id: "v1",
              tolerances: {
                reading: {
                  high: "0.1",
                  low: "-0.1",
                  distribution: "1.732",
                },
              },
            },
          ],
        },
      ],
    };
    const session = {
      uuts: [{ id: "uut-row", instrument: definition }],
      tmdes: [{ id: "tmde-row", instrument: definition }],
    };
    const updatedTmde = {
      ...session.tmdes[0],
      instrument: {
        ...definition,
        functions: [
          {
            ...definition.functions[0],
            ranges: [
              {
                ...definition.functions[0].ranges[0],
                tolerances: {
                  reading: {
                    high: "0.1",
                    low: "-0.1",
                    distribution: "2.449",
                  },
                },
              },
            ],
          },
        ],
      },
    };

    const synchronized = synchronizeLocalInstrumentDefinitions(
      session,
      updatedTmde,
      "tmde",
    );

    expect(
      synchronized.uuts[0].instrument.functions[0].ranges[0].tolerances.reading
        .distribution,
    ).toBe("2.449");
    expect(
      synchronized.tmdes[0].instrument.functions[0].ranges[0].tolerances.reading
        .distribution,
    ).toBe("2.449");
  });

  it("does not copy a distribution onto a newly added unmatched range", () => {
    const existingRange = {
      id: "existing-range",
      tolerances: {
        reading: {
          high: "0.1",
          low: "-0.1",
          distribution: "2.449",
        },
      },
    };
    const definition = {
      id: "local-meter",
      scope: "local",
      functions: [
        {
          id: "voltage",
          name: "Voltage",
          ranges: [existingRange],
        },
      ],
    };
    const session = {
      uuts: [{ id: "uut-row", instrument: definition }],
      tmdes: [{ id: "tmde-row", instrument: definition }],
    };
    const newRange = {
      id: "new-range",
      tolerances: {
        reading: {
          high: "0.2",
          low: "-0.2",
          distribution: "not_set",
        },
      },
    };
    const updatedUut = {
      ...session.uuts[0],
      instrument: {
        ...definition,
        functions: [
          {
            ...definition.functions[0],
            ranges: [newRange, existingRange],
          },
        ],
      },
    };

    const synchronized = synchronizeLocalInstrumentDefinitions(
      session,
      updatedUut,
      "uut",
    );

    expect(
      synchronized.tmdes[0].instrument.functions[0].ranges[0].tolerances.reading
        .distribution,
    ).toBe("not_set");
    expect(
      synchronized.tmdes[0].instrument.functions[0].ranges[1].tolerances.reading
        .distribution,
    ).toBe("2.449");
  });

  it("recognizes derived/manual budget source identities for TMDE badges", () => {
    const tmde = { id: "tmde-row", instrument: { id: "local-weight" } };
    expect(
      countTmdeBudgetUses(
        [
          { tmdeBudgetSourceId: "tmde-row" },
          { typeBSourceTmdeId: "local-weight" },
        ],
        tmde,
      ),
    ).toBe(2);
  });
});

describe("addBlankFunctionToInstrument", () => {
  it("adds a blank destination function without carrying source specifications", () => {
    const source = {
      id: "uut-1",
      instrument: {
        id: "dmm-1",
        scope: "local",
        functions: [
          {
            id: "voltage",
            name: "Voltage",
            unit: "V",
            ranges: [
              {
                id: "v-range",
                min: "0",
                max: "10",
                unit: "V",
                tolerances: { reading: { value: "1" } },
                resolution: "0.001",
              },
            ],
          },
        ],
      },
    };

    const updated = addBlankFunctionToInstrument(source, {
      key: "resistance",
      name: "Resistance",
      unit: "Ohm",
    });

    expect(updated.instrument.functions).toHaveLength(2);
    expect(updated.instrument.functions[0]).toEqual(source.instrument.functions[0]);
    expect(updated.instrument.functions[1]).toEqual(
      expect.objectContaining({
        name: "Resistance",
        unit: "Ohm",
      }),
    );
    expect(updated.instrument.functions[1].ranges).toHaveLength(1);
    expect(updated.instrument.functions[1].ranges[0]).toMatchObject({
      min: "",
      max: "",
      unit: "Ohm",
      resolution: "",
      tolerances: {},
      functionName: "Resistance",
    });
  });

  it("scopes legacy instance ranges to the source and leaves a cross-function drop blank", () => {
    const source = {
      id: "uut-pressure",
      ranges: [
        {
          id: "pressure-range",
          min: "0",
          max: "100",
          unit: "psig",
          tolerances: { reading: { high: "1", low: "-1" } },
        },
      ],
      instrument: {
        id: "pressure-instrument",
        functions: [
          { id: "pressure", name: "Pressure", unit: "psig", ranges: [] },
        ],
      },
    };

    const updated = addBlankFunctionToInstrument(
      source,
      { key: "flow", name: "Flow", unit: "gpm" },
      makeFunctionKey("Pressure"),
    );
    const pressure = resolveUutRangeHelper(
      updated,
      {},
      null,
      null,
      makeFunctionKey("Pressure"),
    );
    const flow = resolveUutRangeHelper(
      updated,
      {},
      null,
      null,
      makeFunctionKey("Flow"),
    );

    expect(pressure.ranges).toHaveLength(1);
    expect(pressure.activeRange).toMatchObject({
      id: "pressure-range",
      unit: "psig",
      functionName: "Pressure",
    });
    expect(flow.ranges).toHaveLength(1);
    expect(flow.activeRange).toMatchObject({
      unit: "gpm",
      min: "",
      max: "",
      tolerances: {},
      functionName: "Flow",
    });
    expect(flow.activeRange.tolerances).not.toHaveProperty("reading");
  });

  it("does not duplicate a function the instrument already supports", () => {
    const source = {
      instrument: {
        functions: [{ name: "Resistance", unit: "Ohm", ranges: [] }],
      },
    };

    expect(
      addBlankFunctionToInstrument(source, {
        name: "Resistance",
        unit: "kOhm",
      }),
    ).toBe(source);
  });
});

// rangeIsBlank backs clear-to-delete: a range is removed only once BOTH bounds
// are cleared (a half-filled range stays put).

describe("rangeIsBlank (clear-to-delete detection)", () => {
  it("is true only when a range has no numeric bounds", () => {
    expect(rangeIsBlank({ min: "", max: "" })).toBe(true);
    expect(rangeIsBlank({ min: "1", max: "" })).toBe(false); // half-filled stays
    expect(rangeIsBlank({ min: "", max: "10" })).toBe(false);
    expect(rangeIsBlank({ min: "1", max: "10" })).toBe(false);
  });

  it("handles single-value ranges", () => {
    expect(rangeIsBlank({ isSingleValue: true, value: "" })).toBe(true);
    expect(rangeIsBlank({ isSingleValue: true, value: "30" })).toBe(false);
  });
});

describe("removeSelectedRangesFromItem", () => {
  it("removes a Ctrl/Cmd-selected batch, including the final range", () => {
    const item = {
      id: "uut-1",
      instrument: {
        ranges: [
          { id: "range-1", min: 0, max: 10 },
          { id: "range-2", min: 10, max: 20 },
          { id: "range-3", min: 20, max: 30 },
        ],
      },
    };

    const updated = removeSelectedRangesFromItem(item, ["range-1", "range-2"]);
    expect(updated.instrument.ranges.map((range) => range.id)).toEqual(["range-3"]);

    const lastRange = removeSelectedRangesFromItem(item, ["range-1", "range-2", "range-3"]);
    expect(lastRange.instrument.ranges).toHaveLength(1);
    expect(lastRange.instrument.ranges[0]).toEqual(
      expect.objectContaining({ min: "", max: "", tolerances: {} }),
    );
  });

  it("allows the only function-scoped range to be deleted", () => {
    const item = {
      id: "uut-2",
      instrument: {
        functions: [{ id: "fn-1", ranges: [{ id: "only", min: 0, max: 1 }] }],
      },
    };

    const updated = removeRangeFromItem(item, "only");
    expect(updated.instrument.functions[0].ranges).toHaveLength(1);
    expect(updated.instrument.functions[0].ranges[0]).toEqual(
      expect.objectContaining({ min: "", max: "", tolerances: {} }),
    );
  });
});

describe("range ordering", () => {
  it("sorts numeric bounds ascending and keeps incomplete rows last", () => {
    const ranges = [
      { id: "blank", min: "", max: "" },
      { id: "twenty", min: "20", max: "30" },
      { id: "zero", min: "0", max: "10" },
      { id: "ten", min: "10", max: "20" },
    ];

    expect(sortRangesAscending(ranges).map((range) => range.id)).toEqual([
      "zero",
      "ten",
      "twenty",
      "blank",
    ]);
  });

  it("sorts function-scoped ranges without mutating the original item", () => {
    const item = {
      id: "uut-1",
      instrument: {
        functions: [
          {
            id: "fn-1",
            ranges: [
              { id: "range-2", min: 10, max: 20 },
              { id: "range-1", min: 0, max: 10 },
            ],
          },
        ],
      },
    };

    const sorted = sortRangesInItem(item);
    expect(sorted).not.toBe(item);
    expect(sorted.instrument.functions[0].ranges.map((range) => range.id)).toEqual([
      "range-1",
      "range-2",
    ]);
    expect(item.instrument.functions[0].ranges.map((range) => range.id)).toEqual([
      "range-2",
      "range-1",
    ]);
  });
});

describe("getDeleteSelectionTarget", () => {
  it("prioritizes the last selected range over its active parent UUT", () => {
    expect(
      getDeleteSelectionTarget({
        lastSelectionTarget: "range",
        selectedRangeIds: { "uut:uut-1": ["range-2", "range-3"] },
        selectedUutIds: ["uut-1"],
      }),
    ).toBe("range");
  });

  it("does not fall back to deleting the parent after the range selection is cleared", () => {
    expect(
      getDeleteSelectionTarget({
        lastSelectionTarget: "range",
        selectedRangeIds: {},
        selectedUutIds: ["uut-1"],
      }),
    ).toBeNull();
  });
});

describe("resolveUutRangeHelper for derived input assignments", () => {
  it("uses the variable nominal to select a compatible TMDE range when the variable name is not a real function", () => {
    const tmde = {
      id: "tmde-temp",
      instrument: {
        functions: [
          {
            id: "fn-v",
            name: "DC Voltage",
            unit: "V",
            ranges: [
              {
                id: "range-v",
                min: "0",
                max: "10",
                unit: "V",
                tolerances: {},
              },
            ],
          },
          {
            id: "fn-t",
            name: "Temperature",
            unit: "degF",
            ranges: [
              {
                id: "range-t",
                min: "0",
                max: "500",
                unit: "degF",
                tolerances: {
                  floor: {
                    high: "1",
                    low: "-1",
                    unit: "degF",
                    symmetric: true,
                  },
                },
              },
            ],
          },
        ],
      },
    };

    const resolved = resolveUutRangeHelper(
      tmde,
      {},
      null,
      { value: "212", unit: "degF" },
      makeFunctionKey("b", "degF"),
    );

    expect(resolved.activeRange.id).toBe("range-t");
    expect(resolved.activeRange.floor.high).toBe("1");
  });
});
