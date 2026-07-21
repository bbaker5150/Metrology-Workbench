import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  MeasurementInputNameCell,
  MeasurementInputNominalCell,
} from "./UncertaintyPanel";

const NameHarness = () => {
  const [name, setName] = useState("Current");
  return (
    <MeasurementInputNameCell symbol="Irms" value={name} onChange={setName} />
  );
};

const NominalHarness = () => {
  const [value, setValue] = useState("2");
  const [unit, setUnit] = useState("V");
  return (
    <MeasurementInputNominalCell
      symbol="V"
      name="Voltage"
      value={value}
      unit={unit}
      onValueChange={setValue}
      onUnitChange={setUnit}
    />
  );
};

describe("measurement input compact editors", () => {
  it("shows a clean name string, opens its input on click, and collapses away", () => {
    render(<NameHarness />);

    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit name for equation variable Irms",
      }),
    );

    const input = screen.getByRole("textbox", {
      name: "Display name for equation variable Irms",
    });
    fireEvent.change(input, { target: { value: "RMS Current" } });
    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Edit name for equation variable Irms",
      }),
    ).toHaveTextContent("RMS Current");
  });

  it("shows value and unit as one string until the nominal cell is clicked", () => {
    render(<NominalHarness />);

    const summary = screen.getByRole("button", {
      name: "Edit nominal for equation variable V",
    });
    expect(summary).toHaveTextContent("2 V");
    expect(screen.queryByRole("spinbutton")).toBeNull();

    fireEvent.click(summary);
    const valueInput = screen.getByRole("spinbutton", {
      name: "Nominal value for equation variable V",
    });
    fireEvent.change(valueInput, { target: { value: "3.5" } });
    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Edit nominal for equation variable V",
      }),
    ).toHaveTextContent("3.5 V");
  });

  it("keeps the nominal editor open while using the portaled unit menu", () => {
    const onUnitChange = vi.fn();
    render(
      <MeasurementInputNominalCell
        symbol="theta"
        name="Phase Angle"
        value="3"
        unit="rad"
        onValueChange={vi.fn()}
        onUnitChange={onUnitChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit nominal for equation variable theta",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Nominal unit for equation variable theta base unit",
      }),
    );
    const search = screen.getByPlaceholderText("Search units...");
    fireEvent.mouseDown(search);
    fireEvent.change(search, { target: { value: "deg" } });
    const degreeOption = screen
      .getAllByRole("option")
      .find(
        (option) =>
          option.textContent.endsWith("deg") &&
          !option.textContent.includes("degF"),
      );
    expect(degreeOption).toBeTruthy();
    fireEvent.click(degreeOption);

    expect(onUnitChange).toHaveBeenCalledWith("deg");
    expect(
      screen.getByRole("spinbutton", {
        name: "Nominal value for equation variable theta",
      }),
    ).toBeInTheDocument();
  });
});
