import { describe, test, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  correlationKey,
  getCorrelation,
  combineWithCorrelation,
  normalQuantile,
  snapLimitsToResolution,
  resolveResolutionNative,
  getTmdeAbsoluteLimits,
  getTmdeAbsoluteLimitEntries,
  unitSystem,
} from "./uncertaintyMath";
import { computePointRiskMetrics } from "./riskCompute";
import release from "./risk8/finalRelease8Vectors.json";

// Signed base-SI contributions for BRG-3100 section 4.1.9 (T = W * L), using the
// workbook's Normal k=1.96 divisor on the beam (Length) and weight specs.
const cL = (0.002 / 1.9599639845) * 0.017637; // ≈ 1.79973e-5
const cW = (2.53968254e-5 / 1.9599639845) * 2.127; // ≈ 2.75612e-5
const cR = 2.8867513459481293e-6 * 1; // ≈ 2.88675e-6
const list = [
  { id: "Length", contribution: cL },
  { id: "Weight", contribution: cW },
  { id: "UUT Resolution", contribution: cR },
];

describe("correlationKey / getCorrelation", () => {
  test("key is order-independent", () => {
    expect(correlationKey("Weight", "Length")).toBe("Length|Weight");
    expect(correlationKey("Length", "Weight")).toBe("Length|Weight");
  });

  test("self-correlation is 1, missing pair is 0", () => {
    expect(getCorrelation({}, "Weight", "Weight")).toBe(1);
    expect(getCorrelation({}, "Weight", "Length")).toBe(0);
    expect(getCorrelation({ "Length|Weight": 0.5 }, "Weight", "Length")).toBe(0.5);
  });
});

describe("combineWithCorrelation", () => {
  test("identity map reduces to RSS", () => {
    const rss = Math.sqrt(cL * cL + cW * cW + cR * cR);
    expect(combineWithCorrelation(list, {})).toBeCloseTo(rss, 12);
  });

  test("rejects inconsistent perfect correlations even when their quadratic sum is positive", () => {
    // The historical 4.1.9 map omits rho(L,R), making it zero. If L and R
    // both correlate perfectly with W, they must also correlate with each
    // other. This matrix has determinant -1, so it cannot describe inputs.
    const impossible = {
      "Length|Weight": 1,
      "UUT Resolution|Weight": 1,
    };
    expect(cL ** 2 + cW ** 2 + cR ** 2 + 2 * cL * cW + 2 * cW * cR).toBeGreaterThan(0);
    expect(() => combineWithCorrelation(list, impossible)).toThrow(/correlation matrix is not physically valid/i);
  });

  test("valid perfect correlation combines contributions as the absolute signed sum", () => {
    // An all-ones matrix is singular but PSD. Its variance is (cL+cW+cR)^2.
    expect(combineWithCorrelation(list, {
      "Length|Weight": 1,
      "UUT Resolution|Weight": 1,
      "Length|UUT Resolution": 1,
    })).toBeCloseTo(Math.abs(cL + cW + cR), 14);
  });

  test("positive correlation on opposing sensitivities reduces u_c (ratio)", () => {
    const ratio = [
      { id: "V1", contribution: 0.0049 },
      { id: "V2", contribution: -0.0048 },
    ];
    const indep = combineWithCorrelation(ratio, {});
    const corr = combineWithCorrelation(ratio, { "V1|V2": 1 });
    expect(corr).toBeLessThan(indep);
  });

  test("valid perfect anticorrelation cancels equal contributions exactly", () => {
    const out = combineWithCorrelation(
      [
        { id: "A", contribution: 1 },
        { id: "B", contribution: 1 },
      ],
      { "A|B": -1 },
    );
    expect(out).toBe(0);
  });
});

describe("normalQuantile", () => {
  test("matches the workbook coverage factor k=1.959964 at 95%", () => {
    // simple-statistics probit returned ~1.95716 — 0.14% short. The workbook
    // uses 1.9599639845.
    expect(normalQuantile(0.975)).toBeCloseTo(1.9599639845, 9);
    expect(normalQuantile(0.95)).toBeCloseTo(1.6448536269, 9);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 12);
  });
});

