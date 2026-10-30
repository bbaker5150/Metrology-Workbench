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
    row.firstChild.className = 'point-value is-cell-hovered';
    expect(sidebarMutationAffectsWidths({ type: 'attributes', attributeName: 'class', oldValue: 'point-value', target: row.firstChild })).toBe(false);
    row.firstChild.className = 'point-value is-editing';
    expect(sidebarMutationAffectsWidths({ type: 'attributes', attributeName: 'class', oldValue: 'point-value', target: row.firstChild })).toBe(true);
    row.className = 'point-grid-item active active-point table-highlight';
    expect(sidebarMutationAffectsWidths({ type: 'attributes', attributeName: 'class', oldValue: 'point-grid-item', target: row })).toBe(false);
    row.firstChild.style.gridArea = 'value';
    expect(sidebarMutationAffectsWidths({ type: 'attributes', attributeName: 'style', oldValue: row.firstChild.getAttribute('style'), target: row.firstChild })).toBe(false);
  });
});
