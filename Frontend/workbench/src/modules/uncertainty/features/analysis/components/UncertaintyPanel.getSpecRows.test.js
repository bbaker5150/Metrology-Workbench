import { describe, expect, it } from "vitest";
import {
  applyToleranceCaseChange,
  getSpecRows,
  getUutSpecRows,
  componentIsAsymmetric,
  resolveUutRangeHelper,
  scopeLibraryInstrumentToFunction,
  toleranceTermMode,
} from "./UncertaintyPanel";

// The simplified ("read") tolerance/error-limit view renders getSpecRows(...)[0].
// It must show EVERY component the user entered, on one line, with consistent
// short labels (% IV / % FS) — regressions here dropped %FS when %IV was also
// present, or flipped between "% IV" and "of Indicated Value".
describe("getSpecRows compact spec line", () => {
  it("shows a single symmetric reading term", () => {
    const tol = { reading: { value: "2", high: "2", low: "-2", unit: "%" } };
    expect(getSpecRows(tol)[0]).toBe("± 2% IV");
  });

  it("keeps BOTH %IV and %FS terms on one line", () => {
    const tol = {
      reading: { value: "2", high: "2", low: "-2", unit: "%" },
      // %FS entered with only a high value (low blank → treated as symmetric).
      range: { value: "10", high: "1", low: "", unit: "%" },
    };
    expect(getSpecRows(tol)[0]).toBe("±(2% IV + 1% FS)");
  });

  it("includes an absolute floor term alongside the percent terms", () => {
    const tol = {
      reading: { high: "2", low: "-2", unit: "%" },
      range: { high: "1", low: "-1", unit: "%" },
      floor: { high: "0.5", low: "-0.5", unit: "V" },
    };
    expect(getSpecRows(tol)[0]).toBe("±(2% IV + 1% FS + 0.5 V)");
  });

  it("uses consistent % IV / % FS labels even when a term is asymmetric", () => {
    const tol = {
      reading: { high: "2", low: "-2", unit: "%" },
      range: { high: "1", low: "-0.5", unit: "%" },
    };
    const line = getSpecRows(tol)[0];
    expect(line).toContain("% IV");
    expect(line).toContain("% FS");
    // No component is dropped and the old "of Indicated Value" wording is gone.
    expect(line).not.toContain("Indicated Value");
    expect(line).toBe("±2% IV + (+1/-0.5)% FS");
  });

  it("falls back to a placeholder when nothing is set", () => {
    expect(getSpecRows({})[0]).toBe("Not Set");
    expect(getSpecRows(null)[0]).toBe("-");
  });

  it("renders standalone workbook-style single-sided limits", () => {
    expect(
      getSpecRows({
        singleSided: {
          direction: "high",
          measurement: "unknown",
          limit: "300",
          unit: "degF",
        },
      })[0],
    ).toBe("≤ 300 °F (measurement unknown)");
    expect(
      getSpecRows({
        singleSided: {
          direction: "low",
          measurement: "known",
          limit: "10",
          unit: "V",
        },
      })[0],
    ).toBe("≥ 10 V (measurement known)");
  });

  it("keeps measurement state out of ordinary two-sided UUT tolerances", () => {
    const tol = {
      reading: { high: "25", low: "-5", unit: "%" },
    };
    expect(getUutSpecRows(tol)[0]).toBe("(+25/-5)% IV");
    expect(getSpecRows(tol)[0]).toBe("(+25/-5)% IV");
  });
});

describe("applyToleranceCaseChange", () => {
  it("keeps the standalone single-sided case exclusive", () => {
    const single = applyToleranceCaseChange(
      {
        reading: { high: "1", low: "-1", value: "1" },
        floor: { high: "0.1", low: "-0.1", unit: "V" },
      },
      "singleSided",
      { direction: "high", measurement: "known", limit: "10", unit: "V" },
    );
    expect(single).toEqual({
      singleSided: { direction: "high", measurement: "known", limit: "10", unit: "V" },
    });

    const double = applyToleranceCaseChange(
      single,
      "reading",
      { high: "1", low: "-1", value: "1", unit: "%" },
    );
    expect(double.singleSided).toBeUndefined();
    expect(double.reading.high).toBe("1");
  });
});

