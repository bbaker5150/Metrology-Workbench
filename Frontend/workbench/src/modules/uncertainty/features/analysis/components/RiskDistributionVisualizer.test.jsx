import { fireEvent, render, screen } from "@testing-library/react";
import RiskDistributionVisualizer from "./RiskDistributionVisualizer";

const results = {
  nativeUnit: "V",
  nominalValue: 10,
  LLow: 9.8,
  LUp: 10.2,
  ALow: 9.8,
  AUp: 10.2,
  uUUT: 0.065,
  uCal: 0.021,
  uDev: 0.0683,
  expandedUncertainty: 0.042,
  correlation: 0.952,
  pfa: 1.248,
  pfr: 3.672,
  gbResults: {
    GBLOW: 9.84,
    GBUP: 10.16,
    GBPFA: 0.48,
    GBPFR: 7.82,
  },
};

const calcResults = {
  calculatedBudgetGroups: [
    {
      id: "final",
      unit: "V",
      components: [
        {
          id: "reading",
          name: "Reading Accuracy",
          sourcePointLabel: "10 V range",
          distribution: "Rectangular",
          distributionDivisor: Math.sqrt(3),
          contribution: 0.012,
          type: "B",
        },
      ],
    },
  ],
};

test("switches between risk, guardband, and component views", () => {
  render(
    <RiskDistributionVisualizer
      results={results}
      calcResults={calcResults}
      onShowBreakdown={() => {}}
    />,
  );

  expect(screen.getByText("As specified")).toBeInTheDocument();
  expect(screen.getByText("1.248%")).toBeInTheDocument();

  // PFA/PFR coloring mirrors the measurement point list: PFA graded by
  // threshold (1.248% < 2% -> good), PFR always muted.
  expect(screen.getByTestId("risk-outcome-pfa")).toHaveClass("status-good");
  expect(screen.getByTestId("risk-outcome-pfr")).toHaveClass("status-muted");

  // Limit values are always visible on the chart.
  expect(screen.getByText("9.8 V")).toBeInTheDocument();
  expect(screen.getByText("10.2 V")).toBeInTheDocument();

  // Acceptance markers are hidden while they coincide with the tolerance limits.
  expect(
    screen.queryByTestId("risk-limit-acceptance-lal"),
  ).not.toBeInTheDocument();

  // Metric pills explain their role in the chart.
  expect(
    screen.getByText(/Green band: full span between the LTL and UTL markers/),
  ).toBeInTheDocument();

  // Risk anatomy strip decomposes observed variance into true + calibration,
  // and the chart shades the out-of-tolerance tails and the +/-U decision zones.
  expect(screen.getByTestId("risk-composition")).toBeInTheDocument();
  expect(screen.getByTestId("risk-variance-eqn")).toHaveTextContent("0.0683");
  expect(screen.getByTestId("risk-oot-high")).toBeInTheDocument();
  expect(screen.getByTestId("risk-zone-low")).toBeInTheDocument();
  expect(screen.getByTestId("risk-zone-high")).toBeInTheDocument();

  // Acceptance is visualized on the observed curve: rejected tails beyond the
  // acceptance limits plus a named accept window on the observed axis.
  expect(screen.getByTestId("risk-reject-low")).toBeInTheDocument();
  expect(screen.getByTestId("risk-reject-high")).toBeInTheDocument();
  expect(screen.getByTestId("risk-accept-bracket")).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("Apply guardband"));
  expect(screen.getByText("Guardbanded")).toBeInTheDocument();
  expect(screen.getByText("0.48%")).toBeInTheDocument();
  expect(screen.getByText("Guardband acceptance width")).toBeInTheDocument();
  expect(screen.getByTestId("risk-limit-acceptance-gbl")).toBeInTheDocument();
  expect(screen.getByText("9.84 V")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(screen.getByText("135%")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Component View" }));
  expect(screen.getByLabelText("Budget component")).toHaveValue("final-reading");
  expect(screen.getByText("Rectangular")).toBeInTheDocument();
  expect(screen.getByText("Standard uncertainty")).toBeInTheDocument();
  expect(screen.getByText("0.012 V")).toBeInTheDocument();
  expect(
    screen.getByText("Rectangular (sqrt 3) - 1.7321"),
  ).toBeInTheDocument();
  expect(screen.getByTestId("component-limit-lower")).toHaveTextContent(
    "-0.020785 V",
  );
});

test("monte carlo view simulates decision outcomes", async () => {
  const monteCarloResults = {
    ...results,
    riskMethod: "empirical",
    errorQuantiles: [-0.04, -0.02, 0, 0.02, 0.04],
  };

  render(
    <RiskDistributionVisualizer
      results={monteCarloResults}
      calcResults={calcResults}
      onShowBreakdown={() => {}}
    />,
  );

  expect(await screen.findByText("3,000 trials")).toBeInTheDocument();
  expect(
    screen.getByText("Monte Carlo", { selector: ".method-chip" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Correct accept")).toBeInTheDocument();
  expect(screen.getByText("False accept")).toBeInTheDocument();
  expect(screen.getByText("False reject")).toBeInTheDocument();
  expect(screen.getByText("Correct reject")).toBeInTheDocument();

  // Simulated FA/FR rows reference the analytically calculated values.
  expect(
    screen.getByText(/Out of tolerance but accepted - calculated 1.248%/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/In tolerance but rejected - calculated 3.672%/),
  ).toBeInTheDocument();

  // Correlation between true and observed errors is surfaced.
  expect(screen.getByText(/correlation ρ = 0.952/)).toBeInTheDocument();

  // Guardband moves the acceptance limits in the simulation too.
  fireEvent.click(screen.getByLabelText("Apply guardband"));
  expect(
    screen.getByText(/Out of tolerance but accepted - calculated 0.48%/),
  ).toBeInTheDocument();
});

test("keeps monte carlo view unavailable for closed-form results", () => {
  render(
    <RiskDistributionVisualizer
      results={results}
      calcResults={calcResults}
      onShowBreakdown={() => {}}
    />,
  );

  expect(screen.getByRole("button", { name: "Monte Carlo" })).toBeDisabled();
});
