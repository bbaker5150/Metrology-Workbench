// src/App.js
import React, { useState, useCallback, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import { Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Stage } from '@react-three/drei';
import axios from "axios";
import SessionSetup from "./components/session/SessionSetup";
import useCalibrationETA from "./hooks/useCalibrationETA";
import InstrumentStatusTab from "./components/session/InstrumentStatusTab";
import Calibration from "./components/calibration/Calibration";
import CalibrationResults from "./components/calibration/CalibrationResults";
// import UncertaintyAnalysis from "./components/analysis/UncertaintyAnalysis";
import TestPointSidebar from "./components/shared/TestPointSidebar";
import ConfigurationModal from "./components/shared/ConfigurationModal";
import BugReportModal from "./components/shared/BugReportModal";
import SessionNotesFloatingPanel from "./components/session/SessionNotesFloatingPanel";
import CorrectionsModal from "./components/calibration/CorrectionsModal";
import AnimatedModalShell from "./components/shared/AnimatedModalShell";
import {
  InstrumentContextProvider,
  useInstruments,
} from "./contexts/InstrumentContext";
import { useTheme } from "../../shared/ThemeContext";
import { useNotifications } from "../../shared/NotificationContext";
import bootstrapStyles from "bootstrap/dist/css/bootstrap.min.css?inline";
import { FaInfoCircle, FaTimes, FaSun, FaMoon, FaCheckCircle, FaExclamationTriangle, FaExclamationCircle, FaBug, FaEye, FaEyeSlash, FaStickyNote, FaRegClock } from "react-icons/fa";
import acShuntStyles from "./App.css?inline";
import { arrayMove } from "@dnd-kit/sortable";
import { gsap } from "gsap";
import { AVAILABLE_FREQUENCIES, API_BASE_URL } from "./constants/constants";
import useDbHealth from "./hooks/useDbHealth";

const APP_VERSION = "v1.0.0";
const APP_VERSION_DISPLAY = "v 1.0";
const RELEASE_NOTES = [
  {
    version: "v1.0.0",
    date: "2026-04-22",
    highlights: [
      "Initial release.",
      "Patch notes will appear here as updates are published.",
    ],
  },
];

const shouldReduceMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const useScopedAcShuntStyles = () => {
  useLayoutEffect(() => {
    document.body.classList.add("ac-shunt-active");

    const style = document.createElement("style");
    style.dataset.module = "ac-shunt";
    style.textContent = `${bootstrapStyles}\n${acShuntStyles}`;
    document.head.appendChild(style);

    return () => {
      document.body.classList.remove("ac-shunt-active");
      style.remove();
    };
  }, []);
};

// Corrections now live under dated Reports of Calibration; the active
// report (latest-dated, or operator-pinned) is the one that feeds live
// math. This mirrors the backend's fetch_automatic_corrections lookup.
const getActiveReport = (device) => {
  const reports = device?.reports || [];
  if (reports.length === 0) return null;
  return reports.find((r) => r.is_active) || reports[0];
};

// Helper functions for corrections (getShuntCorrectionForPoint, getTVCCorrectionForPoint)
const getShuntCorrectionForPoint = (point, shuntRangeInAmps, shuntSn, shuntsData) => {
  if (!point || !shuntRangeInAmps || !shuntsData || shuntsData.length === 0 || !shuntSn)
    return { correction: "N/A", uncertainty: "N/A" };

  const pointCurrent = parseFloat(point.current);
  const epsilon = 1e-9;

  // Prefer a manual device over an imported one when both exist.
  const shunt = [...shuntsData]
    .filter(
      (s) =>
        String(s.serial_number) === String(shuntSn) &&
        Math.abs(parseFloat(s.range) - shuntRangeInAmps) < epsilon
    )
    .sort((a, b) => (b.is_manual ? 1 : 0) - (a.is_manual ? 1 : 0))[0];

  const activeReport = getActiveReport(shunt);
  if (activeReport && Array.isArray(activeReport.corrections)) {
    const correction = activeReport.corrections.find(
      (c) =>
        Math.abs(parseFloat(c.current) - pointCurrent) < epsilon &&
        parseFloat(c.frequency) === point.frequency
    );
    return correction
      ? {
        correction: correction.correction,
        uncertainty: correction.uncertainty,
      }
      : { correction: "N/A", uncertainty: "N/A" };
  }
  return { correction: "N/A", uncertainty: "N/A" };
};
const getTVCCorrectionForPoint = (point, tvcSn, tvcsData) => {
  if (!point || !tvcsData || tvcsData.length === 0 || !tvcSn) return null;
  const tvc = tvcsData.find((t) => String(t.serial_number) === String(tvcSn));
  const activeReport = getActiveReport(tvc);
  if (!activeReport || !Array.isArray(activeReport.corrections) || activeReport.corrections.length === 0)
    return null;
  const targetFreq = point.frequency;
  const sorted = [...activeReport.corrections].sort((a, b) => a.frequency - b.frequency);
  const exactMatch = sorted.find((m) => m.frequency === targetFreq);
  if (exactMatch) return exactMatch.ac_dc_difference;
  if (targetFreq < 1000) {
    const next = sorted.find((m) => m.frequency > targetFreq);
    return next ? next.ac_dc_difference : null;
  }
  let lower = null;
  let upper = null;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (
      sorted[i].frequency < targetFreq &&
      sorted[i + 1].frequency > targetFreq
    ) {
      lower = sorted[i];
      upper = sorted[i + 1];
      break;
    }
  }
  if (lower && upper) {
    const { frequency: f1, ac_dc_difference: d1 } = lower;
    const { frequency: f2, ac_dc_difference: d2 } = upper;
    return d1 + ((targetFreq - f1) * (d2 - d1)) / (f2 - f1);
  }
  return null;
};

// CorrectionsDetailsModal Component
const CorrectionsDetailsModal = ({
  isOpen,
  point,
  onClose,
  tooltipData,
  standardTvcSn,
  testTvcSn,
  standardShuntSn
}) => {
  const lastPointRef = useRef(point);
  useEffect(() => {
    if (point) lastPointRef.current = point;
  }, [point]);
  const displayPoint = point || lastPointRef.current;
  if (!displayPoint) return null;

  const shuntCorr = getShuntCorrectionForPoint(
    displayPoint,
    tooltipData.shuntRangeInAmps,
    standardShuntSn,
    tooltipData.shuntsData
  );
  const stdTvcCorr = getTVCCorrectionForPoint(
    displayPoint,
    standardTvcSn,
    tooltipData.tvcsData
  );
  const tiTvcCorr = getTVCCorrectionForPoint(
    displayPoint,
    testTvcSn,
    tooltipData.tvcsData
  );

  const formatFrequency = (value) =>
    (
      AVAILABLE_FREQUENCIES.find((f) => f.value === value) || {
        text: `${value}Hz`,
      }
    ).text;

  const formatShunt = (val) =>
    val !== "N/A" && val !== null && val !== undefined
      ? `${val} PPM`
      : "N/A";
  const formatTvc = (val) =>
    val !== null && val !== undefined ? `${val.toFixed(2)} PPM` : "N/A";

  return (
    <AnimatedModalShell
      isOpen={isOpen}
      onClose={onClose}
      panelClassName="point-corrections-modal"
      panelProps={{
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "point-corrections-title",
      }}
    >
      <header className="point-corrections-header">
        <div className="point-corrections-header-text">
          <span className="point-corrections-eyebrow">Test point</span>
          <h3
            id="point-corrections-title"
            className="point-corrections-title"
          >
            {displayPoint?.current ?? "--"} A
            <span className="point-corrections-title-sep">·</span>
            {displayPoint ? formatFrequency(displayPoint.frequency) : "--"}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="cal-results-excel-icon-btn"
          title="Close"
          aria-label="Close"
        >
          <FaTimes aria-hidden />
        </button>
      </header>

      <div className="point-corrections-body">
        <div className="point-corrections-row">
          <span className="point-corrections-label">Shunt correction</span>
          <span className="point-corrections-value">
            {formatShunt(shuntCorr.correction)}
          </span>
        </div>
        <div className="point-corrections-row">
          <span className="point-corrections-label">STD TVC correction</span>
          <span className="point-corrections-value">
            {formatTvc(stdTvcCorr)}
          </span>
        </div>
        <div className="point-corrections-row">
          <span className="point-corrections-label">TI TVC correction</span>
          <span className="point-corrections-value">
            {formatTvc(tiTvcCorr)}
          </span>
        </div>
      </div>
    </AnimatedModalShell>
  );
};

