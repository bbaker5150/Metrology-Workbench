import { describe, expect, it } from "vitest";
import { unitSystem, unitFilterOption } from "./uncertaintyMath";
import { getUnitSearchNames } from "./unitNames";
import { rankUnitOptions } from "./unitSearch";
const groups = [{ label: "Units", options: Object.keys(unitSystem.units).map(value => ({value, label: value})) }];
describe("unit full-name search", () => {
  it.each([["gram", "g"], ["micrometer", "um"], ["micrometers", "um"], ["micrometre", "um"], ["millivolt", "mV"], ["kilohertz", "kHz"], ["meters per second", "m/s"], ["inches of water", "inH2O"]])("finds %s", (query, value) => {
    expect(rankUnitOptions(groups, query).some(option => option.value === value)).toBe(true);
    expect(unitFilterOption({value, label: value}, query)).toBe(true);
  });
  it("provides a full searchable name for every registered unit", () => {
    const missing = Object.keys(unitSystem.units).filter(unit => getUnitSearchNames(unit)[0] === unit && !["bar", "torr"].includes(unit));
    expect(missing).toEqual([]);
  });
});
