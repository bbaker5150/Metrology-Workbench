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
import { useReports } from "../contexts/ReportsContext";
import DataSourcePanel from "./DataSourcePanel";
import ReportBuilder from "./ReportBuilder";
import PDFPreview from "./PDFPreview";

export default function ReportsMain() {
  const { data, sections, setSections, activeTab, setActiveTab, handleDataLoaded, recordsRevision, refreshRecords } = useReports();

  return (
    <div className="reports-module">
      <div className="roc-shell">
        <div className="roc-side">
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

        <div className="roc-main">
          <PDFPreview data={data} sections={sections} onDataSaved={handleDataLoaded} onRecordsChanged={refreshRecords} />
        </div>
      </div>
    </div>
  );
}
