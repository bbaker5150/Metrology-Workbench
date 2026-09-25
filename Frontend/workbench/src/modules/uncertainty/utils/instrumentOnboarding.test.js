import { describe, it, expect } from "vitest";
import { trackInstrumentOnboarding, showFirstInstrumentHint } from "./instrumentOnboarding";
import { renameMeasurementArea } from "./measurementAreaGrouping";
const empty = { id: 1, measurementAreaGroups: [], uuts: [], tmdes: [] };
describe("first-instrument guidance", () => {
  it("appears only in the first empty area, including after deletion and reload", () => {
    const started = trackInstrumentOnboarding({ ...empty, measurementAreaGroups: [
      { name: "Torque", kind: "uut" }, { name: "Length", kind: "uut" }, { name: "Reference", kind: "tmde" },
    ] }, empty);
    expect(showFirstInstrumentHint(started, "uut", "torque")).toBe(true);
    expect(showFirstInstrumentHint(started, "uut", "length")).toBe(false);
    expect(showFirstInstrumentHint(started, "tmde", "reference")).toBe(true);
    const added = trackInstrumentOnboarding({ ...started, uuts: [{ id: 1, measurementAreaNames: ["Torque"] }] }, started);
    expect(showFirstInstrumentHint(added, "uut", "torque")).toBe(false);
    expect(showFirstInstrumentHint(added, "uut", "length")).toBe(true);
    const removed = trackInstrumentOnboarding({ ...empty }, added);
    const reloaded = JSON.parse(JSON.stringify(removed));
    const recreated = trackInstrumentOnboarding(started, reloaded);
    expect(showFirstInstrumentHint(recreated, "uut", "torque")).toBe(true);
    expect(showFirstInstrumentHint(recreated, "tmde", "reference")).toBe(true);
  });
  it("follows a rename and suppresses hints in existing populated sessions", () => {
    const started = trackInstrumentOnboarding({ ...empty, measurementAreaGroups: [{ name: "Length", kind: "uut" }] });
    const renamed = trackInstrumentOnboarding(renameMeasurementArea(started, { key: "length" }, "Torque"), started);
    expect(showFirstInstrumentHint(renamed, "uut", "torque")).toBe(true);
    expect(showFirstInstrumentHint({ ...started, uuts: [{ measurementAreaNames: ["Length"] }] }, "uut", "length")).toBe(false);
  });
});

it("uses visible table order and skips populated areas", () => {
  const session = { ...empty, uuts: [{ id: 1, measurementAreaNames: ["Filled"] }] };
  const order = ['filled', 'second', 'first'];
  expect(order.filter(key => showFirstInstrumentHint(session, 'uut', key, order))).toEqual(['second']);
  expect(showFirstInstrumentHint(session, 'uut', 'first', ['first'])).toBe(true);
});
