import { expect, it } from "vitest";
import { formatPointLimit, matchingResolution, pointDisplayResolution } from "./pointLimitDisplay";

it("uses compact significant digits without a matching resolution", () => {
  expect(formatPointLimit(100)).toBe("100");
  expect(formatPointLimit(1.250000)).toBe("1.25");
  expect(formatPointLimit(.000000025)).toBe("2.5e-8");
  expect(formatPointLimit(null)).toBe("-");
});
it("keeps UUT precision independent of finer TMDE resolutions", () => {
  const p={testPointInfo:{parameter:{unit:"V"}},uutTolerance:{resolution:.01,resolutionUnit:"V"},tmdeTolerances:[{resolution:.1,resolutionUnit:"mV"}]};
  expect(pointDisplayResolution(p)).toBe(.01);
  expect(formatPointLimit(1.2,pointDisplayResolution(p))).toBe("1.20");
  expect(formatPointLimit(-.000001,.001)).toBe("0.000");
  expect(formatPointLimit(25,10)).toBe("25");
  expect(formatPointLimit(.5,2.5e-4)).toBe("0.50000");
});

it("uses the UUT range containing the point instead of a stale selected range", () => {
  const session = { uuts: [{ id: 'uut', ranges: [{ id: 'small', min: 0, max: 1, unit: 'V', resolution: .001 }, { id: 'large', min: 1, max: 10, unit: 'V', resolution: .1 }] }] };
  const point = { activeUutId: 'uut', testPointInfo: { parameter: { value: 5, unit: 'V' } }, uutTolerance: { rangeId: 'small', resolution: .001 } };
  expect(pointDisplayResolution(point, session)).toBe(.1);
  point.testPointInfo.parameter = { value: 500, unit: 'mV' };
  expect(pointDisplayResolution(point, session)).toBe(1);
  point.testPointInfo.parameter = { value: 50, unit: 'V' };
  expect(pointDisplayResolution(point, session)).toBe(0);
});
it("rejects resolutions of a different physical quantity", () => {
  expect(matchingResolution({resolution:.001,resolutionUnit:"Ohm"},"A")).toBe(0);
  expect(matchingResolution({resolution:0,resolutionUnit:"A"},"A")).toBe(0);
});
