/**
 * src/App.jsx
 */
import React, {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
  lazy,
  Suspense,
} from "react";
import { v4 as uuidv4 } from "uuid";

// --- Components ---
import Analysis from "./features/analysis/Analysis";
import NotificationModal from "./components/modals/NotificationModal";
import TestPointDetailView from "./features/testPoints/components/TestPointDetailView";
import ToleranceToolModal from "./features/testPoints/components/ToleranceToolModal";
// OverviewModal Removed
import ContextMenu from "./components/common/ContextMenu";
import FullBreakdownModal from "./features/analysis/components/BreakdownModals/FullBreakdownModal";
import TestPointInfoModal from "./features/testPoints/components/TestPointInfoModal";
import UniversalInstrumentModal from "./features/instruments/components/UniversalInstrumentModal";
import UnresolvedToleranceModal from "./features/testPoints/components/UnresolvedToleranceModal";
import BugReportModal from "./components/modals/BugReportModal";
import GuidedWalkthrough from "./components/common/GuidedWalkthrough";

// --- Brand emblem (shared 3D medallion recipe) ---
import HeaderEmblem from "./components/HeaderEmblem";

// --- Floating Tools ---
import UnitConverter from "./components/tools/UnitConverter";
const ReverseTraceabilityTool = lazy(
  () => import("./components/tools/ReverseTraceabilityTool"),
);

// --- Workbench shared layers (theme + toast live at the shell root) ---
import { useTheme } from "../../shared/ThemeContext";
import { useNotifications } from "../../shared/NotificationContext";

// --- Utils & Hooks ---
import useSessionManager from "./hooks/useSessionManager";
import "./App.css";

// --- Icons ---
import appLogo from "./assets/icon.svg";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faEdit,
  faTrashAlt,
  faBug,
  faQuestionCircle,
  faLayerGroup,
  faMicroscope,
  faCube,
  faRadio,
  faHistory,
  faRightLeft,
  faSave,
  faFolderOpen,
  faCopy,
  faCut,
  faPaste,
  faCheckCircle,
  faSlidersH,
  faChevronDown,
  faChevronRight,
  faExpandArrowsAlt,
  faCompressArrowsAlt,
  faCog,
  faMoon,
  faSun,
} from "@fortawesome/free-solid-svg-icons";

import ThemeContext from "./context/ThemeContext";

import {
  getToleranceErrorSummary,
  getAbsoluteLimits,
  getTmdeAbsoluteLimits,
  getTmdeAbsoluteLimitEntries,
  getUnitDisplayLabel,
} from "./utils/uncertaintyMath";
import {
  getInstrumentRangeRows,
  resolveInstrumentSelection,
} from "./utils/instrumentFunctionSelection";
import { computeRiskMetricsMap } from "./utils/riskCompute";
import {
  associateUutWithPoint,
  resolvePointAreaId,
} from "./utils/areaWorkspace";
import {
  MITIGATION_INPUT_FIELDS,
  RISK_INPUT_FIELDS,
} from "./constants/constants";
import {
  getRemainingCutPoints,
  preparePointForPaste,
} from "./utils/pointClipboard";
import {
  getSidebarPointRange,
  getVisibleSidebarPointOrder,
} from "./utils/sidebarPointSelection";
import {
  functionKeyOf,
  functionLabelOf,
  instrumentFunctions,
  makeFunctionKey,
  resolveSessionFunctions,
} from "./utils/functionGrouping";
import { formatRangeLabel } from "./utils/rangeFormatting";
import {
  formatSidebarUncertainty,
  formatSidebarUncertaintyFull,
} from "./utils/sidebarUncertainty";
import { ZOOM_TOAST_EVENT } from "../../shared/ZoomToast";

// Synthetic ids for the top-level "Unassigned Points" bucket (points whose
// owning UUT no longer exists), modeled as a pseudo function/UUT so every
// consumer can treat the sidebar uniformly.
const UNASSIGNED_FUNCTION_ID = "__unassigned_function__";
const UNASSIGNED_UUT_ID = "__unassigned_uut__";
// Keep the sidebar table compact and deterministic. The surrounding scroller
// handles genuinely wide column sets; flexible `1fr` tracks made short values
// appear detached from their headers and changed spacing with viewport width.
const SIDEBAR_UNCERTAINTY_COLUMN = "110px";

const DEFAULT_FUNCTION_POINT_SETTINGS = Object.freeze({
  mode: "direct",
  reuseEquation: false,
  reuseBudget: false,
});

const clonePointSettingValue = (value) => {
  if (Array.isArray(value)) return value.map(clonePointSettingValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        clonePointSettingValue(nested),
      ]),
    );
  }
  return value;
};

const getFunctionPointSettings = (sessionData, functionId) => {
  const stored = (sessionData?.functionGroups || []).find(
    (group) =>
      makeFunctionKey(group.name) === functionId && group.kind !== "tmde",
  )?.pointCreationSettings;
  return {
    ...DEFAULT_FUNCTION_POINT_SETTINGS,
    ...(stored || {}),
    mode: stored?.mode === "derived" ? "derived" : "direct",
  };
};

const SIDEBAR_COLUMN_GROUPS = [
  {
    key: "measurement",
    label: "Measurement",
    columns: [
      "uut",
      "section",
      "value",
      "qualifier",
      "tolerance",
      "lowLimit",
      "highLimit",
      "standardUncertainty",
      "measurementUncertainty",
      "tmdeLow",
      "tmdeHigh",
      "tur",
      "tar",
    ],
  },
  {
    key: "risk",
    label: "Risk",
    columns: ["observedReop", "pfa", "pfr", "maxReop", "trueReop"],
  },
  {
    key: "mitigation-gb",
    label: "Mitigation (GB + Int)",
    columns: [
      "gbMult",
      "gbLow",
      "gbHigh",
      "gbPfa",
      "gbPfr",
      "gbCalInt",
      "gbMeasRel",
    ],
  },
  {
    key: "mitigation-int",
    label: "Mitigation (Int Only)",
    columns: ["noGbPfa", "noGbPfr", "noGbCalInt", "noGbMeasRel"],
  },
];

const getSidebarGridTemplate = (visibleColumns, valueColumnWidth = "80px") => {
  const parts = [];
  // Fixed widths for stable columns
  if (visibleColumns.uut) parts.push("minmax(120px, 1.35fr)");
  if (visibleColumns.section) parts.push("50px");
  if (visibleColumns.value) parts.push(valueColumnWidth);
  if (visibleColumns.qualifier) parts.push("80px");
  if (visibleColumns.tolerance) parts.push("minmax(80px, 1fr)");

  // Split Limits Columns
  if (visibleColumns.lowLimit) parts.push("minmax(60px, 0.8fr)");
  if (visibleColumns.highLimit) parts.push("minmax(60px, 0.8fr)");

  if (visibleColumns.standardUncertainty) parts.push(SIDEBAR_UNCERTAINTY_COLUMN);
  if (visibleColumns.measurementUncertainty) parts.push(SIDEBAR_UNCERTAINTY_COLUMN);
  // TMDE (standard) limit columns
  if (visibleColumns.tmdeLow) parts.push("minmax(90px, 1fr)");
  if (visibleColumns.tmdeHigh) parts.push("minmax(90px, 1fr)");

  // Workbook measurement and test-point risk columns
  if (visibleColumns.tur) parts.push("55px");
  if (visibleColumns.tar) parts.push("55px");
  if (visibleColumns.observedReop) parts.push("78px");
  if (visibleColumns.pfa) parts.push("55px");
  if (visibleColumns.pfr) parts.push("55px");
  if (visibleColumns.maxReop) parts.push("70px");
  if (visibleColumns.trueReop) parts.push("70px");

  // Mitigation (GB + interval)
  if (visibleColumns.gbMult) parts.push("60px");
  if (visibleColumns.gbLow) parts.push("minmax(60px, 0.8fr)");
  if (visibleColumns.gbHigh) parts.push("minmax(60px, 0.8fr)");
  if (visibleColumns.gbPfa) parts.push("60px");
  if (visibleColumns.gbPfr) parts.push("60px");
  if (visibleColumns.gbCalInt) parts.push("84px");
  if (visibleColumns.gbMeasRel) parts.push("98px");

  // Mitigation (interval only)
  if (visibleColumns.noGbPfa) parts.push("64px");
  if (visibleColumns.noGbPfr) parts.push("64px");
  if (visibleColumns.noGbCalInt) parts.push("90px");
  if (visibleColumns.noGbMeasRel) parts.push("102px");

  if (parts.length === 0) return "1fr";
  return parts.join(" ");
};

const formatInstrumentIdentity = (item = {}) => {
  const inst = item.instrument || item;
  const make = String(inst.manufacturer || item.manufacturer || "").trim();
  const model = String(inst.model || item.model || "").trim();
  const name = String(
    item.description ||
      item.name ||
      inst.description ||
      inst.name ||
      "",
  ).trim();
  const prefix = [make, model].filter(Boolean).join(" ");
  const identity = !prefix
    ? name || "Instrument"
    : !name
      ? prefix
      : name.toLowerCase().startsWith(prefix.toLowerCase())
    ? name
    : `${prefix} ${name}`;
  const nickname = String(item.nickname || "").trim();
  return nickname ? `${identity} · ${nickname}` : identity;
};

const SCOPED_ZOOM_SURFACE_SELECTOR = [
  ".measurement-point-list",
  ".measurement-equation-zoom-surface",
  ".panel-table-container",
  ".instrument-table-container",
  ".budget-section-table-wrap",
  ".lookup-table-container",
  ".ranges-table-container",
].join(", ");

const UNCERTAINTY_UI_PREFERENCES_PREFIX = "uncertalytics.uiPreferences.v1";
const DEFAULT_SIDEBAR_COLUMNS = {
  uut: true,
  section: false,
  value: true,
  qualifier: false,
  tolerance: false,
  lowLimit: true,
  highLimit: true,
  standardUncertainty: true,
  measurementUncertainty: true,
  tmdeLow: false,
  tmdeHigh: false,
  pfa: true,
  pfr: true,
  tur: true,
  tar: false,
  observedReop: false,
  maxReop: false,
  trueReop: false,
  gbPfa: false,
  gbPfr: false,
  gbMult: false,
  gbLow: false,
  gbHigh: false,
  gbCalInt: false,
  gbMeasRel: false,
  noGbPfa: false,
  noGbPfr: false,
  noGbCalInt: false,
  noGbMeasRel: false,
};
// Preserve authored chronology until the user explicitly selects a column sort.
const DEFAULT_SIDEBAR_SORT = { key: "", direction: "asc" };

const getUiPreferencesStorageKey = (sessionId) =>
  `${UNCERTAINTY_UI_PREFERENCES_PREFIX}:${sessionId}`;

const readUiPreferences = (sessionId) => {
  if (!sessionId) return {};
  try {
    return JSON.parse(
      window.localStorage.getItem(getUiPreferencesStorageKey(sessionId)) || "{}",
    );
  } catch (error) {
    console.warn("Unable to read uncertainty UI preferences", error);
    return {};
  }
};

const getScopedZoomKey = (surface) => {
  if (surface.classList.contains("measurement-point-list")) {
    return "measurement-points";
  }
  if (surface.classList.contains("measurement-equation-zoom-surface")) {
    return "measurement-equation";
  }

  const surfaceClass = [
    "panel-table-container",
    "instrument-table-container",
    "budget-section-table-wrap",
    "lookup-table-container",
    "ranges-table-container",
  ].find((className) => surface.classList.contains(className));
  if (!surfaceClass) return null;

  const matchingSurfaces = Array.from(
    document.querySelectorAll(`.${surfaceClass}`),
  );
  return `${surfaceClass}:${matchingSurfaces.indexOf(surface)}`;
};

// Friendly labels for the zoom toast, keyed by the scoped surface class.
const SCOPED_ZOOM_LABELS = {
  "measurement-points": "Point list",
  "measurement-equation": "Equation",
  "panel-table-container": "Table",
  "instrument-table-container": "Instrument table",
  "budget-section-table-wrap": "Budget table",
  "lookup-table-container": "Lookup table",
  "ranges-table-container": "Ranges table",
};

const getScopedZoomLabel = (zoomKey) => {
  if (!zoomKey) return "Zoom";
  return SCOPED_ZOOM_LABELS[zoomKey.split(":")[0]] || "Zoom";
};

// Default scoped-zoom level (when the user hasn't set one) keyed by surface
// class. Surfaces omitted here default to 100%.
const SCOPED_ZOOM_DEFAULTS = {};
const getDefaultScopedZoom = (zoomKey) => {
  if (!zoomKey) return 1;
  return SCOPED_ZOOM_DEFAULTS[zoomKey.split(":")[0]] ?? 1;
};

const getScopedZoomTarget = (eventTarget) => {
  if (!(eventTarget instanceof Element)) return null;

  const surface = eventTarget.closest(SCOPED_ZOOM_SURFACE_SELECTOR);
  if (!surface) return null;

  if (
    surface.classList.contains("measurement-point-list") ||
    surface.classList.contains("measurement-equation-zoom-surface")
  ) {
    const content = surface.querySelector(":scope > .scoped-zoom-content");
    return content ? { surface, content } : null;
  }

  const table = eventTarget.closest("table");
  if (!table || !surface.contains(table)) return null;
  return { surface, content: table };
};

const parseSortableNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = String(value).match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

// Keep the value column wide enough for the longest saved measurement point.
// This must be an absolute pixel track: `ch` is resolved against each grid's
// own font, so the smaller header font and bold selected-row font produced
// different physical column widths from the exact same template string.
const getSidebarValueColumnWidth = (points = []) => {
  const longest = (points || []).reduce((max, point) => {
    const parameter = point?.testPointInfo?.parameter || {};
    const valueLength = String(parameter.value ?? "").length;
    const unitLength = getUnitDisplayLabel(parameter.unit || "").length;
    return Math.max(max, valueLength + (unitLength ? unitLength + 1 : 0));
  }, 0);
  return `${Math.max(88, longest * 8 + 12)}px`;
};

const getPointToleranceSortValue = (point) => {
  const summary = getToleranceErrorSummary(
    point.uutTolerance,
    point.testPointInfo?.parameter,
  );
  return parseSortableNumber(summary);
};

const getPointLimitSortValue = (point, key) => {
  const limits = getAbsoluteLimits(
    point.uutTolerance,
    point.testPointInfo?.parameter,
  );
  if (!limits || limits.low === "N/A") return null;
  return parseSortableNumber(key === "lowLimit" ? limits.low : limits.high);
};

const getPointTmdeLimitSortValue = (point, key) => {
  if (point.measurementType === "derived") {
    const values = getTmdeAbsoluteLimitEntries(point.tmdeTolerances)
      .map((entry) =>
        parseSortableNumber(key === "tmdeLow" ? entry.low : entry.high),
      )
      .filter((value) => value !== null);
    if (values.length === 0) return null;
    return key === "tmdeLow" ? Math.min(...values) : Math.max(...values);
  }

  const limits = getTmdeAbsoluteLimits(
    point.tmdeTolerances,
    point.testPointInfo?.parameter,
  );
  if (!limits || limits.low === "N/A") return null;
  return parseSortableNumber(key === "tmdeLow" ? limits.low : limits.high);
};

