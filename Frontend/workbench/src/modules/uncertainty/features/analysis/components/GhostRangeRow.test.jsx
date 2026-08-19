import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  GhostRangeRow,
  InlineToleranceCell,
  InlineDistributionCell,
  ResolutionCellInput,
  RangeCell,
  getBudgetRangeChoices,
  getVisibleRangeRows,
  removeRangeFromItem,
} from "./UncertaintyPanel";

// The buffered ghost add-row must:
//   1. NOT create a range while you tab from min to max (focus stays in the row)
//   2. create exactly ONE range, carrying both bounds, when focus leaves the row
// This is the regression guard for the "typing min spawned a duplicate row and
// broke Tab" bug.

const renderGhost = (onMaterialize, unit = "V") =>
  render(
    <table>
      <tbody>
        <GhostRangeRow unit={unit} onMaterialize={onMaterialize} />
      </tbody>
    </table>,
  );

describe("GhostRangeRow", () => {
  it("keeps every function-scoped range visible in the simplified view", () => {
    const ranges = [
      { id: "r1", min: 0, max: 10, unit: "V" },
      { id: "r2", min: 10, max: 20, unit: "V" },
      { id: "r3", min: 20, max: 30, unit: "V" },
    ];

    expect(getVisibleRangeRows(ranges, 1, ranges[1], false)).toEqual([
      { range: ranges[0], index: 0, key: "r1" },
      { range: ranges[1], index: 1, key: "r2" },
      { range: ranges[2], index: 2, key: "r3" },
    ]);
  });

  it("offers every TMDE range as an explicit budget-source choice", () => {
    const choices = getBudgetRangeChoices({
      instrument: {
        functions: [
          {
            id: "voltage",
            name: "Voltage",
            unit: "V",
            ranges: [
              { id: "v-low", min: 0, max: 10, unit: "V" },
              { id: "v-high", min: 10, max: 20, unit: "V" },
            ],
          },
        ],
      },
    });

    expect(choices.map((range) => range.rangeId)).toEqual(["v-low", "v-high"]);
  });

  it("does not materialize while tabbing min → max within the row", () => {
    const onMaterialize = vi.fn();
    renderGhost(onMaterialize);
    const min = screen.getByLabelText("New range minimum");
    const max = screen.getByLabelText("New range maximum");

    fireEvent.change(min, { target: { value: "0" } });
    // Blur from min to max (relatedTarget stays inside the row) → no range yet.
    fireEvent.blur(min, { relatedTarget: max });

    expect(onMaterialize).not.toHaveBeenCalled();
  });

  it("materializes once with both bounds when focus leaves the row", () => {
    const onMaterialize = vi.fn();
    renderGhost(onMaterialize);
    const min = screen.getByLabelText("New range minimum");
    const max = screen.getByLabelText("New range maximum");

    fireEvent.change(min, { target: { value: "0" } });
    fireEvent.blur(min, { relatedTarget: max });
    fireEvent.change(max, { target: { value: "10" } });
    // Blur to somewhere outside the row (no relatedTarget) → create the range.
    fireEvent.blur(max, { relatedTarget: null });

    expect(onMaterialize).toHaveBeenCalledTimes(1);
    expect(onMaterialize).toHaveBeenCalledWith({ min: "0", max: "10", unit: "V" });
  });

  it("stays a ghost (no range) when nothing was entered", () => {
    const onMaterialize = vi.fn();
    renderGhost(onMaterialize);
    const min = screen.getByLabelText("New range minimum");
    fireEvent.blur(min, { relatedTarget: null });
    expect(onMaterialize).not.toHaveBeenCalled();
  });

  it("materializes and requests tolerance editing when its blank tolerance is clicked", () => {
    const onMaterialize = vi.fn();
    renderGhost(onMaterialize);

    fireEvent.change(screen.getByLabelText("New range minimum"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("New range maximum"), {
      target: { value: "10" },
    });
    fireEvent.mouseDown(screen.getByRole("button", { name: "Set new range tolerance" }));

    expect(onMaterialize).toHaveBeenCalledWith(
      { min: "0", max: "10", unit: "V" },
      { openTolerance: true },
    );
  });

  it("tabs through the new range unit before opening tolerance", () => {
    const onMaterialize = vi.fn();
    renderGhost(onMaterialize);

    fireEvent.change(screen.getByLabelText("New range minimum"), {
      target: { value: "0" },
    });
    const max = screen.getByLabelText("New range maximum");
    fireEvent.change(max, { target: { value: "10" } });
    fireEvent.keyDown(max, { key: "Tab" });

    expect(onMaterialize).not.toHaveBeenCalled();
    expect(screen.getByLabelText("New range unit")).toHaveClass(
      "inline-unit-select--compact",
    );
    const unitBase = screen.getByRole("button", { name: "New range unit base unit" });
    const unitPrefix = screen.getByLabelText("New range unit prefix");
    fireEvent.keyDown(unitBase, { key: "Tab" });
    expect(onMaterialize).not.toHaveBeenCalled();
    fireEvent.keyDown(unitPrefix, { key: "Tab" });

    expect(onMaterialize).toHaveBeenCalledWith(
      { min: "0", max: "10", unit: "V" },
      { openTolerance: true },
    );
  });

  it("tabs directly from a non-scalable unit into tolerance", () => {
    const onMaterialize = vi.fn();
    renderGhost(onMaterialize, "psig");

    fireEvent.change(screen.getByLabelText("New range minimum"), {
      target: { value: "0" },
    });
    const max = screen.getByLabelText("New range maximum");
    fireEvent.change(max, { target: { value: "10" } });
    fireEvent.keyDown(max, { key: "Tab" });
    fireEvent.keyDown(
      screen.getByRole("button", { name: "New range unit base unit" }),
      { key: "Tab" },
    );

    expect(onMaterialize).toHaveBeenCalledWith(
      { min: "0", max: "10", unit: "psig" },
      { openTolerance: true },
    );
  });

  it("lets the new range choose a different unit before it materializes", () => {
    const onMaterialize = vi.fn();
    renderGhost(onMaterialize);

    fireEvent.click(screen.getByRole("button", { name: "New range unit base unit" }));
    fireEvent.change(screen.getByPlaceholderText("Search units..."), {
      target: { value: "g" },
    });
    fireEvent.click(screen.getByRole("option", { name: "g Scaled" }));
    fireEvent.click(screen.getByLabelText("New range unit prefix"));
    fireEvent.click(screen.getByRole("option", { name: /Kilo k/ }));

    fireEvent.change(screen.getByLabelText("New range minimum"), {
      target: { value: "0" },
    });
    const max = screen.getByLabelText("New range maximum");
    fireEvent.change(max, { target: { value: "10" } });
    fireEvent.blur(max, { relatedTarget: null });

    expect(onMaterialize).toHaveBeenCalledWith({ min: "0", max: "10", unit: "kg" });
  });

  it("opens unit search when typing after tabbing onto the unit control", () => {
    const onMaterialize = vi.fn();
    renderGhost(onMaterialize);

    fireEvent.keyDown(
      screen.getByRole("button", { name: "New range unit base unit" }),
      { key: "l" },
    );

    expect(screen.getByPlaceholderText("Search units...")).toHaveValue("l");
  });

  it("uses the Greek micro sign in the custom prefix menu", () => {
    const onMaterialize = vi.fn();
    renderGhost(onMaterialize, "mV");

    fireEvent.click(screen.getByLabelText("New range unit prefix"));

    expect(screen.getByRole("option", { name: /Micro µ/ })).toBeInTheDocument();
  });
});

describe("inline resolution distribution", () => {
  it("shows an unset resolution consistently while keeping it accessible for editing", () => {
    render(
      <ResolutionCellInput
        value=""
        unit="V"
        onCommit={vi.fn()}
        onCommitUnit={vi.fn()}
      />,
    );

    const emptyResolution = screen.getByRole("button", { name: "Set resolution" });
    expect(emptyResolution).toHaveTextContent("Not Set");
    fireEvent.click(emptyResolution);
    expect(screen.getByPlaceholderText("—")).toBeInTheDocument();
  });

  it("shows the full custom distribution menu", () => {
    const onCommitDistribution = vi.fn();
    render(
      <ResolutionCellInput
        value="0.001"
        unit="V"
        distribution="1.732"
        onCommit={vi.fn()}
        onCommitUnit={vi.fn()}
        onCommitDistribution={onCommitDistribution}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "0.001 V" }));
    fireEvent.click(screen.getByRole("button", { name: "Resolution distribution" }));
    expect(screen.getByRole("option", { name: /Triangular\s+2\.449/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Normal \(95%\)/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Triangular\s+2\.449/ }));

    expect(onCommitDistribution).toHaveBeenCalledWith("2.449");
  });

  it("exposes the complete distribution set, including non-rectangular shapes", () => {
    const onChange = vi.fn();
    render(
      <InlineDistributionCell divisor="1.732" onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Rectangular/ }));
    fireEvent.click(screen.getByRole("button", { name: "Spec band distribution" }));

    expect(screen.getByRole("option", { name: /Triangular\s+2\.449/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /U-Shaped/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Rayleigh/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: /Triangular\s+2\.449/ }));
    expect(onChange).toHaveBeenCalledWith("2.449");
  });

  it("uses the same Not Set label for an empty distribution", () => {
    render(<InlineDistributionCell divisor="" onChange={vi.fn()} />);

    expect(screen.getByText("Not Set")).toHaveClass(
      "inline-tolerance-summary",
      "is-empty",
    );
    expect(screen.getByRole("button", { name: "Not Set" })).toBeEnabled();
  });

  it("keeps a portaled distribution menu open while focus moves into its options", () => {
    const onChange = vi.fn();
    render(<InlineDistributionCell divisor="not_set" onChange={onChange} />);

    const unsetDistribution = screen.getByRole("button", { name: "Not Set" });
    expect(unsetDistribution).toHaveClass("inline-tolerance-summary", "is-empty");
    fireEvent.click(unsetDistribution);
    fireEvent.click(screen.getByRole("button", { name: "Spec band distribution" }));
    const option = screen.getByRole("option", { name: /Triangular\s+2\.449/ });
    const trigger = screen.getByRole("button", { name: "Spec band distribution" });

    // In Chromium the trigger blurs before the portaled option receives its
    // click. The editor must treat that focus transition as internal.
    fireEvent.blur(trigger, { relatedTarget: option });
    expect(option).toBeInTheDocument();
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith("2.449");
  });

  it("offers the triangular resolution divisor", () => {
    const onCommitDistribution = vi.fn();
    render(
      <ResolutionCellInput
        value="0.001"
        unit="V"
        distribution="1.732"
        onCommit={vi.fn()}
        onCommitUnit={vi.fn()}
        onCommitDistribution={onCommitDistribution}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "0.001 V" }));
    fireEvent.click(screen.getByRole("button", { name: "Resolution distribution" }));
    const option = screen.getByRole("option", {
      name: /Triangular \(resolution\)\s+4\.899/,
    });
    expect(option).toBeInTheDocument();
    fireEvent.click(option);

    expect(onCommitDistribution).toHaveBeenCalledWith("4.899");
  });
});

