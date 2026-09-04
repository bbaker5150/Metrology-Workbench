import React, { useState, useEffect, useRef } from "react";
import { gsap } from "gsap";
import {
  FaStop,
  FaPlay,
  FaChevronDown,
  FaHourglassHalf,
  FaCrosshairs,
  FaStream,
} from "react-icons/fa";

const CalibrationStatusBar = ({
  activeRunningTP,
  focusedTP,
  formatCurrent,
  formatFrequency,
  isCollecting,
  isBulkRunning,
  bulkRunProgress,
  activeCollectionDetails,
  pairedRun,
  timerState,
  countdown,
  stabilizationStatus,
  stabilizationInfo,
  collectionProgress,
  getStageName,
  latestStdReading,
  latestTiReading,
  calibrationSettings,
  displayPpm,
  displayStdPpm,
  displayTiPpm,
  isStableNow,
  windowPhaseText,
  instabilityCount,
  maxRetries,
  stopReadingCollection,
  handleRunSelectedPoints,
  readingWsState,
  selectedTPs,
  dropdownOptions,
  isRemoteViewer,
}) => {
  // Pull the current cycle ordinal off the latest stage update broadcast.
  // Falls back to nothing when not in a multi-cycle run (e.g. legacy
  // single-direction collect, or characterization).
  const activeCycle = activeCollectionDetails?.cycle_index;
  const totalCycles =
    Math.max(
      1,
      parseInt(calibrationSettings?.n_cycles, 10) || 3,
    );
  const configuredCycleCount = parseInt(calibrationSettings?.n_cycles, 10) || 3;
  const showSingleStageRunOptions = configuredCycleCount === 1;
  const passDirection = pairedRun?.pass; // 'Forward' | 'Reverse' | null
  const [isRunDropdownOpen, setIsRunDropdownOpen] = useState(false);
  const runDropdownRef = useRef(null);
  const progressBarRef = useRef(null);
  const progressWidthTweenRef = useRef(null);
  const shimmerTweenRef = useRef(null);
  const stageLabelRef = useRef(null);
  const stageValueRef = useRef(null);
  const stageDetailRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        runDropdownRef.current &&
        !runDropdownRef.current.contains(event.target)
      ) {
        setIsRunDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!showSingleStageRunOptions) {
      setIsRunDropdownOpen(false);
    }
  }, [showSingleStageRunOptions]);

  // Hosts optimistically set isCollecting in startReadingCollection() before
  // warm-up; remotes only flip isCollecting on calibration_stage_update (after
  // warm-up). Include an active pre-measurement timer so observers still see
  // Warm-up / Settling in the status bar.
  const showRunActivity =
    isCollecting || isBulkRunning || Boolean(timerState?.isActive);

  // --- UNIFIED PROGRESS TRACKING ---
  // Always use the user's requested num_samples as the finish line
  const targetSamples = parseInt(calibrationSettings?.num_samples, 10) || 1;
  const currentCount = collectionProgress?.count || 0;

  // Clamp at 100% so the bar doesn't overflow if the backend overshoots slightly
  // to grab a perfect cycle boundary.
  const collectionProgressPercent = Math.min((currentCount / targetSamples) * 100, 100);

  const stageLabelText = timerState.isActive
    ? `${timerState.label}`
    : stabilizationStatus
      ? "Stabilizing"
      : "Collecting";

  const stageValueText = timerState.isActive
    ? (timerState.isIndeterminate ? "In progress" : `${countdown}s`)
    : getStageName();

  // Unified detail text for all collection modes
  const stageDetailText = timerState.isActive
    ? ""
    : stabilizationStatus && stabilizationInfo
      ? `Attempt: ${stabilizationInfo.count}`
      : `${currentCount} / ${targetSamples} Samples`;

  useEffect(() => {
    const animateNode = (node) => {
      if (!node) return;
      gsap.fromTo(
        node,
        { autoAlpha: 0, y: 4 },
        { autoAlpha: 1, y: 0, duration: 0.2, ease: "power2.out" }
      );
    };

    animateNode(stageLabelRef.current);
    animateNode(stageValueRef.current);
    animateNode(stageDetailRef.current);
  }, [stageLabelText, stageValueText, stageDetailText]);

  useEffect(() => {
    if (!progressBarRef.current) return;
    const targetPercent = showRunActivity
      ? Math.max(0, Math.min(collectionProgressPercent, 100))
      : 0;
    progressWidthTweenRef.current?.kill();

    if (showRunActivity && targetPercent >= 99.9) {
      progressWidthTweenRef.current = gsap.timeline({ overwrite: "auto" });
      progressWidthTweenRef.current
        .to(progressBarRef.current, {
          width: "100.6%",
          duration: 0.16,
          ease: "power2.out",
        })
        .to(progressBarRef.current, {
          width: "100%",
          duration: 0.18,
          ease: "power2.inOut",
        });
      return;
    }

    progressWidthTweenRef.current = gsap.to(progressBarRef.current, {
      width: `${targetPercent}%`,
      duration: 0.45,
      ease: "power2.out",
      overwrite: "auto",
    });
  }, [collectionProgressPercent, showRunActivity]);

  useEffect(() => {
    if (!progressBarRef.current) return;

    if (showRunActivity) {
      shimmerTweenRef.current?.kill();
      gsap.set(progressBarRef.current, { backgroundPosition: "100% 0%" });
      shimmerTweenRef.current = gsap.to(progressBarRef.current, {
        backgroundPosition: "-100% 0%",
        duration: 1.8,
        ease: "none",
        repeat: -1,
      });
      return;
    }

    shimmerTweenRef.current?.kill();
    shimmerTweenRef.current = null;
    gsap.set(progressBarRef.current, { backgroundPosition: "0% 0%" });
  }, [showRunActivity]);

  useEffect(
    () => () => {
      shimmerTweenRef.current?.kill();
      progressWidthTweenRef.current?.kill();
    },
    []
  );

  if (!activeRunningTP) return null;

  return (
    <div className="status-bar">
      <div className="status-bar-content">
        {/* --- READOUT SECTION --- */}
        <div className="status-section readout-section">
          <span className="status-label">
            {showRunActivity ? "Running Test Point" : "Test Point"}
          </span>
          <span className="status-value">
            {formatCurrent(activeRunningTP.current)}
          </span>
          <span className="status-detail">
            {formatFrequency(activeRunningTP.frequency)}
            {showRunActivity && activeCycle ? (
              <span className="status-cycle-pill" title="Active paired-cycle ordinal at this test point">
                {passDirection ? `${passDirection.charAt(0)}·` : ""}
                Cycle {activeCycle}
                {Number.isFinite(totalCycles) ? `/${totalCycles}` : ""}
              </span>
            ) : null}
          </span>
        </div>
        <div style={{ flexGrow: 1 }}></div>

        {/* --- DYNAMIC SECTIONS (Only show when collecting/running) --- */}
        {showRunActivity && (
          <>
            {isBulkRunning && (
              <div
                className="status-section"
                style={{ flexGrow: 1.5, borderRight: "1px solid var(--border-color)" }}
              >
                <span className="status-label">Batch Progress</span>
                <span className="status-value">{`Point ${bulkRunProgress.current} of ${bulkRunProgress.total}`}</span>
                <span className="status-detail">{`${formatCurrent(
                  activeRunningTP?.current
                )} @ ${formatFrequency(activeRunningTP?.frequency)}`}</span>
              </div>
            )}
            <div className="status-section">
              <span className="status-label" ref={stageLabelRef}>
                {timerState.isActive ? (
                  <>
                    <FaHourglassHalf /> {timerState.label}
                  </>
                ) : stabilizationStatus ? (
                  <>
                    <FaCrosshairs /> Stabilizing
                  </>
                ) : (
                  <>
                    <FaStream /> Collecting
                  </>
                )}
              </span>
              <span className="status-value" ref={stageValueRef}>
                {stageValueText}
              </span>

              {/* --- CLEANED UP JSX --- */}
              <span className="status-detail" ref={stageDetailRef}>
                {stageDetailText}
              </span>
            </div>

            {/* --- LIVE READINGS SECTION --- */}
            {!timerState.isActive && (latestStdReading || latestTiReading) && (
              <div className="status-section live-readout-section">
                <span className="status-label">
                  <FaStream /> Live Readings
                </span>
                <span className="status-value">
                  {latestStdReading
                    ? `STD: ${latestStdReading.y.toPrecision(7)} V`
                    : "STD: ..."}
                </span>
                <span className="status-detail">
                  {latestTiReading
                    ? `TI: ${latestTiReading.y.toPrecision(7)} V`
                    : "TI: ..."}
                </span>
              </div>
            )}

            {!timerState.isActive &&
              calibrationSettings.stability_check_method === "sliding_window" && (
                <div className="status-section window-stability-section">
                  <span className="status-label">
                    <FaCrosshairs /> Window Stability
                  </span>
                  <span
                    className={`window-ppm-value ${isStableNow ? "status-good" : "status-bad"
                      }`}
                  >
                    {displayStdPpm != null || displayTiPpm != null
                      ? [
                        displayStdPpm != null
                          ? `STD ${displayStdPpm.toFixed(2)}`
                          : null,
                        displayTiPpm != null
                          ? `TI ${displayTiPpm.toFixed(2)}`
                          : null,
                      ].filter(Boolean).join(" · ") + " PPM"
                      : displayPpm != null
                        ? `${displayPpm.toFixed(2)} PPM`
                        : "..."}
                  </span>
                  <span className="status-detail">
                    {`${windowPhaseText} | Retries: ${instabilityCount}/${maxRetries} | Thresh: ${calibrationSettings.stability_threshold_ppm} PPM`}
                  </span>
                </div>
              )}
          </>
        )}
      </div>

      {/* --- CONDITIONAL PROGRESS BAR, STOP BUTTON, OR PLAY BUTTON --- */}
      {/*
        Remote viewers intentionally get no action affordance here. The
        header's "OBSERVING" pill and dimmed sidebar toolbar already signal
        the read-only state, so repeating "Observing — controls disabled"
        next to the progress bar was visual noise. We just omit the action
        slot entirely and let the progress bar (or live readout) breathe.
      */}
      {showRunActivity ? (
        <>
          <div className="status-bar-progress-container">
            <div ref={progressBarRef} className="status-bar-progress"></div>
          </div>
          {!isRemoteViewer && (
            <div className="status-bar-action">
              <button
                onClick={stopReadingCollection}
                className="button-stop"
                title="Stop Collection"
              >
                <FaStop />
              </button>
            </div>
          )}
        </>
      ) : isRemoteViewer ? null : (
        <div className="status-bar-action">
          <div className="premium-action-button-container" ref={runDropdownRef}>
            <div className="premium-action-button-wrapper">
              <button
                className="button premium-action-button-primary"
                onClick={handleRunSelectedPoints}
                disabled={
                  !focusedTP ||
                  readingWsState !== WebSocket.OPEN ||
                  selectedTPs.size === 0
                }
                title="Run Selected Points"
              >
                <FaPlay />
              </button>
              {showSingleStageRunOptions && (
                <button
                  className="button premium-action-button-caret"
                  onClick={() => setIsRunDropdownOpen((prev) => !prev)}
                  disabled={!focusedTP || readingWsState !== WebSocket.OPEN}
                  title="More run options"
                >
                  <FaChevronDown />
                </button>
              )}
            </div>
            {showSingleStageRunOptions && isRunDropdownOpen && (
              <div className="premium-action-button-menu">
                {dropdownOptions.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => {
                      opt.onClick();
                      setIsRunDropdownOpen(false);
                    }}
                    className="premium-action-button-item"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CalibrationStatusBar;
