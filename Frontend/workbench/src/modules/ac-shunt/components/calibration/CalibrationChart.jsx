import React, { useRef, useState, useMemo, useEffect } from "react";
import { Bar, Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import zoomPlugin from "chartjs-plugin-zoom";
import { FaCog, FaChevronDown, FaCheck } from "react-icons/fa";
import { BsFiletypePng } from "react-icons/bs";
import { TbZoomReset } from "react-icons/tb";
import { FiActivity } from "react-icons/fi";
import { listAvailableCycles, resolveEffectiveCycle } from "../../utils/resolveEffectiveCycle";

const crosshairPlugin = {
  id: "crosshair",
  afterDraw: (chart, args, options) => {
    const { syncedHoverIndex } = options;
    if (syncedHoverIndex === null || syncedHoverIndex === undefined) {
      return;
    }
    const {
      ctx,
      chartArea: { top, bottom, left, right },
      scales: { x },
    } = chart;
    const xCoord = x.getPixelForValue(syncedHoverIndex);
    if (xCoord >= left && xCoord <= right) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(xCoord, top);
      ctx.lineTo(xCoord, bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = options.color || "rgba(150, 150, 150, 0.7)";
      ctx.stroke();
      ctx.restore();
    }
  },
};

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  zoomPlugin,
  crosshairPlugin
);

const Accordion = ({ title, children, initialOpen = false }) => {
  const [isOpen, setIsOpen] = useState(initialOpen);
  return (
    <div className="accordion-card">
      <div className="accordion-header" onClick={() => setIsOpen(!isOpen)}>
        <h3>{title}</h3>
        <FaChevronDown className={`accordion-icon ${isOpen ? "open" : ""}`} />
      </div>
      {isOpen && <div className="accordion-content">{children}</div>}
    </div>
  );
};

// Map collection-stage keys (as emitted by the live collector) to the
// dataset labels produced by buildChartData. Used to scope live-render
// visibility down to the currently-running iteration.
const STAGE_KEY_TO_LABEL = {
  ac_open: "AC Open",
  dc_pos: "DC+",
  dc_neg: "DC-",
  ac_close: "AC Close",
  // TVC Characterization
  char_plus1: "Nominal +500ppm",
  char_minus: "Nominal -500ppm",
  char_plus2: "Nominal +500ppm (x2)",
};

