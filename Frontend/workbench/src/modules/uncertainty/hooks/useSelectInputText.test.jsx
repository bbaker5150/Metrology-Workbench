import { render, fireEvent, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import useSelectInputText from "./useSelectInputText";

function Fields() {
  useSelectInputText();
  return <><input aria-label="Value" defaultValue="123.45" /><textarea aria-label="Notes" defaultValue="Existing notes" /><input aria-label="Read only" defaultValue="Keep" readOnly /></>;
}

it("selects existing input and textarea contents on focus and repeat clicks", async () => {
  const { getByLabelText } = render(<Fields />);
  for (const label of ["Value", "Notes"]) {
    const field = getByLabelText(label);
    field.focus();
    await waitFor(() => expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]));
    field.setSelectionRange(2, 2);
    fireEvent.click(field);
    await waitFor(() => expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]));
  }
});

it("preserves deliberate drag selections and leaves read-only text alone", async () => {
  const { getByLabelText } = render(<Fields />);
  const field = getByLabelText("Value");
  field.focus();
  await waitFor(() => expect(field.selectionEnd).toBe(field.value.length));
  fireEvent(field, new MouseEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0 }));
  fireEvent(field, new MouseEvent("pointermove", { bubbles: true, clientX: 20, clientY: 0 }));
  field.setSelectionRange(1, 3);
  fireEvent.click(field);
  await Promise.resolve();
  expect([field.selectionStart, field.selectionEnd]).toEqual([1, 3]);
  const readonly = getByLabelText("Read only");
  readonly.focus(); readonly.setSelectionRange(1, 1); fireEvent.click(readonly);
  await Promise.resolve();
  expect([readonly.selectionStart, readonly.selectionEnd]).toEqual([1, 1]);
});
