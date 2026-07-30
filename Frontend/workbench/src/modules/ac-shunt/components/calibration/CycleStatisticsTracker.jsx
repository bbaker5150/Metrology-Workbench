// src/components/calibration/CycleStatisticsTracker.jsx
//
// Thin renderer over `useCycleAnalytics`. All pairing, outlier filtering,
// and exclusion math lives on the backend (CalibrationResults.recompute_
// pair_aggregate) and is shared with the Calculations subtab and the
// Calibration calculate tab via the same hook — so the numbers cannot
// diverge across views.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { FaCog, FaInfoCircle } from "react-icons/fa";
import katex from "katex";
import "katex/dist/katex.min.css";
import useCycleAnalytics from "../../hooks/useCycleAnalytics";
import { useTheme } from "../../../../shared/ThemeContext";
import {
  TYPE_A_COVERAGE_FACTOR,
  expandedTypeAUncertainty,
} from "../../utils/uncertaintyPresentation";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const SIGMA_BAND_OPTIONS = [1, 2, 3, 4, 5, 6];
const DEFAULT_SIGMA_BANDS = new Set([1]);

/** Legend-hidden by default; persisted in state so toggles survive chart re-renders. */
const DEFAULT_HIDDEN_DATASETS = {
  "Excluded / filtered": true,
  Drift: true,
  "Standard Deviation σ": true,
};

const fmt = (val, digits = 4) => {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return "—";
  const n = Number(val);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
};

const isFiniteNumber = (val) => Number.isFinite(Number(val));

const sampleStdDev = (values) => {
  if (!values || values.length < 2) return null;
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance =
    values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    (values.length - 1);
  return Math.sqrt(variance);
};

const linearRegression = (points) => {
  if (!points || points.length < 2) return null;
  const n = points.length;
  const sumX = points.reduce((sum, point) => sum + point.x, 0);
  const sumY = points.reduce((sum, point) => sum + point.y, 0);
  const sumXY = points.reduce((sum, point) => sum + point.x * point.y, 0);
  const sumXX = points.reduce((sum, point) => sum + point.x * point.x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
};

// Inline KaTeX renderer for the column-header formulae. Rendered at render
// time (not after mount) so they don't pop in during accordion expand.
const Tex = React.memo(({ tex }) => {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: false, throwOnError: false, strict: "ignore" });
    } catch {
      return "";
    }
  }, [tex]);
  return <span className="cycle-stats-tex" dangerouslySetInnerHTML={{ __html: html }} />;
});

const FormulaInfo = React.memo(({ tex, label }) => (
  <span className="cycle-stats-formula-info" tabIndex={0} aria-label={label || "Equation"}>
    <FaInfoCircle aria-hidden />
    <span className="cycle-stats-formula-tooltip" role="tooltip">
      <Tex tex={tex} />
    </span>
  </span>
));

