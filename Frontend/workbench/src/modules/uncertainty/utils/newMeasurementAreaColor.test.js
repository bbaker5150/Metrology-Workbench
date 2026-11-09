import { expect, it } from "vitest";
import { newMeasurementAreaColor, resolveSessionMeasurementAreas } from "./measurementAreaGrouping";
import { FUNCTION_COLOR_PALETTE } from "./functionGrouping";
import { measurementAreaAccent } from "./measurementAreaColors";
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

it("gives every automatic label readable contrast on light and dark surfaces", () => {
  const rgb = hex => hex.slice(1).match(/../g).map(channel => parseInt(channel, 16));
  const luminance = channels => channels.map(channel => channel / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (foreground, background) => {
    const [lighter, darker] = [luminance(foreground), luminance(rgb(background))].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
  };
  for (const color of FUNCTION_COLOR_PALETTE) {
    expect(measurementAreaAccent(color)).toContain(`var(--area-accent-lightener, ${color}) 45%`);
    const light = rgb(color);
    const dark = light.map(channel => channel * 0.55 + 255 * 0.45);
    for (const surface of ["#ffffff", "#f1f5f9", "#e2e8f0"]) expect(contrast(light, surface)).toBeGreaterThanOrEqual(4.5);
    for (const surface of ["#111a2e", "#1f2a40", "#27354c"]) expect(contrast(dark, surface)).toBeGreaterThanOrEqual(4.5);
  }
  expect(measurementAreaAccent("#ffff00")).toBe("#ffff00"); // explicitly chosen
});
