import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EquationLibraryMenu from "./EquationLibraryMenu";

describe("EquationLibraryMenu", () => {
  it("renders the metrology areas and their equations", () => {
    render(<EquationLibraryMenu onSelect={vi.fn()} />);
    expect(screen.getByText("Electrical")).toBeTruthy();
    expect(screen.getByText("Dimensional")).toBeTruthy();
    expect(screen.getByText("AC waveform")).toBeTruthy();
    expect(screen.getByText("V * Irms * cos(theta)")).toBeTruthy();
  });

  it("hands the full equation entry to onSelect", () => {
    const onSelect = vi.fn();
    render(<EquationLibraryMenu onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /AC real power/i }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const selected = onSelect.mock.calls[0][0];
    expect(selected.expression).toBe("V * Irms * cos(theta)");
    expect(selected.variables).toEqual({
      V: "Voltage",
      Irms: "Current",
      theta: "Phase Angle",
    });
  });

  it("filters both built-in and custom equations by search text", () => {
    const custom = [
      {
        id: "eq-1",
        name: "Shunt power coefficient",
        expression: "Pd / P0",
        measurementArea: "AC Shunts",
        variables: { Pd: "Dissipated Power", P0: "Reference Power" },
      },
    ];
    render(<EquationLibraryMenu onSelect={vi.fn()} customEquations={custom} />);

    // Custom group renders, marked as custom.
    expect(screen.getByText("AC Shunts")).toBeTruthy();
    expect(screen.getByText("(custom)")).toBeTruthy();
    expect(screen.getByText("Shunt power coefficient")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search equation library"), {
      target: { value: "shunt power" },
    });
    expect(screen.getByText("Shunt power coefficient")).toBeTruthy();
    expect(screen.queryByText("AC real power")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search equation library"), {
      target: { value: "zzz-no-match" },
    });
    expect(screen.getByText(/No equations match/)).toBeTruthy();
  });

  it("offers delete on custom entries and save-current when allowed", () => {
    const onDeleteCustom = vi.fn();
    const onSaveCurrent = vi.fn();
    const custom = [
      {
        id: "eq-1",
        name: "Ratio",
        expression: "a / b",
        measurementArea: "",
        variables: { a: "A", b: "B" },
      },
    ];
    render(
      <EquationLibraryMenu
        onSelect={vi.fn()}
        customEquations={custom}
        onDeleteCustom={onDeleteCustom}
        onSaveCurrent={onSaveCurrent}
        canSaveCurrent
        measurementAreas={[{ id: "electrical", name: "Electrical" }]}
        defaultMeasurementArea="Electrical"
      />,
    );

    // Unfiled custom entries land in "My Equations".
    expect(screen.getByText("My Equations")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /Delete custom equation Ratio/i }),
    );
    expect(onDeleteCustom).toHaveBeenCalledWith(custom[0]);

    fireEvent.click(screen.getByRole("button", { name: /Save current/i }));
    expect(screen.getByText("Save current equation")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Equation name"), {
      target: { value: "Current equation" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save equation/i }));
    expect(onSaveCurrent).toHaveBeenCalledTimes(1);
    expect(onSaveCurrent).toHaveBeenCalledWith({
      name: "Current equation",
      measurementArea: "Electrical",
    });
  });

  it("disables save-current with a reason when the editor equation is invalid", () => {
    render(
      <EquationLibraryMenu
        onSelect={vi.fn()}
        onSaveCurrent={vi.fn()}
        canSaveCurrent={false}
        saveDisabledReason="Equation does not parse"
      />,
    );
    const saveBtn = screen.getByRole("button", { name: /Save current/i });
    expect(saveBtn).toBeDisabled();
    expect(saveBtn.title).toMatch(/does not parse/i);
  });
});
