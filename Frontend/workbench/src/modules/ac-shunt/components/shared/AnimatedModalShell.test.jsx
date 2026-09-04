import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AnimatedModalShell from "./AnimatedModalShell";

const timeline = {
  to: vi.fn(),
  kill: vi.fn(),
};
timeline.to.mockReturnValue(timeline);

vi.mock("gsap", () => ({
  gsap: {
    killTweensOf: vi.fn(),
    set: vi.fn(),
    timeline: vi.fn(() => timeline),
  },
}));

describe("AnimatedModalShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    timeline.to.mockReturnValue(timeline);
  });

  it("closes only when the pointer press and click both occur on the backdrop", () => {
    const onClose = vi.fn();
    render(
      <AnimatedModalShell
        isOpen
        onClose={onClose}
        panelClassName="test-modal"
        panelProps={{ "aria-label": "Test modal", role: "dialog" }}
      >
        <input aria-label="Correction value" defaultValue="123" />
      </AnimatedModalShell>,
    );

    const input = screen.getByRole("textbox", { name: "Correction value" });
    const backdrop = screen.getByRole("dialog").parentElement;

    fireEvent.pointerDown(input);
    fireEvent.pointerUp(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
