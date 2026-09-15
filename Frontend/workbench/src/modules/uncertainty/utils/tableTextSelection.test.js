import { expect, it, vi } from "vitest";
import { preserveTableTextSelection } from "./tableTextSelection";

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
