import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import PointRiskVisualizer from "./PointRiskVisualizer";
import { computeKnownTwoSidedRisk8 } from "../../../utils/risk8/knownMeasurementRisk8";

const results = () => ({ nativeUnit: "V", risk8: computeKnownTwoSidedRisk8({
  nominal: 10, riskAverage: 10.1, calBias: .05, lowerLimit: 9, upperLimit: 11,
  expandedUncertaintyNative: .25, tur: 4, assumedReop: .95, requiredReop: .9,
  reqPFA: .02, initialGB: 1, originalInterval: 12,
}) });

it("shows the point model and keeps exploration local and reversible", () => {
  const riskResults = results();
  const original = JSON.stringify(riskResults);
  render(<PointRiskVisualizer riskResults={riskResults} nominal={{ value: 10, unit: "V" }} />);
  expect(screen.getAllByRole("img")).toHaveLength(4);
  const table = screen.getByRole("table", { name: "Population risk outcomes" });
  expect(within(table).getByText(`${(riskResults.risk8.out.pfa * 100).toFixed(2)}%`)).toBeInTheDocument();
  const baseline = table.textContent;
  fireEvent.click(screen.getByRole("button", { name: "Explore REOP & uncertainty" }));
  fireEvent.change(screen.getByRole("slider", { name: "Explore assumed REOP" }), { target: { value: .8 } });
  fireEvent.change(screen.getByRole("slider", { name: "Explore calibration uncertainty" }), { target: { value: 2 } });
  expect(table.textContent).not.toBe(baseline);
  expect(JSON.stringify(riskResults)).toBe(original);
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(table.textContent).toBe(baseline);
  fireEvent.change(screen.getByRole("slider", { name: "Hypothetical true error" }), { target: { value: .5 } });
  expect(screen.getByText("Truly in tolerance")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("slider", { name: "Hypothetical true error" }), { target: { value: 1 } });
  expect(screen.getByText("Truly out of tolerance")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Return to current point" }));
  expect(screen.queryByRole("slider", { name: "Explore assumed REOP" })).not.toBeInTheDocument();
});

it("keeps exploration controls usable for an infeasible scenario", () => {
  render(<PointRiskVisualizer riskResults={results()} />);
  fireEvent.click(screen.getByRole("button", { name: "Explore REOP & uncertainty" }));
  fireEvent.change(screen.getByRole("slider", { name: "Explore calibration uncertainty" }), { target: { value: 3 } });
  fireEvent.change(screen.getByRole("slider", { name: "Explore assumed REOP" }), { target: { value: .9999 } });
  expect(screen.getByText(/This REOP is not feasible/)).toHaveAttribute("role", "status");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.getByRole("table")).toBeInTheDocument();
});

it("explains incomplete points without rendering fabricated distributions", () => {
  render(<PointRiskVisualizer />);
  expect(screen.getByRole("status")).toHaveTextContent("Complete this point");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