describe("inline range editing", () => {
  it("labels an all-values range as Not Set", () => {
    render(
      <RangeCell
        ranges={[{ id: "range-1", min: "", max: "", unit: "V" }]}
        activeRange={{ id: "range-1", min: "", max: "", unit: "V" }}
        editable
        onEditBound={vi.fn()}
        onEditUnit={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Not Set" })).toBeInTheDocument();
  });

  it("materializes the synthetic first range before opening its inputs", () => {
    const onEnsureInitialRange = vi.fn();
    const props = {
      editable: true,
      onEnsureInitialRange,
      onEditBound: vi.fn(),
      onEditUnit: vi.fn(),
    };
    const { rerender } = render(
      <RangeCell
        ranges={[]}
        activeRange={{}}
        {...props}
      />,
    );

    fireEvent.click(screen.getByTitle("Click to set a range"));

    expect(onEnsureInitialRange).toHaveBeenCalledOnce();
    rerender(
      <RangeCell
        ranges={[{ id: "range-1", min: "", max: "", unit: "V" }]}
        activeRange={{ id: "range-1", min: "", max: "", unit: "V" }}
        {...props}
      />,
    );
    expect(screen.getByPlaceholderText("min")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("max")).toBeInTheDocument();
  });

  it("opens a blank initial range directly instead of expanding the range list", () => {
    const onExpandAll = vi.fn();
    render(
      <RangeCell
        ranges={[{ id: "range-1", min: "", max: "", unit: "V" }]}
        activeRange={{ id: "range-1", min: "", max: "", unit: "V" }}
        editable
        onExpandAll={onExpandAll}
        onEditBound={vi.fn()}
        onEditUnit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle("Click to set a range"));

    expect(onExpandAll).not.toHaveBeenCalled();
    expect(screen.queryByText("Set rangeâ€¦")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("min")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("max")).toBeInTheDocument();
  });

  it("does not render a clear/delete control beside the unit while editing", () => {
    render(
      <RangeCell
        ranges={[{ id: "range-1", min: 0, max: 10, unit: "V" }]}
        activeRange={{ id: "range-1", min: 0, max: 10, unit: "V" }}
        editable
        onEditBound={vi.fn()}
        onEditUnit={vi.fn()}
        onPatchRange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle("Click to edit range"));
    expect(screen.queryByRole("button", { name: "Clear range" })).not.toBeInTheDocument();
  });

  it("clears a blanked single-value range through the row removal path", () => {
    const onClearRange = vi.fn();
    render(
      <RangeCell
        ranges={[
          {
            id: "range-2",
            isSingleValue: true,
            value: 10,
            min: 10,
            max: 10,
            unit: "V",
          },
        ]}
        activeRange={{
          id: "range-2",
          isSingleValue: true,
          value: 10,
          min: 10,
          max: 10,
          unit: "V",
        }}
        editable
        onEditBound={vi.fn()}
        onEditUnit={vi.fn()}
        onPatchRange={vi.fn()}
        onClearRange={onClearRange}
      />,
    );

    fireEvent.click(screen.getByTitle("Click to edit range"));
    const value = screen.getByPlaceholderText("value");
    fireEvent.change(value, { target: { value: "" } });
    fireEvent.blur(value);

    expect(onClearRange).toHaveBeenCalledOnce();
  });

  it("dismisses blank range inputs with Escape without committing a bound", () => {
    const onEditBound = vi.fn();
    render(
      <RangeCell
        ranges={[{ id: "range-1", min: "", max: "", unit: "V" }]}
        activeRange={{ id: "range-1", min: "", max: "", unit: "V" }}
        editable
        onEditBound={onEditBound}
        onEditUnit={vi.fn()}
        onPatchRange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle("Click to set a range"));
    fireEvent.keyDown(screen.getByPlaceholderText("min"), { key: "Escape" });

    expect(onEditBound).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Not Set" })).toBeInTheDocument();
  });

  it("can open tolerance editing after an accidental click on an unset range", () => {
    const blankRange = { id: "range-1", min: "", max: "", unit: "V" };
    render(
      <div>
        <RangeCell
          ranges={[blankRange]}
          activeRange={blankRange}
          editable
          onEditBound={vi.fn()}
          onEditUnit={vi.fn()}
          onPatchRange={vi.fn()}
        />
        <InlineToleranceCell
          tolerance={{}}
          activeRange={blankRange}
          editable
          onCommit={vi.fn()}
        />
      </div>,
    );

    fireEvent.click(screen.getByTitle("Click to set a range"));
    expect(screen.getByPlaceholderText("min")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Set tolerance" }));

    expect(screen.queryByPlaceholderText("min")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set tolerance" })).not.toBeInTheDocument();
  });

  it("leaves a blank replacement range collapsed as Not Set", () => {
    render(
      <RangeCell
        ranges={[{ id: "replacement", min: "", max: "", unit: "V" }]}
        activeRange={{ id: "replacement", min: "", max: "", unit: "V" }}
        editable
        onEditBound={vi.fn()}
        onEditUnit={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Not Set" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("min")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("max")).not.toBeInTheDocument();
  });

  it("opens the complete range list instead of an in-cell editor", () => {
    const onExpandAll = vi.fn();
    render(
      <RangeCell
        ranges={[{ id: "range-1", min: 0, max: 10, unit: "V" }]}
        activeRange={{ id: "range-1", min: 0, max: 10, unit: "V" }}
        editable
        onExpandAll={onExpandAll}
        onEditBound={vi.fn()}
        onEditUnit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show all ranges" }));

    expect(onExpandAll).toHaveBeenCalledOnce();
    expect(screen.queryByPlaceholderText("min")).not.toBeInTheDocument();
  });

  it("tabs through the range unit before opening tolerance", () => {
    const onEditBound = vi.fn();
    const onOpenTolerance = vi.fn();
    render(
      <RangeCell
        ranges={[{ id: "range-1", min: 0, max: "", unit: "V" }]}
        activeRange={{ id: "range-1", min: 0, max: "", unit: "V" }}
        editable
        onEditBound={onEditBound}
        onEditUnit={vi.fn()}
        onOpenTolerance={onOpenTolerance}
      />,
    );

    fireEvent.click(screen.getByTitle("Click to set a range"));
    const max = screen.getByPlaceholderText("max");
    fireEvent.change(max, { target: { value: "10" } });
    fireEvent.keyDown(max, { key: "Tab" });

    expect(onOpenTolerance).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Range unit")).toHaveClass(
      "inline-unit-select--compact",
    );
    const unitBase = screen.getByRole("button", { name: "Range unit base unit" });
    const unitPrefix = screen.getByLabelText("Range unit prefix");
    fireEvent.blur(max, { relatedTarget: unitBase });
    fireEvent.keyDown(unitBase, { key: "Tab" });
    expect(onOpenTolerance).not.toHaveBeenCalled();
    fireEvent.keyDown(unitPrefix, { key: "Tab" });

    expect(onEditBound).toHaveBeenCalledWith("max", "10");
    expect(onOpenTolerance).toHaveBeenCalledOnce();
  });

  it("removes a range together with its tolerance and resolution data", () => {
    const item = {
      instrument: {
        functions: [
          {
            id: "fn-1",
            ranges: [
              {
                id: "range-1",
                min: 0,
                max: 10,
                resolution: 0.001,
                tolerances: { reading: { value: 1, unit: "%" } },
              },
              { id: "range-2", min: 10, max: 100, resolution: 0.01 },
            ],
          },
        ],
      },
    };

    const updated = removeRangeFromItem(item, "range-1");

    expect(updated.instrument.functions[0].ranges).toEqual([
      { id: "range-2", min: 10, max: 100, resolution: 0.01 },
    ]);
  });

  it("opens a requested tolerance editor after the new range is materialized", () => {
    const onOpenRequestHandled = vi.fn();
    render(
      <InlineToleranceCell
        tolerance={{}}
        activeRange={{ id: "range-1", min: 0, max: 10, unit: "V" }}
        editable
        openRequested
        onOpenRequestHandled={onOpenRequestHandled}
        onCommit={vi.fn()}
      />,
    );

    expect(onOpenRequestHandled).toHaveBeenCalledOnce();
    expect(screen.getAllByPlaceholderText("0").length).toBeGreaterThan(0);
  });

  it("opens tolerance editing from the tolerance text without an edit/add button", () => {
    render(
      <InlineToleranceCell
        tolerance={{}}
        activeRange={{ id: "range-1", min: 0, max: 10, unit: "V" }}
        editable
        onCommit={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Edit or add tolerance terms" }),
    ).not.toBeInTheDocument();

    const emptyTolerance = screen.getByRole("button", { name: "Set tolerance" });
    expect(emptyTolerance).toHaveTextContent("Not Set");
    fireEvent.click(emptyTolerance);

    expect(screen.getAllByPlaceholderText("0").length).toBeGreaterThan(0);
  });

  it("collapses an expanded tolerance on Escape or a click in another column", async () => {
    render(
      <div>
        <InlineToleranceCell
          tolerance={{ reading: { high: "1", low: "-1", unit: "%" } }}
          activeRange={{ id: "range-1", min: 0, max: 10, unit: "V" }}
          editable
          onCommit={vi.fn()}
        />
        <button type="button">Other column</button>
      </div>,
    );

    fireEvent.click(screen.getByTitle("Click to edit tolerance"));
    fireEvent.keyDown(screen.getAllByPlaceholderText("0")[0], { key: "Escape" });
    expect(screen.getByTitle("Click to edit tolerance")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Click to edit tolerance"));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Other column" }));
    fireEvent.click(screen.getByRole("button", { name: "Other column" }));
    await waitFor(() =>
      expect(screen.getByTitle("Click to edit tolerance")).toBeInTheDocument(),
    );
  });

  it("collapses range, resolution, and distribution editors outside their columns", async () => {
    render(
      <div>
        <RangeCell
          ranges={[{ id: "range-1", min: 0, max: 10, unit: "V" }]}
          activeIndex={0}
          activeRange={{ id: "range-1", min: 0, max: 10, unit: "V" }}
          editable
          onEditBound={vi.fn()}
          onEditUnit={vi.fn()}
          onPatchRange={vi.fn()}
        />
        <ResolutionCellInput
          value="0.01"
          unit="V"
          distribution="3.464"
          onCommit={vi.fn()}
          onCommitUnit={vi.fn()}
          onCommitDistribution={vi.fn()}
        />
        <InlineDistributionCell divisor="1.732" onChange={vi.fn()} />
        <button type="button">Outside column</button>
      </div>,
    );

    const outside = screen.getByRole("button", { name: "Outside column" });

    fireEvent.click(screen.getByTitle("Click to edit range"));
    expect(screen.getByPlaceholderText("min")).toBeInTheDocument();
    fireEvent.pointerDown(outside);
    await waitFor(() =>
      expect(screen.getByTitle("Click to edit range")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTitle("Click to edit resolution"));
    expect(screen.getByPlaceholderText("—")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTitle("Click to edit resolution")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Click to edit distribution"));
    expect(screen.getByLabelText("Spec band distribution")).toBeInTheDocument();
    fireEvent.pointerDown(outside);
    await waitFor(() =>
      expect(screen.getByTitle("Click to edit distribution")).toBeInTheDocument(),
    );
  });

  it("authors a workbook-style single-sided unknown upper limit", () => {
    const onCommit = vi.fn();
    render(
      <InlineToleranceCell
        tolerance={{}}
        activeRange={{ id: "range-1", min: 0, max: 600, unit: "degF" }}
        editable
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Set tolerance/ }));
    fireEvent.click(screen.getByTitle("Asymmetric tolerance"));
    fireEvent.click(screen.getByTitle("Single-sided tolerance"));
    fireEvent.click(screen.getByRole("radio", { name: "Measurement unknown" }));
    fireEvent.change(screen.getByLabelText("Measurement unknown Upper limit"), {
      target: { value: "600" },
    });
    fireEvent.blur(screen.getByLabelText("Measurement unknown Upper limit"));

    expect(onCommit).toHaveBeenLastCalledWith(
      "singleSided",
      expect.objectContaining({
        direction: "high",
        measurement: "unknown",
        limit: "600",
        unit: "degF",
      }),
    );
  });

  it("selects the single-sided direction from the Single Sided menu", () => {
    const onCommit = vi.fn();
    render(
      <InlineToleranceCell
        tolerance={{}}
        activeRange={{ id: "range-1", min: 0, max: 600, unit: "degF" }}
        editable
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Set tolerance/ }));
    fireEvent.click(screen.getByTitle("Asymmetric tolerance"));
    fireEvent.click(screen.getByTitle("Single-sided tolerance"));
    fireEvent.click(screen.getByRole("button", { name: "Single-sided direction" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Low" }));

    expect(screen.getByRole("button", { name: "Single-sided direction" })).toHaveTextContent(
      "Single Sided Low",
    );
    expect(onCommit).toHaveBeenLastCalledWith(
      "singleSided",
      expect.objectContaining({ direction: "low" }),
    );
  });

  it("keeps single-sided disabled until the global mode is asymmetric", () => {
    render(
      <InlineToleranceCell
        tolerance={{}}
        activeRange={{ id: "range-1", min: 0, max: 10, unit: "V" }}
        editable
        onCommit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Set tolerance/ }));
    expect(screen.getByTitle("Single-sided tolerances are asymmetric")).toBeDisabled();
    fireEvent.click(screen.getByTitle("Asymmetric tolerance"));
    expect(screen.getByTitle("Single-sided tolerance")).toBeEnabled();
    expect(screen.queryByTitle(/Tolerance shape:/)).not.toBeInTheDocument();
  });

  it("offers percent, ppm, and ppb units for IV tolerance", () => {
    const onCommit = vi.fn();
    render(
      <InlineToleranceCell
        tolerance={{}}
        activeRange={{ id: "range-1", min: 0, max: 10, unit: "V" }}
        editable
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Set tolerance/ }));
    fireEvent.click(screen.getByRole("button", { name: "IV %" }));

    expect(screen.getByRole("menuitemradio", { name: "%" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "ppm" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "ppb" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "ppm" }));
    expect(onCommit).toHaveBeenLastCalledWith(
      "reading",
      expect.objectContaining({ unit: "ppm" }),
    );
  });

  it("offers the same relative units for Range/FS tolerance", () => {
    const onCommit = vi.fn();
    render(
      <InlineToleranceCell
        tolerance={{}}
        activeRange={{ id: "range-1", min: 0, max: 10, unit: "V" }}
        editable
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Set tolerance/ }));
    fireEvent.click(screen.getByRole("button", { name: "% FS" }));

    expect(screen.getByRole("menuitemradio", { name: "%" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "ppm" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "ppb" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "ppb" }));
    expect(onCommit).toHaveBeenLastCalledWith(
      "range",
      expect.objectContaining({ unit: "ppb" }),
    );
  });
});
