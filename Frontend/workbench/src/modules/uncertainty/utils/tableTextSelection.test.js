import { expect, it, vi } from "vitest";
import { isTableDragBlockedTarget, isTableTextTarget, preserveTableTextSelection } from "./tableTextSelection";

it.each(['range-row-add', 'range-row-delete'])("allows a slightly moving click on %s inside the text wrapper", className => {
  const root = document.createElement('div');
  root.innerHTML = `<div class="point-grid-item"><div class="inline-range-main"><button class="${className}"><svg><path /></svg></button><button class="inline-tolerance-summary">0 to 10 V</button></div></div>`;
  document.body.append(root);
  const target = root.querySelector('path');
  const summary = root.querySelector('.inline-tolerance-summary');
  expect(isTableTextTarget(target)).toBe(false);
  expect(isTableDragBlockedTarget(target)).toBe(true);
  expect(isTableTextTarget(summary)).toBe(true);
  expect(isTableDragBlockedTarget(summary)).toBe(true);
  const release = preserveTableTextSelection(root);
  const clicked = vi.fn();
  root.querySelector('button').addEventListener('click', clicked);
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10 }));
  target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 16 }));
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  expect(clicked).toHaveBeenCalledOnce();
  release(); root.remove();
});

it("keeps a selection when release clicks another cell, but allows the next ordinary click", () => {
  const root = document.createElement("div");
  root.innerHTML = '<table><tbody><tr><td><input value="123456789" /></td><td>Other cell</td></tr></tbody></table>';
  document.body.append(root);
  const release = preserveTableTextSelection(root);
  const dismiss = vi.fn(); document.addEventListener("click", dismiss, true);
  const input = root.querySelector("input"), other = root.querySelectorAll("td")[1];
  input.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10 }));
  other.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 150 }));
  other.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  expect(dismiss).not.toHaveBeenCalled();
  other.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 150 }));
  other.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  expect(dismiss).toHaveBeenCalledOnce();
  release(); document.removeEventListener("click", dismiss, true); root.remove();
});
