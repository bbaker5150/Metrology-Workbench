// Stored colors are the light-theme shades. Dark mode lifts these same hues
// for labels and controls without changing the saved swatch or exports.
export const MEASUREMENT_AREA_COLORS = [
  "#225d95", "#21644a", "#924412", "#694193",
  "#9d384a", "#196166", "#775421", "#514a8f",
];
export const DEFAULT_MEASUREMENT_AREA_COLOR = MEASUREMENT_AREA_COLORS[0];

export function measurementAreaAccent(color) {
  return MEASUREMENT_AREA_COLORS.includes(color?.toLowerCase?.())
    ? `color-mix(in srgb, ${color}, var(--area-accent-lightener, ${color}) 45%)`
    : color;
}
