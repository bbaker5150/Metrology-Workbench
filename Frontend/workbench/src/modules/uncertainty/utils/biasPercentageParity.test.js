import { describe, expect, it } from "vitest";
import { biasInUnit, resolveMeasurementBias } from "./measurementBias";
import { getBiasToleranceFrame } from "./biasToleranceFrame";
import { buildRisk8Contract } from "./risk8/riskAdapter8";
import { suppliedCase } from "./risk8/suppliedBiasParity.fixtures";
import vectors from "./risk8/suppliedBiasParityVectors.json";
import { biasFixture } from "./measurementBias.fixtures";
import { measurementInputBias } from "../features/analysis/components/MeasurementInputBias";
import { computePointRiskMetrics } from "./riskCompute";

const percent = value => ({ value, kind: "percent" });
const pointFor = (nominal, tolerance, unit = "V") => ({
  testPointInfo: { parameter: { value: nominal, unit } }, uutTolerance: tolerance,
  uutBias: { mode: "override", ...percent(50) }, measurementBias: { mode: "manual", ...percent(20) },
});

describe("workbook percentage bias frame", () => {
  it.each([
    [100, 90, 110, { floor: { low: -10, high: 10, unit: "V" } }],
    [100, 95, 115, { floor: { low: -5, high: 15, unit: "V" } }],
    [100, 90, NaN, { singleSided: { measurement: "known", direction: "low", limit: 90 } }],
    [100, NaN, 110, { singleSided: { measurement: "known", direction: "high", limit: 110 } }],
    [-100, -110, -90, { floor: { low: -10, high: 10, unit: "V" } }],
    [0, -10, 10, { floor: { low: -10, high: 10, unit: "V" } }],
  ])("uses exactly workbook K=.5 / L=.2 for nominal %s and limits %s / %s", (nominal, lower, upper, tolerance) => {
    const point = pointFor(nominal, tolerance);
    const bias = resolveMeasurementBias(point);
    expect(bias.error).toBeNull();
    expect(bias.uutBias).toBe(5);
    expect(bias.calBias).toBe(2);
    const contract = buildRisk8Contract({ nominal, uutLowerLimit: lower, uutUpperLimit: upper, riskAverage: bias.riskAverage, calBias: bias.calBias });
    expect(contract.input.mu).toBe(.5);
    expect(contract.input.xcal).toBe(.2);
  });

  it("uses live tolerance terms including IV, full scale, and whichever is greater", () => {
    const point = pointFor(100, { reading: { low: -2, high: 2, unit: "%" }, range: { low: -1, high: 1, unit: "%", value: 200 }, floor: { low: -1, high: 1, unit: "V" } });
    expect(getBiasToleranceFrame(point).halfSpan).toBe(5);
    expect(resolveMeasurementBias(point).calBias).toBe(1);
    point.uutTolerance.whicheverIsGreater = true;
    expect(getBiasToleranceFrame(point).halfSpan).toBe(2);
    expect(resolveMeasurementBias(point).calBias).toBe(.4);
    point.testPointInfo.parameter.value = 300;
    expect(getBiasToleranceFrame(point).halfSpan).toBe(6);
    expect(resolveMeasurementBias(point).calBias).toBeCloseTo(1.2);
  });

  it("uses the active snapped acceptance limits and never falls back to nominal magnitude", () => {
    const point = pointFor(100, { floor: { low: -1.04, high: 1.06, unit: "V" }, resolution: .1 });
    expect(getBiasToleranceFrame(point).halfSpan).toBeCloseTo(1);
    expect(resolveMeasurementBias(point, {}, undefined, { limits: { lower: 98, upper: 106 } }).calBias).toBeCloseTo(.8);
    point.uutTolerance = {};
    expect(resolveMeasurementBias(point).error).toMatch(/UUT tolerance/);
    point.uutBias.value = 0; point.measurementBias.value = 0;
    expect(resolveMeasurementBias(point).error).toBeNull();
  });

  it("keeps signed temperature offsets and unitless percentage frames coherent", () => {
    const frame = { halfSpan: 18, center: 32, unit: "degF" };
    expect(biasInUnit(percent(-50), { value: 0, unit: "degC" }, "degC", frame)).toBeCloseTo(-5);
    const point = pointFor(100, { floor: { low: -10, high: 10, unit: "" } }, "");
    expect(resolveMeasurementBias(point).calBias).toBe(2);
  });

  it("treats a derived source percent as an output share, while native sources retain signed derivatives", () => {
    const { point, session } = biasFixture();
    const source = session.tmdes[1].instrument.functions[0].ranges[0].tolerances;
    source.bias = percent(20); // Final UUT h=2 A => +.4 A, despite negative dI/dR.
    const result = resolveMeasurementBias(point, session);
    expect(result.error).toBeNull();
    expect(result.calBias).toBeCloseTo(.5); // +.1 A voltage contribution +.4 A normalized contribution.
    const resistance = { name: "Resistance", symbol: "R", value: .1, unit: "Ohm" };
    expect(measurementInputBias(point, session, resistance, "percent")).toBeCloseTo(20);
    expect(measurementInputBias(point, session, resistance)).toBeCloseTo(-.004);
    expect(measurementInputBias(point, session, resistance, "adjusted")).toBeCloseTo(.096);
    point.variableNominals.V.value = 2;
    point.testPointInfo.parameter.value = 20;
    expect(resolveMeasurementBias(point, session).calBias).toBeCloseTo(.5);
    expect(measurementInputBias(point, session, resistance)).toBeCloseTo(-.002);
    // Shared source follows the destination UUT tolerance, never a cached offset.
    point.uutTolerance.floor = { low: -5, high: 5, unit: "A" };
    expect(resolveMeasurementBias(JSON.parse(JSON.stringify(point)), session).calBias).toBeCloseTo(1.1);
    point.measurementBias = { mode: "manual", ...percent(-20) };
    expect(resolveMeasurementBias(point, session).calBias).toBe(-1);
    expect(measurementInputBias(point, session, resistance, "percent")).toBe(20);
  });

  it.each([5, 6])("ignores both authored bias columns for unknown-value type %s like workbook ComputeOneRow", type => {
    const { point, session } = suppliedCase(vectors.cases.find(row => row.type === type));
    const baseline = computePointRiskMetrics(point, session, true);
    expect(baseline).not.toBeNull();
    for (const kind of ["absolute", "percent"]) {
      point.uutBias = { mode: "override", value: 50, unit: "V", kind };
      point.measurementBias = { mode: "manual", value: -20, unit: "V", kind };
      expect(resolveMeasurementBias(point, session)).toMatchObject({ uutBias: 0, calBias: 0, error: null, uutOrigin: "unavailable" });
      expect(computePointRiskMetrics(point, session, true)).toEqual(baseline);
    }
  });

  it("keeps an output percentage defined at zero input sensitivity without inventing a native equivalent", () => {
    const { point, session } = biasFixture();
    point.equationString = "V + 0*R";
    point.testPointInfo.parameter = { value: 1, unit: "V" };
    point.uutTolerance.floor = { low: -2, high: 2, unit: "V" };
    session.tmdes[1].instrument.functions[0].ranges[0].tolerances.bias = percent(20);
    const result = resolveMeasurementBias(point, session);
    expect(result.error).toBeNull();
    expect(result.calBias).toBeCloseTo(.41);
    const variable = { name: "Resistance", symbol: "R", value: .1, unit: "Ohm" };
    expect(measurementInputBias(point, session, variable, "percent")).toBe(20);
    expect(measurementInputBias(point, session, variable)).toBeNaN();
  });
});