// Confirmation modal — cohesive with the view-corrections / point-corrections
// modal design (eyebrow + title header, icon-only close, single action pinned
// at the bottom-right). The destructive variant gets a red action button.
const ConfirmationModal = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = "Confirm",
  confirmButtonClass = "",
}) => {
  const isDanger = /danger/.test(confirmButtonClass);
  return (
    <AnimatedModalShell
      isOpen={isOpen}
      onClose={onCancel}
      panelClassName="confirm-modal"
      panelProps={{
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "confirm-modal-title",
      }}
    >
      <header className="confirm-modal-header">
        <div className="confirm-modal-header-text">
          <span className="confirm-modal-eyebrow">
            {isDanger ? "Warning" : "Confirm"}
          </span>
          <h3 id="confirm-modal-title" className="confirm-modal-title">
            {title}
          </h3>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="cal-results-excel-icon-btn"
          title="Close"
          aria-label="Close"
        >
          <FaTimes aria-hidden />
        </button>
      </header>

      <div className="confirm-modal-body">
        <p className="confirm-modal-message">{message}</p>
      </div>

      <footer className="confirm-modal-footer">
        <button
          type="button"
          onClick={onConfirm}
          className={`confirm-modal-action${isDanger ? " confirm-modal-action--danger" : ""
            }`}
        >
          {confirmText}
        </button>
      </footer>
    </AnimatedModalShell>
  );
};
const ReleaseNotesModal = ({ isOpen, onClose }) => {
  return (
    <AnimatedModalShell
      isOpen={isOpen}
      onClose={onClose}
      panelClassName="release-notes-modal"
      panelProps={{
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "release-notes-title",
      }}
    >
      <header className="release-notes-header">
        <div className="release-notes-header-text">
          <span className="release-notes-eyebrow">Build info</span>
          <h3 id="release-notes-title" className="release-notes-title">
            Patch Notes
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="cal-results-excel-icon-btn"
          title="Close"
          aria-label="Close"
        >
          <FaTimes aria-hidden />
        </button>
      </header>

      <div className="release-notes-body">
        <div className="release-notes-current">
          <span className="release-notes-current-label">Current version</span>
          <span className="release-notes-current-value">{APP_VERSION}</span>
        </div>

        {RELEASE_NOTES.map((entry) => (
          <section className="release-notes-entry" key={entry.version}>
            <div className="release-notes-entry-head">
              <span className="release-notes-entry-version">{entry.version}</span>
              <span className="release-notes-entry-date">{entry.date}</span>
            </div>
            <ul className="release-notes-list">
              {entry.highlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </AnimatedModalShell>
  );
};

// Small header pill that shows how many remote observers are connected to
// this host. Hover reveals each observer's IP and how long they've been
// connected. Deliberately minimal: no kick, no toasts, no names — just
// ambient awareness. Consumers should only render when observers.length > 0
// and the current window is the host.
function ObserversPill({ observers }) {
  const count = observers.length;
  const now = Date.now();

  const formatRelative = (connectedAtSeconds) => {
    if (!connectedAtSeconds) return "just now";
    const elapsedMs = now - connectedAtSeconds * 1000;
    const sec = Math.max(0, Math.floor(elapsedMs / 1000));
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    return `${hr}h`;
  };

  return (
    <div className="observers-pill" role="status" aria-label={`${count} observer${count === 1 ? "" : "s"} connected`}>
      <FaEye aria-hidden />
      <span className="observers-pill-count">
        {count} {count === 1 ? "observer" : "observers"}
      </span>
      <div className="observers-pill-tooltip" role="tooltip">
        <div className="observers-pill-tooltip-title">Connected observers</div>
        <ul className="observers-pill-tooltip-list">
          {observers.map((obs, idx) => (
            <li key={`${obs.ip}-${obs.connected_at}-${idx}`}>
              <span className="observers-pill-ip">{obs.ip || "unknown"}</span>
              <span className="observers-pill-dot" aria-hidden>·</span>
              <span className="observers-pill-elapsed">
                connected {formatRelative(obs.connected_at)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function AppContent() {
  const [activeTab, setActiveTab] = useState("sessionSetup");
  const [sessionsList, setSessionsList] = useState([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  // Toasts are raised through the shared workbench NotificationProvider.
  const { showNotification } = useNotifications();
  // theme is still read for module-level theming (e.g. passed to modals);
  // the theme TOGGLE now lives in the global WorkbenchTopBar.
  const { theme } = useTheme();

  const {
    selectedSessionName,
    selectedSessionId,
    isCollecting,
    activeCollectionDetails,
    bulkRunProgress,
    awaitingAmplifierConfirmation,
    standardTvcSn,
    testTvcSn,
    setStandardInstrumentSerial,
    setTestInstrumentSerial,
    setStandardTvcSn,
    setTestTvcSn,
    observers,
    isRemoteViewer,
    observedSessionId,
    leaveObserverMode,
    roleDowngradeNotice,
    clearRoleDowngradeNotice,
    pairedRun,
    timerState,
    stdReaderModel,
    tiReaderModel,
    switchDriverAddress,
    readerSwitchDriverAddress,
    readerSwitchSettlingTime,
  } = useInstruments();

  const isBulkRunning = bulkRunProgress && bulkRunProgress.total > 0;
  // True whenever the host is collecting data, regardless of run type
  // (batch or single point) and regardless of viewer role. Remote
  // observers don't receive ``bulkRunProgress`` over host_sync but they
  // do receive ``isCollecting``, so OR'ing the two keeps the active
  // seal animation/glow consistent for hosts and observers alike.
  //
  // The 8100 amplifier-confirm prompt sits between "user pressed start"
  // and "calibration is actually running". During that window the host
  // sees the modal but no readings flow; gating on
  // ``awaitingAmplifierConfirmation`` keeps the green glow / spin off
  // until the operator presses Proceed.
  //
  // ``timerState.isActive`` is OR'd in so the seal glows during the
  // initial warm-up / settling window too. Hosts optimistically set
  // ``isCollecting`` before warm-up, but remotes only learn the run
  // started from the warm-up timer (no readings flow yet), so without
  // this an observer's logo stayed grey for the entire warm-up. Matches
  // ``showRunActivity`` in CalibrationStatusBar.
  const isCalibrationActive =
    (isBulkRunning || isCollecting || Boolean(timerState?.isActive)) &&
    !awaitingAmplifierConfirmation;

  const [tpData, setTPData] = useState({ points: [] });
  const [orderedTestPoints, setOrderedTestPoints] = useState([]);
  const [focusedTestPoint, setFocusedTestPoint] = useState(null);
  const [selectedTPs, setSelectedTPs] = useState(new Set());
  const [shuntsData, setShuntsData] = useState([]);
  const [tvcsData, setTvcsData] = useState([]);
  const [sessionInfo, setSessionInfo] = useState({});
  const [calibrationConfigs, setCalibrationConfigs] = useState({});
  const [clearConfirmationModal, setClearConfirmationModal] = useState({
    isOpen: false,
  });
  const [deleteConfirmationModal, setDeleteConfirmationModal] = useState({
    isOpen: false,
  });
  const [activeDirection, setActiveDirection] = useState("Forward");
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isCorrectionsModalOpen, setIsCorrectionsModalOpen] = useState(false);
  const [isBugReportModalOpen, setIsBugReportModalOpen] = useState(false);
  const [isSessionNotesOpen, setIsSessionNotesOpen] = useState(false);
  const [isReleaseNotesOpen, setIsReleaseNotesOpen] = useState(false);
  const [pointCorrectionsModal, setPointCorrectionsModal] = useState({
    isOpen: false,
    point: null,
  });
  const [resultsNavigationRequest, setResultsNavigationRequest] = useState(null);
  const [dbInfo, setDbInfo] = useState(null);
  // Live outbox / MSSQL reachability WS — only useful when the default DB is
  // remote. SQLite dev setups skip the socket to avoid console noise and
  // failed handshakes; the pill still uses system_info.outbox for snapshots.
  const dbHealthWsEnabled = Boolean(
    dbInfo && dbInfo.database_type && dbInfo.database_type !== "sqlite3"
  );
  const dbHealth = useDbHealth({ enabled: dbHealthWsEnabled });
  const dbRecoveryToastShownRef = useRef(false);
  const hasMountedTabAnimationRef = useRef(false);
  const previousTabRef = useRef(activeTab);
  const tabPaneRef = useRef(null);
  const navTabsRef = useRef(null);
  const navIndicatorRef = useRef(null);
  const tabButtonRefs = useRef({});
  const controlsRef = useRef(null);
  const resetCoinView = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  }

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  const tabOrder = useMemo(
    () => ({
      sessionSetup: 0,
      instrumentStatus: 1,
      runCalibration: 2,
      calibrationResults: 3,
    }),
    []
  );

  const showSessionInfoInChrome =
    Boolean(selectedSessionName) ||
    Boolean(isRemoteViewer && selectedSessionId);

  const sessionInfoPanelTitle =
    selectedSessionName ||
    (selectedSessionId != null ? `#${selectedSessionId}` : "—");

  const showChromeStatusCluster =
    Boolean(dbInfo) ||
    showSessionInfoInChrome ||
    Boolean(!isRemoteViewer && observers && observers.length > 0);

  useEffect(() => {
    const fetchSystemInfo = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/system_info/`);
        setDbInfo(response.data);
      } catch (error) {
        console.error("Failed to fetch system info.", error);
      }
    };

    fetchSystemInfo();
  }, []);

  useEffect(() => {
    setSelectedTPs(new Set());
  }, [selectedSessionId]);

  // Observer mode hides the Session and Instruments tabs — those surfaces
  // edit hardware + session state, neither of which an observer should be
  // able to touch while the host is driving the run. The host view (and
  // any user who voluntarily leaves observer mode) sees the full tab strip.
  const visibleTabs = useMemo(
    () =>
      isRemoteViewer
        ? ["runCalibration", "calibrationResults"]
        : ["sessionSetup", "instrumentStatus", "runCalibration", "calibrationResults"],
    [isRemoteViewer]
  );

  // Keep activeTab valid when observer mode engages / disengages. On entry
  // we force the user onto the Calibration tab (that's the live view they
  // joined for); on exit we drop them back on Session Setup so they can
  // spin up their own run. Hidden-tab bounce is reactive so hitting a
  // stale deep-link after role change doesn't leave the UI on a blank tab.
  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab(isRemoteViewer ? "runCalibration" : "sessionSetup");
    }
  }, [isRemoteViewer, visibleTabs, activeTab]);

  const updateTabIndicator = useCallback(
    (shouldAnimate = true) => {
      const indicator = navIndicatorRef.current;
      const tabsRow = navTabsRef.current;
      const activeButton = tabButtonRefs.current[activeTab];
      if (!indicator || !tabsRow || !activeButton) return;
      const tabsRect = tabsRow.getBoundingClientRect();
      const buttonRect = activeButton.getBoundingClientRect();
      const x = Math.max(0, buttonRect.left - tabsRect.left);
      const width = Math.max(0, buttonRect.width);
      gsap.to(indicator, {
        x,
        width,
        duration: shouldAnimate && !prefersReducedMotion ? 0.35 : 0,
        ease: "power3.out",
      });
    },
    [activeTab, prefersReducedMotion]
  );

  useEffect(() => {
    updateTabIndicator(false);
  }, [updateTabIndicator, visibleTabs]);

  useEffect(() => {
    const onResize = () => updateTabIndicator(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateTabIndicator]);

  useEffect(() => {
    const currentTab = activeTab;
    const previousTab = previousTabRef.current;
    const prevOrder = tabOrder[previousTab] ?? 0;
    const currentOrder = tabOrder[currentTab] ?? 0;
    const direction = currentOrder >= prevOrder ? 1 : -1;
    const panel = tabPaneRef.current;
    const activeButton = tabButtonRefs.current[currentTab];

    updateTabIndicator(hasMountedTabAnimationRef.current);

    if (!prefersReducedMotion && panel) {
      gsap.fromTo(
        panel,
        { autoAlpha: 0, x: direction * 30, y: 8, scale: 0.992 },
        {
          autoAlpha: 1,
          x: 0,
          y: 0,
          scale: 1,
          duration: hasMountedTabAnimationRef.current ? 0.42 : 0.24,
          ease: "power3.out",
          clearProps: "transform",
        }
      );
      if (activeButton && hasMountedTabAnimationRef.current) {
        gsap.fromTo(
          activeButton,
          { scale: 0.94, y: 2 },
          { scale: 1, y: 0, duration: 0.28, ease: "back.out(1.65)" }
        );
      }
    }

    hasMountedTabAnimationRef.current = true;
    previousTabRef.current = currentTab;
  }, [activeTab, prefersReducedMotion, tabOrder, updateTabIndicator]);

  // Surface a warning toast whenever the supervisor silently downgrades us
  // into observer mode (the "I clicked the session a tick before the
  // dropdown knew it was active" race). The context sets the notice and
  // we clear it here after flashing the toast, so the same downgrade
  // never double-fires. 8s gives enough dwell to read it without
  // blocking the user from switching to Calibration.
  useEffect(() => {
    if (!roleDowngradeNotice) return;
    showNotification(roleDowngradeNotice.message, "warning", 8000);
    clearRoleDowngradeNotice();
  }, [roleDowngradeNotice, showNotification, clearRoleDowngradeNotice]);

  // On boot, if the drainer is replaying leftover rows from a previous run,
  // surface a one-time toast. Uses system_info.outbox (works for SQLite dev
  // without the db-health WebSocket) and live WS counts when connected.
  useEffect(() => {
    if (dbRecoveryToastShownRef.current) return;
    if (!dbInfo) return;
    const rest = dbInfo.outbox || {};
    const pending = Math.max(
      Number(rest.pending_count) || 0,
      dbHealth.pendingCount || 0
    );
    const failed = Math.max(
      Number(rest.failed_count) || 0,
      dbHealth.failedCount || 0
    );
    if (pending > 0) {
      dbRecoveryToastShownRef.current = true;
      showNotification(
        `Recovering ${pending} buffered reading${pending === 1 ? "" : "s"} to the database...`,
        "info",
        6000
      );
    } else if (failed > 0) {
      dbRecoveryToastShownRef.current = true;
      showNotification(
        `${failed} buffered reading${failed === 1 ? "" : "s"} need attention. Check DB status.`,
        "warning",
        8000
      );
    }
  }, [
    dbInfo,
    dbHealth.pendingCount,
    dbHealth.failedCount,
    showNotification,
  ]);

  const fetchSessionsList = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/calibration_sessions/`);
      setSessionsList(response.data || []);
    } catch (error) {
      showNotification('Failed to fetch sessions list.', 'error');
    } finally {
      setIsLoadingSessions(false);
    }
  }, [showNotification]);

  useEffect(() => {
    fetchSessionsList();
  }, [fetchSessionsList]);

  const fetchSessionData = useCallback(async () => {
    if (!selectedSessionId) {
      setTPData({ points: [] });
      setShuntsData([]);
      setTvcsData([]);
      setSessionInfo({});
      setCalibrationConfigs({});
      setFocusedTestPoint(null);
      return;
    }
    try {
      const [tpRes, shuntsRes, tvcsRes, sessionRes, infoRes] =
        await Promise.all([
          axios.get(
            `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/`
          ),
          axios.get(`${API_BASE_URL}/shunts/`),
          axios.get(`${API_BASE_URL}/tvcs/`),
          axios.get(
            `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/`
          ),
          axios.get(
            `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/information/`
          ),
        ]);
      setTPData({ points: tpRes.data?.test_points || [] });
      setShuntsData(shuntsRes.data || []);
      setTvcsData(tvcsRes.data || []);

      const sessionData = sessionRes.data || {};
      setSessionInfo(sessionData);

      setStandardInstrumentSerial(sessionData.standard_instrument_serial);
      setTestInstrumentSerial(sessionData.test_instrument_serial);
      setStandardTvcSn(sessionData.standard_tvc_serial);
      setTestTvcSn(sessionData.test_tvc_serial);

      setCalibrationConfigs(infoRes.data.configurations || {});
      fetchSessionsList();
    } catch (error) {
      showNotification("Failed to load complete session data.", "error");
    }
  }, [
    selectedSessionId,
    showNotification,
    setStandardInstrumentSerial,
    setTestInstrumentSerial,
    setStandardTvcSn,
    setTestTvcSn,
    fetchSessionsList,
  ]);

  useEffect(() => {
    fetchSessionData();
  }, [fetchSessionData]);

  const uniqueTestPoints = useMemo(() => {
    if (!tpData?.points) return [];
    const pointMap = new Map();
    tpData.points.forEach((point) => {
      const key = `${point.current}-${point.frequency}`;
      if (!pointMap.has(key)) {
        pointMap.set(key, {
          key,
          current: point.current,
          frequency: point.frequency,
          forward: null,
          reverse: null,
        });
      }
      const entry = pointMap.get(key);
      if (point.direction === "Forward") entry.forward = point;
      else if (point.direction === "Reverse") entry.reverse = point;
    });
    return Array.from(pointMap.values());
  }, [tpData]);

  useEffect(() => {
    const newPointsMap = new Map(uniqueTestPoints.map((p) => [p.key, p]));

    setOrderedTestPoints((prevOrderedPoints) => {
      if (
        (!prevOrderedPoints || prevOrderedPoints.length === 0) &&
        uniqueTestPoints.length > 0
      ) {
        return uniqueTestPoints;
      }
      const updatedAndOrderedPoints = prevOrderedPoints
        .map((oldPoint) => newPointsMap.get(oldPoint.key))
        .filter(Boolean);
      const existingKeys = new Set(updatedAndOrderedPoints.map((p) => p.key));
      const newPointsToAdd = uniqueTestPoints.filter(
        (p) => !existingKeys.has(p.key)
      );
      return [...updatedAndOrderedPoints, ...newPointsToAdd];
    });

    setFocusedTestPoint((prevFocusPoint) => {
      if (!prevFocusPoint) {
        return null;
      }
      const updatedFocusPoint = newPointsMap.get(prevFocusPoint.key);
      return updatedFocusPoint || null;
    });
  }, [uniqueTestPoints]);

  // --- THIS LIVES IN APP.JSX ---
  const activeSettings = useMemo(() => {
    if (!isCollecting || !activeCollectionDetails) return null;

    let tpSettings = {};
    let activeFrequency = activeCollectionDetails.frequency ?? null;
    const liveMeasurementParams = activeCollectionDetails.measurement_params || {};
    if (activeCollectionDetails.tpId && uniqueTestPoints) {
      const tp = uniqueTestPoints.find(p =>
        String(p.forward?.id) === String(activeCollectionDetails.tpId) ||
        String(p.reverse?.id) === String(activeCollectionDetails.tpId)
      );
      if (tp) {
        const isReverse = String(tp.reverse?.id) === String(activeCollectionDetails.tpId);
        const activePoint = isReverse ? tp.reverse : tp.forward;
        tpSettings = activePoint?.settings || {};
        activeFrequency = activePoint?.frequency ?? activeFrequency;
      }
    }

    const readSetting = (key, fallback) => (
      liveMeasurementParams[key]
      ?? activeCollectionDetails[key]
      ?? tpSettings[key]
      ?? calibrationConfigs?.[key]
      ?? fallback
    );

    return {
      command: activeCollectionDetails.command,
      is_pre_batch: activeCollectionDetails.is_pre_batch,
      nplc: readSetting('nplc', 20),
      num_samples: readSetting('num_samples', 35),
      initial_warm_up_time: readSetting('initial_warm_up_time', 0),
      settling_time: readSetting('settling_time', 120),
      input_switch_settling_time: readSetting('input_switch_settling_time', 1),
      n_cycles: readSetting('n_cycles', 3),
      frequency: activeFrequency,
      stability_check_method: readSetting('stability_check_method', 'sliding_window'),
      stability_window: liveMeasurementParams.window
        ?? readSetting('stability_window', 30),
      ignore_instability_after_lock: readSetting('ignore_instability_after_lock', false),
      f8508_dc_filter_enabled: readSetting('f8508_dc_filter_enabled', true),
      f8508_dc_resolution: readSetting('f8508_dc_resolution', 7),
      f8508_dc_fast_enabled: readSetting('f8508_dc_fast_enabled', false),
      f8508_ac_filter_hz: readSetting('f8508_ac_filter_hz', null),
      f8508_ac_resolution: readSetting('f8508_ac_resolution', 6),
      f8508_ac_transfer_enabled: readSetting('f8508_ac_transfer_enabled', true),
      f8508_ac_dc_coupled: readSetting('f8508_ac_dc_coupled', false),
      f5790_filter_mode: readSetting('f5790_filter_mode', 'MEDIUM'),
      f5790_filter_restart: readSetting('f5790_filter_restart', 'MEDIUM'),
      f5790_hires_enabled: readSetting('f5790_hires_enabled', true),
      f5790_range_mode: readSetting('f5790_range_mode', '2.2'),
      f5790_input_switch_settling_time: readSetting('f5790_input_switch_settling_time', 30),
      has_switch_driver: Boolean(switchDriverAddress),
      has_reader_switch: Boolean(readerSwitchDriverAddress),
      reader_switch_settling_time: Number(readerSwitchSettlingTime) || 0,
      use_char_minus_readings: activeCollectionDetails.use_char_minus_readings ?? tpSettings.use_char_minus_readings ?? calibrationConfigs?.use_char_minus_readings ?? false,
      use_char_plus2_readings: activeCollectionDetails.use_char_plus2_readings ?? tpSettings.use_char_plus2_readings ?? calibrationConfigs?.use_char_plus2_readings ?? false
    };
  }, [
    isCollecting,
    activeCollectionDetails,
    uniqueTestPoints,
    calibrationConfigs,
    switchDriverAddress,
    readerSwitchDriverAddress,
    readerSwitchSettlingTime,
  ]);

  // Initializes the hook by passing activeSettings into calibrationSettings
  const estimatedTime = useCalibrationETA({
    isCollecting,
    isBulkRunning,
    bulkRunProgress,
    calibrationSettings: activeSettings,
    selectedTPCount: selectedTPs.size,
    pairedRun,
    readerModels: [stdReaderModel, tiReaderModel],
  });

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setOrderedTestPoints((items) => {
        const oldIndex = items.findIndex((item) => item.key === active.id);
        const newIndex = items.findIndex((item) => item.key === over.id);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        const orderedKeys = newOrder.map((item) => item.key);
        axios
          .post(
            `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/actions/update-order/`,
            { ordered_keys: orderedKeys }
          )
          .catch((error) => {
            showNotification(
              "Could not save the new test point order.",
              "error"
            );
          });
        return newOrder;
      });
    }
  };

  const hasAnyReadings = useCallback((point) => {
    if (!point?.readings) return false;
    return Object.values(point.readings).some(
      (arr) => Array.isArray(arr) && arr.length > 0
    );
  }, []);

  const performDeleteTestPoint = async (pointsToDelete) => {
    if (!pointsToDelete || pointsToDelete.length === 0) return;
    try {
      const deletePromises = pointsToDelete.map((p) =>
        axios.delete(
          `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/${p.id}/`
        )
      );
      await Promise.all(deletePromises);
      showNotification(
        pointsToDelete.length > 1
          ? "Selected test points deleted."
          : "Test point deleted.",
        "error"
      );
      await fetchSessionData();
      setSelectedTPs(new Set());
    } catch (error) {
      showNotification(
        "An error occurred while deleting test points.",
        "error"
      );
    }
    setDeleteConfirmationModal({ isOpen: false });
  };

  const formatFrequency = useCallback((value) => {
    return (
      AVAILABLE_FREQUENCIES.find((f) => f.value === value) || {
        text: `${value}Hz`,
      }
    ).text;
  }, []);

  const promptDeleteTestPoint = (uniquePoint) => {
    const pointsToDelete = [uniquePoint.forward, uniquePoint.reverse].filter(
      Boolean
    );
    const hasReadingsCheck = pointsToDelete.some(hasAnyReadings);

    const message = hasReadingsCheck
      ? `This test point has existing readings. Deleting it will permanently remove all associated data.\n\nAre you sure you want to delete ${uniquePoint.current
      }A @ ${formatFrequency(uniquePoint.frequency)}?`
      : `Are you sure you want to delete the test point for ${uniquePoint.current
      }A @ ${formatFrequency(uniquePoint.frequency)}?`;

    setDeleteConfirmationModal({
      isOpen: true,
      title: "Confirm Deletion",
      message: message,
      confirmText: "Delete",
      confirmButtonClass: "button-danger",
      onConfirm: () => performDeleteTestPoint(pointsToDelete),
      onCancel: () => setDeleteConfirmationModal({ isOpen: false }),
    });
  };

  const promptDeleteSelectedTestPoints = () => {
    if (selectedTPs.size === 0) {
      showNotification("No test points selected to delete.", "warning");
      return;
    }
    const pointsToDelete = uniqueTestPoints
      .filter((p) => selectedTPs.has(p.key))
      .flatMap((p) => [p.forward, p.reverse].filter(Boolean));

    const message = `Are you sure you want to delete the ${selectedTPs.size} selected test point(s)? This action cannot be undone.`;

    setDeleteConfirmationModal({
      isOpen: true,
      title: `Delete ${selectedTPs.size} Test Point(s)`,
      message: message,
      confirmText: `Delete ${selectedTPs.size} Point(s)`,
      confirmButtonClass: "button-danger",
      onConfirm: () => performDeleteTestPoint(pointsToDelete),
      onCancel: () => setDeleteConfirmationModal({ isOpen: false }),
    });
  };

  const handleClearReadings = useCallback(
    async (testPointId, direction) => {
      try {
        await axios.post(
          `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/${testPointId}/clear_readings/`
        );
        showNotification(
          `Readings for the ${direction} direction have been cleared.`,
          "success"
        );
        await fetchSessionData();
      } catch (error) {
        showNotification("Failed to clear readings.", "error");
      } finally {
        setClearConfirmationModal({ isOpen: false });
      }
    },
    [selectedSessionId, showNotification, fetchSessionData]
  );

  const promptClearReadings = useCallback(
    (direction, point) => {
      const pointForDirection =
        direction === "Forward" ? point.forward : point.reverse;
      if (!pointForDirection) return;
      setClearConfirmationModal({
        isOpen: true,
        title: "Confirm Clear Readings",
        message: `Are you sure you want to permanently delete all readings for ${point.current
          }A @ ${formatFrequency(
            point.frequency
          )} in the ${direction} direction?`,
        onConfirm: () => handleClearReadings(pointForDirection.id, direction),
        onCancel: () => setClearConfirmationModal({ isOpen: false }),
      });
    },
    [handleClearReadings, formatFrequency]
  );

  const handleToggleSelectAll = () => {
    if (selectedTPs.size === uniqueTestPoints.length) {
      setSelectedTPs(new Set());
    } else {
      setSelectedTPs(new Set(uniqueTestPoints.map((p) => p.key)));
    }
  };

  const handleToggleSelect = (pointKey) => {
    const newSelected = new Set(selectedTPs);
    if (newSelected.has(pointKey)) newSelected.delete(pointKey);
    else newSelected.add(pointKey);
    setSelectedTPs(newSelected);
  };

  const handleViewPointCorrections = (point) => {
    setPointCorrectionsModal({ isOpen: true, point: point });
  };

  return (
    <div className="App">
      {/* Hidden SVG holding metallic gradient definitions. Referenced by
          CSS via `fill: url(#icon-metallic-light)` / `#icon-metallic-dark`
          on shared icon-button classes, giving every toolbar/sidebar icon
          a true vertical metal gradient (highlight → midtone → shadow)
          instead of a flat grey. Rendered once at the app root so every
          icon in the tree can pick up the reference. */}
      <svg
        width="0"
        height="0"
        aria-hidden="true"
        style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
      >
        <defs>
          {/* Light-mode: brushed steel. Slight blue undertone gives a cooler
              metrology-instrument feel vs. neutral grey. */}
          <linearGradient id="icon-metallic-light" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#b4bfcd" />
            <stop offset="45%" stopColor="#6b7685" />
            <stop offset="100%" stopColor="#3e4757" />
          </linearGradient>

          {/* Dark-mode: cool gunmetal silver — top highlight reads against
              the deep navy canvas, bottom stays slightly warmer for depth. */}
          <linearGradient id="icon-metallic-dark" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#e4ecf7" />
            <stop offset="45%" stopColor="#97a4b7" />
            <stop offset="100%" stopColor="#4d5869" />
          </linearGradient>

          {/* Hover variants: brighter highlight, same shape. Swapped in by
              the hover selector so the icon visibly "lifts" under the cursor. */}
          <linearGradient id="icon-metallic-light-hover" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ced7e2" />
            <stop offset="45%" stopColor="#4a5668" />
            <stop offset="100%" stopColor="#232a36" />
          </linearGradient>
          <linearGradient id="icon-metallic-dark-hover" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="45%" stopColor="#bac6d7" />
            <stop offset="100%" stopColor="#6d7a8c" />
          </linearGradient>
        </defs>
      </svg>

      <ConfigurationModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        showNotification={showNotification}
        onUpdate={fetchSessionData}
        uniqueTestPoints={uniqueTestPoints}
        sessionInfo={sessionInfo}
        calibrationConfigs={calibrationConfigs}
        selectedSessionId={selectedSessionId}
      />
      <CorrectionsModal
        isOpen={isCorrectionsModalOpen}
        onClose={() => setIsCorrectionsModalOpen(false)}
        onUpdate={fetchSessionData}
        showNotification={showNotification}
        uniqueTestPoints={uniqueTestPoints}
      />
      <CorrectionsDetailsModal
        isOpen={pointCorrectionsModal.isOpen}
        point={pointCorrectionsModal.point}
        onClose={() => setPointCorrectionsModal({ isOpen: false, point: null })}
        tooltipData={{
          shuntsData,
          tvcsData,
          shuntRangeInAmps: calibrationConfigs?.ac_shunt_range,
        }}
        standardShuntSn={sessionInfo?.standard_instrument_serial}
        standardTvcSn={standardTvcSn}
        testTvcSn={testTvcSn}
      />
      <BugReportModal
        isOpen={isBugReportModalOpen}
        onClose={() => setIsBugReportModalOpen(false)}
        showNotification={showNotification}
        dbInfo={dbInfo}
        sessionInfo={sessionInfo}
        selectedSessionId={selectedSessionId}
        selectedSessionName={selectedSessionName}
        activeTab={activeTab}
        theme={theme}
      />
      <SessionNotesFloatingPanel
        isOpen={isSessionNotesOpen}
        onClose={() => setIsSessionNotesOpen(false)}
        selectedSessionId={selectedSessionId}
        selectedSessionName={selectedSessionName}
        showNotification={showNotification}
        fetchSessionsList={fetchSessionsList}
        isRemoteViewer={isRemoteViewer}
      />
      <ReleaseNotesModal
        isOpen={isReleaseNotesOpen}
        onClose={() => setIsReleaseNotesOpen(false)}
      />
      <ConfirmationModal
        isOpen={clearConfirmationModal.isOpen}
        title={clearConfirmationModal.title}
        message={clearConfirmationModal.message}
        onConfirm={clearConfirmationModal.onConfirm}
        onCancel={clearConfirmationModal.onCancel}
        confirmText="Clear Readings"
      />
      <ConfirmationModal
        isOpen={deleteConfirmationModal.isOpen}
        title={deleteConfirmationModal.title}
        message={deleteConfirmationModal.message}
        onConfirm={deleteConfirmationModal.onConfirm}
        onCancel={deleteConfirmationModal.onCancel}
        confirmText={deleteConfirmationModal.confirmText}
        confirmButtonClass={deleteConfirmationModal.confirmButtonClass}
      />
      <header className="app-chrome">
        <div className="app-chrome-bar">
          <div className="app-chrome-brand">
            <div
              className={`app-chrome-brand-mark${isCalibrationActive ? ' is-active' : ''}`}
              role="img"
              aria-label="NAVAIR Metrology Calibration Program seal"
              style={{ WebkitAppRegion: 'no-drag' }}
            >
              {/* 1. We MUST keep this plate span. This is where your CSS glow and sizing live! */}
              <span className="app-chrome-brand-mark-plate" style={{ cursor: 'grab', zIndex: 10 }}>

                {/* 2. Apply the original image class directly to our Canvas wrapper */}
                <div
                  className="app-chrome-brand-mark-img"
                  style={{ width: '100%', height: '100%', position: 'relative' }}
                  title="Click and drag to rotate"
                >
                  {/* gl={{ alpha: true }} ensures the Canvas background is perfectly transparent so the glow shows through */}
                  <Canvas camera={{ position: [0, 0, 4.5], fov: 45 }} gl={{ alpha: true }}>
                    <ambientLight intensity={0.9} />
                    <directionalLight position={[5, 5, 5]} intensity={2.1} />
                    <directionalLight position={[-4, 2, 4]} intensity={0.8} />

                    <Suspense fallback={null}>
                      {/* shadows={false} disables Stage's default contact-shadow
                          plane — that plane is what was producing the hard
                          horizontal cutoff under the coin. The CSS aura
                          provides the depth read instead. */}
                      <Stage
                        environment={null}
                        intensity={0.75}
                        adjustCamera={false}
                        shadows={false}
                      >
                        {/* 1. Pass the reset function to the coin */}
                        <CoinModel onReset={resetCoinView} isActive={isCalibrationActive} />
                      </Stage>
                    </Suspense>

                    <OrbitControls
                      ref={controlsRef} /* 2. Attach the reference here! */
                      enableZoom={false}
                      enablePan={false}
                      autoRotate={false}
                    />
                  </Canvas>
                </div>
              </span>
            </div>
            <div className="app-chrome-brand-text">
              <span className="app-chrome-brand-name">
                AC<span className="app-chrome-brand-dot">·</span>Shunt
              </span>
              <div className="app-chrome-brand-eyebrow">
                <span className="app-chrome-brand-sub">
                  Calibration Platform
                </span>
                <button
                  type="button"
                  onClick={() => setIsReleaseNotesOpen(true)}
                  className="app-chrome-brand-version"
                  aria-label={`View patch notes for ${APP_VERSION}`}
                  title="View patch notes"
                >
                  {APP_VERSION_DISPLAY}
                </button>
              </div>
            </div>
          </div>
        </div>

        <nav className="app-chrome-nav" role="tablist" aria-label="Primary">
          <div className="app-chrome-nav-tabs" ref={navTabsRef}>
            {/* Session + Instruments are hidden in observer mode — an
                observer has no business editing session metadata or
                instrument addresses. A user who wants those controls back
                has to explicitly leave observer mode (see the header
                affordance on the right). */}
            {!isRemoteViewer && (
              <button
                ref={(node) => {
                  if (node) tabButtonRefs.current.sessionSetup = node;
                }}
                role="tab"
                aria-selected={activeTab === "sessionSetup"}
                onClick={() => setActiveTab("sessionSetup")}
                className={`app-chrome-tab${activeTab === "sessionSetup" ? " is-active" : ""}`}
              >
                Session
              </button>
            )}
            {!isRemoteViewer && (
              <button
                ref={(node) => {
                  if (node) tabButtonRefs.current.instrumentStatus = node;
                }}
                role="tab"
                aria-selected={activeTab === "instrumentStatus"}
                onClick={() => setActiveTab("instrumentStatus")}
                className={`app-chrome-tab${activeTab === "instrumentStatus" ? " is-active" : ""}`}
              >
                Instruments
              </button>
            )}
            <button
              ref={(node) => {
                if (node) tabButtonRefs.current.runCalibration = node;
              }}
              role="tab"
              aria-selected={activeTab === "runCalibration"}
              onClick={() => setActiveTab("runCalibration")}
              className={`app-chrome-tab${activeTab === "runCalibration" ? " is-active" : ""}`}
            >
              Calibration
            </button>
            <button
              ref={(node) => {
                if (node) tabButtonRefs.current.calibrationResults = node;
              }}
              role="tab"
              aria-selected={activeTab === "calibrationResults"}
              onClick={() => setActiveTab("calibrationResults")}
              className={`app-chrome-tab${activeTab === "calibrationResults" ? " is-active" : ""}`}
            >
              Results
            </button>
            <span className="app-chrome-tab-indicator" ref={navIndicatorRef} aria-hidden="true" />
          </div>

          <div
            className="app-chrome-meta app-chrome-meta--nav"
            role="group"
            aria-label="Status, tools, and display"
          >
            {showChromeStatusCluster && (
              <div
                className="app-chrome-meta-group app-chrome-meta-group--status"
                aria-label="Data and session"
              >
                {showSessionInfoInChrome && (
                  <div className="tooltip-container session-info-popover">
                    <button
                      type="button"
                      className="app-chrome-meta-icon"
                      aria-label="Session details"
                      title="Session details"
                    >
                      <FaInfoCircle aria-hidden />
                    </button>
                    <div
                      className="session-info-panel"
                      role="tooltip"
                      aria-label="Session details"
                    >
                      <div className="session-info-panel-header">
                        <span className="session-info-panel-eyebrow">
                          Active session
                        </span>
                        <h4
                          className="session-info-panel-title"
                          title={sessionInfoPanelTitle}
                        >
                          {sessionInfoPanelTitle}
                        </h4>
                      </div>

                      <div className="session-info-panel-body">
                        {/* --- NEW SYSTEM STATUS GROUP --- */}
                        <div className="session-info-panel-group">
                          <span className="session-info-group-label">System Status</span>

                          {estimatedTime && (
                            <>
                              <div className="session-info-row">
                                <span className="session-info-row-label">Time Remaining</span>
                                <span className="session-info-row-value" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <FaRegClock aria-hidden="true" />
                                  {estimatedTime.text}
                                </span>
                              </div>
                              <div className="session-info-row">
                                <span className="session-info-row-label">Est. Completion</span>
                                <span className="session-info-row-value">
                                  {/* Displays like "Mon, 3:45 PM" (Handles overnight runs cleanly) */}
                                  {estimatedTime.targetDate.toLocaleTimeString([], {
                                    weekday: 'short',
                                    hour: 'numeric',
                                    minute: '2-digit'
                                  })}
                                </span>
                              </div>
                            </>
                          )}

                          {dbInfo && (() => {
                            const dbLabel = dbInfo.database_type === 'sqlite3' ? 'SQLite' : 'MSSQL';
                            const isSqlite = dbInfo.database_type === 'sqlite3';
                            const rest = dbInfo.outbox || {};
                            const restPending = Number(rest.pending_count) || 0;
                            const restFailed = Number(rest.failed_count) || 0;

                            const buffered = isSqlite ? restPending : dbHealth.connected ? dbHealth.pendingCount : restPending;
                            const failed = isSqlite ? restFailed : dbHealth.connected ? dbHealth.failedCount : restFailed;
                            const reachable = isSqlite ? true : dbHealth.connected ? dbHealth.reachable !== false : rest.reachable !== false;

                            const stateClass = !reachable ? ' is-offline' : buffered > 0 ? ' is-buffering' : failed > 0 ? ' has-failed' : '';

                            const detailsList = (dbHealth.pendingDetails || []).map(d => {
                              const formattedStage = (d.stage || '').replace('_', ' ').toUpperCase();
                              return `• ${formattedStage} (${d.current}A @ ${d.frequency}Hz)`;
                            });

                            let detailsText = "";
                            if (detailsList.length > 0) {
                              detailsText = `\n\nQueued Stages:\n${detailsList.join('\n')}`;
                              if (buffered > detailsList.length) {
                                detailsText += `\n...and ${buffered - detailsList.length} more`;
                              }
                            }

                            let title = `Data source: ${dbLabel}`;
                            if (!reachable) {
                              title = `${dbLabel} unreachable. ${buffered} stage${buffered === 1 ? '' : 's'} buffered locally.${detailsText}`;
                            } else if (buffered > 0) {
                              title = `${dbLabel}: replaying ${buffered} buffered stage${buffered === 1 ? '' : 's'}.${detailsText}`;
                            } else if (failed > 0) {
                              title = `${dbLabel}: ${failed} buffered stage${failed === 1 ? '' : 's'} need attention.`;
                            }

                            return (
                              <div className="session-info-row">
                                <span className="session-info-row-label">Database</span>
                                <span className="session-info-row-value">
                                  <div className={`db-indicator-pill${stateClass}`} title={title} style={{ margin: 0 }}>
                                    <span className="db-status-dot" aria-hidden />
                                    <span className="db-name-text">{dbLabel}</span>
                                    {buffered > 0 && (
                                      <span className="db-buffered-badge" aria-label={`${buffered} buffered`}>
                                        {buffered > 99 ? '99+' : buffered}
                                      </span>
                                    )}
                                  </div>
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                        <div className="session-info-panel-group">
                          <span className="session-info-group-label">Test instrument</span>
                          <div className="session-info-row">
                            <span className="session-info-row-label">Model</span>
                            <span className="session-info-row-value">{sessionInfo?.test_instrument_model || "—"}</span>
                          </div>
                          <div className="session-info-row">
                            <span className="session-info-row-label">Serial</span>
                            <span className="session-info-row-value">{sessionInfo?.test_instrument_serial || "—"}</span>
                          </div>
                        </div>

                        <div className="session-info-panel-group">
                          <span className="session-info-group-label">Standard</span>
                          <div className="session-info-row">
                            <span className="session-info-row-label">Model</span>
                            <span className="session-info-row-value">{sessionInfo?.standard_instrument_model || "—"}</span>
                          </div>
                          <div className="session-info-row">
                            <span className="session-info-row-label">Serial</span>
                            <span className="session-info-row-value">{sessionInfo?.standard_instrument_serial || "—"}</span>
                          </div>
                        </div>

                        <div className="session-info-panel-group">
                          <span className="session-info-group-label">Environment</span>
                          <div className="session-info-row">
                            <span className="session-info-row-label">Created</span>
                            <span className="session-info-row-value">
                              {sessionInfo?.created_at ? new Date(sessionInfo.created_at).toLocaleDateString() : "—"}
                            </span>
                          </div>
                          <div className="session-info-row">
                            <span className="session-info-row-label">Temperature</span>
                            <span className="session-info-row-value">
                              {sessionInfo?.temperature ? `${sessionInfo.temperature} °C` : "—"}
                            </span>
                          </div>
                          <div className="session-info-row">
                            <span className="session-info-row-label">Humidity</span>
                            <span className="session-info-row-value">
                              {sessionInfo?.humidity ? `${sessionInfo.humidity} %RH` : "—"}
                            </span>
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>
                )}
                {!isRemoteViewer && observers && observers.length > 0 && (
                  <ObserversPill observers={observers} />
                )}
              </div>
            )}
            {showChromeStatusCluster && (
              <span className="app-chrome-meta-sep" aria-hidden="true" />
            )}
            <div
              className="app-chrome-meta-group app-chrome-meta-group--tools"
              aria-label="Feedback"
            >
              <button
                type="button"
                onClick={() => setIsSessionNotesOpen((open) => !open)}
                className={`app-chrome-meta-icon${isSessionNotesOpen ? " is-active" : ""}`}
                aria-label={
                  isSessionNotesOpen ? "Close session notes" : "Session notes"
                }
                title={
                  isSessionNotesOpen
                    ? "Close session notes panel"
                    : "Session notes"
                }
              >
                <FaStickyNote aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setIsBugReportModalOpen(true)}
                className="app-chrome-meta-icon"
                aria-label="Report an issue"
                title="Report an issue"
              >
                <FaBug aria-hidden />
              </button>
              {isRemoteViewer && (
                <button
                  type="button"
                  onClick={() => {
                    leaveObserverMode();
                    setActiveTab("sessionSetup");
                    showNotification(
                      observedSessionId
                        ? "Left observer mode. Select or start a session to continue."
                        : "Left observer mode.",
                      "info"
                    );
                  }}
                  className="app-chrome-meta-icon app-chrome-network-btn is-observing"
                  aria-label="Leave observer mode"
                  title="You're observing a live calibration. Click to leave observer mode and return to your own session."
                >
                  <FaEyeSlash aria-hidden />
                </button>
              )}
            </div>
          </div>
        </nav>
      </header>

      <div className={"main-layout-container with-sidebar"}>
        <aside className="app-sidebar">
          <TestPointSidebar
            orderedTestPoints={orderedTestPoints}
            uniqueTestPoints={uniqueTestPoints}
            tooltipData={{
              shuntsData,
              tvcsData,
              shuntRangeInAmps: calibrationConfigs?.ac_shunt_range,
            }}
            focusedTP={focusedTestPoint}
            selectedTPs={selectedTPs}
            isBulkRunning={isBulkRunning}
            isCollecting={isCollecting}
            activeCollectionDetails={activeCollectionDetails}
            bulkRunProgress={bulkRunProgress}
            activeDirection={activeDirection}
            setActiveDirection={setActiveDirection}
            onFocus={(point) => {
              setFocusedTestPoint(point);
              // Clicking a test point always jumps to the Calibration view so
              // the user immediately sees that point's charts / settings. The
              // sub-tab within Calibration ("settings" / "readings" /
              // "calculate") is preserved automatically by the module-level
              // ``rememberedCalSubTab`` inside Calibration.js, so this keeps
              // whichever sub-tab they last used.
              setActiveTab("runCalibration");
            }}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
            onDragEnd={handleDragEnd}
            onClearReadings={{
              prompt: promptClearReadings,
              hasAnyReadings: hasAnyReadings,
            }}
            onDeleteTestPoint={promptDeleteTestPoint}
            onDeleteSelected={promptDeleteSelectedTestPoints}
            onAddTestPoints={() => setIsConfigModalOpen(true)}
            onViewCorrections={() => setIsCorrectionsModalOpen(true)}
            onViewPointCorrections={handleViewPointCorrections}
            isRemoteViewer={isRemoteViewer}
          />
        </aside>

        <main className="main-content-area">
          <div className="tab-pane-animated" key={activeTab} ref={tabPaneRef}>
            {activeTab === "sessionSetup" && (
              <SessionSetup
                sessionsList={sessionsList}
                isLoadingSessions={isLoadingSessions}
                showNotification={showNotification}
                fetchSessionsList={fetchSessionsList}
                isRemoteViewer={isRemoteViewer}
              />
            )}
            {activeTab === "instrumentStatus" && (
              <InstrumentStatusTab
                showNotification={showNotification}
                isRemoteViewer={isRemoteViewer}
              />
            )}
            {activeTab === "runCalibration" && (
              <Calibration
                showNotification={showNotification}
                orderedTestPoints={orderedTestPoints}
                sharedFocusedTestPoint={focusedTestPoint}
                setSharedFocusedTestPoint={setFocusedTestPoint}
                sharedSelectedTPs={selectedTPs}
                onDataUpdate={fetchSessionData}
                activeDirection={activeDirection}
                isRemoteViewer={isRemoteViewer}
                onOpenResultsDirection={(direction, cycleIndex = null) => {
                  setResultsNavigationRequest({
                    direction,
                    cycleIndex,
                    requestedAt: Date.now(),
                  });
                  setActiveTab("calibrationResults");
                }}
              />
            )}
            {activeTab === "calibrationResults" && (
              <CalibrationResults
                showNotification={showNotification}
                sharedFocusedTestPoint={focusedTestPoint}
                uniqueTestPoints={uniqueTestPoints}
                onDataUpdate={fetchSessionData}
                navigationRequest={resultsNavigationRequest}
              />
            )}
            {/* {activeTab === "uncertaintyAnalysis" && (
              <UncertaintyAnalysis
                showNotification={showNotification}
                sharedFocusedTestPoint={focusedTestPoint}
                setSharedFocusedTestPoint={setFocusedTestPoint}
                orderedTestPoints={orderedTestPoints}
                onDataUpdate={fetchSessionData}
              />
            )} */}
          </div>
        </main>
      </div>
    </div>
  );
}
function CoinModel({ onReset, isActive }) {
  const { scene } = useGLTF('/3demblem.glb');
  const ref = useRef();
  // Tracks elapsed time only while active, so the sin wave always starts
  // from zero on a fresh calibration (no mid-cycle jump). Reset to 0 the
  // moment activity ends so the next run animates from rest.
  const activeTimeRef = useRef(0);

  // While a calibration is active, gently oscillate the coin back and
  // forth around its front face (never showing the blank back) with a
  // small vertical bob. When inactive, smoothly lerp rotation and
  // position back to the resting orientation so the coin always returns
  // to its starting pose when a run ends. OrbitControls (camera) stays
  // independent — manual drag still works in both states.
  useFrame((_, delta) => {
    const node = ref.current;
    if (!node) return;

    if (isActive) {
      activeTimeRef.current += delta;
      const t = activeTimeRef.current;
      // ±0.6 rad (~34°) keeps the front face toward the camera at the
      // extremes; the slow 1.2 rad/s frequency reads as a search/scan.
      node.rotation.y = Math.sin(t * 1.2) * 0.6;
      node.position.y = Math.sin(t * 1.8) * 0.04;
    } else {
      activeTimeRef.current = 0;
      // Frame-rate-independent exponential smoothing toward home.
      const k = 1 - Math.pow(0.0005, delta);
      node.rotation.y += (0 - node.rotation.y) * k;
      node.position.y += (0 - node.position.y) * k;
      // Snap to exact zero once we're effectively there to avoid jitter.
      if (Math.abs(node.rotation.y) < 0.001) node.rotation.y = 0;
      if (Math.abs(node.position.y) < 0.001) node.position.y = 0;
    }
  });

  return (
    <primitive
      ref={ref}
      object={scene}
      scale={1.85}
      onClick={(e) => {
        e.stopPropagation();
        // SAFETY CHECK: Only fire if onReset is actually a function!
        if (typeof onReset === 'function') {
          onReset();
        }
      }}
      onPointerOver={() => document.body.style.cursor = 'pointer'}
      onPointerOut={() => document.body.style.cursor = 'grab'}
    />
  );
}

function App() {
  useScopedAcShuntStyles();

  // ThemeProvider now lives at the workbench root (index.jsx) so every
  // module shares one theme. InstrumentContextProvider stays scoped here —
  // only the AC-Shunt module pays for the instrument WebSockets/state.
  return (
    <InstrumentContextProvider>
      <AppContent />
    </InstrumentContextProvider>
  );
}

export default App;
