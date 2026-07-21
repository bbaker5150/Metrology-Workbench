import { describe, expect, it } from "vitest";
import { getAnchoredMenuPlacement } from "./anchoredMenuPosition";

const rect = (left, top, width = 24, height = 24) => ({
  left,
  right: left + width,
  top,
  bottom: top + height,
});

describe("getAnchoredMenuPlacement", () => {
  it("opens directly below the trigger when there is comfortable room", () => {
    const placement = getAnchoredMenuPlacement({
      anchorRect: rect(900, 100),
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    expect(placement.openBelow).toBe(true);
    expect(placement.top).toBe(130);
    expect(placement.bottom).toBeUndefined();
    expect(placement.left).toBe(504);
  });

  it("anchors a menu's bottom beside a low trigger instead of offsetting by max-height", () => {
    const placement = getAnchoredMenuPlacement({
      anchorRect: rect(900, 730),
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    expect(placement.openBelow).toBe(false);
    expect(placement.top).toBeUndefined();
    expect(placement.bottom).toBe(76);
    expect(placement.maxHeight).toBe(420);
  });

  it("keeps the menu fully inside narrow viewports", () => {
    const placement = getAnchoredMenuPlacement({
      anchorRect: rect(170, 100),
      viewportWidth: 200,
      viewportHeight: 500,
    });

    expect(placement.width).toBe(184);
    expect(placement.left).toBe(8);
  });
});
