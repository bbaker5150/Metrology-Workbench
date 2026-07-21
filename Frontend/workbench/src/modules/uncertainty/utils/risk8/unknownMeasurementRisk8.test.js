import { describe, expect, test } from "vitest";
import {
  computeUnknownMeasurementBoundary8,
  isUnknownMeasurementTolerance,
  toUnknownMeasurementSummary,
} from "./unknownMeasurementRisk8";

const tolerance = (direction, measurement = "unknown") => ({
  singleSided: { direction, measurement, limit: direction === "low" ? 9 : 11 },
});

describe("unknown-measurement Risk 8.0 app wiring", () => {
  test("recognizes only the explicit measurement-unknown case", () => {
    expect(isUnknownMeasurementTolerance(tolerance("low"))).toBe(true);
    expect(isUnknownMeasurementTolerance(tolerance("low", "known"))).toBe(false);
    expect(isUnknownMeasurementTolerance({})).toBe(false);
  });

  test.each([
    ["low", "GB_LL", "GB_UL"],
    ["high", "GB_UL", "GB_LL"],
  ])("computes the %s physical acceptance boundary", (direction, active, inactive) => {
    const boundary = computeUnknownMeasurementBoundary8({
      tolerance: tolerance(direction),
      uCalNative: 0.1,
      reqPFA: 0.02,
      resolution: 0.01,
    });

    expect(boundary.computed).toBe(true);
    expect(boundary.out.statusMit).toBe("OK");
    expect(boundary.fields.PFA_With_GB).toBe(0.02);
    expect(typeof boundary.fields[active]).toBe("number");
    expect(boundary.fields[inactive]).toBe("");
    expect(boundary.fields.Test_PFA).toBe("");
    expect(boundary.fields.Test_PFR).toBe("");
    expect(boundary.fields.REOP_At_Test_TUR).toBe("");
  });

  test("summary exposes boundary PFA and leaves measured-value metrics unavailable", () => {
    const summary = toUnknownMeasurementSummary(
      computeUnknownMeasurementBoundary8({
        tolerance: tolerance("low"),
        uCalNative: 0.1,
        reqPFA: 0.02,
      })
    );

    expect(summary.pfa).toBe(2);
    expect(summary.gbPfa).toBe(2);
    expect(summary.gbLow).toBeTypeOf("number");
    expect(summary.pfr).toBeUndefined();
    expect(summary.tur).toBeUndefined();
    expect(summary.tar).toBeUndefined();
  });
});
