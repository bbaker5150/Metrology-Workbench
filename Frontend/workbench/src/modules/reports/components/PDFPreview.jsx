import { memo, useEffect, useRef, useState } from "react";
import { pdf } from "@react-pdf/renderer";
import { createROC, generateROC, updateROC } from "../api";
import CalibrationPDF from "../pdf/CalibrationPDF";
import { markPrintActualSize } from "../pdf/printReady";

/** Renders the ROC once per change into a print-ready (actual-size) PDF
 * blob URL, shared by the on-screen preview and the Download PDF button so
 * what is displayed is exactly the file that is downloaded and printed. */
function usePrintReadyPdf(enabled, data, sections) {
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const currentUrl = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const blob = await pdf(<CalibrationPDF data={data} sections={sections} />).toBlob();
        const bytes = await markPrintActualSize(await blob.arrayBuffer());
        if (cancelled) return;
        const next = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        // Keep the previous file on screen until its replacement is ready.
        if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
        currentUrl.current = next;
        setUrl(next);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, data, sections]);

  useEffect(() => () => {
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
  }, []);

  return { url: enabled ? url : null, busy, failed };
}

export default memo(function PDFPreview({ data, sections, onDataSaved, onRecordsChanged }) {
  const [ready, setReady] = useState(false);
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const [xlsxError, setXlsxError] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 100);
    return () => window.clearTimeout(timer);
  }, []);

  const visibleCount = sections.filter((section) => section.visible).length;
  const statementCount = (data.statements || []).length;
  const tableCount = (data.tables || []).length;
  const hasData = Boolean(data.nomenclature || data.roc_number || statementCount || tableCount);
  const rendered = usePrintReadyPdf(ready && hasData, data, sections);

  const downloadXlsx = async () => {
    setXlsxBusy(true);
    setXlsxError(false);
    try {
      await generateROC({
        ...data,
        tables: (data.tables || []).map((table, order) => ({ ...table, order })),
      });
    } catch {
      setXlsxError(true);
    } finally {
      setXlsxBusy(false);
    }
  };

  const persistencePayload = () => ({
    ...data,
    tables: (data.tables || []).map((table, order) => ({ ...table, order })),
  });

  const saveRecord = async () => {
    setSaveBusy(true);
    setSaveMessage("");
    setSaveError("");
    try {
      const saved = data.id
        ? await updateROC(data.id, persistencePayload())
        : await createROC(persistencePayload());
      onDataSaved(saved);
      onRecordsChanged();
      setSaveMessage(data.id ? "Saved changes" : "Saved to records");
    } catch (error) {
      const details = error?.response?.data;
      const first = details && typeof details === "object"
        ? Object.entries(details)[0]
        : null;
      setSaveError(first ? `${first[0]}: ${[].concat(first[1]).join(" ")}` : "Could not save record");
    } finally {
      setSaveBusy(false);
    }
  };

  return (
    <>
      <div className="roc-toolbar">
        <div>
          <p className="roc-title">ROC Preview</p>
        </div>
        <div className="roc-toolbar-meta">
          <span className="roc-toolbar-meta-item"><span className="roc-dot" />{visibleCount} section{visibleCount === 1 ? "" : "s"}</span>
          <span className="roc-toolbar-meta-item"><span className="roc-dot roc-dot-muted" />{statementCount} statement{statementCount === 1 ? "" : "s"} · {tableCount} table{tableCount === 1 ? "" : "s"}</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {saveMessage && <span className="roc-subtitle" style={{ margin: 0 }}>{saveMessage}</span>}
          {saveError && <span className="roc-subtitle" style={{ margin: 0, color: "var(--danger-color, #b42318)" }}>{saveError}</span>}
          {!hasData && <span className="roc-subtitle" style={{ margin: 0 }}>Load a ROC to enable preview.</span>}
          {hasData && <button className={`roc-btn${saveError ? " roc-btn-danger" : ""}`} onClick={saveRecord} disabled={saveBusy}>
            {saveBusy ? "Saving…" : data.id ? "Save Changes" : "Save to Records"}
          </button>}
          {hasData && <button className={`roc-btn${xlsxError ? " roc-btn-danger" : ""}`} onClick={downloadXlsx} disabled={xlsxBusy}>
            {xlsxBusy ? "Generating…" : xlsxError ? "Excel generation failed" : "Download Excel ROC"}
          </button>}
          {hasData && ready && (rendered.url && !rendered.busy ? (
            <a
              href={rendered.url}
              download={`ROC_${data.roc_number || "draft"}.pdf`}
              className="roc-btn roc-btn-primary"
            >
              Download PDF
            </a>
          ) : (
            <button className={`roc-btn roc-btn-primary${rendered.failed ? " roc-btn-danger" : ""}`} disabled>
              {rendered.failed ? "PDF generation failed" : "Generating PDF…"}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {!ready ? <div className="roc-loading">Initializing preview…</div> : !hasData ? (
          <div className="roc-empty" style={{ height: "100%" }}>
            <p className="roc-empty-title">No ROC loaded</p>
            <p className="roc-empty-text">Choose a saved ROC, upload an existing workbook, pull an AC-Shunt session, or start a manual report.</p>
          </div>
        ) : !rendered.url ? (
          <div className="roc-loading">{rendered.failed ? "Could not render the ROC PDF." : "Rendering preview…"}</div>
        ) : (
          <iframe title="ROC PDF preview" src={`${rendered.url}#toolbar=0`} width="100%" height="100%" style={{ border: "none" }} />
        )}
      </div>
    </>
  );
});