// --- HELPER COMPONENT: Sidebar Point Item (Supports Inline Editing) ---
export const SidebarPointItem = ({
  point,
  uutName = "Unassigned",
  currentUutId = "",
  uutOptions = [],
  onUutChange,
  mergedFields = {},
  valueColumnWidth = "80px",
  isSelected,
  isActivePoint = false,
  isTableSelected,
  liveRiskMetrics = null,
  isLiveRiskTarget = false,
  riskRequirements = {},
  onSelect,
  onSave,
  onContextMenu,
  onShowRiskBreakdown,
  autoEditValue = false,
  onAutoEditConsumed,
  visibleColumns = {
    uut: true,
    section: true,
    value: true,
    tolerance: true,
    lowLimit: true,
    highLimit: true,
    standardUncertainty: true,
    measurementUncertainty: true,
    pfa: false,
    pfr: false,
    tur: true,
    tar: false,
    observedReop: false,
    maxReop: false,
    trueReop: false,
    gbPfa: false,
    gbPfr: false,
    gbMult: false,
    gbLow: false,
    gbHigh: false,
    gbCalInt: false,
    gbMeasRel: false,
    noGbPfa: false,
    noGbPfr: false,
    noGbCalInt: false,
    noGbMeasRel: false,
  },
}) => {
  // 'section' | 'value' | 'qualifier' | null. A freshly quick-added point
  // mounts straight into value-edit (autoEditValue) so the user can just type.
  const [editingField, setEditingField] = useState(
    autoEditValue ? "value" : null,
  );
  const [tempValue, setTempValue] = useState(
    autoEditValue ? point.testPointInfo?.parameter?.value ?? "" : "",
  );

  // Clear the parent's one-shot auto-edit flag once we've consumed it.
  useEffect(() => {
    if (autoEditValue) onAutoEditConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEdit = (e, field, currentVal) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingField(field);
    setTempValue(
      currentVal !== undefined && currentVal !== null ? currentVal : "",
    );
  };

  const handleSingleClickEdit = (e, field, currentVal) => {
    const isPlainValueClick =
      field === "value" && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    if (!isSelected && isPlainValueClick) {
      onSelect?.(e, point);
    }
    if (isSelected || isPlainValueClick) {
      startEdit(e, field, currentVal);
    }
  };

  // A plain click on a risk metric just selects the point (what users usually
  // mean). The breakdown modal only opens on Ctrl/Cmd-click, so it isn't
  // triggered accidentally while clicking around a row. The modal is opened by
  // Analysis once the selected point's full riskResults are computed.
  const handleMetricClick = (e, metricKey) => {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      // Select as a clean single selection (strip modifiers so it doesn't also
      // toggle the multi-select set), then request the breakdown.
      onSelect?.({ ctrlKey: false, metaKey: false, shiftKey: false });
      onShowRiskBreakdown?.(metricKey);
    } else {
      onSelect?.(e);
    }
  };

  const cancelEdit = () => {
    setEditingField(null);
    setTempValue("");
  };

  const commitEdit = () => {
    if (editingField === "section") {
      onSave({ ...point, section: tempValue });
    } else if (editingField === "value") {
      const prevInfo = point.testPointInfo || {};
      const prevParam = prevInfo.parameter || {};

      const newInfo = {
        ...prevInfo,
        parameter: { ...prevParam, value: tempValue },
      };
      onSave({ ...point, testPointInfo: newInfo });
    } else if (editingField === "qualifier") {
      const prevInfo = point.testPointInfo || {};
      const prevQual = prevInfo.qualifier || {};
      const newInfo = {
        ...prevInfo,
        qualifier: {
          name: prevQual.name || "Qualifier",
          unit: prevQual.unit || "",
          ...prevQual,
          value: tempValue,
        },
      };
      onSave({ ...point, testPointInfo: newInfo });
    }
    setEditingField(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.target.blur(); // Triggers onBlur which commits
    }
    if (e.key === "Escape") cancelEdit();
  };

  // Safe Accessors
  const displayValue = point.testPointInfo?.parameter?.value;
  const displayUnit = point.testPointInfo?.parameter?.unit || "";
  // Prefer the live, reactively-computed metrics (always current with the
  // session inputs); fall back to the persisted backend snapshot only if the
  // point can't currently be evaluated (#1).
  const risk = liveRiskMetrics || point.riskMetrics || {};

  // Monte Carlo is an uncertainty-budget method now, not a separate risk
  // method. Only the measurement-unknown Risk 8 boundary needs a row marker.
  const riskMethodMark =
    risk.riskMethod === "risk8-pfa-boundary"
      ? {
          label: "Boundary",
          className: "",
          note: "Single-sided measurement unknown: PFA-only acceptance boundary",
        }
      : null;
  // Measurement-unknown rows expose only the Risk 8 PFA boundary. A known
  // single-sided measurement has the full Risk 8 result set and dedicated
  // breakdowns, so its metrics remain available to Ctrl/Cmd-click.
  const boundaryOnly = risk.riskMethod === "risk8-pfa-boundary";

  // --- COLOR LOGIC ---
  // Status colors are requirements-relative.  Keeping these thresholds local
  // to the row used to leave a freshly recalculated value painted against the
  // old hard-coded 2% / 4:1 defaults after the user changed Risk Inputs.
  const configuredPfaLimit = Number(riskRequirements?.reqPFA);
  const pfaLimit = Number.isFinite(configuredPfaLimit) && configuredPfaLimit >= 0
    ? configuredPfaLimit
    : 2;
  const configuredRatioLimit = Number(riskRequirements?.neededTUR);
  const ratioLimit = Number.isFinite(configuredRatioLimit) && configuredRatioLimit > 0
    ? configuredRatioLimit
    : 4;
  const lowerIsBetterColor = (val, limit) => {
    const numeric = Number(val);
    if (!Number.isFinite(numeric)) return "var(--text-color-muted)";
    if (numeric <= limit) return "var(--status-good)";
    return numeric > Math.max(limit * 2.5, limit + 3)
      ? "var(--status-bad)"
      : "var(--status-warning)";
  };
  const higherIsBetterColor = (val, limit) => {
    const numeric = Number(val);
    if (!Number.isFinite(numeric)) return "var(--text-color-muted)";
    if (numeric >= limit) return "var(--status-good)";
    return numeric < Math.min(1, limit / 4)
      ? "var(--status-bad)"
      : "var(--status-warning)";
  };

  const getPfaColor = (val) => {
    return lowerIsBetterColor(val, pfaLimit);
  };

  const getPfrColor = (val) => {
    // Risk Inputs expose one allowable decision-risk limit (Required PFA).
    // Use it as the visual attention threshold for both decision-risk columns;
    // the numerical PFR calculation itself remains independent.
    return lowerIsBetterColor(val, pfaLimit);
  };

  const getTurColor = (val) => {
    return higherIsBetterColor(val, ratioLimit);
  };

  const getTarColor = (val) => {
    return higherIsBetterColor(val, ratioLimit);
  };

  const formatMitigationNumber = (value, digits = 8) =>
    value !== undefined && value !== null && Number.isFinite(Number(value))
      ? Number(value).toFixed(digits).replace(/\.?0+$/, "")
      : "-";

  const formatMitigationPercent = (value, digits = 1) =>
    value !== undefined && value !== null && Number.isFinite(Number(value))
      ? `${Number(value).toFixed(digits)}%`
      : "-";

  // Hover text is intentionally only the unrounded stored value. Column
  // headings already explain what the number means; repeating the label and
  // interaction instructions made the native tooltip unnecessarily noisy.
  const fullMetricTitle = (_label, value) =>
    value !== undefined &&
    value !== null &&
    value !== "" &&
    Number.isFinite(Number(value))
      ? String(value)
      : "-";

  // Calculate Metrics
  const toleranceSummary = React.useMemo(() => {
    const ptParam = point.testPointInfo?.parameter;
    return getToleranceErrorSummary(point.uutTolerance, ptParam);
  }, [point.uutTolerance, point.testPointInfo]);

  const limitsData = React.useMemo(() => {
    const ptParam = point.testPointInfo?.parameter;
    const limits = getAbsoluteLimits(point.uutTolerance, ptParam);
    if (!limits || limits.low === "N/A") {
      return { low: "-", high: "-", fullLow: "-", fullHigh: "-" };
    }
    const shortLow = limits.low.split(" ")[0];
    const shortHigh = limits.high.split(" ")[0];
    const referenceUnitLabel = getUnitDisplayLabel(ptParam?.unit || "");
    const fullLimit = (raw, formatted) =>
      raw !== undefined
        ? `${raw}${raw !== "—" && referenceUnitLabel ? ` ${referenceUnitLabel}` : ""}`
        : formatted;
    return {
      low: shortLow,
      high: shortHigh,
      fullLow: fullLimit(limits.rawLow, limits.low),
      fullHigh: fullLimit(limits.rawHigh, limits.high),
    };
  }, [point.uutTolerance, point.testPointInfo]);

  const tmdeLimitsData = React.useMemo(() => {
    if (point.measurementType === "derived") {
      const entries = getTmdeAbsoluteLimitEntries(point.tmdeTolerances).map(
        (entry) => {
          const inputLabel = entry.variableType
            ? `${entry.variableType} · ${entry.description}`
            : entry.description;
          const quantityLabel = entry.quantity > 1 ? ` ×${entry.quantity}` : "";
          return {
            ...entry,
            label: `${inputLabel}${quantityLabel}`,
            shortLow: entry.low.split(" ")[0],
            shortHigh: entry.high.split(" ")[0],
          };
        },
      );
      return { low: "-", high: "-", entries };
    }

    const ptParam = point.testPointInfo?.parameter;
    const limits = getTmdeAbsoluteLimits(point.tmdeTolerances, ptParam);
    if (!limits || limits.low === "N/A") {
      return { low: "-", high: "-", entries: [] };
    }
    const shortLow = limits.low.split(" ")[0];
    const shortHigh = limits.high.split(" ")[0];
    return { low: shortLow, high: shortHigh, entries: [] };
  }, [
    point.measurementType,
    point.tmdeTolerances,
    point.testPointInfo,
  ]);

  const tmdeLimitsTitle = React.useMemo(() => {
    if (tmdeLimitsData.entries.length === 0) return null;
    return tmdeLimitsData.entries
      .map(
        (entry) =>
          `${entry.label}: ${entry.low} to ${entry.high}`,
      )
      .join("\n");
  }, [tmdeLimitsData]);

  return (
    <div
      className={`point-grid-item ${isSelected ? "active" : ""} ${isActivePoint ? "active-point" : ""} ${isTableSelected ? "table-highlight" : ""}`}
      style={{ gridTemplateColumns: getSidebarGridTemplate(visibleColumns, valueColumnWidth) }}
      onClick={(e) => {
        if (!editingField) {
          e.stopPropagation();
          onSelect(e, point);
        }
      }}
      onDoubleClick={(e) => {
        if (!editingField) {
          e.preventDefault();
          // Editing is inline + Detailed View now; double-click just opens the
          // point (selects it, which reveals the Detailed View).
          onSelect?.(e);
        }
      }}
      onContextMenu={(e) => onContextMenu(e, point)}
    >
      {visibleColumns.uut && (
        <span
          className={`point-uut-name point-uut-selector-cell${mergedFields.uut ? " is-visually-merged" : ""}`}
          title={uutName}
        >
          <select
            value={currentUutId || ""}
            aria-label="UUT"
            title={uutName}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              event.stopPropagation();
              onUutChange?.(event.target.value || null);
            }}
          >
            <option value="">Unassigned</option>
            {uutOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
      )}

      {/* Section */}
      {visibleColumns.section &&
        (editingField === "section" ? (
          <input
            autoFocus
            className="sidebar-inline-input section"
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            placeholder="-"
          />
        ) : (
          <span
            className={`point-section${mergedFields.section ? " is-visually-merged" : ""}`}
            onClick={(e) => handleSingleClickEdit(e, "section", point.section)}
            title={String(point.section || "-")}
          >
            {point.section || "-"}
          </span>
        ))}

      {/* Col 2: Value */}
      {visibleColumns.value &&
        (editingField === "value" ? (
          <div className="sidebar-inline-input-wrapper sidebar-value-sticky">
            <input
              autoFocus
              className="sidebar-inline-input value"
              value={tempValue}
              onChange={(e) => setTempValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
            {displayUnit && (
              <span className="point-value-unit point-value-unit--editor">
                {getUnitDisplayLabel(displayUnit)}
              </span>
            )}
          </div>
        ) : (
          <span
            className="point-value point-value-with-unit sidebar-value-sticky"
            onClick={(e) => handleSingleClickEdit(e, "value", displayValue)}
            title={`${displayValue ?? "-"}${
              displayUnit ? ` ${getUnitDisplayLabel(displayUnit)}` : ""
            }`}
          >
            <span className="point-value-number">
              {displayValue || <span className="point-placeholder">-</span>}
            </span>
            {displayUnit && (
              <span className="point-value-unit">
                {getUnitDisplayLabel(displayUnit)}
              </span>
            )}
          </span>
        ))}

      {/* Optional Qualifier column (e.g. Frequency) — hidden by default. */}
      {visibleColumns.qualifier &&
        (editingField === "qualifier" ? (
          <input
            autoFocus
            className="sidebar-inline-input value"
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            placeholder="-"
          />
        ) : (
          <span
            className={`point-value${mergedFields.qualifier ? " is-visually-merged" : ""}`}
            onClick={(e) =>
              handleSingleClickEdit(
                e,
                "qualifier",
                point.testPointInfo?.qualifier?.value,
              )
            }
            title={String(point.testPointInfo?.qualifier?.value ?? "-")}
          >
            {point.testPointInfo?.qualifier?.value || (
              <span className="point-placeholder">-</span>
            )}
          </span>
        ))}

      {/* Col 3: Tolerance */}
      {visibleColumns.tolerance && (
        <span className="point-metric" title={toleranceSummary}>
          {toleranceSummary !== "Not Set" &&
          toleranceSummary !== "Not Calculated"
            ? toleranceSummary
            : "-"}
        </span>
      )}

      {/* Col 4: Low Limit */}
      {visibleColumns.lowLimit && (
        <span className="point-metric" title={limitsData.fullLow}>
          {limitsData.low}
        </span>
      )}

      {/* Col 5: High Limit */}
      {visibleColumns.highLimit && (
        <span className="point-metric" title={limitsData.fullHigh}>
          {limitsData.high}
        </span>
      )}

      {/* The Value column already establishes the measurement unit. Keep the
          calculated uncertainty columns numeric, matching the low/high cells. */}
      {visibleColumns.standardUncertainty && (
        <span
          className="point-metric point-uncertainty-metric"
          title={formatSidebarUncertaintyFull(point, "combined")}
        >
          {formatSidebarUncertainty(point, "combined")}
        </span>
      )}
      {visibleColumns.measurementUncertainty && (
        <span
          className="point-metric point-uncertainty-metric"
          title={formatSidebarUncertaintyFull(point, "expanded")}
        >
          {formatSidebarUncertainty(point, "expanded")}
        </span>
      )}

      {/* TMDE Low Limit */}
      {visibleColumns.tmdeLow && (
        <span
          className={`point-metric ${
            tmdeLimitsData.entries.length > 0 ? "point-metric-list" : ""
          }`}
          title={tmdeLimitsTitle || tmdeLimitsData.low}
        >
          {tmdeLimitsData.entries.length > 0
            ? tmdeLimitsData.entries.map((entry) => (
                <span
                  className="point-metric-entry"
                  key={`${entry.id}-${entry.label}`}
                >
                  <strong>{entry.label}</strong>
                  {entry.shortLow}
                </span>
              ))
            : tmdeLimitsData.low}
        </span>
      )}

      {/* TMDE High Limit */}
      {visibleColumns.tmdeHigh && (
        <span
          className={`point-metric ${
            tmdeLimitsData.entries.length > 0 ? "point-metric-list" : ""
          }`}
          title={tmdeLimitsTitle || tmdeLimitsData.high}
        >
          {tmdeLimitsData.entries.length > 0
            ? tmdeLimitsData.entries.map((entry) => (
                <span
                  className="point-metric-entry"
                  key={`${entry.id}-${entry.label}`}
                >
                  <strong>{entry.label}</strong>
                  {entry.shortHigh}
                </span>
              ))
            : tmdeLimitsData.high}
        </span>
      )}

      {/* Col 5-8 Risk Columns. Clicking a metric selects the point and opens
          that metric's risk breakdown (handled in Analysis once the point's
          riskResults are ready). */}
      {visibleColumns.tur && (
        <span
          className={`point-risk-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          style={{ color: getTurColor(risk.tur), fontWeight: 600 }}
          title={fullMetricTitle("TUR", risk.tur, { action: true })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "tur")}
        >
          {risk.tur !== undefined ? `${Number(risk.tur).toFixed(2)}` : "-"}
        </span>
      )}
      {visibleColumns.tar && (
        <span
          className={`point-risk-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          style={{ color: getTarColor(risk.tar) }}
          title={fullMetricTitle("TAR", risk.tar, { action: true })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "tar")}
        >
          {risk.tar !== undefined ? `${Number(risk.tar).toFixed(1)}` : "-"}
        </span>
      )}
      {visibleColumns.observedReop && (
        <span
          className={`point-risk-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          title={fullMetricTitle("REOP at test-point TUR", risk.observedReop, {
            suffix: "%",
            action: true,
          })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "observedreop")}
        >
          {formatMitigationPercent(risk.observedReop, 2)}
        </span>
      )}
      {visibleColumns.pfa && (
        <span
          className={`point-risk-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          style={{ color: getPfaColor(risk.pfa), fontWeight: 600 }}
          title={fullMetricTitle("PFA", risk.pfa, {
            suffix: "%",
            action: true,
            note: riskMethodMark?.note || "",
          })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "pfa")}
        >
          {risk.pfa !== undefined ? `${Number(risk.pfa).toFixed(2)}%` : "-"}
          {riskMethodMark && (
            <span
              className={`point-method-badge ${riskMethodMark.className}`}
            >
              {riskMethodMark.label}
            </span>
          )}
        </span>
      )}
      {visibleColumns.pfr && (
        <span
          className={`point-risk-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          style={{ color: getPfrColor(risk.pfr) }}
          title={fullMetricTitle("PFR", risk.pfr, { suffix: "%", action: true })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "pfr")}
        >
          {risk.pfr !== undefined ? `${Number(risk.pfr).toFixed(2)}%` : "-"}
        </span>
      )}
      {visibleColumns.maxReop && (
        <span
          className={`point-risk-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          title={fullMetricTitle("Maximum REOP", risk.maxReop, {
            suffix: "%",
            action: true,
          })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "maxreop")}
        >
          {formatMitigationPercent(risk.maxReop, 2)}
        </span>
      )}
      {visibleColumns.trueReop && (
        <span
          className={`point-risk-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          title={fullMetricTitle("R_meas", risk.trueReop, { suffix: "%", action: true })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "truereop")}
        >
          {formatMitigationPercent(risk.trueReop, 2)}
        </span>
      )}
      {visibleColumns.gbMult && (
        <span
          className={`point-metric point-risk-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          title={fullMetricTitle("Guardband Multiplier", risk.gbMult, {
            suffix: "%",
            action: true,
          })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "gbmult")}
        >
          {risk.gbMult !== undefined ? `${Number(risk.gbMult).toFixed(2)}%` : "-"}
        </span>
      )}
      {visibleColumns.gbLow && (
        <span
          className={`point-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          title={fullMetricTitle("Guardband Low Limit", risk.gbLow, { action: true })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "gblow")}
        >
          {risk.gbLow !== undefined ? Number(risk.gbLow).toPrecision(4) : "-"}
        </span>
      )}
      {visibleColumns.gbHigh && (
        <span
          className={`point-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          title={fullMetricTitle("Guardband High Limit", risk.gbHigh, { action: true })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "gbhigh")}
        >
          {risk.gbHigh !== undefined ? Number(risk.gbHigh).toPrecision(4) : "-"}
        </span>
      )}
      {visibleColumns.gbPfa && (
        <span
          className={`point-risk-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          style={{ color: getPfaColor(risk.gbPfa), fontWeight: 600 }}
          title={fullMetricTitle("PFA with Guardband", risk.gbPfa, {
            suffix: "%",
            action: true,
          })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "gbpfa")}
        >
          {risk.gbPfa !== undefined ? `${Number(risk.gbPfa).toFixed(2)}%` : "-"}
        </span>
      )}
      {visibleColumns.gbPfr && (
        <span
          className={`point-risk-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          style={{ color: getPfrColor(risk.gbPfr) }}
          title={fullMetricTitle("PFR with Guardband", risk.gbPfr, {
            suffix: "%",
            action: true,
          })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "gbpfr")}
        >
          {risk.gbPfr !== undefined ? `${Number(risk.gbPfr).toFixed(2)}%` : "-"}
        </span>
      )}
      {visibleColumns.gbCalInt && (
        <span
          className={`point-metric point-risk-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          title={fullMetricTitle("Calibration Interval with Guard Banding", risk.gbCalInt, {
            action: true,
          })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "gbcalint")}
        >
          {formatMitigationNumber(risk.gbCalInt)}
        </span>
      )}
      {visibleColumns.gbMeasRel && (
        <span
          className={`point-metric point-risk-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          title={fullMetricTitle("Targeted REOP with GB", risk.gbMeasRel, {
            suffix: "%",
            action: true,
          })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "gbmeasrel")}
        >
          {formatMitigationPercent(risk.gbMeasRel, 2)}
        </span>
      )}
      {visibleColumns.noGbPfa && (
        <span
          className={`point-metric point-risk-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          title={fullMetricTitle("PFA without GB", risk.noGbPfa, {
            suffix: "%",
            action: true,
          })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "nogbpfa")}
        >
          {formatMitigationPercent(risk.noGbPfa, 2)}
        </span>
      )}
      {visibleColumns.noGbPfr && (
        <span
          className={`point-metric point-risk-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          title={fullMetricTitle("PFR without GB", risk.noGbPfr, {
            suffix: "%",
            action: true,
          })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "nogbpfr")}
        >
          {formatMitigationPercent(risk.noGbPfr, 2)}
        </span>
      )}
      {visibleColumns.noGbCalInt && (
        <span
          className={`point-metric point-risk-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          title={fullMetricTitle(
            "Calibration Interval without Guard Banding",
            risk.noGbCalInt,
            { action: true },
          )}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "calint")}
        >
          {formatMitigationNumber(risk.noGbCalInt)}
        </span>
      )}
      {visibleColumns.noGbMeasRel && (
        <span
          className={`point-metric point-risk-metric${boundaryOnly ? "" : " point-risk-metric-clickable"}`}
          title={fullMetricTitle("Targeted REOP without GB", risk.noGbMeasRel, {
            suffix: "%",
            action: true,
          })}
          onClick={boundaryOnly ? undefined : (e) => handleMetricClick(e, "measrel")}
        >
          {formatMitigationPercent(risk.noGbMeasRel, 2)}
        </span>
      )}
    </div>
  );
};

// --- HELPER: Extract All Ranges from UUT ---
const getAllUutRanges = (uut) => {
  if (!uut) return [];
  const ranges = getInstrumentRangeRows(uut);

  // Add a display label for the sidebar using the same unit-symbol formatter as
  // the main analysis tables (degF -> °F, uV -> µV, Ohm -> Ω, etc.).
  const finalRanges = ranges.map((r, index) => {
    const rangeLabel = formatRangeLabel(r, { preferBounds: true });
    let label = rangeLabel;

    // Prepend Function Name if available
    if (r.functionName) {
      label = `${r.functionName}: ${label}`;
    }

    return { ...r, _id: index, _index: r._index ?? index, rangeLabel, label };
  });

  return finalRanges;
};

// --- HELPER: Find & Normalize Matching Range (Used for selection logic) ---
const findMatchingRange = (uut, value, unit) => {
  if (!uut || value === null || value === undefined) return null;
  const allRanges = getAllUutRanges(uut);
  const numericValue = parseFloat(value);
  if (isNaN(numericValue)) return allRanges[0] || null;

  const match = allRanges.find((r) => {
    const min = parseFloat(r.min);
    const max = parseFloat(r.max);
    // Case-insensitive unit check
    const unitMatch =
      !unit || !r.unit || unit.toLowerCase() === r.unit.toLowerCase();

    if (!isNaN(min) && !isNaN(max)) {
      return unitMatch && numericValue >= min && numericValue <= max;
    }
    return unitMatch;
  });

  return match || allRanges[0] || null;
};

const pointToleranceMatchesFunction = (point, tolerance) => {
  if (!point || !tolerance || Object.keys(tolerance || {}).length === 0) {
    return false;
  }
  const pointKey = functionKeyOf(point);
  const toleranceName = tolerance.functionName || tolerance.name || "";
  const toleranceUnit = tolerance.functionUnit || tolerance.unit || "";
  if (toleranceName) {
    return makeFunctionKey(toleranceName, toleranceUnit) === pointKey;
  }
  const pointUnit = point.testPointInfo?.parameter?.unit || "";
  return (
    !pointUnit ||
    !toleranceUnit ||
    String(pointUnit).trim().toLowerCase() ===
      String(toleranceUnit).trim().toLowerCase()
  );
};

// --- HELPER COMPONENT: Sidebar Session Header (Inline Editing) ---
const SidebarSessionHeader = ({
  sessionData,
  onUpdate,
  isSessionInfoOpen,
  onSessionInfoOpenChange,
  isRiskInputsOpen,
  onRiskInputsOpenChange,
  isMitigationInputsOpen,
  onMitigationInputsOpenChange,
}) => {
  const [editingField, setEditingField] = useState(null);
  const [tempValue, setTempValue] = useState("");

  if (!sessionData) return null;

  const startEdit = (e, field, val) => {
    e.stopPropagation();
    setEditingField(field);
    setTempValue(val || "");
  };

  const commitEdit = () => {
    if (editingField) {
      if (!editingField.startsWith("uncReq.")) {
        onUpdate({ ...sessionData, [editingField]: tempValue });
      }
      setEditingField(null);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      commitEdit();
    }
    if (e.key === "Escape") {
      setEditingField(null);
    }
  };

  const formatDate = (isoString) => {
    if (!isoString) return "-";
    const [y, m, d] = isoString.split("-");
    return `${m}/${d}/${y}`;
  };

  const updateRequirement = (field, value) => {
    const reqKey = field.slice("uncReq.".length);
    onUpdate({
      ...sessionData,
      uncReq: { ...(sessionData.uncReq || {}), [reqKey]: value },
    });
  };

  const renderEditableField = (field, value, label, inputType = "text", tooltip) => {
    const isRequirement = field.startsWith("uncReq.");
    const helpText = tooltip || `Edit ${label}`;
    return (
      // `field` is unique per row, so it doubles as the React key for the
      // requirement-list .map() (and is harmless for the fixed grid fields).
      <div className="session-header-field" key={field}>
        <span className="session-header-label" title={helpText}>
          <span>{label}</span>
          {isRequirement && (
            <FontAwesomeIcon
              icon={faQuestionCircle}
              className="requirement-help-icon"
              aria-hidden="true"
            />
          )}
        </span>
        {editingField === field ? (
          <input
            type={inputType}
            autoFocus
            value={isRequirement ? value ?? "" : tempValue}
            aria-label={label}
            title={helpText}
            onChange={(e) => {
              if (isRequirement) {
                updateRequirement(field, e.target.value);
              } else {
                setTempValue(e.target.value);
              }
            }}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="session-header-input"
          />
        ) : (
          <div
            onClick={(e) => startEdit(e, field, value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") startEdit(e, field, value);
            }}
            role="button"
            tabIndex={0}
            className="session-header-value"
            title={helpText}
          >
            {inputType === "date" ? formatDate(value) : value || "-"}
          </div>
        )}
      </div>
    );
  };

  const requirements = sessionData.uncReq || {};

  return (
    <div className="sidebar-session-header-organic" data-tour="session-information">
      <div className="session-collapsible-block session-info-block">
        <button
          type="button"
          className="session-section-toggle"
          onClick={(e) => {
            e.stopPropagation();
            const nextOpen = !isSessionInfoOpen;
            if (nextOpen) {
              // Session Info is the parent workspace for both requirement
              // groups. Reopening it should reveal the complete input set.
              onRiskInputsOpenChange(true);
              onMitigationInputsOpenChange(true);
            }
            onSessionInfoOpenChange(nextOpen);
          }}
          aria-expanded={isSessionInfoOpen}
        >
          <span>Session Info</span>
          <FontAwesomeIcon icon={isSessionInfoOpen ? faChevronDown : faChevronRight} />
        </button>

        {isSessionInfoOpen && (
          <div className="session-info-content">
            {/* TITLE / NAME */}
            <div style={{ marginBottom: "4px" }}>
              {editingField === "name" ? (
                <input
                  autoFocus
                  value={tempValue}
                  onChange={(e) => setTempValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={handleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  className="session-header-input session-header-name-input"
                  placeholder="Session Name"
                />
              ) : (
                <div
                  onClick={(e) => startEdit(e, "name", sessionData.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      startEdit(e, "name", sessionData.name);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className="session-header-value session-header-name"
                  title="Edit Session Name"
                >
                  {sessionData.name || "Untitled Session"}
                </div>
              )}
            </div>

            {/* 2x2 GRID FOR ORG, ANALYST, DOC, DATE */}
            <div className="session-header-grid">
              {renderEditableField("organization", sessionData.organization, "Organization")}
              {renderEditableField("analyst", sessionData.analyst, "Analyst")}
              {renderEditableField("document", sessionData.document, "Doc ID")}
              {renderEditableField(
                "documentDate",
                sessionData.documentDate,
                "Document Date",
                "date",
              )}
            </div>
            <div className="session-collapsible-block session-subsection-block">
              <button
                type="button"
                className="session-section-toggle session-subsection-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  onRiskInputsOpenChange(!isRiskInputsOpen);
                }}
                aria-expanded={isRiskInputsOpen}
              >
                <span>Risk Inputs</span>
                <FontAwesomeIcon
                  icon={isRiskInputsOpen ? faChevronDown : faChevronRight}
                />
              </button>
              {isRiskInputsOpen && (
                <div className="session-requirements-grid">
                  {RISK_INPUT_FIELDS.map((field) =>
                    renderEditableField(
                      `uncReq.${field.name}`,
                      requirements[field.name],
                      field.sidebarLabel,
                      "number",
                      field.tooltip,
                    ),
                  )}
                </div>
              )}
            </div>

            <div className="session-collapsible-block session-subsection-block">
              <button
                type="button"
                className="session-section-toggle session-subsection-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  onMitigationInputsOpenChange(!isMitigationInputsOpen);
                }}
                aria-expanded={isMitigationInputsOpen}
              >
                <span>Mitigation Inputs</span>
                <FontAwesomeIcon
                  icon={isMitigationInputsOpen ? faChevronDown : faChevronRight}
                />
              </button>
              {isMitigationInputsOpen && (
                <div className="session-requirements-grid">
                  {MITIGATION_INPUT_FIELDS.map((field) =>
                    renderEditableField(
                      `uncReq.${field.name}`,
                      requirements[field.name],
                      field.sidebarLabel,
                      "number",
                      field.tooltip,
                    ),
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function App({ showThemeToggle = false }) {
  const {
    sessions,
    sessionsLoaded,
    instruments,
    customEquations,
    saveCustomEquation,
    deleteCustomEquation,
    bugReports,
    saveInstrument,
    reconcileSyncedInstrument,
    saveBugReport,
    deleteBugReport,
    deleteInstrument,
    selectedSessionId,
    setSelectedSessionId,
    selectedTestPointId,
    setSelectedTestPointId,
    currentSessionData,
    currentTestPoints,
    defaultTestPoint,
    addSession,
    deleteSession,
    updateSession,
    updateSessionNotes,
    undoLastSessionChange,
    importSession,
    saveTestPoint,
    updateTestPointData,
    decrementTmdeQuantity,
    loadSessionImages,
  } = useSessionManager();

  // Theme + toasts are provided by the workbench shell (global light/dark
  // toggle in WorkbenchTopBar; toast stack at the shell root). The module no
  // longer owns its own dark-mode/theme state or a local toast.
  const { theme, toggleTheme } = useTheme();
  const isDarkMode = theme === "dark";

  const [isToleranceModalOpen, setIsToleranceModalOpen] = useState(false);

  const [breakdownPoint, setBreakdownPoint] = useState(null);
  const [infoModalPoint, setInfoModalPoint] = useState(null);
  const [confirmationModal, setConfirmationModal] = useState(null);
  const [appNotification, setAppNotification] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [unresolvedToleranceModal, setUnresolvedToleranceModal] =
    useState(null);

  const [isConverterOpen, setIsConverterOpen] = useState(false);
  const [isTraceabilityOpen, setIsTraceabilityOpen] = useState(false);

  // Instrument Manager Modal State
  // We use this boolean to open the modal in 'library' mode from the Tools menu.
  // Editing specific instances (UUT/TMDE) is handled via handlers passed to Analysis.
  const [isInstrumentBuilderOpen, setIsInstrumentBuilderOpen] = useState(false);
  const [instrumentModalConfig, setInstrumentModalConfig] = useState({
    mode: "library",
    data: null,
    associateToPointId: null,
  });

  const [isBugReportOpen, setIsBugReportOpen] = useState(false);
  const [isWalkthroughOpen, setIsWalkthroughOpen] = useState(false);
  const [walkthroughStepIndex, setWalkthroughStepIndex] = useState(0);
  const walkthroughAutoStartedRef = useRef(false);

  const walkthroughSteps = useMemo(
    () => [
      {
        id: "new-session",
        title: "Start an analysis session",
        description:
          "Select the highlighted add button to create your first analysis session. Sessions keep instruments, points, budgets, and notes together.",
        hint:
          sessions.length === 0
            ? "Click the highlighted + to continue."
            : "You already have a session, so you can continue or create another one.",
        target: '[data-tour="add-session"]',
        advanceOnTargetClick: true,
        canAdvance: sessions.length > 0,
      },
      {
        id: "session-information",
        title: "Complete the session information",
        description:
          "Give the session a recognizable name, then enter the analyst, organization, document, and date. The risk and mitigation inputs below establish the requirements used across the session.",
        target: '[data-tour="session-information"]',
        hint: "Values save as you enter them. Required analysis settings can be refined at any time.",
      },
      {
        id: "overview-tab",
        title: "Open Instrument Overview",
        description:
          "Instrument Overview is where you define the UUT and TMDE available to every measurement point in this session.",
        target: '[data-tour="tab-overview"]',
      },
      {
        id: "uut-function",
        title: "Create the UUT function",
        description:
          "Use this add button to create the function being tested, such as Voltage, Weight, or Torque. Existing functions are listed for reuse, and a session can contain as many functions as needed.",
        target: '[data-tour="uut-add-function"]',
        revealedTarget: '[data-tour="uut-function-menu"]',
      },
      {
        id: "uut-instrument",
        title: "Add the unit under test",
        description:
          "Use the + on the function header to add an instrument. Choose a local or shared instrument from the Description suggestions, or enter a new instrument directly through Description, Range, Tolerance, and Resolution.",
        target: '[data-tour="uut-add-instrument"]',
        hint: "Each range remains aligned with its tolerance and resolution, and any number of UUTs can share this function.",
      },
      {
        id: "uut-columns",
        title: "Define the UUT specifications",
        description:
          "Description identifies the instrument. Range defines where a specification applies, Tolerance defines its accuracy, Resolution defines readable increments, and Sync controls sharing with the validated library.",
        target: '[data-tour="uut-table"]',
      },
      {
        id: "function-settings",
        title: "Review Function Settings",
        description:
          "Hover beside the function name and open the settings button. Keep Direct selected for this walkthrough. Reusing the first point's budget makes later points inherit the complete initial budget.",
        target: '[data-tour="function-settings"]',
        revealedTarget: '[data-tour="function-settings-menu"]',
      },
      {
        id: "measurement-point",
        title: "Create a direct measurement point",
        description:
          "Select the + on the function header. If several UUTs share the function, choose the instrument from the menu that opens, then enter the measurement value in the new sidebar row.",
        target: '[data-tour="add-measurement-point"]',
        revealedTarget: '[data-tour="measurement-point-menu"]',
      },
      {
        id: "tmde-function",
        title: "Create the TMDE function",
        description:
          "Now repeat the setup for the measuring equipment. Add the function used by the TMDE; it can reuse a function already defined in the session.",
        target: '[data-tour="tmde-add-function"]',
        revealedTarget: '[data-tour="tmde-function-menu"]',
      },
      {
        id: "tmde-instrument",
        title: "Add the TMDE",
        description:
          "Use the function's + button to add the measuring instrument, then select a local or shared definition or enter a new Description, Range, Tolerance, and Resolution.",
        target: '[data-tour="tmde-add-instrument"]',
      },
      {
        id: "tmde-columns",
        title: "Define the TMDE specifications",
        description:
          "Complete the TMDE table just like the UUT table. These specifications become the selectable accuracy and resolution sources used in uncertainty budgets.",
        target: '[data-tour="tmde-table"]',
      },
      {
        id: "workspace-tabs",
        title: "Understand the three workspaces",
        description:
          "Instrument Overview manages session instruments. Uncertainty Budget builds and calculates the selected point's budget. Notes stores formatted session documentation and supporting images.",
        target: '[data-tour="analysis-tabs"]',
      },
      {
        id: "budget-tab",
        title: "Open the Uncertainty Budget",
        description:
          "Select a measurement point, then open Uncertainty Budget. The selected point's UUT nominal, instrument sources, calculation controls, and results appear here.",
        target: '[data-tour="tab-budget"]',
      },
      {
        id: "budget-component",
        title: "Build the budget",
        description:
          "Use Add component on each budget table to select a compatible tolerance, resolution, repeatability result, or manual source. Configure its distribution and coverage details, then calculate the combined and expanded uncertainty.",
        target: '[data-tour="budget-add-component"]',
        revealedTarget: '[data-tour="budget-component-menu"]',
        hint: "A yellow range warning appears when a selected instrument range does not contain the direct measurement nominal.",
      },
      {
        id: "complete",
        title: "Your direct workflow is ready",
        description:
          "You now know the direct-measurement path from session setup through instruments, points, and uncertainty budgets. Use the Help button at any time to restart this walkthrough.",
        target: '[data-tour="help-walkthrough"]',
      },
    ],
    [sessions.length],
  );

  useEffect(() => {
    if (
      !sessionsLoaded ||
      sessions.length > 0 ||
      walkthroughAutoStartedRef.current
    ) return;

    // Mark this only when onboarding truly starts. Previously a successful
    // load with existing sessions consumed the one-time check, so deleting
    // the final session later left the user on an empty workspace with no
    // guidance.
    walkthroughAutoStartedRef.current = true;
    setWalkthroughStepIndex(0);
    setIsWalkthroughOpen(true);
  }, [sessions.length, sessionsLoaded]);

  useEffect(() => {
    if (!isWalkthroughOpen) return;
    const stepId = walkthroughSteps[walkthroughStepIndex]?.id;
    if (stepId === "session-information") setIsSessionInfoOpen(true);
  }, [isWalkthroughOpen, walkthroughStepIndex, walkthroughSteps]);

  const [sessionImageCache, setSessionImageCache] = useState(new Map());
  const [riskResults, setRiskResults] = useState(null);
  // A risk metric key (e.g. "pfa", "gbpfa") requested from a sidebar row click.
  // Analysis opens the matching breakdown once the clicked point becomes active
  // and its riskResults are computed, then clears this.
  const [pendingRiskBreakdown, setPendingRiskBreakdown] = useState(null);

  const [sidebarWidth, setSidebarWidth] = useState(550);
  const [isSessionInfoOpen, setIsSessionInfoOpen] = useState(true);
  const [isRiskInputsOpen, setIsRiskInputsOpen] = useState(true);
  const [isMitigationInputsOpen, setIsMitigationInputsOpen] = useState(true);
  const [analysisMode, setAnalysisMode] = useState("overview");
  const analysisScrollPositionsRef = useRef({});
  const lastSelectedPointBySessionRef = useRef({});
  const [showContribution, setShowContribution] = useState(false);
  const [scopedZoomLevels, setScopedZoomLevels] = useState({});
  const [loadedPreferencesSessionId, setLoadedPreferencesSessionId] =
    useState(null);
  const isResizingRef = useRef(false);
  // The flex row that holds the sidebar + main pane. The resize math measures
  // the pointer against this element's box (not the viewport) so the divider
  // tracks the cursor exactly regardless of the container's padding or the
  // vertical scrollbar width — which differs between a browser (classic
  // scrollbars reserve width) and Electron (overlay scrollbars reserve none).
  const resultsContainerRef = useRef(null);

  // --- SIDEBAR PREFERENCES ---
  const [sidebarColumns, setSidebarColumns] = useState({
    uut: true,
    section: false,
    value: true,
    // Optional secondary parameter (e.g. Frequency); off by default.
    qualifier: false,
    tolerance: false,
    lowLimit: true,
    highLimit: true,
    standardUncertainty: true,
    measurementUncertainty: true,
    tmdeLow: false,
    tmdeHigh: false,
    pfa: true,
    pfr: true,
    tur: true,
    tar: false,
    observedReop: false,
    maxReop: false,
    trueReop: false,
    // Guardband columns (off by default; guardband is only computed when at
    // least one of these is enabled — see pointRiskMap below).
    gbPfa: false,
    gbPfr: false,
    gbMult: false,
    gbLow: false,
    gbHigh: false,
    gbCalInt: false,
    gbMeasRel: false,
    noGbPfa: false,
    noGbPfr: false,
    noGbCalInt: false,
    noGbMeasRel: false,
  });
  const [sidebarSort, setSidebarSort] = useState(DEFAULT_SIDEBAR_SORT);
  // Keep explicitly enabled columns visible even if their current values are
  // blank. Hiding Section in that state made its filter appear broken and
  // prevented users from entering the first section value.
  const visibleSidebarColumns = sidebarColumns;
  // Reactive per-point risk metrics for the sidebar columns. Recomputed purely
  // in memory (no DB hits) whenever the points or the session's requirements /
  // shared tolerance change, so every row reflects the latest inputs without
  // needing to be clicked (#1).
  // Guardband is iterative/expensive, so only compute it for the sidebar when at
  // least one guardband column is actually enabled in the filter.
  const mitigationColumnsEnabled =
    sidebarColumns.gbPfa ||
    sidebarColumns.gbPfr ||
    sidebarColumns.gbMult ||
    sidebarColumns.gbLow ||
    sidebarColumns.gbHigh ||
    sidebarColumns.gbCalInt ||
    sidebarColumns.gbMeasRel ||
    sidebarColumns.noGbPfa ||
    sidebarColumns.noGbPfr ||
    sidebarColumns.noGbCalInt ||
    sidebarColumns.noGbMeasRel;
  const pointRiskMap = useMemo(
    () =>
      computeRiskMetricsMap(
        currentTestPoints,
        currentSessionData,
        mitigationColumnsEnabled,
      ),
    [
      currentTestPoints,
      currentSessionData?.uncReq,
      currentSessionData?.uutTolerance,
      // Derived points can keep linked TMDE error sources in their manual
      // budget instead of tmdeTolerances. Include the live master collection
      // so editing an instrument invalidates the sidebar risk map even when
      // the point's own snapshot array is unchanged.
      currentSessionData?.tmdes,
      mitigationColumnsEnabled,
    ],
  );

  const handleSidebarSort = useCallback((key) => {
    setSidebarSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }, []);

  const getSidebarSortValue = useCallback(
    (point, key) => {
      const risk = pointRiskMap[point.id] || point.riskMetrics || {};
      switch (key) {
        case "uut": {
          const uutId = (point.associatedUutIds || [])[0];
          const uut = (currentSessionData?.uuts || []).find(
            (candidate) => String(candidate.id) === String(uutId),
          );
          return formatInstrumentIdentity(uut || { name: "Unassigned" });
        }
        case "section":
          return point.section || "";
        case "value":
          return parseSortableNumber(point.testPointInfo?.parameter?.value);
        case "qualifier":
          return parseSortableNumber(point.testPointInfo?.qualifier?.value);
        case "tolerance":
          return getPointToleranceSortValue(point);
        case "lowLimit":
        case "highLimit":
          return getPointLimitSortValue(point, key);
        case "tmdeLow":
        case "tmdeHigh":
          return getPointTmdeLimitSortValue(point, key);
        case "standardUncertainty":
          return parseSortableNumber(point.combined_uncertainty);
        case "measurementUncertainty":
          return parseSortableNumber(point.expanded_uncertainty);
        case "pfa":
        case "pfr":
        case "tur":
        case "tar":
        case "observedReop":
        case "maxReop":
        case "trueReop":
        case "gbPfa":
        case "gbPfr":
        case "gbMult":
        case "gbLow":
        case "gbHigh":
        case "gbCalInt":
        case "gbMeasRel":
        case "noGbPfa":
        case "noGbPfr":
        case "noGbCalInt":
        case "noGbMeasRel":
          return risk[key];
        default:
          return "";
      }
    },
    [currentSessionData?.uuts, pointRiskMap],
  );

  const sortSidebarPoints = useCallback(
    (points) => {
      if (!sidebarSort.key) return [...points];
      const directionMultiplier = sidebarSort.direction === "asc" ? 1 : -1;
      return [...points].sort((a, b) => {
        const aValue = getSidebarSortValue(a, sidebarSort.key);
        const bValue = getSidebarSortValue(b, sidebarSort.key);
        const aNumber = parseSortableNumber(aValue);
        const bNumber = parseSortableNumber(bValue);
        const aMissing =
          aValue === undefined || aValue === null || String(aValue) === "";
        const bMissing =
          bValue === undefined || bValue === null || String(bValue) === "";

        if (aMissing && bMissing) return 0;
        if (aMissing) return 1;
        if (bMissing) return -1;

        if (aNumber !== null && bNumber !== null) {
          return (aNumber - bNumber) * directionMultiplier;
        }

        return String(aValue).localeCompare(String(bValue), undefined, {
          numeric: true,
          sensitivity: "base",
        }) * directionMultiplier;
      });
    },
    [getSidebarSortValue, sidebarSort],
  );

  const renderSidebarSortHeader = useCallback(
    (key, label, { align = "left", title = label, className = "" } = {}) => {
      const isActive = sidebarSort.key === key;
      const directionLabel = sidebarSort.direction === "asc" ? "ascending" : "descending";
      return (
        <button
          type="button"
          className={`sidebar-sort-header sidebar-sort-header--${key} ${className} ${isActive ? "active" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            handleSidebarSort(key);
          }}
          title={`Sort by ${title}${isActive ? ` (${directionLabel})` : ""}`}
          aria-label={`Sort by ${title}`}
          aria-sort={isActive ? directionLabel : "none"}
          style={{ textAlign: align }}
        >
          <span>{label}</span>
        </button>
      );
    },
    [handleSidebarSort, sidebarSort],
  );

  const [isGlobalExpanded, setIsGlobalExpanded] = useState(false);

  // Resize Effect
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingRef.current) return;

      const container = resultsContainerRef.current;
      if (!container) return;

      // --- CONFIGURATION ---
      const MIN_SIDEBAR_WIDTH = 300;
      const MAX_SIDEBAR_WIDTH = 1800; // Wide workstations can expose the full measurement/risk result set
      const MIN_CONTENT_WIDTH = 320; // The main pane scrolls cleanly below its comfortable content width

      // Measure against the container's own box, not the viewport. The sidebar
      // is laid out inside this padded element, so the desired width is the
      // pointer's distance from the sidebar's left (content) edge:
      //   sidebarWidth = clientX - rect.left - paddingLeft
      // Clamping against the container's inner width (rect.width minus its
      // horizontal padding) — instead of window.innerWidth — keeps the divider
      // under the cursor and immune to scrollbar width + padding, so it behaves
      // identically in a browser and in Electron. Padding is read live so it
      // stays correct if the CSS padding changes.
      const rect = container.getBoundingClientRect();
      const cs = window.getComputedStyle(container);
      const paddingLeft = parseFloat(cs.paddingLeft) || 0;
      const paddingRight = parseFloat(cs.paddingRight) || 0;
      const innerWidth = rect.width - paddingLeft - paddingRight;

      const pointer = e.clientX - rect.left - paddingLeft;

      // The available width for the sidebar reserves MIN_CONTENT_WIDTH for the
      // main panel, capped by the hard maximum.
      const dynamicMaxWidth = innerWidth - MIN_CONTENT_WIDTH;
      const effectiveLimit = Math.min(MAX_SIDEBAR_WIDTH, dynamicMaxWidth);

      // Apply constraints
      const newWidth = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(pointer, effectiveLimit),
      );

      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = "default";
        document.body.style.userSelect = "auto";
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const startResizing = (e) => {
    e.preventDefault(); // Prevent text selection start
    isResizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none"; // Disable text selection while dragging
  };

  // Unified button handler
  const handleToggleExpandAll = () => {
    if (isGlobalExpanded) {
      // Collapse Logic
      setExpandedFunctions(new Set());
      setExpandedUuts(new Set());
      setIsGlobalExpanded(false);
    } else {
      // Expand Logic
      const allFunctionIds = new Set(sidebarData.map((fn) => fn.id));
      const allUutKeys = new Set();

      sidebarData.forEach((fn) => {
        fn.uutGroups.forEach((group) => {
          allUutKeys.add(`${fn.id}::${group.id}`);
        });
      });

      setExpandedFunctions(allFunctionIds);
      setExpandedUuts(allUutKeys);
      setIsGlobalExpanded(true);
    }
  };

  const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);
  const columnMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        columnMenuRef.current &&
        !columnMenuRef.current.contains(event.target)
      ) {
        setIsColumnMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // --- SELECTION & VIRTUAL STATE ---
  // The sidebar tree is organized Function -> UUT -> Point. `selectedFunctionId`
  // is a function key (see utils/functionGrouping) rather than a measurement area.
  const [selectedFunctionId, setSelectedFunctionId] = useState(null);
  const [selectedUutId, setSelectedUutId] = useState(null);
  const [virtualPoint, setVirtualPoint] = useState(null);
  const [activeRangeIndices, setActiveRangeIndices] = useState({});

  // --- SIDEBAR EXPANSION STATE (Simple accordion control) ---
  // expandedFunctions holds function keys; expandedUuts holds composite
  // `${functionKey}::${uutId}` keys so the same UUT under two functions expands
  // independently.
  const [expandedFunctions, setExpandedFunctions] = useState(new Set());
  const [expandedUuts, setExpandedUuts] = useState(new Set());
  // Shared by the session overview and every detailed measurement-point view.
  // This state lives above TestPointDetailView's keyed remount boundary so a
  // point/view change cannot reset the UUT/TMDE function accordions.
  const [collapsedInstrumentFunctionKeys, setCollapsedInstrumentFunctionKeys] =
    useState(new Set());

  // Tracks which UUT "folder" was clicked in the sidebar to enforce context
  const [selectedTestPointContextUutId, setSelectedTestPointContextUutId] =
    useState(null);

  // ---  Table Selection State ---
  const [selectedTablePointIds, setSelectedTablePointIds] = useState([]);

  // --- NEW: Sidebar Multi-Select State ---
  const [selectedSidebarPointIds, setSelectedSidebarPointIds] = useState([]);
  // Anchor for shift-click range selection. Context disambiguates a point that
  // is rendered under more than one UUT branch.
  const [sidebarSelectionAnchor, setSidebarSelectionAnchor] = useState(null);
  // Id of a just-quick-added direct point whose sidebar row should open straight
  // into value-edit. SidebarPointItem consumes it on mount, then App clears it.
  const [pendingValueEditPointId, setPendingValueEditPointId] = useState(null);
  // Function headers own point creation now that UUT folder rows are gone.
  // When a function exposes more than one range unit, the quick-add button
  // pauses here so the new direct/derived point can be attached to an explicit
  // unit instead of silently choosing the first range.
  const [pendingPointUnitChoice, setPendingPointUnitChoice] = useState(null);
  const [openFunctionSettingsId, setOpenFunctionSettingsId] = useState(null);

  useEffect(() => {
    if (!pendingPointUnitChoice) return undefined;
    const closePicker = (event) => {
      if (event.target?.closest?.(".point-unit-picker")) return;
      setPendingPointUnitChoice(null);
    };
    document.addEventListener("pointerdown", closePicker);
    return () => document.removeEventListener("pointerdown", closePicker);
  }, [pendingPointUnitChoice]);

  useEffect(() => {
    if (!openFunctionSettingsId) return undefined;
    const closeSettings = (event) => {
      if (event.target?.closest?.(".function-point-settings")) return;
      setOpenFunctionSettingsId(null);
    };
    document.addEventListener("pointerdown", closeSettings);
    return () => document.removeEventListener("pointerdown", closeSettings);
  }, [openFunctionSettingsId]);

  // --- Global UUT Selection State ---
  const [currentUutSelection, setCurrentUutSelection] = useState([]);

  useEffect(() => {
    if (!selectedSessionId) {
      setLoadedPreferencesSessionId(null);
      return;
    }

    const preferences = readUiPreferences(selectedSessionId);
    setSidebarColumns({
      ...DEFAULT_SIDEBAR_COLUMNS,
      ...(preferences.sidebarColumns || {}),
    });
    setSidebarSort({
      ...DEFAULT_SIDEBAR_SORT,
      ...(preferences.sidebarSort || {}),
    });
    setSidebarWidth(
      Number.isFinite(preferences.sidebarWidth)
        ? preferences.sidebarWidth
        : 550,
    );
    setIsSessionInfoOpen(preferences.isSessionInfoOpen ?? true);
    const legacyRequirementsOpen = preferences.isRequirementsOpen ?? true;
    setIsRiskInputsOpen(preferences.isRiskInputsOpen ?? legacyRequirementsOpen);
    setIsMitigationInputsOpen(
      preferences.isMitigationInputsOpen ?? legacyRequirementsOpen,
    );
    setIsGlobalExpanded(preferences.isGlobalExpanded ?? false);
    setExpandedFunctions(new Set(preferences.expandedFunctions || []));
    setExpandedUuts(new Set(preferences.expandedUuts || []));
    setCollapsedInstrumentFunctionKeys(
      new Set(preferences.collapsedInstrumentFunctionKeys || []),
    );
    setActiveRangeIndices(preferences.activeRangeIndices || {});
    setAnalysisMode(preferences.analysisMode || "overview");
    setShowContribution(preferences.showContribution ?? false);
    setScopedZoomLevels(preferences.scopedZoomLevels || {});
    setLoadedPreferencesSessionId(selectedSessionId);
  }, [selectedSessionId]);

  useEffect(() => {
    if (
      !selectedSessionId ||
      loadedPreferencesSessionId !== selectedSessionId
    ) {
      return;
    }

    const preferences = {
      sidebarColumns,
      sidebarSort,
      sidebarWidth,
      isSessionInfoOpen,
      isRiskInputsOpen,
      isMitigationInputsOpen,
      isGlobalExpanded,
      expandedFunctions: Array.from(expandedFunctions),
      expandedUuts: Array.from(expandedUuts),
      collapsedInstrumentFunctionKeys: Array.from(
        collapsedInstrumentFunctionKeys,
      ),
      activeRangeIndices,
      analysisMode,
      showContribution,
      scopedZoomLevels,
    };

    try {
      window.localStorage.setItem(
        getUiPreferencesStorageKey(selectedSessionId),
        JSON.stringify(preferences),
      );
    } catch (error) {
      console.warn("Unable to save uncertainty UI preferences", error);
    }
  }, [
    activeRangeIndices,
    analysisMode,
    collapsedInstrumentFunctionKeys,
    expandedFunctions,
    expandedUuts,
    isGlobalExpanded,
    isRiskInputsOpen,
    isMitigationInputsOpen,
    isSessionInfoOpen,
    loadedPreferencesSessionId,
    scopedZoomLevels,
    selectedSessionId,
    showContribution,
    sidebarColumns,
    sidebarSort,
    sidebarWidth,
  ]);

  useEffect(() => {
    const root = resultsContainerRef.current;
    if (!root) return undefined;

    const applyZoomLevels = () => {
      root.querySelectorAll(SCOPED_ZOOM_SURFACE_SELECTOR).forEach((surface) => {
        const key = getScopedZoomKey(surface);
        const zoom = scopedZoomLevels[key] || getDefaultScopedZoom(key);
        const content =
          surface.classList.contains("measurement-point-list") ||
          surface.classList.contains("measurement-equation-zoom-surface")
          ? surface.querySelector(":scope > .scoped-zoom-content")
          : surface.querySelector(":scope > table");
        if (!content) return;

        surface.dataset.zoomLevel = String(zoom);
        content.style.zoom = String(zoom);
      });
    };

    applyZoomLevels();
    const observer = new MutationObserver(applyZoomLevels);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [scopedZoomLevels]);

  // --- CLIPBOARD STATE ---
  const [clipboardPoint, setClipboardPoint] = useState(null);
  const [clipboardUut, setClipboardUut] = useState(null);
  const [clipboardPointMode, setClipboardPointMode] = useState("copy");
  const [clipboardKind, setClipboardKind] = useState(null);

  // Toast Helper — delegates to the shared workbench toast stack so toasts
  // render globally (above all modules) with consistent styling.
  const { showNotification } = useNotifications();
  const showToast = useCallback(
    (message, type = "success") => {
      showNotification(message, type);
    },
    [showNotification]
  );

  const handleExpandAll = () => {
    const allFunctionIds = new Set(sidebarData.map((fn) => fn.id));
    const allUutKeys = new Set();

    sidebarData.forEach((fn) => {
      fn.uutGroups.forEach((group) => {
        allUutKeys.add(`${fn.id}::${group.id}`);
      });
    });

    setExpandedFunctions(allFunctionIds);
    setExpandedUuts(allUutKeys);
  };

  const handleCollapseAll = () => {
    setExpandedFunctions(new Set());
    setExpandedUuts(new Set());
  };

  // --- DELETE HELPER (Defined before useEffect so it can be used inside) ---
  const handleDeleteTestPoint = useCallback(
    (idOrIds, immediate = false) => {
      const idsToDelete = Array.isArray(idOrIds) ? idOrIds : [idOrIds];

      const performDelete = () => {
        if (currentSessionData && currentSessionData.testPoints) {
          const idsSet = new Set(idsToDelete);
          const updatedTestPoints = currentSessionData.testPoints.filter(
            (tp) => !idsSet.has(tp.id),
          );

          updateSession({
            ...currentSessionData,
            testPoints: updatedTestPoints,
          });
        }
        setAppNotification(null);
        // If the selected point was deleted, clear selection
        if (idsToDelete.includes(selectedTestPointId)) {
          setSelectedTestPointId(null);
        }
        // Clear multi-select
        setSelectedSidebarPointIds((prev) =>
          prev.filter((id) => !idsToDelete.includes(id)),
        );
      };

      if (immediate) {
        performDelete();
        return;
      }

      const message =
        idsToDelete.length > 1
          ? `Are you sure you want to delete these ${idsToDelete.length} measurement points?`
          : "Are you sure you want to delete this measurement point?";

      setAppNotification({
        title:
          idsToDelete.length > 1 ? "Batch Delete" : "Delete Measurement Point",
        message: message,
        confirmText: "Delete",
        isIconConfirm: true,
        onConfirm: performDelete,
      });
    },
    [
      currentSessionData,
      updateSession,
      selectedTestPointId,
      setSelectedTestPointId,
    ],
  );

  // --- COPY / PASTE HANDLERS (Moved up for scope access in useEffect) ---
  const handleCopyPoint = useCallback((pointOrPoints) => {
    const points = Array.isArray(pointOrPoints)
      ? pointOrPoints
      : [pointOrPoints];
    setClipboardPoint(points);
    setClipboardPointMode("copy");
    setClipboardKind("point");
    showToast(
      `${points.length} Measurement point${points.length > 1 ? "s" : ""} copied to clipboard`,
    );
    setContextMenu(null);
  }, []);

  const handleCutPoint = useCallback((pointOrPoints) => {
    const points = Array.isArray(pointOrPoints)
      ? pointOrPoints
      : [pointOrPoints];
    setClipboardPoint(points);
    // Cut is a copy-then-delete operation. Keep the snapshots reusable so the
    // same point set can be pasted more than once after it leaves the source.
    setClipboardPointMode("copy");
    setClipboardKind("point");
    handleDeleteTestPoint(points.map((point) => point.id), true);
    showToast(
      `${points.length} measurement point${points.length > 1 ? "s" : ""} cut and copied. Select a destination UUT or range to paste.`,
    );
    setContextMenu(null);
  }, [handleDeleteTestPoint]);

  const handlePastePoint = useCallback(
    (targetUutId, targetAreaId, targetRange = null) => {
      if (
        clipboardKind !== "point" ||
        !clipboardPoint ||
        clipboardPoint.length === 0
      )
        return;

      const pointsToPaste = Array.isArray(clipboardPoint)
        ? clipboardPoint
        : [clipboardPoint];
      const targetUut = currentSessionData.uuts.find(
        (u) => u.id === targetUutId,
      );

      let resolvedAreaId = targetAreaId;
      if (!resolvedAreaId && targetUut) {
        resolvedAreaId = targetUut.measurementAreaId;
        // Fallback: Try finding area by name if ID is missing (common with imported legacy sessions)
        if (!resolvedAreaId && targetUut.measurementArea) {
          const area = currentSessionData.measurementAreas?.find(
            (a) => a.name === targetUut.measurementArea,
          );
          if (area) resolvedAreaId = area.id;
        }
      }

      const newPoints = [];

      // RANGE CHECK HELPER
      const isValueInRange = (val, unit, range) => {
        if (!range) return true; // No range specified = compatible (default behavior)
        const numVal = parseFloat(val);
        if (isNaN(numVal)) return true; // Non-numeric = pass

        const min = parseFloat(range.min);
        const max = parseFloat(range.max);

        // Unit check (relaxed)
        const unitMatch =
          !unit ||
          !range.unit ||
          unit.toLowerCase() === range.unit.toLowerCase();

        if (!isNaN(min) && !isNaN(max)) {
          return unitMatch && numVal >= min && numVal <= max;
        }
        return unitMatch;
      };

      let errorCount = 0;

      pointsToPaste.forEach((pt) => {
        const val = pt.testPointInfo?.parameter?.value;
        const unit = pt.testPointInfo?.parameter?.unit;
        let resolvedTolerance = pt.uutTolerance;

        // Resolve Tolerance
        if (targetRange) {
          // Strict Check if pasting into specific Range
          if (!isValueInRange(val, unit, targetRange)) {
            errorCount++;
            return;
          }
          resolvedTolerance = targetRange;
        } else if (targetUut) {
          // Auto-Resolve
          const matched = findMatchingRange(targetUut, val, unit);
          resolvedTolerance = matched || null;
        }
        const newPointData = preparePointForPaste(pt, {
          mode: clipboardPointMode,
          targetUutId,
          targetAreaId: resolvedAreaId,
          targetTolerance: resolvedTolerance,
        });
        newPoints.push(newPointData);
      });

      if (errorCount > 0) {
        showToast(
          `Skipped ${errorCount} point(s) outside target range.`,
          "error",
        );
      }

      if (newPoints.length > 0) {
        saveTestPoint(newPoints, null);
        const action = clipboardPointMode === "cut" ? "Moved" : "Pasted";
        showToast(
          `${action} ${newPoints.length} measurement point${newPoints.length > 1 ? "s" : ""}.`,
        );
        setSelectedTestPointContextUutId(targetUutId);

        if (clipboardPointMode === "cut") {
          const remainingPoints = getRemainingCutPoints(
            pointsToPaste,
            newPoints,
          );
          setClipboardPoint(remainingPoints.length > 0 ? remainingPoints : null);
          if (remainingPoints.length === 0) {
            setClipboardKind(null);
            setClipboardPointMode("copy");
          }
        }
      }
    },
    [
      clipboardKind,
      clipboardPoint,
      clipboardPointMode,
      currentSessionData,
      saveTestPoint,
      setSelectedTestPointContextUutId,
    ],
  );

  const handleCopyUut = useCallback((uut) => {
    setClipboardUut(uut);
    setClipboardKind("uut");
    showToast(`UUT "${uut.model || "Item"}" copied to clipboard`);
    setContextMenu(null);
  }, []);

  const handlePasteUut = useCallback(
    (targetAreaId) => {
      if (
        clipboardKind !== "uut" ||
        !clipboardUut ||
        !currentSessionData
      )
        return;

      // Create Clone
      const newUut = {
        ...clipboardUut,
        id: uuidv4(),
        measurementAreaId: targetAreaId,
        measurementArea:
          currentSessionData.measurementAreas.find((a) => a.id === targetAreaId)
            ?.name || "",
        // Note: This duplicates the UUT definition only, not its test points (deep clone logic would go here)
      };

      const updatedUuts = [...(currentSessionData.uuts || []), newUut];
      updateSession({ ...currentSessionData, uuts: updatedUuts });
      showToast(`Pasted UUT "${newUut.model}"`);
      setContextMenu(null);
    },
    [clipboardKind, clipboardUut, currentSessionData, updateSession],
  );

  useEffect(() => {
    const handleKeyDown = (e) => {
      // The Universal Instrument editor owns keyboard input while it is open.
      // Its list has its own Delete behavior; allowing this background handler
      // to run would delete the previously selected analysis UUT/point instead.
      if (isInstrumentBuilderOpen) return;

      const key = e.key.toLowerCase();
      const isTextEntry =
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.isContentEditable;

      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        key === "z" &&
        !isTextEntry
      ) {
        if (undoLastSessionChange()) {
          e.preventDefault();
          showToast("Undid the last change.");
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && key === "c" && !isTextEntry) {
        let handled = false;
        if (selectedUutId) {
          const uut = currentSessionData?.uuts?.find(
            (item) => item.id === selectedUutId,
          );
          if (uut) {
            handleCopyUut(uut);
            handled = true;
          }
        } else if (selectedSidebarPointIds.length > 0) {
          const points = currentTestPoints.filter((p) =>
            selectedSidebarPointIds.includes(p.id),
          );
          if (points.length > 0) {
            handleCopyPoint(points);
            handled = true;
          }
        } else if (selectedTestPointId) {
          const point = currentTestPoints.find(
            (p) => p.id === selectedTestPointId,
          );
          if (point) {
            handleCopyPoint(point);
            handled = true;
          }
        }
        if (handled) e.preventDefault();
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        key === "x" &&
        !isTextEntry &&
        !selectedUutId
      ) {
        let points = [];
        if (selectedSidebarPointIds.length > 0) {
          points = currentTestPoints.filter((point) =>
            selectedSidebarPointIds.includes(point.id),
          );
        } else if (selectedTestPointId) {
          const point = currentTestPoints.find(
            (item) => item.id === selectedTestPointId,
          );
          if (point) points = [point];
        }
        if (points.length > 0) {
          e.preventDefault();
          handleCutPoint(points);
        }
      }

      if ((e.ctrlKey || e.metaKey) && key === "v" && !isTextEntry) {
        if (clipboardKind === "point" && clipboardPoint) {
          e.preventDefault();
          let targetUutId = null;

          if (selectedUutId) {
            targetUutId = selectedUutId;
          } else if (selectedTestPointId && selectedTestPointContextUutId) {
            targetUutId = selectedTestPointContextUutId;
          }

          if (targetUutId) {
            handlePastePoint(targetUutId, null, null);
          } else {
            showToast("Select a destination UUT before pasting.", "error");
          }
        }
      }

      /*
       * Do not intercept native clipboard shortcuts while editing text. This
       * preserves standard copy, cut, and paste behavior in every input.
       */
      if (isTextEntry) return;

      /* Legacy point delete shortcut. */
      if (e.key === "Delete" || e.key === "Backspace") {
        if (e.key === "Delete") {
          if (selectedSidebarPointIds.length > 0) {
            e.preventDefault();
            handleDeleteTestPoint(selectedSidebarPointIds);
          } else if (selectedTestPointId) {
            e.preventDefault();
            handleDeleteTestPoint(selectedTestPointId);
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedTestPointId,
    selectedUutId,
    selectedSidebarPointIds,
    selectedTestPointContextUutId,
    clipboardKind,
    clipboardPoint,
    clipboardUut,
    currentTestPoints,
    currentSessionData,
    handleCopyPoint,
    handleCopyUut,
    handleCutPoint,
    handleDeleteTestPoint,
    handlePastePoint,
    handlePasteUut,
    showToast,
    undoLastSessionChange,
    isInstrumentBuilderOpen,
  ]);

  useEffect(() => {
    const handleZoom = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;

      const zoomTarget = getScopedZoomTarget(e.target);
      // Let Chromium perform normal page zoom when the pointer is not over a
      // scoped work surface.
      if (!zoomTarget) return;

      e.preventDefault();

      const { surface, content } = zoomTarget;
      // The applied default is written to dataset.zoomLevel by applyZoomLevels;
      // fall back to 1 only for surfaces that haven't been initialized yet.
      const currentZoom = parseFloat(surface.dataset.zoomLevel || "1");
      const zoomDirection = e.deltaY < 0 ? 1 : -1;
      const nextZoom = Math.max(
        0.6,
        Math.min(2, Math.round((currentZoom + zoomDirection * 0.1) * 10) / 10),
      );
      if (nextZoom === currentZoom) return;

      const bounds = surface.getBoundingClientRect();
      const cursorX = e.clientX - bounds.left;
      const cursorY = e.clientY - bounds.top;
      const logicalX = (surface.scrollLeft + cursorX) / currentZoom;
      const logicalY = (surface.scrollTop + cursorY) / currentZoom;

      surface.dataset.zoomLevel = String(nextZoom);
      content.style.zoom = String(nextZoom);
      const zoomKey = getScopedZoomKey(surface);
      if (zoomKey) {
        setScopedZoomLevels((current) => ({
          ...current,
          [zoomKey]: nextZoom,
        }));
      }

      // Surface this panel's scoped zoom level in the shared bottom-right toast,
      // since scoped zoom is independent of the global page zoom and otherwise
      // has no visible readout.
      window.dispatchEvent(
        new CustomEvent(ZOOM_TOAST_EVENT, {
          detail: {
            label: getScopedZoomLabel(zoomKey),
            percent: Math.round(nextZoom * 100),
          },
        }),
      );

      surface.scrollLeft = logicalX * nextZoom - cursorX;
      surface.scrollTop = logicalY * nextZoom - cursorY;
    };

    window.addEventListener("wheel", handleZoom, { passive: false });
    return () => window.removeEventListener("wheel", handleZoom);
  }, []);

  // --- SELECTION HANDLERS ---
  const handleSelectSession = (newId) => {
    setRiskResults(null);
    setSelectedSessionId(newId);
    setSelectedTestPointId(null);
    setSelectedFunctionId(null);
    setSelectedUutId(null);
    setVirtualPoint(null);
    setSelectedTestPointContextUutId(null);
    setCurrentUutSelection([]);
    setSelectedTablePointIds([]);
    setSelectedSidebarPointIds([]);
    setAnalysisMode("overview");
  };

  // --- TOGGLE EXPANSION HANDLERS ---
  const toggleFunctionExpand = (e, functionKey) => {
    e.stopPropagation();
    setExpandedFunctions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(functionKey)) newSet.delete(functionKey);
      else newSet.add(functionKey);
      return newSet;
    });
  };

  // Pick the point to focus when a function/UUT node is clicked: keep the current
  // point if it still belongs to the clicked scope, otherwise fall back to the
  // first matching point.
  const resolveFunctionPoint = (functionKey, uutId = null) => {
    const inScope = (point) => {
      if (functionKeyOf(point) !== functionKey) return false;
      if (!uutId) return true;
      return (point.associatedUutIds || []).some(
        (id) => String(id) === String(uutId),
      );
    };
    const current = currentTestPoints.find(
      (point) => point.id === selectedTestPointId && inScope(point),
    );
    return current || currentTestPoints.find(inScope) || null;
  };

  const handleSelectUut = (uutId, functionKey) => {
    setRiskResults(null);
    const point = resolveFunctionPoint(functionKey, uutId);

    setSelectedUutId(uutId);
    setSelectedFunctionId(functionKey);
    setSelectedTestPointId(point?.id || null);
    setSelectedTestPointContextUutId(uutId);
    setCurrentUutSelection([uutId]);
    setVirtualPoint(null);
    setSelectedTablePointIds([]);
    setSelectedSidebarPointIds(point ? [point.id] : []);
    setAnalysisMode(point ? "uncertaintyTool" : "overview");
  };

  const handleSelectTestPoint = (e, tpId, contextUutId = null) => {
    setRiskResults(null);
    // Multi-Select Logic
    let newSelection = [];
    const runIds = getSidebarPointRange(
      visibleSidebarPointOrder,
      sidebarSelectionAnchor,
      { pointId: tpId, contextUutId },
    );

    if (e && e.shiftKey && runIds.length > 0) {
      // Shift-click: select the contiguous run between the anchor (last plain
      // click) and this point, in visual order — up or down. Ctrl+Shift unions
      // the run with the existing selection; plain Shift replaces it.
      newSelection =
        e.ctrlKey || e.metaKey
          ? Array.from(new Set([...selectedSidebarPointIds, ...runIds]))
          : runIds;
      // Anchor stays put so the user can re-shift to a different extent.
    } else if (e && (e.ctrlKey || e.metaKey)) {
      if (selectedSidebarPointIds.includes(tpId)) {
        newSelection = selectedSidebarPointIds.filter((id) => id !== tpId);
      } else {
        newSelection = [...selectedSidebarPointIds, tpId];
      }
      setSidebarSelectionAnchor({ pointId: tpId, contextUutId });
    } else {
      newSelection = [tpId];
      setSidebarSelectionAnchor({ pointId: tpId, contextUutId });
    }

    setSelectedSidebarPointIds(newSelection);

    // Update Single Selection State (Legacy/Detail View)
    // If multiple selected, detail view usually shows the LAST one or clears.
    // Existing logic expects `selectedTestPointId` to be a string.
    if (newSelection.length === 1) {
      setSelectedTestPointId(newSelection[0]);
    } else {
      // If multiple, maybe clear detail view or show "X points selected"?
      // UncertaintyPanel expects single ID.
      // We'll keep selectedTestPointId as the *last* clicked logic or null.
      setSelectedTestPointId(tpId);
    }

    const selectedPoint = currentTestPoints.find((point) => point.id === tpId);
    setSelectedFunctionId(selectedPoint ? functionKeyOf(selectedPoint) : null);
    setSelectedUutId(null);
    setVirtualPoint(null);
    setSelectedTestPointContextUutId(contextUutId);
    setCurrentUutSelection([]);
    setSelectedTablePointIds([]);
    setAnalysisMode("uncertaintyTool");
  };

  const handleAddNewSession = () => {
    const newSession = addSession();
    if (newSession?.id) {
      setSelectedSessionId(newSession.id);
      handleSelectSession(newSession.id);
    }
  };

  const handleAddNewTestPoint = (arg1 = null, arg2 = null, arg3 = null) => {
    let uutIds = [];
    let specificRange = null;
    // The function the new point should belong to. The sidebar passes the
    // function group ({ id, name, unit }) the Add Point button was clicked under;
    // the Analysis dashboard passes a UUT list and we infer the function later.
    let functionGroup = null;

    // Detect Source: Analysis Dashboard passes ([ids], rangeObj)
    if (Array.isArray(arg1)) {
      uutIds = arg1;
      specificRange = arg2;
    }
    // Detect Source: Sidebar passes (functionGroup, uutId, rangeObj?)
    else {
      functionGroup = arg1 || null;
      const specificUutId = arg2;
      specificRange = arg3;
      if (specificUutId) uutIds = [specificUutId];
    }

    // Logic to build Initial Data
    let initialData = {};
    const applyUutDefaults = (data, targetUutIds, range) => {
      const primaryUut = currentSessionData?.uuts?.find(
        (u) => u.id === targetUutIds?.[0],
      );
      const fallbackRange =
        range ||
        (primaryUut ? getAllUutRanges(primaryUut)[activeRangeIndices[primaryUut.id] || 0] : null);
      // A function the point was explicitly added under wins; otherwise fall back
      // to the range's / instrument's function so the point lands sensibly.
      const functionName =
        functionGroup?.name ||
        fallbackRange?.functionName ||
        primaryUut?.instrument?.functions?.[0]?.name ||
        "Measurement";
      const unit =
        functionGroup?.unit ||
        fallbackRange?.unit ||
        primaryUut?.instrument?.functions?.[0]?.unit ||
        "";

      return {
        ...data,
        uutTolerance: data.uutTolerance || range || null,
        testPointInfo: {
          ...(data.testPointInfo || {}),
          parameter: {
            ...(data.testPointInfo?.parameter || {}),
            name: data.testPointInfo?.parameter?.name || functionName,
            unit: data.testPointInfo?.parameter?.unit || unit,
          },
        },
      };
    };

    if (uutIds.length > 0 && specificRange) {
      initialData = applyUutDefaults({
        measurementAreaId: null,
        associatedUutIds: uutIds,
        uutTolerance: specificRange,
        testPointInfo: {
          parameter: {
            value: "",
            unit: specificRange.unit || "",
          },
        },
      }, uutIds, specificRange);
      // Ensure context is set so it opens in the right folder visually
      setSelectedTestPointContextUutId(uutIds[0]);
      if (specificRange._id !== undefined) {
        setActiveRangeIndices((prev) => ({
          ...prev,
          [uutIds[0]]: specificRange._id,
        }));
      }
    } else if (uutIds.length > 0) {
      initialData = applyUutDefaults({
        measurementAreaId: null,
        associatedUutIds: uutIds,
      }, uutIds, null);
      setSelectedTestPointContextUutId(uutIds[0]);
    } else if (currentUutSelection.length > 0) {
      // Fallback to global selection if no args passed (e.g. main add button)
      initialData = applyUutDefaults({
        measurementAreaId: null,
        associatedUutIds: currentUutSelection,
      }, currentUutSelection, null);

      const primaryUutId = currentUutSelection[0];
      const primaryUut = currentSessionData?.uuts?.find(
        (u) => u.id === primaryUutId,
      );

      if (primaryUut && currentUutSelection.length === 1) {
        const availableRanges = getAllUutRanges(primaryUut);
        const selectedIndex = activeRangeIndices[primaryUutId];

        if (selectedIndex !== undefined && availableRanges[selectedIndex]) {
          initialData.uutTolerance = availableRanges[selectedIndex];
        } else if (availableRanges.length > 0) {
          initialData.uutTolerance = availableRanges[0];
        }
      }
    } else {
      const contextUuts = currentSessionData?.uuts || [];
      if (contextUuts.length === 1) {
        initialData = applyUutDefaults({
          measurementAreaId: null,
          associatedUutIds: [contextUuts[0].id],
        }, [contextUuts[0].id], null);
        setSelectedTestPointContextUutId(contextUuts[0].id);
      } else {
        setAppNotification({
          title: "Select a UUT",
          message: "Choose a UUT before adding measurement points.",
        });
        return;
      }
    }

    // Create the point directly (no modal) and drop either measurement type
    // into inline value-edit so its first required value is immediately ready.
    const mode = initialData.measurementType || "direct";
    const newId = handleSaveTestPoint({ ...initialData, measurementType: mode });
    if (newId != null) {
      setPendingValueEditPointId(newId);
    }
  };

  const handleDeleteSession = (sessionId) => {
    setConfirmationModal({
      title: "Delete Session",
      message:
        "Are you sure you want to delete this session and all its measurement points?",
      onConfirm: () => {
        deleteSession(sessionId);
        setConfirmationModal(null);
      },
    });
  };

  const handleDeleteBugReport = (reportId) => {
    setAppNotification({
      title: "Delete Report",
      message:
        "Are you sure you want to delete this report? This action cannot be undone.",
      confirmText: "Delete",
      cancelText: "Cancel",
      isIconConfirm: false,
      onConfirm: () => {
        deleteBugReport(reportId);
        setAppNotification(null);
      },
    });
  };

  // --- NEW HANDLERS to Open Modal in Correct Mode ---
  const handleEditUut = (uut = null, options = {}) => {
    let dataWithColor = uut;

    // FIX: If editing an existing UUT, look up its area color so the modal
    // initializes with the correct color instead of defaulting to Blue.
    if (uut && uut.measurementAreaId && currentSessionData?.measurementAreas) {
      const area = currentSessionData.measurementAreas.find(
        (a) => a.id === uut.measurementAreaId,
      );
      if (area) {
        dataWithColor = { ...uut, measurementAreaColor: area.color };
      }
    } else if (
      uut &&
      uut.measurementArea &&
      currentSessionData?.measurementAreas
    ) {
      // Fallback: Lookup by name if ID is missing
      const area = currentSessionData.measurementAreas.find(
        (a) => a.name === uut.measurementArea,
      );
      if (area) {
        dataWithColor = { ...uut, measurementAreaColor: area.color };
      }
    }

    setInstrumentModalConfig({
      mode: "uut",
      data: dataWithColor,
      associateToPointId: uut ? null : options.associateToPointId || null,
    });
    setIsInstrumentBuilderOpen(true);
  };

  // handleAddTmde / handleEditTmde removed: TMDE create/edit is now fully inline
  // in the Session Overview and measurement-point tables. The UniversalInstrument
  // Modal remains only for the library browser and the EditSessionModal tab.

  const handleOpenLibrary = () => {
    setInstrumentModalConfig({
      mode: "library",
      data: null,
      associateToPointId: null,
    });
    setIsInstrumentBuilderOpen(true);
  };

  // When a master TMDE is edited (tolerances, distribution, range, etc.), the
  // per-point tmdeTolerance instances are independent snapshots and would
  // otherwise keep stale specs — so the budget/risk "UI calc" wouldn't update
  // (#6). Re-flatten every referencing instance from the saved master, mirroring
  // the inline handleSaveTmde logic, while preserving per-point data
  // (measurementPoint, variableType, quantity, selected range index).
  const refreshTmdeInstances = (testPoints, savedTmde) => {
    return (testPoints || []).map((tp) => {
      const tols = tp.tmdeTolerances || [];
      let changed = false;
      const next = tols.map((t) => {
        if (t.id !== savedTmde.id && t.sourceId !== savedTmde.id) return t;
        changed = true;

        const selection = resolveInstrumentSelection(savedTmde, {
          userFunctionId: t.functionId,
          userFunctionName: t.functionName || "",
          userRangeId: t.rangeId,
          userRangeIndex: t._index ?? 0,
        });
        const flattenedSpecs = selection.specs;

        /* eslint-disable no-unused-vars */
        const {
          reading,
          readings_iv,
          range,
          floor,
          db,
          tolerance,
          tolerances,
          min,
          max,
          unit,
          resolution,
          ...safeInstanceMeta
        } = t;
        /* eslint-enable no-unused-vars */

        return {
          ...safeInstanceMeta,
          ...savedTmde,
          ...flattenedSpecs,
          id: t.id,
          sourceId: savedTmde.id,
          functionId: selection.functionId,
          functionName: selection.functionName,
          functionUnit: selection.functionUnit,
          rangeId: selection.rangeId,
          _index: selection.rangeIndex,
          measurementPoint: t.measurementPoint,
          variableType: t.variableType,
          quantity: t.quantity,
        };
      });
      return changed ? { ...tp, tmdeTolerances: next } : tp;
    });
  };

  const handleUniversalModalSave = (data) => {
    // LOGGING TO VERIFY EXECUTION
    console.log("[App.jsx] handleUniversalModalSave CALLED with:", data);

    if (!currentSessionData) return;

    // CASE 1: Saving a UUT (New or Edit)
    if (data.type === "uut") {
      const rawName = data.measurementArea || "";
      const cleanName = rawName.trim();
      const hasNamedArea =
        cleanName && cleanName.toLowerCase() !== "unassigned";
      const associationPoint = currentTestPoints.find(
        (point) => point.id === instrumentModalConfig.associateToPointId,
      );
      let resolvedAreaId =
        hasNamedArea
          ? data.measurementAreaId ||
            associationPoint?.measurementAreaId ||
            null
          : null;
      let updatedMeasurementAreas = [
        ...(currentSessionData.measurementAreas || []),
      ];

      // Handle Measurement Area Logic
      if (hasNamedArea) {
        const existingAreaIndex = updatedMeasurementAreas.findIndex(
          (a) => a.name.toLowerCase() === cleanName.toLowerCase(),
        );

        if (existingAreaIndex >= 0) {
          resolvedAreaId = updatedMeasurementAreas[existingAreaIndex].id;

          // FIX: Explicitly update the area color if the modal sent a new one
          if (data.measurementAreaColor) {
            console.log(
              `[App.jsx] Updating area '${cleanName}' color to ${data.measurementAreaColor}`,
            );
            updatedMeasurementAreas[existingAreaIndex] = {
              ...updatedMeasurementAreas[existingAreaIndex],
              color: data.measurementAreaColor,
            };
          }
        } else {
          // FIX: Create New Area with the specific color from the modal
          console.log(
            `[App.jsx] Creating new area '${cleanName}' with color ${data.measurementAreaColor}`,
          );
          const newArea = {
            id: uuidv4(),
            name: cleanName,
            color: data.measurementAreaColor || "#3498db",
          };
          updatedMeasurementAreas.push(newArea);
          resolvedAreaId = newArea.id;
        }
      }
      const resolvedAreaName =
        updatedMeasurementAreas.find((area) => area.id === resolvedAreaId)
          ?.name || (hasNamedArea ? cleanName : "");

      const newUut = {
        id: data.id || uuidv4(),
        description: data.description || data.name,
        measurementArea: resolvedAreaName,
        measurementAreaId: resolvedAreaId,
        instrument: data.instrument,
      };

      // Update Session UUTs (Replace if ID exists, otherwise append)
      const existingUutIndex = (currentSessionData.uuts || []).findIndex(
        (u) => u.id === newUut.id,
      );
      const updatedUuts = [...(currentSessionData.uuts || [])];

      if (existingUutIndex >= 0) {
        updatedUuts[existingUutIndex] = newUut;
      } else {
        updatedUuts.push(newUut);
      }

      const updatedTestPoints =
        existingUutIndex < 0 && associationPoint
          ? associateUutWithPoint(
              currentSessionData.testPoints,
              associationPoint.id,
              newUut.id,
            )
          : currentSessionData.testPoints;

      updateSession({
        ...currentSessionData,
        uuts: updatedUuts,
        measurementAreas: updatedMeasurementAreas,
        testPoints: updatedTestPoints,
      });
    }

    // CASE 2: Saving a TMDE
    else if (
      data.type === "tmde" ||
      (data.type === "library" && data.useAs === "tmde")
    ) {
      const cleanAreaName = String(data.measurementArea || "").trim();
      const hasNamedArea =
        cleanAreaName && cleanAreaName.toLowerCase() !== "unassigned";
      let updatedMeasurementAreas = [
        ...(currentSessionData.measurementAreas || []),
      ];
      const existingTmde = (currentSessionData.tmdes || []).find(
        (tmde) => tmde.id === data.id,
      );
      const associationPoint = currentTestPoints.find(
        (tp) => tp.id === instrumentModalConfig.associateToPointId,
      );
      const contextPoint = currentTestPoints.find(
        (tp) => tp.id === selectedTestPointId,
      );
      const dataAreaExists = updatedMeasurementAreas.some(
        (area) => String(area.id) === String(data.measurementAreaId),
      );
      let resolvedAreaId =
        hasNamedArea
          ? existingTmde?.measurementAreaId ||
            associationPoint?.measurementAreaId ||
            contextPoint?.measurementAreaId ||
            (dataAreaExists ? data.measurementAreaId : null) ||
            null
          : null;

      // TMDE library metadata often has its own category/area label (e.g.
      // "Weight"). That label must NOT create a session measurement area in the
      // sidebar. Only resolve TMDE ownership to an already-existing session area
      // or the current point/area context; preserve the library label inside the
      // nested instrument snapshot for editing/display.
      if (!resolvedAreaId && hasNamedArea) {
        resolvedAreaId =
          updatedMeasurementAreas.find(
            (a) => a.name.toLowerCase() === cleanAreaName.toLowerCase(),
          )?.id || null;
      }
      const resolvedArea = updatedMeasurementAreas.find(
        (area) => area.id === resolvedAreaId,
      );
      const getTmdeInstrumentSnapshot = (instrument) => {
        const snapshot = { ...(instrument || {}) };
        if (hasNamedArea) snapshot.measurementArea = cleanAreaName;
        else snapshot.measurementArea = "";
        if (data.measurementAreaColor) {
          snapshot.measurementAreaColor = hasNamedArea
            ? data.measurementAreaColor
            : "";
        }
        return snapshot;
      };
      let newTmde = {};
      if (data.type === "library") {
        const instrumentSnapshot = getTmdeInstrumentSnapshot(data);
        newTmde = {
          id: uuidv4(),
          // Prefer the instrument description (its current name) so a renamed
          // library instrument re-imports with the new name, not make/model.
          name:
            data.description ||
            `${data.manufacturer || ""} ${data.model || ""}`.trim(),
          quantity: 1,
          assetId: "",
          instrument: instrumentSnapshot,
          isInstrumentBased: true,
          measurementAreaId: resolvedAreaId,
          measurementArea: resolvedArea?.name || "",
        };
        delete newTmde.instrument.useAs;
      } else {
        const instrumentSnapshot = getTmdeInstrumentSnapshot(data.instrument);
        newTmde = {
          id: data.id || uuidv4(),
          name: data.name,
          quantity: data.quantity,
          assetId: data.assetId,
          instrument: instrumentSnapshot,
          isInstrumentBased: true,
          measurementAreaId: resolvedAreaId,
          measurementArea: resolvedArea?.name || "",
        };
      }
      const existingTmdeIndex = (currentSessionData.tmdes || []).findIndex(
        (t) => t.id === newTmde.id,
      );
      const updatedTmdes = [...(currentSessionData.tmdes || [])];
      if (existingTmdeIndex >= 0) {
        updatedTmdes[existingTmdeIndex] = newTmde;
      } else {
        updatedTmdes.push(newTmde);
      }
      // Editing an existing TMDE: propagate the new specs to its per-point
      // instances so budgets/risk recompute. (No-op for brand new TMDEs.)
      const refreshedTestPoints =
        existingTmdeIndex >= 0
          ? refreshTmdeInstances(currentSessionData.testPoints, newTmde)
          : currentSessionData.testPoints;
      updateSession({
        ...currentSessionData,
        tmdes: updatedTmdes,
        measurementAreas: updatedMeasurementAreas,
        testPoints: refreshedTestPoints,
      });
    }

    // CASE 3: Library Item used as UUT
    else if (data.type === "library" && data.useAs === "uut") {
      const associationPoint = currentTestPoints.find(
        (point) => point.id === instrumentModalConfig.associateToPointId,
      );
      let resolvedAreaId = associationPoint?.measurementAreaId || null;
      let updatedMeasurementAreas = [
        ...(currentSessionData.measurementAreas || []),
      ];

      if (!resolvedAreaId) {
        const defaultArea = updatedMeasurementAreas.find(
          (a) => a.name === "General",
        );
        if (defaultArea) {
          resolvedAreaId = defaultArea.id;
        } else {
          const newArea = { id: uuidv4(), name: "General", color: "#3498db" };
          updatedMeasurementAreas.push(newArea);
          resolvedAreaId = newArea.id;
        }
      }

      const newUut = {
        id: uuidv4(),
        // Prefer the instrument description (its current name) so a renamed
        // library instrument re-imports with the new name, not make/model.
        description:
          data.description ||
          `${data.manufacturer || ""} ${data.model || ""}`.trim(),
        measurementArea:
          updatedMeasurementAreas.find((a) => a.id === resolvedAreaId)?.name ||
          "General",
        measurementAreaId: resolvedAreaId,
        instrument: { ...data },
      };
      delete newUut.instrument.useAs;

      const updatedTestPoints = associationPoint
        ? associateUutWithPoint(
            currentSessionData.testPoints,
            associationPoint.id,
            newUut.id,
          )
        : currentSessionData.testPoints;

      updateSession({
        ...currentSessionData,
        uuts: [...(currentSessionData.uuts || []), newUut],
        measurementAreas: updatedMeasurementAreas,
        testPoints: updatedTestPoints,
      });
    }
    // CASE 4: Standard Library Save
    else {
      saveInstrument(data);
    }

    setIsInstrumentBuilderOpen(false);
  };

  // Bulk-add several library instruments to the session at once (the library
  // modal's multi-select). Done in a SINGLE updateSession pass so all items
  // persist (calling the per-item save in a loop would hit a stale closure and
  // only keep the last). Each item inherits its own measurement area, creating
  // areas as needed.
  const handleBatchAddInstruments = (instrumentList, useAs) => {
    if (!currentSessionData || !instrumentList?.length) return;

    const areas = [...(currentSessionData.measurementAreas || [])];
    const ensureAreaId = (name, color) => {
      const clean = String(name || "").trim();
      if (!clean) return null;
      let area = areas.find(
        (a) => a.name.toLowerCase() === clean.toLowerCase(),
      );
      if (!area) {
        area = { id: uuidv4(), name: clean, color: color || "#3498db" };
        areas.push(area);
      }
      return area.id;
    };

    const tmdes = [...(currentSessionData.tmdes || [])];
    const uuts = [...(currentSessionData.uuts || [])];

    instrumentList.forEach((inst) => {
      // Prefer the instrument's description as the row name (matching the inline
      // library-pick's libraryLabel), so a renamed instrument re-imports with its
      // current name instead of falling back to manufacturer/model.
      const label =
        inst.description ||
        `${inst.manufacturer || ""} ${inst.model || ""}`.trim() ||
        "Instrument";
      const instrument = { ...inst };
      delete instrument.useAs;
      if (useAs === "uut") {
        const areaId = ensureAreaId(
          inst.measurementArea,
          inst.measurementAreaColor,
        );
        const areaName = areas.find((a) => a.id === areaId)?.name || "";
        uuts.push({
          id: uuidv4(),
          description: inst.description || label,
          measurementArea: areaName,
          measurementAreaId: areaId,
          instrument,
        });
      } else {
        const areaId = null;
        const areaName = areas.find((a) => a.id === areaId)?.name || "";
        tmdes.push({
          id: uuidv4(),
          name: label,
          quantity: 1,
          assetId: "",
          instrument,
          isInstrumentBased: true,
          measurementAreaId: areaId,
          measurementArea: areaName,
        });
      }
    });

    updateSession({
      ...currentSessionData,
      measurementAreas: areas,
      tmdes,
      uuts,
    });
    setIsInstrumentBuilderOpen(false);
  };

  const handleOpenSessionEditor = async () => {
    if (currentSessionData) {
      handleSelectSession(currentSessionData.id);
    }
  };

  const handleSaveTestPoint = (formData) => {
    const resolvePointForUut = (point, uutId) => {
      const uut = currentSessionData?.uuts?.find((u) => u.id === uutId);
      const value = point.testPointInfo?.parameter?.value;
      const unit = point.testPointInfo?.parameter?.unit;
      return {
        ...point,
        associatedUutIds: [uutId],
        measurementAreaId:
          point.measurementAreaId || uut?.measurementAreaId || null,
        uutTolerance: point.uutTolerance || (uut ? findMatchingRange(uut, value, unit) : null),
      };
    };

    const normalizePoint = (point) => {
      const finalData = { ...point };

      if (
        !finalData._skipUutAutofill &&
        (!finalData.associatedUutIds ||
          finalData.associatedUutIds.length === 0) &&
        currentUutSelection.length > 0
      ) {
        finalData.associatedUutIds = currentUutSelection;
      }

      if (
        !finalData.id &&
        finalData.associatedUutIds &&
        finalData.associatedUutIds.length > 1
      ) {
        return finalData.associatedUutIds.map((uutId) =>
          resolvePointForUut(finalData, uutId),
        );
      }

      if (!finalData.id && finalData.associatedUutIds?.length === 1) {
        return resolvePointForUut(finalData, finalData.associatedUutIds[0]);
      }

      delete finalData._skipUutAutofill;
      return finalData;
    };

    const normalized = Array.isArray(formData)
      ? formData.flatMap(normalizePoint)
      : normalizePoint(formData);

    const newId = saveTestPoint(normalized, null);

    const firstPoint = Array.isArray(normalized) ? normalized[0] : normalized;
    if (firstPoint?.associatedUutIds && firstPoint.associatedUutIds.length > 0) {
      setSelectedTestPointContextUutId(firstPoint.associatedUutIds[0]);
    }
    setCurrentUutSelection([]);
    return newId;
  };

  const updateFunctionPointSettings = (fnGroup, patch) => {
    if (!currentSessionData) return;
    const existing = Array.isArray(currentSessionData.functionGroups)
      ? currentSessionData.functionGroups
      : [];
    let found = false;
    const next = existing.map((group) => {
      if (
        makeFunctionKey(group.name) !== fnGroup.id ||
        group.kind === "tmde"
      ) {
        return group;
      }
      found = true;
      return {
        ...group,
        pointCreationSettings: {
          ...DEFAULT_FUNCTION_POINT_SETTINGS,
          ...(group.pointCreationSettings || {}),
          ...patch,
        },
      };
    });
    if (!found) {
      next.push({
        name: fnGroup.name,
        unit: fnGroup.unit || "",
        units: fnGroup.units || (fnGroup.unit ? [fnGroup.unit] : []),
        kind: "uut",
        pointCreationSettings: {
          ...DEFAULT_FUNCTION_POINT_SETTINGS,
          ...patch,
        },
      });
    }
    const testPoints = patch.mode
      ? (currentSessionData.testPoints || []).map((point) =>
          functionKeyOf(point) === fnGroup.id
            ? { ...point, measurementType: patch.mode }
            : point,
        )
      : currentSessionData.testPoints;
    updateSession({ ...currentSessionData, functionGroups: next, testPoints });
  };

  const applyFunctionPointTemplate = (point, fnGroup, settings) => {
    const template = currentTestPoints.find(
      (candidate) => functionKeyOf(candidate) === fnGroup.id,
    );
    if (!template) return point;

    const next = { ...point };
    if (settings.reuseEquation) {
      [
        "equationString",
        "equationName",
        "variableMappings",
        "variableNominals",
      ].forEach((field) => {
        const value = clonePointSettingValue(template[field]);
        if (value !== undefined) next[field] = value;
      });
    }
    if (settings.reuseBudget) {
      [
        "components",
        "tmdeTolerances",
        "inputCorrelations",
        "coverageFactorMode",
        "coverageFactorOverride",
        "budgetPropagationMethod",
        "monteCarloTrials",
        "useEffectiveDofByGroup",
      ].forEach((field) => {
        const value = clonePointSettingValue(template[field]);
        if (value !== undefined) next[field] = value;
      });
    }
    return next;
  };

  // Quick-add a blank point directly onto a UUT (no modal): the unit/function
  // come from the function group the "+" was clicked under, the point starts
  // with an empty value, and a direct point is dropped straight into inline
  // value-edit in the sidebar. Derived points open in the Detailed View where
  // the equation editor already lives.
  const buildBlankPoint = (uutId, fnGroup, settings, selectedUnit = "") => {
    const uut = currentSessionData?.uuts?.find((u) => u.id === uutId);
    const ranges = uut ? getAllUutRanges(uut) : [];
    const requestedUnit = selectedUnit || fnGroup?.unit || "";
    const fnRange =
      ranges.find(
        (r) =>
          (!fnGroup?.name || !r.functionName || r.functionName === fnGroup.name) &&
          (!requestedUnit || (r.unit || "") === requestedUnit),
      ) ||
      ranges[activeRangeIndices[uutId] || 0] ||
      ranges[0] ||
      null;
    const functionName =
      fnGroup?.name ||
      fnRange?.functionName ||
      uut?.instrument?.functions?.[0]?.name ||
      "Measurement";
    const unit =
      selectedUnit ||
      fnRange?.unit ||
      fnGroup?.unit ||
      uut?.instrument?.functions?.[0]?.unit ||
      "";
    return applyFunctionPointTemplate({
      measurementAreaId: null,
      associatedUutIds: uutId ? [uutId] : [],
      _skipUutAutofill: !uutId,
      measurementType: settings.mode,
      uutTolerance: fnRange || null,
      testPointInfo: { parameter: { name: functionName, value: "", unit } },
    }, fnGroup, settings);
  };

  // A shared function section can span several UUTs. Only offer units that
  // belong to the UUT whose + button was clicked; the section-level list is a
  // fallback for legacy instruments that do not carry range metadata yet.
  const unitsForQuickAddPoint = (fnGroup, uutId) => {
    const uut = currentSessionData?.uuts?.find((candidate) => candidate.id === uutId);
    const declared = instrumentFunctions(uut || {}).find(
      (fn) => fn.key === fnGroup?.id,
    );
    const units = Array.from(
      new Set([...(declared?.units || []), ...(fnGroup?.units || []), fnGroup?.unit].filter(Boolean)),
    );
    return declared?.units?.length ? declared.units : units;
  };

  const handleQuickAddPoint = (
    fnGroup,
    uutId,
    settings,
    selectedUnit = "",
  ) => {
    const newId = handleSaveTestPoint(
      buildBlankPoint(uutId, fnGroup, settings, selectedUnit),
    );
    setSelectedTestPointContextUutId(uutId || null);
    setPendingPointUnitChoice(null);
    if (newId != null) {
      setPendingValueEditPointId(newId);
    }
  };

  const openQuickAddPoint = (fnGroup, uutId, settings) => {
    const units = unitsForQuickAddPoint(fnGroup, uutId);
    if (units.length > 1) {
      setPendingPointUnitChoice({
        functionId: fnGroup.id,
        uutId,
        settings,
        units,
      });
      return;
    }
    handleQuickAddPoint(fnGroup, uutId, settings, units[0] || "");
  };

  // ---  Inline update handler for sidebar edits ---
  const handleInlinePointUpdate = (updatedPoint) => {
    saveTestPoint(updatedPoint, null);
  };

  const handleAnalysisDataSave = useCallback((updates) => {
    if (selectedTestPointId) {
      updateTestPointData(updates);
    } else {
      setVirtualPoint((prev) => {
        if (!prev) return prev;
        return { ...prev, ...updates };
      });
    }
  }, [selectedTestPointId, updateTestPointData]);

  // Apply a per-point transform to every point in the active session. Used by
  // the budget table's "Whole Session" override choice so a spec deviation on a
  // shared TMDE propagates to all points that use it (the saved instrument spec
  // in the library is intentionally left untouched).
  const handleApplyToSessionPoints = useCallback(
    (mapFn) => {
      if (!currentSessionData) return;
      const updatedTestPoints = (currentSessionData.testPoints || []).map(mapFn);
      updateSession({ ...currentSessionData, testPoints: updatedTestPoints });
    },
    [currentSessionData, updateSession],
  );

  const handleDeleteTmdeDefinition = (idOrIds) => {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    setAppNotification({
      title: ids.length > 1 ? "Delete TMDEs" : "Delete TMDE",
      message:
        ids.length > 1
          ? `Are you sure you want to delete these ${ids.length} TMDE definitions?`
          : "Are you sure you want to delete this TMDE definition?",
      confirmText: "Delete",
      isIconConfirm: true,
      onConfirm: () => {
        // The TMDE tables (summary + detailed) list the session-level master
        // TMDEs (currentSessionData.tmdes). Deleting must remove the master
        // definition AND scrub any per-point tmdeTolerance instances that were
        // derived from it (matched by id or sourceId). The old behavior only
        // pruned the active point's tolerances, so the master row never left
        // the table — that's the "delete doesn't work" bug.
        if (currentSessionData) {
          const idsSet = new Set(ids);
          const updatedTmdes = (currentSessionData.tmdes || []).filter(
            (t) => !idsSet.has(t.id),
          );
          const updatedTestPoints = (currentSessionData.testPoints || []).map(
            (tp) => {
              const tols = tp.tmdeTolerances || [];
              const nextTols = tols.filter(
                (t) => !idsSet.has(t.id) && !idsSet.has(t.sourceId),
              );
              return nextTols.length === tols.length
                ? tp
                : { ...tp, tmdeTolerances: nextTols };
            },
          );
          updateSession({
            ...currentSessionData,
            tmdes: updatedTmdes,
            testPoints: updatedTestPoints,
          });
        }
        setAppNotification(null);
      },
    });
  };

  const handleDeleteUut = (idOrIds) => {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    setAppNotification({
      title: ids.length > 1 ? "Delete UUTs" : "Delete UUT",
      message:
        ids.length > 1
          ? `Are you sure you want to delete these ${ids.length} UUT definitions?`
          : "Are you sure you want to delete this UUT definition?",
      confirmText: "Delete",
      isIconConfirm: true,
      onConfirm: () => {
        if (currentSessionData) {
          const idsSet = new Set(ids.map((id) => String(id)));
          const updatedUuts = (currentSessionData.uuts || []).filter(
            (u) => !idsSet.has(String(u.id)),
          );
          // Deleting a UUT must also scrub it from every point that referenced
          // it — otherwise points keep a dangling associatedUutId (and a stale
          // resolved uutTolerance) pointing at a standard that no longer exists.
          const updatedTestPoints = (currentSessionData.testPoints || []).map(
            (tp) => {
              const assoc = tp.associatedUutIds || [];
              const nextAssoc = assoc.filter(
                (aid) => !idsSet.has(String(aid)),
              );
              if (nextAssoc.length === assoc.length) return tp;
              const patch = { ...tp, associatedUutIds: nextAssoc };
              // No UUT left on the point → its resolved tolerance is orphaned.
              if (nextAssoc.length === 0) patch.uutTolerance = null;
              return patch;
            },
          );
          updateSession({
            ...currentSessionData,
            uuts: updatedUuts,
            testPoints: updatedTestPoints,
            // Clear legacy if the 'current' legacy UI matches one of the deleted
            ...(idsSet.has(String(currentSessionData.id))
              ? {
                  uutDescription: "",
                  uutTolerance: {},
                  uutInstrument: null,
                }
              : {}),
          });
        }
        setAppNotification(null);
      },
    });
  };

  const handleSaveToFile = async () => {
    if (!currentSessionData) return;
    const sessionCache = sessionImageCache.get(currentSessionData.id);
    try {
      // PDF generation is an explicit user action. Keep pdf-lib and the report
      // renderer out of the module's startup path.
      const { saveSessionToPdf } = await import("./utils/fileIo");
      await saveSessionToPdf(currentSessionData, sessionCache, {
        visibleColumns: visibleSidebarColumns,
      });
    } catch (error) {
      console.error("PDF Save Error:", error);
      setAppNotification({
        title: "Save Failed",
        message: `Failed to save PDF: ${error.message}`,
      });
    }
  };

  const handleLoadFromFile = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const { parseSessionPdf } = await import("./utils/fileIo");
      const { session, images } = await parseSessionPdf(file);
      const importedSession = await importSession(session, images);
      setSessionImageCache((prevCache) => {
        const newCache = new Map(prevCache);
        newCache.set(importedSession.id, images);
        return newCache;
      });
      setAppNotification({
        title: "Success",
        message: `Session "${importedSession.name}" imported as a new saved session.`,
      });
    } catch (error) {
      console.error("PDF Load Error:", error);
      setAppNotification({ title: "Load Failed", message: error.message });
    }
    event.target.value = null;
  };

  // --- DATA PROCESSING: Sidebar Hierarchy ---
  const sidebarData = useMemo(() => {
    if (!currentSessionData) return [];

    const uuts = currentSessionData.uuts || [];
    const points = currentTestPoints;
    const uutById = new Map(uuts.map((u) => [String(u.id), u]));
    // Function colors come from the same shared source the instrument-table
    // subsections use, so a recolor/rename in one surface shows in the other.
    const functionColorByKey = new Map(
      resolveSessionFunctions(currentSessionData).map((fn) => [fn.key, fn.color]),
    );

    // functionKey -> { id, name, unit, units, uutMap: Map(uutId -> { ...uut, points }) }
    const functionMap = new Map();
    const ensureFunction = ({ key, name, unit, units }) => {
      if (!functionMap.has(key)) {
        functionMap.set(key, {
          id: key,
          name,
          unit: unit || units?.[0] || "",
          units: Array.from(new Set([...(units || []), unit].filter(Boolean))),
          uutMap: new Map(),
          points: [],
        });
      } else {
        const existing = functionMap.get(key);
        existing.units = Array.from(
          new Set([...(existing.units || []), ...(units || []), unit].filter(Boolean)),
        );
        existing.unit = existing.units[0] || existing.unit || "";
      }
      return functionMap.get(key);
    };
    const ensureUut = (fnNode, uut) => {
      const uutId = String(uut.id);
      if (!fnNode.uutMap.has(uutId)) {
        fnNode.uutMap.set(uutId, { ...uut, id: uut.id, points: [] });
      }
      return fnNode.uutMap.get(uutId);
    };

    // 1. Seed function + UUT nodes from each UUT's declared functions so a UUT
    //    can host the first point of a function it can measure even before any
    //    point exists. Function headers remain visible even when their point
    //    list is empty, so the collapsed sidebar accurately reflects every UUT
    //    function available for a new point.
    uuts.forEach((uut) => {
      instrumentFunctions(uut).forEach((fn) => {
        ensureUut(ensureFunction(fn), uut);
      });
    });

    // 2. Keep points directly under their function in authored order. The UUT
    // is a per-row assignment, not a grouping/sort key; this allows workflows
    // that intentionally alternate between UUTs chronologically.
    const unassignedPoints = [];
    points.forEach((tp) => {
      const fnNode = ensureFunction(functionLabelOf(tp));
      fnNode.points.push(tp);
      const ownerId = (tp.associatedUutIds || [])
        .map((id) => String(id))
        .find((id) => uutById.has(id));
      if (!ownerId) {
        // A legacy point with no meaningful function still belongs in the
        // explicit Unassigned bucket; ordinary unassigned rows remain within
        // their named function so the row-level UUT dropdown can resolve them.
        if (fnNode.id === UNASSIGNED_FUNCTION_ID) unassignedPoints.push(tp);
        return;
      }
      const uutNode = ensureUut(fnNode, uutById.get(ownerId));
      uutNode.points.push(tp);
    });

    const result = Array.from(functionMap.values())
      .map((node) => ({
        id: node.id,
        name: node.name,
        unit: node.unit,
        units: node.units || (node.unit ? [node.unit] : []),
        color: functionColorByKey.get(node.id) || null,
        points: node.points || [],
        uutGroups: Array.from(node.uutMap.values()),
      }));

    // 3. Points whose owning UUT is gone collapse into a single top-level bucket.
    if (unassignedPoints.length > 0) {
      result.push({
        id: UNASSIGNED_FUNCTION_ID,
        name: "Unassigned Points",
        unit: "",
        units: [],
        isUnassigned: true,
        uutGroups: [
          {
            id: UNASSIGNED_UUT_ID,
            description: "No UUT",
            isUnassigned: true,
            points: unassignedPoints,
          },
        ],
      });
    }

    return result;
  }, [currentSessionData, currentTestPoints]);

  const sidebarValueColumnWidth = useMemo(
    () => getSidebarValueColumnWidth(currentTestPoints),
    [currentTestPoints],
  );

  // Exact top-to-bottom order of the point rows currently visible in the
  // sidebar. Shift-click must follow the active sort and skip collapsed rows.
  const visibleSidebarPointOrder = useMemo(() => {
    const visibleUutKeys = new Set();
    sidebarData.forEach((fnGroup) => {
      (fnGroup.uutGroups || []).forEach((group) => {
        visibleUutKeys.add(`${fnGroup.id}::${group.id}`);
      });
    });
    return getVisibleSidebarPointOrder(
      sidebarData,
      { expandedFunctions, expandedUuts: visibleUutKeys },
      sortSidebarPoints,
    );
  },
    [expandedFunctions, sidebarData, sortSidebarPoints],
  );

  useEffect(() => {
    if (selectedSessionId && selectedTestPointId) {
      lastSelectedPointBySessionRef.current[selectedSessionId] =
        selectedTestPointId;
    }
  }, [selectedSessionId, selectedTestPointId]);

  const handleAnalysisModeChange = useCallback(
    (nextMode) => {
      if (nextMode !== "uncertaintyTool") {
        setAnalysisMode(nextMode);
        return;
      }

      const activePoint = currentTestPoints.find(
        (candidate) => String(candidate.id) === String(selectedTestPointId),
      );
      if (activePoint) {
        setAnalysisMode(nextMode);
        return;
      }

      const rememberedId = selectedSessionId
        ? lastSelectedPointBySessionRef.current[selectedSessionId]
        : null;
      const point =
        currentTestPoints.find(
          (candidate) => String(candidate.id) === String(rememberedId),
        ) || currentTestPoints[0];
      if (!point) {
        setAnalysisMode("overview");
        return;
      }

      const occurrence = visibleSidebarPointOrder.find(
        (entry) => String(entry.pointId) === String(point.id),
      );
      const contextUutId =
        occurrence?.contextUutId || point.associatedUutIds?.[0] || null;
      setSelectedTestPointId(point.id);
      setSelectedTestPointContextUutId(contextUutId);
      setSelectedFunctionId(functionKeyOf(point));
      setSelectedUutId(null);
      setSelectedSidebarPointIds([point.id]);
      setSidebarSelectionAnchor({ pointId: point.id, contextUutId });
      setVirtualPoint(null);
      setCurrentUutSelection([]);
      setSelectedTablePointIds([]);
      setAnalysisMode("uncertaintyTool");
    },
    [
      currentTestPoints,
      selectedSessionId,
      selectedTestPointId,
      setSelectedTestPointId,
      visibleSidebarPointOrder,
    ],
  );

  // --- LOGIC: Compute Data to Display ---
  const displayData = useMemo(() => {
    if (!currentSessionData) return null;

    if (selectedTestPointId) {
      const pointData = currentTestPoints.find(
        (p) => p.id === selectedTestPointId,
      );
      if (!pointData) return null;

      let effectiveUutTolerance =
        pointData.uutTolerance !== null &&
        pointData.uutTolerance !== undefined &&
        Object.keys(pointData.uutTolerance).length > 0
          ? pointData.uutTolerance
          : currentSessionData.uutTolerance;

      let effectiveUutDescription =
        pointData.uutDescription ||
        (pointData.associatedUutIds?.length > 0
          ? currentSessionData.uuts?.find(
              (u) => u.id === pointData.associatedUutIds[0],
            )?.description
          : currentSessionData.uutDescription);

      let activeUutId = null;
      let activeUut = null;

      if (selectedTestPointContextUutId) {
        const contextUut = currentSessionData.uuts?.find(
          (u) => u.id === selectedTestPointContextUutId,
        );
        if (contextUut) {
          activeUut = contextUut;
          effectiveUutDescription = contextUut.description;
          activeUutId = contextUut.id;

          if (
            !pointData.uutTolerance ||
            Object.keys(pointData.uutTolerance).length === 0
          ) {
            const pointValue = pointData.testPointInfo?.parameter?.value;
            const pointUnit = pointData.testPointInfo?.parameter?.unit;
            if (pointValue !== undefined && pointValue !== "") {
              const matchedRange = findMatchingRange(
                contextUut,
                pointValue,
                pointUnit,
              );
              if (matchedRange) {
                effectiveUutTolerance = matchedRange;
              }
            }
          }
        }
      }

      if (
        !activeUutId &&
        pointData.associatedUutIds &&
        pointData.associatedUutIds.length > 0
      ) {
        activeUutId = pointData.associatedUutIds[0];
        activeUut =
          currentSessionData.uuts?.find((u) => u.id === activeUutId) || null;
        if (
          !pointData.uutTolerance ||
          Object.keys(pointData.uutTolerance).length === 0
        ) {
          if (activeUut) {
            const pointValue = pointData.testPointInfo?.parameter?.value;
            const pointUnit = pointData.testPointInfo?.parameter?.unit;
            if (pointValue !== undefined && pointValue !== "") {
              const matchedRange = findMatchingRange(
                activeUut,
                pointValue,
                pointUnit,
              );
              if (matchedRange) {
                effectiveUutTolerance = matchedRange;
              }
            }
          }
        }
      }

      if (
        activeUut &&
        !pointToleranceMatchesFunction(pointData, effectiveUutTolerance)
      ) {
        const pointValue = pointData.testPointInfo?.parameter?.value;
        const pointUnit = pointData.testPointInfo?.parameter?.unit;
        const matchedRange = findMatchingRange(activeUut, pointValue, pointUnit);
        if (matchedRange) {
          effectiveUutTolerance = matchedRange;
        }
      }

      const effectiveMeasurementAreaId = resolvePointAreaId(
        pointData,
        currentSessionData.uuts,
        currentSessionData.measurementAreas,
        activeUutId,
      );

      return {
        ...pointData,
        viewMode: "point",
        measurementAreaId: effectiveMeasurementAreaId,
        uutDescription: effectiveUutDescription,
        uutTolerance: effectiveUutTolerance,
        activeUutId: activeUutId,
      };
    }

    if (virtualPoint) {
      let activeUutId = null;
      if (
        virtualPoint.associatedUutIds &&
        virtualPoint.associatedUutIds.length > 0
      ) {
        activeUutId = virtualPoint.associatedUutIds[0];
      }
      return {
        ...virtualPoint,
        viewMode: "point",
        activeUutId: activeUutId,
      };
    }

    if (selectedUutId) {
      return { viewMode: "uut", id: selectedUutId };
    }

    if (selectedFunctionId) {
      const fnNode = sidebarData.find((fn) => fn.id === selectedFunctionId);
      return {
        viewMode: "function",
        id: selectedFunctionId,
        functionName: fnNode?.name || "",
        functionUnit: fnNode?.unit || "",
      };
    }

    if (selectedSessionId) {
      return { viewMode: "session", id: selectedSessionId };
    }

    return null;
  }, [
    currentSessionData,
    selectedTestPointId,
    currentTestPoints,
    virtualPoint,
    selectedTestPointContextUutId,
    selectedUutId,
    selectedFunctionId,
    selectedSessionId,
    sidebarData,
  ]);

  // Shared sidebar point-row markup (used under every UUT and the Unassigned
  // bucket). Extracted so the Function -> UUT -> Point tree stays readable.
  const renderSidebarPointRow = (tp, fnGroup, previousPoint = null) => {
    const contextUutId = tp.associatedUutIds?.[0] || null;
    const functionUuts = (fnGroup?.uutGroups || []).filter(
      (group) => !group.isUnassigned,
    );
    const currentUut = (currentSessionData?.uuts || []).find(
      (uut) => String(uut.id) === String(contextUutId),
    );
    const previousUutId = previousPoint?.associatedUutIds?.[0] || null;
    const qualifier = tp.testPointInfo?.qualifier?.value ?? "";
    const previousQualifier = previousPoint?.testPointInfo?.qualifier?.value ?? "";
    return (
    <SidebarPointItem
      key={tp.id}
      point={tp}
      currentUutId={contextUutId || ""}
      uutName={formatInstrumentIdentity(
        currentUut || { name: "Unassigned" },
      )}
      uutOptions={functionUuts.map((uut) => ({
        id: uut.id,
        label: formatInstrumentIdentity(uut),
      }))}
      mergedFields={{
        uut: previousPoint && String(previousUutId || "") === String(contextUutId || ""),
        section: previousPoint && String(previousPoint.section || "") === String(tp.section || ""),
        qualifier: previousPoint && String(previousQualifier) === String(qualifier),
      }}
      onUutChange={(nextUutId) => {
        const nextUut = (currentSessionData?.uuts || []).find(
          (uut) => String(uut.id) === String(nextUutId),
        );
        const parameter = tp.testPointInfo?.parameter || {};
        const nextPoint = {
          ...tp,
          associatedUutIds: nextUut ? [nextUut.id] : [],
          measurementAreaId: nextUut?.measurementAreaId || null,
          uutTolerance: nextUut
            ? findMatchingRange(nextUut, parameter.value, parameter.unit)
            : null,
        };
        handleInlinePointUpdate(nextPoint);
        setSelectedTestPointContextUutId(nextUut?.id || null);
      }}
      valueColumnWidth={sidebarValueColumnWidth}
      visibleColumns={visibleSidebarColumns}
      isSelected={selectedSidebarPointIds.includes(tp.id)}
      isActivePoint={selectedTestPointId === tp.id}
      isTableSelected={selectedTablePointIds.includes(tp.id)}
      liveRiskMetrics={pointRiskMap[tp.id]}
      riskRequirements={currentSessionData?.uncReq || {}}
      isLiveRiskTarget={true}
      onSelect={(e) => handleSelectTestPoint(e, tp.id, contextUutId)}
      onShowRiskBreakdown={(key) => setPendingRiskBreakdown(key)}
      autoEditValue={pendingValueEditPointId === tp.id}
      onAutoEditConsumed={() => setPendingValueEditPointId(null)}
      onSave={handleInlinePointUpdate}
      onContextMenu={(e, p) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
          x: e.pageX,
          y: e.pageY,
          items: [
            {
              label: "Copy Point",
              action: () => handleCopyPoint(p),
              icon: faCopy,
            },
            {
              label: "Cut Point",
              action: () =>
                handleCutPoint(
                  selectedSidebarPointIds.includes(p.id)
                    ? currentTestPoints.filter((point) =>
                        selectedSidebarPointIds.includes(point.id),
                      )
                    : p,
                ),
              icon: faCut,
            },
            ...(clipboardKind === "point" && clipboardPoint
              ? [
                  {
                    label: "Paste Point",
                    action: () => handlePastePoint(contextUutId, null, null),
                    icon: faPaste,
                  },
                ]
              : []),
            {
              label: "Delete Point",
              action: () => handleDeleteTestPoint(p.id),
              icon: faTrashAlt,
              className: "destructive",
            },
          ],
        });
      }}
    />
    );
  };

  const renderEmptySidebarUutRow = (group, fnGroup) => {
    const uutKey = `${fnGroup.id}::${group.id}`;
    const gridTemplateColumns = getSidebarGridTemplate(
      visibleSidebarColumns,
      sidebarValueColumnWidth,
    );
    const identity = formatInstrumentIdentity(group);
    return (
      <div
        key={`empty-${uutKey}`}
        className="sidebar-empty-uut-row"
        style={{ gridTemplateColumns }}
        aria-label={`${identity}: no measurement points`}
        onClick={() => handleSelectUut(group.id, fnGroup.id)}
      >
        {visibleSidebarColumns.uut && (
          <span className="point-uut-name" title={identity}>
            {identity}
          </span>
        )}
        <span
          className="sidebar-empty-uut-copy"
          style={{
            gridColumn: visibleSidebarColumns.uut ? "2 / -1" : "1 / -1",
          }}
        >
          No measurement points
        </span>
      </div>
    );
  };

  const renderSidebarColumnHeaders = () => {
    const gridTemplateColumns = getSidebarGridTemplate(
      visibleSidebarColumns,
      sidebarValueColumnWidth,
    );
    const visibleGroups = SIDEBAR_COLUMN_GROUPS.map((group) => ({
      ...group,
      visibleCount: group.columns.filter((key) => visibleSidebarColumns[key])
        .length,
    })).filter((group) => group.visibleCount > 0);

    return (
      <div className="sidebar-column-header-stack">
        <div
          className="sidebar-column-groups"
          style={{ gridTemplateColumns }}
          aria-label="Measurement point column groups"
        >
          {visibleGroups.map((group) => (
            <div
              key={group.key}
              className={`sidebar-column-group sidebar-column-group--${group.key}`}
              style={{ gridColumn: `span ${group.visibleCount}` }}
              title={group.label}
            >
              {group.label}
            </div>
          ))}
        </div>
        <div
          className="sidebar-column-headers"
          style={{
            display: "grid",
            gridTemplateColumns,
          }}
        >
      {visibleSidebarColumns.uut &&
        renderSidebarSortHeader("uut", "UUT")}
      {visibleSidebarColumns.section &&
        renderSidebarSortHeader("section", "Sect.", {
          align: "right",
          title: "Section",
        })}
      {visibleSidebarColumns.value &&
        renderSidebarSortHeader("value", "Value", {
          className: "sidebar-value-sticky",
        })}
      {visibleSidebarColumns.qualifier &&
        renderSidebarSortHeader("qualifier", "Qual.")}
      {visibleSidebarColumns.tolerance &&
        renderSidebarSortHeader("tolerance", "Tolerance")}
      {visibleSidebarColumns.lowLimit &&
        renderSidebarSortHeader("lowLimit", "UUT Low", {
          title: "UUT Low Limit",
        })}
      {visibleSidebarColumns.highLimit &&
        renderSidebarSortHeader("highLimit", "UUT High", {
          title: "UUT High Limit",
        })}
      {visibleSidebarColumns.standardUncertainty &&
        renderSidebarSortHeader("standardUncertainty", "Std. Unc.", {
          align: "center",
          title: "Standard Uncertainty (combined)",
        })}
      {visibleSidebarColumns.measurementUncertainty &&
        renderSidebarSortHeader("measurementUncertainty", "Exp. Unc.", {
          align: "center",
          title: "Measurement Uncertainty (expanded)",
        })}
      {visibleSidebarColumns.tmdeLow &&
        renderSidebarSortHeader("tmdeLow", "TMDE Low")}
      {visibleSidebarColumns.tmdeHigh &&
        renderSidebarSortHeader("tmdeHigh", "TMDE High")}
      {visibleSidebarColumns.tur &&
        renderSidebarSortHeader("tur", "TUR", { align: "center" })}
      {visibleSidebarColumns.tar &&
        renderSidebarSortHeader("tar", "TAR", { align: "center" })}
      {visibleSidebarColumns.observedReop &&
        renderSidebarSortHeader("observedReop", "REOP @ TUR", {
          align: "center",
          title: "REOP at Test-Point TUR",
        })}
      {visibleSidebarColumns.pfa &&
        renderSidebarSortHeader("pfa", "PFA", { align: "center" })}
      {visibleSidebarColumns.pfr &&
        renderSidebarSortHeader("pfr", "PFR", { align: "center" })}
      {visibleSidebarColumns.maxReop &&
        renderSidebarSortHeader("maxReop", "Max REOP", {
          align: "center",
          title: "Maximum REOP",
        })}
      {visibleSidebarColumns.trueReop &&
        renderSidebarSortHeader("trueReop", "R_meas", { align: "center" })}
      {visibleSidebarColumns.gbMult &&
        renderSidebarSortHeader("gbMult", "GB Mult", { align: "center" })}
      {visibleSidebarColumns.gbLow &&
        renderSidebarSortHeader("gbLow", "GB Low", {
          title: "GB Lower Limit",
        })}
      {visibleSidebarColumns.gbHigh &&
        renderSidebarSortHeader("gbHigh", "GB High", {
          title: "GB Upper Limit",
        })}
      {visibleSidebarColumns.gbPfa &&
        renderSidebarSortHeader("gbPfa", "PFA + GB", {
          align: "center",
          title: "PFA with Guardband",
        })}
      {visibleSidebarColumns.gbPfr &&
        renderSidebarSortHeader("gbPfr", "PFR + GB", {
          align: "center",
          title: "PFR with Guardband",
        })}
      {visibleSidebarColumns.gbCalInt &&
        renderSidebarSortHeader("gbCalInt", "Cal Int + GB", {
          align: "center",
          title: "Calibration Interval with Guardband",
        })}
      {visibleSidebarColumns.gbMeasRel &&
        renderSidebarSortHeader("gbMeasRel", "Target REOP + GB", {
          align: "center",
          title: "Targeted REOP with Guardband",
        })}
      {visibleSidebarColumns.noGbPfa &&
        renderSidebarSortHeader("noGbPfa", "PFA no GB", {
          align: "center",
          title: "PFA without Guardband",
        })}
      {visibleSidebarColumns.noGbPfr &&
        renderSidebarSortHeader("noGbPfr", "PFR no GB", {
          align: "center",
          title: "PFR without Guardband",
        })}
      {visibleSidebarColumns.noGbCalInt &&
        renderSidebarSortHeader("noGbCalInt", "Cal Int no GB", {
          align: "center",
          title: "Calibration Interval without Guardband",
        })}
      {visibleSidebarColumns.noGbMeasRel &&
        renderSidebarSortHeader("noGbMeasRel", "Target REOP no GB", {
          align: "center",
          title: "Targeted REOP without Guardband",
        })}
        </div>
      </div>
    );
  };

  const renderFunctionPointActions = (fnGroup) => {
    const uutOptions = (fnGroup.uutGroups || []).filter(
      (group) => !group.isUnassigned,
    );
    if (uutOptions.length === 0) return null;

    const settings = getFunctionPointSettings(currentSessionData, fnGroup.id);
    const settingsOpen = openFunctionSettingsId === fnGroup.id;

    return (
      <>
        <div
          className={`function-point-settings${settingsOpen ? " is-open" : ""}`}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={`function-point-settings-button${settingsOpen ? " is-active" : ""}`}
            data-tour="function-settings"
            title={`${fnGroup.name} function settings`}
            aria-label={`${fnGroup.name} function settings`}
            aria-expanded={settingsOpen}
            onClick={() =>
              setOpenFunctionSettingsId((current) =>
                current === fnGroup.id ? null : fnGroup.id,
              )
            }
          >
            <FontAwesomeIcon icon={faCog} />
          </button>
          {settingsOpen && (
            <div
              className="function-point-settings-menu"
              data-tour="function-settings-menu"
              role="dialog"
              aria-label={`${fnGroup.name} function settings`}
            >
              <div className="function-point-settings-heading">
                <strong>Function Settings</strong>
              </div>
              <div className="function-point-type-options" role="radiogroup" aria-label="New point type">
                {[
                  ["direct", "Direct"],
                  ["derived", "Derived"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={settings.mode === value}
                    className={settings.mode === value ? "is-selected" : ""}
                    onClick={() => updateFunctionPointSettings(fnGroup, { mode: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {settings.mode === "derived" && (
                <label className="function-point-setting-check">
                  <input
                    type="checkbox"
                    checked={settings.reuseEquation}
                    onChange={(event) =>
                      updateFunctionPointSettings(fnGroup, {
                        reuseEquation: event.target.checked,
                      })
                    }
                  />
                  <span>
                    <strong>Reuse the first point's equation</strong>
                    <small>New derived points start with the same equation and variables.</small>
                  </span>
                </label>
              )}
              <label className="function-point-setting-check">
                <input
                  type="checkbox"
                  checked={settings.reuseBudget}
                  onChange={(event) =>
                    updateFunctionPointSettings(fnGroup, {
                      reuseBudget: event.target.checked,
                    })
                  }
                />
                <span>
                  <strong>Reuse the first point's budget</strong>
                  <small>New points carry over entire budget of initial point.</small>
                </span>
              </label>
            </div>
          )}
        </div>
        <div
          className="function-point-actions"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="btn-icon-only small function-point-add-button"
            data-tour="add-measurement-point"
            onClick={() => {
              setExpandedFunctions((previous) =>
                new Set(previous).add(fnGroup.id),
              );
              setPendingPointUnitChoice(null);
              openQuickAddPoint(fnGroup, null, settings);
            }}
            title={
              settings.mode === "derived"
                ? "Add derived point"
                : "Add direct point"
            }
            aria-label={
              settings.mode === "derived"
                ? "Add derived point"
                : "Add direct point"
            }
          >
            <FontAwesomeIcon icon={faPlus} size="xs" />
          </button>
          {pendingPointUnitChoice?.functionId === fnGroup.id && (
              <div
                className="budget-settings-menu point-unit-picker function-point-unit-picker"
                data-tour="measurement-point-menu"
                role="menu"
                aria-label="Choose measurement point unit"
                onClick={(event) => event.stopPropagation()}
              >
                <h5 className="point-unit-picker-title">Choose unit</h5>
                {pendingPointUnitChoice.units.map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      handleQuickAddPoint(
                        fnGroup,
                        pendingPointUnitChoice.uutId,
                        pendingPointUnitChoice.settings,
                        unit,
                      )
                    }
                  >
                    {getUnitDisplayLabel(unit)}
                  </button>
                ))}
                <button
                  type="button"
                  className="point-unit-picker-cancel"
                  onClick={() => setPendingPointUnitChoice(null)}
                >
                  Cancel
                </button>
              </div>
            )}
        </div>
      </>
    );
  };

  return (
    <ThemeContext.Provider value={isDarkMode}>
      <div className="App uncertainty-module">
        {/* ... (Existing Modals) ... */}
        {appNotification && (
          <NotificationModal
            isOpen={true}
            onClose={() => {
              if (appNotification?.onClose) appNotification.onClose();
              setAppNotification(null);
            }}
            title={appNotification.title}
            message={appNotification.message}
            confirmText={appNotification.confirmText}
            cancelText={appNotification.cancelText}
            isIconConfirm={appNotification.isIconConfirm}
            onConfirm={appNotification.onConfirm}
            secondaryText={appNotification.secondaryText}
            onSecondary={appNotification.onSecondary}
            secondaryIsPrimary={appNotification.secondaryIsPrimary}
            inputLabel={appNotification.inputLabel}
            inputPlaceholder={appNotification.inputPlaceholder}
            initialInputValue={appNotification.initialInputValue}
            validateInput={appNotification.validateInput}
          />
        )}

        <BugReportModal
          isOpen={isBugReportOpen}
          onClose={() => setIsBugReportOpen(false)}
          reports={bugReports}
          onSave={saveBugReport}
          onDelete={handleDeleteBugReport}
        />
        <GuidedWalkthrough
          isOpen={isWalkthroughOpen}
          steps={walkthroughSteps}
          stepIndex={walkthroughStepIndex}
          onStepChange={setWalkthroughStepIndex}
          onClose={() => setIsWalkthroughOpen(false)}
        />
        {currentSessionData && (
          <>
            {" "}
            <UnitConverter
              isOpen={isConverterOpen}
              onClose={() => setIsConverterOpen(false)}
            />{" "}
            {isTraceabilityOpen && (
              <Suspense fallback={null}>
                <ReverseTraceabilityTool
                  isOpen
                  onClose={() => setIsTraceabilityOpen(false)}
                />
              </Suspense>
            )}{" "}
          </>
        )}
        <UnresolvedToleranceModal
          isOpen={!!unresolvedToleranceModal}
          matches={unresolvedToleranceModal?.matches}
          instrumentName={unresolvedToleranceModal?.instrumentName}
          onSelect={(selected) => {
            unresolvedToleranceModal.onSelect(selected);
          }}
          onClose={() => setUnresolvedToleranceModal(null)}
        />

        {/* Global Library Modal (Instrument Manager) */}
        <UniversalInstrumentModal
          isOpen={isInstrumentBuilderOpen}
          onClose={() => setIsInstrumentBuilderOpen(false)}
          onSave={handleUniversalModalSave}
          onSaveToLibrary={saveInstrument}
          onInstrumentSynced={reconcileSyncedInstrument}
          onDelete={deleteInstrument}
          onBatchAdd={handleBatchAddInstruments}
          instruments={instruments}
          mode={instrumentModalConfig.mode}
          initialData={instrumentModalConfig.data}
        />

        <NotificationModal
          isOpen={!!confirmationModal}
          onClose={() => setConfirmationModal(null)}
          title={confirmationModal?.title}
          message={confirmationModal?.message}
          confirmText={confirmationModal?.confirmText || "Delete"}
          isIconConfirm
          onConfirm={confirmationModal?.onConfirm}
        />
        {displayData && displayData.id && displayData.viewMode === "point" && (
          <ToleranceToolModal
            isOpen={isToleranceModalOpen}
            onClose={() => setIsToleranceModalOpen(false)}
            onSave={(data) => {
              updateTestPointData(data);
            }}
            testPointData={displayData}
          />
        )}
        <FullBreakdownModal
          isOpen={!!breakdownPoint}
          breakdownData={breakdownPoint}
          onClose={() => setBreakdownPoint(null)}
        />
        <TestPointInfoModal
          isOpen={!!infoModalPoint}
          testPoint={infoModalPoint}
          onClose={() => setInfoModalPoint(null)}
        />
        {contextMenu && (
          <ContextMenu
            menu={contextMenu}
            onClose={() => setContextMenu(null)}
          />
        )}

        <div className="content-area uncertainty-analysis-page">
          {/* Module chrome — mirrors the AC-Shunt module's .app-chrome header
              (brand block on the left, a meta-icon tool cluster on the right).
              The floating draggable toolbar was removed; the global window
              chrome + theme toggle live in the workbench top bar above. */}
          <header className="app-chrome">
            <div className="app-chrome-bar">
              <div className="app-chrome-brand">
                <div
                  className="app-chrome-brand-mark"
                  role="img"
                  aria-label="Uncertalytics"
                >
                  <span className="app-chrome-brand-mark-plate">
                    <div className="app-chrome-brand-mark-img">
                      <HeaderEmblem />
                    </div>
                  </span>
                </div>
                <div className="app-chrome-brand-text">
                  <span className="app-chrome-brand-name">
                    Uncertalytics
                  </span>
                  <div className="app-chrome-brand-eyebrow">
                    <span className="app-chrome-brand-sub">
                      Uncertainty &amp; Risk Analysis Tool
                    </span>
                    <span className="app-chrome-brand-version">v1.0</span>
                  </div>
                </div>
              </div>

              <div
                className="app-chrome-meta app-chrome-meta--nav"
                role="group"
                aria-label="Tools"
              >
                <div
                  className="app-chrome-meta-group app-chrome-meta-group--tools"
                  aria-label="Session tools"
                >
                  <button
                    type="button"
                    className={`app-chrome-meta-icon${isInstrumentBuilderOpen ? " is-active" : ""}`}
                    onClick={() => {
                      if (isInstrumentBuilderOpen) {
                        setIsInstrumentBuilderOpen(false);
                      } else {
                        handleOpenLibrary();
                      }
                    }}
                    title="Instrument builder"
                    aria-label="Instrument builder"
                  >
                    <FontAwesomeIcon icon={faRadio} />
                  </button>
                  <button
                    type="button"
                    className={`app-chrome-meta-icon${isTraceabilityOpen ? " is-active" : ""}`}
                    onClick={() => setIsTraceabilityOpen((o) => !o)}
                    title="Reverse traceability"
                    aria-label="Reverse traceability"
                  >
                    <FontAwesomeIcon icon={faHistory} />
                  </button>
                  <button
                    type="button"
                    className={`app-chrome-meta-icon${isConverterOpen ? " is-active" : ""}`}
                    onClick={() => setIsConverterOpen((o) => !o)}
                    title="Unit converter"
                    aria-label="Unit converter"
                  >
                    <FontAwesomeIcon icon={faRightLeft} />
                  </button>
                </div>

                <span className="app-chrome-meta-sep" aria-hidden="true" />

                <div
                  className="app-chrome-meta-group app-chrome-meta-group--tools"
                  aria-label="Import and export"
                >
                  <button
                    type="button"
                    className="app-chrome-meta-icon"
                    onClick={handleSaveToFile}
                    title="Export session to PDF"
                    aria-label="Export session to PDF"
                  >
                    <FontAwesomeIcon icon={faSave} />
                  </button>
                  <label
                    className="app-chrome-meta-icon"
                    htmlFor="uncertainty-load-pdf"
                    title="Import session from PDF"
                  >
                    <FontAwesomeIcon icon={faFolderOpen} />
                  </label>
                  <input
                    type="file"
                    id="uncertainty-load-pdf"
                    accept=".pdf"
                    style={{ display: "none" }}
                    onChange={handleLoadFromFile}
                  />
                </div>

                <span className="app-chrome-meta-sep" aria-hidden="true" />

                <div
                  className="app-chrome-meta-group app-chrome-meta-group--tools"
                  aria-label="Feedback"
                >
                  <button
                    type="button"
                    className="app-chrome-meta-icon"
                    data-tour="help-walkthrough"
                    onClick={() => {
                      setWalkthroughStepIndex(0);
                      setIsWalkthroughOpen(true);
                    }}
                    title="Open walkthrough"
                    aria-label="Open walkthrough"
                  >
                    <FontAwesomeIcon icon={faQuestionCircle} />
                  </button>
                  <button
                    type="button"
                    className="app-chrome-meta-icon"
                    onClick={() => setIsBugReportOpen(true)}
                    title="Report an issue"
                    aria-label="Report an issue"
                  >
                    <FontAwesomeIcon icon={faBug} />
                  </button>
                  {showThemeToggle && (
                    <button
                      type="button"
                      className="app-chrome-meta-icon"
                      onClick={toggleTheme}
                      title={
                        theme === "dark"
                          ? "Switch to light mode"
                          : "Switch to dark mode"
                      }
                      aria-label={
                        theme === "dark"
                          ? "Switch to light mode"
                          : "Switch to dark mode"
                      }
                    >
                      <FontAwesomeIcon
                        icon={theme === "dark" ? faSun : faMoon}
                      />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </header>

          <div className="results-workflow-container" ref={resultsContainerRef}>
            <aside
              className="results-sidebar"
              style={{
                width: `${sidebarWidth}px`,
                minWidth: `${sidebarWidth}px`,
                maxWidth: `${sidebarWidth}px`,
                position: "relative",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {/* NEW: DRAG HANDLE */}
              <div
                className="sidebar-resizer"
                onMouseDown={startResizing}
                title="Drag to resize sidebar"
              />
              <div
                className="sidebar-header"
                style={{ alignItems: "flex-end" }}
              >
                <div className="session-controls">
                  <label htmlFor={sessions.length > 0 ? "session-select" : undefined}>
                    Analysis Session
                  </label>
                  {sessions.length > 0 ? (
                    <select
                      id="session-select"
                      className="session-selector"
                      value={selectedSessionId || ""}
                      onChange={(e) =>
                        handleSelectSession(Number(e.target.value))
                      }
                    >
                      {sessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="session-empty-label" role="status">
                      No sessions yet
                    </div>
                  )}
                </div>
                <div className="sidebar-view-controls">
                  <button
                    onClick={handleAddNewSession}
                    data-tour="add-session"
                    title="Add New Session"
                    className="sidebar-action-button"
                  >
                    <FontAwesomeIcon icon={faPlus} />
                  </button>
                  {sessions.length > 0 && (
                    <button
                      onClick={() => handleDeleteSession(selectedSessionId)}
                      title="Delete Session"
                      className="sidebar-action-button delete"
                    >
                      <FontAwesomeIcon icon={faTrashAlt} />
                    </button>
                  )}
                </div>
              </div>

              {/* === SIDEBAR LIST === */}
              <div className="measurement-point-list">
                <div className="scoped-zoom-content">
                {/* Session metadata stays in the sidebar; Instrument Overview
                    now lives in the first workspace tab. */}
                <SidebarSessionHeader
                  sessionData={currentSessionData}
                  onUpdate={updateSession}
                  isSessionInfoOpen={isSessionInfoOpen}
                  onSessionInfoOpenChange={setIsSessionInfoOpen}
                  isRiskInputsOpen={isRiskInputsOpen}
                  onRiskInputsOpenChange={setIsRiskInputsOpen}
                  isMitigationInputsOpen={isMitigationInputsOpen}
                  onMitigationInputsOpenChange={setIsMitigationInputsOpen}
                />

                {/* 3. MEASUREMENT POINTS */}
                <div className="sidebar-global-actions">
                  <div className="sidebar-section-toggle sidebar-measurement-title-toggle">
                    <span className="sidebar-section-title">
                      Measurement Points
                    </span>
                  </div>

                  <div className="sidebar-actions-group">
                    {/* Eyeball Button Removed - Moved to HeaderToolbox */}

                      <>
                        {/* Expand/Collapse All */}
                        <button
                          onClick={handleToggleExpandAll}
                          title={isGlobalExpanded ? "Collapse All" : "Expand All"}
                          className="sidebar-action-btn-organic"
                        >
                          <FontAwesomeIcon
                            icon={
                              isGlobalExpanded
                                ? faCompressArrowsAlt
                                : faExpandArrowsAlt
                            }
                          />
                        </button>

                        {/* Column Filter Menu */}
                        <div className="sidebar-column-menu" ref={columnMenuRef}>
                          <button
                            onClick={() => setIsColumnMenuOpen(!isColumnMenuOpen)}
                            title="Filter visible columns"
                            className={`sidebar-action-btn-organic ${isColumnMenuOpen ? "active" : ""}`}
                          >
                            <FontAwesomeIcon icon={faSlidersH} />
                          </button>

                          {isColumnMenuOpen && (
                            <div className="sidebar-filter-dropdown">
                          {[
                            {
                              group: "Measurement",
                              cols: [
                                { key: "uut", label: "UUT" },
                                { key: "section", label: "Section" },
                                { key: "value", label: "Value" },
                                { key: "qualifier", label: "Qualifier" },
                                { key: "tolerance", label: "Tolerance" },
                                { key: "lowLimit", label: "UUT Low Limit" },
                                { key: "highLimit", label: "UUT High Limit" },
                                {
                                  key: "standardUncertainty",
                                  label: "Comb. Uncertainty",
                                },
                                {
                                  key: "measurementUncertainty",
                                  label: "Exp. Uncertainty",
                                },
                                { key: "tmdeLow", label: "TMDE Low Limit" },
                                { key: "tmdeHigh", label: "TMDE High Limit" },
                                { key: "tur", label: "TUR" },
                                { key: "tar", label: "TAR" },
                              ],
                            },
                            {
                              group: "Risk",
                              cols: [
                                {
                                  key: "observedReop",
                                  label: "REOP @ test pt TUR",
                                },
                                { key: "pfa", label: "PFA" },
                                { key: "pfr", label: "PFR" },
                                { key: "maxReop", label: "Max REOP" },
                                { key: "trueReop", label: "R_meas" },
                              ],
                            },
                            {
                              group: "Mitigation (GB + Int)",
                              cols: [
                                { key: "gbMult", label: "GB Mult" },
                                { key: "gbLow", label: "GB Lower Limit" },
                                { key: "gbHigh", label: "GB Upper Limit" },
                                { key: "gbPfa", label: "PFA with GB" },
                                { key: "gbPfr", label: "PFR with GB" },
                                { key: "gbCalInt", label: "Cal Int with GB" },
                                {
                                  key: "gbMeasRel",
                                  label: "Targeted REOP w/ GB",
                                },
                              ],
                            },
                            {
                              group: "Mitigation (Int Only)",
                              cols: [
                                { key: "noGbPfa", label: "PFA w/o GB" },
                                { key: "noGbPfr", label: "PFR w/o GB" },
                                { key: "noGbCalInt", label: "Cal Int w/o GB" },
                                {
                                  key: "noGbMeasRel",
                                  label: "Targeted REOP w/o GB",
                                },
                              ],
                            },
                          ].map((section) => {
                            const selectedCount = section.cols.filter(
                              (col) => Boolean(sidebarColumns[col.key]),
                            ).length;
                            const allSelected =
                              selectedCount === section.cols.length;
                            const partlySelected =
                              selectedCount > 0 && !allSelected;

                            return (
                              <div
                                key={section.group}
                                className="filter-option-group"
                              >
                                <label className="filter-option-group-title">
                                  <input
                                    type="checkbox"
                                    aria-label={`Toggle all ${section.group} columns`}
                                    aria-checked={
                                      partlySelected ? "mixed" : allSelected
                                    }
                                    checked={allSelected}
                                    ref={(input) => {
                                      if (input) {
                                        input.indeterminate = partlySelected;
                                      }
                                    }}
                                    onChange={(event) =>
                                      setSidebarColumns((prev) => {
                                        const next = { ...prev };
                                        section.cols.forEach((col) => {
                                          next[col.key] = event.target.checked;
                                        });
                                        return next;
                                      })
                                    }
                                  />
                                  <span>{section.group}</span>
                                </label>
                                {section.cols.map((col) => (
                                  <label
                                    key={col.key}
                                    className="filter-option"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={Boolean(sidebarColumns[col.key])}
                                      onChange={() =>
                                        setSidebarColumns((prev) => ({
                                          ...prev,
                                          [col.key]: !prev[col.key],
                                        }))
                                      }
                                    />
                                    <span>{col.label}</span>
                                  </label>
                                ))}
                              </div>
                            );
                          })}
                            </div>
                          )}
                        </div>
                      </>
                  </div>
                </div>

                {currentTestPoints.length === 0 && (
                  <div className="measurement-points-empty-state" role="status">
                    <FontAwesomeIcon icon={faMicroscope} aria-hidden="true" />
                    <div>
                      <strong>Ready for your first measurement point</strong>
                      <div className="measurement-points-empty-copy">
                        <p>
                          Instruments are organized by Function, grouping them
                          by capability (such as DC Voltage or Pressure) while
                          keeping multi-mode operations separate.
                        </p>
                        <p>
                          Select or create a Function to define the measurement
                          category.
                        </p>
                        <p>Add the UUTs that perform that Function.</p>
                        <p>
                          Add Measurement Points to define the exact test values
                          and tolerances for each UUT.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {sidebarData.map((fnGroup) => {
                    const isFnExpanded = expandedFunctions.has(fnGroup.id);
                    // The Unassigned bucket renders its points directly under the
                    // function header (no real UUT to nest under).
                    if (fnGroup.isUnassigned) {
                      const pts = sortSidebarPoints(
                        fnGroup.uutGroups[0]?.points || [],
                      );
                      return (
                        <div
                          key={fnGroup.id}
                          className="measurement-group-container"
                        >
                          <div className="area-header-sticky">
                            <button
                              type="button"
                              className="function-sidebar-collapse-button"
                              onClick={(e) => toggleFunctionExpand(e, fnGroup.id)}
                              title={isFnExpanded ? "Collapse function" : "Expand function"}
                              aria-label={isFnExpanded ? "Collapse function" : "Expand function"}
                              aria-expanded={isFnExpanded}
                            >
                              <FontAwesomeIcon
                                icon={isFnExpanded ? faChevronDown : faChevronRight}
                              />
                            </button>
                            <FontAwesomeIcon
                              icon={faLayerGroup}
                              style={{ opacity: 0.6 }}
                              size="sm"
                            />
                            <span className="area-label">{fnGroup.name}</span>
                          </div>
                          {isFnExpanded && (
                            <div className="tree-branch">
                              <div className="sidebar-points-scroll-wrapper">
                                {renderSidebarColumnHeaders()}
                                {pts.map((tp, index) =>
                                  renderSidebarPointRow(tp, fnGroup, pts[index - 1] || null),
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={fnGroup.id}
                        className="measurement-group-container"
                      >
                        <div className="area-header-sticky">
                          <button
                            type="button"
                            className="function-sidebar-collapse-button"
                            onClick={(e) => toggleFunctionExpand(e, fnGroup.id)}
                            title={isFnExpanded ? "Collapse function" : "Expand function"}
                            aria-label={isFnExpanded ? "Collapse function" : "Expand function"}
                            aria-expanded={isFnExpanded}
                          >
                            <FontAwesomeIcon
                              icon={isFnExpanded ? faChevronDown : faChevronRight}
                            />
                          </button>
                          <FontAwesomeIcon
                            icon={faCube}
                            style={{
                              color:
                                fnGroup.color || "var(--primary-color)",
                              opacity: 0.7,
                            }}
                            size="sm"
                          />
                          <span
                            className="area-label"
                            style={{
                              color:
                                fnGroup.color || "var(--primary-color)",
                            }}
                          >
                            {fnGroup.name}
                          </span>
                          {renderFunctionPointActions(fnGroup)}
                        </div>

                        {isFnExpanded && (
                          <div className="tree-branch">
                            <div className="sidebar-points-scroll-wrapper">
                              {renderSidebarColumnHeaders()}
                              {(() => {
                                const points = sortSidebarPoints(fnGroup.points || []);
                                if (points.length === 0) {
                                  return fnGroup.uutGroups.map((group) =>
                                    renderEmptySidebarUutRow(group, fnGroup),
                                  );
                                }
                                return points.map((tp, index) =>
                                  renderSidebarPointRow(
                                    tp,
                                    fnGroup,
                                    points[index - 1] || null,
                                  ),
                                );
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </aside>

            <main className="results-content">
              {displayData ? (
                <TestPointDetailView
                  key={displayData.id || `view-${displayData.viewMode}`}
                  testPointData={displayData}
                >
                  <Analysis
                    sessionData={currentSessionData}
                    testPointData={displayData}
                    onDataSave={handleAnalysisDataSave}
                    onApplyToSessionPoints={handleApplyToSessionPoints}
                    onSessionSave={updateSession}
                    onNotesSave={updateSessionNotes}
                    sessionImageCache={sessionImageCache}
                    onSessionImageCacheChange={setSessionImageCache}
                    onLoadSessionImages={loadSessionImages}
                    onSaveTestPoint={handleSaveTestPoint}
                    defaultTestPoint={defaultTestPoint}
                    setContextMenu={setContextMenu}
                    setBreakdownPoint={setBreakdownPoint}
                    handleOpenSessionEditor={handleOpenSessionEditor}
                    riskResults={riskResults}
                    setRiskResults={setRiskResults}
                    pendingRiskBreakdown={pendingRiskBreakdown}
                    onConsumePendingRiskBreakdown={() =>
                      setPendingRiskBreakdown(null)
                    }
                    onDeleteTmdeDefinition={handleDeleteTmdeDefinition}
                    onDecrementTmdeQuantity={decrementTmdeQuantity}
                    onDeleteUut={handleDeleteUut}
                    instruments={instruments}
                    onSaveInstrument={saveInstrument}
                    onInstrumentSynced={reconcileSyncedInstrument}
                    customEquations={customEquations}
                    onSaveCustomEquation={saveCustomEquation}
                    onDeleteCustomEquation={deleteCustomEquation}
                    onDeleteTestPoint={handleDeleteTestPoint}
                    currentUutSelection={currentUutSelection}
                    setCurrentUutSelection={setCurrentUutSelection}
                    activeRangeIndices={activeRangeIndices}
                    onRangeSelectionChange={setActiveRangeIndices}
                    selectedTablePointIds={selectedTablePointIds}
                    setSelectedTablePointIds={setSelectedTablePointIds}
                    preferredAnalysisMode={analysisMode}
                    onAnalysisModeChange={handleAnalysisModeChange}
                    preferredShowContribution={showContribution}
                    onShowContributionChange={setShowContribution}
                    collapsedFunctionKeys={collapsedInstrumentFunctionKeys}
                    setCollapsedFunctionKeys={setCollapsedInstrumentFunctionKeys}
                    keyboardShortcutsEnabled={!isInstrumentBuilderOpen}
                    scrollPositionsRef={analysisScrollPositionsRef}
                    onSelectUut={handleSelectUut}
                    onSelectTestPoint={handleSelectTestPoint}
                    onDefineTestPoint={handleAddNewTestPoint}
                  />
                </TestPointDetailView>
              ) : (
                <div className="placeholder-content">
                  {currentSessionData ? (
                    <>
                      <h3>No measurement point selected.</h3>
                      <p>
                        Select a UUT Range or Measurement Area from the sidebar.
                      </p>
                      <button
                        className="button primary"
                        onClick={() => handleAddNewTestPoint()}
                      >
                        <FontAwesomeIcon icon={faPlus} /> Add New Point
                      </button>
                    </>
                  ) : (
                    <>
                      <h3>No Session Available</h3>
                      <p>Create a new session to begin your analysis.</p>
                    </>
                  )}
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </ThemeContext.Provider>
  );
}

export default App;
