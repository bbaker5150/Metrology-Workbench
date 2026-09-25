import { createDynamicDefinition } from "../../../utils/dynamicBudgetComponents";
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
      {source && <InstrumentUncertaintyRow selected showRowActions source={source} activeRange={{ unit: "V" }} onChange={setSource} onRemove={() => setSource(null)} />}
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
  fireEvent.change(screen.getByRole("textbox", { name: "Uncertainty equation" }), { target: { value: "x*a+" } });
  expect(saved.tmdeUncertaintyDefinition.variables.a.value).toBe(3);
  fireEvent.change(screen.getByRole("textbox", { name: "Uncertainty equation" }), { target: { value: "x*a+1" } });
  expect(screen.getByRole("textbox", { name: "a nominal" })).toHaveValue("3");
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

it.each(["table", "equation"])("uses budget editor controls and only the adjacent distribution for a %s source", async kind => {
  let saved;
  function Harness() {
    const [source, setSource] = useState({ id: "source", name: "Named source", kind,
      dynamicDefinition: createDynamicDefinition(kind, { value: 5, unit: "V" }) });
    saved = source;
    return <table><tbody><InstrumentUncertaintyRow source={source}
      activeRange={{ unit: "V" }} referencePoint={{ value: 5, unit: "V" }}
      onChange={setSource} onRemove={() => {}} onAddSecondary={() => {}} /></tbody></table>;
  }
  const { container } = render(<Harness />);
  fireEvent.click(within(container.querySelector(".cell-tolerance")).getByRole("button", { name: "Set tolerance" }));
  const editor = container.querySelector(".dynamic-budget-editor");
  expect(editor).toBeInTheDocument();
  expect(within(editor).getByRole("group", { name: "Error limit symmetry" })).toBeInTheDocument();
  expect(within(editor).queryByRole("button", { name: /distribution|interpretation/i })).toBeNull();
  if (kind === "table") {
    fireEvent.change(within(editor).getByRole("textbox", { name: "Measurement point row 1" }), { target: { value: "5" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "Uncertainty row 1" }), { target: { value: "0.2" } });
    expect(editor.querySelector(".dynamic-input-table")).toBeInTheDocument();
  } else {
    fireEvent.change(within(editor).getByRole("textbox", { name: "Uncertainty equation" }), { target: { value: "x / 25" } });
    expect(editor.querySelector(".dynamic-variable-table")).toBeInTheDocument();
  }
  expect(editor).not.toHaveTextContent("This uncertainty column was removed");
  fireEvent.click(within(container.querySelector(".cell-distribution")).getByTitle("Set distribution"));
  fireEvent.click(await screen.findByRole("option", { name: /^Rectangular k/ }));
  expect(saved.dynamicDefinition.distribution).toBe("1.732");
  expect(saved.dynamicDefinition.mode).toBe("tolerance");
  expect(container.querySelector(".cell-tolerance")).toHaveTextContent("0.2 V");
});

it.each(["table", "equation"])("tabs into the first value field of a new %s source and reopens it with one click", async kind => {
  let saved;
  function Harness() {
    const [source, setSource] = useState({id: "new-source", name: "", kind,
      dynamicDefinition: createDynamicDefinition(kind, {unit: "V"})});
    saved = source;
    return <table><tbody><InstrumentUncertaintyRow source={source} activeRange={{unit:"V"}}
      onChange={setSource} onRemove={() => {}} onAddSecondary={() => {}} /></tbody></table>;
  }
  const {container} = render(<Harness />);
  const name = screen.getByRole("textbox", {name: "Uncertainty name"});
  fireEvent.change(name, {target:{value:"New uncertainty"}});
  fireEvent.keyDown(name, {key:"Tab"});
  const label = kind === "table" ? "Measurement point row 1" : "Uncertainty equation";
  expect(screen.getByRole("textbox", {name:label})).toHaveFocus();
  expect(saved.name).toBe("New uncertainty");
  expect(container.querySelector(".dynamic-editor-footer")).toBeNull();
  fireEvent.keyDown(document.activeElement, {key:"Escape"});
  fireEvent.click(within(container.querySelector(".cell-tolerance")).getByRole("button", {name:"Set tolerance"}));
  expect(screen.getByRole("textbox", {name:label})).toHaveFocus();
});

it("places whichever-is-greater and bias together below the tolerance terms", () => {
  const {container} = render(<InlineToleranceCell editable openRequested biasRole="tmde"
    activeRange={{unit:"V"}} tolerance={{bias:{value:0.5,unit:"V"}}} onCommit={() => {}} />);
  const footer = container.querySelector(".inline-tolerance-footer");
  expect(within(footer).getByRole("checkbox", {name:"Whichever is greater"})).toBeInTheDocument();
  expect(footer.querySelector(".instrument-bias-editor")).toBeInTheDocument();
  expect(container.querySelector(".inline-tolerance-term-group").compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it.each(["table", "equation"])("keeps a new %s name mounted until the uncertainty summary receives its click", kind => {
  function Harness() {
    const [source, setSource] = useState({id: "new-source", name: "", kind,
      dynamicDefinition: createDynamicDefinition(kind, {unit: "V"})});
    return <table><tbody><InstrumentUncertaintyRow source={source} activeRange={{unit:"V"}}
      onChange={setSource} onRemove={() => {}} onAddSecondary={() => {}} /></tbody></table>;
  }
  const {container} = render(<Harness />);
  const name = screen.getByRole("textbox", {name:"Uncertainty name"});
  fireEvent.change(name, {target:{value:"Long uncertainty name"}});
  const summary = within(container.querySelector(".cell-tolerance")).getByRole("button", {name:"Set tolerance"});
  expect(fireEvent.mouseDown(summary, {button:0})).toBe(false);
  expect(name).toHaveFocus();
  fireEvent.mouseUp(summary);
  fireEvent.click(summary);
  expect(screen.getByRole("textbox", {name:kind === "table" ? "Measurement point row 1" : "Uncertainty equation"})).toHaveFocus();
  expect(container.querySelector(".instrument-source-row-name")).toHaveTextContent("Long uncertainty name");
});