// The tolerance editor shows ONE ± input for a symmetric tolerance and two
// (+ / −) inputs when the limits genuinely differ — including a true single-
// sided (unilateral) tolerance like +1/-0. componentIsAsymmetric drives that.
describe("componentIsAsymmetric", () => {
  it("treats mirrored ± limits as symmetric (one input)", () => {
    expect(componentIsAsymmetric({ high: "1", low: "-1" })).toBe(false);
  });

  it("treats a blank/missing low limit as symmetric (mirrors to ±)", () => {
    expect(componentIsAsymmetric({ high: "1", low: "" })).toBe(false);
    expect(componentIsAsymmetric({ high: "1" })).toBe(false);
  });

  it("flags asymmetric bilateral limits as two-sided", () => {
    expect(componentIsAsymmetric({ high: "1", low: "-0.5" })).toBe(true);
  });

  it("flags a true single-sided (unilateral) +n/-0 tolerance as two-sided", () => {
    expect(componentIsAsymmetric({ high: "1", low: "0" })).toBe(true);
    expect(componentIsAsymmetric({ high: "0", low: "-1" })).toBe(true);
  });

  it("is symmetric when nothing is entered yet", () => {
    expect(componentIsAsymmetric({ high: "", low: "" })).toBe(false);
    expect(componentIsAsymmetric({})).toBe(false);
  });
});

// The three-way tolerance shape control picks its layout from toleranceTermMode.
describe("toleranceTermMode", () => {
  it("classifies a mirrored ± value as symmetric", () => {
    expect(toleranceTermMode({ high: "1", low: "-1" })).toBe("symmetric");
    expect(toleranceTermMode({ high: "1", low: "" })).toBe("symmetric");
    expect(toleranceTermMode({})).toBe("symmetric");
  });

  it("keeps +n/-0 or +0/-n tolerances explicitly asymmetric", () => {
    expect(toleranceTermMode({ high: "1", low: "0" })).toBe("asymmetric");
    expect(toleranceTermMode({ high: "0", low: "-1" })).toBe("asymmetric");
  });

  it("classifies two unequal non-zero limits as asymmetric", () => {
    expect(toleranceTermMode({ high: "1", low: "-0.5" })).toBe("asymmetric");
  });
});

describe("scopeLibraryInstrumentToFunction", () => {
  it("keeps shared ranges when the table function has no unit", () => {
    const scoped = scopeLibraryInstrumentToFunction(
      {
        manufacturer: "Mock",
        model: "DMM",
        functions: [
          {
            id: "fn-v",
            name: "Voltage",
            unit: "V",
            ranges: [
              {
                id: "range-v",
                min: "0",
                max: "10",
                unit: "V",
                tolerances: {
                  reading: { high: "1", low: "-1", unit: "%" },
                },
              },
            ],
          },
        ],
      },
      "voltage|",
      { name: "Voltage", unit: "" },
    );

    expect(scoped.functions).toHaveLength(1);
    expect(scoped.functions[0].name).toBe("Voltage");
    expect(scoped.functions[0].unit).toBe("");
    expect(scoped.functions[0].ranges).toHaveLength(1);
    expect(scoped.functions[0].ranges[0].tolerances.reading.high).toBe("1");
  });

  it("resolves copied shared specs under the unitless table function", () => {
    const scopedInstrument = scopeLibraryInstrumentToFunction(
      {
        manufacturer: "Mock",
        model: "DMM",
        functions: [
          {
            id: "fn-v",
            name: "Voltage",
            unit: "V",
            ranges: [
              {
                id: "range-v",
                min: "0",
                max: "10",
                unit: "V",
                resolution: "0.001",
                resolutionUnit: "V",
                tolerances: {
                  reading: { high: "1", low: "-1", unit: "%" },
                  floor: { high: "0.002", low: "-0.002", unit: "V" },
                },
              },
            ],
          },
        ],
      },
      "voltage|",
      { name: "Voltage", unit: "" },
    );

    const rowItem = { id: "uut-1", instrument: scopedInstrument };
    const resolved = resolveUutRangeHelper(rowItem, {}, null, null, "voltage|");

    expect(resolved.ranges).toHaveLength(1);
    expect(resolved.activeRange.id).toBe("range-v");
    expect(resolved.activeRange.resolution).toBe("0.001");
    expect(resolved.activeRange.resolutionUnit).toBe("V");
    expect(resolved.activeRange.reading.high).toBe("1");
    expect(resolved.activeRange.floor.high).toBe("0.002");
  });
});
