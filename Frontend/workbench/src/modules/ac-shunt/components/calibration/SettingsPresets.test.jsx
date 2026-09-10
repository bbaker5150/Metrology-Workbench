import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import SettingsPresets, { readDefaultSettingsPreset } from "./SettingsPresets";
beforeEach(() => localStorage.clear());
it("saves, loads and defaults a named setup without persisting point identifiers", () => {
  const apply = vi.fn();
  render(<SettingsPresets settings={{ id: 99, n_cycles: 12, nplc: 50 }} keys={["n_cycles", "nplc"]} onApply={apply} />);
  fireEvent.change(screen.getByLabelText("New setup name"), { target: { value: "Fast check" } });
  fireEvent.click(screen.getByText("Save as new setup"));
  fireEvent.click(screen.getByText("Use as default"));
  expect(readDefaultSettingsPreset()).toEqual({ n_cycles: 12, nplc: 50 });
  fireEvent.click(screen.getByText("Load"));
  expect(apply).toHaveBeenCalledWith({ n_cycles: 12, nplc: 50 });
  fireEvent.click(screen.getByText("Delete setup"));
  expect(readDefaultSettingsPreset()).toEqual({});
});
