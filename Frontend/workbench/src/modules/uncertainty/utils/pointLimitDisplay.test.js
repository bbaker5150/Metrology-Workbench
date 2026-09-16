import { expect, it } from "vitest";
import { formatPointLimit, matchingResolution, pointDisplayResolution } from "./pointLimitDisplay";
import { getAbsoluteLimits } from "./uncertaintyMath";

it("uses compact significant digits without a matching resolution", () => {
  expect(formatPointLimit(100)).toBe("100");
  expect(formatPointLimit(1.250000)).toBe("1.25");
  expect(formatPointLimit(.000000025)).toBe("2.5e-8");
  expect(formatPointLimit(null)).toBe("-");
});
it("uses only resolution components present in the budget, choosing the finest compatible LSD", () => {
  const p={testPointInfo:{parameter:{value:0,unit:'V'}},uutTolerance:{resolution:.001,unit:'V'},components:[]};
  expect(pointDisplayResolution(p)).toBe(0);
  p.components=[{isResolution:true,value_native:.01/3.464,unit_native:'V',distributionDivisor:'3.464'}];
  expect(pointDisplayResolution(p)).toBeCloseTo(.01);
  p.components.push({isResolution:true,value_native:.001/3.464,unit_native:'V',distributionDivisor:'3.464'});
  expect(pointDisplayResolution(p)).toBeCloseTo(.001);
  expect(formatPointLimit(-.123,.01)).toBe('-0.12');
  expect(formatPointLimit(.123,.01)).toBe('0.12');
});
it("rejects resolutions of a different physical quantity", () => {
  expect(matchingResolution({resolution:.001,resolutionUnit:"Ohm"},"A")).toBe(0);
  expect(matchingResolution({resolution:0,resolutionUnit:"A"},"A")).toBe(0);
});

it("formats unsnapped symmetric limits using an included measurement resolution", () => {
  const nominal = { value: 0, unit: 'V' };
  const tolerance = { resolution: .01, resolutionUnit: 'V', includeResolutionInBudget: true,
    floor: { high: .123, low: -.123, symmetric: true, unit: 'V', distribution: '1.732' } };
  const point = { testPointInfo: { parameter: nominal }, uutTolerance: tolerance, components: [] };
  const limits = getAbsoluteLimits(tolerance, nominal, { snap: false });
  const resolution = pointDisplayResolution(point);
  expect(resolution).toBe(.01);
  expect([formatPointLimit(limits.rawLow, resolution), formatPointLimit(limits.rawHigh, resolution)]).toEqual(['-0.12','0.12']);
  point.uutTolerance.includeResolutionInBudget = false;
  expect(pointDisplayResolution(point)).toBe(0);
  expect(formatPointLimit(limits.rawLow)).toBe('-0.123');
});
