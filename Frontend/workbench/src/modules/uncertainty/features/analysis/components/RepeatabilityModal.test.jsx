import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RepeatabilityModal, { calculateRepeatabilityStats } from "./RepeatabilityModal";

describe("RepeatabilityModal", () => {
  it("calculates sample repeatability statistics", () => {
    expect(calculateRepeatabilityStats([1, 3])).toEqual({
      mean: 2,
      stdDev: Math.sqrt(2),
      dof: 1,
    });
  });

  it("uses the compact modal controls and saves entered readings", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <RepeatabilityModal
        isOpen
        onClose={onClose}
        onSave={onSave}
        uutNominal={{ value: 2, unit: "V" }}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Repeatability" });
    expect(dialog).toHaveClass("repeatability-modal");
    expect(screen.queryByText("Repeatability Calculator")).not.toBeInTheDocument();

    const input = screen.getByLabelText("Measurement");
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add measurement" }));
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const applyButton = screen.getByRole("button", { name: "Add repeatability" });
    expect(applyButton).toHaveClass("correlation-modal-icon-button", "is-primary");
    expect(applyButton).not.toBeDisabled();
    fireEvent.click(applyButton);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        readings: [1, 3],
        mean: 2,
        stdDev: Math.sqrt(2),
        dof: 1,
        unit: "V",
      }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });
});