function CycleStatisticsTracker({
  focusedTestPoint,
  sessionId,
  onDataUpdate,
  defaultUseAbba = true,
  title = "AC-DC Difference Statistics",
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [activeView, setActiveView] = useState("trend");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [cycleRangeStart, setCycleRangeStart] = useState("");
  const [cycleRangeEnd, setCycleRangeEnd] = useState("");
  const [sigmaBands, setSigmaBands] = useState(() => new Set(DEFAULT_SIGMA_BANDS));
  const [hiddenDatasets, setHiddenDatasets] = useState(
    () => ({ ...DEFAULT_HIDDEN_DATASETS })
  );
  const settingsMenuRef = useRef(null);
  const { theme } = useTheme();
  const {
    useAbba,
    filterMode,
    manualExcluded,
    autoExcluded,
    flagged,
    pairRows,
    stats,
    setUseAbba,
    setFilterMode,
    toggleExclusion,
  } = useCycleAnalytics({
    focusedTestPoint,
    sessionId,
    onDataUpdate,
    defaultUseAbba,
  });

  const fwdCount = focusedTestPoint?.forward?.results?.cycles?.length || 0;
  const revCount = focusedTestPoint?.reverse?.results?.cycles?.length || 0;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        settingsMenuRef.current &&
        !settingsMenuRef.current.contains(event.target)
      ) {
        setIsSettingsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setCycleRangeStart("");
    setCycleRangeEnd("");
    setSigmaBands(new Set(DEFAULT_SIGMA_BANDS));
    setHiddenDatasets({ ...DEFAULT_HIDDEN_DATASETS });
  }, [focusedTestPoint]);

  const isDatasetHidden = useCallback(
    (label) => Boolean(hiddenDatasets[label]),
    [hiddenDatasets]
  );

  const handleLegendClick = useCallback((evt, legendItem, legend) => {
    const chart = legend.chart;
    const index = legendItem.datasetIndex;
    const label = chart.data.datasets[index]?.label;
    if (!label) return;

    const wasVisible = chart.isDatasetVisible(index);
    chart.setDatasetVisibility(index, !wasVisible);
    setHiddenDatasets((prev) => ({
      ...prev,
      [label]: wasVisible,
    }));
  }, []);

  const toggleSigmaBand = (level) => {
    setSigmaBands((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  // Sample σ for the "Sample σ (s)" card. Backend gives us u_A = s/√N, so
  // multiply back; null when only one survivor.
  const sampleStd =
    stats.uA != null && stats.n > 1 ? stats.uA * Math.sqrt(stats.n) : null;
  const expandedTypeA = expandedTypeAUncertainty(stats.uA);

  const chartPalette = useMemo(() => {
    const dark = theme === "dark";
    return {
      included: dark ? "#22d3ee" : "#0ea5e9",
      includedFill: dark ? "rgba(34, 211, 238, 0.2)" : "rgba(14, 165, 233, 0.16)",
      includedGlow: dark ? "rgba(103, 232, 249, 0.75)" : "rgba(56, 189, 248, 0.5)",
      excluded: dark ? "rgba(148, 163, 184, 0.5)" : "rgba(100, 116, 139, 0.48)",
      excludedFill: dark ? "rgba(148, 163, 184, 0.78)" : "rgba(100, 116, 139, 0.72)",
      flagged: dark ? "#f59e0b" : "#d97706",
      flaggedFill: dark ? "rgba(251, 191, 36, 0.92)" : "rgba(217, 119, 6, 0.86)",
      mean: dark ? "#34d399" : "#059669",
      meanFill: dark ? "rgba(52, 211, 153, 0.28)" : "rgba(5, 150, 105, 0.16)",
      drift: dark ? "#fbbf24" : "#d97706",
      driftFill: dark ? "rgba(251, 191, 36, 0.2)" : "rgba(217, 119, 6, 0.14)",
      sigmaByLevel: [
        {
          stroke: dark ? "#fb7185" : "#e11d48",
          fill: dark ? "rgba(251, 113, 133, 0.18)" : "rgba(225, 29, 72, 0.12)",
        },
        {
          stroke: dark ? "#fbbf24" : "#d97706",
          fill: dark ? "rgba(251, 191, 36, 0.18)" : "rgba(217, 119, 6, 0.12)",
        },
        {
          stroke: dark ? "#a78bfa" : "#7c3aed",
          fill: dark ? "rgba(167, 139, 250, 0.18)" : "rgba(124, 58, 237, 0.12)",
        },
        {
          stroke: dark ? "#38bdf8" : "#0284c7",
          fill: dark ? "rgba(56, 189, 248, 0.18)" : "rgba(14, 165, 233, 0.12)",
        },
        {
          stroke: dark ? "#34d399" : "#059669",
          fill: dark ? "rgba(52, 211, 153, 0.18)" : "rgba(5, 150, 105, 0.12)",
        },
        {
          stroke: dark ? "#f472b6" : "#db2777",
          fill: dark ? "rgba(244, 114, 182, 0.18)" : "rgba(219, 39, 119, 0.12)",
        },
      ],
      running: dark ? "#a78bfa" : "#7c3aed",
      runningFill: dark ? "rgba(167, 139, 250, 0.2)" : "rgba(124, 58, 237, 0.14)",
      axis: dark ? "rgba(226, 232, 240, 0.78)" : "rgba(51, 65, 85, 0.82)",
      grid: dark ? "rgba(148, 163, 184, 0.16)" : "rgba(100, 116, 139, 0.14)",
      gridStrong: dark ? "rgba(148, 163, 184, 0.24)" : "rgba(100, 116, 139, 0.2)",
      tooltipBg: dark ? "rgba(15, 23, 42, 0.96)" : "rgba(255, 255, 255, 0.96)",
      tooltipText: dark ? "#e2e8f0" : "#0f172a",
      tooltipBorder: dark ? "rgba(34, 211, 238, 0.35)" : "rgba(14, 165, 233, 0.28)",
      pointHalo: dark ? "rgba(15, 23, 42, 0.95)" : "rgba(255, 255, 255, 0.95)",
    };
  }, [theme]);

  const chartRows = useMemo(() => {
    return pairRows.map((row) => {
      const isAuto = autoExcluded.has(row.pairNum);
      const isManual = manualExcluded.has(row.pairNum);
      const isExcluded = isAuto || isManual;
      const isFlagged = flagged.has(row.pairNum);
      return {
        ...row,
        value: isFiniteNumber(row.pairedAvg) ? Number(row.pairedAvg) : null,
        isAuto,
        isManual,
        isExcluded,
        isFlagged,
      };
    });
  }, [autoExcluded, flagged, manualExcluded, pairRows]);

  const pairBounds = useMemo(() => {
    const nums = pairRows
      .map((row) => Number(row.pairNum))
      .filter((n) => Number.isFinite(n));
    if (!nums.length) return { min: 1, max: 1 };
    return { min: Math.min(...nums), max: Math.max(...nums) };
  }, [pairRows]);

  const cycleRangeInvalid = useMemo(() => {
    const start = cycleRangeStart === "" ? null : Number(cycleRangeStart);
    const end = cycleRangeEnd === "" ? null : Number(cycleRangeEnd);
    return (
      start != null &&
      end != null &&
      !Number.isNaN(start) &&
      !Number.isNaN(end) &&
      start > end
    );
  }, [cycleRangeStart, cycleRangeEnd]);

  const visibleChartRows = useMemo(() => {
    if (cycleRangeInvalid) return [];
    const start = cycleRangeStart === "" ? null : Number(cycleRangeStart);
    const end = cycleRangeEnd === "" ? null : Number(cycleRangeEnd);
    return chartRows.filter((row) => {
      const pairNum = Number(row.pairNum);
      if (start != null && !Number.isNaN(start) && pairNum < start) return false;
      if (end != null && !Number.isNaN(end) && pairNum > end) return false;
      return true;
    });
  }, [chartRows, cycleRangeStart, cycleRangeEnd, cycleRangeInvalid]);

  const chartSummary = useMemo(() => {
    const included = visibleChartRows.filter((row) => row.value != null && !row.isExcluded);
    const includedValues = included.map((row) => row.value);
    const mean = stats.mean != null ? Number(stats.mean) : null;
    const residuals = mean != null
      ? includedValues.map((value) => Math.abs(value - mean))
      : [];
    const stdDev = sampleStdDev(includedValues);
    return {
      range: includedValues.length
        ? Math.max(...includedValues) - Math.min(...includedValues)
        : null,
      maxResidual: residuals.length ? Math.max(...residuals) : null,
      slope: linearRegression(
        included.map((row) => ({ x: row.pairNum, y: row.value }))
      )?.slope ?? null,
      stdDev,
      variance: stdDev != null ? stdDev * stdDev : null,
    };
  }, [visibleChartRows, stats.mean]);

  const runningSigmaByPair = useMemo(() => {
    const values = [];
    const sigmaMap = new Map();
    visibleChartRows.forEach((row) => {
      if (row.value == null || row.isExcluded) {
        sigmaMap.set(row.pairNum, null);
        return;
      }
      values.push(row.value);
      sigmaMap.set(row.pairNum, sampleStdDev(values));
    });
    return sigmaMap;
  }, [visibleChartRows]);

  const chartData = useMemo(() => {
    const meanLine = stats.mean != null ? visibleChartRows.map(() => Number(stats.mean)) : [];
    const mean = stats.mean != null ? Number(stats.mean) : null;

    const includedForFit = visibleChartRows.filter(
      (row) => row.value != null && !row.isExcluded
    );
    const driftFit = linearRegression(
      includedForFit.map((row) => ({ x: row.pairNum, y: row.value }))
    );
    const driftLine = driftFit
      ? visibleChartRows.map((row) => driftFit.intercept + driftFit.slope * row.pairNum)
      : visibleChartRows.map(() => null);

    const sigmaBandDatasets = [];
    if (mean != null && sampleStd != null) {
      const sortedLevels = [...sigmaBands].sort((a, b) => a - b);
      sortedLevels.forEach((level) => {
        const offset = level * sampleStd;
        const bandColors =
          chartPalette.sigmaByLevel[level - 1] ?? chartPalette.sigmaByLevel[0];
        const bandStyle = {
          borderColor: bandColors.stroke,
          backgroundColor: bandColors.fill,
          pointRadius: 0,
          borderWidth: level === 1 ? 1.8 : Math.max(1.1, 1.8 - (level - 1) * 0.2),
          borderDash: level === 1 ? [8, 5] : [5, 5],
          tension: 0,
        };
        sigmaBandDatasets.push(
          {
            label: `+${level} σ`,
            data: visibleChartRows.map(() => mean + offset),
            ...bandStyle,
          },
          {
            label: `-${level} σ`,
            data: visibleChartRows.map(() => mean - offset),
            ...bandStyle,
          }
        );
      });
    }

    return {
      labels: visibleChartRows.map((row) => String(row.pairNum)),
      datasets: [
        {
          label: "Cycle AC-DC Difference",
          data: visibleChartRows.map((row) => (!row.isExcluded ? row.value : null)),
          borderColor: chartPalette.included,
          backgroundColor: chartPalette.includedFill,
          pointBackgroundColor: chartPalette.included,
          pointBorderColor: chartPalette.pointHalo,
          pointBorderWidth: 2,
          pointRadius: 4.5,
          pointHoverRadius: 7,
          pointHoverBorderColor: chartPalette.includedGlow,
          pointHoverBorderWidth: 3,
          borderWidth: 2.75,
          tension: 0.32,
          spanGaps: false,
        },
        {
          label: "Mean",
          data: meanLine,
          borderColor: chartPalette.mean,
          backgroundColor: chartPalette.meanFill,
          pointRadius: 0,
          borderWidth: 2.5,
          tension: 0,
        },
        ...sigmaBandDatasets,
        {
          label: "Excluded / filtered",
          data: visibleChartRows.map((row) =>
            row.isExcluded || row.isFlagged ? row.value : null
          ),
          borderColor: chartPalette.flagged,
          backgroundColor: chartPalette.flaggedFill,
          pointBackgroundColor: chartPalette.flagged,
          pointBorderColor: chartPalette.pointHalo,
          pointBorderWidth: 2.5,
          pointRadius: 7,
          pointHoverRadius: 9,
          pointHoverBorderColor: chartPalette.flagged,
          pointHoverBorderWidth: 3,
          pointStyle: "triangle",
          showLine: false,
          hidden: isDatasetHidden("Excluded / filtered"),
        },
        {
          label: "Drift",
          data: driftLine,
          borderColor: chartPalette.drift,
          backgroundColor: chartPalette.driftFill,
          pointRadius: 0,
          borderWidth: 2.25,
          borderDash: [6, 4],
          tension: 0,
          hidden: isDatasetHidden("Drift"),
        },
        {
          label: "Standard Deviation σ",
          data: visibleChartRows.map((row) => runningSigmaByPair.get(row.pairNum)),
          borderColor: chartPalette.running,
          backgroundColor: chartPalette.runningFill,
          pointBackgroundColor: chartPalette.running,
          pointBorderColor: chartPalette.pointHalo,
          pointBorderWidth: 2,
          pointRadius: 3.5,
          pointHoverRadius: 6,
          borderWidth: 2.5,
          tension: 0.34,
          yAxisID: "ySigma",
          hidden: isDatasetHidden("Standard Deviation σ"),
        },
      ],
    };
  }, [
    chartPalette,
    visibleChartRows,
    runningSigmaByPair,
    sampleStd,
    sigmaBands,
    stats.mean,
    isDatasetHidden,
  ]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    plugins: {
      legend: {
        position: "bottom",
        onClick: handleLegendClick,
        labels: {
          boxWidth: 12,
          usePointStyle: true,
          color: chartPalette.axis,
          padding: 16,
        },
      },
      tooltip: {
        backgroundColor: chartPalette.tooltipBg,
        borderColor: chartPalette.tooltipBorder,
        borderWidth: 1,
        titleColor: chartPalette.tooltipText,
        bodyColor: chartPalette.tooltipText,
        displayColors: true,
        padding: 12,
        callbacks: {
          label: (context) => {
            const label = context.dataset.label || "";
            const value = context.parsed.y;
            if (!Number.isFinite(value)) return label;
            return `${label}: ${fmt(value, 4)} ppm`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        title: { display: true, text: "Cycle", color: chartPalette.axis },
        ticks: { color: chartPalette.axis, maxRotation: 0 },
      },
      y: {
        title: {
          display: true,
          text: "Cycle delta (ppm)",
          color: chartPalette.axis,
          font: { size: 16, weight: "bold" },
        },
        ticks: { color: chartPalette.axis },
        grid: { color: chartPalette.grid },
        border: { color: chartPalette.gridStrong },
      },
      ySigma: {
        position: "right",
        title: {
          display: true,
          text: "Standard Deviation σ (ppm)",
          color: chartPalette.axis,
          font: { size: 16, weight: "bold" },
        },
        ticks: { color: chartPalette.axis },
        grid: { drawOnChartArea: false },
        border: { color: chartPalette.gridStrong },
        suggestedMin: 0,
      },
    },
  }), [chartPalette, handleLegendClick]);

  if (fwdCount === 0 && revCount === 0) return null;

  return (
    <div className="accordion-card" style={{ marginTop: "20px" }}>
      <div
        className="accordion-header"
        onClick={() => setIsOpen(!isOpen)}
        style={{ display: "flex", alignItems: "center" }}
      >
        <h4 style={{ flex: 1, margin: 0 }}>{title}</h4>

        <div style={{ flex: 2, textAlign: "center", fontWeight: 600, fontSize: "0.95rem", letterSpacing: "0.3px" }}>
          {stats.mean != null ? fmt(stats.mean, 4) : "—"}
          {expandedTypeA != null ? ` ± ${fmt(expandedTypeA, 4)}` : ""} ppm
          {stats.n > 0 && (
            <span style={{ opacity: 0.7, fontWeight: "normal", marginLeft: "4px" }}>
              · k = {TYPE_A_COVERAGE_FACTOR} · N = {stats.n}
            </span>
          )}
        </div>

        <div className="header-controls" style={{ flex: 1, display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
          <div
            className="chart-options-container cycle-stats-settings-menu"
            ref={settingsMenuRef}
            onClick={(e) => e.stopPropagation()}
            style={{ marginRight: "12px" }}
          >
            <button
              type="button"
              title="Cycle Statistics Options"
              className="chart-options-button"
              onClick={() => setIsSettingsOpen((prev) => !prev)}
            >
              <FaCog />
            </button>
            {isSettingsOpen && (
              <div className="chart-options-dropdown cycle-stats-settings-dropdown">
                <div className="cycle-stats-settings-panel">
                  <p className="cycle-stats-settings-title">Options</p>

                  <div className="cycle-stats-settings-block">
                    <span className="cycle-stats-settings-label">View</span>
                    <div className="unit-toggle cycle-stats-settings-toggle">
                      <button
                        type="button"
                        className={activeView === "table" ? "active" : ""}
                        onClick={() => setActiveView("table")}
                      >
                        Table
                      </button>
                      <button
                        type="button"
                        className={activeView === "trend" ? "active" : ""}
                        onClick={() => setActiveView("trend")}
                      >
                        Chart
                      </button>
                    </div>
                  </div>

                  <div className="cycle-stats-settings-block">
                    <span className="cycle-stats-settings-label">Pairing</span>
                    <div className="unit-toggle cycle-stats-settings-toggle">
                      <button
                        type="button"
                        title="ABBA reverse pairing"
                        className={useAbba ? "active" : ""}
                        onClick={() => setUseAbba(true)}
                      >
                        ABBA
                      </button>
                      <button
                        type="button"
                        title="Standard index pairing"
                        className={!useAbba ? "active" : ""}
                        onClick={() => setUseAbba(false)}
                      >
                        Standard
                      </button>
                    </div>
                  </div>

                  <label
                    className={`cycle-stats-settings-check${filterMode === "auto" ? " is-powered" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={filterMode === "auto"}
                      onChange={(e) => setFilterMode(e.target.checked ? "auto" : "none")}
                    />
                    <span className="cycle-stats-settings-check-box" aria-hidden>
                      <svg
                        className="cycle-stats-settings-check-icon"
                        viewBox="0 0 12 10"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M1 5.2 4.2 8.2 11 1.2"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <span className="cycle-stats-settings-check-copy">
                      <span className="cycle-stats-settings-check-title">Auto-filter</span>
                      <span className="cycle-stats-settings-check-desc">Chauvenet / IQR</span>
                    </span>
                  </label>

                  {activeView === "trend" && (
                    <>
                      <hr className="cycle-stats-settings-divider" />

                      <div className="cycle-stats-settings-block">
                        <span className="cycle-stats-settings-label">Sigma bands</span>
                        <div className="cycle-stats-sigma-chips">
                          {SIGMA_BAND_OPTIONS.map((level) => {
                            const bandColor =
                              chartPalette.sigmaByLevel[level - 1] ??
                              chartPalette.sigmaByLevel[0];
                            const isActive = sigmaBands.has(level);
                            return (
                              <button
                                key={level}
                                type="button"
                                className={`cycle-stats-sigma-chip${isActive ? " is-active" : ""}`}
                                style={{ "--chip-color": bandColor.stroke }}
                                aria-pressed={isActive}
                                onClick={() => toggleSigmaBand(level)}
                              >
                                ±{level} σ
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="cycle-stats-settings-block">
                        <span className="cycle-stats-settings-label">Chart pairs</span>
                        <div className="cycle-stats-range-row">
                          <input
                            id="cycleRangeStart"
                            type="number"
                            className="cycle-stats-range-input"
                            min={pairBounds.min}
                            max={pairBounds.max}
                            value={cycleRangeStart}
                            placeholder={String(pairBounds.min)}
                            aria-label="First pair number"
                            onChange={(e) => setCycleRangeStart(e.target.value)}
                          />
                          <span className="cycle-stats-range-sep" aria-hidden>
                            –
                          </span>
                          <input
                            id="cycleRangeEnd"
                            type="number"
                            className="cycle-stats-range-input"
                            min={pairBounds.min}
                            max={pairBounds.max}
                            value={cycleRangeEnd}
                            placeholder={String(pairBounds.max)}
                            aria-label="Last pair number"
                            onChange={(e) => setCycleRangeEnd(e.target.value)}
                          />
                        </div>
                        <p
                          className={`cycle-stats-settings-hint${cycleRangeInvalid ? " is-error" : ""}`}
                        >
                          {cycleRangeInvalid
                            ? "Start pair must be ≤ end pair."
                            : `Leave blank for all pairs (${pairBounds.min}–${pairBounds.max}).`}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          <span className={`accordion-icon ${isOpen ? "open" : ""}`}>▼</span>
        </div>
      </div>

      {isOpen && (
        <div className="accordion-content">
          <div className="stats-grid">
            <div className="stat-card">
              <h6>
                Mean of Cycles &delta; (x&#772;)
                <FormulaInfo
                  tex={"\\bar{x} = \\frac{1}{N}\\sum_{i=1}^{N} \\delta_i"}
                  label="Mean paired delta equation"
                />
              </h6>
              <div className="stat-details">
                <div style={{ width: "100%", display: "flex", justifyContent: "space-between" }}>
                  <strong>Value:</strong>
                  <span style={{ color: "var(--primary-color)", fontWeight: 600 }}>
                    {stats.mean != null ? `${fmt(stats.mean, 4)} ppm` : "—"}
                  </span>
                </div>
              </div>
            </div>
            <div className="stat-card">
              <h6>
                Type A Uncertainty
                <FormulaInfo
                  tex={"u_A = \\frac{s}{\\sqrt{N}}, \\qquad U_A = 2u_A"}
                  label="Type A standard and expanded uncertainty equations"
                />
              </h6>
              <div className="stat-details">
                <div style={{ width: "100%", display: "flex", justifyContent: "space-between" }}>
                  <strong>Standard (k = 1):</strong>
                  <span style={{ color: "var(--primary-color)", fontWeight: 600 }}>
                    {stats.uA != null ? `${fmt(stats.uA, 4)} ppm` : "—"}
                  </span>
                </div>
                <div style={{ width: "100%", display: "flex", justifyContent: "space-between" }}>
                  <strong>Expanded (k = 2):</strong>
                  <span style={{ color: "var(--primary-color)", fontWeight: 600 }}>
                    {expandedTypeA != null ? `± ${fmt(expandedTypeA, 4)} ppm` : "—"}
                  </span>
                </div>
              </div>
            </div>
            <div className="stat-card">
              <h6>
                Standard Deviation &sigma; (s)
                <FormulaInfo
                  tex={"s = \\sqrt{\\frac{1}{N-1}\\sum_{i=1}^{N} (\\delta_i - \\bar{x})^2}"}
                  label="Sample standard deviation equation"
                />
              </h6>
              <div className="stat-details">
                <div style={{ width: "100%", display: "flex", justifyContent: "space-between" }}>
                  <strong>Value:</strong>
                  <span style={{ color: "var(--primary-color)", fontWeight: 600 }}>
                    {sampleStd != null ? `${fmt(sampleStd, 4)} ppm` : "—"}
                  </span>
                </div>
              </div>
            </div>
            <div className="stat-card">
              <h6>
                N Cycles
                <FormulaInfo
                  tex={"N = \\#\\{\\text{surviving pairs}\\}"}
                  label="Surviving pairs equation"
                />
              </h6>
              <div className="stat-details">
                <div style={{ width: "100%", display: "flex", justifyContent: "space-between" }}>
                  <strong>Count:</strong>
                  <span style={{ color: "var(--primary-color)", fontWeight: 600 }}>
                    {stats.n}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {activeView === "trend" ? (
            <div className="cycle-stats-chart-panel">
              <div className="cycle-stats-chart">
                {visibleChartRows.length > 0 ? (
                  <Line data={chartData} options={chartOptions} />
                ) : (
                  <div className="cycle-stats-chart-empty">
                    {cycleRangeInvalid
                      ? "Start pair must be less than or equal to end pair."
                      : "No pairs in this cycle range."}
                  </div>
                )}
              </div>
              <div className="cycle-stats-insight-grid">
                <div className="stat-card cycle-stats-insight-card">
                  <h6>
                    Range
                    <FormulaInfo
                      tex={"R = \\max(\\delta_i) - \\min(\\delta_i)"}
                      label="Range equation"
                    />
                  </h6>
                  <div className="stat-details">
                    <div style={{ width: "100%", display: "flex", justifyContent: "space-between" }}>
                      <strong>Value:</strong>
                      <span style={{ color: "var(--primary-color)", fontWeight: 600 }}>
                        {chartSummary.range != null ? `${fmt(chartSummary.range, 4)} ppm` : "—"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="stat-card cycle-stats-insight-card">
                  <h6>
                    Variance
                    <FormulaInfo
                      tex={"s^2 = \\frac{1}{N-1}\\sum_{i=1}^{N}(\\delta_i - \\bar{x})^2"}
                      label="Variance equation"
                    />
                  </h6>
                  <div className="stat-details">
                    <div style={{ width: "100%", display: "flex", justifyContent: "space-between" }}>
                      <strong>Value:</strong>
                      <span style={{ color: "var(--primary-color)", fontWeight: 600 }}>
                        {chartSummary.variance != null ? `${fmt(chartSummary.variance, 5)} ppm^2` : "—"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="stat-card cycle-stats-insight-card">
                  <h6>
                    Max residual
                    <FormulaInfo
                      tex={"r_{\\max} = \\max_i |\\delta_i - \\bar{x}|"}
                      label="Max residual equation"
                    />
                  </h6>
                  <div className="stat-details">
                    <div style={{ width: "100%", display: "flex", justifyContent: "space-between" }}>
                      <strong>Value:</strong>
                      <span style={{ color: "var(--primary-color)", fontWeight: 600 }}>
                        {chartSummary.maxResidual != null ? `${fmt(chartSummary.maxResidual, 4)} ppm` : "—"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="stat-card cycle-stats-insight-card">
                  <h6>
                    Drift slope
                    <FormulaInfo
                      tex={"m = \\frac{N\\sum c_i\\delta_i - (\\sum c_i)(\\sum \\delta_i)}{N\\sum c_i^2 - (\\sum c_i)^2}"}
                      label="Drift slope equation"
                    />
                  </h6>
                  <div className="stat-details">
                    <div style={{ width: "100%", display: "flex", justifyContent: "space-between" }}>
                      <strong>Value:</strong>
                      <span style={{ color: "var(--primary-color)", fontWeight: 600 }}>
                        {chartSummary.slope != null ? `${fmt(chartSummary.slope, 4)} ppm/cycle` : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
          <div className="cycle-stats-table-container">
            <table className="styled-table styled-table--centered">
              <thead>
                <tr>
                  <th>Pair #</th>
                  <th>Forward δ</th>
                  <th>Reverse δ</th>
                  <th>Paired Avg (ppm)</th>
                  <th>Status / Action</th>
                </tr>
              </thead>
              <tbody>
                {pairRows.map((row) => {
                  const isAuto = autoExcluded.has(row.pairNum);
                  const isManual = manualExcluded.has(row.pairNum);
                  const isExcluded = isAuto || isManual;
                  const isFlagged = flagged.has(row.pairNum);

                  return (
                    <tr key={row.pairNum} style={{ opacity: isExcluded ? 0.45 : 1, transition: "opacity 0.2s" }}>
                      <td>{row.pairNum}</td>
                      <td>
                        {row.fwdDelta != null ? (
                          <>
                            {fmt(row.fwdDelta, 4)}{" "}
                            <span style={{ opacity: 0.6, fontSize: "0.85em" }}>(Cy {row.fwdCycleNum})</span>
                          </>
                        ) : "—"}
                      </td>
                      <td>
                        {row.revDelta != null ? (
                          <>
                            {fmt(row.revDelta, 4)}{" "}
                            <span style={{ opacity: 0.6, fontSize: "0.85em" }}>(Cy {row.revCycleNum})</span>
                          </>
                        ) : "—"}
                      </td>
                      <td style={{ textDecoration: isExcluded ? "line-through" : "none" }}>
                        <strong style={{ color: "var(--primary-color)" }}>{fmt(row.pairedAvg, 4)}</strong>
                      </td>
                      <td>
                        {isAuto ? (
                          <span style={{ color: "var(--danger-color, #e74c3c)", fontWeight: 600, fontSize: "0.85em" }}>
                            ⚠️ Chauvenet Outlier
                          </span>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                            {isFlagged && !isExcluded && (
                              <span
                                style={{ color: "var(--warning-color, #f39c12)", fontWeight: 600, fontSize: "0.85em" }}
                                title="Suspicious spread detected by IQR filter"
                              >
                                ⚠️ Flagged
                              </span>
                            )}
                            {row.pairedAvg != null && (
                              <button
                                type="button"
                                className="cal-results-pill"
                                style={{ fontSize: "0.75rem", padding: "2px 8px", minHeight: "auto", margin: 0, opacity: isExcluded ? 1 : 0.7 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExclusion(row.pairNum);
                                }}
                              >
                                {isExcluded ? "Include" : "Exclude"}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}

          <p className="cycle-stats-footnote">
            The {activeView === "trend" ? "chart" : "table"} above shows the exact pairs used to calculate the headline values based on your selected strategy.
          </p>
        </div>
      )}
    </div>
  );
}

export default CycleStatisticsTracker;
