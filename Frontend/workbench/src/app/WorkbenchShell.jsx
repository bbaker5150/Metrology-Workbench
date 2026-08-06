import React from "react";
import { Outlet } from "react-router";
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
  return (
    <>
      <WorkbenchTopBar />
      <Outlet />
    </>
  );
}
