import React, {
  lazy,
  Suspense,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { WorkbenchIssuesContext } from "../shared/WorkbenchIssuesContext";
const WorkbenchIssues = lazy(() => import("./WorkbenchIssues"));
import { Outlet, useLocation } from "react-router";
import WorkbenchTopBar from "./WorkbenchTopBar";
import "./workbench.css";

// ---------------------------------------------------------------------
// WorkbenchShell — the global layout host.
// ---------------------------------------------------------------------
// Renders the thin global top bar (window controls, theme toggle, return-
// to-launcher) above the active route. The bar is sticky, so each module
// keeps its own normal document-flow scrolling underneath.
// ---------------------------------------------------------------------
export default function WorkbenchShell() {
  const [issuesOpen, setIssuesOpen] = useState(false);
  const location = useLocation();
  useLayoutEffect(() => {
    // Register before module effects: their window-level shortcuts must not
    // delete instruments or paste into a session while the tracker has focus.
    // Native text editing, tab navigation, form submission and dialog Escape
    // still use the browser's default behavior (no preventDefault).
    const isolateDialogKeys = (event) => {
      if (event.target?.closest?.(".wb-issues"))
        event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", isolateDialogKeys, true);
    return () => window.removeEventListener("keydown", isolateDialogKeys, true);
  }, []);
  const issues = useMemo(() => ({ open: () => setIssuesOpen(true) }), []);
  const module = location.pathname.includes("uncertalytics")
    ? "Uncertalytics"
    : location.pathname.includes("ac-shunt")
      ? "AC Shunt"
      : location.pathname.includes("report-of-calibration")
        ? "Reports"
        : "Workbench";
  return (
    <WorkbenchIssuesContext.Provider value={issues}>
      <WorkbenchTopBar />
      <Outlet />
      {issuesOpen && (
        <Suspense fallback={null}>
          <WorkbenchIssues
            module={module}
            route={location.pathname}
            onClose={() => setIssuesOpen(false)}
          />
        </Suspense>
      )}
    </WorkbenchIssuesContext.Provider>
  );
}
