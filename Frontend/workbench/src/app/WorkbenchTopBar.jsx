import React from "react";
import { useLocation, useNavigate } from "react-router";
import { FaChevronLeft, FaThLarge, FaSun, FaMoon } from "react-icons/fa";
import { useTheme } from "../shared/ThemeContext";
import CaptionControls from "../shared/CaptionControls";

// ---------------------------------------------------------------------
// WorkbenchTopBar — the thin, always-present global chrome.
// ---------------------------------------------------------------------
// Present on every route so the frameless Electron window is draggable and
// has window controls everywhere (the launcher had none before). The bar
// itself is the drag region (-webkit-app-region: drag in workbench.css);
// its interactive children opt out.
//
//   left:  launcher -> app title; module route -> "back to Workbench"
//   right: theme toggle + window caption controls (Electron only)
// ---------------------------------------------------------------------
export default function WorkbenchTopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const atHome =
    location.pathname === "/" ||
    location.pathname === "" ||
    location.pathname === "/home";

  return (
    <header className="workbench-topbar">
      <div className="workbench-topbar-left">
        {atHome ? (
          <span className="workbench-topbar-title">Metrology Workbench</span>
        ) : (
          <button
            type="button"
            className="workbench-topbar-home"
            onClick={() => navigate("/home")}
            title="Return to the Workbench launcher"
            aria-label="Return to the Workbench launcher"
          >
            <FaChevronLeft className="workbench-topbar-home-chevron" aria-hidden />
            <FaThLarge aria-hidden />
            <span>Workbench</span>
          </button>
        )}
      </div>

      <div className="workbench-topbar-right">
        <button
          type="button"
          className="workbench-topbar-icon-btn"
          onClick={(e) => toggleTheme(e)}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <FaSun aria-hidden /> : <FaMoon aria-hidden />}
        </button>
        <CaptionControls />
      </div>
    </header>
  );
}
