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

it("replaces Units when the first UUT is assigned, but respects a later opt-out", () => {
  const previous = { uuts: [], testPoints: [{ id: "p", associatedUutIds: [], testPointInfo: { measurementArea: "Fresh", parameter: { value: 5, unit: "", unitSelectionExplicit: true } } }] };
  const current = { ...previous, uuts: [{ id: "new", measurementAreaNames: ["Fresh"], ranges: [{ id: "v", unit: "V" }] }] };
  expect(inheritMissingPointUnits(current, previous)).toBe(current);
  const assigned = { ...current, testPoints: [{ ...current.testPoints[0], associatedUutIds: ['new'] }] };
  const next = inheritMissingPointUnits(assigned, current);
  expect(next.testPoints[0].testPointInfo.parameter).toMatchObject({ value: 5, unit: "V", unitSelectionExplicit: false });
  const optOut = { ...next, testPoints: [{ ...next.testPoints[0], testPointInfo: { ...next.testPoints[0].testPointInfo, parameter: { value: 5, unit: "", unitSelectionExplicit: true } } }] };
  expect(inheritMissingPointUnits(optOut, next)).toBe(optOut);
});

it("keeps an explicit Unassigned choice after instruments are defined", () => {
  const data = { uuts: [{ id: "u", measurementAreaNames: ["Bench"], instrument: { functions: [{ unit: "V", ranges: [{ unit: "V" }] }] } }], testPoints: [{ associatedUutIds: ["u"], testPointInfo: { measurementArea: "Bench", parameter: { unit: "", unitSelectionExplicit: true } } }] };
  expect(inheritMissingPointUnits(data)).toBe(data);
});
it("preserves any explicitly selected unit even when it differs from the instrument", () => {
  const data = { uuts: [{ id: "u", measurementAreaNames: ["Bench"], instrument: { functions: [{ unit: "A", ranges: [{ unit: "A" }] }] } }], testPoints: [{ associatedUutIds: ["u"], testPointInfo: { measurementArea: "Bench", parameter: { unit: "V", unitSelectionExplicit: true } } }] };
  expect(inheritMissingPointUnits(data).testPoints[0].testPointInfo.parameter).toMatchObject({ unit: "V", unitSelectionExplicit: true });
});

it('never inherits from an area UUT before assignment, including load and stale IDs', () => {
  const point = { testPointInfo: { measurementArea: 'Fresh', parameter: { value: 5, unit: '', unitSelectionExplicit: false } }, associatedUutIds: [] };
  const data = { testPoints: [point], uuts: [
    { id: 'new', measurementAreaNames: ['Fresh'], ranges: [{ unit: '' }] },
    { id: 'other', measurementAreaNames: ['Elsewhere'], ranges: [{ unit: 'A' }] },
  ], tmdes: [{ measurementAreaNames: ['Fresh'], ranges: [{ unit: 'Ohm' }] }] };
  expect(inheritMissingPointUnits(data)).toBe(data);
  data.uuts[0].ranges[0].unit = 'V';
  expect(inheritMissingPointUnits(data)).toBe(data);
  point.associatedUutIds = ['deleted'];
  expect(inheritMissingPointUnits(data)).toBe(data);
  point.associatedUutIds = ['new'];
  expect(inheritMissingPointUnits(data).testPoints[0].testPointInfo.parameter.unit).toBe('V');
  point.testPointInfo.parameter.unitSelectionExplicit = true;
  expect(inheritMissingPointUnits(data)).toBe(data);
});
