import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import UncertaintyPanel, { getSpecRows } from "./UncertaintyPanel";
import { getBudgetComponentsFromTolerance } from "../utils/budgetUtils";
vi.mock("plotly.js-dist", () => ({ default: {} }));

it("retains an invalid equation in its editor and shows its error after Enter", () => {
  function Harness() {
    const [point, setPoint] = useState({ id: "p", measurementType: "derived", equationString: "a", variableMappings: { a: "Input" }, variableNominals: {}, components: [], testPointInfo: { parameter: { value: 5, unit: "V" } } });
    return <UncertaintyPanel testPointData={point} sessionData={{ id: "s", uuts: [], tmdes: [], testPoints: [point] }} uutNominal={point.testPointInfo.parameter}
      tmdeTolerancesData={[]} onUpdateTestPoint={patch => setPoint(previous => ({ ...previous, ...patch }))} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Edit measurement equation" }));
  const input = screen.getByLabelText("Measurement equation");
  fireEvent.change(input, { target: { value: "/asd" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByLabelText("Measurement equation")).toHaveValue("/asd");
  expect(screen.getByRole("button", { name: "f(x)" })).toBeInTheDocument();
  expect(screen.getByText(/Equation does not parse/)).toBeVisible();
  fireEvent.click(document.body);
  expect(screen.getByLabelText("Measurement equation")).toHaveValue("/asd");
});

it.each(["direct", "derived"])("ignores retired bias visibility settings for %s points", type => {
  const point = { id: "p", measurementType: type, equationString: "5", variableMappings: {}, components: [], measurementBias: { mode: "manual", value: ".2", unit: "V" },
    testPointInfo: { measurementArea: "Voltage", parameter: { value: 5, unit: "V" } } };
  const renderPanel = showBias => <UncertaintyPanel testPointData={point} sessionData={{ id: "s", uuts: [], tmdes: [], testPoints: [point],
    measurementAreaGroups: [{ name: "Voltage", pointCreationSettings: { showBias } }, { name: "Other", pointCreationSettings: { showBias: true } }] }}
    uutNominal={point.testPointInfo.parameter} tmdeTolerancesData={[]} />;
  const view = render(renderPanel(undefined));
  expect(screen.queryByRole("button", { name: "Edit net measurement system bias" })).toBeNull();
  if (type === "direct") expect(screen.queryByText("Measurement Bias")).toBeNull();
  view.rerender(renderPanel(true));
  expect(screen.queryByRole("button", { name: "Edit net measurement system bias" })).toBeNull();
  view.rerender(renderPanel(false));
  expect(screen.queryByRole("button", { name: "Edit net measurement system bias" })).toBeNull();
  expect(point.measurementBias.value).toBe(".2");
});

it.each(["", "V", "mV"])("keeps TMDE error limits in the definition's units for point unit %j", unit => {
  const source = { unit: "degF", floor: { high: "3", low: "-3", unit: "degF", distribution: "2" } };
  const component = getBudgetComponentsFromTolerance(source, { value: 10, unit })[0];
  expect(component.authoredTolerance.floor.unit).toBe("degF");
  expect(getSpecRows(component.authoredTolerance).join(" ")).toContain("°F");
  expect(getSpecRows(component.authoredTolerance).join(" ")).not.toContain("ppm");
});
