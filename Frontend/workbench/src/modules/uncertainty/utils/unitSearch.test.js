import { describe, expect, test } from "vitest";
import {
  flattenUnitGroups,
  rankUnitOptions,
} from "./unitSearch";

const groups = [
  {
    label: "Pressure",
    options: [
      { value: "inHg", label: "inHg" },
      { value: "inWa", label: "inWa" },
      { value: "inH2O", label: "inH2O" },
      { value: "psi", label: "psi" },
    ],
  },
  {
    label: "Length",
    options: [
      { value: "in", label: "in." },
      { value: "in2", label: "in2" },
      { value: "m", label: "m" },
    ],
  },
  {
    label: "Time",
    options: [
      { value: "min", label: "min" },
      { value: "s", label: "s" },
    ],
  },
  {
    label: "Flow",
    options: [
      { value: "L/min", label: "L/min" },
      { value: "kg/min", label: "kg/min" },
    ],
  },
  {
    label: "Inductance",
    options: [
      { value: "H", label: "H" },
      { value: "mH", label: "mH" },
      { value: "uH", label: "uH" },
    ],
  },
  {
    label: "Illuminance",
    options: [
      { value: "lx", label: "lx" },
      { value: "fc", label: "fc" },
    ],
  },
];

const labelsFor = (query) =>
  rankUnitOptions(groups, query).map((option) => option.label);

describe("unit search ranking", () => {
  test("ranks a query the way the tasking spells it out", () => {
    // Units starting with "in" (by length), then units containing "in",
    // then units of functions starting with "in", then functions containing it.
    expect(labelsFor("in")).toEqual([
      "in.",
      "in2",
      "inHg",
      "inWa",
      "inH2O",
      "min",
      "L/min",
      "kg/min",
      "H",
      "mH",
      "uH",
      "fc",
      "lx",
    ]);
  });

  test("drops units that match neither the unit nor its function", () => {
    expect(labelsFor("in")).not.toContain("psi");
    expect(labelsFor("in")).not.toContain("m");
    expect(labelsFor("in")).not.toContain("s");
  });

  test("ignores punctuation and case on both sides of the match", () => {
    // "in." normalizes to "in", and "L/min" is still reachable by "MIN".
    // "Illuminance" also contains "min", so its units follow in the last tier.
    expect(labelsFor("IN.")).toContain("in.");
    expect(labelsFor("MIN")).toEqual([
      "min",
      "L/min",
      "kg/min",
      "fc",
      "lx",
    ]);
  });

  test("keeps every unit, in group order, when there is no query", () => {
    const all = rankUnitOptions(groups, "");
    expect(all).toHaveLength(16);
    expect(all[0]).toMatchObject({ value: "inHg", functionName: "Pressure" });
    expect(all.at(-1)).toMatchObject({ value: "fc", functionName: "Illuminance" });
  });

  test("carries each unit's function so the menu can show it inline", () => {
    expect(flattenUnitGroups(groups).find((o) => o.value === "mH")).toMatchObject(
      { functionName: "Inductance" },
    );
    expect(rankUnitOptions(groups, "in")[0]).toMatchObject({
      value: "in",
      functionName: "Length",
    });
  });

  test("matches a function name only when no unit does better", () => {
    // "lx" is an Illuminance unit; searching the function finds it, and the
    // unit-level matches for "l" still come first.
    const ranked = rankUnitOptions(groups, "illum").map((o) => o.value);
    expect(ranked).toEqual(["fc", "lx"]);
  });
});
