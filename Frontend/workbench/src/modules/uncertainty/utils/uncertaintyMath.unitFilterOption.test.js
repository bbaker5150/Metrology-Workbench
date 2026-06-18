import { describe, expect, it } from "vitest";
import { unitFilterOption } from "./uncertaintyMath";

// react-select passes options shaped as { label, value, data }.
const opt = (value, label) => ({ value, label: label ?? value });

describe("unitFilterOption", () => {
  it("matches by category name so typing a category surfaces its units", () => {
    expect(unitFilterOption(opt("rpm", "RPM"), "angular speed")).toBe(true);
    expect(unitFilterOption(opt("rad/s"), "angular")).toBe(true);
    // A unit from a different category must not match the typed category.
    expect(unitFilterOption(opt("V"), "angular speed")).toBe(false);
  });

  it("still matches by display label and raw value", () => {
    expect(unitFilterOption(opt("rpm", "RPM"), "rpm")).toBe(true);
    expect(unitFilterOption(opt("uV", "µV"), "µV")).toBe(true);
    expect(unitFilterOption(opt("Ohm", "Ω"), "ohm")).toBe(true);
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(unitFilterOption(opt("rpm", "RPM"), "  ANGULAR SPEED ")).toBe(true);
  });

  it("returns true for empty input (show everything)", () => {
    expect(unitFilterOption(opt("V"), "")).toBe(true);
    expect(unitFilterOption(opt("V"), "   ")).toBe(true);
  });
});
