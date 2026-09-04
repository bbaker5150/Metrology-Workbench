import { useEffect, useState } from "react";
import { fetchAcShuntSessions, pullAcShuntSession } from "../api";

export default function AcShuntImport({ onDataLoaded }) {
  const [available, setAvailable] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(null);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchAcShuntSessions()
      .then((result) => {
        setAvailable(result.available);
        setSessions(result.sessions || []);
      })
      .catch(() => setError("Cannot reach the reports backend."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

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
        <button onClick={load} className="roc-btn" disabled={loading}>Refresh</button>
      </div>
      {error && <div className="roc-banner roc-banner-danger">{error}</div>}
      {!available && !error && <div className="roc-banner roc-banner-muted">The AC-Shunt database is currently unavailable. You can still create a ROC manually or from a workbook.</div>}
      {loading && <div className="roc-loading">Loading sessions…</div>}
      {!loading && available && sessions.length === 0 && !error && (
        <div className="roc-empty"><p className="roc-empty-title">No calibration sessions found</p><p className="roc-empty-text">Complete a calibration in the AC-Shunt module first.</p></div>
      )}
      <div className="roc-list">
        {sessions.map((session) => (
          <button key={session.id} onClick={() => pull(session)} disabled={pulling === session.id} className="roc-list-item">
            <p style={{ margin: 0, fontSize: "0.8125rem", fontWeight: 600 }}>{session.session_name}</p>
            <p className="roc-subtitle" style={{ margin: "3px 0 0" }}>UUT: {session.test_instrument_model || "—"} · {session.test_instrument_serial || "—"}</p>
            <p className="roc-subtitle" style={{ margin: 0 }}>Standard: {session.standard_instrument_model || "—"} · {session.standard_instrument_serial || "—"}</p>
            {pulling === session.id && <p className="roc-subtitle" style={{ color: "var(--primary-color)" }}>Pulling data…</p>}
          </button>
        ))}
      </div>
    </div>
  );
}
