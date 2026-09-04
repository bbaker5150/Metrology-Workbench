import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CorrelationMatrixModal from "./CorrelationMatrixModal";

const components = [
  { id: "a", label: "Length", signedContribution: 1 },
  { id: "b", label: "Weight", signedContribution: 2 },
];

describe("CorrelationMatrixModal", () => {
  it("keeps the matrix primary and uses compact icon-only actions", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <CorrelationMatrixModal
        isOpen
        components={components}
        correlations={{}}
        onSave={onSave}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Input correlation matrix" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByText("Reset")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset all correlations" }));
    expect(onSave).toHaveBeenCalledWith({});

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply correlations" }));
    expect(onSave).toHaveBeenLastCalledWith({ "a|b": 0.5 });

    fireEvent.click(screen.getByRole("button", { name: "Close input correlations" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
