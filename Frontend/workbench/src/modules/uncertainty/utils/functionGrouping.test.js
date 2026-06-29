import { describe, it, expect } from "vitest";
import {
  makeFunctionKey,
  functionKeyOf,
  functionLabelOf,
  instrumentFunctions,
  instrumentHasFunction,
  rangesForFunction,
  functionsForLibrary,
  resolveSessionFunctions,
  colorForFunction,
} from "./functionGrouping";

const point = (name, unit) => ({
  testPointInfo: { parameter: { name, unit } },
});

describe("makeFunctionKey", () => {
  it("is case-insensitive on name and trims", () => {
    expect(makeFunctionKey("DC Voltage", "V")).toBe(
      makeFunctionKey("  dc voltage ", "V"),
    );
  });
  it("keeps unit distinct", () => {
    expect(makeFunctionKey("Voltage", "V")).not.toBe(
      makeFunctionKey("Voltage", "mV"),
    );
  });
  it("defaults a blank name to Measurement", () => {
    expect(makeFunctionKey("", "")).toBe(makeFunctionKey("Measurement", ""));
  });
});

describe("functionKeyOf / functionLabelOf", () => {
  it("derives the key from the point's own parameter", () => {
    expect(functionKeyOf(point("AC Current", "A"))).toBe(
      makeFunctionKey("AC Current", "A"),
    );
  });
  it("returns a display label", () => {
    expect(functionLabelOf(point("AC Current", "A"))).toEqual({
      key: makeFunctionKey("AC Current", "A"),
      name: "AC Current",
      unit: "A",
    });
  });
  it("handles a missing parameter", () => {
    expect(functionLabelOf({})).toEqual({
      key: makeFunctionKey("Measurement", ""),
      name: "Measurement",
      unit: "",
    });
  });
});

describe("instrumentFunctions", () => {
  it("normalizes functions[] and accepts an instrument wrapper", () => {
    const inst = {
      instrument: {
        functions: [
          { name: "DC Voltage", unit: "V", ranges: [{ id: "r1" }] },
          { name: "AC Voltage", unit: "V", ranges: [] },
        ],
      },
    };
    const fns = instrumentFunctions(inst);
    expect(fns.map((f) => f.name)).toEqual(["DC Voltage", "AC Voltage"]);
    expect(fns[0].key).toBe(makeFunctionKey("DC Voltage", "V"));
    expect(fns[0].ranges).toHaveLength(1);
  });

  it("falls back to a single synthetic function for legacy flat ranges", () => {
    const fns = instrumentFunctions({ ranges: [{ id: "r1" }, { id: "r2" }] });
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe("Measurement");
    expect(fns[0].ranges).toHaveLength(2);
  });

  it("returns one Measurement function for an empty instrument", () => {
    const fns = instrumentFunctions({});
    expect(fns).toHaveLength(1);
    expect(fns[0].ranges).toEqual([]);
  });
});

describe("instrumentHasFunction / rangesForFunction", () => {
  const inst = {
    functions: [
      { name: "DC Voltage", unit: "V", ranges: [{ id: "a" }] },
      { name: "Resistance", unit: "ohm", ranges: [{ id: "b" }, { id: "c" }] },
    ],
  };
  const dcv = makeFunctionKey("DC Voltage", "V");
  const res = makeFunctionKey("Resistance", "ohm");

  it("detects declared functions", () => {
    expect(instrumentHasFunction(inst, dcv)).toBe(true);
    expect(instrumentHasFunction(inst, makeFunctionKey("AC Voltage", "V"))).toBe(
      false,
    );
  });

  it("scopes ranges to one function", () => {
    expect(rangesForFunction(inst, res).map((r) => r.id)).toEqual(["b", "c"]);
    expect(rangesForFunction(inst, makeFunctionKey("Nope", "x"))).toEqual([]);
  });
});

describe("resolveSessionFunctions", () => {
  it("merges explicit groups, instrument functions, and point parameters", () => {
    const session = {
      functionGroups: [
        { name: "DC Voltage", unit: "V", color: "#123456" },
        { name: "Empty Fn", unit: "A" }, // user-added, no instrument/point yet
      ],
      uuts: [{ instrument: { functions: [{ name: "Resistance", unit: "ohm" }] } }],
      tmdes: [],
      testPoints: [
        { testPointInfo: { parameter: { name: "DC Voltage", unit: "V" } } },
        { testPointInfo: { parameter: { name: "Frequency", unit: "Hz" } } },
      ],
    };
    const fns = resolveSessionFunctions(session);
    // explicit entries keep their order first, then derived ones alphabetically
    expect(fns.map((f) => f.name)).toEqual([
      "DC Voltage",
      "Empty Fn",
      "Frequency",
      "Resistance",
    ]);
    // stored color wins; others get a palette default
    expect(fns[0].color).toBe("#123456");
    expect(fns[1].color).toBeTruthy();
  });

  it("colorForFunction returns the stored color", () => {
    const session = {
      functionGroups: [{ name: "Torque", unit: "in-ozf", color: "#abcdef" }],
    };
    expect(
      colorForFunction(session, makeFunctionKey("Torque", "in-ozf")),
    ).toBe("#abcdef");
  });
});

describe("functionsForLibrary", () => {
  it("dedupes by key and sorts by name then unit", () => {
    const instruments = [
      { functions: [{ name: "Voltage", unit: "V" }] },
      { functions: [{ name: "Voltage", unit: "mV" }] },
      { functions: [{ name: "Voltage", unit: "V" }] }, // dup
      { functions: [{ name: "Current", unit: "A" }] },
    ];
    expect(functionsForLibrary(instruments)).toEqual([
      { key: makeFunctionKey("Current", "A"), name: "Current", unit: "A" },
      { key: makeFunctionKey("Voltage", "mV"), name: "Voltage", unit: "mV" },
      { key: makeFunctionKey("Voltage", "V"), name: "Voltage", unit: "V" },
    ]);
  });
});
