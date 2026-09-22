import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import UncertaintyPanel from "./UncertaintyPanel";
vi.mock("plotly.js-dist", () => ({ default: {} }));

it.each(["direct", "derived"])("exposes a persistent net editor for %s points without creating an override on view", type => {
  let saved;
  const initial = { id: "p", measurementType: type, equationString: type === "derived" ? "5" : undefined,
    variableMappings: {}, variableNominals: {}, components: [],
    testPointInfo: { parameter: { name: "Voltage", value: 5, unit: "V" } } };
  function Harness() {
    const [point, setPoint] = useState(initial); saved = point;
    return <UncertaintyPanel testPointData={point} sessionData={{ measurementAreaGroups: [{ name: "Voltage", pointCreationSettings: { showBias: true } }], id: "s", uuts: [], tmdes: [], testPoints: [point] }}
      uutNominal={point.testPointInfo.parameter} tmdeTolerancesData={[]} onUpdateTestPoint={patch => setPoint(previous => ({ ...previous, ...patch }))} />;
  }
  render(<Harness />);
  expect(screen.getByText(type === "direct" ? "Measurement Bias" : "Measurement Inputs")).toBeInTheDocument();
  const table = document.querySelector('.measurement-inputs-table');
  expect(within(table).getAllByRole('row')).toHaveLength(2);
  expect(within(table).getAllByRole('columnheader')).toHaveLength(type === "direct" ? 3 : 4);
  const edit = () => { fireEvent.click(screen.getByRole('button', { name: 'Edit net measurement system bias' })); return screen.getByRole('textbox', { name: 'Net measurement system bias' }); };
  let net = edit();
  fireEvent.focus(net); fireEvent.blur(net);
  expect(saved.measurementBias).toBeUndefined();
  expect(table.querySelectorAll(".measurement-calculated-value")).toHaveLength(type === "direct" ? 0 : 1);
  expect(screen.queryByRole('button', { name: 'Add Net Bias' })).toBeNull();
  net = edit();
  fireEvent.change(net, { target: { value: '.25' } }); fireEvent.blur(net);
  expect(saved.measurementBias).toMatchObject({ mode: 'manual', value: '.25', unit: 'V' });
  expect(table.querySelector(".measurement-calculated-value")).toHaveTextContent("Calculated 0.25 V");
  fireEvent.click(screen.getByRole('button', { name: 'Remove Net Bias' }));
  expect(saved.measurementBias).toBeNull();
  expect(screen.getByRole('button', { name: 'Edit net measurement system bias' })).toHaveTextContent('0');
  net = edit();
  // Typing an explicit zero must stop inheritance, even if the inherited sum
  // is already zero. Merely focusing the field above must not do so.
  fireEvent.change(net, { target: { value: '0.0' } });
  fireEvent.change(net, { target: { value: '0' } }); fireEvent.blur(net);
  expect(saved.measurementBias).toMatchObject({ mode: 'manual', value: '0' });
  net = edit();
  fireEvent.change(net, { target: { value: '' } }); fireEvent.blur(net);
  expect(saved.measurementBias).toBeNull();
  expect(saved.testPointInfo).toEqual(initial.testPointInfo);
  expect(saved.components).toEqual([]);
});
