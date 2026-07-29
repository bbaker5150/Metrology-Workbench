// src/components/Calibration/Calibration.js

import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import axios from "axios";
import {
  FaCalculator,
  FaCheck,
  FaDownload,
  FaTimes,
  FaSave,
  FaInfoCircle,
  FaUndo
} from "react-icons/fa";
import { LuSaveAll } from "react-icons/lu";
import { useInstruments } from "../../contexts/InstrumentContext";
import { useTheme } from "../../../../shared/ThemeContext";
import CalibrationChart from "./CalibrationChart";
import ConfigurationSummaryModal from "./ConfigurationSummaryModal";
import HarmonicProjectionInfoModal from "./HarmonicProjectionInfoModal";
import LiveStabilityTracker from "./LiveStabilityTracker";
import CycleStatisticsTracker from "./CycleStatisticsTracker";
import useCycleAnalytics from "../../hooks/useCycleAnalytics";
import { listAvailableCycles, resolveEffectiveCycle } from "../../utils/resolveEffectiveCycle";
import { resolveSessionNCycles } from "../../utils/resolveSessionNCycles";
import CalibrationStatusBar from "./CalibrationStatusBar";
import { downloadFullSessionExcel } from "./sessionExcelExport";
import {
  AVAILABLE_FREQUENCIES,
  AVAILABLE_CURRENTS,
  READING_TYPES,
  NPLC_OPTIONS,
  API_BASE_URL,
} from "../../constants/constants";

const overviewCardClass = (isEmpty, accent = false) =>
  [
    "cal-calc-kpi",
    "cal-results-overview-card",
    accent ? "cal-results-overview-card--accent" : "",
    isEmpty ? "cal-results-overview-card--empty" : "",
  ]
    .filter(Boolean)
    .join(" ");

const CorrectionFactorsModal = ({
  isOpen,
  onClose,
  onSubmit,
  initialValues,
  onInputChange,
  isReadOnly = false,
}) => {
  if (!isOpen) return null;

  const isFormValid = Object.values(initialValues).every(
    (val) => val !== "" && !isNaN(parseFloat(val))
  );

  return (
    <div className="modal-overlay">
      <div
        className="modal-content"
        style={{ maxWidth: "600px", textAlign: "left" }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid var(--border-color)",
            paddingBottom: "10px",
            marginBottom: "20px"
          }}
        >
          <h3 style={{ margin: 0 }}>Correction Factor Inputs</h3>
          <button
            onClick={onClose}
            className="modal-close-button"
            style={{ position: "static" }}
            title="Close"
          >
            <FaTimes />
          </button>
        </div>

        <p style={{ marginBottom: "20px" }}>
          Enter known correction factors. These will be applied to all completed
          directions.
        </p>

        <div className="modal-form-grid">
          <div className="form-group">
            <label htmlFor="eta_std">η Standard (Gain Factor)</label>
            <input
              type="number"
              step="any"
              id="eta_std"
              name="eta_std"
              value={initialValues.eta_std}
              onChange={onInputChange}
              disabled={isReadOnly}
              placeholder="e.g., 1.00012"
            />
          </div>
          <div className="form-group">
            <label htmlFor="eta_ti">η Test Instrument (Gain Factor)</label>
            <input
              type="number"
              step="any"
              id="eta_ti"
              name="eta_ti"
              value={initialValues.eta_ti}
              onChange={onInputChange}
              disabled={isReadOnly}
              placeholder="e.g., 0.99987"
            />
          </div>
          <div className="form-group">
            <label htmlFor="delta_std">δ Standard (TVC AC-DC Difference)</label>
            <input
              type="number"
              step="any"
              id="delta_std"
              name="delta_std"
              value={initialValues.delta_std}
              onChange={onInputChange}
              disabled={isReadOnly}
              placeholder="e.g., -1"
            />
          </div>
          <div className="form-group">
            <label htmlFor="delta_ti">
              δ Test Instrument (TVC AC-DC Difference)
            </label>
            <input
              type="number"
              step="any"
              id="delta_ti"
              name="delta_ti"
              value={initialValues.delta_ti}
              onChange={onInputChange}
              disabled={isReadOnly}
              placeholder="e.g., -2"
            />
          </div>
          <div className="form-group" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="delta_std_known">δ Standard (PPM)</label>
            <input
              type="number"
              step="any"
              id="delta_std_known"
              name="delta_std_known"
              value={initialValues.delta_std_known}
              onChange={onInputChange}
              disabled={isReadOnly}
              placeholder="e.g., 5.5"
            />
          </div>
        </div>

        <div className="form-section-action-icons" style={{ marginTop: "20px" }}>
          <button
            type="button"
            onClick={() => onSubmit(initialValues)}
            className="cal-results-excel-icon-btn"
            disabled={!isFormValid || isReadOnly}
            title={isReadOnly ? "View only (running or remote session)" : "Calculate & Save"}
          >
            <FaSave />
          </button>
        </div>
      </div>
    </div>
  );
};

const ConfirmationModal = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = "Confirm",
  confirmButtonClass = "",
  eyebrow,
}) => {
  if (!isOpen) return null;
  const isDanger = /danger/.test(confirmButtonClass);
  const eyebrowText = eyebrow ?? (isDanger ? "Warning" : "Confirm");
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calibration-confirm-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="confirm-modal-header">
          <div className="confirm-modal-header-text">
            <span className="confirm-modal-eyebrow">{eyebrowText}</span>
            <h3
              id="calibration-confirm-modal-title"
              className="confirm-modal-title"
            >
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="cal-results-excel-icon-btn"
            title="Cancel"
            aria-label="Cancel"
          >
            <FaTimes aria-hidden />
          </button>
        </header>
        <div className="confirm-modal-body">
          <p className="confirm-modal-message">{message}</p>
        </div>
        <footer className="confirm-modal-footer confirm-modal-footer--icon">
          <button
            type="button"
            onClick={onConfirm}
            className={`cal-results-excel-icon-btn${isDanger ? " cal-results-excel-icon-btn--danger" : ""
              }`}
            title={confirmText}
            aria-label={confirmText}
          >
            <FaCheck aria-hidden />
          </button>
        </footer>
      </div>
    </div>
  );
};

const SubNav = ({ activeTab, setActiveTab }) => (
  <div className="sub-nav">
    <button
      onClick={() => setActiveTab("settings")}
      className={activeTab === "settings" ? "active" : ""}
    >
      Settings
    </button>
    <button
      onClick={() => setActiveTab("readings")}
      className={activeTab === "readings" ? "active" : ""}
    >
      Readings
    </button>
    <button
      onClick={() => setActiveTab("calculate")}
      className={activeTab === "calculate" ? "active" : ""}
    >
      Calculations
    </button>
  </div>
);

// DirectionToggle component definition removed

// Remembers the last sub-tab the user was viewing in the Calibration pane
// (Settings / Readings / Calculations) so that navigating away to another
// main tab and coming back restores their place. Module scope keeps it
// alive across unmount/remount for the app session without any persistence.
let rememberedCalSubTab = "settings";

// Readings sub-tab: stacked vs. side-by-side chart layout (session only).
let rememberedReadingsChartLayout = "stacked";

const LINE_FREQUENCY_HZ = 60;
const CYCLE_CLEAN_TOLERANCE = 1e-6;

const distanceToInteger = (value) => {
  if (!Number.isFinite(value)) return Infinity;
  const nearest = Math.round(value);
  return Math.abs(value - nearest);
};

const formatCycleCount = (value) => {
  if (!Number.isFinite(value)) return "---";
  if (Math.abs(value - Math.round(value)) < 0.001) {
    return `${Math.round(value)}`;
  }
  return value.toFixed(3);
};

const DEFAULT_CALIBRATION_SETTINGS = {
  initial_warm_up_time: 0,
  num_samples: 6,
  settling_time: 45,
  input_switch_settling_time: 1,
  direct_source_test_mode: false,
  direct_source_voltage: 2,
  nplc: 100,
  stability_check_method: 'sliding_window',
  stability_window: 6,
  stability_threshold_ppm: 25,
  stability_max_attempts: 100,
  iqr_filter_ppm_threshold: 15,
  ignore_instability_after_lock: true,
  characterize_test_first: false,
  characterize_std_first: false,
  enable_low_frequency_settings: false,
  enable_11hz_filter: false,
  min_low_freq_settling_time: 0,
  lf_harmonic_projection: false,
  lf_harmonics: 2,
  n_cycles: 15,
};

// Valid bounds for the numeric calibration-settings fields. The inputs store
// the raw typed string while the user edits; these drive an on-blur clamp so a
// value can never be committed out of range (negative, zero where a positive
// is required, below the minimum, or blank). ``int`` rounds to a whole number,
// ``minExclusive`` rejects the boundary itself (a 0 ppm threshold is never
// achievable), and ``fallback`` is substituted when the field is left blank or
// unparseable so a run never starts from an empty/NaN value.
const SETTINGS_FIELD_BOUNDS = {
  initial_warm_up_time: { min: 0, int: true, fallback: 0 },
  num_samples: { min: 2, int: true, fallback: 2 },
  settling_time: { min: 0, int: false, fallback: 0 },
  input_switch_settling_time: { min: 0, max: 65_000, int: false, fallback: 1 },
  direct_source_voltage: { min: 0, minExclusive: true, max: 1000, int: false, fallback: 2 },
  n_cycles: { min: 2, int: true, fallback: 2 },
  stability_window: { min: 2, int: true, fallback: 2 }, // upper bound (num_samples) passed in per-call
  stability_threshold_ppm: { min: 0, minExclusive: true, int: false, fallback: 10 },
  stability_max_attempts: { min: 1, int: true, fallback: 1 },
  iqr_filter_ppm_threshold: { min: 0, minExclusive: true, int: false, fallback: 15 },
};

const clampSettingField = (name, rawValue, max = null) => {
  const bounds = SETTINGS_FIELD_BOUNDS[name];
  if (!bounds) return rawValue;

  let n = parseFloat(rawValue);
  if (!Number.isFinite(n)) return bounds.fallback;
  if (bounds.int) n = Math.round(n);

  if (bounds.min != null) {
    if (bounds.minExclusive && n <= bounds.min) {
      // A zero/negative value is invalid for these fields — fall back to the
      // default rather than silently snapping to a near-zero boundary.
      n = bounds.fallback;
    } else if (n < bounds.min) {
      n = bounds.min;
    }
  }

  const upper = max != null ? max : bounds.max;
  if (upper != null && n > upper) n = upper;

  return n;
};

