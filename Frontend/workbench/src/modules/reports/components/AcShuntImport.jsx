import { useEffect, useState } from "react";
import { fetchAcShuntSessions, pullAcShuntSession } from "../api";

export default function AcShuntImport({ onDataLoaded }) {
  const [available, setAvailable] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(null);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);

  const [query, setQuery] = useState("");
  const [model, setModel] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [resultInfo, setResultInfo] = useState({ total: 0, page: 1, pages: 1, models: [] });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      fetchAcShuntSessions({ q: query, model, sort, page, page_size: 20 })
        .then((result) => {
          if (cancelled) return;
          setAvailable(result.available);
          setSessions(result.sessions || []);
          setResultInfo({ total: result.total || 0, page: result.page || 1,
            pages: result.pages || 1, models: result.models || [] });
        })
        .catch(() => { if (!cancelled) setError("Cannot reach the reports backend."); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, model, sort, page, revision]);

  const pull = async (session) => {
    setPulling(session.id);
    setError(null);
    try {
      setPreview(await pullAcShuntSession(session.id));
    } catch (requestError) {
      setError(requestError?.response?.data?.error || "Failed to pull this calibration session.");
    } finally {
      setPulling(null);
    }
  };

  if (preview) {
    return (
      <div className="roc-section-body">
        <button onClick={() => setPreview(null)} className="roc-btn-link">← Back to sessions</button>
        <div className="roc-section">
          <div className="roc-section-head"><p className="roc-eyebrow" style={{ margin: 0 }}>Pulled AC-Shunt ROC</p></div>
          <div className="roc-section-body">
            <div className="roc-kv-grid">
              <div className="roc-kv-item"><span className="roc-kv-label">Instrument</span><span className="roc-kv-value">{preview.nomenclature || "Current Shunt"}</span></div>
              <div className="roc-kv-item"><span className="roc-kv-label">Model / Serial</span><span className="roc-kv-value">{preview.model_number || "—"} / {preview.serial_number || "—"}</span></div>
              <div className="roc-kv-item"><span className="roc-kv-label">Calibration Date</span><span className="roc-kv-value">{preview.calibration_date || "—"}</span></div>
              <div className="roc-kv-item"><span className="roc-kv-label">Tables</span><span className="roc-kv-value">{preview.tables?.length || 0}</span></div>
            </div>
          </div>
        </div>
        <div className="roc-banner roc-banner-muted">
          AC-Shunt results are mapped into an editable NPSL ROC measurement table. Complete customer, procedure, due-date, and personnel data in Manual Input before generating the final workbook.
        </div>
        <button onClick={() => onDataLoaded(preview)} className="roc-btn roc-btn-primary roc-btn-block">Load into Report</button>
      </div>
    );
  }

  return (
    <div className="roc-section-body">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p className="roc-title">AC-Shunt Sessions</p>
          <p className="roc-subtitle">Pull a completed AC-Shunt calibration into an editable ROC.</p>
        </div>
        <button onClick={() => setRevision(value => value + 1)} className="roc-btn" disabled={loading || pulling !== null}>Refresh</button>
      </div>
      <div className="roc-session-filters">
        <label className="roc-field">
          <span className="roc-label">Search sessions</span>
          <input className="roc-input" type="search" value={query}
            placeholder="Session name, model, or serial number"
            onChange={event => { setQuery(event.target.value); setPage(1); }} />
        </label>
        <div className="roc-grid-2">
          <label className="roc-field">
            <span className="roc-label">UUT model</span>
            <select className="roc-select" value={model} onChange={event => { setModel(event.target.value); setPage(1); }}>
              <option value="">All models</option>
              {resultInfo.models.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="roc-field">
            <span className="roc-label">Sort sessions</span>
            <select className="roc-select" value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="name">Session name A–Z</option>
            </select>
          </label>
        </div>
        {(query || model) && <button className="roc-btn-link" onClick={() => { setQuery(""); setModel(""); setPage(1); }}>Clear filters</button>}
      </div>
      {error && <div className="roc-banner roc-banner-danger">{error}</div>}
      {!available && !error && <div className="roc-banner roc-banner-muted">The AC-Shunt database is currently unavailable. You can still create a ROC manually or from a workbook.</div>}
      {loading && <div className="roc-loading">Loading sessions…</div>}
      {!loading && available && sessions.length === 0 && !error && (
        <div className="roc-empty"><p className="roc-empty-title">{query || model ? "No matching sessions" : "No calibration sessions found"}</p><p className="roc-empty-text">{query || model ? "Try another name, model, or serial number, or clear your filters." : "Complete a calibration in the AC-Shunt module first."}</p></div>
      )}
      <div className="roc-list" aria-busy={loading}>
        {!loading && !error && available && sessions.map((session) => (
          <button key={session.id} onClick={() => pull(session)} disabled={pulling !== null} className="roc-list-item">
            <p style={{ margin: 0, fontSize: "0.8125rem", fontWeight: 600 }}>{session.session_name || `Session ${session.id}`}</p>
            <p className="roc-subtitle">Created: {session.created_at ? new Date(session.created_at).toLocaleDateString() : "—"} · ID {session.id}</p>
            <p className="roc-subtitle" style={{ margin: "3px 0 0" }}>UUT: {session.test_instrument_model || "—"} · {session.test_instrument_serial || "—"}</p>
            <p className="roc-subtitle" style={{ margin: 0 }}>Standard: {session.standard_instrument_model || "—"} · {session.standard_instrument_serial || "—"}</p>
            {pulling === session.id && <p className="roc-subtitle" style={{ color: "var(--primary-color)" }}>Pulling data…</p>}
          </button>
        ))}
      </div>
      {!loading && !error && available && resultInfo.total > 0 && (
        <nav className="roc-session-pagination" aria-label="Session pages">
          <p className="roc-subtitle" role="status">{resultInfo.total} sessions · Page {resultInfo.page} of {resultInfo.pages}</p>
          <div className="roc-session-page-buttons">
            <button className="roc-btn" disabled={resultInfo.page <= 1 || pulling !== null} onClick={() => setPage(resultInfo.page - 1)}>Previous</button>
            <button className="roc-btn" disabled={resultInfo.page >= resultInfo.pages || pulling !== null} onClick={() => setPage(resultInfo.page + 1)}>Next</button>
          </div>
        </nav>
      )}
    </div>
  );
}
