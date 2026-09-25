import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { InstrumentUncertaintyRow, InlineToleranceCell, applyToleranceCaseChange, getTmdeAccuracyReadiness } from "./UncertaintyPanel";

it("chooses a source type before creating an independent row and tabs from its name into the editor", () => {
  let saved;
  function Harness() {
    const [source, setSource] = useState(null);
    saved = source;
    return <table><tbody><tr><td><InlineToleranceCell tolerance={{}} activeRange={{ unit: "V" }} biasRole="tmde" editable openRequested
      onCommit={() => {}} onAddSecondary={kind => setSource({ id: "source", name: "", kind, tolerance: {} })} /></td></tr>
      {source && <InstrumentUncertaintyRow source={source} activeRange={{ unit: "V" }} onChange={setSource} onRemove={() => setSource(null)} />}
    </tbody></table>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Add a secondary uncertainty" }));
  expect(saved).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Uncertainty name" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Manual", exact: true }));
  const input = screen.getByRole("textbox", { name: "Uncertainty name" });
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "Thermal Expansion" } });
  fireEvent.keyDown(input, { key: "Tab" });
  const row = screen.getByText("(Range N/A)").closest("tr");
  expect(saved.name).toBe("Thermal Expansion");
  expect(within(row).getByRole("group", { name: "Tolerance symmetry" })).toBeInTheDocument();
  expect(within(row).queryByRole("button", { name: "Bias", exact: true })).toBeNull();
  expect(within(row).getByText("N/A", { exact: true })).toBeInTheDocument();
  expect(within(row).queryByRole("button", { name: "Uncertainty settings", exact: true })).toBeNull();
  fireEvent.click(within(row).getByRole("button", { name: "Remove Thermal Expansion" }));
  expect(saved).toBeNull();
});

it("preserves equation variable values while an equation is temporarily incomplete", () => {
  let saved;
  function Harness() {
    const [tolerance, setTolerance] = useState({ tmdeUncertaintyDefinition: {
      id: "eq", kind: "equation", equation: "x*a", pointVariable: "x", variables: { x: {}, a: { value: 3 } },
      columns: [{ id: "u" }], measurementUnit: "V", outputUnit: "V", mode: "standard",
    } });
    saved = tolerance;
    return <InlineToleranceCell tolerance={tolerance} biasRole="tmde" editable openRequested
      activeRange={{ id: "r", unit: "V" }} onCommit={(type, value) => setTolerance(previous => applyToleranceCaseChange(previous, type, value))} />;
  }
  render(<Harness />);
  fireEvent.change(screen.getByRole("textbox", { name: "TMDE uncertainty equation" }), { target: { value: "x*a+" } });
  expect(saved.tmdeUncertaintyDefinition.variables.a.value).toBe(3);
  fireEvent.change(screen.getByRole("textbox", { name: "TMDE uncertainty equation" }), { target: { value: "x*a+1" } });
  expect(screen.getByRole("textbox", { name: "TMDE equation variable a" })).toHaveValue("3");
});

it("accepts an authored tabular TMDE primary when adding its accuracy", () => {
  const definition = { kind: "table", mode: "tolerance", distribution: "1.732",
    columns: [{ id: "u" }], rows: [{ point: 10, values: { u: { value: "0.1" } } }] };
  expect(getTmdeAccuracyReadiness({ tolerances: { tmdeUncertaintyDefinition: definition } }))
    .toEqual({ ready: true, reason: null });
  expect(getTmdeAccuracyReadiness({ tolerances: { tmdeUncertaintyDefinition: { ...definition, distribution: "" } } }))
    .toEqual({ ready: false, reason: "distribution" });
});

it("shows Table in overview and the evaluated specification at a measurement point", async () => {
  const source = { id: "head", name: "Head Height", kind: "table", dynamicDefinition: {
    id: "table", kind: "table", mode: "standard", measurementUnit: "V", outputUnit: "V",
    columns: [{ id: "u" }], rows: [{ point: 5, values: { u: { value: .4 } } }],
  } };
  let updated;
  const view = referencePoint => <table><tbody><InstrumentUncertaintyRow source={source}
    activeRange={{ unit: "V" }} referencePoint={referencePoint} onChange={value => { updated = value; }} onRemove={() => {}} /></tbody></table>;
  const { rerender } = render(view());
  expect(screen.getByText("Table", { exact: true })).toBeInTheDocument();
  expect(screen.getByText("(Point Dependent)")).toBeInTheDocument();
  rerender(view({ value: 5, unit: "V" }));
  expect(document.querySelector('.cell-tolerance')).toHaveTextContent('0.4 V');
  expect(screen.queryByText("Table", { exact: true })).toBeNull();
  fireEvent.click(screen.getByTitle("Edit distribution"));
  fireEvent.click(await screen.findByRole("option", { name: /^Rectangular k/ }));
  expect(updated.dynamicDefinition).toMatchObject({ mode: "tolerance", distribution: "1.732" });
});

it.each(["parametric", "table", "equation"])("shows the same Not Set placeholder for an empty %s source in both views", kind => {
  const source = { id: "empty", name: "Empty source", kind, tolerance: {},
    dynamicDefinition: { kind, columns: [{ id: "u" }], rows: [], equation: "", measurementUnit: "V", outputUnit: "V" } };
  const view = referencePoint => <table><tbody><InstrumentUncertaintyRow source={source} activeRange={{ unit: "V" }}
    referencePoint={referencePoint} onChange={() => {}} onRemove={() => {}} /></tbody></table>;
  const { rerender, container } = render(view());
  expect(container.querySelector(".cell-tolerance .is-empty")).toHaveTextContent("Not Set");
  rerender(view({ value: 5, unit: "V" }));
  expect(container.querySelector(".cell-tolerance .is-empty")).toHaveTextContent("Not Set");
  expect(container.querySelector(".cell-tolerance")).not.toHaveTextContent(/Enter an equation|No table entry/);
});
