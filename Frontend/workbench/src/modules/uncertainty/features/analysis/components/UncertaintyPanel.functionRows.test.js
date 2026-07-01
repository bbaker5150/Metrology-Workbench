import { describe, expect, it } from "vitest";
import { buildFunctionGroupedRows } from "./UncertaintyPanel";
import { makeFunctionKey } from "../../../utils/functionGrouping";

describe("buildFunctionGroupedRows", () => {
  it("shows every UUT function group when detail UUT rows are unscoped", () => {
    const pressureKey = makeFunctionKey("Pressure", "psig");
    const resistanceKey = makeFunctionKey("Resistance", "Ohm");
    const pressureUut = {
      id: "uut-pressure",
      description: "Pressure UUT",
      instrument: {
        functions: [{ name: "Pressure", unit: "psig", ranges: [] }],
      },
    };
    const resistanceUut = {
      id: "uut-resistance",
      description: "Resistance UUT",
      instrument: {
        functions: [{ name: "Resistance", unit: "Ohm", ranges: [] }],
      },
    };

    const rows = buildFunctionGroupedRows(
      [
        { type: "item", item: pressureUut, index: 0 },
        { type: "item", item: resistanceUut, index: 1 },
      ],
      {
        uuts: [pressureUut, resistanceUut],
        functionGroups: [
          { name: "Pressure", unit: "psig", kind: "uut" },
          { name: "Resistance", unit: "Ohm", kind: "uut" },
        ],
      },
      "uut",
      { includeEmptyGroups: true },
    );

    expect(rows.map((row) => row.fn?.key || row.functionKey)).toEqual([
      pressureKey,
      pressureKey,
      resistanceKey,
      resistanceKey,
    ]);
  });

  it("keeps the active empty function visible in detailed view scope", () => {
    const resistanceKey = makeFunctionKey("Resistance", "Ohm");
    const rows = buildFunctionGroupedRows([], {
      functionGroups: [
        { name: "Resistance", unit: "Ohm", kind: "tmde" },
        { name: "Voltage", unit: "V", kind: "tmde" },
      ],
    }, "tmde", {
      includeEmptyGroups: true,
      onlyFunctionKey: resistanceKey,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "function",
      fn: { key: resistanceKey, name: "Resistance", unit: "Ohm" },
    });
  });

  it("can synthesize the active empty function when the backend omits functionGroups", () => {
    const resistanceKey = makeFunctionKey("Resistance", "Ohm");
    const rows = buildFunctionGroupedRows([], {}, "tmde", {
      includeEmptyGroups: true,
      onlyFunctionKey: resistanceKey,
      emptyFunctionFallback: {
        key: resistanceKey,
        name: "Resistance",
        unit: "Ohm",
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "function",
      fn: {
        key: resistanceKey,
        name: "Resistance",
        unit: "Ohm",
        isSyntheticFallback: true,
      },
    });
  });

  it("keeps explicit detail-view functions visible outside the active point function", () => {
    const voltageKey = makeFunctionKey("Voltage", "V");
    const resistanceKey = makeFunctionKey("Resistance", "Ohm");
    const rows = buildFunctionGroupedRows([], {
      functionGroups: [
        { name: "Resistance", unit: "Ohm", kind: "tmde" },
      ],
    }, "tmde", {
      includeEmptyGroups: true,
      onlyFunctionKey: voltageKey,
      includeExplicitFunctionGroups: true,
      emptyFunctionFallback: {
        key: voltageKey,
        name: "Voltage",
        unit: "V",
      },
    });

    expect(rows.map((row) => row.fn?.key)).toEqual([
      resistanceKey,
      voltageKey,
    ]);
    expect(rows[0].fn.isSyntheticFallback).toBeUndefined();
    expect(rows[1].fn.isSyntheticFallback).toBe(true);
  });

  it("keeps instruments under explicit detail-view functions visible outside the active point function", () => {
    const voltageKey = makeFunctionKey("Voltage", "V");
    const resistanceKey = makeFunctionKey("Resistance", "Ohm");
    const tmde = {
      id: "tmde-res",
      name: "Resistance Standard",
      instrument: {
        functions: [{ name: "Resistance", unit: "Ohm", ranges: [] }],
      },
    };

    const rows = buildFunctionGroupedRows(
      [{ type: "item", item: tmde, index: 0 }],
      {
        functionGroups: [{ name: "Resistance", unit: "Ohm", kind: "tmde" }],
      },
      "tmde",
      {
        includeEmptyGroups: true,
        onlyFunctionKey: voltageKey,
        includeExplicitFunctionGroups: true,
      },
    );

    expect(rows).toHaveLength(3);
    expect(rows[0].fn.key).toBe(resistanceKey);
    expect(rows[1]).toMatchObject({
      type: "item",
      item: tmde,
      functionKey: resistanceKey,
    });
    expect(rows[2]).toMatchObject({
      type: "function",
      fn: { key: voltageKey, isSyntheticFallback: true },
    });
  });

  it("shows a newly-created blank TMDE under the active function", () => {
    const resistanceKey = makeFunctionKey("Resistance", "Ohm");
    const tmde = {
      id: "tmde-1",
      instrument: {
        functions: [{ name: "Resistance", unit: "Ohm", ranges: [] }],
      },
    };

    const rows = buildFunctionGroupedRows(
      [{ type: "item", item: tmde, index: 0 }],
      { functionGroups: [{ name: "Resistance", unit: "Ohm", kind: "tmde" }] },
      "tmde",
      { includeEmptyGroups: true, onlyFunctionKey: resistanceKey },
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ type: "function" });
    expect(rows[1]).toMatchObject({
      type: "item",
      item: tmde,
      functionKey: resistanceKey,
      rowKey: "tmde-1",
    });
  });
});
