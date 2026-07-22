import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  applyToleranceCaseChange,
  InlineDistributionCell,
  InlineToleranceCell,
} from "./UncertaintyPanel";

const ToleranceHarness = ({ initialTolerance = {} }) => {
  const [tolerance, setTolerance] = useState(initialTolerance);
  return (
    <InlineToleranceCell
      tolerance={tolerance}
      activeRange={{ id: "r1", unit: "V", max: "10" }}
      editable
      onCommit={(key, component) =>
        setTolerance((current) =>
          applyToleranceCaseChange(current, key, component),
        )
      }
    />
  );
};

describe("inline tolerance global modes", () => {
  it("uses one compact symmetry/sidedness mode bar for the whole tolerance", () => {
    render(<ToleranceHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Set tolerance" }));

    const symmetric = screen.getByTitle("Symmetric tolerance");
    const asymmetric = screen.getByTitle("Asymmetric tolerance");
    const singleSided = screen.getByTitle(
      "Single-sided tolerances are asymmetric",
    );
    expect(symmetric).toHaveAttribute("aria-pressed", "true");
    expect(singleSided).toBeDisabled();
    expect(screen.queryByTitle(/Tolerance shape:/)).not.toBeInTheDocument();

    fireEvent.click(asymmetric);
    expect(screen.getByTitle("Single-sided tolerance")).not.toBeDisabled();
    fireEvent.click(screen.getByTitle("Single-sided tolerance"));

    expect(screen.getByLabelText("Single-sided direction")).toBeInTheDocument();
    expect(screen.getByText("Measurement known")).toBeInTheDocument();
    expect(screen.queryByTitle("Percent of full scale")).not.toBeInTheDocument();
  });

  it("isolates single-sided data from double-sided accuracy terms", () => {
    const initial = {
      reading: {
        high: "1",
        low: "-1",
        value: "1",
        unit: "%",
        distribution: "1.732",
        symmetric: true,
      },
    };
    render(<ToleranceHarness initialTolerance={initial} />);
    fireEvent.click(screen.getByTitle("Click to edit tolerance"));
    fireEvent.click(screen.getByTitle("Asymmetric tolerance"));
    fireEvent.click(screen.getByTitle("Single-sided tolerance"));

    expect(screen.queryByText("IV %")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Single-sided direction")).toBeInTheDocument();
  });
});

describe("distribution-first editing", () => {
  it("allows a distribution to be selected before a tolerance is entered", () => {
    const onChange = vi.fn();
    render(
      <InlineDistributionCell
        divisor={null}
        editable
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText("Not Set"));
    fireEvent.click(screen.getByRole("button", { name: "Spec band distribution" }));
    const triangular = screen
      .getAllByRole("option")
      .find((option) => option.querySelector("span")?.textContent === "Triangular");
    fireEvent.click(triangular);
    expect(onChange).toHaveBeenCalled();
  });
});
