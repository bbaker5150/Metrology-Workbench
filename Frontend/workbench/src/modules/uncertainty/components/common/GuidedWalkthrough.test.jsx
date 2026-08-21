import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GuidedWalkthrough, { getWalkthroughCardPosition } from "./GuidedWalkthrough";

const steps = [
  {
    id: "start",
    title: "Start here",
    description: "Use the highlighted control.",
    target: '[data-tour="target"]',
    advanceOnTargetClick: true,
  },
  {
    id: "finish",
    title: "Finished",
    description: "Done.",
  },
];

describe("GuidedWalkthrough", () => {
  it("keeps the coach card inside the viewport", () => {
    expect(
      getWalkthroughCardPosition(
        { top: 40, left: 900, right: 980, bottom: 70, width: 80, height: 30 },
        { width: 1000, height: 700 },
      ),
    ).toMatchObject({ left: 526, top: 40, width: 360 });

    const centered = getWalkthroughCardPosition(null, { width: 320, height: 500 });
    expect(centered.left).toBeGreaterThanOrEqual(12);
    expect(centered.width).toBe(296);
  });

  it("advances when the highlighted action is selected", async () => {
    const onStepChange = vi.fn();
    render(
      <>
        <button type="button" data-tour="target">Create</button>
        <GuidedWalkthrough
          isOpen
          steps={steps}
          stepIndex={0}
          onStepChange={onStepChange}
          onClose={vi.fn()}
        />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onStepChange).toHaveBeenCalledWith(1));
  });

  it("explains when a later dynamic target is not available yet", async () => {
    render(
      <GuidedWalkthrough
        isOpen
        steps={steps}
        stepIndex={0}
        onStepChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(/Complete the preceding setup/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Uncertalytics walkthrough" })).toBeInTheDocument(),
    );
  });

  it("elevates a menu revealed by the highlighted action and cleans it up", async () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getRect() {
        if (this.dataset?.tour === "revealed-menu") {
          return {
            top: 90,
            left: 40,
            right: 280,
            bottom: 300,
            width: 240,
            height: 210,
          };
        }
        return {
          top: 40,
          left: 40,
          right: 70,
          bottom: 70,
          width: 30,
          height: 30,
        };
      });
    const menuSteps = [
      {
        id: "menu",
        title: "Open the menu",
        description: "Use the menu.",
        target: '[data-tour="target"]',
        revealedTarget: '[data-tour="revealed-menu"]',
      },
    ];
    const props = {
      steps: menuSteps,
      stepIndex: 0,
      onStepChange: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(
      <>
        <button type="button" data-tour="target">
          Open
        </button>
        <div role="menu" data-tour="revealed-menu">
          Menu
        </div>
        <GuidedWalkthrough isOpen {...props} />
      </>,
    );

    const menu = screen.getByRole("menu");
    await waitFor(() =>
      expect(menu).toHaveClass("guided-walkthrough-elevated-surface"),
    );

    rerender(
      <>
        <button type="button" data-tour="target">
          Open
        </button>
        <div role="menu" data-tour="revealed-menu">
          Menu
        </div>
        <GuidedWalkthrough isOpen={false} {...props} />
      </>,
    );
    expect(screen.getByRole("menu")).not.toHaveClass(
      "guided-walkthrough-elevated-surface",
    );
    rectSpy.mockRestore();
  });
});
