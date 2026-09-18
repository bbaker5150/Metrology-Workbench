import { describe, expect, it } from "vitest";
import { biasInUnit, getPointBiasSources, resolveMeasurementBias } from "./measurementBias";
import { computePointRiskMetrics } from "./riskCompute";
import { copyPointBudget, pastePointBudget } from "../App";
import { computeUnknownMeasurementBoundary8 } from "./risk8/unknownMeasurementRisk8";
import { computeKnownMeasurementRisk8, computeKnownTwoSidedRisk8 } from "./risk8/knownMeasurementRisk8";

import { biasFixture } from "./measurementBias.fixtures";

describe("measurement bias", () => {
  it("uses interval conversions for temperatures, signed percentages, and rejects incompatible units", () => {
    expect(biasInUnit({ value: 1.8, unit: "degF" }, { value: 20, unit: "degC" })).toBeCloseTo(1);
    expect(biasInUnit({ value: .01, unit: "ohm" }, { value: 1, unit: "Ohm" })).toBeCloseTo(.01);
    expect(biasInUnit({ value: -2, kind: "percent", unit: "V" }, { value: -10, unit: "V" }, "V", { halfSpan: 10, center: -10, unit: "V" })).toBeCloseTo(-.2);
    expect(() => biasInUnit({ value: 1, unit: "V" }, { value: 1, unit: "A" })).toThrow(/units/);
    expect(() => biasInUnit({ value: "abc", unit: "V" }, { value: 1, unit: "V" })).toThrow(/finite/);
  });
  it("preserves legacy means and allows a true zero override without changing the nominal", () => {
    const point = { testPointInfo: { parameter: { value: 10, unit: "V" } } };
    expect(resolveMeasurementBias(point, {}, 10.2).uutBias).toBeCloseTo(.2);
    point.uutBias = { mode: "override", value: 0, unit: "V" };
    expect(resolveMeasurementBias(point, {}, 10.2).riskAverage).toBe(10);
  });
  it("inherits the live UUT range and keeps the point override independent", () => {
    const { point, session } = biasFixture();
    session.uuts = [{ id: "uut", ranges: [{ id: "range", unit: "A", tolerances: { bias: { value: 1, kind: "percent", unit: "A" } } }] }];
    Object.assign(point, { activeUutId: "uut", uutTolerance: { ...point.uutTolerance, rangeId: "range" } });
    expect(resolveMeasurementBias(point, session).uutBias).toBeCloseTo(.02);
    point.uutBias = { mode: "override", value: -.2, unit: "A" };
    expect(resolveMeasurementBias(point, session).uutBias).toBe(-.2);
  });
  it("propagates V/R source errors with signed sensitivities and counts a range only once", () => {
    const { point, session } = biasFixture();
    point.components.push({ ...point.components[1], id: "resolution", tmdeBudgetComponentKind: "Resolution" });
    const result = resolveMeasurementBias(point, session);
    expect(result.error).toBeNull();
    expect(result.sources).toHaveLength(2);
    // dI/dV=10 A/V; dI/dR=-100 A/Ohm => .1 - .2 = -.1 A.
    expect(result.calBias).toBeCloseTo(-.1, 10);
    expect(result.sources.map(row => row.contribution)).toEqual(expect.arrayContaining([expect.closeTo(.1), expect.closeTo(-.2)]));
  });
  it("excludes corrections already applied and lets a net entry replace source calculation", () => {
    const { point, session } = biasFixture();
    const key = getPointBiasSources(point, session)[1].key;
    point.measurementBias = { sources: { [key]: { value: .002, unit: "Ohm", corrected: true } } };
    expect(resolveMeasurementBias(point, session).calBias).toBeCloseTo(.1);
    point.measurementBias = { ...point.measurementBias, mode: "manual", value: -.3, unit: "A" };
    expect(resolveMeasurementBias(point, session).calBias).toBe(-.3);
  });
  it("copies the bias model, preserves the destination UUT bias, and reevaluates changed nominals", () => {
    const { point, session } = biasFixture();
    const key = getPointBiasSources(point, session)[0].key;
    point.measurementBias = { mode: "sources", sources: { [key]: { value: 1, kind: "percent", unit: "V" } } };
    const target = { ...point, id: "target", uutBias: { mode: "override", value: .4, unit: "A" }, variableNominals: { ...point.variableNominals, V: { value: 2, unit: "V" } }, testPointInfo: { parameter: { value: 20, unit: "A" } } };
    const pasted = pastePointBudget(target, copyPointBudget(point));
    expect(pasted.uutBias).toEqual(target.uutBias);
    expect(resolveMeasurementBias(pasted, session).calBias).toBeCloseTo(-.38);
    pasted.variableNominals.V.value = 3;
    expect(resolveMeasurementBias(pasted, session).calBias).toBeCloseTo(-.58);
    expect(point.variableNominals.V.value).toBe(1);
    expect(resolveMeasurementBias(JSON.parse(JSON.stringify(pasted)), JSON.parse(JSON.stringify(session))).calBias).toBeCloseTo(-.58);
  });
  it("changes PFA/PFR through the public calculation without changing budget uncertainty", () => {
    const { point, session } = biasFixture();
    const before = computePointRiskMetrics({ ...point, measurementBias: { mode: "manual", value: 0, unit: "A" } }, session, true);
    const after = computePointRiskMetrics(point, session, true);
    expect(after).not.toBeNull();
    expect(after.tur).toBeCloseTo(before.tur, 12);
    expect(after.pfa).not.toBeCloseTo(before.pfa, 6);
    expect(after.pfr).not.toBeCloseTo(before.pfr, 6);
  });
  it.each(["low", "high"])("passes calibration bias into known %s-limit risk and mitigation", direction => {
    const args = { tolerance: { singleSided: { direction, measurement: "known", limit: direction === "low" ? 9 : 11 } },
      nominal: 10, riskAverage: 10, expandedUncertaintyNative: .25, tur: 4, assumedReop: .85, requiredReop: .85, reqPFA: .02, turNeeded: 4, originalInterval: 12 };
    const zero = computeKnownMeasurementRisk8(args);
    const biased = computeKnownMeasurementRisk8({ ...args, calBias: .1 });
    expect(biased.meta.xcal).toBeCloseTo(.1);
    expect(biased.out.pfa).not.toBeCloseTo(zero.out.pfa, 8);
    expect(biased.diagnostics.core.pPFA).toBeCloseTo(biased.out.pfa, 12);
  });
  it.each(["low", "high"])("keeps physical %s-limit TUR unchanged when an independent UUT bias is entered", direction => {
    const { point, session } = biasFixture();
    point.uutTolerance = { singleSided: { direction, measurement: "known", limit: direction === "low" ? 8 : 12, unit: "A" } };
    const initial = computePointRiskMetrics(point, session, true);
    const biased = computePointRiskMetrics({ ...point, uutBias: { mode: "override", value: .2, unit: "A" } }, session, true);
    expect(initial).not.toBeNull();
    expect(biased.tur).toBeCloseTo(initial.tur, 12);
    expect(biased.pfa).not.toBeCloseTo(initial.pfa, 8);
  });
  it("distinguishes UUT bias from calibration bias even with the same observed mean", () => {
    const args = { nominal: 10, riskAverage: 10, lowerLimit: 9, upperLimit: 11, expandedUncertaintyNative: .25, tur: 4, assumedReop: .85, requiredReop: .85, reqPFA: .02, turNeeded: 4, originalInterval: 12 };
    const uut = computeKnownTwoSidedRisk8({ ...args, riskAverage: 10.1 });
    const cal = computeKnownTwoSidedRisk8({ ...args, calBias: .1 });
    expect(uut.diagnostics.muObserved).toBeCloseTo(cal.diagnostics.muObserved);
    expect(uut.out.pfa).not.toBeCloseTo(cal.out.pfa, 8);
  });
  it.each(["low", "high"])("shifts an unknown %s boundary before snapping, retaining the original true limit", direction => {
    const args = { tolerance: { singleSided: { direction, measurement: "unknown", limit: 10 } }, uCalNative: .1, reqPFA: .02 };
    const zero = computeUnknownMeasurementBoundary8(args);
    const biased = computeUnknownMeasurementBoundary8({ ...args, calBias: -.2 });
    const key = direction === "low" ? "physGbLower" : "physGbUpper";
    expect(biased.out[key]).toBeCloseTo(zero.out[key] - .2, 10);
    expect(biased[direction === "low" ? "lowerLimit" : "upperLimit"]).toBe(10);
    const snapped = computeUnknownMeasurementBoundary8({ ...args, calBias: .013, resolution: .01 });
    expect(snapped.out.mitPfa).toBeLessThanOrEqual(.02 + 1e-12);
  });
});
