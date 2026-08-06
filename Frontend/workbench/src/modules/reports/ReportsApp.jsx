// src/modules/reports/ReportsApp.jsx
//
// Module root for the Report of Calibration tool. This default export is the
// React.lazy() target wired up in app/moduleRegistry.jsx — it is the module's
// sole public surface. Everything else under modules/reports/ is private to
// this tree and is never imported by the shell or by other modules.
//
// Module-private providers wrap the tree here (not at the workbench root) so
// only this module pays for its own state. The router hands this module the
// wildcard path /reports/*, so internal navigation lives in the <Routes>
// below and the shell never knows about it.
import React from "react";
import { Routes, Route } from "react-router";
import { ReportsProvider } from "./contexts/ReportsContext";
import ReportsMain from "./components/ReportsMain";
import "./ReportsApp.css";

export default function ReportsApp() {
  return (
    <ReportsProvider>
      <Routes>
        <Route index element={<ReportsMain />} />
        {/* Future internal routes (e.g. :reportId) go here. Unknown sub-paths
            fall through to the index placeholder for now. */}
        <Route path="*" element={<ReportsMain />} />
      </Routes>
    </ReportsProvider>
  );
}
