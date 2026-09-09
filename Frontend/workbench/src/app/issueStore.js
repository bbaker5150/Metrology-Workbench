import axios from "axios";
import { API_BASE_URL } from "../shared/config";

const api = `${API_BASE_URL}/bug_reports/`;
const legacyApi = `${API_BASE_URL}/uncertainty/bug_reports/`;
const list = (data) => (Array.isArray(data) ? data : data?.results || []);
const metadata = (value) => {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
};
export const normalizeIssue = (report, source = "workbench") => {
  const context = metadata(report.system_info);
  return {
    ...report,
    source,
    key: `${source}:${report.id}`,
    module:
      source === "uncertainty" ? "Uncertalytics" : context.module || "AC Shunt",
    category: report.category || "UI/UX",
    severity:
      report.severity ||
      (report.priority === "Normal" ? "Medium" : report.priority) ||
      "Medium",
    status:
      report.status === "Complete"
        ? "Solved"
        : report.status === "Open"
          ? "Not Started"
          : report.status || "Not Started",
    created_at: report.created_at || report.timestamp || report.date,
    reporter: report.reporter || context.reporter || "",
    context,
  };
};
async function allWorkbenchReports() {
  const reports = [],
    seen = new Set();
  let url = `${api}?page=1`;
  while (url) {
    if (seen.has(url)) throw new Error("Repeated issue page");
    seen.add(url);
    const { data } = await axios.get(url);
    reports.push(...list(data));
    url = data?.next || null;
  }
  return { data: reports };
}
export async function loadIssues() {
  const results = await Promise.allSettled([
    allWorkbenchReports(),
    axios.get(legacyApi),
  ]);
  const issues = results.flatMap((result, index) =>
    result.status === "fulfilled"
      ? list(result.value.data).map((report) =>
          normalizeIssue(report, index ? "uncertainty" : "workbench"),
        )
      : [],
  );
  issues.sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || "")),
  );
  return {
    issues,
    errors: results.flatMap((r, i) =>
      r.status === "rejected"
        ? [i ? "Uncertalytics reports" : "Workbench reports"]
        : [],
    ),
  };
}
export async function saveIssue(issue, context) {
  if (issue.source === "uncertainty") {
    const payload = {
      ...issue,
      priority: issue.severity === "Medium" ? "Normal" : issue.severity,
      status:
        issue.status === "Solved"
          ? "Complete"
          : issue.status === "Not Started"
            ? "Open"
            : issue.status,
    };
    const { data } = await axios.post(legacyApi, payload);
    return normalizeIssue(data, "uncertainty");
  }
  const payload = {
    title: issue.title.trim(),
    description: issue.description.trim(),
    steps: issue.steps,
    severity: issue.severity,
    category: issue.category || "UI/UX",
    status: issue.status,
    system_info: JSON.stringify({
      ...issue.context,
      ...context,
      module: issue.module,
      reporter: issue.reporter,
    }),
  };
  const { data } = issue.id
    ? await axios.patch(`${api}${issue.id}/`, payload)
    : await axios.post(api, payload);
  return normalizeIssue(data);
}
export async function deleteIssue(issue) {
  await axios.delete(
    `${issue.source === "uncertainty" ? legacyApi : api}${issue.id}/`,
  );
}
