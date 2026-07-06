import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GhostRangeRow } from "./UncertaintyPanel";

// The buffered ghost add-row must:
//   1. NOT create a range while you tab from min to max (focus stays in the row)
//   2. create exactly ONE range, carrying both bounds, when focus leaves the row
// This is the regression guard for the "typing min spawned a duplicate row and
// broke Tab" bug.

const renderGhost = (onMaterialize) =>
  render(
    <table>
      <tbody>
        <GhostRangeRow unit="V" onMaterialize={onMaterialize} />
      </tbody>
    </table>,
  );

describe("GhostRangeRow", () => {
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
});
