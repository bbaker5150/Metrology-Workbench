import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditableDescriptionCell, RangeCell } from "./UncertaintyPanel";

describe("inline instrument column navigation", () => {
  it("keeps library suggestions concise and omits unset metadata", async () => {
    render(
      <EditableDescriptionCell
        make=""
        model=""
        name=""
        functionKey="voltage::V"
        onCommit={vi.fn()}
        onPickLibrary={vi.fn()}
        instruments={[
          {
            id: "local-dmm",
            manufacturer: "Acme",
            model: "DMM-1",
            description: "Bench meter",
            scope: "local",
            sourceId: "shared-dmm",
            validatedSnapshot: {
              manufacturer: "Acme",
              model: "DMM-1",
              description: "Original meter",
              functions: [],
            },
            functions: [
              {
                id: "voltage",
                name: "Voltage",
                unit: "V",
                ranges: [{ id: "all", min: "", max: "", unit: "V", tolerances: {} }],
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Click to add description" }));

    await waitFor(() => expect(screen.getByText("Acme DMM-1 Bench meter")).toBeInTheDocument());
    expect(screen.getByText("local")).toBeInTheDocument();
    expect(screen.queryByText(/not set/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/new|changed|synced/i)).not.toBeInTheDocument();
  });

  it("moves Tab from the final description input to the range column", async () => {
    const openRange = vi.fn();
    const RangeCellHarness = () => {
      const [isOpen, setIsOpen] = useState(false);
      return isOpen ? (
        <input aria-label="Range minimum" />
      ) : (
        <button
          type="button"
          className="inline-tolerance-summary"
          onClick={() => {
            openRange();
            // Initial range creation is persisted before the editor mounts in
            // the real table. Reproduce that delay so the test protects the
            // focus handoff rather than only the already-mounted case.
            window.setTimeout(() => setIsOpen(true), 30);
          }}
        >
          Not Set
        </button>
      );
    };
    render(
      <table>
        <tbody>
          <tr>
            <td>
              <EditableDescriptionCell
                make="Mock"
                model="Calibration"
                name="Beam"
                onCommit={vi.fn()}
              />
            </td>
            <td>
              <RangeCellHarness />
            </td>
          </tr>
        </tbody>
      </table>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Mock Calibration Beam" }),
    );
    const nameInput = screen.getByPlaceholderText("Name");
    nameInput.focus();
    fireEvent.keyDown(nameInput, { key: "Tab" });

    expect(openRange).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.getByLabelText("Range minimum")).toHaveFocus();
    });
  });

  it("opens all ranges and focuses the clicked range on the first click", async () => {
    const RangeHarness = () => {
      const [expanded, setExpanded] = useState(false);
      const [pending, setPending] = useState(false);
      const range = { id: "r1", min: "0", max: "10", unit: "V" };
      return (
        <RangeCell
          ranges={[range]}
          activeIndex={0}
          activeRange={range}
          editable
          onEditBound={vi.fn()}
          onEditUnit={vi.fn()}
          onExpandAll={expanded ? undefined : () => setExpanded(true)}
          onRequestEditAfterExpand={() => setPending(true)}
          openRequested={expanded && pending}
          onOpenRequestHandled={() => setPending(false)}
        />
      );
    };

    render(<RangeHarness />);
    const editRanges = screen.getByRole("button", { name: "Edit ranges" });
    expect(editRanges).toHaveAttribute("title", "Edit ranges");
    fireEvent.click(editRanges);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("min")).toHaveFocus();
    });
  });
});