function Calibration({
  showNotification,
  orderedTestPoints,
  sharedFocusedTestPoint: focusedTP,
  setSharedFocusedTestPoint: setFocusedTP,
  sharedSelectedTPs: selectedTPs,
  onDataUpdate,
  activeDirection,
  onOpenResultsDirection,
  isRemoteViewer,
}) {
  const {
    selectedSessionId,
    selectedSessionName,
    liveReadings,
    tiLiveReadings,
    initialLiveReadings,
    discoveredInstruments,
    stdInstrumentAddress,
    stdReaderModel,
    stdReaderSN,
    tiInstrumentAddress,
    tiReaderModel,
    tiReaderSN,
    acSourceAddress,
    acSourceSN,
    dcSourceAddress,
    dcSourceSN,
    isCollecting,
    collectionProgress,
    startReadingCollection,
    stopReadingCollection,
    activeCollectionDetails,
    readingWsState,
    collectionStatus,
    switchDriverAddress,
    switchDriverSN,
    clearLiveReadings,
    amplifierAddress,
    lastMessage,
    sendWsCommand,
    pairedRun,
    stabilizationStatus,
    slidingWindowStatus,
    timerState,
    bulkRunProgress: bulkRunProgressFromContext,
    focusedTPKey,
    dataRefreshTrigger,
    setFailedTPKeys,
    hostSessionKnown,
  } = useInstruments();
  const { theme } = useTheme();
  const normalizedReaderModels = [stdReaderModel, tiReaderModel]
    .filter(Boolean)
    .map((model) => String(model).toUpperCase());
  const has34420Reader = normalizedReaderModels.some((model) =>
    model.includes("34420")
  );
  const has8508Reader = normalizedReaderModels.some((model) =>
    model.includes("8508")
  );

  const [activeTab, setActiveTabState] = useState(rememberedCalSubTab);
  const setActiveTab = useCallback((value) => {
    rememberedCalSubTab = value;
    setActiveTabState(value);
  }, []);
  const [calibrationConfigurations, setCalibrationConfigurations] = useState(
    {}
  );
  const [calibrationSettings, setCalibrationSettings] = useState({
    initial_warm_up_time: 0,
    num_samples: 35,
    settling_time: 120,
    input_switch_settling_time: 1,
    direct_source_test_mode: false,
    direct_source_voltage: 2,
    nplc: 20,
    stability_check_method: 'sliding_window',
    stability_window: 30,
    stability_threshold_ppm: 10,
    stability_max_attempts: 10,
    iqr_filter_ppm_threshold: 15,
    ignore_instability_after_lock: true,
    characterize_test_first: false,
    characterize_std_first: false,
    characterization_source: "DC",
    enable_low_frequency_settings: false,
    enable_11hz_filter: false,
    min_low_freq_settling_time: 0,
    lf_harmonic_projection: false,
    lf_harmonics: 2,
    n_cycles: 3,
  });
  const [correctionInputs, setCorrectionInputs] = useState({
    eta_std: "",
    eta_ti: "",
    delta_std: "",
    delta_ti: "",
    delta_std_known: "",
  });
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  // activeDirection state removed
  const [lastCollectionDirection, setLastCollectionDirection] = useState(null);
  const [confirmationModal, setConfirmationModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => { },
  });
  const [amplifierModal, setAmplifierModal] = useState({
    isOpen: false,
    range: null,
    onConfirm: () => { },
  });
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const collectionPromise = useRef(null);
  const lastAutoFocusedKey = useRef(null);
  const [isCorrectionModalOpen, setIsCorrectionModalOpen] = useState(false);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [isHarmonicInfoOpen, setIsHarmonicInfoOpen] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timerInterval = useRef(null);
  const [isCalculatingAverages, setIsCalculatingAverages] = useState(false);
  const prevIsBulkRunning = useRef(isBulkRunning);
  const [activeChartView, setActiveChartView] = useState("calibration");
  const [readingsChartLayout, setReadingsChartLayoutState] = useState(
    rememberedReadingsChartLayout
  );
  // Pair analytics state (ABBA, outlier filter, manual exclusions) lives
  // on the backend now; this hook is the single source of truth shared
  // with CycleStatisticsTracker and CalibrationResults.
  const cycleAnalytics = useCycleAnalytics({
    focusedTestPoint: focusedTP,
    sessionId: selectedSessionId,
    onDataUpdate,
    defaultUseAbba: calibrationConfigurations?.use_abba_pairing !== false,
  });
  const useAbba = cycleAnalytics.useAbba;
  const setUseAbba = cycleAnalytics.setUseAbba;

  // Cycle picker is lifted out of CalibrationChart so the paired
  // LiveStabilityTracker can mirror whatever cycle the chart is showing.
  // `null` = auto (latest available). One state per instrument since each
  // chart has its own picker.
  const [stdChartCycle, setStdChartCycle] = useState(null);
  const [tiChartCycle, setTiChartCycle] = useState(null);
  // Reset both pickers to "auto" when the operator focuses a different
  // test point, so the new TP lands on its latest cycle instead of
  // inheriting a stale pin.
  useEffect(() => {
    setStdChartCycle(null);
    setTiChartCycle(null);
  }, [focusedTP?.forward?.id, focusedTP?.reverse?.id]);
  const setReadingsChartLayout = useCallback((value) => {
    rememberedReadingsChartLayout = value;
    setReadingsChartLayoutState(value);
  }, []);

  const uniqueTestPoints = useMemo(
    () => orderedTestPoints,
    [orderedTestPoints]
  );

  const handleExportSessionExcel = useCallback(async () => {
    const r = await downloadFullSessionExcel({
      uniqueTestPoints,
      sessionName: selectedSessionName,
      sessionId: selectedSessionId,
    });
    if (!r.ok) {
      showNotification(r.error, "warning");
    } else {
      showNotification("Workbook downloaded.", "success");
    }
  }, [
    uniqueTestPoints,
    selectedSessionName,
    selectedSessionId,
    showNotification,
  ]);

  const livePpm = useMemo(() => {
    if (!isCollecting || !activeCollectionDetails?.stage) return null;
    const currentReadings = liveReadings[activeCollectionDetails.stage];
    if (!currentReadings || currentReadings.length < 2) return null;

    // 1. Enforce the sliding window
    const windowSize = calibrationSettings.stability_window || 30;
    const values = currentReadings.slice(-windowSize).map((p) => p.y);

    if (values.length < 2) return null;

    // 2. Use Welford's Algorithm for high-precision variance
    let mean = 0;
    let M2 = 0;
    values.forEach((val, index) => {
      const delta = val - mean;
      mean += delta / (index + 1);
      M2 += delta * (val - mean);
    });

    const variance = M2 / (values.length - 1);
    const stdDev = Math.sqrt(variance);
    const ppm = (stdDev / Math.abs(mean)) * 1e6;

    return ppm;
  }, [liveReadings, isCollecting, activeCollectionDetails, calibrationSettings.stability_window]);

  const latestStdReading = useMemo(() => {
    if (!isCollecting || !activeCollectionDetails?.stage) return null;
    const stageReadings = liveReadings[activeCollectionDetails.stage];
    if (!stageReadings || stageReadings.length === 0) return null;
    return stageReadings[stageReadings.length - 1];
  }, [liveReadings, isCollecting, activeCollectionDetails]);

  const latestTiReading = useMemo(() => {
    if (!isCollecting || !activeCollectionDetails?.stage) return null;
    const stageReadings = tiLiveReadings[activeCollectionDetails.stage];
    if (!stageReadings || stageReadings.length === 0) return null;
    return stageReadings[stageReadings.length - 1];
  }, [tiLiveReadings, isCollecting, activeCollectionDetails]);

  useEffect(() => {
    if (timerInterval.current) {
      clearInterval(timerInterval.current);
    }

    if (timerState.isActive && timerState.targetTime) {

      // Define the calculation logic
      const updateTimer = () => {
        const now = Date.now();
        const remainingMs = timerState.targetTime - now;
        const remainingSec = Math.ceil(remainingMs / 1000);

        if (remainingSec <= 0) {
          setCountdown(0);
          clearInterval(timerInterval.current);
        } else {
          setCountdown(remainingSec);
        }
      };

      // Run once immediately so we don't see a flash of '0s' or old time
      updateTimer();

      // Start the interval
      timerInterval.current = setInterval(updateTimer, 500); // Check every 500ms for smoother updates
    } else {
      setCountdown(0);
    }

    return () => {
      if (timerInterval.current) {
        clearInterval(timerInterval.current);
      }
    };
  }, [timerState.isActive, timerState.targetTime]);

  useEffect(() => {
    if (focusedTPKey && focusedTPKey !== lastAutoFocusedKey.current) {
      const pointToFocus = uniqueTestPoints.find((p) => p.key === focusedTPKey);
      if (pointToFocus) {
        setFocusedTP(pointToFocus);
        lastAutoFocusedKey.current = focusedTPKey;
      }
    }
  }, [focusedTPKey, uniqueTestPoints, setFocusedTP]);

  useEffect(() => {
    if (
      collectionStatus === "collection_finished" ||
      collectionStatus === "collection_stopped"
    ) {
      if (collectionPromise.current) {
        collectionPromise.current.resolve(collectionStatus);
        collectionPromise.current = null;
      }
    } else if (collectionStatus === "error") {
      if (collectionPromise.current) {
        collectionPromise.current.reject(
          new Error("Collection failed with an error.")
        );
        collectionPromise.current = null;
      }
    }
  }, [collectionStatus]);

  // useEffect(() => {
  //   if (lastMessage?.type === "warning") {
  //     showNotification(lastMessage.message, "warning");
  //   }
  // }, [lastMessage, showNotification]);

  const waitForCollection = () => {
    return new Promise((resolve, reject) => {
      collectionPromise.current = { resolve, reject };
    });
  };

  useEffect(() => {
    // Never surface operator-confirmation prompts on a remote viewer — they
    // can't act on them and the backend rejects amplifier_confirmed /
    // operation_cancelled from remote sockets anyway (Phase 3 role gate).
    // The host window is the only surface that should prompt.
    //
    // NOTE: we use a functional updater for the remote-side close so this
    // effect does NOT need ``amplifierModal.isOpen`` in its dep array —
    // including it made the effect re-run every time we opened the modal
    // on the host, which contributed to "Maximum update depth" cascades.
    if (isRemoteViewer) {
      setAmplifierModal((prev) => (prev.isOpen ? { isOpen: false } : prev));
      return;
    }
    if (lastMessage?.type === "awaiting_amplifier_confirmation") {
      const range = lastMessage.range;
      setAmplifierModal({
        isOpen: true,
        range: range,
        onConfirm: () => {
          sendWsCommand({ command: "amplifier_confirmed" });
          setAmplifierModal({ isOpen: false });
        },
        onCancel: () => {
          sendWsCommand({ command: "operation_cancelled" });
          setAmplifierModal({ isOpen: false });
        },
      });
    }
  }, [lastMessage, sendWsCommand, isRemoteViewer]);

  // const prevCollectionStatusRef = useRef(collectionStatus);
  // useEffect(() => {
  //   const prevStatus = prevCollectionStatusRef.current;
  //   const isNewStopEvent =
  //     collectionStatus === "collection_stopped" &&
  //     prevStatus !== "collection_stopped";

  //   if (isNewStopEvent) {
  //     showNotification("Reading collection stopped by user.", "warning");
  //   }

  //   prevCollectionStatusRef.current = collectionStatus;
  // }, [collectionStatus, showNotification]);

  useEffect(() => {
    if (!lastMessage) return;

    // Show warnings as UI notifications
    if (lastMessage.type === "warning") {
      showNotification(lastMessage.message, "warning");
    }

    // The flagging logic was moved to InstrumentContext.js!
  }, [lastMessage, showNotification]);

  const getInstrumentIdentityByAddress = (address, serial, model) => {
    if (!address) {
      return "Not Assigned";
    }
    if (model) {
      if (serial) {
        return `${model}, S/N ${serial} (${address})`;
      }
      return `${model} (${address})`;
    }
    const instrument = discoveredInstruments.find(
      (inst) => inst.address === address
    );
    if (instrument) {
      return `${instrument.identity} (${instrument.address})`;
    }
    return address;
  };

  const refreshComponentData = useCallback(async () => {
    if (!selectedSessionId) return;
    try {
      const infoResponse = await axios.get(
        `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/information/`
      );
      setCalibrationConfigurations(infoResponse.data.configurations || {});
    } catch (error) {
      showNotification(
        "Could not refresh calibration configurations.",
        "error"
      );
    }
  }, [selectedSessionId, showNotification]);

  // ABBA toggle lives session-wide in CalibrationConfigurations. The PUT
  // mirrors how ConfigurationModal saves the shunt range; we keep the
  // other configuration fields intact and only flip use_abba_pairing.
  const handleSetAbbaPairing = useCallback(async (nextValue) => {
    if (!selectedSessionId) return;
    // Optimistically reflect the toggle so the UI doesn't lag the click.
    setCalibrationConfigurations((prev) => ({ ...prev, use_abba_pairing: nextValue }));
    try {
      await axios.put(
        `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/information/`,
        {
          configurations: {
            ac_shunt_range: calibrationConfigurations.ac_shunt_range ?? null,
            amplifier_range: calibrationConfigurations.amplifier_range ?? null,
            use_abba_pairing: nextValue,
          },
        }
      );
      if (onDataUpdate) onDataUpdate();
    } catch (err) {
      // Roll back the optimistic update on failure.
      setCalibrationConfigurations((prev) => ({
        ...prev,
        use_abba_pairing: !nextValue,
      }));
      showNotification(
        `Could not update pairing mode: ${err.message || "unknown error"}`,
        "error"
      );
    }
  }, [
    selectedSessionId,
    calibrationConfigurations.ac_shunt_range,
    calibrationConfigurations.amplifier_range,
    onDataUpdate,
    showNotification,
  ]);

  useEffect(() => {
    // The master refresh function
    const handleWakeUp = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        console.log("System wake/focus detected. Refreshing data...");

        // Small delay to allow network stack to stabilize
        setTimeout(() => {
          refreshComponentData();
          if (onDataUpdate) onDataUpdate();
        }, 1000);
      }
    };

    // --- EVENT LISTENERS ---
    document.addEventListener("visibilitychange", handleWakeUp);
    window.addEventListener("focus", handleWakeUp);
    window.addEventListener("pageshow", handleWakeUp); // Handle bfcache
    window.addEventListener("online", handleWakeUp);   // Handle network recovery

    // --- HEARTBEAT CHECK (FAILSAFE) ---
    // Checks for "time jumps" indicating the CPU was suspended
    const HEARTBEAT_INTERVAL = 2000; // Check every 2 seconds
    const SLEEP_THRESHOLD = 5000;    // If >5 seconds passed, we slept
    let lastTick = Date.now();

    const heartbeat = setInterval(() => {
      const now = Date.now();
      const delta = now - lastTick;

      if (delta > SLEEP_THRESHOLD) {
        console.log(`Sleep detected (Time drift: ${delta}ms). Triggering wake-up...`);
        handleWakeUp();
      }

      lastTick = now;
    }, HEARTBEAT_INTERVAL);

    // Cleanup
    return () => {
      document.removeEventListener("visibilitychange", handleWakeUp);
      window.removeEventListener("focus", handleWakeUp);
      window.removeEventListener("pageshow", handleWakeUp);
      window.removeEventListener("online", handleWakeUp);
      clearInterval(heartbeat);
    };
  }, [refreshComponentData, onDataUpdate]);

  useEffect(() => {
    if (dataRefreshTrigger > 0) {
      console.log("WebSocket sync received. Refreshing data...");
      refreshComponentData();
      if (onDataUpdate) {
        onDataUpdate();
      }
    }
  }, [dataRefreshTrigger, refreshComponentData, onDataUpdate]);

  const handleMarkStability = useCallback(async (stabilityData, instrumentType) => {
    if (isRemoteViewer) return;
    if (!focusedTP || !selectedSessionId) {
      showNotification("No focused test point selected.", "error");
      return;
    }

    const pointForDirection = activeDirection === "Forward"
      ? focusedTP.forward
      : focusedTP.reverse;

    if (!pointForDirection || !pointForDirection.id) {
      showNotification("No valid test point created for this direction.", "error");
      return;
    }

    const prefix = instrumentType === "std" ? "std_" : "ti_";
    const readingType = READING_TYPES.find(rt => rt.label === stabilityData.type);

    if (!readingType) {
      showNotification("Invalid reading type selected.", "error");
      return;
    }

    const reading_key = `${prefix}${readingType.key}_readings`;

    const payload = {
      reading_key: reading_key,
      start_index: parseInt(stabilityData.start, 10),
      end_index: parseInt(stabilityData.end, 10),
      is_stable: stabilityData.mark_as === 'stable'
    };

    try {
      await axios.post(
        `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/${pointForDirection.id}/mark-readings-stability/`,
        payload
      );
      showNotification(`Readings ${payload.start_index}-${payload.end_index} marked as ${stabilityData.mark_as}. Averages recalculated.`, "success");

      setFailedTPKeys((prev) => {
        const newSet = new Set(prev);
        newSet.delete(focusedTP.key);
        return newSet;
      });

      await onDataUpdate();
    } catch (error) {
      const errorMsg = error.response?.data?.detail || "Failed to update reading stability.";
      showNotification(errorMsg, "error");
      console.error(error);
    }
  }, [focusedTP, selectedSessionId, activeDirection, onDataUpdate, showNotification, setFailedTPKeys, isRemoteViewer]);

  const parseStabilizationStatus = useCallback(
    (statusString) => {
      if (!statusString) return null;
      // Matches "Stdev: 5.20 PPM [2/50]" format from backend
      const ppmMatch = statusString.match(/Stdev: ([\d.]+|Calculating...) PPM/);
      const countMatch = statusString.match(/\[(\d+)\/(\d+)\]/);

      const ppm = ppmMatch && ppmMatch[1] !== "Calculating..."
        ? parseFloat(ppmMatch[1])
        : null;
      const count = countMatch ? `${countMatch[1]}/${countMatch[2]}` : "";

      return { ppm, count };
    },
    []
  );

  // This call resolves the ESLint warning and provides data to the status bar
  const stabilizationInfo = useMemo(
    () => parseStabilizationStatus(stabilizationStatus),
    [stabilizationStatus, parseStabilizationStatus]
  );

  const hasAllReadings = useCallback((point) => {
    if (!point?.readings) return false;
    return [
      "std_ac_open_readings",
      "std_dc_pos_readings",
      "std_dc_neg_readings",
      "std_ac_close_readings",
      "ti_ac_open_readings",
      "ti_dc_pos_readings",
      "ti_dc_neg_readings",
      "ti_ac_close_readings",
    ].every((k) => point.readings[k]?.length > 0);
  }, []);

  // Check if a point has ANY readings at all
  const hasSomeReadings = useCallback((point) => {
    if (!point?.readings) return false;
    return [
      "std_ac_open_readings",
      "std_dc_pos_readings",
      "std_dc_neg_readings",
      "std_ac_close_readings",
      "ti_ac_open_readings",
      "ti_dc_pos_readings",
      "ti_dc_neg_readings",
      "ti_ac_close_readings",
    ].some((k) => point.readings[k]?.length > 0);
  }, []);

  // Determine if it was started but abandoned
  const isPartial = useCallback((point) => {
    return hasSomeReadings(point) && !hasAllReadings(point);
  }, [hasSomeReadings, hasAllReadings]);

  // Hoist formatters so they can be used in the warning locks
  const formatFrequency = useCallback((value) => {
    return (
      AVAILABLE_FREQUENCIES.find((f) => f.value === value) || {
        text: `${value}Hz`,
      }
    ).text;
  }, []);

  const formatCurrent = useCallback((value) => {
    const numValue = parseFloat(value);
    const epsilon = 1e-9;
    const found = AVAILABLE_CURRENTS.find(
      (c) => Math.abs(c.value - numValue) < epsilon
    );
    return found ? found.text : `${numValue}`;
  }, []);

  const samplingAdvisor = useMemo(() => {
    // This advisor describes coherent TVC-output sampling in units of NPLC.
    // The 8508A direct-reading path is timed by RESL/filter/terminal switching
    // instead, so presenting this guidance there would be misleading.
    if (!has34420Reader) return null;

    const frequency = parseFloat(focusedTP?.frequency);
    const nplc = parseFloat(calibrationSettings.nplc);
    const samples = parseInt(calibrationSettings.num_samples, 10);

    if (
      !Number.isFinite(frequency) ||
      frequency <= 0 ||
      !Number.isFinite(nplc) ||
      nplc <= 0 ||
      !Number.isFinite(samples) ||
      samples < 2
    ) {
      return null;
    }

    const perSampleSeconds = nplc / LINE_FREQUENCY_HZ;
    const sourceCyclesPerSample = frequency * perSampleSeconds;
    const totalSeconds = samples * perSampleSeconds;
    const sourceCycles = samples * sourceCyclesPerSample;
    const rippleCycles = sourceCycles * 2;
    const sourceError = distanceToInteger(sourceCycles);
    const rippleError = distanceToInteger(rippleCycles);
    const isClean = sourceError <= CYCLE_CLEAN_TOLERANCE;
    const currentScore = Math.max(sourceError, rippleError / 2);

    const candidates = [];
    const maxSamples = Math.max(240, samples + 80);
    for (let count = 2; count <= maxSamples; count += 1) {
      const candidateSourceCycles = count * sourceCyclesPerSample;
      const candidateRippleCycles = candidateSourceCycles * 2;
      const candidateSourceError = distanceToInteger(candidateSourceCycles);
      const candidateRippleError = distanceToInteger(candidateRippleCycles);
      const score = Math.max(candidateSourceError, candidateRippleError / 2);
      candidates.push({
        count,
        totalSeconds: count * perSampleSeconds,
        sourceCycles: candidateSourceCycles,
        rippleCycles: candidateRippleCycles,
        sourceError: candidateSourceError,
        score,
        isClean: candidateSourceError <= CYCLE_CLEAN_TOLERANCE,
      });
    }

    const cleanCandidates = candidates
      .filter((candidate) => candidate.count !== samples && candidate.isClean)
      .sort((a, b) => {
        const distanceA = Math.abs(a.count - samples);
        const distanceB = Math.abs(b.count - samples);
        if (distanceA !== distanceB) return distanceA - distanceB;
        return a.count - b.count;
      });

    const bestNearby = cleanCandidates[0] || candidates
      .filter((candidate) => candidate.count !== samples && candidate.score < currentScore)
      .sort((a, b) => {
        if (Math.abs(a.score - b.score) > 1e-9) return a.score - b.score;
        return Math.abs(a.count - samples) - Math.abs(b.count - samples);
      })[0];

    const nearbyCleanCounts = cleanCandidates
      .filter((candidate) => Math.abs(candidate.count - samples) <= 24)
      .slice(0, 4)
      .map((candidate) => candidate.count);

    return {
      samples,
      frequency,
      nplc,
      perSampleSeconds,
      totalSeconds,
      sourceCycles,
      rippleCycles,
      isClean,
      sourceError,
      recommended: bestNearby || null,
      nearbyCleanCounts,
    };
  }, [focusedTP?.frequency, calibrationSettings.nplc, calibrationSettings.num_samples, has34420Reader]);

  const applyRecommendedSampleCount = useCallback((count) => {
    setCalibrationSettings((prev) => ({
      ...prev,
      num_samples: count,
      stability_window:
        parseInt(prev.stability_window, 10) > count
          ? count
          : prev.stability_window,
    }));
  }, []);

  // Clamp a numeric settings field to its valid range when the user leaves it.
  // Editing stays unrestricted (raw onChange), but blur guarantees the stored
  // value is in-range, an integer where required, and never blank/NaN. Pass a
  // dynamic ``max`` for fields whose ceiling depends on other settings (e.g.
  // stability_window can't exceed num_samples).
  const handleSettingBlur = useCallback(
    (name, max = null) =>
      (e) => {
        const clamped = clampSettingField(name, e.target.value, max);
        setCalibrationSettings((prev) =>
          prev[name] === clamped ? prev : { ...prev, [name]: clamped }
        );
      },
    []
  );

  useEffect(() => {
    prevIsBulkRunning.current = isBulkRunning;
  }, [isBulkRunning]);

  useEffect(() => {
    const wasBulkRunning = prevIsBulkRunning.current;
    if (wasBulkRunning && !isBulkRunning) {
      const processCompletedPoints = async () => {
        console.log(
          "Post-batch processing triggered: searching for points needing average calculation."
        );
        const averagePromises = [];
        uniqueTestPoints.forEach((point) => {
          const checkAndQueueAvgCalc = (directionData) => {
            if (!directionData || !directionData.id) return;
            const readingsAreComplete = hasAllReadings(directionData);
            const averagesAreMissing =
              !directionData.results ||
              directionData.results.std_ac_open_avg === null;
            if (readingsAreComplete && averagesAreMissing) {
              console.log(
                `Queueing average calculation for Test Point ID: ${directionData.id}`
              );
              averagePromises.push(
                axios.post(
                  `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/${directionData.id}/calculate-averages/`
                )
              );
            }
          };
          checkAndQueueAvgCalc(point.forward);
          checkAndQueueAvgCalc(point.reverse);
        });
        if (averagePromises.length > 0) {
          showNotification(
            `Found ${averagePromises.length} new reading set(s). Calculating averages...`,
            "info"
          );
          try {
            await Promise.all(averagePromises);
            console.log("All average calculation requests sent successfully.");
            onDataUpdate();
          } catch (error) {
            showNotification(
              "An error occurred during the batch average calculation.",
              "error"
            );
            console.error("Batch average calculation failed:", error);
          }
        } else {
          console.log("No new points required average calculation.");
        }
      };
      setTimeout(processCompletedPoints, 200);
    }
  }, [
    uniqueTestPoints,
    isBulkRunning,
    selectedSessionId,
    hasAllReadings,
    onDataUpdate,
    showNotification,
  ]);

  useEffect(() => {
    if (!focusedTP || !selectedSessionId) return;
    const triggerAverageCalculationIfNeeded = async (pointDirection) => {
      if (!pointDirection || !pointDirection.id) return;
      const readingsAreComplete = hasAllReadings(pointDirection);
      const averagesAreMissing =
        !pointDirection.results ||
        pointDirection.results.std_ac_open_avg === null;
      if (readingsAreComplete && averagesAreMissing && !isCalculatingAverages) {
        try {
          setIsCalculatingAverages(true);
          await axios.post(
            `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/${pointDirection.id}/calculate-averages/`
          );
          await onDataUpdate();
        } catch (error) {
          showNotification(
            `Failed to trigger average calculation for ${pointDirection.direction}.`,
            "error"
          );
        } finally {
          setIsCalculatingAverages(false);
        }
      }
    };
    triggerAverageCalculationIfNeeded(focusedTP.forward);
    triggerAverageCalculationIfNeeded(focusedTP.reverse);
  }, [
    focusedTP,
    selectedSessionId,
    hasAllReadings,
    onDataUpdate,
    showNotification,
    isCalculatingAverages
  ]);

  // Pure derivations from focusedTP + active direction. These used to live
  // in React state populated by a post-mount useEffect, which caused a
  // visible flicker when toggling between test points — the first paint
  // rendered stale readings / KPI from the previous focus before the
  // effect reconciled them. useMemo makes the first render after a
  // focusedTP change already correct.
  const { historicalReadings, tiHistoricalReadings } = useMemo(() => {
    const formatReadingsForChart = (readingsArray) => {
      if (!readingsArray) return [];
      return readingsArray.map((point, index) => {
        if (typeof point !== "object" || point === null) {
          return { x: index + 1, y: point, t: null, is_stable: true };
        }
        return {
          ...point,
          x: index + 1,
          y: point.value,
          t: point.timestamp ? new Date(point.timestamp * 1000) : null,
        };
      });
    };

    const currentFocusedTP = focusedTP
      ? orderedTestPoints.find((p) => p.key === focusedTP.key)
      : null;
    const pointForDirection = currentFocusedTP
      ? activeDirection === "Forward"
        ? currentFocusedTP.forward
        : currentFocusedTP.reverse
      : null;

    if (!pointForDirection?.readings) {
      return {
        historicalReadings: initialLiveReadings,
        tiHistoricalReadings: initialLiveReadings,
      };
    }

    const r = pointForDirection.readings;
    return {
      historicalReadings: {
        char_plus1: formatReadingsForChart(r.std_char_plus1_readings),
        char_minus: formatReadingsForChart(r.std_char_minus_readings),
        char_plus2: formatReadingsForChart(r.std_char_plus2_readings),
        ac_open: formatReadingsForChart(r.std_ac_open_readings),
        dc_pos: formatReadingsForChart(r.std_dc_pos_readings),
        dc_neg: formatReadingsForChart(r.std_dc_neg_readings),
        ac_close: formatReadingsForChart(r.std_ac_close_readings),
      },
      tiHistoricalReadings: {
        char_plus1: formatReadingsForChart(r.ti_char_plus1_readings),
        char_minus: formatReadingsForChart(r.ti_char_minus_readings),
        char_plus2: formatReadingsForChart(r.ti_char_plus2_readings),
        ac_open: formatReadingsForChart(r.ti_ac_open_readings),
        dc_pos: formatReadingsForChart(r.ti_dc_pos_readings),
        dc_neg: formatReadingsForChart(r.ti_dc_neg_readings),
        ac_close: formatReadingsForChart(r.ti_ac_close_readings),
      },
    };
  }, [focusedTP, activeDirection, orderedTestPoints, initialLiveReadings]);

  const averagedPpmDifference = useMemo(() => {
    if (!focusedTP) return null;
    const fwdCycles = focusedTP.forward?.results?.cycles || [];
    const revCycles = focusedTP.reverse?.results?.cycles || [];
    // Cap to the source-of-truth cycle count so the average uses only the
    // configured N cycles even if a direction physically collected more
    // (mirrors the backend pair-analytics cap).
    const cap = resolveSessionNCycles(orderedTestPoints, null);
    const n = Math.min(
      fwdCycles.length,
      revCycles.length,
      cap != null ? cap : Infinity
    );

    if (n > 0) {
      let sum = 0;
      let validPairs = 0;
      for (let i = 0; i < n; i++) {
        const f = parseFloat(fwdCycles[i]?.delta_uut_ppm);
        const r = parseFloat(useAbba ? revCycles[n - 1 - i]?.delta_uut_ppm : revCycles[i]?.delta_uut_ppm);
        if (Number.isFinite(f) && Number.isFinite(r)) {
          sum += (f + r) / 2;
          validPairs++;
        }
      }
      return validPairs > 0 ? (sum / validPairs).toFixed(3) : null;
    }

    // Legacy pre-cycle fallback
    const forwardResult = focusedTP.forward?.results?.delta_uut_ppm;
    const reverseResult = focusedTP.reverse?.results?.delta_uut_ppm;
    if (forwardResult == null || reverseResult == null) return null;
    return ((parseFloat(forwardResult) + parseFloat(reverseResult)) / 2).toFixed(3);
  }, [focusedTP, useAbba, orderedTestPoints]);

  // Settings are user-editable (sliders, number inputs) so they have to
  // live in state. Use useLayoutEffect for the per-test-point reset so the
  // update lands before the browser paints — avoids the "stale settings
  // flash" when toggling between test points.
  useLayoutEffect(() => {
    const currentFocusedTP = focusedTP
      ? orderedTestPoints.find((p) => p.key === focusedTP.key)
      : null;
    if (!currentFocusedTP) return;

    const isFirstTestPoint =
      orderedTestPoints.length > 0 &&
      currentFocusedTP.key === orderedTestPoints[0].key;

    const defaultSettings = {
      ...DEFAULT_CALIBRATION_SETTINGS,
      initial_warm_up_time: isFirstTestPoint ? 1800 : 0,
      num_samples: 6,
      settling_time: 45,
      nplc: 100,
      stability_check_method: 'sliding_window',
      stability_window: 6,
      stability_threshold_ppm: 25,
      stability_max_attempts: 100,
      iqr_filter_ppm_threshold: 15,
      ignore_instability_after_lock: true,
      characterize_test_first: false,
      characterize_std_first: false,
      enable_low_frequency_settings: false,
      enable_11hz_filter: false,
      min_low_freq_settling_time: 0,
      lf_harmonic_projection: false,
      lf_harmonics: 2,
      n_cycles: 15,
    };

    const pointForDirection =
      activeDirection === "Forward"
        ? currentFocusedTP.forward
        : currentFocusedTP.reverse;

    // n_cycles is a single source of truth shared across both directions.
    // Whatever value was set first (Forward or Reverse) wins; only when no
    // direction anywhere in the session has a value do we fall back to the
    // default. This stops a direction that hasn't been saved yet from
    // displaying — and later persisting — the hardcoded default, which would
    // make already-complete points look like they have missing cycles.
    const sessionNCycles = resolveSessionNCycles(orderedTestPoints, null);

    if (pointForDirection?.settings && Object.keys(pointForDirection.settings).length > 0) {
      const loaded = { ...defaultSettings, ...pointForDirection.settings };
      if (sessionNCycles != null) loaded.n_cycles = sessionNCycles;
      setCalibrationSettings(loaded);
    } else {
      setCalibrationSettings({
        ...defaultSettings,
        n_cycles: sessionNCycles != null ? sessionNCycles : defaultSettings.n_cycles,
      });
    }
  }, [focusedTP, activeDirection, orderedTestPoints]);

  const buildMeasurementParams = useCallback((settings) => {
    const lowFrequencyEnabled = settings.enable_low_frequency_settings ?? DEFAULT_CALIBRATION_SETTINGS.enable_low_frequency_settings;

    return {
      stability_check_method: settings.stability_check_method || DEFAULT_CALIBRATION_SETTINGS.stability_check_method,
      window: parseInt(settings.stability_window, 10) || DEFAULT_CALIBRATION_SETTINGS.stability_window,
      threshold_ppm: parseFloat(settings.stability_threshold_ppm) || DEFAULT_CALIBRATION_SETTINGS.stability_threshold_ppm,
      max_attempts: parseInt(settings.stability_max_attempts, 10) || DEFAULT_CALIBRATION_SETTINGS.stability_max_attempts,
      ppm_threshold: parseFloat(settings.iqr_filter_ppm_threshold) || DEFAULT_CALIBRATION_SETTINGS.iqr_filter_ppm_threshold,
      input_switch_settling_time: clampSettingField(
        "input_switch_settling_time",
        settings.input_switch_settling_time ?? DEFAULT_CALIBRATION_SETTINGS.input_switch_settling_time
      ),
      direct_source_test_mode: Boolean(settings.direct_source_test_mode),
      direct_source_voltage: clampSettingField(
        "direct_source_voltage",
        settings.direct_source_voltage ?? DEFAULT_CALIBRATION_SETTINGS.direct_source_voltage
      ),
      ignore_instability_after_lock: settings.ignore_instability_after_lock ?? DEFAULT_CALIBRATION_SETTINGS.ignore_instability_after_lock,
      enable_low_frequency_settings: lowFrequencyEnabled,
      enable_11hz_filter: lowFrequencyEnabled && (settings.enable_11hz_filter ?? DEFAULT_CALIBRATION_SETTINGS.enable_11hz_filter),
      min_low_freq_settling_time: lowFrequencyEnabled
        ? parseFloat(settings.min_low_freq_settling_time) || DEFAULT_CALIBRATION_SETTINGS.min_low_freq_settling_time
        : 0,
      lf_harmonic_projection: lowFrequencyEnabled && (settings.lf_harmonic_projection ?? DEFAULT_CALIBRATION_SETTINGS.lf_harmonic_projection),
      lf_harmonics: parseInt(settings.lf_harmonics, 10) || DEFAULT_CALIBRATION_SETTINGS.lf_harmonics,
    };
  }, []);

  const buildSettingsPayload = useCallback((settings) => {
    const lowFrequencyEnabled = settings.enable_low_frequency_settings ?? DEFAULT_CALIBRATION_SETTINGS.enable_low_frequency_settings;

    return {
      initial_warm_up_time: parseFloat(settings.initial_warm_up_time) || DEFAULT_CALIBRATION_SETTINGS.initial_warm_up_time,
      num_samples: parseInt(settings.num_samples, 10) || DEFAULT_CALIBRATION_SETTINGS.num_samples,
      settling_time: parseFloat(settings.settling_time) || DEFAULT_CALIBRATION_SETTINGS.settling_time,
      input_switch_settling_time: clampSettingField(
        "input_switch_settling_time",
        settings.input_switch_settling_time ?? DEFAULT_CALIBRATION_SETTINGS.input_switch_settling_time
      ),
      direct_source_test_mode: Boolean(settings.direct_source_test_mode),
      direct_source_voltage: clampSettingField(
        "direct_source_voltage",
        settings.direct_source_voltage ?? DEFAULT_CALIBRATION_SETTINGS.direct_source_voltage
      ),
      nplc: parseFloat(settings.nplc) || DEFAULT_CALIBRATION_SETTINGS.nplc,
      stability_check_method: settings.stability_check_method || DEFAULT_CALIBRATION_SETTINGS.stability_check_method,
      stability_window: parseInt(settings.stability_window, 10) || DEFAULT_CALIBRATION_SETTINGS.stability_window,
      stability_threshold_ppm: parseFloat(settings.stability_threshold_ppm) || DEFAULT_CALIBRATION_SETTINGS.stability_threshold_ppm,
      stability_max_attempts: parseInt(settings.stability_max_attempts, 10) || DEFAULT_CALIBRATION_SETTINGS.stability_max_attempts,
      iqr_filter_ppm_threshold: parseFloat(settings.iqr_filter_ppm_threshold) || DEFAULT_CALIBRATION_SETTINGS.iqr_filter_ppm_threshold,
      ignore_instability_after_lock: settings.ignore_instability_after_lock ?? DEFAULT_CALIBRATION_SETTINGS.ignore_instability_after_lock,
      characterize_test_first: settings.characterize_test_first ?? DEFAULT_CALIBRATION_SETTINGS.characterize_test_first,
      characterize_std_first: settings.characterize_std_first ?? DEFAULT_CALIBRATION_SETTINGS.characterize_std_first,
      characterization_source: settings.characterization_source === "AC" ? "AC" : "DC",
      enable_low_frequency_settings: lowFrequencyEnabled,
      enable_11hz_filter: lowFrequencyEnabled && (settings.enable_11hz_filter ?? DEFAULT_CALIBRATION_SETTINGS.enable_11hz_filter),
      min_low_freq_settling_time: lowFrequencyEnabled
        ? parseFloat(settings.min_low_freq_settling_time) || DEFAULT_CALIBRATION_SETTINGS.min_low_freq_settling_time
        : 0,
      lf_harmonic_projection: lowFrequencyEnabled && (settings.lf_harmonic_projection ?? DEFAULT_CALIBRATION_SETTINGS.lf_harmonic_projection),
      lf_harmonics: parseInt(settings.lf_harmonics, 10) || DEFAULT_CALIBRATION_SETTINGS.lf_harmonics,
      n_cycles: Math.max(2, parseInt(settings.n_cycles, 10) || DEFAULT_CALIBRATION_SETTINGS.n_cycles),
    };
  }, []);

  const handleCorrectionInputChange = (e) =>
    setCorrectionInputs((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));

  const handleOpenCorrectionModal = () => {
    const primaryPoint = activeDirection === "Forward" ? focusedTP.forward : focusedTP.reverse;
    const existingResults = primaryPoint?.results || {};

    setCorrectionInputs({
      eta_std: existingResults.eta_std || "",
      eta_ti: existingResults.eta_ti || "",
      delta_std: existingResults.delta_std ?? "",
      delta_ti: existingResults.delta_ti ?? "",
      delta_std_known: existingResults.delta_std_known ?? "",
    });

    setIsCorrectionModalOpen(true);
  };

  const validateInstrumentAssignments = useCallback((operationLabel = "start calibration") => {
    const missingRoles = [];

    if (!stdInstrumentAddress) missingRoles.push("Standard Reader");
    if (!tiInstrumentAddress) missingRoles.push("Test Reader");
    if (!acSourceAddress) missingRoles.push("AC Source");
    if (!dcSourceAddress) missingRoles.push("DC Source");

    if (missingRoles.length > 0) {
      showNotification(
        `Cannot ${operationLabel}. Missing instrument assignments: ${missingRoles.join(", ")}. Assign these in Instrument Status first.`,
        "error"
      );
      return false;
    }

    return true;
  }, [
    stdInstrumentAddress,
    tiInstrumentAddress,
    acSourceAddress,
    dcSourceAddress,
    showNotification,
  ]);

  const runMeasurement = useCallback(
    async (
      testPointToRun,
      runType,
      baseReadingKey = null,
      bypassAmplifierConfirmation = false
    ) => {
      if (!testPointToRun) return;
      if (!validateInstrumentAssignments("start collection")) {
        return Promise.reject(new Error("Missing required instrument assignments."));
      }
      const ampRange = calibrationConfigurations.amplifier_range;

      if (amplifierAddress && !ampRange) {
        showNotification(
          "An amplifier is assigned, but its range is not set. Please set it in the Test Point Editor.",
          "error"
        );
        return Promise.reject(new Error("Amplifier range not set."));
      }

      let pointData =
        activeDirection === "Forward"
          ? testPointToRun.forward
          : testPointToRun.reverse;
      if (!pointData) {
        try {
          const response = await axios.post(
            `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/`,
            {
              current: testPointToRun.current,
              frequency: testPointToRun.frequency,
              direction: activeDirection,
            }
          );
          pointData = response.data;
          await onDataUpdate();
        } catch (error) {
          showNotification(
            `Error creating ${activeDirection} configuration.`,
            "error"
          );
          return Promise.reject(error);
        }
      }

      clearLiveReadings();

      const runSettings = calibrationSettings;

      let params;
      if (runType === "full") {
        params = {
          command: "start_full_calibration",
          num_samples: parseInt(runSettings.num_samples, 10),
          settling_time: parseFloat(runSettings.settling_time),
        };
      } else {
        params = {
          command: "start_collection",
          reading_type: baseReadingKey,
          num_samples: parseInt(runSettings.num_samples, 10),
          settling_time: parseFloat(runSettings.settling_time),
        };
      }

      Object.assign(params, {
        nplc: parseFloat(runSettings.nplc),
        initial_warm_up_time: parseFloat(runSettings.initial_warm_up_time),
        n_cycles: Math.max(2, parseInt(runSettings.n_cycles, 10) || 3),
        measurement_params: buildMeasurementParams(runSettings),
        test_point: {
          current: testPointToRun.current,
          frequency: testPointToRun.frequency,
          direction: activeDirection,
        },
        test_point_id: pointData.id,
        std_reader_model: stdReaderModel,
        ti_reader_model: tiReaderModel,
        amplifier_range: ampRange,
      });

      if (amplifierAddress) {
        params.amplifier_range = ampRange;
      }

      if (bypassAmplifierConfirmation) {
        params.bypass_amplifier_confirmation = true;
      }

      if (startReadingCollection(params)) {
        return waitForCollection();
      } else {
        showNotification(
          "WebSocket is not connected. Please refresh the page.",
          "error"
        );
        return Promise.reject(new Error("WebSocket not connected."));
      }
    },
    [
      activeDirection,
      amplifierAddress,
      calibrationConfigurations.amplifier_range,
      clearLiveReadings,
      onDataUpdate,
      selectedSessionId,
      showNotification,
      startReadingCollection,
      stdReaderModel,
      tiReaderModel,
      calibrationSettings,
      buildMeasurementParams,
      validateInstrumentAssignments,
    ]
  );

  const handleRunSelectedPoints = async () => {
    if (selectedTPs.size === 0) {
      showNotification("No test points selected.", "warning");
      return;
    }
    if (!validateInstrumentAssignments("start batch calibration")) {
      return;
    }
    setFailedTPKeys(new Set());

    const runBatchSequence = async () => {
      setActiveChartView("calibration");
      const selectedOrderedTPs = orderedTestPoints.filter((p) =>
        selectedTPs.has(p.key)
      );
      const pointsToRunData = selectedOrderedTPs.map((p) => {
        const pointForDirection =
          activeDirection === "Forward" ? p.forward : p.reverse;

        // Grab this specific point's settings, or fallback to the global state
        const ptSettings = pointForDirection?.settings && Object.keys(pointForDirection.settings).length > 0
          ? pointForDirection.settings
          : calibrationSettings;

        return {
          id: pointForDirection?.id,
          current: p.current,
          frequency: p.frequency,
          direction: activeDirection,
          // Explicitly pass the individual point settings for the backend
          settling_time: parseFloat(ptSettings.settling_time),
          num_samples: parseInt(ptSettings.num_samples, 10),
        };
      });
      if (pointsToRunData.length === 0) {
        showNotification(
          `No test points were selected for the batch run.`,
          "error"
        );
        return;
      }

      const firstPointInBatch = selectedOrderedTPs[0];

      // Settings must follow the *active* direction. Preferring
      // forward over reverse was wrong: a reverse run would always
      // use the forward test point's saved `initial_warm_up_time` (and
      // the rest) even when the user had set distinct reverse values.
      const dirKey = activeDirection === "Forward" ? "forward" : "reverse";
      const firstPointForDir = firstPointInBatch?.[dirKey];
      const firstPointSettings =
        firstPointForDir?.settings &&
          Object.keys(firstPointForDir.settings).length > 0
          ? firstPointForDir.settings
          : calibrationSettings;

      // Pre-run hook: if the user opted in, characterize the Test TVC first
      // so its η is fresh before the batch/single run uses it downstream.
      // The characterization run already handles its own amplifier-range
      // confirmation prompt and warm-up; flag those as "already done" so
      // the follow-on batch doesn't re-prompt the operator a second time.
      let characterizationJustRan = false;

      // 1. Characterize TVCs (if opted in)
      const charStd = firstPointSettings.characterize_std_first;
      const charTi = firstPointSettings.characterize_test_first;

      if ((charStd || charTi) && firstPointInBatch) {
        let targetTvc = "BOTH";
        let notifyMsg = "Characterizing Both TVCs first…";

        if (charStd && !charTi) {
          targetTvc = "STD";
          notifyMsg = "Characterizing Standard TVC first…";
        } else if (!charStd && charTi) {
          targetTvc = "TI";
          notifyMsg = "Characterizing Test TVC first…";
        }

        showNotification(notifyMsg, "info");

        const charResult = await handleCharacterizationRequest(targetTvc, {
          silent: true,
          testPoint: firstPointInBatch,
          bypassAmplifierConfirmation: false
        });

        if (charResult === "collection_stopped" || charResult === "error") {
          showNotification(
            "TVC characterization did not complete. Batch aborted.",
            "warning"
          );
          return;
        }

        characterizationJustRan = true;
        setActiveChartView("calibration");
      }

      if (firstPointInBatch) {
        setFocusedTP(firstPointInBatch);
      }

      setIsBulkRunning(true);

      const params = {
        command: "start_full_calibration_batch",
        test_points: pointsToRunData,
        direction: activeDirection,
        num_samples: parseInt(firstPointSettings.num_samples, 10),
        settling_time: parseFloat(firstPointSettings.settling_time),
        nplc: parseFloat(firstPointSettings.nplc),
        // Skip the warm-up sleep when characterization just ran — it
        // already burned through warmup time and the operator shouldn't
        // wait again before the first AC-DC measurement.
        initial_warm_up_time: characterizationJustRan
          ? 0
          : parseFloat(firstPointSettings.initial_warm_up_time),
        n_cycles: Math.max(2, parseInt(firstPointSettings.n_cycles, 10) || 3),
        measurement_params: buildMeasurementParams(firstPointSettings),
        std_reader_model: stdReaderModel,
        ti_reader_model: tiReaderModel,
        amplifier_range: calibrationConfigurations.amplifier_range,
        // Same logic for the "confirm amplifier range" modal: char run
        // already prompted the operator, so don't prompt again.
        bypass_amplifier_confirmation: characterizationJustRan,
      };

      if (startReadingCollection(params)) {
        waitForCollection()
          .then((result) => {
            if (result === "collection_stopped" || result === "error") {
              showNotification(`Batch sequence stopped.`, "warning");
            } else {
              showNotification("Batch sequence finished.", "success");
            }
          })
          .catch((error) => {
            showNotification(
              `Operation failed: ${error.message || "An unknown error occurred."
              }`,
              "error"
            );
          })
          .finally(() => {
            setIsBulkRunning(false);
            onDataUpdate();
          });
      } else {
        showNotification(
          "WebSocket is not connected. Please refresh the page.",
          "error"
        );
        setIsBulkRunning(false);
      }
    };

    // --- NEW TARGETED LOCK LOGIC ---
    const oppositeDirection = activeDirection === "Forward" ? "reverse" : "forward";
    const partialPoints = [];

    // Check ONLY the selected points for abandoned opposite directions
    orderedTestPoints.filter(p => selectedTPs.has(p.key)).forEach(p => {
      const oppositeData = p[oppositeDirection];
      if (isPartial(oppositeData)) {
        partialPoints.push(`${formatCurrent(p.current)}A @ ${formatFrequency(p.frequency)}`);
      }
    });

    let warningMessage = "";
    if (partialPoints.length > 0) {
      warningMessage = `The following test point(s) have incomplete ${oppositeDirection === "forward" ? "Forward" : "Reverse"} readings:\n\n${partialPoints.map(p => `• ${p}`).join("\n")}\n\nAre you sure you want to bypass the lock and proceed to ${activeDirection}?`;
    }

    // Hardware change check
    const changingHardware = activeDirection !== lastCollectionDirection && lastCollectionDirection !== null;
    if (changingHardware) {
      if (warningMessage) warningMessage += "\n\n";
      warningMessage += `Please ensure you have physically configured the hardware for the '${activeDirection}' direction.`;
    }

    if (warningMessage) {
      setConfirmationModal({
        isOpen: true,
        title: partialPoints.length > 0 ? "Bypass Completion Lock?" : "Confirm Hardware Change",
        message: warningMessage,
        onConfirm: () => {
          setConfirmationModal((prev) => ({ ...prev, isOpen: false }));
          setLastCollectionDirection(activeDirection);
          runBatchSequence();
        },
        onCancel: () => setConfirmationModal((prev) => ({ ...prev, isOpen: false })),
      });
      return;
    }

    // No warnings needed, just run
    setLastCollectionDirection(activeDirection);
    runBatchSequence();
  };

  // ----------------------------------------------------------------------
  // Paired AC-DC batch (one cycle = one Forward + one Reverse sequence).
  // Sends both halves of every selected pair to the backend. Forward pass
  // runs first; when `paired_run_awaiting_flip` lands the UI shows the
  // flip modal; user clicks "Resume" and the reverse pass runs in
  // reverse test-point order. recompute_pair_aggregate mirrors the
  // pair-level mean δ + u_A onto both rows.
  // ----------------------------------------------------------------------
  const handleRunPairedBatch = () => {
    if (selectedTPs.size === 0) {
      showNotification("No test points selected.", "warning");
      return;
    }
    if (!validateInstrumentAssignments("start paired AC-DC batch")) {
      return;
    }
    setFailedTPKeys(new Set());

    const selectedOrderedTPs = orderedTestPoints.filter((p) =>
      selectedTPs.has(p.key)
    );

    // Each pair contributes a Forward and a Reverse entry. The backend
    // requires both halves to exist for every (current, frequency) pair.
    const missingHalves = selectedOrderedTPs.filter(
      (p) => !p.forward || !p.reverse
    );
    if (missingHalves.length > 0) {
      const labels = missingHalves
        .map((p) => `${formatCurrent(p.current)} @ ${formatFrequency(p.frequency)}`)
        .join(", ");
      showNotification(
        `Paired run needs both Forward and Reverse for every selected pair. Missing: ${labels}`,
        "error"
      );
      return;
    }

    const buildPayloadEntry = (tp, direction) => {
      const ptSettings =
        tp?.settings && Object.keys(tp.settings).length > 0
          ? tp.settings
          : calibrationSettings;
      return {
        id: tp.id,
        current: tp.current ?? null,
        frequency: tp.frequency ?? null,
        direction,
        settling_time: parseFloat(ptSettings.settling_time),
        num_samples: parseInt(ptSettings.num_samples, 10),
        n_cycles: Math.max(2, parseInt(ptSettings.n_cycles, 10) || 3),
      };
    };

    const forwardPoints = selectedOrderedTPs.map((p) =>
      buildPayloadEntry(p.forward, "Forward")
    );
    const reversePoints = selectedOrderedTPs.map((p) =>
      buildPayloadEntry(p.reverse, "Reverse")
    );

    const firstPoint = selectedOrderedTPs[0];
    const firstFwdSettings =
      firstPoint?.forward?.settings &&
        Object.keys(firstPoint.forward.settings).length > 0
        ? firstPoint.forward.settings
        : calibrationSettings;

    setFocusedTP(firstPoint);
    setIsBulkRunning(true);

    const params = {
      command: "start_paired_batch",
      forward_points: forwardPoints,
      reverse_points: reversePoints,
      num_samples: parseInt(firstFwdSettings.num_samples, 10),
      settling_time: parseFloat(firstFwdSettings.settling_time),
      nplc: parseFloat(firstFwdSettings.nplc),
      n_cycles: Math.max(2, parseInt(firstFwdSettings.n_cycles, 10) || 3),
      initial_warm_up_time: parseFloat(firstFwdSettings.initial_warm_up_time),
      measurement_params: buildMeasurementParams(firstFwdSettings),
      std_reader_model: stdReaderModel,
      ti_reader_model: tiReaderModel,
      amplifier_range: calibrationConfigurations.amplifier_range,
      bypass_amplifier_confirmation: false,
    };

    if (startReadingCollection(params)) {
      waitForCollection()
        .then((result) => {
          if (result === "collection_stopped" || result === "error") {
            showNotification("Paired AC-DC run stopped.", "warning");
          } else {
            showNotification("Paired AC-DC run complete.", "success");
          }
        })
        .catch((err) => {
          showNotification(
            `Paired run failed: ${err.message || "unknown error"}`,
            "error"
          );
        })
        .finally(() => {
          setIsBulkRunning(false);
          onDataUpdate();
        });
    } else {
      showNotification("WebSocket is not connected.", "error");
      setIsBulkRunning(false);
    }
  };

  const handleCollectReadingsRequest = useCallback(
    (baseReadingKey) => {
      const run = () => {
        setActiveChartView("calibration");
        setFailedTPKeys(new Set());
        setLastCollectionDirection(activeDirection);
        runMeasurement(focusedTP, "single", baseReadingKey)
          .then((result) => {
            const message = `${baseReadingKey.replace(/_/g, " ")} readings`;
            if (result === "collection_stopped") {
              showNotification("Sequence stopped by user.", "warning");
            } else if (result === "collection_finished") {
              showNotification(`${message} complete!`, "success");
            }
          })
          .catch((error) => {
            showNotification(
              `Operation failed: ${error.message || "An unknown error occurred."
              }`,
              "error"
            );
            console.error("Measurement run error:", error);
          })
          .finally(() => {
            onDataUpdate();
          });
      };

      // --- NEW TARGETED LOCK LOGIC ---
      const oppositeDirection = activeDirection === "Forward" ? "reverse" : "forward";
      const oppositeData = focusedTP?.[oppositeDirection];

      let warningMessage = "";
      if (isPartial(oppositeData)) {
        warningMessage = `The test point ${formatCurrent(focusedTP?.current)}A @ ${formatFrequency(focusedTP?.frequency)} has incomplete ${oppositeDirection === "forward" ? "Forward" : "Reverse"} readings.\n\nAre you sure you want to bypass the lock and proceed to ${activeDirection}?`;
      }

      const changingHardware = activeDirection !== lastCollectionDirection && lastCollectionDirection !== null;
      if (changingHardware) {
        if (warningMessage) warningMessage += "\n\n";
        warningMessage += `Please ensure you have physically configured the hardware for the '${activeDirection}' direction.`;
      }

      if (warningMessage) {
        setConfirmationModal({
          isOpen: true,
          title: isPartial(oppositeData) ? "Bypass Completion Lock?" : "Confirm Hardware Change",
          message: warningMessage,
          onConfirm: () => {
            setConfirmationModal((prev) => ({ ...prev, isOpen: false }));
            run();
          },
          onCancel: () => setConfirmationModal((prev) => ({ ...prev, isOpen: false })),
        });
      } else {
        run();
      }
    },
    [
      activeDirection,
      lastCollectionDirection,
      focusedTP,
      runMeasurement,
      showNotification,
      onDataUpdate,
      setFailedTPKeys,
      isPartial,
      formatCurrent,
      formatFrequency
    ]
  );

  const handleCharacterizationRequest = useCallback(async (
    target_tvc = "BOTH",
    { silent = false, testPoint: overrideTP = null, bypassAmplifierConfirmation = false } = {}
  ) => {
    if (!validateInstrumentAssignments("start TVC characterization")) {
      return "error";
    }

    const tp = overrideTP || focusedTP;
    if (!tp) return "error";
    setActiveChartView("characterization");

    // 1. Initialize the point in the DB if it hasn't been run before
    let pointData = activeDirection === "Forward" ? tp.forward : tp.reverse;
    if (!pointData) {
      try {
        const response = await axios.post(
          `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/`,
          {
            current: tp.current,
            frequency: tp.frequency,
            direction: activeDirection,
          }
        );
        pointData = response.data;
        await onDataUpdate();
      } catch (error) {
        showNotification(`Error creating ${activeDirection} configuration.`, "error");
        return "error";
      }
    }

    clearLiveReadings();

    // 2. Package the parameters
    const params = {
      command: "tvc_characterization",
      is_pre_batch: silent,
      target_tvc: target_tvc, // <-- Pass the target to the backend
      // AC or DC selects the source used for the ppm-shift sensitivity (η)
      // measurement. DC is the default and is more stable; AC is available
      // for legacy/per-frequency characterization when a user explicitly
      // opts in from the Characterization section of Settings.
      characterization_source:
        calibrationSettings.characterization_source === "AC" ? "AC" : "DC",
      test_point: {
        id: pointData.id,
        current: tp.current,
        frequency: tp.frequency,
        direction: activeDirection,
      },
      test_point_id: pointData.id,
      num_samples: parseInt(calibrationSettings.num_samples, 10),
      settling_time: parseFloat(calibrationSettings.settling_time),
      initial_warm_up_time: parseFloat(calibrationSettings.initial_warm_up_time),
      amplifier_range: calibrationConfigurations.amplifier_range,
      bypass_amplifier_confirmation: bypassAmplifierConfirmation,
      nplc: parseFloat(calibrationSettings.nplc),
      n_cycles: Math.max(2, parseInt(calibrationSettings.n_cycles, 10) || 3),
      measurement_params: buildMeasurementParams(calibrationSettings),
      std_reader_model: stdReaderModel,
      ti_reader_model: tiReaderModel,
    };

    // 3. Trigger the standard collection flow so the UI activates
    if (!startReadingCollection(params)) {
      showNotification("WebSocket not connected.", "error");
      return "error";
    }

    try {
      const result = await waitForCollection();
      if (result === "collection_stopped" || result === "error") {
        if (!silent) showNotification("Characterization stopped or failed.", "warning");
      } else {
        if (!silent) showNotification("Characterization complete!", "success");
      }
      return result;
    } catch (err) {
      if (!silent) showNotification(`Operation failed: ${err.message}`, "error");
      return "error";
    } finally {
      onDataUpdate();
    }
  }, [
    focusedTP,
    activeDirection,
    calibrationSettings,
    calibrationConfigurations.amplifier_range,
    startReadingCollection,
    showNotification,
    onDataUpdate,
    clearLiveReadings,
    selectedSessionId,
    stdReaderModel,
    tiReaderModel,
    buildMeasurementParams,
    validateInstrumentAssignments
  ]);

  const handleRunSingleStageOnSelected = useCallback(
    async (readingKey) => {
      if (selectedTPs.size === 0) {
        showNotification("No test points selected for batch run.", "warning");
        return;
      }
      if (!validateInstrumentAssignments("start batch stage collection")) {
        return;
      }

      const runBatchStageSequence = async () => {
        setActiveChartView("calibration");
        setFailedTPKeys(new Set());

        const pointsToRunData = orderedTestPoints
          .filter((p) => selectedTPs.has(p.key))
          .map((p) => {
            const pointForDirection =
              activeDirection === "Forward" ? p.forward : p.reverse;

            const ptSettings = pointForDirection?.settings && Object.keys(pointForDirection.settings).length > 0
              ? pointForDirection.settings
              : calibrationSettings;

            return {
              id: pointForDirection?.id,
              current: p.current,
              frequency: p.frequency,
              direction: activeDirection,
              settling_time: parseFloat(ptSettings.settling_time),
              num_samples: parseInt(ptSettings.num_samples, 10),
            };
          });

        if (pointsToRunData.length === 0) {
          showNotification(
            `No valid test points could be prepared for the ${activeDirection} direction.`,
            "error"
          );
          return;
        }

        setIsBulkRunning(true);

        const firstPointToRun = uniqueTestPoints.find(
          (p) => p.key === pointsToRunData[0].key
        );
        if (firstPointToRun) {
          setFocusedTP(firstPointToRun);
        }

        const stageDirKey = activeDirection === "Forward" ? "forward" : "reverse";
        const firstForActiveDir = firstPointToRun?.[stageDirKey];
        const firstPointSettings =
          firstForActiveDir?.settings &&
            Object.keys(firstForActiveDir.settings).length > 0
            ? firstForActiveDir.settings
            : calibrationSettings;

        const params = {
          command: "start_single_stage_batch",
          reading_type: readingKey,
          test_points: pointsToRunData,
          direction: activeDirection,
          initial_warm_up_time:
            parseFloat(firstPointSettings.initial_warm_up_time) || 0,
          num_samples: parseInt(firstPointSettings.num_samples, 10),
          settling_time: parseFloat(firstPointSettings.settling_time),
          nplc: parseFloat(firstPointSettings.nplc),
          n_cycles: Math.max(2, parseInt(firstPointSettings.n_cycles, 10) || 3),
          measurement_params: buildMeasurementParams(firstPointSettings),
          std_reader_model: stdReaderModel,
          ti_reader_model: tiReaderModel,
          amplifier_range: calibrationConfigurations.amplifier_range,
        };

        if (startReadingCollection(params)) {
          try {
            const result = await waitForCollection();
            if (result === "collection_stopped" || result === "error") {
              showNotification(`Batch sequence stopped.`, "warning");
            } else {
              showNotification("Batch sequence finished.", "success");
            }
          } catch (error) {
            showNotification(
              `Operation failed: ${error.message || "An unknown error occurred."
              }`,
              "error"
            );
          } finally {
            setIsBulkRunning(false);
            onDataUpdate();
          }
        } else {
          showNotification(
            "WebSocket is not connected. Please refresh the page.",
            "error"
          );
          setIsBulkRunning(false);
        }
      };

      // --- NEW TARGETED LOCK LOGIC ---
      const oppositeDirection = activeDirection === "Forward" ? "reverse" : "forward";
      const partialPoints = [];

      orderedTestPoints.filter(p => selectedTPs.has(p.key)).forEach(p => {
        const oppositeData = p[oppositeDirection];
        if (isPartial(oppositeData)) {
          partialPoints.push(`${formatCurrent(p.current)}A @ ${formatFrequency(p.frequency)}`);
        }
      });

      let warningMessage = "";
      if (partialPoints.length > 0) {
        warningMessage = `The following test point(s) have incomplete ${oppositeDirection === "forward" ? "Forward" : "Reverse"} readings:\n\n${partialPoints.map(p => `• ${p}`).join("\n")}\n\nAre you sure you want to bypass the lock and proceed to ${activeDirection}?`;
      }

      const changingHardware = activeDirection !== lastCollectionDirection && lastCollectionDirection !== null;
      if (changingHardware) {
        if (warningMessage) warningMessage += "\n\n";
        warningMessage += `Please ensure you have physically configured the hardware for the '${activeDirection}' direction.`;
      }

      if (warningMessage) {
        setConfirmationModal({
          isOpen: true,
          title: partialPoints.length > 0 ? "Bypass Completion Lock?" : "Confirm Hardware Change",
          message: warningMessage,
          onConfirm: () => {
            setConfirmationModal((prev) => ({ ...prev, isOpen: false }));
            setLastCollectionDirection(activeDirection);
            runBatchStageSequence();
          },
          onCancel: () => setConfirmationModal((prev) => ({ ...prev, isOpen: false })),
        });
      } else {
        setLastCollectionDirection(activeDirection);
        runBatchStageSequence();
      }
    },
    [
      selectedTPs,
      orderedTestPoints,
      activeDirection,
      lastCollectionDirection,
      calibrationSettings,
      stdReaderModel,
      tiReaderModel,
      calibrationConfigurations.amplifier_range,
      startReadingCollection,
      showNotification,
      onDataUpdate,
      uniqueTestPoints,
      setFocusedTP,
      setFailedTPKeys,
      isPartial,
      formatCurrent,
      formatFrequency,
      buildMeasurementParams,
      validateInstrumentAssignments
    ]
  );

  const buildChartData = (readings) => {
    // Determine which keys to show based on the active view
    const activeKeys = activeChartView === "characterization"
      ? ["char_plus1", "char_minus", "char_plus2"]
      : ["ac_open", "dc_pos", "dc_neg", "ac_close"];

    // Filter READING_TYPES so the legend and datasets only show active keys
    const filteredTypes = READING_TYPES.filter(type => activeKeys.includes(type.key));

    return {
      labels: [
        ...new Set(
          Object.values(readings).flatMap((arr) =>
            arr ? arr.map((point) => point.x) : []
          )
        ),
      ].sort((a, b) => a - b),
      datasets: filteredTypes.map((type) => {
        return {
          label: type.label,
          data: readings[type.key] || [],
          borderColor: type.color,
          backgroundColor: type.color,
          borderWidth: 2,
          fill: false,
          tension: 0.1,
          pointRadius: 3,
          pointHoverRadius: 5,
        };
      }),
    };
  };

  const handleResetToDefaults = useCallback(() => {
    if (isRemoteViewer || !focusedTP || !selectedSessionId) return;

    setConfirmationModal({
      isOpen: true,
      title: "Reset to Defaults?",
      message: "Are you sure you want to revert all settings for this test point to the system defaults? This will overwrite your current settings and save immediately.",
      onConfirm: async () => {
        // 1. Close the modal immediately so the UI doesn't hang
        setConfirmationModal({ isOpen: false });

        // 2. Generate the exact default settings for this point
        const isFirstTestPoint =
          orderedTestPoints.length > 0 &&
          focusedTP.key === orderedTestPoints[0].key;

        const defaultSettings = {
          ...DEFAULT_CALIBRATION_SETTINGS,
          initial_warm_up_time: isFirstTestPoint ? 1800 : 0,
        };

        // 3. Update the local UI state so the user sees the change instantly
        setCalibrationSettings(defaultSettings);

        // 4. Build the payload directly from the default object (bypassing stale React state)
        const newSettingsPayload = buildSettingsPayload(defaultSettings);

        let pointToUpdate = activeDirection === "Forward" ? focusedTP.forward : focusedTP.reverse;
        const directionName = activeDirection;

        // 5. Fire the API call to save it to the database
        try {
          if (!pointToUpdate) {
            pointToUpdate = (
              await axios.post(
                `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/`,
                {
                  current: focusedTP.current,
                  frequency: focusedTP.frequency,
                  direction: directionName,
                }
              )
            ).data;
          }

          await axios.patch(
            `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/${pointToUpdate.id}/`,
            { settings: newSettingsPayload }
          );

          showNotification(
            `Settings reverted to defaults for ${formatCurrent(focusedTP.current)} @ ${formatFrequency(focusedTP.frequency)} (${directionName})!`,
            "success"
          );
          onDataUpdate();
        } catch (error) {
          showNotification("Error saving default settings.", "error");
        }
      },
      onCancel: () => setConfirmationModal({ isOpen: false }),
    });
  }, [
    isRemoteViewer,
    focusedTP,
    selectedSessionId,
    orderedTestPoints,
    activeDirection,
    buildSettingsPayload,
    showNotification,
    onDataUpdate,
    formatCurrent,
    formatFrequency
  ]);

  const handleSettingsSubmit = async (e) => {
    e.preventDefault();
    if (isRemoteViewer) return;
    if (!focusedTP || !selectedSessionId) {
      return showNotification("No test point selected.", "error");
    }

    const newSettings = buildSettingsPayload(calibrationSettings);

    let pointToUpdate =
      activeDirection === "Forward" ? focusedTP.forward : focusedTP.reverse;
    const directionName = activeDirection;

    try {
      if (!pointToUpdate) {
        pointToUpdate = (
          await axios.post(
            `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/`,
            {
              current: focusedTP.current,
              frequency: focusedTP.frequency,
              direction: directionName,
            }
          )
        ).data;
      }

      await axios.patch(
        `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/${pointToUpdate.id}/`,
        { settings: newSettings }
      );

      // n_cycles is shared across both directions — mirror it onto the
      // sibling direction (creating it if needed) so switching/running the
      // opposite direction always uses the same cycle count. Other settings
      // stay per-direction.
      let sibling =
        activeDirection === "Forward" ? focusedTP.reverse : focusedTP.forward;
      const siblingDirection =
        activeDirection === "Forward" ? "Reverse" : "Forward";
      if (!sibling) {
        sibling = (
          await axios.post(
            `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/`,
            {
              current: focusedTP.current,
              frequency: focusedTP.frequency,
              direction: siblingDirection,
            }
          )
        ).data;
      }
      await axios.patch(
        `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/${sibling.id}/`,
        { settings: { n_cycles: newSettings.n_cycles } }
      );

      showNotification(
        `Settings saved for ${formatCurrent(focusedTP.current)} @ ${formatFrequency(focusedTP.frequency)} (${directionName})!`,
        "success"
      );
      onDataUpdate();
    } catch (error) {
      showNotification("Error saving settings.", "error");
    }
  };

  const handleApplySettingsToAll = () => {
    if (isRemoteViewer) return;
    const confirmAction = async () => {
      if (!focusedTP || !selectedSessionId) {
        showNotification(
          "No focused test point to get settings from.",
          "warning"
        );
        return;
      }

      const fullSettingsPayload = buildSettingsPayload(calibrationSettings);

      try {
        let { forward, reverse } = focusedTP;
        if (!forward) {
          forward = (
            await axios.post(
              `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/`,
              {
                current: focusedTP.current,
                frequency: focusedTP.frequency,
                direction: "Forward",
              }
            )
          ).data;
        }
        if (!reverse) {
          reverse = (
            await axios.post(
              `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/`,
              {
                current: focusedTP.current,
                frequency: focusedTP.frequency,
                direction: "Reverse",
              }
            )
          ).data;
        }

        const sourcePointId =
          activeDirection === "Forward" ? forward.id : reverse.id;

        await axios.post(
          `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/actions/apply-settings-to-all/`,
          {
            settings: fullSettingsPayload,
            focused_test_point_id: sourcePointId,
          }
        );

        showNotification(
          `Settings applied to all ${activeDirection} test points successfully!`,
          "success"
        );
        onDataUpdate();
      } catch (error) {
        showNotification("An error occurred while applying settings.", "error");
      } finally {
        setConfirmationModal((prev) => ({ ...prev, isOpen: false }));
      }
    };

    setConfirmationModal({
      isOpen: true,
      title: `Apply Settings to All ${activeDirection} Points?`,
      message:
        `This will apply the common settings (Samples, Settling Time, Stability Threshold, etc.) to ALL test points in the ${activeDirection} direction.\n\nThe 'Initial Warm-up Wait' will only be saved for this specific point and will not affect others. The opposite direction will not be modified.`,
      onConfirm: confirmAction,
      onCancel: () =>
        setConfirmationModal((prev) => ({ ...prev, isOpen: false })),
    });
  };

  const pointForDirection = focusedTP
    ? activeDirection === "Forward"
      ? focusedTP.forward
      : focusedTP.reverse
    : null;

  const isCurrentTPActive =
    isCollecting &&
    String(activeCollectionDetails?.tpId) === String(pointForDirection?.id);

  const activeStageKey = isCurrentTPActive
    ? (activeCollectionDetails?.stage || activeCollectionDetails?.readingKey)
    : null;

  const mergeDataSource = (historical, live, activeStage) => {
    const merged = { ...historical };
    Object.keys(live).forEach((key) => {
      if (activeStage && key === activeStage) {
        // Always use live data for the active stage (even if empty, to clear the chart for the new run)
        merged[key] = live[key];
      } else if (live[key] && live[key].length > 0) {
        // For inactive stages, only overwrite historical if live actually has data
        merged[key] = live[key];
      }
    });
    return merged;
  };

  const stdChartDataSource = isCurrentTPActive
    ? mergeDataSource(historicalReadings, liveReadings, activeStageKey)
    : historicalReadings;

  const tiChartDataSource = isCurrentTPActive
    ? mergeDataSource(tiHistoricalReadings, tiLiveReadings, activeStageKey)
    : tiHistoricalReadings;

  const stdChartData = buildChartData(stdChartDataSource);
  const tiChartData = buildChartData(tiChartDataSource);
  // Resolve the cycle the chart will actually display. We use the same
  // helpers the chart itself uses, so the tracker can never disagree with
  // the chart about "what is the latest cycle right now."
  const stdAvailableCycles = listAvailableCycles(stdChartData);
  const tiAvailableCycles = listAvailableCycles(tiChartData);
  const stdEffectiveCycle = resolveEffectiveCycle(stdChartCycle, stdAvailableCycles);
  const tiEffectiveCycle = resolveEffectiveCycle(tiChartCycle, tiAvailableCycles);
  const showStdChart =
    isCurrentTPActive ||
    Object.values(historicalReadings).some((arr) => arr && arr.length > 0);
  const showTiChart =
    isCurrentTPActive ||
    Object.values(tiHistoricalReadings).some((arr) => arr && arr.length > 0);

  const getStageName = () => {
    const stageKey =
      activeCollectionDetails?.stage || activeCollectionDetails?.readingKey;
    if (!stageKey) return "Initializing...";
    const readingType = READING_TYPES.find((rt) => rt.key === stageKey);
    return readingType ? readingType.label : stageKey.replace(/_/g, " ");
  };

  const isCalculationReady =
    focusedTP &&
    (hasAllReadings(focusedTP.forward) || hasAllReadings(focusedTP.reverse));
  const dropdownOptions = useMemo(() => {
    // Characterization is a single-point operation regardless of how many
    // test points the user has checkboxed in the sidebar: per the
    // "Option A" design, one characterization runs on the focused point
    // and the resulting η is reused for the whole batch that follows.
    // So these options always appear, independent of selection count.
    const charOptions = [
      {
        key: "tvc_char_both",
        label: "Characterize Both TVCs (η)",
        onClick: () => handleCharacterizationRequest("BOTH"),
      },
      {
        key: "tvc_char_std",
        label: "Characterize STD TVC (η)",
        onClick: () => handleCharacterizationRequest("STD"),
      },
      {
        key: "tvc_char_ti",
        label: "Characterize TI TVC (η)",
        onClick: () => handleCharacterizationRequest("TI"),
      },
    ];

    // Filter out internal characterization stages from the individual "Take" options
    const visibleReadingTypes = READING_TYPES.filter(
      (type) => !type.key.startsWith("char_")
    );

    const takeOptions =
      selectedTPs.size > 1
        ? visibleReadingTypes.map(({ key, label }) => ({
          key: key,
          label: `Take ${label} on ${selectedTPs.size} Points`,
          onClick: () => handleRunSingleStageOnSelected(key),
        }))
        : visibleReadingTypes.map(({ key, label }) => ({
          key: key,
          label: `Take ${label} Readings`,
          onClick: () => handleCollectReadingsRequest(key),
        }));

    return [...charOptions, ...takeOptions];
  }, [
    selectedTPs.size,
    handleCollectReadingsRequest,
    handleRunSingleStageOnSelected,
    handleCharacterizationRequest,
  ]);

  const displayPpm = slidingWindowStatus?.ppm ?? livePpm;

  // Derive the count directly from the live chart data
  const currentLiveReadingCount = isCollecting && activeCollectionDetails?.stage
    ? (liveReadings[activeCollectionDetails.stage]?.length || 0)
    : 0;

  const activeWindowCount = Math.min(
    currentLiveReadingCount,
    calibrationSettings.stability_window
  );

  // Cleanly capture retry metrics from context state
  const instabilityCount = slidingWindowStatus?.instability_events || 0;
  const maxRetries = slidingWindowStatus?.max_retries || calibrationSettings.stability_max_attempts;

  // Determine the exact phase of the sliding window for intuitive UI feedback
  let windowPhaseText = "";
  if (collectionProgress.count > 0) {
    // Phase 3: Initial stability achieved, now locking in the required samples
    windowPhaseText = `Monitoring (Last ${activeWindowCount})`;
  } else if (instabilityCount > 0) {
    // Phase 2: Window is full but unstable. Currently sliding and testing new points.
    windowPhaseText = `Searching (Sliding ${calibrationSettings.stability_window})`;
  } else {
    // Phase 1: Gathering the very first batch of points for the window
    windowPhaseText = `Filling (${activeWindowCount}/${calibrationSettings.stability_window})`;
  }

  const isStableNow = useMemo(() => {
    if (slidingWindowStatus) {
      return slidingWindowStatus.is_stable;
    }
    if (livePpm !== null) {
      return livePpm < calibrationSettings.stability_threshold_ppm;
    }
    return true;
  }, [
    slidingWindowStatus,
    livePpm,
    calibrationSettings.stability_threshold_ppm,
  ]);

  const activeRunningTP = useMemo(() => {
    if ((isCollecting || isBulkRunning) && activeCollectionDetails?.tpId) {
      return orderedTestPoints.find(p =>
        String(p.forward?.id) === String(activeCollectionDetails.tpId) ||
        String(p.reverse?.id) === String(activeCollectionDetails.tpId)
      ) || focusedTP;
    }
    return focusedTP;
  }, [isCollecting, isBulkRunning, activeCollectionDetails, orderedTestPoints, focusedTP]);

  const handleSaveCorrections = async (currentCorrectionInputs) => {
    if (isRemoteViewer) {
      return;
    }
    if (isCollecting || isBulkRunning) {
      showNotification(
        "Corrections are view-only while calibration is running.",
        "info"
      );
      return;
    }

    try {
      const pointToUpdate = activeDirection === "Forward" ? focusedTP.forward : focusedTP.reverse;

      if (!pointToUpdate || !pointToUpdate.id) return;

      // Push the user's manual overrides to the backend
      await axios.put(
        `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/${pointToUpdate.id}/update-results/`,
        currentCorrectionInputs
      );

      showNotification(`Corrections updated and recalculated!`, "success");
      onDataUpdate(); // Refreshes the UI to show the newly calculated delta_uut_ppm
      setIsCorrectionModalOpen(false);
    } catch (error) {
      showNotification("Error saving corrections.", "error");
    }
  };

  return (
    <>
      <ConfigurationSummaryModal
        isOpen={isSummaryModalOpen}
        onClose={() => setIsSummaryModalOpen(false)}
        configurations={calibrationConfigurations}
        uniqueTestPoints={uniqueTestPoints}
        getInstrumentIdentity={getInstrumentIdentityByAddress}
        stdInstrumentAddress={stdInstrumentAddress}
        stdReaderModel={stdReaderModel}
        stdReaderSN={stdReaderSN}
        tiInstrumentAddress={tiInstrumentAddress}
        tiReaderModel={tiReaderModel}
        tiReaderSN={tiReaderSN}
        acSourceAddress={acSourceAddress}
        acSourceSN={acSourceSN}
        dcSourceAddress={dcSourceAddress}
        dcSourceSN={dcSourceSN}
        switchDriverAddress={switchDriverAddress}
        switchDriverSN={switchDriverSN}
      />
      <CorrectionFactorsModal
        isOpen={isCorrectionModalOpen}
        onClose={() => setIsCorrectionModalOpen(false)}
        onSubmit={handleSaveCorrections}
        initialValues={correctionInputs}
        onInputChange={handleCorrectionInputChange}
        isReadOnly={isCollecting || isBulkRunning || isRemoteViewer}
      />
      <HarmonicProjectionInfoModal
        isOpen={isHarmonicInfoOpen}
        onClose={() => setIsHarmonicInfoOpen(false)}
      />
      <ConfirmationModal
        isOpen={confirmationModal.isOpen}
        title={confirmationModal.title}
        message={confirmationModal.message}
        onConfirm={confirmationModal.onConfirm}
        onCancel={() => setConfirmationModal({ isOpen: false })}
        confirmText="Ready"
      />
      <ConfirmationModal
        isOpen={amplifierModal.isOpen}
        eyebrow="Amplifier"
        title="Verify 8100 range"
        message={`Please ensure the 8100 Amplifier range is set to ${amplifierModal.range} A. Incorrect range setting may damage the equipment.\n\nVerify 5730A calibrators voltage output are correct. Once verified, set the 8100 to operate and click Proceed.`}
        onConfirm={amplifierModal.onConfirm}
        onCancel={amplifierModal.onCancel}
        confirmText="Proceed — range verified"
      />

      {!selectedSessionId ? (
        <div className="content-area form-section-warning">
          {isRemoteViewer ? (
            // Three distinct states for a remote viewer with no session:
            //   1. host-sync WS still in flight → "Connecting…" (transient)
            //   2. host-sync confirmed no session → explicit "host is idle"
            //   3. Fallback copy (should rarely be hit)
            // Keeping these separate prevents the old bug where a reconnect
            // briefly flashed "no test points" while the session_changed
            // message was still on the wire.
            !hostSessionKnown ? (
              <p>Connecting to host — waiting for the current session…</p>
            ) : (
              <p>
                The host isn't in a calibration session right now. This view
                will refresh automatically when they open one.
              </p>
            )
          ) : (
            <p>Please select a session to run a calibration.</p>
          )}
        </div>
      ) : uniqueTestPoints && uniqueTestPoints.length === 0 ? (
        <div className="content-area form-section-warning">
          <p>
            {isRemoteViewer
              ? "This session doesn't have any test points yet. The view will update as soon as the host adds them."
              : 'This session has no test points. Please go to the "Test Point Editor" to generate them.'}
          </p>
        </div>
      ) : (
        <>
          {/* --- STANDALONE STATUS BAR --- */}
          <div style={{ marginBottom: "20px" }}>
            <CalibrationStatusBar
              activeRunningTP={activeRunningTP}
              focusedTP={focusedTP}
              formatCurrent={formatCurrent}
              formatFrequency={formatFrequency}
              isCollecting={isCollecting}
              isBulkRunning={isBulkRunning}
              bulkRunProgress={bulkRunProgressFromContext}
              activeCollectionDetails={activeCollectionDetails}
              pairedRun={pairedRun}
              timerState={timerState}
              countdown={countdown}
              stabilizationStatus={stabilizationStatus}
              stabilizationInfo={stabilizationInfo}
              collectionProgress={collectionProgress}
              getStageName={getStageName}
              latestStdReading={latestStdReading}
              latestTiReading={latestTiReading}
              calibrationSettings={calibrationSettings}
              displayPpm={displayPpm}
              isStableNow={isStableNow}
              windowPhaseText={windowPhaseText}
              instabilityCount={instabilityCount}
              maxRetries={maxRetries}
              stopReadingCollection={stopReadingCollection}
              handleRunSelectedPoints={handleRunSelectedPoints}
              readingWsState={readingWsState}
              selectedTPs={selectedTPs}
              dropdownOptions={dropdownOptions}
              isRemoteViewer={isRemoteViewer}
            />
          </div>

          <div className="content-area">
            <div className="calibration-workflow-container">
              <div className="test-point-content">
                {!focusedTP ? (
                  <div className="placeholder-content">
                    <h3>Select a Test Point</h3>
                    <p>
                      Please select a test point from the list on the left to
                      begin.
                    </p>
                  </div>
                ) : (
                  <>
                    <SubNav activeTab={activeTab} setActiveTab={setActiveTab} />

                    <div className="sub-tab-content">
                      {activeTab === "settings" && (
                        <form
                          onSubmit={handleSettingsSubmit}
                          className="settings-form"
                        >
                          {isRemoteViewer && (
                            <p className="bug-report-browse-intro" style={{ marginTop: 0, marginBottom: "1rem" }}>
                              Viewing the host&apos;s settings — read only.
                            </p>
                          )}
                          <div className="settings-form-group">
                            <span className="settings-form-group-eyebrow">
                              General
                            </span>
                            <div className="form-section-group">
                              {false && (
                                <>
                                  <div className="form-section">
                                    <label htmlFor="num_samples"># of samples</label>
                                    <input
                                      type="number"
                                      id="num_samples"
                                      name="num_samples"
                                      required
                                      min="2"
                                      value={calibrationSettings.num_samples || ""}
                                      onChange={(e) => {
                                        const newSamples = parseInt(e.target.value, 10) || 0;
                                        setCalibrationSettings((prev) => ({
                                          ...prev,
                                          num_samples: e.target.value,
                                          stability_window: prev.stability_window > newSamples && newSamples > 0
                                            ? newSamples
                                            : prev.stability_window,
                                        }));
                                      }}
                                      disabled={isRemoteViewer}
                                    />
                                    {samplingAdvisor && (
                                      <div
                                        className={
                                          "sample-cycle-advisor" +
                                          (samplingAdvisor.isClean
                                            ? " is-clean"
                                            : " needs-adjustment")
                                        }
                                        title={`Based on ${formatFrequency(samplingAdvisor.frequency)}, ${samplingAdvisor.nplc} NPLC, and a ${LINE_FREQUENCY_HZ} Hz line frequency.`}
                                      >
                                        <div className="sample-cycle-advisor-main">
                                          <FaInfoCircle aria-hidden />
                                          <span>
                                            {samplingAdvisor.isClean
                                              ? "Cycle-clean window"
                                              : "Cleaner cycle window available"}
                                          </span>
                                          {!samplingAdvisor.isClean &&
                                            samplingAdvisor.recommended && (
                                              <button
                                                type="button"
                                                className="sample-cycle-advisor-action"
                                                onClick={() =>
                                                  applyRecommendedSampleCount(
                                                    samplingAdvisor.recommended.count
                                                  )
                                                }
                                                disabled={isRemoteViewer}
                                                title={`Use ${samplingAdvisor.recommended.count} samples`}
                                              >
                                                Use {samplingAdvisor.recommended.count}
                                              </button>
                                            )}
                                        </div>
                                        <div className="sample-cycle-advisor-detail">
                                          {samplingAdvisor.samples} samples ={" "}
                                          {samplingAdvisor.totalSeconds.toFixed(3)}s,{" "}
                                          {formatCycleCount(samplingAdvisor.sourceCycles)} source cycles,{" "}
                                          {formatCycleCount(samplingAdvisor.rippleCycles)} ripple cycles
                                          {!samplingAdvisor.isClean &&
                                            samplingAdvisor.recommended && (
                                              <>
                                                {" "}· {samplingAdvisor.recommended.count} samples gives{" "}
                                                {formatCycleCount(
                                                  samplingAdvisor.recommended.sourceCycles
                                                )} source cycles
                                              </>
                                            )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  <div className="form-section">
                                    <label htmlFor="settling_time">
                                      Settling time (sec)
                                    </label>
                                    <input
                                      type="number"
                                      id="settling_time"
                                      name="settling_time"
                                      required
                                      value={calibrationSettings.settling_time || 5}
                                      onChange={(e) =>
                                        setCalibrationSettings((prev) => ({
                                          ...prev,
                                          settling_time: e.target.value,
                                        }))
                                      }
                                      disabled={isRemoteViewer}
                                    />
                                  </div>
                                  <div className="form-section">
                                    <label htmlFor="nplc">
                                      Reader integration (NPLC)
                                    </label>
                                    <select
                                      id="nplc"
                                      name="nplc"
                                      value={calibrationSettings.nplc || 20}
                                      onChange={(e) =>
                                        setCalibrationSettings((prev) => ({
                                          ...prev,
                                          nplc: parseFloat(e.target.value),
                                        }))
                                      }
                                      disabled={isRemoteViewer}
                                    >
                                      {NPLC_OPTIONS.map((val) => (
                                        <option key={val} value={val}>
                                          {val} PLC
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </>
                              )}
                              <div className="form-section">
                                <label htmlFor="n_cycles">
                                  Paired cycles (N)
                                </label>
                                <input
                                  type="number"
                                  id="n_cycles"
                                  name="n_cycles"
                                  min="2"
                                  step="1"
                                  value={calibrationSettings.n_cycles ?? 3}
                                  onChange={(e) =>
                                    setCalibrationSettings((prev) => ({
                                      ...prev,
                                      n_cycles: e.target.value,
                                    }))
                                  }
                                  onBlur={handleSettingBlur("n_cycles")}
                                  disabled={isRemoteViewer}
                                  title="One cycle = one Forward + one Reverse sequence. This is a single value shared across both directions; saving mirrors it to the opposite direction, and analytics use only the first N cycles even if more were collected. Min 2; recommended ≥3."
                                />
                              </div>
                              {false && (
                                <div className="form-section form-section--checkbox full-width">
                                  <label className="form-section-checkbox-label">
                                    <input
                                      type="checkbox"
                                      className="form-section-checkbox-input"
                                      checked={
                                        calibrationConfigurations?.use_abba_pairing === undefined
                                          ? true
                                          : Boolean(calibrationConfigurations.use_abba_pairing)
                                      }
                                      onChange={(e) => handleSetAbbaPairing(e.target.checked)}
                                      disabled={isRemoteViewer}
                                    />
                                    <span>Utilize ABBA Pairing</span>
                                  </label>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="settings-form-group settings-form-group--stability">
                            <span className="settings-form-group-eyebrow">
                              Stability
                            </span>
                            <div className="form-section-group">
                              <div className="form-section">
                                <label htmlFor="initial_warm_up_time">
                                  Initial warm-up wait (sec)
                                </label>
                                <input
                                  type="number"
                                  id="initial_warm_up_time"
                                  name="initial_warm_up_time"
                                  min="0"
                                  step="1"
                                  value={calibrationSettings.initial_warm_up_time ?? ""}
                                  onChange={(e) =>
                                    setCalibrationSettings((prev) => ({
                                      ...prev,
                                      initial_warm_up_time: e.target.value,
                                    }))
                                  }
                                  onBlur={handleSettingBlur("initial_warm_up_time")}
                                  disabled={isRemoteViewer}
                                />
                              </div>
                              <div className="form-section">
                                <label htmlFor="settling_time">
                                  Settling time (sec)
                                </label>
                                <input
                                  type="number"
                                  id="settling_time"
                                  name="settling_time"
                                  required
                                  min="0"
                                  step="any"
                                  value={calibrationSettings.settling_time ?? ""}
                                  onChange={(e) =>
                                    setCalibrationSettings((prev) => ({
                                      ...prev,
                                      settling_time: e.target.value,
                                    }))
                                  }
                                  onBlur={handleSettingBlur("settling_time")}
                                  disabled={isRemoteViewer}
                                />
                              </div>
                              {has34420Reader && (
                                <div className="form-section">
                                  <label htmlFor="nplc">
                                    34420A integration (NPLC)
                                  </label>
                                  <select
                                    id="nplc"
                                    name="nplc"
                                    value={calibrationSettings.nplc || 20}
                                    onChange={(e) =>
                                      setCalibrationSettings((prev) => ({
                                        ...prev,
                                        nplc: parseFloat(e.target.value),
                                      }))
                                    }
                                    disabled={isRemoteViewer}
                                  >
                                    {NPLC_OPTIONS.map((val) => (
                                      <option key={val} value={val}>
                                        {val} PLC
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}
                              {has8508Reader && (
                                <div
                                  className="form-section"
                                  title="Minimum delay applied after the 8508A changes between FRONT and REAR inputs. The app automatically enforces any longer scan delay required by the selected 8508A function, resolution, and filter."
                                >
                                  <label htmlFor="input_switch_settling_time">
                                    Min. front/rear settling (sec)
                                  </label>
                                  <input
                                    type="number"
                                    id="input_switch_settling_time"
                                    name="input_switch_settling_time"
                                    min="0"
                                    max="65000"
                                    step="0.1"
                                    value={calibrationSettings.input_switch_settling_time ?? 1}
                                    onChange={(e) =>
                                      setCalibrationSettings((prev) => ({
                                        ...prev,
                                        input_switch_settling_time: e.target.value,
                                      }))
                                    }
                                    onBlur={handleSettingBlur("input_switch_settling_time")}
                                    disabled={isRemoteViewer}
                                  />
                                </div>
                              )}
                              {has8508Reader && (
                                <div
                                  className="form-section form-section--checkbox full-width"
                                  title="Diagnostic-only topology: connect one 5730A directly to the 8508A FRONT input and the other directly to REAR. No amplifier, switch driver, shunts, or TVCs are used."
                                >
                                  <label className="form-section-checkbox-label">
                                    <input
                                      type="checkbox"
                                      className="form-section-checkbox-input"
                                      checked={Boolean(calibrationSettings.direct_source_test_mode)}
                                      onChange={(e) => {
                                        const enabled = e.target.checked;
                                        if (enabled && (amplifierAddress || switchDriverAddress)) {
                                          showNotification(
                                            "Remove the amplifier and switch-driver assignments before enabling Direct 5730A test mode.",
                                            "warning"
                                          );
                                          return;
                                        }
                                        setCalibrationSettings((prev) => ({
                                          ...prev,
                                          direct_source_test_mode: enabled,
                                          characterize_test_first: enabled ? false : prev.characterize_test_first,
                                          characterize_std_first: enabled ? false : prev.characterize_std_first,
                                        }));
                                      }}
                                      disabled={isRemoteViewer}
                                    />
                                    <span>Direct 5730A test mode</span>
                                  </label>
                                </div>
                              )}
                              {has8508Reader && calibrationSettings.direct_source_test_mode && (
                                <div
                                  className="form-section"
                                  title="Both 5730As are commanded to this diagnostic voltage. The 8508A range is selected from this expected signal; exactly 2 V and values above it use the next valid range."
                                >
                                  <label htmlFor="direct_source_voltage">
                                    Direct source voltage (V)
                                  </label>
                                  <input
                                    type="number"
                                    id="direct_source_voltage"
                                    name="direct_source_voltage"
                                    min="0.000001"
                                    max="1000"
                                    step="any"
                                    value={calibrationSettings.direct_source_voltage ?? 2}
                                    onChange={(e) =>
                                      setCalibrationSettings((prev) => ({
                                        ...prev,
                                        direct_source_voltage: e.target.value,
                                      }))
                                    }
                                    onBlur={handleSettingBlur("direct_source_voltage")}
                                    disabled={isRemoteViewer}
                                  />
                                </div>
                              )}
                              <div className="form-section form-section--samples">
                                <label htmlFor="num_samples"># of samples</label>
                                <input
                                  type="number"
                                  id="num_samples"
                                  name="num_samples"
                                  required
                                  min="2"
                                  value={calibrationSettings.num_samples || ""}
                                  onChange={(e) => {
                                    const newSamples = parseInt(e.target.value, 10) || 0;
                                    setCalibrationSettings((prev) => ({
                                      ...prev,
                                      num_samples: e.target.value,
                                      stability_window: prev.stability_window > newSamples && newSamples > 0
                                        ? newSamples
                                        : prev.stability_window,
                                    }));
                                  }}
                                  onBlur={(e) => {
                                    const clamped = clampSettingField("num_samples", e.target.value);
                                    setCalibrationSettings((prev) => ({
                                      ...prev,
                                      num_samples: clamped,
                                      // Keep the stability window from exceeding the (now valid)
                                      // sample count it's drawn from.
                                      stability_window: clampSettingField(
                                        "stability_window",
                                        prev.stability_window,
                                        clamped
                                      ),
                                    }));
                                  }}
                                  disabled={isRemoteViewer}
                                />
                                {samplingAdvisor && (
                                  <div
                                    className={
                                      "sample-cycle-advisor" +
                                      (samplingAdvisor.isClean
                                        ? " is-clean"
                                        : " needs-adjustment")
                                    }
                                    title={`Based on ${formatFrequency(samplingAdvisor.frequency)}, ${samplingAdvisor.nplc} NPLC, and a ${LINE_FREQUENCY_HZ} Hz line frequency.`}
                                  >
                                    <div className="sample-cycle-advisor-main">
                                      <FaInfoCircle aria-hidden />
                                      <span>
                                        {samplingAdvisor.isClean
                                          ? "Cycle-clean window"
                                          : "Cleaner cycle window available"}
                                      </span>
                                      {!samplingAdvisor.isClean &&
                                        samplingAdvisor.recommended && (
                                          <button
                                            type="button"
                                            className="sample-cycle-advisor-action"
                                            onClick={() =>
                                              applyRecommendedSampleCount(
                                                samplingAdvisor.recommended.count
                                              )
                                            }
                                            disabled={isRemoteViewer}
                                            title={`Use ${samplingAdvisor.recommended.count} samples`}
                                          >
                                            Use {samplingAdvisor.recommended.count}
                                          </button>
                                        )}
                                    </div>
                                    <div className="sample-cycle-advisor-detail">
                                      {samplingAdvisor.samples} samples ={" "}
                                      {samplingAdvisor.totalSeconds.toFixed(3)}s,{" "}
                                      {formatCycleCount(samplingAdvisor.sourceCycles)} source cycles,{" "}
                                      {formatCycleCount(samplingAdvisor.rippleCycles)} ripple cycles
                                      {!samplingAdvisor.isClean &&
                                        samplingAdvisor.recommended && (
                                          <>
                                            {" "}Â· {samplingAdvisor.recommended.count} samples gives{" "}
                                            {formatCycleCount(
                                              samplingAdvisor.recommended.sourceCycles
                                            )} source cycles
                                          </>
                                        )}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div className="form-section form-section--stability-method">
                                <label htmlFor="stability_check_method">
                                  Check method
                                </label>
                                <select
                                  id="stability_check_method"
                                  name="stability_check_method"
                                  value={calibrationSettings.stability_check_method}
                                  onChange={(e) =>
                                    setCalibrationSettings((prev) => ({
                                      ...prev,
                                      stability_check_method: e.target.value,
                                    }))
                                  }
                                  disabled={isRemoteViewer}
                                >
                                  <option value="sliding_window">
                                    Sliding window
                                  </option>
                                  <option value="iqr_filter">IQR filter</option>
                                </select>
                              </div>

                              {calibrationSettings.stability_check_method ===
                                "sliding_window" && (
                                  <>
                                    <div className="form-section">
                                      <label htmlFor="stability_window">
                                        Stability window (# samples)
                                      </label>
                                      <input
                                        type="number"
                                        id="stability_window"
                                        name="stability_window"
                                        min="2"
                                        max={calibrationSettings.num_samples || 35}
                                        value={
                                          calibrationSettings.stability_window || ""
                                        }
                                        onChange={(e) => {
                                          const newWindow = parseInt(e.target.value, 10) || 0;
                                          const currentSamples = parseInt(calibrationSettings.num_samples, 10) || 35;
                                          setCalibrationSettings((prev) => ({
                                            ...prev,
                                            stability_window: newWindow > currentSamples ? currentSamples : newWindow,
                                          }));
                                        }}
                                        onBlur={handleSettingBlur(
                                          "stability_window",
                                          parseInt(calibrationSettings.num_samples, 10) || null
                                        )}
                                        disabled={isRemoteViewer}
                                      />
                                    </div>
                                    <div className="form-section">
                                      <label htmlFor="stability_threshold_ppm">
                                        Stability threshold (PPM)
                                      </label>
                                      <input
                                        type="number"
                                        step="any"
                                        min="0"
                                        id="stability_threshold_ppm"
                                        name="stability_threshold_ppm"
                                        placeholder="e.g., 10"
                                        value={
                                          calibrationSettings.stability_threshold_ppm ||
                                          ""
                                        }
                                        onChange={(e) =>
                                          setCalibrationSettings((prev) => ({
                                            ...prev,
                                            stability_threshold_ppm: e.target.value,
                                          }))
                                        }
                                        onBlur={handleSettingBlur("stability_threshold_ppm")}
                                        disabled={isRemoteViewer}
                                      />
                                    </div>
                                    <div className="form-section">
                                      <label htmlFor="stability_max_attempts">
                                        Max stability attempts
                                      </label>
                                      <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        id="stability_max_attempts"
                                        name="stability_max_attempts"
                                        value={calibrationSettings.stability_max_attempts ?? ""}
                                        onChange={(e) =>
                                          setCalibrationSettings((prev) => ({
                                            ...prev,
                                            stability_max_attempts: e.target.value,
                                          }))
                                        }
                                        onBlur={handleSettingBlur("stability_max_attempts")}
                                        disabled={isRemoteViewer}
                                      />
                                    </div>
                                    <div className="form-section form-section--checkbox full-width">
                                      <label className="form-section-checkbox-label">
                                        <input
                                          type="checkbox"
                                          className="form-section-checkbox-input"
                                          checked={calibrationSettings.ignore_instability_after_lock || false}
                                          onChange={(e) =>
                                            setCalibrationSettings((prev) => ({
                                              ...prev,
                                              ignore_instability_after_lock: e.target.checked,
                                            }))
                                          }
                                          disabled={isRemoteViewer}
                                        />
                                        <span>Bypass stability attempts (post initial)</span>
                                      </label>
                                    </div>
                                  </>
                                )}

                              {calibrationSettings.stability_check_method ===
                                "iqr_filter" && (
                                  <div className="form-section">
                                    <label htmlFor="iqr_filter_ppm_threshold">
                                      IQR filter threshold (PPM)
                                    </label>
                                    <input
                                      type="number"
                                      step="any"
                                      min="0"
                                      id="iqr_filter_ppm_threshold"
                                      name="iqr_filter_ppm_threshold"
                                      value={
                                        calibrationSettings.iqr_filter_ppm_threshold ||
                                        15
                                      }
                                      onChange={(e) =>
                                        setCalibrationSettings((prev) => ({
                                          ...prev,
                                          iqr_filter_ppm_threshold: e.target.value,
                                        }))
                                      }
                                      onBlur={handleSettingBlur("iqr_filter_ppm_threshold")}
                                      disabled={isRemoteViewer}
                                    />
                                  </div>
                                )}
                            </div>
                          </div>
                          {/* --- LOW FREQUENCY AC SECTION ---
                              Hidden while LF-specific calibration behavior is parked.
                              Keep the settings/state/payload logic intact so the section can
                              be restored without rebuilding the backend contract. */}
                          {false && (
                            <div className="settings-form-group">
                              <span className="settings-form-group-eyebrow">
                                Low Frequency AC (≤ 40 Hz)
                              </span>
                              <div className="form-section-group">
                                <div className="form-section form-section--checkbox full-width">
                                  <label className="form-section-checkbox-label">
                                    <input
                                      type="checkbox"
                                      className="form-section-checkbox-input"
                                      checked={calibrationSettings.enable_low_frequency_settings || false}
                                      onChange={(e) =>
                                        setCalibrationSettings((prev) => ({
                                          ...prev,
                                          enable_low_frequency_settings: e.target.checked,
                                        }))
                                      }
                                      disabled={isRemoteViewer}
                                    />
                                    <span>Enable Low Frequency Settings</span>
                                  </label>
                                </div>

                                {calibrationSettings.enable_low_frequency_settings && (
                                  <>

                                    {/* New Wrapper to force side-by-side layout */}
                                    <div style={{ display: "flex", gap: "1rem", gridColumn: "1 / -1", width: "100%" }}>

                                      <div
                                        className="form-section form-section--checkbox"
                                        title="Engages the 11 Hz hardware analog low-pass filter on the 34420A nanovoltmeter."
                                        style={{ flex: 1 }}
                                      >
                                        <label className="form-section-checkbox-label">
                                          <input
                                            type="checkbox"
                                            className="form-section-checkbox-input"
                                            checked={calibrationSettings.enable_11hz_filter || false}
                                            onChange={(e) =>
                                              setCalibrationSettings((prev) => ({
                                                ...prev,
                                                enable_11hz_filter: e.target.checked,
                                              }))
                                            }
                                            disabled={isRemoteViewer}
                                          />
                                          <span>Enable 11 Hz Low Pass Filter</span>
                                        </label>
                                      </div>

                                      <div className="form-section form-section--checkbox" style={{ flex: 1 }}>
                                        <label
                                          className="form-section-checkbox-label"
                                          style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
                                        >
                                          <input
                                            type="checkbox"
                                            className="form-section-checkbox-input"
                                            checked={calibrationSettings.lf_harmonic_projection || false}
                                            onChange={(e) =>
                                              setCalibrationSettings((prev) => ({
                                                ...prev,
                                                lf_harmonic_projection: e.target.checked,
                                              }))
                                            }
                                            disabled={isRemoteViewer}
                                          />
                                          <span>Harmonic projection (recommended)</span>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              setIsHarmonicInfoOpen(true);
                                            }}
                                            title="What does harmonic projection do? (click for full explanation)"
                                            style={{
                                              display: "inline-flex",
                                              alignItems: "center",
                                              justifyContent: "center",
                                              background: "transparent",
                                              border: "none",
                                              padding: 0,
                                              marginLeft: "0.15rem",
                                              color: "var(--color-accent, #4f8cff)",
                                              cursor: "pointer",
                                              fontSize: "1rem",
                                              lineHeight: 1,
                                            }}
                                          >
                                            <FaInfoCircle aria-hidden />
                                          </button>
                                        </label>
                                      </div>

                                    </div>

                                    <div
                                      className="form-section"
                                      title="Minimum dwell at the test point before the capture window opens for TVC thermal stabilization."
                                    >
                                      <label htmlFor="min_low_freq_settling_time">Low Frequency Settling (sec)</label>
                                      <input
                                        type="number"
                                        step="any"
                                        id="min_low_freq_settling_time"
                                        value={calibrationSettings.min_low_freq_settling_time || 0}
                                        onChange={(e) =>
                                          setCalibrationSettings((prev) => ({
                                            ...prev,
                                            min_low_freq_settling_time: e.target.value,
                                          }))
                                        }
                                        disabled={isRemoteViewer}
                                      />
                                    </div>

                                    {calibrationSettings.lf_harmonic_projection && (
                                      <div
                                        className="form-section"
                                        title="Number of harmonic pairs fitted. 1 = 2f only (4 params). 2 = 2f + 4f (6 params, default). 3 = 2f + 4f + 6f (8 params) — use at 1–3 Hz where TVC nonlinearity is more significant."
                                      >
                                        <label htmlFor="lf_harmonics">Harmonic pairs (1–3)</label>
                                        <select
                                          id="lf_harmonics"
                                          value={calibrationSettings.lf_harmonics ?? 2}
                                          onChange={(e) =>
                                            setCalibrationSettings((prev) => ({
                                              ...prev,
                                              lf_harmonics: parseInt(e.target.value, 10),
                                            }))
                                          }
                                          disabled={isRemoteViewer}
                                        >
                                          <option value={1}>1 — 2f only</option>
                                          <option value={2}>2 — 2f + 4f (recommended)</option>
                                          <option value={3}>3 — 2f + 4f + 6f</option>
                                        </select>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          )}

                          <div className="settings-form-group">
                            <span className="settings-form-group-eyebrow">
                              Characterization
                            </span>
                            <div className="form-section-group">
                              <div className="form-section">
                                <label htmlFor="characterization_source">
                                  Source
                                </label>
                                <select
                                  id="characterization_source"
                                  name="characterization_source"
                                  value={
                                    calibrationSettings.characterization_source ||
                                    "DC"
                                  }
                                  onChange={(e) =>
                                    setCalibrationSettings((prev) => ({
                                      ...prev,
                                      characterization_source: e.target.value,
                                    }))
                                  }
                                  disabled={isRemoteViewer || calibrationSettings.direct_source_test_mode}
                                >
                                  <option value="DC">DC</option>
                                  <option value="AC">AC</option>
                                </select>
                              </div>
                              {/* Wrap both checkboxes in a flex row */}
                              <div style={{ display: "flex", gap: "1rem", gridColumn: "1 / -1", width: "100%" }}>

                                {/* Remove 'full-width' and add 'flex: 1' so they share the space equally */}
                                <div className="form-section form-section--checkbox" style={{ flex: 1 }}>
                                  <label className="form-section-checkbox-label">
                                    <input
                                      type="checkbox"
                                      className="form-section-checkbox-input"
                                      checked={calibrationSettings.characterize_std_first || false}
                                      onChange={(e) =>
                                        setCalibrationSettings((prev) => ({
                                          ...prev,
                                          characterize_std_first: e.target.checked,
                                        }))
                                      }
                                      disabled={isRemoteViewer || calibrationSettings.direct_source_test_mode}
                                    />
                                    <span>Characterize STD. TVC before run</span>
                                  </label>
                                </div>

                                <div className="form-section form-section--checkbox" style={{ flex: 1 }}>
                                  <label className="form-section-checkbox-label">
                                    <input
                                      type="checkbox"
                                      className="form-section-checkbox-input"
                                      checked={calibrationSettings.characterize_test_first || false}
                                      onChange={(e) =>
                                        setCalibrationSettings((prev) => ({
                                          ...prev,
                                          characterize_test_first: e.target.checked,
                                        }))
                                      }
                                      disabled={isRemoteViewer || calibrationSettings.direct_source_test_mode}
                                    />
                                    <span>Characterize TI. TVC before run</span>
                                  </label>
                                </div>

                              </div>
                            </div>
                          </div>

                          <div className="form-section-action-icons">
                            <button
                              type="button"
                              onClick={handleResetToDefaults}
                              className="sidebar-action-button"
                              aria-label="Reset to default settings"
                              title="Reset to system defaults"
                              disabled={isRemoteViewer}
                            >
                              <FaUndo />
                            </button>
                            <button
                              type="button"
                              onClick={handleApplySettingsToAll}
                              className="sidebar-action-button"
                              aria-label="Apply to all test points"
                              title="Apply to all test points"
                              disabled={isRemoteViewer}
                            >
                              <LuSaveAll />
                            </button>
                            <button
                              type="submit"
                              className="sidebar-action-button"
                              aria-label="Save settings for this point"
                              title="Save settings for this point"
                              disabled={isRemoteViewer}
                            >
                              <FaSave />
                            </button>
                          </div>
                        </form>
                      )}
                      {activeTab === "readings" && (
                        <>
                          {showStdChart && showTiChart && (
                            <div
                              className="cal-readings-layout-bar"
                              role="group"
                              aria-label="Readings chart layout"
                            >
                              <span
                                className="cal-readings-layout-label"
                                id="cal-readings-layout-label"
                              >
                                Chart layout
                              </span>
                              <div
                                className="cal-results-pill-group"
                                role="group"
                                aria-labelledby="cal-readings-layout-label"
                              >
                                <button
                                  type="button"
                                  className={
                                    "cal-results-pill" +
                                    (readingsChartLayout === "stacked"
                                      ? " is-active"
                                      : "")
                                  }
                                  aria-pressed={readingsChartLayout === "stacked"}
                                  onClick={() => setReadingsChartLayout("stacked")}
                                >
                                  Stacked
                                </button>
                                <button
                                  type="button"
                                  className={
                                    "cal-results-pill" +
                                    (readingsChartLayout === "sideBySide"
                                      ? " is-active"
                                      : "")
                                  }
                                  aria-pressed={
                                    readingsChartLayout === "sideBySide"
                                  }
                                  onClick={() =>
                                    setReadingsChartLayout("sideBySide")
                                  }
                                >
                                  Side by side
                                </button>
                              </div>
                            </div>
                          )}
                          <div
                            className={
                              "cal-readings-charts" +
                              (readingsChartLayout === "sideBySide" &&
                                showStdChart &&
                                showTiChart
                                ? " cal-readings-charts--side-by-side"
                                : "")
                            }
                          >
                            {showStdChart && (
                              <div className="chart-container">
                                <CalibrationChart
                                  title="Standard Instrument Readings"
                                  chartData={stdChartData}
                                  theme={theme}
                                  chartType="line"
                                  onHover={setHoveredIndex}
                                  syncedHoverIndex={hoveredIndex}
                                  comparisonData={tiChartData.datasets}
                                  instrumentType="std"
                                  onMarkStability={
                                    isRemoteViewer
                                      ? null
                                      : handleMarkStability
                                  }
                                  activeChartView={activeChartView}
                                  setActiveChartView={setActiveChartView}
                                  selectedCycle={stdChartCycle}
                                  onCycleChange={setStdChartCycle}
                                  activeStage={activeStageKey}
                                />
                                <LiveStabilityTracker
                                  title="Standard Instrument Stability"
                                  readings={stdChartDataSource}
                                  activeStage={
                                    isCurrentTPActive
                                      ? activeCollectionDetails?.stage ||
                                      activeCollectionDetails?.readingKey
                                      : null
                                  }
                                  activeCycle={stdEffectiveCycle}
                                  activeChartView={activeChartView}
                                />

                              </div>
                            )}
                            {showTiChart && (
                              <div className="chart-container">
                                <CalibrationChart
                                  title="Test Instrument Readings"
                                  chartData={tiChartData}
                                  theme={theme}
                                  chartType="line"
                                  onHover={setHoveredIndex}
                                  syncedHoverIndex={hoveredIndex}
                                  comparisonData={stdChartData.datasets}
                                  instrumentType="ti"
                                  onMarkStability={
                                    isRemoteViewer
                                      ? null
                                      : handleMarkStability
                                  }
                                  activeChartView={activeChartView}
                                  setActiveChartView={setActiveChartView}
                                  selectedCycle={tiChartCycle}
                                  onCycleChange={setTiChartCycle}
                                  activeStage={activeStageKey}
                                />
                                <LiveStabilityTracker
                                  title="Test Instrument Stability"
                                  readings={tiChartDataSource}
                                  activeStage={
                                    isCurrentTPActive
                                      ? activeCollectionDetails?.stage ||
                                      activeCollectionDetails?.readingKey
                                      : null
                                  }
                                  activeCycle={tiEffectiveCycle}
                                  activeChartView={activeChartView}
                                />

                              </div>
                            )}
                            {/* One pair-level cycle statistics tracker for the
                                whole chart area (peer of the per-instrument
                                stability trackers above). */}
                            <div style={{ gridColumn: "1 / -1", width: "100%" }}>
                              <CycleStatisticsTracker
                                focusedTestPoint={focusedTP}
                                sessionId={selectedSessionId}
                                onDataUpdate={onDataUpdate}
                                title="AC-DC Difference Statistics"
                                defaultUseAbba={
                                  calibrationConfigurations?.use_abba_pairing === undefined
                                    ? true
                                    : Boolean(calibrationConfigurations.use_abba_pairing)
                                }
                              />
                            </div>
                          </div>
                        </>
                      )}
                      {activeTab === "calculate" && (
                        <section className="cal-calc-panel">
                          <header className="cal-calc-bar">
                            <div className="cal-calc-bar-meta" aria-live="polite">
                              <span className="cal-calc-bar-amps">
                                {focusedTP.current} A
                              </span>
                              <span className="cal-calc-bar-freq">
                                {formatFrequency(focusedTP.frequency)}
                              </span>
                            </div>
                            <div className="cal-calc-bar-actions">
                              {/* NEW ABBA TOGGLE */}
                              <div className="cal-results-pill-group" style={{ marginRight: "1rem" }}>
                                <button
                                  type="button"
                                  className={`cal-results-pill ${useAbba ? "is-active" : ""}`}
                                  onClick={() => setUseAbba(true)}
                                  title="Reverse Pairing (ABBA)"
                                >
                                  ABBA
                                </button>
                                <button
                                  type="button"
                                  className={`cal-results-pill ${!useAbba ? "is-active" : ""}`}
                                  onClick={() => setUseAbba(false)}
                                  title="Standard Index Pairing"
                                >
                                  Standard
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={handleOpenCorrectionModal}
                                disabled={
                                  isCalculatingAverages ||
                                  !isCalculationReady
                                }
                                className="cal-results-excel-icon-btn"
                                aria-label="Calculate AC-DC difference"
                                title={
                                  isCollecting || isBulkRunning
                                    ? "View correction inputs (editing disabled while running)"
                                    : "View or Edit Correction Inputs"
                                }
                              >
                                <FaCalculator aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="cal-results-excel-icon-btn"
                                aria-label="Export session to Excel"
                                title="Export session to Excel — AC–DC summary and all raw readings"
                                disabled={!uniqueTestPoints?.length}
                                onClick={handleExportSessionExcel}
                              >
                                <FaDownload aria-hidden />
                              </button>
                            </div>
                          </header>

                          {(() => {
                            // Pairing + headline stats come from the shared
                            // backend-canonical pair_analytics (via the hook),
                            // so any toggle (ABBA, exclude, filter) the user
                            // makes in the CycleStatisticsTracker is reflected
                            // here without any client-side recomputation.
                            const fwdCyclesArr = (focusedTP.forward?.results?.cycles || [])
                              .slice()
                              .sort((a, b) => (a.cycle_index || 0) - (b.cycle_index || 0));
                            const revCyclesArr = (focusedTP.reverse?.results?.cycles || [])
                              .slice()
                              .sort((a, b) => (a.cycle_index || 0) - (b.cycle_index || 0));

                            const cyclePairs = (cycleAnalytics.pairRows || []).map((r) => ({
                              i: r.pairNum,
                              fwd: r.fwdDelta != null ? Number(r.fwdDelta) : null,
                              rev: r.revDelta != null ? Number(r.revDelta) : null,
                              avg: r.pairedAvg != null ? Number(r.pairedAvg) : null,
                              isExcluded:
                                cycleAnalytics.manualExcluded.has(r.pairNum) ||
                                cycleAnalytics.autoExcluded.has(r.pairNum),
                              isFlagged: cycleAnalytics.flagged.has(r.pairNum),
                            }));

                            const pairMean = cycleAnalytics.stats?.mean ?? null;
                            const pairUA = cycleAnalytics.stats?.uA ?? null;

                            // Calculate Forward and Reverse independent means
                            let fwdMean = null, revMean = null, fwdUA = null, revUA = null;
                            const nPairs = Math.min(fwdCyclesArr.length, revCyclesArr.length);

                            if (fwdCyclesArr.length > 0) {
                              const vals = fwdCyclesArr
                                .filter((_, i) => !cycleAnalytics.manualExcluded.has(i + 1) && !cycleAnalytics.autoExcluded.has(i + 1))
                                .map(c => parseFloat(c.delta_uut_ppm))
                                .filter(v => !isNaN(v));

                              if (vals.length > 0) {
                                fwdMean = vals.reduce((a, b) => a + b, 0) / vals.length;
                                if (vals.length > 1) {
                                  const variance = vals.reduce((a, b) => a + Math.pow(b - fwdMean, 2), 0) / (vals.length - 1);
                                  fwdUA = Math.sqrt(variance) / Math.sqrt(vals.length);
                                }
                              }
                            } else {
                              fwdMean = focusedTP.forward?.results?.delta_uut_ppm != null ? parseFloat(focusedTP.forward.results.delta_uut_ppm) : null;
                            }

                            if (revCyclesArr.length > 0) {
                              const vals = revCyclesArr
                                .filter((_, i) => {
                                  // Find which pair this reverse cycle belongs to
                                  let pairNum = -1;
                                  if (i < nPairs) {
                                    pairNum = useAbba ? (nPairs - 1 - i) + 1 : i + 1;
                                  }
                                  return !cycleAnalytics.manualExcluded.has(pairNum) && !cycleAnalytics.autoExcluded.has(pairNum);
                                })
                                .map(c => parseFloat(c.delta_uut_ppm))
                                .filter(v => !isNaN(v));

                              if (vals.length > 0) {
                                revMean = vals.reduce((a, b) => a + b, 0) / vals.length;
                                if (vals.length > 1) {
                                  const variance = vals.reduce((a, b) => a + Math.pow(b - revMean, 2), 0) / (vals.length - 1);
                                  revUA = Math.sqrt(variance) / Math.sqrt(vals.length);
                                }
                              }
                            } else {
                              revMean = focusedTP.reverse?.results?.delta_uut_ppm != null ? parseFloat(focusedTP.reverse.results.delta_uut_ppm) : null;
                            }

                            // Fallback for old single-pass sessions
                            const legacyCombined =
                              (focusedTP.forward?.results?.delta_uut_ppm != null && focusedTP.reverse?.results?.delta_uut_ppm != null)
                                ? (parseFloat(focusedTP.forward.results.delta_uut_ppm) + parseFloat(focusedTP.reverse.results.delta_uut_ppm)) / 2
                                : null;

                            const overall = pairMean != null ? pairMean : legacyCombined;
                            const hasAny =
                              overall != null
                              || fwdMean != null
                              || revMean != null
                              || cyclePairs.length > 0;

                            return (
                              <>
                                {overall != null && (
                                  <button
                                    type="button"
                                    className="cal-calc-kpi cal-calc-kpi--primary cal-results-overview-card"
                                    onClick={() =>
                                      onOpenResultsDirection &&
                                      onOpenResultsDirection("Combined")
                                    }
                                    title="View combined results"
                                    aria-label="View combined results"
                                  >
                                    <p className="cal-calc-kpi-label">
                                      Final averaged AC–DC difference
                                    </p>
                                    <div className="cal-calc-kpi-value-row">
                                      <span className="cal-calc-kpi-num">
                                        {parseFloat(overall).toFixed(3)}
                                      </span>
                                      {pairUA != null && (
                                        <span className="cal-calc-kpi-uncertainty">
                                          &nbsp;±&nbsp;{Number(pairUA).toFixed(3)}
                                        </span>
                                      )}
                                      <span className="cal-calc-kpi-unit">ppm</span>
                                    </div>
                                    {cyclePairs.length > 0 && (
                                      <p className="cal-results-overview-caption">
                                        Mean across {
                                          cyclePairs.filter((p) => p.avg != null).length
                                        }{" "}
                                        paired cycle{
                                          cyclePairs.filter((p) => p.avg != null).length === 1
                                            ? ""
                                            : "s"
                                        }
                                      </p>
                                    )}
                                  </button>
                                )}

                                {/* NEW: Forward and Reverse Aggregate Cards */}
                                {(fwdMean != null || revMean != null) && (
                                  <div className="cal-calc-direction-grid" style={{ marginBottom: "20px" }}>
                                    {fwdMean != null && (
                                      <button
                                        type="button"
                                        className="cal-calc-kpi cal-results-overview-card"
                                        onClick={() => onOpenResultsDirection && onOpenResultsDirection("Forward")}
                                      >
                                        <p className="cal-calc-kpi-label">Forward Averaged AC–DC</p>
                                        <div className="cal-calc-kpi-value-row">
                                          <span className="cal-calc-kpi-num">{fwdMean.toFixed(3)}</span>
                                          {fwdUA != null && (
                                            <span className="cal-calc-kpi-uncertainty">&nbsp;±&nbsp;{fwdUA.toFixed(3)}</span>
                                          )}
                                          <span className="cal-calc-kpi-unit">ppm</span>
                                        </div>
                                      </button>
                                    )}
                                    {revMean != null && (
                                      <button
                                        type="button"
                                        className="cal-calc-kpi cal-results-overview-card"
                                        onClick={() => onOpenResultsDirection && onOpenResultsDirection("Reverse")}
                                      >
                                        <p className="cal-calc-kpi-label">Reverse Averaged AC–DC</p>
                                        <div className="cal-calc-kpi-value-row">
                                          <span className="cal-calc-kpi-num">{revMean.toFixed(3)}</span>
                                          {revUA != null && (
                                            <span className="cal-calc-kpi-uncertainty">&nbsp;±&nbsp;{revUA.toFixed(3)}</span>
                                          )}
                                          <span className="cal-calc-kpi-unit">ppm</span>
                                        </div>
                                      </button>
                                    )}
                                  </div>
                                )}

                                {cyclePairs.length > 0 && (
                                  <div className="cal-results-cycle-list">
                                    {cyclePairs.map((p) => (
                                      <div
                                        key={p.i}
                                        className={`cal-results-cycle-row${p.isExcluded ? " cal-results-cycle-row--excluded" : ""}${p.isFlagged && !p.isExcluded ? " cal-results-cycle-row--flagged" : ""}`}
                                        aria-label={`Cycle ${p.i} results${p.isExcluded ? " (excluded from average)" : ""}`}
                                        style={p.isExcluded ? { opacity: 0.45 } : undefined}
                                      >
                                        <span className="cal-results-cycle-label">
                                          Cycle {p.i}
                                          {p.isExcluded && (
                                            <span style={{ opacity: 0.75, fontSize: "0.8em", marginLeft: 6 }}>
                                              · excluded
                                            </span>
                                          )}
                                          {p.isFlagged && !p.isExcluded && (
                                            <span style={{ color: "var(--warning-color, #f39c12)", fontSize: "0.8em", marginLeft: 6 }}>
                                              · flagged
                                            </span>
                                          )}
                                        </span>
                                        <div className="cal-calc-direction-grid cal-results-cycle-cards">
                                          <button
                                            type="button"
                                            className={overviewCardClass(p.fwd == null)}
                                            onClick={() =>
                                              onOpenResultsDirection &&
                                              onOpenResultsDirection("Forward", p.i)
                                            }
                                            disabled={p.fwd == null}
                                            title={`View cycle ${p.i} forward breakdown`}
                                          >
                                            <p className="cal-calc-kpi-label">
                                              Forward · δ
                                            </p>
                                            <div className="cal-calc-kpi-value-row">
                                              <span className="cal-calc-kpi-num">
                                                {p.fwd != null ? p.fwd.toFixed(3) : "—"}
                                              </span>
                                              <span className="cal-calc-kpi-unit">
                                                ppm
                                              </span>
                                            </div>
                                          </button>
                                          <button
                                            type="button"
                                            className={overviewCardClass(p.rev == null)}
                                            onClick={() =>
                                              onOpenResultsDirection &&
                                              onOpenResultsDirection("Reverse", p.i)
                                            }
                                            disabled={p.rev == null}
                                            title={`View cycle ${p.i} reverse breakdown`}
                                          >
                                            <p className="cal-calc-kpi-label">
                                              Reverse · δ
                                            </p>
                                            <div className="cal-calc-kpi-value-row">
                                              <span className="cal-calc-kpi-num">
                                                {p.rev != null ? p.rev.toFixed(3) : "—"}
                                              </span>
                                              <span className="cal-calc-kpi-unit">
                                                ppm
                                              </span>
                                            </div>
                                          </button>
                                          <button
                                            type="button"
                                            className={overviewCardClass(p.avg == null, true)}
                                            onClick={() =>
                                              onOpenResultsDirection &&
                                              onOpenResultsDirection("Combined", p.i)
                                            }
                                            disabled={p.avg == null}
                                            title={`View cycle ${p.i} paired breakdown`}
                                          >
                                            <p className="cal-calc-kpi-label">
                                              Cycle avg · (Fwd + Rev) / 2
                                            </p>
                                            <div className="cal-calc-kpi-value-row">
                                              <span className="cal-calc-kpi-num">
                                                {p.avg != null ? p.avg.toFixed(3) : "—"}
                                              </span>
                                              <span className="cal-calc-kpi-unit">
                                                ppm
                                              </span>
                                            </div>
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {cyclePairs.length === 0 && hasAny && (
                                  <div className="cal-calc-direction-grid">
                                    {focusedTP.forward?.results?.delta_uut_ppm != null && (
                                      <button
                                        type="button"
                                        className="cal-calc-kpi cal-results-overview-card"
                                        onClick={() =>
                                          onOpenResultsDirection &&
                                          onOpenResultsDirection("Forward")
                                        }
                                        title="View forward results"
                                        aria-label="View forward results"
                                      >
                                        <p className="cal-calc-kpi-label">
                                          Forward · δ UUT
                                        </p>
                                        <div className="cal-calc-kpi-value-row">
                                          <span className="cal-calc-kpi-num">
                                            {parseFloat(
                                              focusedTP.forward.results.delta_uut_ppm
                                            ).toFixed(3)}
                                          </span>
                                          <span className="cal-calc-kpi-unit">
                                            ppm
                                          </span>
                                        </div>
                                      </button>
                                    )}
                                    {focusedTP.reverse?.results?.delta_uut_ppm != null && (
                                      <button
                                        type="button"
                                        className="cal-calc-kpi cal-results-overview-card"
                                        onClick={() =>
                                          onOpenResultsDirection &&
                                          onOpenResultsDirection("Reverse")
                                        }
                                        title="View reverse results"
                                        aria-label="View reverse results"
                                      >
                                        <p className="cal-calc-kpi-label">
                                          Reverse · δ UUT
                                        </p>
                                        <div className="cal-calc-kpi-value-row">
                                          <span className="cal-calc-kpi-num">
                                            {parseFloat(
                                              focusedTP.reverse.results.delta_uut_ppm
                                            ).toFixed(3)}
                                          </span>
                                          <span className="cal-calc-kpi-unit">
                                            ppm
                                          </span>
                                        </div>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </>
                            );
                          })()}

                          {!(
                            focusedTP.forward?.results?.delta_uut_ppm ||
                            focusedTP.reverse?.results?.delta_uut_ppm
                          ) && (
                              <div className="cal-calc-empty">
                                <h3 className="cal-calc-empty-title">
                                  No results yet
                                </h3>
                                <p className="cal-calc-empty-text">
                                  Finish readings for a direction, then use the
                                  Calculate button above to compute the AC–DC
                                  difference.
                                </p>
                              </div>
                            )}
                        </section>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {pairedRun?.awaitingFlip && (
        <div className="modal-overlay">
          <div
            className="paired-run-flip-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="paired-run-flip-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="paired-run-flip-title">Flip the AC-DC adapter</h3>
            <p>
              Forward pass complete. Physically flip the adapter so current
              flows in the opposite direction, then click <strong>Resume</strong>.
              The reverse pass will run the same test points in reverse order
              so linear drift across the run cancels in the paired result.
            </p>
            <div className="paired-run-flip-actions">
              <button
                type="button"
                className="paired-run-flip-abort"
                onClick={() => {
                  stopReadingCollection();
                }}
              >
                Abort
              </button>
              <button
                type="button"
                className="paired-run-flip-resume"
                onClick={() => {
                  sendWsCommand({ command: "paired_run_resume" });
                }}
              >
                Resume reverse pass
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Calibration;
