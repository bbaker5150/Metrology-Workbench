import React, { useEffect, useRef, useState } from "react";

// Custom event other components dispatch to surface a scoped (per-panel) zoom
// level in the shared toast, e.g. window.dispatchEvent(new CustomEvent(
//   ZOOM_TOAST_EVENT, { detail: { label: "Point list", percent: 110 } })).
export const ZOOM_TOAST_EVENT = "zoomtoast:show";

// Reads Electron's renderer zoom factor. nodeIntegration is enabled in this
// app, so `electron` is reachable directly from the renderer. Returns null in
// the browser build (no Electron), where webFrame zoom simply isn't tracked.
const getWebFrame = () => {
  try {
    return typeof window !== "undefined" && window.require
      ? window.require("electron").webFrame
      : null;
  } catch (_) {
    return null;
  }
};

// Bottom-right toast that surfaces the current zoom level whenever it changes.
// It reports BOTH the global Electron zoom (Ctrl+scroll over the page, the app
// menu) and per-panel scoped zoom (e.g. the measurement-point sidebar), since
// those are independent and otherwise have no visible readout.
export default function ZoomToast() {
  const [message, setMessage] = useState(null);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef(null);

  // Reveal a message and (re)start the auto-hide timer.
  const showRef = useRef(null);
  showRef.current = (text) => {
    setMessage(text);
    setVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 1600);
  };

  // Global zoom readout.
  useEffect(() => {
    const webFrame = getWebFrame();

    // --- Electron: poll the renderer zoom factor (no renderer-side event). ---
    if (webFrame) {
      let lastPct = null;
      const poll = () => {
        const pct = Math.round(webFrame.getZoomFactor() * 100);
        if (pct === lastPct) return;
        lastPct = pct;
        showRef.current(`Zoom ${pct}%`);
      };
      poll(); // Show the current level once on mount.
      const id = setInterval(poll, 150);
      return () => clearInterval(id);
    }

    // --- Browser: track native zoom via devicePixelRatio. The browser exposes
    // no absolute zoom %, and devicePixelRatio is offset by OS display scaling,
    // so we report zoom RELATIVE to page load (100% at load). ---
    if (typeof window === "undefined" || !window.devicePixelRatio) {
      return undefined;
    }
    const baseDpr = window.devicePixelRatio;
    let lastPct = null;
    let detachMedia = () => {};

    const report = () => {
      const pct = Math.round((window.devicePixelRatio / baseDpr) * 100);
      if (pct === lastPct) return;
      lastPct = pct;
      showRef.current(`Zoom ${pct}%`);
    };

    // A media query bound to the current dppx stops matching the moment zoom
    // changes; re-arm it each time for continuous tracking. Falls back to the
    // resize event where matchMedia is unavailable.
    const armMediaQuery = () => {
      if (!window.matchMedia) return;
      const mq = window.matchMedia(
        `(resolution: ${window.devicePixelRatio}dppx)`,
      );
      const onChange = () => {
        report();
        armMediaQuery();
      };
      mq.addEventListener("change", onChange, { once: true });
      detachMedia = () => mq.removeEventListener("change", onChange);
    };

    report(); // Show the 100% baseline once on mount.
    armMediaQuery();
    window.addEventListener("resize", report);
    return () => {
      detachMedia();
      window.removeEventListener("resize", report);
    };
  }, []);

  // Scoped per-panel zoom: surfaced via the shared custom event.
  useEffect(() => {
    const onScopedZoom = (e) => {
      const { label, percent } = e.detail || {};
      if (percent == null) return;
      showRef.current(label ? `${label} ${percent}%` : `${percent}%`);
    };
    window.addEventListener(ZOOM_TOAST_EVENT, onScopedZoom);
    return () => window.removeEventListener(ZOOM_TOAST_EVENT, onScopedZoom);
  }, []);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  if (message === null) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        right: "16px",
        bottom: "16px",
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "8px 14px",
        borderRadius: "8px",
        fontSize: "0.85rem",
        fontWeight: 600,
        letterSpacing: "0.02em",
        color: "var(--text-color, #0f172a)",
        background: "var(--background-color, #ffffff)",
        border: "1px solid var(--border-color, rgba(0,0,0,0.15))",
        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
        pointerEvents: "none",
        userSelect: "none",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        transition: "opacity 0.2s ease, transform 0.2s ease",
      }}
    >
      {message}
    </div>
  );
}
