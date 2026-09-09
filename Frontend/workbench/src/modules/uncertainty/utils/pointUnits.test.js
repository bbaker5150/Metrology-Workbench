import { describe, it, expect } from "vitest";
import { inheritMissingPointUnits } from "./pointUnits";
describe("missing point unit inheritance", () => {
  const session = (unit) => ({
    uuts: [
      {
        id: "u",
        instrument: { functions: [{ unit, ranges: [{ id: "r", unit }] }] },
      },
    ],
    testPoints: [
      {
        id: "p",
        associatedUutIds: ["u"],
        testPointInfo: { parameter: { value: 3, unit: "" } },
      },
    ],
  });
  it("updates an existing point once the UUT acquires a unit", () => {
    const empty = session("");
    expect(inheritMissingPointUnits(empty)).toBe(empty);
    const next = inheritMissingPointUnits(session("um"));
    expect(next.testPoints[0].testPointInfo.parameter).toEqual({
      value: 3,
      unit: "um",
    });
  });
  it("preserves a user-selected unit and does not guess between multiple range units", () => {
    const data = session("m");
    data.testPoints[0].testPointInfo.parameter.unit = "cm";
    expect(inheritMissingPointUnits(data)).toBe(data);
    data.testPoints[0].testPointInfo.parameter.unit = "";
    data.uuts[0].instrument.functions[0].ranges.push({ id: "r2", unit: "cm" });
    expect(inheritMissingPointUnits(data)).toBe(data);
    data.testPoints[0].uutTolerance = { rangeId: "r2" };
    expect(
      inheritMissingPointUnits(data).testPoints[0].testPointInfo.parameter.unit,
    ).toBe("cm");
  });
});

it("keeps an explicit Unassigned choice after instruments are defined", () => {
  const data = { uuts: [{ id: "u", measurementAreaNames: ["Bench"], instrument: { functions: [{ unit: "V", ranges: [{ unit: "V" }] }] } }], testPoints: [{ associatedUutIds: ["u"], testPointInfo: { measurementArea: "Bench", parameter: { unit: "", unitSelectionExplicit: true } } }] };
  expect(inheritMissingPointUnits(data)).toBe(data);
});
it("unassigns a removed unit without choosing another range's unit", () => {
  const data = { uuts: [{ id: "u", measurementAreaNames: ["Bench"], instrument: { functions: [{ unit: "A", ranges: [{ unit: "A" }] }] } }], testPoints: [{ associatedUutIds: ["u"], testPointInfo: { measurementArea: "Bench", parameter: { unit: "V", unitSelectionExplicit: true } } }] };
  expect(inheritMissingPointUnits(data).testPoints[0].testPointInfo.parameter).toMatchObject({ unit: "", unavailableUnit: "V" });
});
