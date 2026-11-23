import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BugReportModal from "./BugReportModal";

describe("BugReportModal actions", () => {
  it("reads feedback only for History and keeps failed/loading reads distinct from empty history", () => {
    const onLoad = vi.fn().mockResolvedValue([]);
    const props = { onLoad, onClose: vi.fn(), onSave: vi.fn(), loadState: { phase: "idle" } };
    const { rerender } = render(<BugReportModal {...props} isOpen={false} />);
    expect(onLoad).not.toHaveBeenCalled();
    rerender(<BugReportModal {...props} isOpen loadState={{ phase: "loading" }} />);
    expect(onLoad).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Submit report" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(onLoad).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Loading feedback");
    expect(screen.queryByRole("button", { name: "Submit report" })).toBeNull();
    rerender(<BugReportModal {...props} isOpen loadState={{ phase: "error", error: "Read denied" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Read denied");
    fireEvent.click(screen.getByRole("button", { name: "Retry feedback" }));
    expect(onLoad).toHaveBeenCalledTimes(2);
    rerender(<BugReportModal {...props} isOpen loadState={{ phase: "ready" }} />);
    expect(screen.getByRole("button", { name: "History (0)" })).toBeInTheDocument();
    expect(screen.getByText("No reports submitted yet.")).toBeInTheDocument();
  });

  it("keeps new reports available after a history read failure and preserves denied input for retry", async () => {
    let rejectSave;
    const onSave = vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; })).mockResolvedValueOnce({});
    const onLoad = vi.fn();
    render(<BugReportModal isOpen onSave={onSave} onLoad={onLoad} loadState={{ phase: "error", error: "Read denied" }} />);
    fireEvent.change(screen.getByPlaceholderText("Brief summary..."), { target: { value: "Display issue" } });
    fireEvent.change(screen.getByPlaceholderText("Describe the issue..."), { target: { value: "Keep these details" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Submit report" })).toBeDisabled();
    await act(async () => rejectSave(new Error("Flow approval cancelled")));
    await screen.findByText("Failed to save report.");
    expect(screen.queryByText("Report submitted.")).toBeNull();
    expect(screen.getByPlaceholderText("Brief summary...")).toHaveValue("Display issue");
    expect(screen.getByPlaceholderText("Describe the issue...")).toHaveValue("Keep these details");
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Display issue" }), { create: true });
    expect(onLoad).not.toHaveBeenCalled();
    expect(await screen.findByText("Report submitted.")).toBeInTheDocument();
  });
  it("uses the shared borderless check action for submit and completion", () => {
    render(
      <BugReportModal
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        reports={[
          {
            id: "bug-1",
            title: "Example issue",
            description: "Details",
            type: "Bug",
            priority: "Normal",
            status: "Open",
            date: "2026-08-19",
          },
        ]}
      />,
    );

    const submit = screen.getByRole("button", { name: "Submit report" });
    expect(submit).toHaveClass("bug-report-check-action");
    expect(submit).not.toHaveClass("nav-btn", "primary");

    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    const complete = screen.getByRole("button", { name: "Mark Complete" });
    expect(complete).toHaveClass(
      "bug-report-check-action",
      "bug-report-check-action--complete",
    );
    expect(complete).not.toHaveClass("icon-btn-round");
  });
});
