import React, { Suspense, lazy, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { FaBolt, FaCalculator, FaFileAlt, FaArrowRight } from "react-icons/fa";
import { MODULES } from "./moduleRegistry";
import "./HomeLauncher.css";

// The 3D medallion pulls in three.js, so load it lazily. A neutral animated
// loader avoids flashing a flat approximation that does not match the final
// rendered object.
const LauncherEmblem = lazy(() => import("./LauncherEmblem"));

// Icon per module id. Kept here (presentation concern) rather than in the
// registry so the registry stays a plain data manifest.
const MODULE_ICONS = {
  "ac-shunt": <FaBolt aria-hidden />,
  uncertainty: <FaCalculator aria-hidden />,
  reports: <FaFileAlt aria-hidden />,
};

export default function HomeLauncher() {
  const navigate = useNavigate();
  const [emblemReady, setEmblemReady] = useState(false);

  useEffect(() => {
    // The uncertainty workspace is the primary launcher destination. Warm its
    // route immediately after the home screen paints so a normal card click
    // mounts from cache instead of starting a multi-megabyte download.
    const uncertaintyModule = MODULES.find((module) => module.id === "uncertainty");
    const timer = window.setTimeout(() => {
      uncertaintyModule?.preload?.().catch(() => {
        // React.lazy will surface a real load failure when the user navigates.
        // A speculative warm-up failure should not disturb the launcher.
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const warmModule = (module) => {
    module.preload?.().catch(() => {});
  };

  return (
    <div className="workbench-home">
      <header className="workbench-home-header">
        <div className="workbench-home-emblem">
          <div
            className={`workbench-home-emblem-loader${emblemReady ? " is-ready" : ""}`}
            aria-hidden="true"
          >
            <span className="workbench-home-emblem-loader-core" />
          </div>
          <div
            className={`workbench-home-emblem-canvas${emblemReady ? " is-ready" : ""}`}
          >
            <Suspense fallback={null}>
              <LauncherEmblem onReady={() => setEmblemReady(true)} />
            </Suspense>
          </div>
        </div>
        <div className="workbench-home-heading">
          <span className="workbench-home-eyebrow">Navy Primary Standard Lab</span>
          <h1 className="workbench-home-title">Metrology Workbench</h1>
          <p className="workbench-home-subtitle">
            Choose a tool to get started
          </p>
        </div>
      </header>

      <div className="workbench-home-grid">
        {MODULES.map((m) => {
          const ready = m.status === "ready";
          return (
            <button
              key={m.id}
              type="button"
              className={`workbench-card${ready ? "" : " is-disabled"}`}
              onPointerEnter={() => ready && warmModule(m)}
              onPointerDown={() => ready && warmModule(m)}
              onFocus={() => ready && warmModule(m)}
              onClick={() => ready && navigate(m.path)}
              disabled={!ready}
              aria-label={
                ready ? `Open ${m.title}` : `${m.title} — coming soon`
              }
            >
              <span className="workbench-card-icon">{MODULE_ICONS[m.id]}</span>
              <span className="workbench-card-body">
                <span className="workbench-card-title">{m.title}</span>
                <span className="workbench-card-subtitle">{m.subtitle}</span>
              </span>
              <span className="workbench-card-action">
                {ready ? (
                  <FaArrowRight aria-hidden />
                ) : (
                  <span className="workbench-card-soon">Coming soon</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
