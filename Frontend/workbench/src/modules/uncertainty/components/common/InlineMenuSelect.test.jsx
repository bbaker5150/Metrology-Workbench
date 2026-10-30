import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InlineMenuSelect from "./InlineMenuSelect";

describe("inline menu initial layout", () => {
  it("clears pointer-close focus for range browsing while keeping keyboard navigation", () => {
    render(<InlineMenuSelect blurOnPointerClose ariaLabel="Ranges" value="a" options={[{value:'a',label:'10 V'}]} />);
    const trigger = screen.getByRole('button', {name:'Ranges'});
    fireEvent.click(trigger, {detail:1});
    trigger.focus();
    fireEvent.click(trigger, {detail:1});
    expect(trigger).not.toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded','false');
    fireEvent.keyDown(trigger, {key:'ArrowDown'});
    fireEvent.keyDown(screen.getByRole('option'), {key:'Escape'});
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger, {detail:1});
    fireEvent.click(screen.getByRole('option'), {detail:1});
    expect(trigger).not.toHaveFocus();
  });
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
