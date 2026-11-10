import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  applyItemRangePatch,
  applyToleranceCaseChange,
  InlineDistributionCell,
  InlineToleranceCell,
  pasteInstrumentIntoSession,
} from "./UncertaintyPanel";
import { getAbsoluteLimits } from "../../../utils/uncertaintyMath";
import { getBudgetComponentsFromTolerance } from "../utils/budgetUtils";

const ToleranceHarness = ({ initialTolerance = {}, maximum = "10" }) => {
  const [tolerance, setTolerance] = useState(initialTolerance);
  return (
    <>
    <output data-testid="tolerance-data">{JSON.stringify(tolerance)}</output>
    <InlineToleranceCell
      tolerance={tolerance}
      activeRange={{ id: "r1", unit: "V", max: maximum }}
      editable
      onCommit={(key, component) =>
        setTolerance((current) =>
          applyToleranceCaseChange(current, key, component),
        )
      }
    />
    </>
  );
};

describe("inline tolerance global modes", () => {
  it("tracks the maximum until the user types a full scale and restores tracking when cleared", () => {
    const { container, rerender } = render(<ToleranceHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Set tolerance" }));
    const fs = screen.getByRole("textbox", { name: "Full scale" });
    expect(fs).toHaveValue("10");
    expect(fs).toHaveStyle({ fontStyle: "italic" });
    fireEvent.focus(fs);
    fireEvent.blur(fs);
    const percent = container.querySelectorAll(".inline-tolerance-term")[1].querySelector("input");
    fireEvent.change(percent, { target: { value: "1" } });
    fireEvent.blur(percent);
    expect(JSON.parse(screen.getByTestId("tolerance-data").textContent).range.value).toBe("");
    rerender(<ToleranceHarness maximum="20" />);
    expect(fs).toHaveValue("20");
    // Retyping the same number is an intentional override.
    fireEvent.input(fs, { target: { value: "20" } });
    fireEvent.blur(fs);
    const saved = JSON.parse(screen.getByTestId("tolerance-data").textContent);
    expect(saved.range).toMatchObject({ fullScaleManual: true, value: "20" });
    rerender(<ToleranceHarness maximum="35" />);
    expect(fs).toHaveValue("20");
    expect(fs).toHaveStyle({ fontStyle: "normal" });
    fireEvent.change(fs, { target: { value: "" } });
    fireEvent.blur(fs);
    expect(fs).toHaveValue("35");
    expect(fs).toHaveStyle({ fontStyle: "italic" });
  });

  it.each([
    ["old default", { value: "10.0" }, 30],
    ["old override", { value: "20" }, 20],
    ["explicit maximum", { value: "10", fullScaleManual: true }, 10],
    ["explicit zero", { value: "0", fullScaleManual: true }, 0],
  ])("preserves %s through instrument paste, range edits, limits, and budget calculation", (_, override, fs) => {
    const range = { id: "r", min: "0", max: "10", unit: "V",
      tolerances: { range: { high: "1", low: "-1", unit: "%", distribution: "1.732", ...override } } };
    const item = { id: "source", instrument: { functions: [{ id: "fn", name: "Voltage", ranges: [range] }] } };
    const copied = pasteInstrumentIntoSession({ tmdes: [item] }, { kind: "tmde", mode: "copy", item }, "tmde").row;
    const copiedRange = copied.instrument.functions[0].ranges[0];
    const edit = applyItemRangePatch(copied, copiedRange.id, { max: "20" });
    const edited = applyItemRangePatch(edit, copiedRange.id, { max: "30" }).instrument.functions[0].ranges[0];
    const point = { value: 1000, unit: "mV" };
    expect(Number(getAbsoluteLimits(edited, point).rawHigh)).toBeCloseTo(1000 + fs * 10);
    const [component] = getBudgetComponentsFromTolerance(edited, point);
    expect(component?.toleranceLimit_native ?? 0).toBeCloseTo(fs * 10);
    expect(range.max).toBe("10");
  });

  it("accepts the highlighted floor unit with Enter and tabs from the trigger", () => {
    render(<ToleranceHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Set tolerance" }));
    const trigger = screen.getByRole("button", { name: "Tolerance unit base unit" });
    fireEvent.click(trigger);
    const search = screen.getByPlaceholderText("Search units...");
    fireEvent.change(search, { target: { value: "inch" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveTextContent("in.");
    expect(screen.queryByRole("listbox")).toBeNull();
    userEvent.tab();
    expect(screen.getByRole("button", { name: "Tolerance unit prefix" })).toHaveFocus();
  });
  it.each(["high", "low"])("saves a blank opposite %s bound as zero and preserves it on reopen", (side) => {
    const { container } = render(<ToleranceHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Set tolerance" }));
    fireEvent.click(screen.getByTitle("Asymmetric tolerance"));
    const inputs = container.querySelectorAll('.inline-tolerance-term')[2].querySelectorAll('input.inline-tolerance-input');
    const input = inputs[side === "high" ? 1 : 0];
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.blur(input);
    const tolerance = JSON.parse(screen.getByTestId("tolerance-data").textContent);
    expect(tolerance.floor.high).toBe(side === "high" ? "3" : "0");
    expect(tolerance.floor.low).toBe(side === "low" ? "-3" : "0");
    const limits = getAbsoluteLimits(tolerance, { value: 10, unit: "V" });
    expect(Number(limits.rawLow)).toBe(side === "low" ? 7 : 10);
    expect(Number(limits.rawHigh)).toBe(side === "high" ? 13 : 10);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTitle("Edit tolerance"));
    const reopened = container.querySelectorAll('.inline-tolerance-term')[2].querySelectorAll('input.inline-tolerance-input');
    expect(reopened[0]).toHaveValue(side === "low" ? "3" : "0");
    expect(reopened[1]).toHaveValue(side === "high" ? "3" : "0");
  });

  it("uses one compact symmetry/sidedness mode bar for the whole tolerance", () => {
    render(<ToleranceHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Set tolerance" }));

    const symmetric = screen.getByTitle("Symmetric tolerance");
    const asymmetric = screen.getByTitle("Asymmetric tolerance");
    const singleSided = screen.getByTitle(
      "Single-sided tolerances are asymmetric",
    );
    expect(symmetric).toHaveAttribute("aria-pressed", "true");
    expect(singleSided).toBeDisabled();
    expect(screen.queryByTitle(/Tolerance shape:/)).not.toBeInTheDocument();

    fireEvent.click(asymmetric);
    expect(screen.getByTitle("Single-sided tolerance")).not.toBeDisabled();
    fireEvent.click(screen.getByTitle("Single-sided tolerance"));

    expect(screen.getByLabelText("Single-sided direction")).toBeInTheDocument();
    expect(screen.getByText("Known nominal")).toBeInTheDocument();
    expect(screen.queryByTitle("Percent of full scale")).not.toBeInTheDocument();
  });

  it("isolates single-sided data from double-sided accuracy terms", () => {
    const initial = {
      reading: {
        high: "1",
        low: "-1",
        value: "1",
        unit: "%",
        distribution: "1.732",
        symmetric: true,
      },
    };
    render(<ToleranceHarness initialTolerance={initial} />);
    fireEvent.click(screen.getByTitle("Edit tolerance"));
    fireEvent.click(screen.getByTitle("Asymmetric tolerance"));
    fireEvent.click(screen.getByTitle("Single-sided tolerance"));

    expect(screen.queryByText("% IV")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Single-sided direction")).toBeInTheDocument();
  });

  it("reopens an existing tolerance with the complete editor", () => {
    render(
      <ToleranceHarness
        initialTolerance={{
          reading: {
            high: "1",
            low: "-1",
            value: "1",
            unit: "%",
            distribution: "1.732",
            symmetric: true,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByTitle("Edit tolerance"));

    expect(screen.getByLabelText("Tolerance mode")).toBeInTheDocument();
    expect(screen.getByLabelText("IV tolerance unit")).toBeInTheDocument();
    expect(screen.getByLabelText("Range/FS tolerance unit")).toBeInTheDocument();
    expect(screen.getByLabelText("Tolerance unit")).toBeInTheDocument();
    expect(screen.getByTitle("dB")).toBeInTheDocument();
  });
});

describe("distribution-first editing", () => {
  it("allows a distribution to be selected before a tolerance is entered", () => {
    const onChange = vi.fn();
    render(
      <InlineDistributionCell
        divisor={null}
        editable
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText("Not Set"));
    expect(screen.getByRole("button", { name: "Spec band distribution" })).toHaveAttribute("aria-expanded", "true");
    const triangular = screen
      .getAllByRole("option")
      .find((option) => option.querySelector("span")?.textContent === "Triangular");
    fireEvent.click(triangular);
    expect(onChange).toHaveBeenCalledWith("2.449");
  });
});