// Regression for the reported 2 -> 20 and 4.2 -> 42 discrepancy. Excel stores
// 2% as .02 and 4.2% as .042. For a 100 V point with +/-10 V tolerance, their
// native offsets are .2 V and .42 V; using nominal as the base gives a 10x error.
it.each([2, 4.2, -2, -4.2])('keeps an entered %s percent equal to the workbook fraction for UUT and cal', value => {
  for (const role of ['uut', 'cal']) {
    const { point, session } = suppliedCase(vectors.cases.find(row => row.type === 1 && row.uutBias === 0 && row.calBias === 0));
    if (role === 'uut') point.uutBias = { mode: 'override', kind: 'percent', value };
    else session.tmdes[0].ranges[0].tolerances.bias = { kind: 'percent', value };
    const bias = resolveMeasurementBias(point, session);
    const offset = role === 'uut' ? bias.uutBias : bias.calBias;
    expect(offset).toBeCloseTo(value / 100 * 10, 12);
    const contract = buildRisk8Contract({ nominal: 100, uutLowerLimit: 90, uutUpperLimit: 110, riskAverage: bias.riskAverage, calBias: bias.calBias });
    expect(role === 'uut' ? contract.input.mu : contract.input.xcal).toBeCloseTo(value / 100, 12);
    const percentRisk = computePointRiskMetrics(point, session, true);
    expect(percentRisk).not.toBeNull();
    if (role === 'uut') point.uutBias = { mode: 'override', value: value / 10, kind: 'absolute', unit: 'V' };
    else session.tmdes[0].ranges[0].tolerances.bias = { value: value / 10, kind: 'absolute', unit: 'V' };
    expect(computePointRiskMetrics(point, session, true)).toEqual(percentRisk);
  }
});
