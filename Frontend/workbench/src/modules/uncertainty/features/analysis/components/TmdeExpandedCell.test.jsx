import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { InlineToleranceCell, applyToleranceCaseChange, getTmdeAccuracyReadiness } from "./UncertaintyPanel";

it("authors primary and secondary TMDE sources in one expanded cell", () => {
  let saved;
  function Harness() {
    const [tolerance, setTolerance] = useState({});
    saved = tolerance;
    return <InlineToleranceCell tolerance={tolerance} activeRange={{ id: "r", unit: "V" }}
      referencePoint={{ value: 10, unit: "V" }} biasRole="tmde" editable openRequested
      onCommit={(type, value) => setTolerance(previous => applyToleranceCaseChange(previous, type, value))} />;
  }
  render(<Harness />);
  expect(screen.getByRole("button", { name: "Add a secondary uncertainty" })).toHaveAttribute("title", "Add a secondary uncertainty");
  fireEvent.click(screen.getByRole("button", { name: "Uncertainty settings" }));
  expect(screen.getByRole("textbox", { name: "Uncertainty name" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Tabular" }));
  expect(saved.tmdeUncertaintyDefinition.kind).toBe("table");
  expect(screen.getByRole("group", { name: "Tabular TMDE uncertainty" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add a secondary uncertainty" }));
  expect(saved.tmdeSecondaryUncertainties).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Bias", exact: true })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Uncertainty name" }), { target: { value: "Thermal Expansion" } });
  expect(saved.tmdeSecondaryUncertainties[0].name).toBe("Thermal Expansion");
  fireEvent.click(screen.getByRole("button", { name: "Parametric", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Secondary uncertainty distribution" }));
  fireEvent.click(screen.getByRole("option", { name: "Triangular", exact: true }));
  expect(saved.tmdeSecondaryUncertainties[0].tolerance.bandDistribution).toBe("2.449");
  expect(saved.tmdeUncertaintyDefinition.distribution).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Uncertainty settings", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Algebraic" }));
  expect(saved.tmdeSecondaryUncertainties[0]).toMatchObject({ kind: "equation", dynamicDefinition: { kind: "equation" } });
  fireEvent.click(screen.getByRole("button", { name: "TMDE uncertainty" }));
  expect(screen.getByRole("group", { name: "Tabular TMDE uncertainty" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "+ Thermal Expansion" }));
  expect(screen.getByRole("group", { name: "Algebraic TMDE uncertainty" })).toBeInTheDocument();
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
