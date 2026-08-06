import React, { Suspense } from "react";
import { createHashRouter, Navigate } from "react-router";
import WorkbenchShell from "./WorkbenchShell";
import HomeLauncher from "./HomeLauncher";
import { MODULES } from "./moduleRegistry";

// HashRouter (not Browser) is deliberate: Electron loads the built SPA via
// file://index.html and the dev server via http://localhost:3000. Hash
// routing keeps all navigation client-side after the '#', so the exact same
// build works in the browser, `serve -s build`, and Electron with zero
// server-side rewrite rules.

const moduleFallback = (
  <div className="workbench-module-loading" role="status" aria-live="polite">
    Loading module…
  </div>
);

const moduleRoutes = MODULES.filter((m) => m.Component).map((m) => {
  const Component = m.Component;
  return {
    // Trailing /* lets each module own its internal sub-routes.
    path: `${m.route}/*`,
    element: <Suspense fallback={moduleFallback}>{<Component />}</Suspense>,
  };
});

export const router = createHashRouter([
  {
    path: "/",
    element: <WorkbenchShell />,
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      { path: "home", element: <HomeLauncher /> },
      ...moduleRoutes,
      { path: "uncertainty/*", element: <Navigate to="/uncertalytics" replace /> },
      { path: "reports/*", element: <Navigate to="/report-of-calibration" replace /> },
      // Unknown paths bounce back to the launcher.
      { path: "*", element: <Navigate to="/home" replace /> },
    ],
  },
]);