describe("snapLimitsToResolution", () => {
  test("rounds the band inward to the resolution grid (Excel)", () => {
    const r = snapLimitsToResolution(0.037264, 0.037764, 1e-5);
    expect(r.low).toBeCloseTo(0.03727, 9); // ceil up
    expect(r.high).toBeCloseTo(0.03776, 9); // floor down
  });

  test("no/invalid resolution leaves the band untouched", () => {
    expect(snapLimitsToResolution(0.037264, 0.037764, 0)).toEqual({
      low: 0.037264,
      high: 0.037764,
    });
  });

  test("preserves an inverted rounded band for downstream rejection", () => {
    // V8.00 retains the true grid geometry; restoring raw limits would solve
    // a different acceptance problem. riskCompute.release8 tests rejection.
    const r = snapLimitsToResolution(0.0372, 0.0378, 0.01);
    expect(r).toEqual({ low: 0.04, high: 0.03 });
  });

  test("on-grid band survives a round-tripped resolution (no full-count drop)", () => {
    // A 0.1 resolution that has been through a unit-conversion round-trip is
    // 0.10000000000000002, not 0.1. An on-grid band (9.5 .. 10.5) must stay put
    // rather than having the upper limit truncated a full count down to 10.4 --
    // which corrupted the acceptance band and every TUR/TAR/PFA/PFR built on it.
    const roundTrippedRes = (0.1 * 6894.76) / 6894.76; // 0.10000000000000002
    expect(roundTrippedRes).not.toBe(0.1);
    const r = snapLimitsToResolution(9.5, 10.5, roundTrippedRes);
    expect(r.low).toBeCloseTo(9.5, 9);
    expect(r.high).toBeCloseTo(10.5, 9);
    expect(r.high - r.low).toBeCloseTo(1.0, 9); // span preserved
    expect((r.high + r.low) / 2).toBeCloseTo(10.0, 9); // band stays centered
  });
});

describe("getTmdeAbsoluteLimits", () => {
  const uutNominal = { value: "10", unit: "psig" };
  const num = (s) => parseFloat(String(s).split(" ")[0]);

  test("percent-of-reading TMDE is anchored on the UUT nominal", () => {
    const r = getTmdeAbsoluteLimits(
      [{ reading: { high: "0.1", low: "-0.1", unit: "%" } }],
      uutNominal,
    );
    expect(num(r.low)).toBeCloseTo(9.99, 6); // 10 - 0.1% of 10
    expect(num(r.high)).toBeCloseTo(10.01, 6);
  });

  test("percent-of-full-scale TMDE uses the range FS, not the nominal", () => {
    const r = getTmdeAbsoluteLimits(
      [{ range: { value: 50, high: "1", low: "-1", unit: "%" } }],
      uutNominal,
    );
    expect(num(r.low)).toBeCloseTo(9.5, 6); // 10 -+ 1% of 50
    expect(num(r.high)).toBeCloseTo(10.5, 6);
  });

  test("quantity scales the combined span", () => {
    const r = getTmdeAbsoluteLimits(
      [{ quantity: 2, reading: { high: "0.1", low: "-0.1", unit: "%" } }],
      uutNominal,
    );
    expect(num(r.low)).toBeCloseTo(9.98, 6);
    expect(num(r.high)).toBeCloseTo(10.02, 6);
  });

  test("missing TMDE or nominal returns N/A", () => {
    expect(getTmdeAbsoluteLimits([], uutNominal)).toEqual({
      high: "N/A",
      low: "N/A",
    });
    expect(
      getTmdeAbsoluteLimits([{ reading: { high: "0.1", unit: "%" } }], {
        value: "",
        unit: "psig",
      }),
    ).toEqual({ high: "N/A", low: "N/A" });
  });
});

describe("getTmdeAbsoluteLimitEntries", () => {
  test("supports legacy resistance aliases without duplicating unit menus", () => {
    expect(unitSystem.units.ohm).toBe(unitSystem.units.Ohm);
    expect(unitSystem.units["Ω"]).toBe(unitSystem.units.Ohm);
    expect(Object.keys(unitSystem.units)).not.toContain("ohm");
    expect(Object.keys(unitSystem.units)).not.toContain("Ω");
  });

  test("preserves the limits and labels of every derived TMDE", () => {
    const entries = getTmdeAbsoluteLimitEntries([
      {
        id: "tmde-a",
        variableType: "Voltage",
        description: "Meter A",
        measurementPoint: { value: "10", unit: "V" },
        reading: { high: "1", low: "-1", unit: "%" },
      },
      {
        id: "tmde-b",
        variableType: "Resistance",
        description: "Meter B",
        measurementPoint: { value: "100", unit: "ohm" },
        reading: { high: "2", low: "-2", unit: "%" },
      },
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: "tmde-a",
      variableType: "Voltage",
      description: "Meter A",
      low: "9.900000 V",
      high: "10.10000 V",
    });
    expect(entries[1]).toMatchObject({
      id: "tmde-b",
      variableType: "Resistance",
      description: "Meter B",
      low: "98.00000 Ω",
      high: "102.0000 Ω",
    });
  });
});

