// src/modules/reports/components/ReportsMain.jsx
//
// Report of Calibration module body — ported from the standalone ROC Gen
// app. The global WorkbenchTopBar (window chrome, return-to-launcher, and
// the shared light/dark toggle) already renders above this subtree, so this
// component owns only its own two-pane content — no page header and no
// private theme state. Styling comes from the same --background-color /
// --text-color / --border-color / etc. tokens every other module uses
// (see ReportsApp.css), so this module tracks body.light-mode /
// body.dark-mode automatically like the rest of the workbench.
import { useEffect, useRef, useState } from "react";
import { useReports } from "../contexts/ReportsContext";
import DataSourcePanel from "./DataSourcePanel";
import ReportBuilder from "./ReportBuilder";
import PDFPreview from "./PDFPreview";

export default function ReportsMain() {
  const { data, sections, setSections, activeTab, setActiveTab, handleDataLoaded, recordsRevision, refreshRecords } = useReports();

  const shellRef = useRef(null);
  const dragRef = useRef(null);
  const [maxWidth, setMaxWidth] = useState(800);
  const [sideWidth, setSideWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("roc-sidebar-width"));
      return Number.isFinite(saved) && saved >= 280 ? Math.min(800, saved) : 420;
    } catch { return 420; }
  });
  const width = Math.max(280, Math.min(sideWidth, maxWidth));
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setMaxWidth(Math.max(280, Math.min(800, entry.contentRect.width - 288)));
    });
    observer.observe(shellRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try { localStorage.setItem("roc-sidebar-width", String(sideWidth)); } catch { /* Storage is optional. */ }
  }, [sideWidth]);
  const resize = value => setSideWidth(Math.max(280, Math.min(maxWidth, value)));

  return (
    <div className="reports-module">
      <div className="roc-shell" ref={shellRef}>
        <div className="roc-side" id="roc-sidebar" style={{ width }}>
          <div className="roc-tabrow">
            {[
              { id: "source", label: "Data Source" },
              { id: "sections", label: "Report Sections" },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`roc-tab${activeTab === tab.id ? " is-active" : ""}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="roc-side-body">
            {activeTab === "source" ? (
              <DataSourcePanel onDataLoaded={handleDataLoaded} currentData={data} recordsRevision={recordsRevision} />
            ) : (
              <ReportBuilder sections={sections} onChange={setSections} />
            )}
          </div>
        </div>

        <div className="roc-resizer" role="separator" tabIndex={0}
          aria-label="Resize report sidebar" aria-orientation="vertical" aria-controls="roc-sidebar"
          aria-valuemin={280} aria-valuemax={maxWidth} aria-valuenow={width}
          title="Drag to resize; use arrow keys; double-click to reset"
          onPointerDown={event => {
            if (event.button !== 0) return;
            dragRef.current = { x: event.clientX, width };
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={event => {
            if (dragRef.current) resize(dragRef.current.width + event.clientX - dragRef.current.x);
          }}
          onPointerUp={event => {
            dragRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { dragRef.current = null; }}
          onLostPointerCapture={() => { dragRef.current = null; }}
          onDoubleClick={() => resize(420)}
          onKeyDown={event => {
            const values = { ArrowLeft: width - 20, ArrowRight: width + 20, Home: 280, End: maxWidth };
            if (values[event.key] !== undefined) { event.preventDefault(); resize(values[event.key]); }
          }}
        />
        <div className="roc-main">
          <PDFPreview data={data} sections={sections} onDataSaved={handleDataLoaded} onRecordsChanged={refreshRecords} />
        </div>
      </div>
    </div>
  );
}
