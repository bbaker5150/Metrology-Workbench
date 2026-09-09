import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadIssues, saveIssue, deleteIssue } from "./issueStore";
import "./WorkbenchIssues.css";

const MODULES = ["Workbench", "Uncertalytics", "AC Shunt", "Reports"];
const blank = (module) => ({
  title: "",
  description: "",
  steps: "",
  severity: "Medium",
  category: "UI/UX",
  status: "Not Started",
  reporter: "",
  module,
});
const draftKey = "workbench.issue-draft.v1";
const readDraft = (module) => {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey));
    return saved && (saved.title || saved.description || saved.steps)
      ? saved
      : blank(module);
  } catch {
    return blank(module);
  }
};

export default function WorkbenchIssues({
  module = "Workbench",
  route,
  onClose,
}) {
  const dialog = useRef(null),
    submitting = useRef(false),
    alive = useRef(true),
    revision = useRef(0);
  const [tab, setTab] = useState("new");
  const [draft, setDraft] = useState(() => readDraft(module));
  const [issues, setIssues] = useState([]),
    [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [listError, setListError] = useState(""),
    [notice, setNotice] = useState("");
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("Active"),
    [area, setArea] = useState("All modules");
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    const previousFocus = document.activeElement;
    dialog.current?.showModal?.();
    return () => {
      alive.current = false;
      previousFocus?.focus?.();
    };
  }, []);
  useEffect(() => {
    if (!draft.id) {
      try {
        localStorage.setItem(draftKey, JSON.stringify(draft));
      } catch {
        /* In-memory draft still works. */
      }
    }
  }, [draft]);
  const refresh = useCallback(async () => {
    setLoading(true);
    const requestRevision = ++revision.current;
    const result = await loadIssues();
    if (!alive.current || requestRevision !== revision.current) return;
    setIssues(result.issues);
    setListError(
      result.errors.length
        ? `Could not load ${result.errors.join(" and ")}. Your reports have not been removed. Retry when connected.`
        : "",
    );
    setLoading(false);
  }, []);
  useEffect(() => {
    alive.current = true;
    refresh();
  }, [refresh]);
  const change = (key, value) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const edit = (issue) => {
    setDraft(issue);
    setError("");
    setNotice("");
    setConfirmDelete(false);
    setTab("new");
  };
  const newReport = () => {
    setDraft(readDraft(module));
    setError("");
    setConfirmDelete(false);
    setTab("new");
  };
  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current) return;
    if (!draft.title.trim() || !draft.description.trim()) {
      setError("Add a title and description before saving.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await saveIssue(
        draft,
        draft.id
          ? draft.context
          : {
              route,
              capturedAt: new Date().toISOString(),
              userAgent: navigator.userAgent,
            },
      );
      if (!alive.current) return;
      revision.current += 1;
      setLoading(false);
      setIssues((previous) => [
        saved,
        ...previous.filter((issue) => issue.key !== saved.key),
      ]);
      setNotice(draft.id ? "Issue updated." : "Issue submitted.");
      if (!draft.id) {
        try {
          localStorage.removeItem(draftKey);
        } catch {}
      }
      setDraft(blank(module));
      setTab("list");
      setStatus("All statuses");
      setQuery("");
      setArea("All modules");
    } catch {
      if (alive.current)
        setError(
          "Could not save this issue. Your text is still here; retry when connected.",
        );
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const remove = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await deleteIssue(draft);
      if (!alive.current) return;
      revision.current += 1;
      setLoading(false);
      setIssues((previous) =>
        previous.filter((issue) => issue.key !== draft.key),
      );
      setDraft(blank(module));
      setTab("list");
      setConfirmDelete(false);
      setNotice("Issue deleted.");
    } catch {
      if (alive.current) setError("Could not delete this issue. Please retry.");
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const visible = issues.filter(
    (issue) =>
      (status === "All statuses" ||
        (status === "Active"
          ? issue.status !== "Solved"
          : issue.status === status)) &&
      (area === "All modules" || issue.module === area) &&
      `${issue.title} ${issue.description} ${issue.reporter} ${issue.id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const select = (label, key, options) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={draft[key]}
        onChange={(e) => change(key, e.target.value)}
      >
        {options.map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
    </label>
  );
  return createPortal(
    <dialog
      ref={dialog}
      open={
        typeof HTMLDialogElement.prototype.showModal !== "function"
          ? true
          : undefined
      }
      className="wb-issues"
      aria-labelledby="wb-issues-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <div>
          <span className="wb-issues-eyebrow">METROLOGY WORKBENCH</span>
          <h2 id="wb-issues-title">Issues & feedback</h2>
          <p>Report a problem or follow its progress across the workbench.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Close issue tracker"
        >
          ×
        </button>
      </header>
      <nav aria-label="Issue tracker views">
        <button
          type="button"
          aria-pressed={tab === "new"}
          onClick={newReport}
          disabled={busy}
        >
          Report an issue
        </button>
        <button
          type="button"
          aria-pressed={tab === "list"}
          onClick={() => {
            setTab("list");
            setError("");
          }}
          disabled={busy}
        >
          Browse issues{" "}
          <span>
            {issues.filter((i) => i.status !== "Solved").length} active
          </span>
        </button>
      </nav>
      <div className="wb-issues-content">
        {notice && (
          <p className="wb-issues-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="wb-issues-error" role="alert">
            {error}
          </p>
        )}
        {tab === "new" ? (
          <form onSubmit={submit}>
            <h3>{draft.id ? `Edit issue #${draft.id}` : "What happened?"}</h3>
            <fieldset disabled={busy}>
              <label>
                Title{" "}
                <input
                  autoFocus
                  required
                  maxLength={255}
                  value={draft.title}
                  onChange={(e) => change("title", e.target.value)}
                  placeholder="Briefly describe the problem"
                />
              </label>
              <div className="wb-issues-fields">
                {draft.source === "uncertainty" ? (
                  <label>
                    Module
                    <input value="Uncertalytics" readOnly />
                  </label>
                ) : (
                  select("Module", "module", MODULES)
                )}
                {select("Priority", "severity", [
                  "Low",
                  "Medium",
                  "High",
                  "Critical",
                ])}
              </div>
              <div className="wb-issues-fields">
                {select("Category", "category", [
                  "UI/UX",
                  "Hardware Communication",
                  "Calculation Accuracy",
                  "Database/Sync",
                  "Other",
                ])}
                {select("Status", "status", [
                  "Not Started",
                  "In Work",
                  "Solved",
                ])}
              </div>
              <label>
                Description{" "}
                <textarea
                  required
                  rows={4}
                  value={draft.description}
                  onChange={(e) => change("description", e.target.value)}
                  placeholder="What did you expect, and what happened instead?"
                />
              </label>
              <label>
                Steps to reproduce{" "}
                <span className="wb-issues-muted">Optional</span>
                <textarea
                  rows={3}
                  value={draft.steps || ""}
                  onChange={(e) => change("steps", e.target.value)}
                  placeholder="1. Open…  2. Select…  3. Observe…"
                />
              </label>
              <label>
                Your name <span className="wb-issues-muted">Optional</span>
                <input
                  value={draft.reporter}
                  onChange={(e) => change("reporter", e.target.value)}
                />
              </label>
              <p className="wb-issues-muted">
                The current module, page, and browser information are included
                to help reproduce the issue. Unsubmitted reports are saved as
                drafts on this device.
              </p>
              {draft.id && (
                <details>
                  <summary>Report context</summary>
                  <pre>{JSON.stringify(draft.context || {}, null, 2)}</pre>
                </details>
              )}
            </fieldset>
            <footer>
              <div>
                {draft.id &&
                  (confirmDelete ? (
                    <span>
                      Delete this issue permanently?{" "}
                      <button type="button" onClick={remove} disabled={busy}>
                        Delete issue
                      </button>{" "}
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        disabled={busy}
                      >
                        Keep issue
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="wb-issues-danger"
                      onClick={() => setConfirmDelete(true)}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  ))}
              </div>
              <button
                className="wb-issues-primary"
                type="submit"
                disabled={busy}
              >
                {busy ? "Saving…" : draft.id ? "Save changes" : "Submit issue"}
              </button>
            </footer>
          </form>
        ) : (
          <>
            <div className="wb-issues-filters">
              <label className="wb-issues-search">
                Search
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Title, description, reporter, or ID"
                />
              </label>
              <label>
                Status
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {[
                    "Active",
                    "All statuses",
                    "Not Started",
                    "In Work",
                    "Solved",
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Module
                <select value={area} onChange={(e) => setArea(e.target.value)}>
                  {["All modules", ...MODULES].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={refresh} disabled={loading}>
                Refresh
              </button>
            </div>
            {listError && (
              <p className="wb-issues-error" role="alert">
                {listError}{" "}
                <button type="button" onClick={refresh}>
                  Retry
                </button>
              </p>
            )}
            {loading ? (
              <p role="status">Loading issues…</p>
            ) : visible.length ? (
              <ul className="wb-issues-list">
                {visible.map((issue) => (
                  <li key={issue.key}>
                    <button type="button" onClick={() => edit(issue)}>
                      <div>
                        <span className="wb-issues-muted">
                          {issue.module} · #{issue.id}
                        </span>
                        <strong>{issue.title}</strong>
                        <p>{issue.description}</p>
                        <small>
                          {issue.reporter ? `${issue.reporter} · ` : ""}
                          {issue.created_at
                            ? new Date(issue.created_at).toLocaleDateString()
                            : ""}
                        </small>
                      </div>
                      <aside>
                        <span
                          className={`wb-issues-priority ${issue.severity.toLowerCase()}`}
                        >
                          {issue.severity}
                        </span>
                        <span>{issue.status}</span>
                      </aside>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="wb-issues-empty">
                <h3>
                  {issues.length
                    ? "No matching issues"
                    : "No issues reported yet"}
                </h3>
                <p>
                  {issues.length
                    ? "Try another search or filter."
                    : "Found something unexpected? Start a report and describe what happened."}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
