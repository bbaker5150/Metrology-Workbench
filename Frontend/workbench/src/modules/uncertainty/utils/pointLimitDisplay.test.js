import { expect, it } from "vitest";
import { formatPointLimit, matchingResolution, pointDisplayResolution } from "./pointLimitDisplay";

it("uses compact significant digits without a matching resolution", () => {
  expect(formatPointLimit(100)).toBe("100");
  expect(formatPointLimit(1.250000)).toBe("1.25");
  expect(formatPointLimit(.000000025)).toBe("2.5e-8");
  expect(formatPointLimit(null)).toBe("-");
});
it("retains resolution places and uses the finer UUT/TMDE resolution", () => {
  const p={testPointInfo:{parameter:{unit:"V"}},uutTolerance:{resolution:.01,resolutionUnit:"V"},tmdeTolerances:[{resolution:.1,resolutionUnit:"mV"}]};
  expect(pointDisplayResolution(p)).toBeCloseTo(.0001,12);
  expect(formatPointLimit(1.2,pointDisplayResolution(p))).toBe("1.2000");
  expect(formatPointLimit(-.000001,.001)).toBe("0.000");
  expect(formatPointLimit(25,10)).toBe("25");
  expect(formatPointLimit(.5,2.5e-4)).toBe("0.50000");
});
it("rejects resolutions of a different physical quantity", () => {
  expect(matchingResolution({resolution:.001,resolutionUnit:"Ohm"},"A")).toBe(0);
  expect(matchingResolution({resolution:0,resolutionUnit:"A"},"A")).toBe(0);
});
