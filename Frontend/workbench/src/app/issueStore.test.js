import { beforeEach, expect, it, vi } from "vitest";
import axios from "axios";
import { loadIssues, saveIssue, deleteIssue } from "./issueStore";
vi.mock("axios", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
beforeEach(() => vi.clearAllMocks());
it("combines old and new reports without colliding numeric IDs", async () => {
  axios.get
    .mockResolvedValueOnce({ data: [{ id: 1, title: "AC issue" }] })
    .mockResolvedValueOnce({
      data: [{ id: 1, title: "Uncertainty issue", status: "Complete" }],
    });
  const result = await loadIssues();
  expect(result.errors).toEqual([]);
  expect(result.issues.map((i) => i.key)).toEqual([
    "workbench:1",
    "uncertainty:1",
  ]);
  expect(result.issues[1].status).toBe("Solved");
});
it("updates legacy reports in their original store and new reports in the shared store", async () => {
  axios.post.mockResolvedValue({ data: { id: 1 } });
  axios.patch.mockResolvedValue({ data: { id: 2 } });
  await saveIssue({
    id: 1,
    source: "uncertainty",
    title: "Old",
    description: "Details",
    severity: "Medium",
    status: "Solved",
  });
  expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining("/uncertainty/bug_reports/"),
    expect.objectContaining({ status: "Complete", priority: "Normal" }),
  );
  await saveIssue(
    {
      id: 2,
      title: "Updated",
      description: "Details",
      module: "Reports",
      status: "In Work",
      severity: "High",
    },
    { route: "/report-of-calibration" },
  );
  expect(axios.patch).toHaveBeenCalledWith(
    expect.stringMatching(/\/api\/bug_reports\/2\/$/),
    expect.objectContaining({
      system_info: expect.stringContaining('"module":"Reports"'),
    }),
  );
  await deleteIssue({ id: 1, source: "uncertainty" });
  expect(axios.delete).toHaveBeenCalledWith(
    expect.stringContaining("/uncertainty/bug_reports/1/"),
  );
});

it("retrieves every paginated workbench report while retaining legacy reports", async () => {
  axios.get.mockImplementation(async (url) => ({
    data: url.includes("uncertainty")
      ? [{ id: "legacy" }]
      : url.includes("page=2")
        ? { results: [{ id: 2 }], next: null }
        : { results: [{ id: 1 }], next: url.replace("page=1", "page=2") },
  }));
  const result = await loadIssues();
  expect(result.errors).toEqual([]);
  expect(result.issues.map((issue) => issue.key)).toEqual([
    "workbench:1",
    "workbench:2",
    "uncertainty:legacy",
  ]);
});
