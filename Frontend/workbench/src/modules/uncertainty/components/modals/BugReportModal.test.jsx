import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BugReportModal from "./BugReportModal";

describe("BugReportModal actions", () => {
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