function CalibrationChart({
  title,
  chartData,
  theme,
  chartType,
  onHover,
  syncedHoverIndex,
  comparisonData,
  onRunFullAnalysis = null,
  onMarkStability = null,
  instrumentType = null,
  activeChartView,
  setActiveChartView,
  // Optional controlled-cycle props. When provided, the parent owns the
  // cycle picker so a sibling component (e.g. LiveStabilityTracker) can
  // mirror the exact cycle the chart shows. Backward compatible — if the
  // parent doesn't pass these, the chart keeps its own local state.
  selectedCycle: controlledSelectedCycle,
  onCycleChange,
  // The collection stage currently being acquired (e.g. "ac_open"). When
  // present, the chart scopes its visible series to just that iteration so
  // the y-axis can scale to the live trace; the other iterations stay in
  // the legend as crossed-out entries the user can click to re-show.
  activeStage = null,
  // The in-flight cycle is authoritative in auto mode even while it has zero
  // readings. This prevents the previous cycle from flashing between stages.
  activeCycle = null,
}) {
  const chartRef = useRef(null);
  const [yAxisUnit, setYAxisUnit] = useState("voltage");
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const optionsMenuRef = useRef(null);
  const [isStabilityOpen, setIsStabilityOpen] = useState(false);
  const stabilityMenuRef = useRef(null);
  const [hideUnstableReadings, setHideUnstableReadings] = useState(false);

  // Cycle filter: which N-cycle of the AC-DC sequence to render. `null` =
  // auto (live → currently-active cycle; otherwise the latest cycle in the
  // dataset). A user can pin a specific cycle via the chart options menu.
  const [internalSelectedCycle, setInternalSelectedCycle] = useState(null);
  const isCycleControlled = controlledSelectedCycle !== undefined;
  const selectedCycle = isCycleControlled
    ? controlledSelectedCycle
    : internalSelectedCycle;

  const setSelectedCycle = (next) => {
    if (!isCycleControlled) setInternalSelectedCycle(next);
    if (onCycleChange) onCycleChange(next);
  };

  const [voltSigFigs, setVoltSigFigs] = useState(4);
  const [voltSigFigsError, setVoltSigFigsError] = useState("");
  const [ppmDecimalPlaces, setPpmDecimalPlaces] = useState(2);
  const [ppmDecimalPlacesError, setPpmDecimalPlacesError] = useState("");
  const [stabilityRange, setStabilityRange] = useState({
    type: "",
    start: 1,
    end: 1,
    mark_as: "unstable",
  });

  // Safe checks to verify if dataset records are present before rendering canvas
  const hasData = useMemo(() => {
    return (
      chartData &&
      chartData.datasets &&
      chartData.datasets.some((ds) => ds.data && ds.data.length > 0)
    );
  }, [chartData]);

  useEffect(() => {
    const primaryDataset = chartData?.datasets?.find(
      (ds) => ds.data && ds.data.length > 0
    );
    if (primaryDataset) {
      setStabilityRange((prev) => ({
        ...prev,
        type: primaryDataset.label,
        start: 1,
        end: primaryDataset.data.length,
      }));
    }
  }, [chartData]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        optionsMenuRef.current &&
        !optionsMenuRef.current.contains(event.target)
      ) {
        setIsOptionsOpen(false);
      }
      if (
        stabilityMenuRef.current &&
        !stabilityMenuRef.current.contains(event.target)
      ) {
        setIsStabilityOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [optionsMenuRef, stabilityMenuRef]);

  // Shared helpers — must match what the parent uses to compute the
  // tracker's cycle, otherwise the chart and the tracker could disagree
  // on "what is the latest cycle right now".
  const availableCycles = useMemo(
    () => listAvailableCycles(chartData),
    [chartData]
  );
  const effectiveCycle = useMemo(
    () => resolveEffectiveCycle(selectedCycle, availableCycles, activeCycle),
    [selectedCycle, availableCycles, activeCycle]
  );

  // Scope visibility to the active iteration during live collection. We
  // intentionally depend ONLY on `activeStage` so streaming data updates
  // don't fight the user if they click a crossed-out legend item to peek
  // at another iteration mid-run. When `activeStage` clears (collection
  // ended), restore all series to visible.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chart.data?.datasets) return;
    const activeLabel = activeStage ? STAGE_KEY_TO_LABEL[activeStage] : null;
    chart.data.datasets.forEach((ds, i) => {
      const shouldShow = activeLabel ? ds.label === activeLabel : true;
      chart.setDatasetVisibility(i, shouldShow);
    });
    chart.update();
  }, [activeStage]);

  const chartPalette = useMemo(() => {
    const dark = theme === "dark";
    const series = {
      "AC Open": dark
        ? { stroke: "#22d3ee", fill: "rgba(34, 211, 238, 0.18)", glow: "rgba(103, 232, 249, 0.7)" }
        : { stroke: "#0ea5e9", fill: "rgba(14, 165, 233, 0.14)", glow: "rgba(56, 189, 248, 0.5)" },
      "DC+": dark
        ? { stroke: "#fb7185", fill: "rgba(251, 113, 133, 0.18)", glow: "rgba(253, 164, 175, 0.68)" }
        : { stroke: "#e11d48", fill: "rgba(225, 29, 72, 0.12)", glow: "rgba(244, 63, 94, 0.42)" },
      "DC-": dark
        ? { stroke: "#60a5fa", fill: "rgba(96, 165, 250, 0.18)", glow: "rgba(147, 197, 253, 0.68)" }
        : { stroke: "#2563eb", fill: "rgba(37, 99, 235, 0.12)", glow: "rgba(59, 130, 246, 0.44)" },
      "AC Close": dark
        ? { stroke: "#facc15", fill: "rgba(250, 204, 21, 0.16)", glow: "rgba(253, 224, 71, 0.62)" }
        : { stroke: "#ca8a04", fill: "rgba(202, 138, 4, 0.12)", glow: "rgba(234, 179, 8, 0.42)" },
      "Nominal +500ppm": dark
        ? { stroke: "#a78bfa", fill: "rgba(167, 139, 250, 0.18)", glow: "rgba(196, 181, 253, 0.7)" }
        : { stroke: "#7c3aed", fill: "rgba(124, 58, 237, 0.12)", glow: "rgba(139, 92, 246, 0.44)" },
      "Nominal -500ppm": dark
        ? { stroke: "#34d399", fill: "rgba(52, 211, 153, 0.18)", glow: "rgba(110, 231, 183, 0.66)" }
        : { stroke: "#059669", fill: "rgba(5, 150, 105, 0.12)", glow: "rgba(16, 185, 129, 0.4)" },
      "Nominal +500ppm (x2)": dark
        ? { stroke: "#f472b6", fill: "rgba(244, 114, 182, 0.17)", glow: "rgba(249, 168, 212, 0.64)" }
        : { stroke: "#db2777", fill: "rgba(219, 39, 119, 0.12)", glow: "rgba(236, 72, 153, 0.42)" },
    };

    return {
      series,
      fallback: dark
        ? [
          { stroke: "#22d3ee", fill: "rgba(34, 211, 238, 0.18)", glow: "rgba(103, 232, 249, 0.7)" },
          { stroke: "#a78bfa", fill: "rgba(167, 139, 250, 0.18)", glow: "rgba(196, 181, 253, 0.7)" },
          { stroke: "#34d399", fill: "rgba(52, 211, 153, 0.18)", glow: "rgba(110, 231, 183, 0.66)" },
        ]
        : [
          { stroke: "#0ea5e9", fill: "rgba(14, 165, 233, 0.14)", glow: "rgba(56, 189, 248, 0.5)" },
          { stroke: "#7c3aed", fill: "rgba(124, 58, 237, 0.12)", glow: "rgba(139, 92, 246, 0.44)" },
          { stroke: "#059669", fill: "rgba(5, 150, 105, 0.12)", glow: "rgba(16, 185, 129, 0.4)" },
        ],
      axis: dark ? "rgba(226, 232, 240, 0.8)" : "rgba(51, 65, 85, 0.84)",
      grid: dark ? "rgba(148, 163, 184, 0.16)" : "rgba(100, 116, 139, 0.14)",
      gridStrong: dark ? "rgba(148, 163, 184, 0.24)" : "rgba(100, 116, 139, 0.2)",
      crosshair: dark ? "rgba(34, 211, 238, 0.56)" : "rgba(14, 165, 233, 0.48)",
      unstable: dark ? "#f43f5e" : "#dc2626",
      unstableFill: dark ? "rgba(244, 63, 94, 0.9)" : "rgba(220, 38, 38, 0.86)",
      pointHalo: dark ? "rgba(15, 23, 42, 0.96)" : "rgba(255, 255, 255, 0.96)",
      tooltipBg: dark ? "rgba(15, 23, 42, 0.96)" : "rgba(255, 255, 255, 0.96)",
      tooltipText: dark ? "#e2e8f0" : "#0f172a",
      tooltipBorder: dark ? "rgba(34, 211, 238, 0.35)" : "rgba(14, 165, 233, 0.28)",
    };
  }, [theme]);

  const styleDataset = (dataset, index) => {
    const visual =
      chartPalette.series[dataset.label] ||
      chartPalette.fallback[index % chartPalette.fallback.length];
    return {
      ...dataset,
      borderColor: visual.stroke,
      backgroundColor: visual.fill,
      pointBackgroundColor: visual.stroke,
      pointBorderColor: chartPalette.pointHalo,
      pointBorderWidth: 2,
      pointHoverBorderColor: visual.glow,
      pointHoverBorderWidth: 3,
      borderWidth: chartType === "bar" ? 1.5 : 2.75,
      hoverBorderWidth: 3,
      tension: chartType === "bar" ? dataset.tension : 0.32,
      fill: false,
      pointRadius: 4,
      pointHoverRadius: 7,
    };
  };

  const { processedChartData, processedComparisonData } = useMemo(() => {
    const filterByCycle = (data) =>
      (data || []).filter((pt) => {
        const c = Number.isFinite(pt?.cycle) ? Number(pt.cycle) : 1;
        return c === effectiveCycle;
      });

    const processDatasets = (dataToProcess) => {
      if (!dataToProcess || !dataToProcess.datasets) return [];
      return dataToProcess.datasets.map((ds) => {
        // Filter to the chosen cycle first, then re-index so x is contiguous
        // within this cycle (mirrors the non-cycle behavior the chart had
        // for years).
        let processedData = filterByCycle(ds.data).map((point, index) => ({
          ...point,
          x: index + 1,
        }));
        if (hideUnstableReadings) {
          processedData = processedData
            .filter((point) => point.is_stable !== false)
            .map((point, index) => ({
              ...point,
              x: index + 1,
            }));
        }
        if (yAxisUnit === "ppm") {
          if (processedData.length === 0) return { ...ds, data: [] };
          // Reference mean for the PPM transform is computed over the
          // currently-selected cycle only — otherwise the deviation y-values
          // get pulled toward the cross-cycle mean which defeats the
          // purpose of cycle filtering.
          const cycleData = filterByCycle(ds.data);
          const originalMean =
            cycleData.reduce((acc, curr) => acc + curr.y, 0) /
            (cycleData.length || 1);
          return {
            ...ds,
            data: processedData.map((point) => ({
              ...point,
              y:
                originalMean === 0
                  ? 0
                  : ((point.y - originalMean) / Math.abs(originalMean)) * 1e6,
            })),
          };
        }
        return { ...ds, data: processedData };
      });
    };

    if (
      !chartData ||
      !chartData.datasets ||
      chartData.datasets.every((ds) => !ds.data || ds.data.length === 0)
    ) {
      return {
        processedChartData: { datasets: [] },
        processedComparisonData: [],
      };
    }

    const finalChartDatasets = processDatasets(chartData).map(styleDataset);
    const finalComparisonDatasets = processDatasets({
      datasets: comparisonData,
    });
    const allXLabels = finalChartDatasets.flatMap((ds) =>
      ds.data.map((d) => d.x)
    );
    const finalLabels = [...new Set(allXLabels)].sort((a, b) => a - b);
    return {
      processedChartData: {
        labels: finalLabels,
        datasets: finalChartDatasets,
      },
      processedComparisonData: finalComparisonDatasets,
    };
  }, [chartData, comparisonData, yAxisUnit, hideUnstableReadings, effectiveCycle, chartPalette, chartType]);

  const handleVoltSigFigChange = (e) => {
    const value = e.target.value;
    if (value === "") {
      setVoltSigFigs("");
      setVoltSigFigsError("Default precision will be used.");
      return;
    }
    const numValue = Number(value);
    if (!Number.isInteger(numValue)) {
      setVoltSigFigs(value);
      setVoltSigFigsError("Must be an integer.");
    } else if (numValue < 1 || numValue > 21) {
      setVoltSigFigs(numValue);
      setVoltSigFigsError("Range must be between 1 and 21.");
    } else {
      setVoltSigFigs(numValue);
      setVoltSigFigsError("");
    }
  };

  const handlePpmDecimalChange = (e) => {
    const value = e.target.value;
    if (value === "") {
      setPpmDecimalPlaces("");
      setPpmDecimalPlacesError("Default precision will be used.");
      return;
    }
    const numValue = Number(value);
    if (!Number.isInteger(numValue)) {
      setPpmDecimalPlaces(value);
      setPpmDecimalPlacesError("Must be an integer.");
    } else if (numValue < 0 || numValue > 15) {
      setPpmDecimalPlaces(numValue);
      setPpmDecimalPlacesError("Range must be between 0 and 15.");
    } else {
      setPpmDecimalPlaces(numValue);
      setPpmDecimalPlacesError("");
    }
  };

  const handleStabilityInputChange = (e) => {
    const { name, value } = e.target;
    setStabilityRange((prev) => ({ ...prev, [name]: value }));
  };

  const handleMarkStability = () => {
    if (onMarkStability) {
      onMarkStability(stabilityRange, instrumentType);
      setIsOptionsOpen(false);
    }
  };

  const textColor = chartPalette.axis;
  const gridColor = chartPalette.grid;
  const crosshairColor = chartPalette.crosshair;
  const unstableColor = chartPalette.unstable;
  const unstableBgColor = chartPalette.unstableFill;

  // Resolve dynamic active iteration/stage name, clean instrument label, and match corresponding legend color
  const activeLabel = activeStage ? (STAGE_KEY_TO_LABEL[activeStage] || activeStage) : null;
  const displayedTitle = activeLabel
    ? (title.includes("Standard")
      ? `Standard's ${activeLabel} Readings`
      : `Test Instrument's ${activeLabel} Readings`)
    : title;
  const titleColor = (activeLabel && chartPalette.series[activeLabel])
    ? chartPalette.series[activeLabel].stroke
    : textColor;

  // Split-color title render: keeps static wrapping structural text in default color
  const renderTitle = () => {
    if (!activeLabel) {
      return <h4 style={{ color: textColor }}>{title}</h4>;
    }
    const prefix = title.includes("Standard") ? "Standard's " : "Test Instrument's ";
    return (
      <h4 style={{ color: textColor }}>
        {prefix}
        <span style={{ color: titleColor }}>{activeLabel}</span>
        {" Readings"}
      </h4>
    );
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    parsing: { xAxisKey: "x", yAxisKey: "y" },
    onHover: (event, chartElement) => {
      if (onHover) {
        onHover(chartElement.length > 0 ? chartElement[0].index : null);
      }
    },
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          color: textColor,
          usePointStyle: true,
          pointStyle: "circle",
          boxWidth: 14,
          padding: 24,
        },
      },
      title: { display: false },
      tooltip: {
        backgroundColor: chartPalette.tooltipBg,
        borderColor: chartPalette.tooltipBorder,
        borderWidth: 1,
        titleColor: chartPalette.tooltipText,
        bodyColor: chartPalette.tooltipText,
        footerColor: chartPalette.tooltipText,
        displayColors: true,
        padding: 12,
        callbacks: {
          title: (tooltipItems) => {
            const point = tooltipItems[0]?.raw;
            const stableText = point?.is_stable === false ? " (Unstable)" : "";
            return `Sample #${point?.x || ""}${stableText}`;
          },
          label: () => "",
          footer: (tooltipItems) => {
            const activePoint = tooltipItems[0];
            if (!activePoint) return [];
            const dataIndex = activePoint.dataIndex;
            const datasetIndex = activePoint.datasetIndex;
            const rawPoint = activePoint.raw;
            const footerLines = [];
            const unitLabel = yAxisUnit === "ppm" ? "PPM" : "V";
            const finalVoltPrecision = (() => {
              const sigFigs = parseInt(voltSigFigs, 10);
              return !voltSigFigsError && !isNaN(sigFigs) ? sigFigs : 4;
            })();
            const finalPpmDecimals = (() => {
              const decimals = parseInt(ppmDecimalPlaces, 10);
              return !ppmDecimalPlacesError && !isNaN(decimals) ? decimals : 2;
            })();
            const formatValue = (val) =>
              yAxisUnit === "ppm"
                ? val.toFixed(finalPpmDecimals)
                : val.toPrecision(finalVoltPrecision);
            const mainDataset = processedChartData.datasets[datasetIndex];
            if (mainDataset) {
              const mainValue = mainDataset.data[dataIndex]?.y;
              if (mainValue !== undefined) {
                const chartTitle = title.includes("Standard")
                  ? "Standard Instrument"
                  : "Test Instrument";
                footerLines.push(
                  `${chartTitle}: ${formatValue(mainValue)} ${unitLabel}`
                );
              }
            }
            if (processedComparisonData && processedComparisonData.length > 0) {
              const mainLabel = mainDataset?.label;
              const comparisonDataset = processedComparisonData.find(
                (d) => d.label === mainLabel
              );
              const comparisonValue = comparisonDataset?.data[dataIndex]?.y;
              if (comparisonValue !== undefined) {
                const comparisonChartTitle = title.includes("Standard")
                  ? "Test Instrument"
                  : "Standard Instrument";
                footerLines.push(
                  `${comparisonChartTitle}: ${formatValue(
                    comparisonValue
                  )} ${unitLabel}`
                );
              }
            }
            const timestamp = rawPoint?.t;
            if (timestamp) {
              if (footerLines.length > 0) footerLines.push(" ");
              footerLines.push(`Date: ${timestamp.toLocaleDateString()}`);
              footerLines.push(`Time: ${timestamp.toLocaleTimeString()}`);
            }
            const cycleNum = Number.isFinite(rawPoint?.cycle) ? Number(rawPoint.cycle) : null;
            if (cycleNum != null) {
              footerLines.push(`Cycle: ${cycleNum}`);
            }
            return footerLines;
          },
        },
      },
      zoom: {
        pan: { enabled: true, mode: "xy" },
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true },
          mode: "xy",
        },
      },
      crosshair: { syncedHoverIndex, color: crosshairColor },
    },
    elements: {
      point: {
        radius: (context) => (context.raw?.is_stable === false ? 6 : 3),
        pointStyle: (context) =>
          context.raw?.is_stable === false ? "crossRot" : "circle",
        borderColor: (context) =>
          context.raw?.is_stable === false
            ? unstableColor
            : context.dataset.borderColor,
        backgroundColor: (context) =>
          context.raw?.is_stable === false
            ? unstableBgColor
            : context.dataset.backgroundColor,
      },
    },
    scales: {
      y: {
        beginAtZero: false,
        title: {
          display: true,
          text: yAxisUnit === "voltage" ? "Voltage (V)" : "Difference (PPM)",
          color: textColor,
          font: {
            size: 16,
            weight: "bold"
          }
        },
        ticks: {
          color: textColor,
          callback: (value) => {
            if (yAxisUnit === "ppm") {
              const decimals = parseInt(ppmDecimalPlaces, 10);
              if (!ppmDecimalPlacesError && !isNaN(decimals)) {
                return value.toFixed(decimals);
              }
              return value.toFixed(2);
            } else {
              const sigFigs = parseInt(voltSigFigs, 10);
              if (!voltSigFigsError && !isNaN(sigFigs)) {
                return value.toPrecision(sigFigs);
              }
              return value.toPrecision(4);
            }
          },
        },
        grid: { color: gridColor },
        border: { color: chartPalette.gridStrong },
      },
      x: {
        title: { display: true, text: "Sample Number", color: textColor },
        ticks: { color: textColor },
        grid: { color: gridColor },
        border: { color: chartPalette.gridStrong },
      },
    },
  };

  const handleResetZoom = () => chartRef.current?.resetZoom();
  const handleExportChart = () => {
    if (chartRef.current) {
      const link = document.createElement("a");
      link.download = `${displayedTitle.replace(/\s+/g, "_") || "chart"}.png`;
      link.href = chartRef.current.toBase64Image("image/png", 1);
      link.click();
    }
  };

  const ChartComponent = chartType === "bar" ? Bar : Line;

  // Safe extraction of datasets
  const availableMeasurementTypes = useMemo(() => {
    if (!chartData || !chartData.datasets) return [];
    return chartData.datasets
      .filter((ds) => ds.data && ds.data.length > 0)
      .map((ds) => ds.label);
  }, [chartData]);

  return (
    <div style={{ width: "100%", minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div className="summary-table-header" style={{ paddingBottom: "15px" }}>
        {renderTitle()}
        <div className="chart-header-actions">
          {onMarkStability && (
            <div className="chart-options-container" ref={stabilityMenuRef}>
              <button
                title="Update Reading Stability"
                className="chart-action-icon-button"
                onClick={() => setIsStabilityOpen((prev) => !prev)}
                disabled={!hasData}
                style={{
                  background: "transparent",
                  border: "none",
                  opacity: hasData ? 1 : 0.35,
                  cursor: hasData ? "pointer" : "not-allowed",
                }}
              >
                <FiActivity />
              </button>
              {isStabilityOpen && (
                <div className="chart-options-dropdown">
                  <Accordion
                    title="Update Reading Stability"
                    initialOpen={true}
                  >
                    <div className="chart-options-section">
                      <div className="chart-options-form-group checkbox-group">
                        <input
                          id="hideUnstableInput"
                          type="checkbox"
                          checked={hideUnstableReadings}
                          onChange={(e) =>
                            setHideUnstableReadings(e.target.checked)
                          }
                        />
                        <label htmlFor="hideUnstableInput">
                          Hide Unstable Readings
                        </label>
                      </div>
                      <div className="chart-options-form-group">
                        <label>Measurement Type</label>
                        <select
                          name="type"
                          value={stabilityRange.type}
                          onChange={handleStabilityInputChange}
                        >
                          {availableMeasurementTypes.map((label) => (
                            <option key={label} value={label}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="chart-options-range-inputs">
                        <div className="chart-options-form-group">
                          <label>Start Sample</label>
                          <input
                            name="start"
                            type="number"
                            min="1"
                            value={stabilityRange.start}
                            onChange={handleStabilityInputChange}
                          />
                        </div>
                        <div className="chart-options-form-group">
                          <label>End Sample</label>
                          <input
                            name="end"
                            type="number"
                            min="1"
                            value={stabilityRange.end}
                            onChange={handleStabilityInputChange}
                          />
                        </div>
                      </div>
                      <div className="chart-options-form-group">
                        <label>Mark As</label>
                        <select
                          name="mark_as"
                          value={stabilityRange.mark_as}
                          onChange={handleStabilityInputChange}
                        >
                          <option value="unstable">Unstable</option>
                          <option value="stable">Stable</option>
                        </select>
                      </div>
                      <div
                        className="chart-options-form-group"
                        style={{ display: "flex", gap: "8px" }}
                      >
                        <button
                          className="button button-primary button-small"
                          onClick={() => {
                            handleMarkStability();
                            setIsStabilityOpen(false); // Close menu on apply
                          }}
                          style={{ flex: 1 }}
                        >
                          <FaCheck style={{ marginRight: "8px" }} />
                          Apply
                        </button>
                      </div>
                    </div>
                  </Accordion>
                </div>
              )}
            </div>
          )}
          <button
            title="Reset Zoom"
            className="chart-action-icon-button"
            onClick={handleResetZoom}
            disabled={!hasData}
            style={{
              background: "transparent",
              border: "none",
              opacity: hasData ? 1 : 0.35,
              cursor: hasData ? "pointer" : "not-allowed",
            }}
          >
            <TbZoomReset />
          </button>

          <button
            title="Export as PNG"
            className="chart-action-icon-button"
            onClick={handleExportChart}
            disabled={!hasData}
            style={{
              background: "transparent",
              border: "none",
              opacity: hasData ? 1 : 0.35,
              cursor: hasData ? "pointer" : "not-allowed",
            }}
          >
            <BsFiletypePng />
          </button>

          <div className="chart-options-container" ref={optionsMenuRef}>
            <button
              title="Chart Options"
              className="chart-options-button"
              onClick={() => setIsOptionsOpen((prev) => !prev)}
            >
              <FaCog />
            </button>
            {isOptionsOpen && (
              <div className="chart-options-dropdown">
                <Accordion title="Display Options" initialOpen={true}>
                  <div className="chart-options-section">
                    {setActiveChartView && (
                      <div className="chart-options-form-group">
                        <label>Data View</label>
                        <div className="unit-toggle">
                          <button
                            className={activeChartView === "calibration" ? "active" : ""}
                            onClick={() => setActiveChartView("calibration")}
                          >
                            Calibration
                          </button>
                          <button
                            className={activeChartView === "characterization" ? "active" : ""}
                            onClick={() => setActiveChartView("characterization")}
                          >
                            Characterization
                          </button>
                        </div>
                      </div>
                    )}
                    {availableCycles.length > 1 && (
                      <div className="chart-options-form-group">
                        <label htmlFor="cycleSelectInput">Cycle</label>
                        <select
                          id="cycleSelectInput"
                          value={selectedCycle === null ? "auto" : selectedCycle}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSelectedCycle(val === "auto" ? null : Number(val));
                          }}
                          title="Select which cycle to display, or Auto for the latest."
                        >
                          <option value="auto">Auto (Latest)</option>
                          {availableCycles.map((c) => (
                            <option key={c} value={c}>
                              Cycle {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="chart-options-form-group">
                      <label>Y-Axis Unit</label>
                      <div className="unit-toggle">
                        <button
                          className={yAxisUnit === "voltage" ? "active" : ""}
                          onClick={() => setYAxisUnit("voltage")}
                        >
                          Volts
                        </button>
                        <button
                          className={yAxisUnit === "ppm" ? "active" : ""}
                          onClick={() => setYAxisUnit("ppm")}
                        >
                          PPM
                        </button>
                      </div>
                    </div>
                    <div className="chart-options-form-group">
                      {yAxisUnit === "voltage" ? (
                        <>
                          <label htmlFor="voltSigFigsInput">
                            Y-Axis Sig Figs (Volts)
                          </label>
                          <input
                            id="voltSigFigsInput"
                            name="voltSigFigs"
                            type="number"
                            value={voltSigFigs}
                            onChange={handleVoltSigFigChange}
                            placeholder="e.g., 4"
                          />
                          {voltSigFigsError && (
                            <small
                              className="error-text"
                              style={{
                                color: "var(--status-bad)",
                                display: "block",
                                marginTop: "4px",
                              }}
                            >
                              {voltSigFigsError}
                            </small>
                          )}
                        </>
                      ) : (
                        <>
                          <label htmlFor="ppmDecimalInput">
                            Y-Axis Decimals (PPM)
                          </label>
                          <input
                            id="ppmDecimalInput"
                            name="ppmDecimals"
                            type="number"
                            value={ppmDecimalPlaces}
                            onChange={handlePpmDecimalChange}
                            placeholder="e.g., 2"
                          />
                          {ppmDecimalPlacesError && (
                            <small
                              className="error-text"
                              style={{
                                color: "var(--status-bad)",
                                display: "block",
                                marginTop: "4px",
                              }}
                            >
                              {ppmDecimalPlacesError}
                            </small>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </Accordion>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="chart-canvas-wrapper">
        {hasData ? (
          <ChartComponent
            ref={chartRef}
            options={options}
            data={processedChartData}
          />
        ) : (
          <p style={{ textAlign: "center", padding: "40px 20px", color: textColor, margin: 0 }}>
            No data available to display the chart.
          </p>
        )}
      </div>
    </div>
  );
}

export default CalibrationChart;
