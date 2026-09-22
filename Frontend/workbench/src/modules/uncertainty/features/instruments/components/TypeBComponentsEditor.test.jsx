import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("plotly.js-dist", () => ({ default: {} }));

import { withInstrumentEditorDrafts } from "../../../utils/instrumentBudgetComponents";
import TypeBComponentsEditor from "./TypeBComponentsEditor";

describe("TypeBComponentsEditor", () => {
  it("starts empty and discards a recovered blank legacy placeholder", () => {
    render(<TypeBComponentsEditor components={[{ id: "blank", name: "", unit: "V", toleranceLimit: "", tolerance: {}, distribution: "not_set" }]} onChange={() => {}} />);
    expect(document.querySelector(".typeb-card")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "Add Type B component" })).toBeInTheDocument();
  });
  it("renders existing legacy specifications through the shared manual editor", () => {
    render(<TypeBComponentsEditor components={[{ id: "legacy", name: "Head Pressure", unit: "psig", inputMode: "tolerance", toleranceLimit: ".01", distribution: "2.449" }]} onChange={() => {}} />);
    expect(screen.getByText("Head Pressure")).toBeInTheDocument();
    expect(document.querySelector(".typeb-card")).toBeNull();
    expect(screen.getByRole("table")).toHaveTextContent("psig");
    expect(screen.getByRole("table")).toHaveTextContent("Triangular");
  });
});

it("uses the budget equation editor and includes an active draft in an instrument save", async () => {
 localStorage.clear();
 let latest = [];
 function Wrapper() {
   const [components, setComponents] = React.useState([]);
   return <TypeBComponentsEditor components={components} referenceUnit="V" onChange={next => { latest = next; setComponents(next); }} />;
 }
 const first = render(<Wrapper />);
 fireEvent.click(screen.getByRole("button", { name: "Add Type B component", exact: true }));
 fireEvent.click(screen.getByRole("option", { name: "Add equation component", exact: true }));
 const equation = await screen.findByLabelText("Uncertainty equation");
 fireEvent.change(equation, { target: { value: "x/100" } });
 const saved = withInstrumentEditorDrafts({ typeBComponents: latest });
 expect(saved.typeBComponents[0].budgetComponent.dynamicDefinition.equation).toBe("x/100");
 const component = latest[0];
 first.unmount();
 render(<TypeBComponentsEditor components={[component]} referenceUnit="V" onChange={() => {}} />);
 expect(screen.getByLabelText("Uncertainty equation")).toHaveValue("x/100");
 fireEvent.keyDown(screen.getByLabelText("Uncertainty equation"), { key: "Escape" });
 expect(withInstrumentEditorDrafts({ typeBComponents: latest }).typeBComponents[0].budgetComponent.dynamicDefinition.equation).toBe("");
});
