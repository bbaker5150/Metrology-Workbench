import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import DecisionRiskCards from "./DecisionRiskCards";

const formatValue = value => Number(value).toPrecision(4);
it("updates both card colors when the session threshold changes", () => {
  const { rerender } = render(<DecisionRiskCards results={{ pfa: 3, pfr: 6 }} requiredPfa={2} formatValue={formatValue} />);
  expect(screen.getByText("PFA").parentElement).toHaveClass("is-warning");
  expect(screen.getByText("PFR").parentElement).toHaveClass("is-bad");
  rerender(<DecisionRiskCards results={{ pfa: 3, pfr: 6 }} requiredPfa={8} formatValue={formatValue} />);
  expect(screen.getByText("PFA").parentElement).toHaveClass("is-good");
  expect(screen.getByText("PFR").parentElement).toHaveClass("is-good");
});
it("labels boundary results and keeps PFR unavailable for unknown measurements", () => {
  render(<DecisionRiskCards results={{ riskMethod: "risk8-pfa-boundary", pfa: 1.5, pfr: 0 }} formatValue={formatValue} />);
  expect(screen.getByText("PFA at Boundary").parentElement).toHaveClass("is-good");
  expect(screen.getByLabelText("PFR: Unavailable")).toHaveTextContent("—");
  expect(screen.getByText("PFR").parentElement).toHaveClass("is-neutral");
});
