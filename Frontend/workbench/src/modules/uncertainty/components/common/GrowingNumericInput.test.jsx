import React, { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import GrowingNumericInput from "./GrowingNumericInput";

it("preserves uncontrolled drafts, blur commits, and forwarded focus refs while growing", () => {
  const ref = createRef(), commit = vi.fn();
  render(<GrowingNumericInput ref={ref} inputMode="decimal" aria-label="Range" defaultValue="1" onBlur={event => commit(event.target.value)} />);
  const input = screen.getByRole('textbox', { name: 'Range' });
  const initialWidth = input.style.getPropertyValue('--numeric-content-width');
  ref.current.focus();
  expect(input).toHaveFocus();
  expect(input.style.getPropertyValue('--numeric-content-width')).toBe(initialWidth);
  fireEvent.change(input, { target: { value: '-123456789.123456789' } });
  expect(input).toHaveValue('-123456789.123456789');
  expect(input.style.getPropertyValue('--numeric-content-width')).not.toBe(initialWidth);
  fireEvent.blur(input);
  expect(commit).toHaveBeenCalledWith('-123456789.123456789');
});
