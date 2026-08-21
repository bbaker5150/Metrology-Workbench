import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("plotly.js-dist", () => ({ default: {} }));

import TypeBComponentsEditor from "./TypeBComponentsEditor";

describe("TypeBComponentsEditor", () => {
  it("uses the shared inline tolerance editor and simple distribution select", () => {
    const onChange = vi.fn();
    render(
      <TypeBComponentsEditor
        components={[
          {
            id: "typeb-1",
            name: "Head Pressure",
            unit: "psig",
            inputMode: "tolerance",
            toleranceLimit: "0.01",
            distribution: "3.464",
            tolerance: {
              floor: {
                high: "0.01",
                low: "-0.01",
                unit: "psig",
                distribution: "3.464",
                symmetric: true,
              },
            },
          },
        ]}
        onChange={onChange}
        showIntro={false}
      />,
    );

    fireEvent.click(screen.getByTitle("Edit tolerance"));
    expect(screen.getByText("Distribution")).toBeInTheDocument();
    const distribution = screen.getByLabelText("Spec distribution");
    expect(distribution.closest(".typeb-distribution-field")).not.toBeNull();
    expect(distribution.closest(".typeb-tolerance-editor")).toBeNull();
    expect(distribution).toHaveValue("3.464");
    fireEvent.change(distribution, { target: { value: "2.449" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ distribution: "2.449" }),
      ]),
    );
  });

  it("persists a distribution selected before a Type B tolerance is entered", () => {
    const onChange = vi.fn();
    render(
      <TypeBComponentsEditor
        components={[{ id: "typeb-empty", name: "Head Pressure", unit: "psig" }]}
        onChange={onChange}
        showIntro={false}
      />,
    );

    fireEvent.change(screen.getByLabelText("Spec distribution"), {
      target: { value: "2.449" },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ distribution: "2.449" }),
      ]),
    );
  });

  it("lets Type B users switch a tolerance between symmetric and asymmetric without collapsing", async () => {
    const onChange = vi.fn();
    render(
      <TypeBComponentsEditor
        components={[
          {
            id: "typeb-shape",
            name: "Head Pressure",
            unit: "psig",
            inputMode: "tolerance",
            tolerance: {
              floor: {
                high: "0.01",
                low: "-0.01",
                unit: "psig",
                distribution: "3.464",
                symmetric: true,
              },
            },
          },
        ]}
        onChange={onChange}
        showIntro={false}
      />,
    );

    fireEvent.click(screen.getByTitle("Edit tolerance"));
    fireEvent.click(screen.getByTitle("Asymmetric tolerance"));

    await waitFor(() =>
      expect(screen.getByTitle("Asymmetric tolerance")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    const latest = onChange.mock.lastCall?.[0]?.[0];
    expect(latest?.tolerance?.floor?.symmetric).toBe(false);
  });

  it("uses the shared compact searchable unit selector", async () => {
    const onChange = vi.fn();
    render(
      <TypeBComponentsEditor
        components={[{ id: "typeb-unit", name: "Head Pressure", unit: "psig" }]}
        onChange={onChange}
        showIntro={false}
      />,
    );

    const unitButton = screen.getByRole("button", {
      name: "Type B component unit base unit",
    });
    expect(unitButton.parentElement?.className).toContain("builder-unit-select");
    expect(unitButton.parentElement?.getAttribute("style")).toContain(
      "--inline-unit-width: 9ch",
    );

    fireEvent.click(unitButton);
    const search = await screen.findByPlaceholderText("Search units...");
    fireEvent.change(search, { target: { value: "lb" } });
    const poundOption = await screen.findByRole("option", { name: "lb lb" });
    fireEvent.click(poundOption);

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ unit: "lb" })]),
    );
  });

  it("offers a working range selector for a single function and range", () => {
    const onChange = vi.fn();
    const functions = [
      {
        id: "fn-1",
        name: "Pressure",
        unit: "psig",
        ranges: [{ id: "range-1", min: "0", max: "100", unit: "psig" }],
      },
    ];
    const Wrapper = () => {
      const [components, setComponents] = React.useState([
        { id: "typeb-2", name: "Head pressure", unit: "psig" },
      ]);
      return (
        <TypeBComponentsEditor
          components={components}
          onChange={(next) => {
            onChange(next);
            setComponents(next);
          }}
          functions={functions}
          showIntro={false}
        />
      );
    };

    render(<Wrapper />);
    fireEvent.change(screen.getByRole("combobox", { name: "Type B component scope" }), {
      target: { value: "range" },
    });

    expect(screen.getByRole("combobox", { name: "Type B component range" })).toHaveValue(
      "range-1",
    );
    expect(onChange).toHaveBeenCalled();
  });
});
