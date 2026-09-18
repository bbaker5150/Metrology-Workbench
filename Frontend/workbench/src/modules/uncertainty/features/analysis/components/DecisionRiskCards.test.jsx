import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import DecisionRiskCards from "./DecisionRiskCards";

const formatValue = value => Number(value).toPrecision(4);
it("updates both card colors when the session threshold changes", () => {
  const { rerender } = render(<DecisionRiskCards results={{ pfa: 3, pfr: 6 }} requiredPfa={2} formatValue={formatValue} />);
  expect(screen.getByText("PFA").parentElement).toHaveClass("is-bad");
  expect(screen.getByText("PFR").parentElement).toHaveClass("is-bad");
  rerender(<DecisionRiskCards results={{ pfa: 3, pfr: 6 }} requiredPfa={8} formatValue={formatValue} />);
  expect(screen.getByText("PFA").parentElement).toHaveClass("is-good");
  expect(screen.getByText("PFR").parentElement).toHaveClass("is-good");
});
it("labels boundary results and retains an unavailable PFR slot", () => {
  render(<DecisionRiskCards results={{ riskMethod: "risk8-pfa-boundary", pfa: 1.5, pfr: 0 }} formatValue={formatValue} />);
  expect(screen.getByText("PFA at Boundary").parentElement).toHaveClass("is-good");
  expect(screen.getByLabelText("PFR: Unavailable")).toBeInTheDocument();
  expect(screen.getByText("PFR")).toBeInTheDocument();
});

it("retains uncalculated cards and preserves valid zero results", () => {
  const { rerender, container } = render(<DecisionRiskCards results={null} formatValue={formatValue} />);
  expect(screen.getByLabelText("PFA: Unavailable")).toBeInTheDocument();
  expect(screen.getByLabelText("PFR: Unavailable")).toBeInTheDocument();
  rerender(<DecisionRiskCards results={{ pfa: NaN, pfr: null }} formatValue={formatValue} />);
  expect(screen.getByLabelText("PFA: Unavailable")).toBeInTheDocument();
  expect(screen.getByLabelText("PFR: Unavailable")).toBeInTheDocument();
  rerender(<DecisionRiskCards results={{ pfa: 0, pfr: "" }} formatValue={formatValue} />);
  expect(screen.getByText("PFA")).toBeInTheDocument();
  expect(screen.getByText("PFR")).toBeInTheDocument();
});