describe("legacy BRG-3100 correlation validation (riskCompute)", () => {
  test("clears risk for the historical fixture's physically invalid correlation matrix", () => {
    const fp = path.resolve(
      __dirname,
      "../../../../../../Backend/ac_shunt/uncertainty/fixtures/mock/Derived.json",
    );
    const session = JSON.parse(fs.readFileSync(fp, "utf8"));
    const sessionData = {
      uncReq: session.uncReq,
      uutTolerance: session.uutTolerance,
    };
    const tp = session.testPoints.find((p) => p.section === "4.1.9");
    expect(tp.inputCorrelations).toEqual({
      "Length|Weight": 1,
      "UUT Resolution|Weight": 1,
    });
    expect(computePointRiskMetrics(tp, sessionData)).toBeNull();
  });
});

describe("derived acceptance-grid routing to final V8.00 risk", () => {
  const vector = release.cases.find(({ source }) => source.mainRow === 5);
  const { input, expected } = vector;
  const sessionData = { uncReq: {
    uncertaintyConfidence: 95, reliability: input.reop * 100,
    measRelCalcAssumed: input.reop * 100, neededTUR: input.turNeeded,
    reqPFA: input.pfaTarget * 100, calInt: input.originalInterval,
  } };
  const makePoint = (key, resolution = input.resolution) => ({
    id: "derived-flow-grid",
    measurementType: "derived", equationString: "y = x",
    variableMappings: { x: "Flow" }, tmdeTolerances: [],
    testPointInfo: { parameter: { value: input.nominal, unit: "gpm" } },
    components: [{
      id: "flow-source", variableType: "Flow", nominal: input.nominal,
      value_native: input.uCal / 1.959963984540054, unit_native: "gpm", dof: Infinity,
    }],
    uutTolerance: {
      // Authored limits 159.551..160.449 must snap to the saved row's
      // 159.6..160.4. A missing-key regression would widen this band's TUR.
      floor: { high: 0.449, low: -0.449, unit: "gpm", symmetric: true },
      [key]: resolution, measuringResolutionUnit: "gpm", resolutionUnit: "gpm",
      includeResolutionInBudget: false,
    },
  });

  test.each(["measuringResolution", "resolution"])("%s snaps derived limits and preserves saved PFA/PFR/TUR", (key) => {
    // These are independent saved Excel cells (MAIN W5/AP5/AQ5), not outputs
    // captured from the app. The synthetic identity equation isolates routing.
    const metrics = computePointRiskMetrics(makePoint(key), sessionData);
    expect(metrics).not.toBeNull();
    expect(metrics.tur).toBeCloseTo(input.tur, 7);
    expect(metrics.pfa).toBeCloseTo(expected.pfa * 100, 7);
    expect(metrics.pfr).toBeCloseTo(expected.pfr * 100, 7);
    const unsnapped = computePointRiskMetrics(makePoint(key, 0), sessionData);
    expect(unsnapped.tur).toBeCloseTo(0.449 / input.uCal, 7);
    expect(unsnapped.tur).toBeGreaterThan(metrics.tur);
  });
});

describe("resolveResolutionNative key fallback", () => {
  test("reads `measuringResolution`, falling back to `resolution`", () => {
    expect(
      resolveResolutionNative({ measuringResolution: "0.00001" }, "in-oz"),
    ).toBeCloseTo(1e-5, 12);
    // Derived (equation) shape: LSD lives under `resolution`.
    expect(
      resolveResolutionNative(
        { resolution: "0.00001", measuringResolutionUnit: "in-oz" },
        "in-oz",
      ),
    ).toBeCloseTo(1e-5, 12);
    // measuringResolution wins when both are present.
    expect(
      resolveResolutionNative(
        { measuringResolution: "0.00002", resolution: "0.00001" },
        "in-oz",
      ),
    ).toBeCloseTo(2e-5, 12);
    // No usable resolution -> 0 (snap becomes a no-op).
    expect(resolveResolutionNative({}, "in-oz")).toBe(0);
  });
});
