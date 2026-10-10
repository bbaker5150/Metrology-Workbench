import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BuilderUnitSelect from "./BuilderUnitSelect";

describe("builder unit menu", () => {
  it("focuses search immediately on opening and preserves keyboard selection", () => {
    const onChange = vi.fn();
    render(<BuilderUnitSelect value="V" onChange={onChange}
      options={[{ value: "V", label: "V" }, { value: "A", label: "A" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Unit base unit" }));
    const search = screen.getByPlaceholderText("Search units...");
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "A" } });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("A");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
