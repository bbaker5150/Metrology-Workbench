import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InlineMenuSelect from "./InlineMenuSelect";

describe("inline menu initial layout", () => {
  it("opens and focuses the selected option without waiting for a frame", () => {
    const onChange = vi.fn();
    render(<InlineMenuSelect autoOpen value="b" ariaLabel="Distribution" showOptionMeta={false}
      options={[{ value: "a", label: "First" }, { value: "b", label: "Selected" }]}
      onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Distribution" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("option", { name: "Selected" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("option", { name: "Selected" }), { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: "First" })).toHaveFocus();
    fireEvent.click(screen.getByRole("option", { name: "First" }));
    expect(onChange).toHaveBeenCalledWith("a");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Distribution" })).toHaveFocus();
  });
});
