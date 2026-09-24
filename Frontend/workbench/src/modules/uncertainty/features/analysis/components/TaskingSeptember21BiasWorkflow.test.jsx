import React from "react";
import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import UncertaintyPanel from "./UncertaintyPanel";
vi.mock("plotly.js-dist", () => ({ default: {} }));

it.each(["direct", "derived"])("keeps bias authoring out of the %s measurement input table", type => {
  const point = { id: "p", measurementType: type, equationString: "a", variableMappings: { a: "Voltage" },
    variableNominals: { a: { value: 5, unit: "V" } }, components: [],
    testPointInfo: { parameter: { value: 5, unit: "V" } } };
  const { container, rerender } = render(<UncertaintyPanel testPointData={point} sessionData={{ id: "s", uuts: [], tmdes: [] }}
    uutNominal={point.testPointInfo.parameter} tmdeTolerancesData={[]} calcResults={{ calculatedNominalValue: 5 }} />);
  expect(screen.queryByText("Measurement Bias")).toBeNull();
  expect(screen.queryByRole("button", { name: /net measurement system bias/i })).toBeNull();
  expect(container.querySelector('.measurement-output-row')).toBeNull();
  if (type === "derived") {
    expect(within(container.querySelector('.measurement-inputs-table')).getAllByRole('columnheader').map(n => n.textContent)).toEqual(['Symbol', 'Name', 'Nominal']);
    const status = container.querySelector('.measurement-equation-status');
    expect(status).toHaveTextContent('Calculated: 5.00000 V');
    expect(status).toHaveStyle({ color: 'var(--status-good)' });
    rerender(<UncertaintyPanel testPointData={point} sessionData={{ id: "s", uuts: [], tmdes: [] }} uutNominal={point.testPointInfo.parameter} tmdeTolerancesData={[]} calcResults={{ calculatedNominalValue: 6 }} />);
    expect(container.querySelector('.measurement-equation-status')).toHaveTextContent('Calculated: 6.00000 V');
    expect(container.querySelector('.measurement-equation-status')).toHaveStyle({ color: 'var(--status-bad)' });
  } else expect(container.querySelector('.measurement-inputs-table')).toBeNull();
});
