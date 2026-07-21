import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditableDescriptionCell } from "./UncertaintyPanel";

describe("inline instrument column navigation", () => {
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
});
