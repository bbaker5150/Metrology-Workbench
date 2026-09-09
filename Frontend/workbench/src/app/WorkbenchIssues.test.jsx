import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkbenchIssues from "./WorkbenchIssues";
import { loadIssues, saveIssue, deleteIssue } from "./issueStore";
vi.mock("./issueStore", () => ({
  loadIssues: vi.fn(),
  saveIssue: vi.fn(),
  deleteIssue: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  loadIssues.mockResolvedValue({ issues: [], errors: [] });
});
describe("Workbench issue tracker", () => {
  it("keeps the draft after a failed save and persists a successful retry once", async () => {
    saveIssue
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        id: 1,
        key: "workbench:1",
        title: "Range selection",
        description: "Selection is lost",
        module: "Uncertalytics",
        severity: "Medium",
        status: "Not Started",
      });
    render(
      <WorkbenchIssues
        module="Uncertalytics"
        route="/uncertalytics"
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Range selection" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Selection is lost" },
    });
    fireEvent.click(screen.getByText("Submit issue"));
    await screen.findByText(/Could not save this issue/);
    expect(screen.getByLabelText("Title")).toHaveValue("Range selection");
    expect(
      JSON.parse(localStorage.getItem("workbench.issue-draft.v1")).title,
    ).toBe("Range selection");
    fireEvent.click(screen.getByText("Submit issue"));
    await screen.findByText("Issue submitted.");
    expect(screen.getAllByText("Range selection")).toHaveLength(1);
    expect(saveIssue).toHaveBeenLastCalledWith(
      expect.objectContaining({ module: "Uncertalytics" }),
      expect.objectContaining({ route: "/uncertalytics" }),
    );
  });
  it("filters existing reports and requires the inline confirmation before deletion", async () => {
    loadIssues.mockResolvedValue({
      issues: [
        {
          id: 4,
          key: "uncertainty:4",
          source: "uncertainty",
          title: "Old report",
          description: "Details",
          module: "Uncertalytics",
          severity: "High",
          category: "UI/UX",
          status: "Solved",
          reporter: "A",
        },
      ],
      errors: ["Workbench reports"],
    });
    deleteIssue.mockResolvedValue();
    render(<WorkbenchIssues onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Browse issues/));
    await screen.findByText(/Could not load Workbench reports/);
    expect(screen.queryByText("Old report")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "All statuses" },
    });
    fireEvent.click(screen.getByText("Old report"));
    fireEvent.click(screen.getByText("Delete"));
    expect(deleteIssue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Delete issue"));
    await screen.findByText("Issue deleted.");
    expect(deleteIssue).toHaveBeenCalledTimes(1);
  });
  it("restores an unsubmitted draft after closing and reopening", async () => {
    const view = render(
      <WorkbenchIssues module="Reports" onClose={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Report layout" },
    });
    view.unmount();
    render(<WorkbenchIssues module="Workbench" onClose={() => {}} />);
    expect(screen.getByLabelText("Title")).toHaveValue("Report layout");
    expect(screen.getByLabelText("Module")).toHaveValue("Reports");
    await waitFor(() => expect(loadIssues).toHaveBeenCalledTimes(2));
  });
});
