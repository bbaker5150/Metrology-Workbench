import { afterEach, expect, it } from "vitest";
import { historyShortcut } from "./historyShortcut";

afterEach(() => document.body.replaceChildren());

const editor = (tag, value = "", qualifier = true) => {
  const cell = document.createElement("div");
  if (qualifier) cell.dataset.qualifierCell = "2";
  const field = document.createElement(tag);
  field.value = value;
  cell.append(field);
  document.body.append(cell);
  field.focus();
  return field;
};

it.each(["input", "textarea"])("uses workspace history for an empty qualifier %s", tag => {
  editor(tag);
  expect(historyShortcut({ key: "z", ctrlKey: true })).toBe("undo");
  expect(historyShortcut({ key: "z", metaKey: true })).toBe("undo");
  expect(historyShortcut({ key: "z", metaKey: true, shiftKey: true })).toBe("redo");
  expect(historyShortcut({ key: "y", ctrlKey: true })).toBe("redo");
});

it.each(["input", "textarea"])("preserves native text undo in a populated qualifier %s", tag => {
  editor(tag, "90 days");
  expect(historyShortcut({ key: "z", ctrlKey: true })).toBeNull();
  expect(historyShortcut({ key: "y", ctrlKey: true })).toBeNull();
});

it("leaves an unrelated empty textarea's history to its editor", () => {
  editor("textarea", "", false);
  expect(historyShortcut({ key: "z", ctrlKey: true })).toBeNull();
});
