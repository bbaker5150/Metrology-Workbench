import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ManualComponentModal from "./ManualComponentModal";

describe("ManualComponentModal", () => {
  it("does not show a degrees-of-freedom field for Type B components", () => {
    render(
      <ManualComponentModal
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        uutNominal={{ value: 10, unit: "V" }}
      />,
    );

    expect(screen.getByText("Type B")).toBeInTheDocument();
    expect(screen.queryByText("Degrees of Freedom")).not.toBeInTheDocument();
    expect(screen.getByText("Tolerance / Error limits")).toBeInTheDocument();
  });
});
