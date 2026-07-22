import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PercentageBarGraph from "./ContributionPlot";

const shares = (container) =>
  Object.fromEntries(
    Array.from(container.querySelectorAll("[data-contribution-label]")).map(
      (row) => [
        row.dataset.contributionLabel,
        Number(row.dataset.contributionPercentage),
      ],
    ),
  );

describe("ContributionPlot", () => {
  it("renders accessible native bars with normalized percentages", () => {
    const { container } = render(
      <PercentageBarGraph
        data={{ "DMM Accuracy": 0.01, Reference: 0.04 }}
        unit="V"
      />,
    );

    expect(
      screen.getByRole("region", { name: "Uncertainty contribution" }),
    ).toBeInTheDocument();
    expect(shares(container)).toEqual({ Reference: 80, "DMM Accuracy": 20 });
    expect(container.querySelector(".contribution-plot-bar")).toHaveStyle({
      width: "80%",
    });
  });

  it("updates labels and bars synchronously when values change", () => {
    const view = render(
      <PercentageBarGraph data={{ Accuracy: 1, Resolution: 1 }} unit="V" />,
    );
    expect(shares(view.container)).toEqual({ Accuracy: 50, Resolution: 50 });

    view.rerender(
      <PercentageBarGraph data={{ Accuracy: 1, Resolution: 3 }} unit="V" />,
    );
    expect(shares(view.container)).toEqual({ Resolution: 75, Accuracy: 25 });
  });

  it("renders Monte Carlo influence as percentages without physical units", () => {
    const { container } = render(
      <PercentageBarGraph
        data={{ Weight: 0.6, Length: 0.4 }}
        unit="in-oz"
        valueMode="share"
        title="Monte Carlo variable influence"
      />,
    );

    expect(shares(container)).toEqual({ Weight: 60, Length: 40 });
    expect(container.textContent).not.toContain("in-oz");
  });

  it("shows a placeholder when there are no contributors", () => {
    render(<PercentageBarGraph data={{}} unit="V" />);
    expect(
      screen.getByText(/No significant error sources/i),
    ).toBeInTheDocument();
  });
});
