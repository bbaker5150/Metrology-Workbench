import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import RiskAnalysisDashboard from "./RiskAnalysisDashboard";
import RiskMitigationDashboard from "./RiskMitigationDashboard";

const results = {
  riskMethod: "risk8-pfa-boundary",
  riskAvailability: "pfa-boundary-only",
  pfa: 2,
  pfr: undefined,
  tur: undefined,
  tar: undefined,
  LLow: 9,
  LUp: undefined,
  ALow: 9.11,
  AUp: undefined,
  expandedUncertainty: 0.1,
  nativeUnit: "V",
  uutResolution: 2,
  gbInputs: {
    uutLower: 9,
    uutUpper: undefined,
    expandedUncertainty: 0.1,
    reqPFA: 0.02,
  },
  gbResults: {
    GBLOW: 9.11,
    GBUP: undefined,
    GBPFA: 2,
  },
};

describe("single-sided measurement-unknown dashboards", () => {
  test("risk analysis shows only the PFA boundary metrics", () => {
    render(
      <RiskAnalysisDashboard
        results={results}
        calcResults={{}}
        onShowBreakdown={vi.fn()}
      />
    );

    expect(screen.getByText("PFA Boundary")).toBeInTheDocument();
    expect(screen.getByText("Lower Acceptance Limit")).toBeInTheDocument();
    expect(screen.getByText(/TUR, REOP, PFR, and interval metrics are unavailable/i)).toBeInTheDocument();
  });

  test("risk mitigation avoids unavailable full-risk controls", () => {
    render(
      <RiskMitigationDashboard
        results={results}
        onShowBreakdown={vi.fn()}
      />
    );

    expect(screen.getByText("Single-Sided Measurement Unknown")).toBeInTheDocument();
    expect(screen.getByText("PFA-only acceptance boundary")).toBeInTheDocument();
    expect(screen.queryByText("Guard Band Multiplier")).not.toBeInTheDocument();
    expect(screen.queryByText("Calibration Interval with Guard Banding")).not.toBeInTheDocument();
  });
});

describe("single-sided measurement-known Risk 8 dashboards", () => {
  const knownResults = {
    ...results,
    riskMethod: "risk8-single-sided-known",
    pfa: 0.66,
    pfr: 1.04,
    tur: 4,
    observedReop: 95,
    riskAverage: 10,
    expandedUncertainty: 0.25,
    gbInputs: {
      ...results.gbInputs,
      measRelTarget: 0.9,
      turVal: 4,
    },
    gbResults: {
      GBLOW: 9,
      GBUP: undefined,
      GBPFA: 0.99,
      GBPFR: 1.29,
      GBCALINT: 24.65,
    },
  };

  test("renders full known-measurement metrics with Risk 8 breakdown controls", () => {
    const onShowBreakdown = vi.fn();
    const { rerender } = render(
      <RiskAnalysisDashboard
        results={knownResults}
        calcResults={{}}
        onShowBreakdown={onShowBreakdown}
      />,
    );
    expect(screen.getByText("Probability of False Accept")).toBeInTheDocument();
    expect(screen.getByText("Test Uncertainty Ratio")).toBeInTheDocument();
    expect(screen.getByText("View breakdown")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Probability of False Accept"));
    expect(onShowBreakdown).toHaveBeenCalledWith("pfa");

    rerender(
      <RiskMitigationDashboard
        results={knownResults}
        onShowBreakdown={onShowBreakdown}
      />,
    );
    expect(screen.getByText("Single-Sided Measurement Known")).toBeInTheDocument();
    expect(screen.getByText("Recommended Calibration Interval")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Recommended Calibration Interval"));
    expect(onShowBreakdown).toHaveBeenCalledWith("gbcalint");
  });
});
