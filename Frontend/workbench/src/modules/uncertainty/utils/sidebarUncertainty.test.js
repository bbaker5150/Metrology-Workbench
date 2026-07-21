import { describe, expect, test } from "vitest";
import { formatSidebarUncertainty } from "./sidebarUncertainty";

describe("formatSidebarUncertainty", () => {
  test("converts the absolute result to the point's native unit", () => {
    const point = {
      testPointInfo: { parameter: { unit: "lb" } },
      combined_uncertainty: 1000,
      combined_uncertainty_absolute_base: 0.453592,
    };

    expect(formatSidebarUncertainty(point, "combined")).toBe("1.000 lb");
  });

  test("uses the display label for native units and supports expanded results", () => {
    const point = {
      testPointInfo: { parameter: { unit: "degF" } },
      expanded_uncertainty: 1250,
      expanded_uncertainty_absolute_base: 0.55555555,
    };

    expect(formatSidebarUncertainty(point, "expanded")).toContain("°F");
    expect(formatSidebarUncertainty(point, "expanded")).not.toContain("ppm");
  });

  test("falls back to persisted PPM values for older points", () => {
    const point = {
      testPointInfo: { parameter: {} },
      combined_uncertainty: 12.3456,
    };

    expect(formatSidebarUncertainty(point, "combined")).toBe("12.35 ppm");
  });
});
