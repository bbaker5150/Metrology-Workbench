import React, { Suspense, lazy, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { FaBolt, FaCalculator, FaFileAlt, FaArrowRight } from "react-icons/fa";
import { MODULES } from "./moduleRegistry";
import "./HomeLauncher.css";
import EMBLEM_PREVIEW from "../assets/emblem-preview.webp";

// Show an exact render of the medallion immediately, then crossfade to the
// animated model after its first frame. The rest of the launcher stays usable.
const LauncherEmblem = lazy(() => import("./LauncherEmblem"));

class EmblemBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

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
    // Give the emblem's first frame priority over speculative module work.
    // Hover/focus still warms a destination immediately when the user needs it.
    const uncertaintyModule = MODULES.find((module) => module.id === "uncertainty");
    const timer = window.setTimeout(() => {
      uncertaintyModule?.preload?.().catch(() => {
        // React.lazy will surface a real load failure when the user navigates.
        // A speculative warm-up failure should not disturb the launcher.
      });
    }, emblemReady ? 0 : 2500);
    return () => window.clearTimeout(timer);
  }, [emblemReady]);

  const warmModule = (module) => {
    module.preload?.().catch(() => {});
  };

  return (
    <div className="workbench-home">
      <header className="workbench-home-header">
        <div className="workbench-home-emblem">
          <img src={EMBLEM_PREVIEW} width="480" height="480" alt="" aria-hidden="true"
            className={`workbench-home-emblem-preview${emblemReady ? " is-ready" : ""}`} />
          <div
            className={`workbench-home-emblem-canvas${emblemReady ? " is-ready" : ""}`}
          >
            <EmblemBoundary><Suspense fallback={null}>
              <LauncherEmblem onReady={() => setEmblemReady(true)} />
            </Suspense></EmblemBoundary>
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
