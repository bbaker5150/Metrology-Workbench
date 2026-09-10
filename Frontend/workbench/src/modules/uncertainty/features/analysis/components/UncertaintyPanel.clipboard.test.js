import { describe, it, expect } from "vitest";
import { cutInstrumentsFromSession, pasteInstrumentIntoSession, pasteRangeIntoItem, sortRangesInItem } from "./UncertaintyPanel";
import { makeMeasurementAreaKey } from "../../../utils/measurementAreaGrouping";
import { formatInstrumentIdentity } from "../../../utils/instrumentIdentity";
const item = (id, area) => ({ id, nickname: "Tag", measurementAreaNames: [area], instrument: {
 id: id + "-definition", manufacturer: "Acme", model: "123", name: "Meter",
 functions: [{ name: "Length", unit: "m", ranges: [{ id: "r1", min: 0, max: 10 }, { id: "r2", min: 10, max: 20 }] }],
} });
describe("instrument clipboard destinations", () => {
  it.each(["uut", "tmde"])("pastes across tables into the selected area and position (%s)", kind => {
    const source = item("source", "Temperature");
    const first = item("first", "Torque"), last = item("last", "Torque");
    const session = { uuts: [source, first, last], tmdes: [first, last] };
    const result = pasteInstrumentIntoSession(session, { kind: kind === "uut" ? "tmde" : "uut", mode: "copy", item: source }, kind, makeMeasurementAreaKey("Torque"), first.id);
    const rows = result.session[kind + "s"];
    expect(rows.indexOf(result.row)).toBe(rows.indexOf(first) + 1);
    expect(result.row.measurementAreaNames).toEqual(["Torque"]);
    expect(result.row.instrument.functions).toEqual(source.instrument.functions);
    expect(result.row.id).not.toBe(source.id);
    expect(result.row.instrument.id).not.toBe(source.instrument.id);
    expect(session.uuts).toHaveLength(3);
  });
  it("appends a header paste within its area", () => {
    const source = item("source", "Temperature"), target = item("target", "Torque");
    const session = { uuts: [target, source], tmdes: [] };
    const result = pasteInstrumentIntoSession(session, { kind: "uut", mode: "copy", item: source }, "uut", makeMeasurementAreaKey("Torque"));
    expect(result.session.uuts.map(x => x.id)).toEqual([target.id, result.row.id, source.id]);
  });
  it("moves a cut instrument across tables once", () => {
    const source = item("source", "Temperature"), target = item("target", "Torque");
    const result = pasteInstrumentIntoSession({ uuts: [source], tmdes: [target] }, { kind: "uut", mode: "cut", item: source }, "tmde", makeMeasurementAreaKey("Torque"), target.id);
    expect(result.session.uuts).toEqual([]);
    expect(result.session.tmdes.map(x => x.id)).toEqual(["target", "source"]);
    expect(result.row.measurementAreaNames).toEqual(["Torque"]);
  });
  it("inserts a pasted range directly below its target", () => {
    const source = item("source", "Torque");
    const result = pasteRangeIntoItem(source, "r1", { id: "old", min: 50, max: 100 });
    expect(result.item.instrument.functions[0].ranges.map(x => x.id)).toEqual(["r1", result.newRangeId, "r2"]);
    expect(source.instrument.functions[0].ranges).toHaveLength(2);
    expect(sortRangesInItem(result.item)).toBe(result.item);
  });
});
describe("shared instrument display names", () => {
  it("includes the tag and full identity", () => expect(formatInstrumentIdentity(item("one", "Torque"))).toBe("(Tag) Acme 123 Meter"));
  it("omits missing parts without separators", () => expect(formatInstrumentIdentity({ nickname: " A ", description: "Meter" })).toBe("(A) Meter"));
  it("does not duplicate an already combined name", () => expect(formatInstrumentIdentity({ manufacturer: "Acme", model: "123", description: "Acme 123 Meter" })).toBe("Acme 123 Meter"));
});

it("cuts only the selected membership and pastes an independent row when another area retains the original", () => {
  const source = { ...item("one", "Torque"), measurementAreaNames: ["Torque", "Inspection"] };
  const other = item("two", "Torque");
  const entries = [{ kind: "uut", item: source, sourceFunctionKey: "torque" }, { kind: "tmde", item: other, sourceFunctionKey: "torque" }];
  const session = { uuts: [source], tmdes: [other], measurementAreaGroups: [{ name: "Torque" }, { name: "Inspection" }, { name: "Voltage" }] };
  const cut = cutInstrumentsFromSession(session, entries);
  expect(cut.uuts[0].measurementAreaNames).toEqual(["Inspection"]);
  expect(cut.tmdes).toEqual([]);
  const result = pasteInstrumentIntoSession(cut, { items: entries, mode: "cut", detached: true }, "uut", "voltage");
  expect(result.session.uuts).toHaveLength(3);
  expect(new Set(result.session.uuts.map(row => row.id)).size).toBe(3);
  expect(result.session.uuts[1].id).not.toBe(source.id);
  expect(result.session.uuts[1].instrument.id).not.toBe(source.instrument.id);
  expect(result.session.uuts[0].measurementAreaNames).toEqual(["Inspection"]);
  expect(result.session.uuts[1].measurementAreaNames).toEqual(["Voltage"]);
  expect(result.session.uuts[2].instrument.functions).toEqual(other.instrument.functions);
  expect(session.uuts[0].measurementAreaNames).toEqual(["Torque", "Inspection"]);
});

it.each(["uut", "tmde"])("keeps repeated copies independent in %s", kind => {
  const source = item("source", "Torque");
  source.sourceId = source.id;
  source.definitionId = source.instrument.id;
  const session = { uuts: [source], tmdes: [], measurementAreaGroups: [{ name: "Torque" }, { name: "Inspection" }] };
  const clip = { kind: "uut", mode: "copy", item: source };
  const first = pasteInstrumentIntoSession(session, clip, kind, "inspection");
  const second = pasteInstrumentIntoSession(first.session, clip, kind, "inspection");
  const rows = [...second.session.uuts, ...second.session.tmdes];
  expect(new Set(rows.map(row => row.id)).size).toBe(3);
  expect(new Set(rows.map(row => row.instrument.id)).size).toBe(3);
  expect(second.row.sourceId).toBe(second.row.id);
  expect(second.row.definitionId).toBe(second.row.instrument.id);
  expect(source.measurementAreaNames).toEqual(["Torque"]);
});
