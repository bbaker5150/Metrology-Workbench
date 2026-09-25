import { expect, it } from "vitest";
import { newMeasurementAreaColor, resolveSessionMeasurementAreas } from "./measurementAreaGrouping";
import { FUNCTION_COLOR_PALETTE } from "./functionGrouping";
it("randomizes new areas, avoids existing colors, and leaves saved colors unchanged", () => {
  const session = { measurementAreaGroups: [{ name: "First", color: FUNCTION_COLOR_PALETTE[0] }], uuts: [], tmdes: [], testPoints: [] };
  const before = JSON.stringify(session);
  const first = newMeasurementAreaColor(session, () => 0);
  const last = newMeasurementAreaColor(session, () => .999);
  expect(first).not.toBe(session.measurementAreaGroups[0].color);
  expect(first).not.toBe(last);
  expect(JSON.stringify(session)).toBe(before);
  const saved = JSON.parse(JSON.stringify({ ...session, measurementAreaGroups: [...session.measurementAreaGroups, { name: "New", color: last }] }));
  expect(resolveSessionMeasurementAreas(saved).find(a => a.name === "New").color).toBe(last);
});
it("reuses the palette after every color is taken", () => {
  const session = { measurementAreaGroups: FUNCTION_COLOR_PALETTE.map((color,i) => ({ name: `Area ${i}`, color })) };
  expect(FUNCTION_COLOR_PALETTE).toContain(newMeasurementAreaColor(session));
});
