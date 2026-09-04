// src/modules/uncertainty/UncertaintyApp.jsx
//
// Module root for the Uncertainty Budget tool. This default export is the
// React.lazy() target wired up in app/moduleRegistry.jsx — it is the module's
// sole public surface. Everything else under modules/uncertainty/ is private
// to this tree and is never imported by the shell or by other modules.
//
// Module-private providers wrap the tree here (not at the workbench root) so
// only this module pays for its own state. The router hands this module the
// wildcard path /uncertainty/*, so internal navigation lives in the <Routes>
// below and the shell never knows about it.
import React, { useEffect } from "react";
import { Routes, Route } from "react-router";
import { UncertaintyProvider } from "./contexts/UncertaintyContext";
import UncertalyticsApp from "./App";
import "./UncertaintyApp.css";

// The ported Uncertalytics app (./App.jsx) is the module's content. It owns its
// own session state (useSessionManager -> /api/uncertainty) and renders the
// ac-shunt-style .app-chrome header. Theme + toast come from the workbench
// shell providers above this tree; the module-private UncertaintyProvider
// remains for any future cross-component module state.
export default function UncertaintyApp() {
  // Flag <body> while this module is mounted so the module's design tokens
  // reach modals/dropdowns that React-portal to document.body (outside the
  // .uncertainty-module subtree). Removed on unmount so it never leaks into
  // other modules.
  useEffect(() => {
    document.body.classList.add("uncertainty-active");
    return () => document.body.classList.remove("uncertainty-active");
  }, []);

  return (
    <UncertaintyProvider>
      <Routes>
        <Route index element={<UncertalyticsApp />} />
        {/* All internal sub-paths render the same app; navigation within the
            tool is state-driven (sidebar tree + analysis views). */}
        <Route path="*" element={<UncertalyticsApp />} />
      </Routes>
    </UncertaintyProvider>
  );
}
