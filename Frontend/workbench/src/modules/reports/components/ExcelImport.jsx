import { useEffect, useRef, useState } from "react";
import { downloadTemplate, fetchAreas, parseROCFile } from "../api";
import { normalizeROC } from "./SavedRecords";

export default function ExcelImport({ onDataLoaded }) {
  const [status, setStatus] = useState(null);
  const [preview, setPreview] = useState(null);
  const [areas, setAreas] = useState([]);
  const [areaCode, setAreaCode] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    fetchAreas()
      .then((items) => {
        setAreas(items);
        setAreaCode(items[0]?.code || "");
      })
      .catch(() => {});
  }, []);

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setStatus(null);
    setPreview(null);
    try {
      const parsed = normalizeROC(await parseROCFile(file, areaCode));
      setPreview(parsed);
      setStatus({
        type: "ok",
        msg: `Parsed ROC ${parsed.roc_number || "(no number)"}: ${parsed.statements.length} statement${parsed.statements.length === 1 ? "" : "s"} and ${parsed.tables.length} data table${parsed.tables.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      const reason = error?.response?.data?.error || error.message;
      setStatus({ type: "error", msg: `Failed to parse file: ${reason}` });
    } finally {
      setBusy(false);
    }
  };

  const handleTemplate = async () => {
    if (!areaCode) return;
    setBusy(true);
    setStatus(null);
    try {
      await downloadTemplate(areaCode);
      setStatus({
        type: "ok",
        msg: "Downloaded the ROC template. Enter values in its yellow Data Entry cells, then upload the workbook here to load it into the report.",
      });
    } catch {
      setStatus({ type: "error", msg: "Template download failed. Is the reports backend running?" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="roc-section-body">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <p className="roc-title">Import ROC Workbook</p>
          <p className="roc-subtitle">.xlsx, .xlsm, or .xls — generated templates and lab originals</p>
        </div>
        {/* flexShrink: 0 + a min-width keeps the select from being squeezed
            down by the title text next to it — it was shrinking enough to
            clip the area name. Wraps to its own line below the title on
            narrow widths instead. */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <select className="roc-select" style={{ minWidth: 150 }} value={areaCode} onChange={(event) => setAreaCode(event.target.value)}>
            {areas.map((area) => <option key={area.code} value={area.code}>{area.name}</option>)}
          </select>
          <button className="roc-btn" disabled={busy || !areaCode} onClick={handleTemplate}>
            ROC Template
          </button>
        </div>
      </div>

      <div
        className="roc-dropzone"
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); handleFile(event.dataTransfer.files[0]); }}
      >
        <div className="roc-empty-icon">⇧</div>
        <p style={{ margin: "8px 0 4px", fontSize: "0.8125rem", fontWeight: 600 }}>Drop a ROC workbook here</p>
        <p className="roc-subtitle" style={{ margin: 0 }}>{busy ? "Working…" : "or click to browse"}</p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm,.xls"
          style={{ display: "none" }}
          onChange={(event) => handleFile(event.target.files?.[0])}
        />
      </div>

      {status && <div className={`roc-banner ${status.type === "ok" ? "roc-banner-muted" : "roc-banner-danger"}`}>{status.msg}</div>}

      {preview && (
        <>
          <div className="roc-section">
            <div className="roc-section-head"><p className="roc-eyebrow" style={{ margin: 0 }}>Parsed ROC</p></div>
            <div className="roc-section-body">
              <div className="roc-kv-grid">
                <div className="roc-kv-item"><span className="roc-kv-label">RoC #</span><span className="roc-kv-value">{preview.roc_number || "—"}</span></div>
                <div className="roc-kv-item"><span className="roc-kv-label">Instrument</span><span className="roc-kv-value">{preview.nomenclature || "—"}</span></div>
                <div className="roc-kv-item is-wide"><span className="roc-kv-label">Tables</span><span className="roc-kv-value">{preview.tables.length} measurement table{preview.tables.length === 1 ? "" : "s"}</span></div>
              </div>
            </div>
          </div>
          <button onClick={() => onDataLoaded({ ...preview, area_code: areaCode })} className="roc-btn roc-btn-primary roc-btn-block">Load into Report</button>
        </>
      )}
    </div>
  );
}
