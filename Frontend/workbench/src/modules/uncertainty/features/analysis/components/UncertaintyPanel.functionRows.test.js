import { describe, expect, it } from "vitest";
import { buildFunctionGroupedRows } from "./UncertaintyPanel";
import { makeFunctionKey } from "../../../utils/functionGrouping";

describe("buildFunctionGroupedRows", () => {
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
      fn: { key: resistanceKey, name: "Resistance", unit: "Ohm" },
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
