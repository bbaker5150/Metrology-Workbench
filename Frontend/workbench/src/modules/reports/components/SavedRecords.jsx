import { useEffect, useState } from "react";
import { deleteROC, downloadRecordROC, fetchROC, fetchROCs } from "../api";

export function normalizeROC(record) {
  return {
    ...record,
    calibration_date: record.calibration_date || "",
    due_date: record.due_date || "",
    issue_date: record.issue_date || "",
    statements: record.statements || [],
    inline_results: record.inline_results || [],
    tables: (record.tables || []).map((table, order) => ({
      order,
      title: table.title || "",
      intro_text: table.intro_text || "",
      columns: table.columns || [],
      rows: (table.rows || []).map((row) =>
        row.map((cell) => (cell === null || cell === undefined ? "" : cell)),
      ),
    })),
  };
}

export default function SavedRecords({ onDataLoaded, recordsRevision = 0 }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState(null);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchROCs()
      .then(setRecords)
      .catch(() => setError("Cannot reach the reports backend. Make sure the Workbench server is running."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [recordsRevision]);

  const select = async (id) => {
    setLoadingId(id);
    try {
      const record = await fetchROC(id);
      setSelectedId(id);
      onDataLoaded(normalizeROC(record));
    } catch {
      setError("Failed to load the ROC record.");
    } finally {
      setLoadingId(null);
    }
  };

  const download = async (event, record) => {
    event.stopPropagation();
    setLoadingId(record.id);
    try {
      await downloadRecordROC(record.id, record.roc_number);
    } catch {
      setError("Failed to generate the workbook.");
    } finally {
      setLoadingId(null);
    }
  };

  const remove = async (event, record) => {
    event.stopPropagation();
    if (!window.confirm(`Delete saved ROC ${record.roc_number}?`)) return;
    setLoadingId(record.id);
    setError(null);
    try {
      await deleteROC(record.id);
      if (selectedId === record.id) setSelectedId(null);
      load();
    } catch {
      setError("Failed to delete the ROC record.");
      setLoadingId(null);
    }
  };

  return (
    <div className="roc-section-body">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p className="roc-title">ROC Records</p>
          <p className="roc-subtitle">{records.length} record{records.length === 1 ? "" : "s"} in the database</p>
        </div>
        <button onClick={load} className="roc-btn" disabled={loading}>
          Refresh
        </button>
      </div>

      {error && <div className="roc-banner roc-banner-danger">{error}</div>}

      {loading && <div className="roc-loading">Loading ROC records…</div>}

      {!loading && records.length === 0 && !error && (
        <div className="roc-empty">
          <p className="roc-empty-title">No ROC records found</p>
          <p className="roc-empty-text">
            Run <code>python manage.py seed_rocs</code> from the backend to load the sample ROCs.
          </p>
        </div>
      )}

      <div className="roc-list">
        {records.map((record) => (
          <div
            key={record.id}
            role="button"
            tabIndex={0}
            onClick={() => select(record.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") select(record.id);
            }}
            className={`roc-list-item${selectedId === record.id ? " is-selected" : ""}`}
            aria-disabled={loadingId === record.id}
          >
            <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 8 }}>
              <div>
                <p style={{ margin: 0, fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-color-strong, var(--text-color))" }}>
                  {record.nomenclature || "Untitled ROC"}
                </p>
                <p className="roc-subtitle" style={{ margin: "2px 0 0" }}>
                  {record.manufacturer} {record.model_number} · SN {record.serial_number}
                </p>
              </div>
              <span className="roc-badge roc-badge-neutral">{record.area_name || record.area_code}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
              <span className="roc-eyebrow" style={{ margin: 0 }}>{record.roc_number}</span>
              <span className="roc-subtitle" style={{ margin: 0 }}>{record.calibration_date}</span>
            </div>
            <button
              type="button"
              onClick={(event) => download(event, record)}
              className="roc-btn-link"
              style={{ marginTop: 8 }}
            >
              {loadingId === record.id ? "Generating…" : "Download Excel ROC"}
            </button>
            <button
              type="button"
              onClick={(event) => remove(event, record)}
              className="roc-btn-link"
              style={{ marginTop: 8, marginLeft: 12 }}
              disabled={loadingId === record.id}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
