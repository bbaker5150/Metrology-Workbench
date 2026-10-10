import { describe, expect, it } from "vitest";
import { sidebarMutationAffectsWidths } from "./useSidebarAutoWidths";

describe("sidebar width invalidation", () => {
  it("measures row text and newly added or removed rows, not selection artwork or unrelated controls", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="point-grid-item"><span>2.00%</span></div><svg class="point-selection-outline"><path /></svg><button>Collapse</button>';
    const row = root.querySelector(".point-grid-item");
    expect(sidebarMutationAffectsWidths({ target: row.firstChild.firstChild })).toBe(true);
    expect(sidebarMutationAffectsWidths({ target: root, addedNodes: [row] })).toBe(true);
    expect(sidebarMutationAffectsWidths({ target: root, removedNodes: [row] })).toBe(true);
    expect(sidebarMutationAffectsWidths({ target: root.querySelector("path") })).toBe(false);
    expect(sidebarMutationAffectsWidths({ target: root, addedNodes: [root.querySelector("svg")] })).toBe(false);
    expect(sidebarMutationAffectsWidths({ target: root.querySelector("button").firstChild })).toBe(false);
  });
});
