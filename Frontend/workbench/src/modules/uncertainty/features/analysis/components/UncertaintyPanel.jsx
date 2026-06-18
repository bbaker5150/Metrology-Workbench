/**
 * src/features/analysis/components/UncertaintyPanel.jsx
 */
import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import ReactDOM from "react-dom";
import Select from "react-select";
import * as math from "mathjs";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faTrashAlt,
  faExclamationTriangle,
  faCheckCircle,
  faTimesCircle,
  faMicroscope,
  faCube,
  faArrowRight,
  faRulerCombined,
  faTools,
  faBookOpen,
} from "@fortawesome/free-solid-svg-icons";
import { formatRangeLabel } from "../../../utils/rangeFormatting";
import { getNextInstrumentSelection } from "../../../utils/instrumentSelection";
import {
  assessRangeCompatibility,
  assessTmdeCompatibility,
} from "../../../utils/tmdeCompatibility";
import { resolvePointAreaId } from "../../../utils/areaWorkspace";

// --- Constants ---
const customUnitSelectStyles = {
  control: (provided) => ({
    ...provided,
    minHeight: "30px",
    height: "30px",
    fontSize: "0.85rem",
    backgroundColor: "var(--input-background)",
    borderColor: "var(--border-color)",
    color: "var(--text-color)",
    boxShadow: "none",
    "&:hover": {
      borderColor: "var(--primary-color)",
    },
  }),
  menu: (provided) => ({
    ...provided,
    zIndex: 9999,
    backgroundColor: "var(--header-background)",
    border: "1px solid var(--border-color)",
    boxShadow: "var(--box-shadow-glow)",
  }),
  singleValue: (provided) => ({
    ...provided,
    color: "var(--text-color)",
  }),
  input: (provided) => ({
    ...provided,
    color: "var(--text-color)",
  }),
  option: (provided, state) => ({
    ...provided,
    backgroundColor: state.isSelected
      ? "var(--primary-color)"
      : state.isFocused
        ? "var(--primary-color-light)"
        : "transparent",
    color: state.isSelected ? "#ffffff" : "var(--text-color)",
    cursor: "pointer",
    fontSize: "0.85rem",
  }),
};

// Shared, engine-verified f(x) symbol catalog (see utils/equationSymbols.js).
import { symbolCategories } from "../../../utils/equationSymbols";

// Sub-components
import UncertaintyBudgetTable from "./UncertaintyBudgetTable";
import PercentageBarGraph from "./ContributionPlot";
import MonteCarloCard from "./MonteCarloCard";
import EquationLibraryMenu from "./EquationLibraryMenu";
import {
  validateEquation,
  stripEquationPrefix,
} from "../../../utils/equationValidation";

// Utils
import {
  getToleranceSummary,
  getToleranceErrorSummary,
  getAbsoluteLimits,
  calculateUncertaintyFromToleranceObject,
  convertPpmToUnit,
  getUnitDisplayLabel,
  unitSystem,
  unitCategories,
  errorDistributions,
} from "../../../utils/uncertaintyMath";
import { oldErrorDistributions } from "../utils/budgetUtils";

const SymbolButton = ({ symbol, title, onSymbolClick }) => (
  <button
    type="button"
    className="add-point-symbol-button"
    title={title || `Insert ${symbol}`}
    onClick={() => onSymbolClick(symbol)}
  >
    {symbol.replace("()", "( )")}
  </button>
);

const handleRowSelection = (e, id, setSelected) => {
  setSelected((prev) =>
    getNextInstrumentSelection(prev, id, e.ctrlKey || e.metaKey),
  );
};

// --- HELPER: Decompose Tolerance into a compact single-line spec ---
// A multi-component spec is ONE ± uncertainty made of several terms, so it is
// rendered on a single line as e.g. "±(2% iv + 0.1% fs + 0.5 V)" rather than
// stacked rows (which waste vertical space and imply the terms are separate or
// apply to different ranges). "iv" = indicated value, "fs" = full scale; the
// absolute Floor term carries just its unit. Asymmetric components can't be
// represented by a single ± wrapper, so those fall back to explicit per-term
// rows. Returns an array of lines (usually length 1) — the table renders the
// first line in the spec cell and any extras as spanned rows.
const getSpecRows = (tolerance) => {
  if (!tolerance) return ["-"];

  // Explicit sub-components (recursion): one combined line per sub-tolerance.
  if (Array.isArray(tolerance.tolerances) && tolerance.tolerances.length > 0) {
    const rows = [];
    tolerance.tolerances.forEach((t) => rows.push(...getSpecRows(t)));
    return rows;
  }

  // Components in display order, each with its abbreviation tag. Floor and dB
  // carry no tag (Floor is a bare absolute value; dB's unit is shown inline).
  const componentConfig = [
    { key: "reading", tag: "iv" },
    { key: "range", tag: "fs" },
    { key: "floor", tag: "" },
    { key: "readings_iv", tag: "" }, // legacy raw indicated value == a Floor
    { key: "offset", tag: "offset" },
    { key: "linearity", tag: "lin" },
    { key: "db", tag: "", unit: "dB" },
  ];

  const parseComp = (part, unitOverride) => {
    if (!part) return null;
    const hasHL =
      !isNaN(parseFloat(part.high)) || !isNaN(parseFloat(part.low));
    const hasVal = !isNaN(parseFloat(part.value));
    if (!hasHL && !hasVal) return null;

    const unit = unitOverride || part.unit || "";
    // Legacy "± value" shape (no high/low).
    if (part.high === undefined && hasVal) {
      return { mag: Math.abs(parseFloat(part.value)), symmetric: true, unit };
    }
    const high = parseFloat(part.high || 0);
    const low = parseFloat(part.low || -high);
    return {
      mag: Math.abs(high),
      symmetric: Math.abs(high + low) < 1e-9,
      high,
      low,
      unit,
    };
  };

  const termText = (comp, tag) => {
    const unitLabel = getUnitDisplayLabel(comp.unit || "");
    // No space before "%"; a space before any worded/physical unit.
    const join = unitLabel === "%" || unitLabel === "" ? "" : " ";
    const base = `${comp.mag}${join}${unitLabel}`.trim();
    return tag ? `${base} ${tag}` : base;
  };

  const present = [];
  let anyAsymmetric = false;
  for (const cfg of componentConfig) {
    const comp = parseComp(tolerance[cfg.key], cfg.unit);
    if (!comp) continue;
    present.push({ comp, cfg });
    if (!comp.symmetric) anyAsymmetric = true;
  }

  if (present.length === 0) return [getToleranceSummary(tolerance)];

  if (!anyAsymmetric) {
    if (present.length === 1) {
      return [`± ${termText(present[0].comp, present[0].cfg.tag)}`];
    }
    const inner = present
      .map((p) => termText(p.comp, p.cfg.tag))
      .join(" + ");
    return [`±(${inner})`];
  }

  // Asymmetric fallback: explicit per-component rows with a descriptive suffix.
  const suffixMap = {
    reading: "of Indicated Value",
    range: "of Full Scale",
    floor: "Floor Value",
    readings_iv: "Floor Value",
    offset: "Offset",
    linearity: "Linearity",
    db: "dB",
  };
  const formatPart = (part, suffix = "") => {
    if (part.high === undefined && part.value !== undefined) {
      return `± ${part.value} ${getUnitDisplayLabel(part.unit || "")} ${suffix}`.trim();
    }
    const high = parseFloat(part.high || 0);
    const low = parseFloat(part.low || -high);
    const unit = getUnitDisplayLabel(part.unit || "");
    const valStr =
      Math.abs(high + low) < 1e-9 && high > 0 ? `± ${high}` : `+${high}/${low}`;
    return `${valStr} ${unit} ${suffix}`.trim();
  };
  return present.map((p) => formatPart(tolerance[p.cfg.key], suffixMap[p.cfg.key]));
};

// --- SHARED HELPER: Resolve UUT Range ---
const resolveUutRangeHelper = (
  uut,
  activeRangeIndices,
  savedTolerance,
  uutNominal,
) => {
  // 1. Normalize Ranges
  let allRanges = [];
  if (Array.isArray(uut.ranges) && uut.ranges.length > 0) {
    allRanges = uut.ranges.map((r) => ({
      ...r,
      ...(r.tolerances || r.tolerance || {}),
    }));
  } else if (
    Array.isArray(uut.instrument?.functions) &&
    uut.instrument.functions.length > 0
  ) {
    allRanges = uut.instrument.functions.flatMap((fn) =>
      (fn.ranges || []).map((r) => ({
        ...r,
        ...(r.tolerances || {}),
        functionName: fn.name,
        unit: fn.unit || r.unit,
      })),
    );
  } else if (
    Array.isArray(uut.instrument?.ranges) &&
    uut.instrument.ranges.length > 0
  ) {
    allRanges = uut.instrument.ranges.map((r) => ({
      ...r,
      ...(r.tolerances || {}),
    }));
  } else {
    const baseTolerance = uut.tolerance || uut.instrument?.tolerance || {};
    allRanges = [{ id: "default", range: "Default", ...baseTolerance }];
  }
  allRanges = allRanges.map((r, i) => ({ ...r, _index: i }));

  // 2. Determine Active Index in the complete range list.
  let activeIndex = -1;

  // Priority A: Manual Selection (UI State)
  if (activeRangeIndices && activeRangeIndices[uut.id] !== undefined) {
    const uiIndex = activeRangeIndices[uut.id];
    if (allRanges[uiIndex]) {
      activeIndex = uiIndex;
    }
  }

  // Priority B: Saved Tolerance (Robust Match)
  if (activeIndex === -1 && savedTolerance) {
    activeIndex = allRanges.findIndex((r) => {
      // ID Match (Best)
      if (r.id && savedTolerance.id && r.id === savedTolerance.id) return true;

      // Name Match
      if (savedTolerance.range && r.range && savedTolerance.range === r.range) {
        return savedTolerance.functionName
          ? savedTolerance.functionName === r.functionName
          : true;
      }

      // Props Match (Fallback)
      const minMatch = r.min == savedTolerance.min;
      const maxMatch = r.max == savedTolerance.max;
      const unitMatch = (r.unit || "") === (savedTolerance.unit || "");
      const funcMatch = r.functionName === savedTolerance.functionName; // strict function name

      // Looser function match if one is missing? No, stay strict.
      return (
        minMatch && maxMatch && unitMatch && (!r.functionName || funcMatch)
      );
    });
  }

  // Priority C: First compatible range for the current point.
  if (activeIndex === -1 && uutNominal?.unit) {
    activeIndex = allRanges.findIndex(
      (range) =>
        assessRangeCompatibility(range, uutNominal, "UUT range").compatible,
    );
  }

  // Priority D: Default (First Item)
  if (activeIndex === -1) {
    activeIndex = 0;
  }

  return {
    ranges: allRanges,
    activeIndex: activeIndex,
    activeRange: allRanges[activeIndex] || {},
  };
};

// --- SHARED HELPER: Calculate Tolerance & Limits (Core Logic) ---
const calculateToleranceMetrics = (activeTolerance, nominalObj) => {
  const nominalVal = parseFloat(nominalObj?.value);

  if (!activeTolerance || Object.keys(activeTolerance).length === 0) {
    return {
      numericTolerance: null,
      limits: { low: "-", high: "-" },
      display: "No Range / Spec",
    };
  }

  if (isNaN(nominalVal)) {
    return {
      numericTolerance: null,
      limits: { low: "-", high: "-" },
      display: "No Value",
    };
  }

  // 1. Try Meticulous Calculation (Complex Objects: Reading + Floor)
  const getComponentValue = (comp) => {
    if (comp === undefined || comp === null) return 0;
    if (typeof comp === "object") {
      const valStr = comp.high || comp.value || comp.tolerance;
      const parsed = parseFloat(valStr);
      return isNaN(parsed) ? 0 : parsed;
    }
    const parsed = parseFloat(comp);
    return isNaN(parsed) ? 0 : parsed;
  };

  let total = 0;
  let found = false;

  // Reading
  const readingComp =
    activeTolerance.reading || activeTolerance.tolerances?.reading;
  if (readingComp) {
    const readingPcn = getComponentValue(readingComp);
    if (readingPcn !== 0) {
      total += Math.abs(nominalVal * (readingPcn / 100));
      found = true;
    }
  }

  // Floor
  const floorComp = activeTolerance.floor || activeTolerance.tolerances?.floor;
  if (floorComp) {
    const floorVal = getComponentValue(floorComp);
    if (floorVal !== 0) {
      total += Math.abs(floorVal);
      found = true;
    }
  }

  // Generic (Single Value)
  if (!found && (activeTolerance.tolerance || activeTolerance.value)) {
    const tolVal = getComponentValue(activeTolerance);
    if (tolVal !== 0) {
      total += Math.abs(tolVal);
      found = true;
    }
  }

  // Range (% of Full Scale) - FIX
  const rangeComp =
    activeTolerance.tolerances?.range ||
    (typeof activeTolerance.range === "object" ? activeTolerance.range : null);
  if (rangeComp) {
    const rangePcn = getComponentValue(rangeComp);

    // FIX: Prioritize explicit "Range Value" (Manual FS) over "Range Max"
    const manualFS = parseFloat(rangeComp.value);
    const rangeMax = parseFloat(activeTolerance.max);
    const fs = !isNaN(manualFS) ? manualFS : rangeMax;

    if (rangePcn !== 0 && !isNaN(fs)) {
      // Basic % of Range calculation
      total += Math.abs(fs * (rangePcn / 100));
      found = true;
    }
  }

  let numericTolerance = null;

  if (found) {
    numericTolerance = total;
  } else {
    // 2. Fallback: Parse Standard Utility String
    const utilResult = getToleranceErrorSummary(activeTolerance, nominalObj);
    if (
      utilResult &&
      utilResult !== "Not Calculated" &&
      utilResult !== "± -" &&
      !utilResult.includes("NaN")
    ) {
      const match = utilResult.match(/±\s*([\d.]+)/);
      if (match && match[1]) {
        numericTolerance = parseFloat(match[1]);
      }
    }
  }

  // Format Results
  if (numericTolerance !== null) {
    const low = nominalVal - numericTolerance;
    const high = nominalVal + numericTolerance;
    return {
      numericTolerance,
      limits: { low: low.toPrecision(6), high: high.toPrecision(6) },
      display: `± ${Number(numericTolerance.toPrecision(4))} ${nominalObj?.unit || ""}`,
    };
  }

  return {
    numericTolerance: null,
    limits: { low: "-", high: "-" },
    display: "No Range / Spec",
  };
};

// --- HELPERS FOR EQUATION EDITOR ---

// --- RE-INSERTED EDITABLE CELL COMPONENT ---
const EditableCell = ({
  value,
  onSave,
  type = "text",
  suffix = "",
  style = {},
  placeholder = "",
  className = "",
}) => {
  const [isEditing, setIsEditing] = useState(false);

  // FIX: Default to "" if value is null/undefined
  const [currentValue, setCurrentValue] = useState(value ?? "");

  // FIX: Update effect to also handle null/undefined
  useEffect(() => {
    setCurrentValue(value ?? "");
  }, [value]);

  const handleBlur = () => {
    setIsEditing(false);
    const cleanVal =
      typeof currentValue === "string" ? currentValue.trim() : currentValue;
    if (cleanVal != value) {
      onSave(cleanVal);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleBlur();
    }
  };

  if (isEditing) {
    return (
      <input
        autoFocus
        type={type}
        // FIX: Ensure value is never undefined in the input tag
        value={currentValue ?? ""}
        onChange={(e) => setCurrentValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        style={{
          width: "100%",
          padding: "4px",
          boxSizing: "border-box",
          ...style,
        }}
      />
    );
  }
  return (
    <div
      onClick={() => setIsEditing(true)}
      style={{
        cursor: "text",
        minHeight: "20px",
        borderBottom: "1px dashed var(--border-color)",
        paddingBottom: "2px",
        color: !value && placeholder ? "var(--text-color-muted)" : "inherit",
        ...style,
      }}
      className={`editable-cell-display ${className}`}
      title="Click to edit"
    >
      {value || placeholder} {suffix}
    </div>
  );
};

// ---  Inline Quick Add Row Component ---
const QuickAddRow = ({
  selectedUuts,
  localRangeIndices,
  resolveRangeHelper,
  onSave,
  showAreaColumn,
  sessionData,
  // NEW PROPS
  viewMode,
  rangeData,
  contextId, // usually the UUT ID in range view
  hoveredCell,
  setHoveredCell,
}) => {
  // Local state for the inputs
  const [val, setVal] = useState("");
  const [unit, setUnit] = useState("");
  const [section, setSection] = useState("");

  // Determine effective selection based on View Mode
  const effectiveSelectedUuts = useMemo(() => {
    if (viewMode === "range" && contextId) {
      const uut = sessionData.uuts.find((u) => u.id === contextId);
      return uut ? [uut] : [];
    }
    return selectedUuts;
  }, [viewMode, contextId, selectedUuts, sessionData.uuts]);

  const isDisabled = effectiveSelectedUuts.length === 0;

  // Auto-detect unit from selected UUT when selection changes
  useEffect(() => {
    if (effectiveSelectedUuts.length > 0) {
      const primaryUut = effectiveSelectedUuts[0];

      // If in Range View, use the specific range passed down
      if (viewMode === "range" && rangeData?.unit) {
        if (!unit) setTimeout(() => setUnit(rangeData.unit), 0);
      }
      // Otherwise resolve normally
      else {
        const { activeRange } = resolveRangeHelper(
          primaryUut,
          localRangeIndices,
          null,
          null,
        );
        if (activeRange?.unit && !unit) {
          setTimeout(() => setUnit(activeRange.unit), 0);
        }
      }
    }
  }, [
    effectiveSelectedUuts,
    localRangeIndices,
    resolveRangeHelper,
    unit,
    viewMode,
    rangeData,
  ]);

  // Real-time Preview Calculation
  const previewMetrics = useMemo(() => {
    if (!val) return { display: "-", limits: { low: "-", high: "-" } };

    let activeTolerance = {};

    // If in Range View, FORCE the specific range
    if (viewMode === "range" && rangeData) {
      activeTolerance = rangeData;
    }
    // Otherwise use selection logic
    else if (effectiveSelectedUuts.length > 0) {
      const primaryUut = effectiveSelectedUuts[0];
      const nominalObj = { value: val, unit: unit };
      const { activeRange } = resolveRangeHelper(
        primaryUut,
        localRangeIndices,
        null,
        nominalObj,
      );
      activeTolerance = activeRange || {};
    }

    // Calculate limits
    return calculateToleranceMetrics(activeTolerance, {
      value: val,
      unit: unit,
    });
  }, [
    val,
    unit,
    effectiveSelectedUuts,
    localRangeIndices,
    resolveRangeHelper,
    viewMode,
    rangeData,
  ]);

  const handleSave = () => {
    if (!val || !unit) return;

    // Determine Measurement Area ID (Robust Lookup)
    let areaId = null;
    if (effectiveSelectedUuts.length > 0) {
      const primaryUut = effectiveSelectedUuts[0];
      if (primaryUut.measurementAreaId) {
        areaId = primaryUut.measurementAreaId;
      } else if (primaryUut.measurementArea && sessionData?.measurementAreas) {
        const matchedArea = sessionData.measurementAreas.find(
          (a) => a.name === primaryUut.measurementArea,
        );
        if (matchedArea) areaId = matchedArea.id;
      }
    }

    // Construct payload
    const newPoint = {
      section: section,
      measurementType: "direct",
      testPointInfo: {
        parameter: { name: "Measurement", value: val, unit: unit },
      },
      associatedUutIds: effectiveSelectedUuts.map((u) => u.id),
      measurementAreaId: areaId,
    };

    // CRITICAL FIX: If in Range View, inject the specific tolerance
    if (viewMode === "range" && rangeData) {
      newPoint.uutTolerance = rangeData;
    }

    onSave(newPoint);
    setVal("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSave();
  };

  return (
    <tr
      style={{
        borderBottom: "1px solid var(--border-color)",
        backgroundColor: "var(--background-secondary)",
        transition: "background-color 0.2s ease",
      }}
    >
      <td
        className={`cell-section ${hoveredCell?.tableId === "points" && hoveredCell?.colIndex === 0 ? "col-hovered" : ""}`}
        onMouseEnter={() =>
          setHoveredCell && setHoveredCell({ tableId: "points", colIndex: 0 })
        }
        style={{ padding: "4px 8px" }}
      >
        <input
          type="text"
          placeholder="Section"
          value={section}
          onChange={(e) => setSection(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
          className="quick-add-input organic-input"
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            padding: "6px 0",
            fontSize: "0.9rem",
            color: "var(--text-color)",
            outline: "none",
            borderBottom: "1px solid transparent",
            transition: "border-color 0.2s",
          }}
          onFocus={(e) =>
            (e.target.style.borderBottom = "1px solid var(--primary-color)")
          }
          onBlur={(e) =>
            (e.target.style.borderBottom = "1px solid transparent")
          }
        />
      </td>
      <td
        className={`cell-value ${hoveredCell?.tableId === "points" && hoveredCell?.colIndex === 1 ? "col-hovered" : ""}`}
        onMouseEnter={() =>
          setHoveredCell && setHoveredCell({ tableId: "points", colIndex: 1 })
        }
        style={{ padding: "4px 8px" }}
      >
        <input
          type="text"
          placeholder={isDisabled ? "Select UUT..." : "Value..."}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
          className="quick-add-input organic-input"
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            padding: "6px 0",
            fontSize: "0.9rem",
            fontWeight: 600,
            color: "var(--primary-color)",
            outline: "none",
            borderBottom: "1px solid transparent",
            transition: "border-color 0.2s",
          }}
          onFocus={(e) =>
            (e.target.style.borderBottom = "1px solid var(--primary-color)")
          }
          onBlur={(e) =>
            (e.target.style.borderBottom = "1px solid transparent")
          }
        />
      </td>
      <td
        className={`cell-unit ${hoveredCell?.tableId === "points" && hoveredCell?.colIndex === 2 ? "col-hovered" : ""}`}
        onMouseEnter={() =>
          setHoveredCell && setHoveredCell({ tableId: "points", colIndex: 2 })
        }
        style={{ padding: "4px 8px" }}
      >
        <input
          type="text"
          placeholder="Unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
          className="quick-add-input organic-input"
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            padding: "6px 0",
            fontSize: "0.9rem",
            color: "var(--text-color-muted)",
            outline: "none",
            borderBottom: "1px solid transparent",
            transition: "border-color 0.2s",
          }}
          onFocus={(e) =>
            (e.target.style.borderBottom = "1px solid var(--primary-color)")
          }
          onBlur={(e) =>
            (e.target.style.borderBottom = "1px solid transparent")
          }
        />
      </td>
      {/* Live Preview Columns */}
      <td
        className={`cell-tolerance ${hoveredCell?.tableId === "points" && hoveredCell?.colIndex === 3 ? "col-hovered" : ""}`}
        onMouseEnter={() =>
          setHoveredCell && setHoveredCell({ tableId: "points", colIndex: 3 })
        }
        style={{
          padding: "4px 8px",
          verticalAlign: "middle",
          fontSize: "0.85rem",
          fontStyle: "italic",
          color: "var(--text-color-muted)",
        }}
      >
        {previewMetrics.display}
      </td>
      <td
        className={`cell-limit ${hoveredCell?.tableId === "points" && hoveredCell?.colIndex === 4 ? "col-hovered" : ""}`}
        onMouseEnter={() =>
          setHoveredCell && setHoveredCell({ tableId: "points", colIndex: 4 })
        }
        style={{
          padding: "4px 8px",
          verticalAlign: "middle",
          fontSize: "0.85rem",
          color: "var(--text-color-muted)",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>
            {previewMetrics.limits.low !== "-" ? (
              <>
                <span style={{ opacity: 0.7 }}>
                  {previewMetrics.limits.low}
                </span>
                <span style={{ margin: "0 4px", fontSize: "0.75rem" }}>→</span>
                <span style={{ opacity: 0.7 }}>
                  {previewMetrics.limits.high}
                </span>
              </>
            ) : (
              "-"
            )}
          </span>
          {!showAreaColumn && !isDisabled && val && (
            <button
              onClick={handleSave}
              className="btn-icon-only"
              style={{
                color: "var(--primary-color)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                marginLeft: "8px",
              }}
            >
              <FontAwesomeIcon icon={faArrowRight} />
            </button>
          )}
        </div>
      </td>
      {showAreaColumn && (
        <td className="cell-area">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span></span>
            {!isDisabled && val && (
              <button
                onClick={handleSave}
                className="btn-icon-only"
                style={{
                  color: "var(--primary-color)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <FontAwesomeIcon icon={faArrowRight} />
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
};

// --- UPDATED: SUMMARY DASHBOARD ---
const SummaryDashboard = ({
  viewMode,
  contextId,
  sessionData,
  onDeleteTestPoint,
  rangeData,
  uutId,
  onSaveTestPoint,
  onEditSession,
  selectedPointIds,
  setSelectedPointIds,
  onSelectUut,
  onSelectTestPoint,
  // NEW PROPS PASSED DOWN FROM APP/ANALYSIS
  onDeleteUut,
  onDeleteTmdeDefinition,
  onEditUut,
  onAddTmde,
  onEditTmde,
  // Global UUT Selection (synced with sidebar Quick Add)
  currentUutSelection = [],
  setCurrentUutSelection,
}) => {
  // --- SELECTION STATE ---
  // Use global UUT selection for sync with sidebar Quick Add
  const selectedUutIds = currentUutSelection || [];
  const setSelectedUutIds = setCurrentUutSelection || (() => {});
  const [selectedTmdeIds, setSelectedTmdeIds] = useState([]);

  const [localRangeIndices, setLocalRangeIndices] = useState({});
  const [tmdeRangeIndices, setTmdeRangeIndices] = useState({});

  // Industry Grade Highlighting State
  const [hoveredCell, setHoveredCell] = useState({
    tableId: null,
    colIndex: null,
  });
  const [hoveredRowId, setHoveredRowId] = useState(null);

  // Filter Data based on Hierarchy
  const {
    filteredUuts,
    filteredPoints,
    filteredTmdes,
    title,
    subtitle,
    showAreaColumn,
  } = useMemo(() => {
    let uuts = sessionData.uuts || [];
    let points = sessionData.testPoints || [];
    let tmdes = sessionData.tmdes || [];
    let displayTitle = "Session Overview";
    let displaySubtitle = "All Measurement Areas";

    const isSessionView = viewMode === "session";

    if (viewMode === "area") {
      const area = sessionData.measurementAreas?.find(
        (a) => a.id === contextId,
      );
      displayTitle = area?.name || "Measurement Area";
      displaySubtitle = "Area Summary";
      uuts = uuts.filter((u) => {
        const idMatch = u.measurementAreaId === contextId;
        const nameMatch =
          area && u.measurementArea && u.measurementArea === area.name;
        return idMatch || nameMatch;
      });
      points = points.filter((tp) => tp.measurementAreaId === contextId);
      tmdes = tmdes.filter((tmde) => {
        if (tmde.measurementAreaId) {
          return tmde.measurementAreaId === contextId;
        }
        if (area?.name && tmde.measurementArea === area.name) {
          return true;
        }

        const inferredAreaIds = new Set(
          (sessionData.testPoints || [])
            .filter((point) =>
              (point.tmdeTolerances || []).some(
                (instance) =>
                  instance.id === tmde.id || instance.sourceId === tmde.id,
              ),
            )
            .map((point) => point.measurementAreaId)
            .filter(Boolean),
        );
        return inferredAreaIds.size === 0 || inferredAreaIds.has(contextId);
      });
    } else if (viewMode === "uut") {
      const uut = uuts.find((u) => u.id === contextId);
      displayTitle = uut?.description || "UUT Detail";
      displaySubtitle = `${uut?.manufacturer || ""} ${uut?.model || ""}`;
      uuts = uut ? [uut] : [];
      points = points.filter(
        (tp) => tp.associatedUutIds && tp.associatedUutIds.includes(contextId),
      );
    } else if (viewMode === "range") {
      const uut = uuts.find((u) => u.id === uutId);
      uuts = uut ? [uut] : [];
      points = points.filter((tp) => {
        if (!tp.associatedUutIds || !tp.associatedUutIds.includes(uutId))
          return false;
        const ptTol = tp.uutTolerance;
        if (!ptTol) return false;
        if (rangeData._id !== undefined && ptTol._id !== undefined) {
          if (rangeData._id === ptTol._id) return true;
        }
        const minMatch = ptTol.min == rangeData.min;
        const maxMatch = ptTol.max == rangeData.max;
        const unitMatch = (ptTol.unit || "") === (rangeData.unit || "");
        const funcMatch = rangeData.functionName
          ? ptTol.functionName === rangeData.functionName
          : true;
        return minMatch && maxMatch && unitMatch && funcMatch;
      });
      displayTitle = rangeData.label || "Range Detail";
      displaySubtitle = `${uut?.description || "UUT"} (${uut?.model || ""})`;
    }

    return {
      filteredUuts: uuts,
      filteredPoints: points,
      filteredTmdes: tmdes,
      title: displayTitle,
      subtitle: displaySubtitle,
      showAreaColumn: isSessionView,
    };
  }, [viewMode, contextId, sessionData, rangeData, uutId]);

  // --- HANDLERS ---

  // Selection Handlers (Wrapped)
  // Selection Handlers (Wrapped)
  const handleUutClick = (e, id) =>
    handleRowSelection(e, id, setSelectedUutIds);
  const handleTmdeClick = (e, id) =>
    handleRowSelection(e, id, setSelectedTmdeIds);

  // NEW: Batch Delete for UUTs
  const handleDeleteSelectedUuts = useCallback(() => {
    if (onDeleteUut && selectedUutIds.length > 0) {
      onDeleteUut(selectedUutIds);
      setSelectedUutIds([]);
    }
  }, [onDeleteUut, selectedUutIds]);

  // NEW: Batch Delete for TMDEs
  const handleDeleteSelectedTmdes = useCallback(() => {
    if (onDeleteTmdeDefinition && selectedTmdeIds.length > 0) {
      onDeleteTmdeDefinition(selectedTmdeIds);
      setSelectedTmdeIds([]);
    }
  }, [onDeleteTmdeDefinition, selectedTmdeIds]);

  // Keyboard Listener for Delete
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        // Determine context based on what is selected
        if (
          document.activeElement.tagName !== "INPUT" &&
          document.activeElement.tagName !== "TEXTAREA"
        ) {
          if (selectedUutIds.length > 0) {
            e.preventDefault();
            handleDeleteSelectedUuts();
          } else if (selectedTmdeIds.length > 0) {
            e.preventDefault();
            handleDeleteSelectedTmdes();
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedUutIds,
    selectedTmdeIds,
    handleDeleteSelectedUuts,
    handleDeleteSelectedTmdes,
  ]);

  const resolveRangeWrapper = (uut, indices, savedTol, nominal) => {
    return resolveUutRangeHelper(uut, indices, savedTol, nominal);
  };

  return (
    <div className="configuration-panel">
      {/* Header */}
      <div
        style={{
          paddingBottom: "10px",
          borderBottom: "1px solid var(--border-color)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1.3rem" }}>
          {viewMode === "range" && (
            <FontAwesomeIcon
              icon={faRulerCombined}
              style={{ marginRight: "10px", color: "var(--primary-color)" }}
            />
          )}
          {title}
        </h2>
        <div
          style={{
            color: "var(--text-color-muted)",
            fontSize: "0.85rem",
            marginTop: "4px",
          }}
        >
          {subtitle}
        </div>
      </div>

      {/* UUT TABLE */}
      <div className="panel-card">
        <div className="panel-card-header">
          <div className="panel-card-title">
            <FontAwesomeIcon icon={faMicroscope} />
            <span>Units Under Test ({filteredUuts.length})</span>
          </div>
          <div className="panel-card-actions">
            {selectedUutIds.length > 0 && (
              <button
                className="btn-delete-selection"
                onClick={handleDeleteSelectedUuts}
                title={`Delete ${selectedUutIds.length} Selected UUTs`}
              >
                <FontAwesomeIcon icon={faTrashAlt} size="xs" />
              </button>
            )}
            <button
              className="btn-add-item"
              onClick={() => onEditUut && onEditUut(null)}
              title="Add New UUT"
            >
              <FontAwesomeIcon icon={faPlus} size="xs" />
            </button>
          </div>
        </div>
        <div className="panel-table-container">
          <table
            className="instrument-summary-table industry-table"
            onMouseLeave={() => {
              setHoveredCell({ tableId: null, colIndex: null });
              setHoveredRowId(null);
            }}
            style={{ tableLayout: "fixed" }}
          >
            <colgroup>
              <col style={{ width: showAreaColumn ? "34%" : "42%" }} />
              <col style={{ width: showAreaColumn ? "26%" : "30%" }} />
              <col style={{ width: showAreaColumn ? "25%" : "28%" }} />
              {showAreaColumn && <col style={{ width: "15%" }} />}
            </colgroup>
            <thead>
              <tr>
                <th>Description</th>
                <th>Range</th>
                <th>Tolerance</th>
                {showAreaColumn && <th>Area</th>}
              </tr>
            </thead>
            <tbody>
              {filteredUuts.length === 0 ? (
                <tr className="panel-empty-row">
                  <td colSpan={showAreaColumn ? 4 : 3}>
                    No UUTs found in this context.
                  </td>
                </tr>
              ) : (
                filteredUuts.map((uut) => {
                  let resolution = resolveUutRangeHelper(
                    uut,
                    localRangeIndices,
                    null,
                    null,
                  );

                  if (
                    viewMode === "range" &&
                    rangeData &&
                    localRangeIndices[uut.id] === undefined
                  ) {
                    const matchIndex = resolution.ranges.findIndex((r) => {
                      if (rangeData._id !== undefined && r._index !== undefined)
                        return r._index === rangeData._id;
                      const minMatch = r.min == rangeData.min;
                      const maxMatch = r.max == rangeData.max;
                      const unitMatch =
                        (r.unit || "") === (rangeData.unit || "");
                      return minMatch && maxMatch && unitMatch;
                    });

                    if (matchIndex !== -1) {
                      resolution = {
                        ...resolution,
                        activeIndex: matchIndex,
                        activeRange: resolution.ranges[matchIndex],
                      };
                    }
                  }

                  const { ranges, activeIndex, activeRange } = resolution;
                  const specRows = getSpecRows(activeRange);
                  const rowSpan = specRows.length > 0 ? specRows.length : 1;
                  const isSelected = selectedUutIds.includes(uut.id);

                  const area = sessionData.measurementAreas?.find(
                    (a) =>
                      a.id === uut.measurementAreaId ||
                      a.name === uut.measurementArea,
                  );
                  const areaName = area
                    ? area.name
                    : uut.measurementArea || "-";
                  const areaColor = area?.color || "var(--text-color-muted)";

                  return (
                    <React.Fragment key={uut.id}>
                      <tr
                        className={`${isSelected ? "selected-row" : ""} ${hoveredRowId === uut.id ? "row-hovered" : ""}`}
                        onClick={(e) => handleUutClick(e, uut.id)}
                        onMouseEnter={() => setHoveredRowId(uut.id)}
                        onDoubleClick={() => onEditUut && onEditUut(uut)}
                        style={{
                          cursor: "pointer",
                          borderBottom:
                            specRows.length > 1 ? "none" : undefined,
                        }}
                      >
                        <td
                          rowSpan={rowSpan}
                          className={`cell-description ${hoveredCell.tableId === "uut" && hoveredCell.colIndex === 0 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "uut", colIndex: 0 })
                          }
                          title={uut.description}
                        >
                          {uut.description}
                        </td>
                        <td
                          rowSpan={rowSpan}
                          className={`cell-value ${hoveredCell.tableId === "uut" && hoveredCell.colIndex === 1 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "uut", colIndex: 1 })
                          }
                          onClick={(e) => e.stopPropagation()}
                        >
                          <select
                            className="session-selector"
                            value={activeIndex}
                            onChange={(e) =>
                              setLocalRangeIndices((prev) => ({
                                ...prev,
                                [uut.id]: parseInt(e.target.value),
                              }))
                            }
                          >
                            {ranges.map((range, idx) => {
                              return (
                                <option
                                  key={idx}
                                  value={idx}
                                >
                                  {formatRangeLabel(range, {
                                    preferBounds: true,
                                  })}
                                </option>
                              );
                            })}
                          </select>
                        </td>
                        <td
                          className={`cell-tolerance ${hoveredCell.tableId === "uut" && hoveredCell.colIndex === 2 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "uut", colIndex: 2 })
                          }
                          title={specRows[0]}
                        >
                          {specRows[0]}
                        </td>
                        {showAreaColumn && (
                          <td
                            rowSpan={rowSpan}
                            className={`cell-area ${hoveredCell.tableId === "uut" && hoveredCell.colIndex === 3 ? "col-hovered" : ""}`}
                            onMouseEnter={() =>
                              setHoveredCell({ tableId: "uut", colIndex: 3 })
                            }
                            title={areaName}
                          >
                            <span style={{ color: areaColor }}>{areaName}</span>
                          </td>
                        )}
                      </tr>
                      {specRows.slice(1).map((specComp, sIdx) => (
                        <tr
                          key={`${uut.id}-spec-${sIdx}`}
                          className={`spec-row ${isSelected ? "selected-spec-row" : ""} ${hoveredRowId === uut.id ? "hovered-spec-row" : ""}`}
                          onMouseEnter={() => setHoveredRowId(uut.id)}
                          style={{ cursor: "pointer" }}
                          onClick={(e) => handleUutClick(e, uut.id)}
                          onDoubleClick={() => onEditUut && onEditUut(uut)}
                        >
                          <td
                            className={`cell-tolerance ${hoveredCell.tableId === "uut" && hoveredCell.colIndex === 2 ? "col-hovered" : ""}`}
                            onMouseEnter={() =>
                              setHoveredCell({ tableId: "uut", colIndex: 2 })
                            }
                            title={specComp}
                          >
                            {specComp}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* TMDE TABLE */}
      <div className="panel-card">
        <div className="panel-card-header">
          <div className="panel-card-title">
            <FontAwesomeIcon icon={faTools} />
            <span>
              Test Measurement Device Equipment ({filteredTmdes.length})
            </span>
          </div>
          <div className="panel-card-actions">
            {selectedTmdeIds.length > 0 && (
              <button
                className="btn-delete-selection"
                onClick={handleDeleteSelectedTmdes}
                title={`Delete ${selectedTmdeIds.length} Selected TMDEs`}
              >
                <FontAwesomeIcon icon={faTrashAlt} size="xs" />
              </button>
            )}
            <button
              className="btn-add-item"
              onClick={onAddTmde}
              title="Add New TMDE"
            >
              <FontAwesomeIcon icon={faPlus} size="xs" />
            </button>
          </div>
        </div>
        <div className="panel-table-container">
          <table
            className="instrument-summary-table industry-table"
            onMouseLeave={() => {
              setHoveredCell({ tableId: null, colIndex: null });
              setHoveredRowId(null);
            }}
            style={{ tableLayout: "fixed" }}
          >
            <colgroup>
              <col style={{ width: "42%" }} />
              <col style={{ width: "30%" }} />
              <col style={{ width: "28%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Description</th>
                <th>Range</th>
                <th>Error Limit</th>
              </tr>
            </thead>
            <tbody>
              {filteredTmdes.length === 0 ? (
                <tr className="panel-empty-row">
                  <td colSpan={3}>No TMDEs found in session.</td>
                </tr>
              ) : (
                filteredTmdes.map((tmde, idx) => {
                  const resolution = resolveUutRangeHelper(
                    tmde,
                    tmdeRangeIndices,
                    null,
                    null,
                  );
                  const { ranges, activeIndex, activeRange } = resolution;
                  const specRows = getSpecRows(activeRange);
                  const rowSpan = specRows.length > 0 ? specRows.length : 1;
                  const isSelected = selectedTmdeIds.includes(tmde.id);

                  return (
                    <React.Fragment key={tmde.id || idx}>
                      <tr
                        className={`${isSelected ? "selected-row" : ""} ${hoveredRowId === tmde.id ? "row-hovered" : ""}`}
                        onClick={(e) => handleTmdeClick(e, tmde.id)}
                        onMouseEnter={() => setHoveredRowId(tmde.id)}
                        onDoubleClick={() => onEditTmde && onEditTmde(tmde)}
                        style={{
                          cursor: "pointer",
                          borderBottom:
                            specRows.length > 1 ? "none" : undefined,
                        }}
                      >
                        <td
                          rowSpan={rowSpan}
                          className={`cell-description ${hoveredCell.tableId === "tmde" && hoveredCell.colIndex === 0 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "tmde", colIndex: 0 })
                          }
                          title={tmde.name}
                        >
                          <div style={{ fontWeight: 600 }}>{tmde.name}</div>
                          {tmde.instrument && (
                            <div
                              style={{
                                fontSize: "0.8rem",
                                color: "var(--text-color-muted)",
                                marginTop: "2px",
                              }}
                            >
                              {tmde.instrument.manufacturer}{" "}
                              {tmde.instrument.model}
                            </div>
                          )}
                        </td>
                        <td
                          rowSpan={rowSpan}
                          className={`cell-value ${hoveredCell.tableId === "tmde" && hoveredCell.colIndex === 1 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "tmde", colIndex: 1 })
                          }
                          onClick={(e) => e.stopPropagation()}
                        >
                          <select
                            className="session-selector"
                            value={activeIndex}
                            onChange={(e) =>
                              setTmdeRangeIndices((prev) => ({
                                ...prev,
                                [tmde.id]: parseInt(e.target.value),
                              }))
                            }
                          >
                            {ranges.map((range, rIdx) => {
                              return (
                                <option
                                  key={rIdx}
                                  value={rIdx}
                                >
                                  {formatRangeLabel(range, {
                                    preferBounds: true,
                                  })}
                                </option>
                              );
                            })}
                          </select>
                        </td>
                        <td
                          className={`cell-tolerance ${hoveredCell.tableId === "tmde" && hoveredCell.colIndex === 2 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "tmde", colIndex: 2 })
                          }
                          title={specRows[0]}
                        >
                          {specRows[0]}
                        </td>
                      </tr>
                      {specRows.slice(1).map((specComp, sIdx) => (
                        <tr
                          key={`${tmde.id}-spec-${sIdx}`}
                          className={`spec-row ${isSelected ? "selected-spec-row" : ""} ${hoveredRowId === tmde.id ? "hovered-spec-row" : ""}`}
                          style={{ cursor: "pointer" }}
                          onClick={(e) => handleTmdeClick(e, tmde.id)}
                          onMouseEnter={() => setHoveredRowId(tmde.id)}
                          onDoubleClick={() => onEditTmde && onEditTmde(tmde)}
                        >
                          <td
                            className={`cell-tolerance ${hoveredCell.tableId === "tmde" && hoveredCell.colIndex === 2 ? "col-hovered" : ""}`}
                            onMouseEnter={() =>
                              setHoveredCell({ tableId: "tmde", colIndex: 2 })
                            }
                            title={specComp}
                          >
                            {specComp}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

function DetailedView({
  testPointData,
  sessionData,
  calcResults,
  calculationError,
  uutNominal,
  uutToleranceData: propUutToleranceData,
  tmdeTolerancesData,
  onAddManualComponent,
  onEditManualComponent,
  onRemoveComponent,
  onInlineUutUpdate,
  onInlineTmdeUpdate,
  onBudgetRowContextMenu,
  onDefineTestPoint,
  onShowDerivedBreakdown,
  onShowRiskBreakdown,
  showContribution,
  setShowContribution,
  onOpenRepeatability,
  onOpenCorrelation,
  onUpdateTestPoint,
  riskResults,
  setNotification,
  onToggleUut,
  onDeleteTestPoint,
  currentUutSelection = [],
  activeRangeIndices = {},
  onRangeSelectionChange,

  // Custom equation library (global, persisted like the instrument library)
  customEquations = [],
  onSaveCustomEquation,
  onDeleteCustomEquation,

  // NEW PROPS FOR ACTIONS
  onAddTmde,
  onEditUut,
  onEditTmde,
  onDeleteUut,
  onDeleteTmdeDefinition,
  onApplyToSessionPoints,
}) {
  const [isSymbolMenuOpen, setIsSymbolMenuOpen] = useState(false);
  const [symbolMenuPosition, setSymbolMenuPosition] = useState({
    top: 0,
    left: 0,
  });
  const [tmdeRangeIndices, setTmdeRangeIndices] = useState({});

  // --- NEW: Local Selection State ---
  const [selectedUutIds, setSelectedUutIds] = useState([]);
  const [selectedTmdeIds, setSelectedTmdeIds] = useState([]);
  const [equationTmdeSelections, setEquationTmdeSelections] = useState({});

  // Industry Grade Highlighting State
  // Industry Grade Highlighting State
  const [hoveredCell, setHoveredCell] = useState({
    tableId: null,
    colIndex: null,
  });
  const [hoveredRowId, setHoveredRowId] = useState(null);

  const equationInputRef = useRef(null);
  const symbolMenuRef = useRef(null);
  const symbolButtonRef = useRef(null);
  const libraryButtonRef = useRef(null);
  const libraryMenuRef = useRef(null);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [libraryMenuPosition, setLibraryMenuPosition] = useState({
    top: 0,
    left: 0,
  });

  // Remembers the friendly name last given to each equation symbol on the
  // active point, so a variable that temporarily disappears while the user
  // edits the equation (e.g. deleting "l" from "w*l" and retyping it) gets its
  // name — and therefore its TMDE assignments — back when it reappears.
  const rememberedVariableNamesRef = useRef({});
  const rememberedPointIdRef = useRef(null);
  if (rememberedPointIdRef.current !== (testPointData?.id ?? null)) {
    rememberedPointIdRef.current = testPointData?.id ?? null;
    rememberedVariableNamesRef.current = {
      ...(testPointData?.variableMappings || {}),
    };
  }

  // --- NEW: Row Selection Handlers ---
  const handleUutClick = (e, id) =>
    handleRowSelection(e, id, setSelectedUutIds);
  const handleTmdeClick = (e, id) =>
    handleRowSelection(e, id, setSelectedTmdeIds);

  const handleDeleteSelectedUuts = () => {
    if (onDeleteUut && selectedUutIds.length > 0) {
      onDeleteUut(selectedUutIds);
      setSelectedUutIds([]);
    }
  };

  const handleDeleteSelectedTmdes = () => {
    if (onDeleteTmdeDefinition && selectedTmdeIds.length > 0) {
      onDeleteTmdeDefinition(selectedTmdeIds);
      setSelectedTmdeIds([]);
    }
  };

  // Switching to a different test point clears any stale panel row selection so
  // the Delete target always follows what's actually on screen.
  useEffect(() => {
    setSelectedUutIds([]);
    setSelectedTmdeIds([]);
  }, [testPointData?.id]);

  // Delete/Backspace removes the selected panel rows (UUT/TMDE). Runs in the
  // CAPTURE phase and stops propagation when it handles the key, so it pre-empts
  // the app-level point-delete handler: once you've clicked a UUT/TMDE row,
  // Delete removes THAT, not the open measurement point. With no panel row
  // selected it does nothing and the app's point delete proceeds as before.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (selectedUutIds.length > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleDeleteSelectedUuts();
      } else if (selectedTmdeIds.length > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleDeleteSelectedTmdes();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUutIds, selectedTmdeIds]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        symbolMenuRef.current &&
        !symbolMenuRef.current.contains(event.target) &&
        symbolButtonRef.current &&
        !symbolButtonRef.current.contains(event.target)
      ) {
        setIsSymbolMenuOpen(false);
      }
      if (
        libraryMenuRef.current &&
        !libraryMenuRef.current.contains(event.target) &&
        libraryButtonRef.current &&
        !libraryButtonRef.current.contains(event.target)
      ) {
        setIsLibraryOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const uutToleranceData = useMemo(() => {
    const isUnassigned =
      !testPointData.associatedUutIds ||
      testPointData.associatedUutIds.length === 0;
    if (isUnassigned) return {};
    return propUutToleranceData || {};
  }, [propUutToleranceData, testPointData.associatedUutIds]);

  const associatedUutIds = testPointData.associatedUutIds || [];
  const activePointUutId =
    testPointData.activeUutId || associatedUutIds[0] || null;

  const resolveUutRange = useCallback(
    (uut) => {
      const isActivePointUut =
        activePointUutId !== null &&
        String(activePointUutId) === String(uut.id);
      // For the active point, its own saved tolerance governs the range — the
      // UUT-keyed activeRangeIndices map is deliberately ignored so a range
      // change on one point never leaks onto sibling points sharing the UUT.
      const resolution = resolveUutRangeHelper(
        uut,
        isActivePointUut ? {} : activeRangeIndices,
        isActivePointUut ? uutToleranceData : null,
        uutNominal,
      );
      return resolution;
    },
    [activePointUutId, activeRangeIndices, uutToleranceData, uutNominal],
  );

  const groupedUnitOptions = useMemo(() => {
    const allSupportedUnits = Object.keys(unitSystem.units);
    const options = [];
    const usedUnits = new Set();

    Object.entries(unitCategories).forEach(([category, units]) => {
      const validUnits = units.filter((u) => allSupportedUnits.includes(u));
      if (validUnits.length > 0) {
        options.push({
          label: category,
          options: validUnits.map((u) => {
            usedUnits.add(u);
            return { value: u, label: getUnitDisplayLabel(u) };
          }),
        });
      }
    });

    const leftovers = allSupportedUnits
      .filter((u) => !usedUnits.has(u))
      .sort()
      .map((u) => ({ value: u, label: getUnitDisplayLabel(u) }));

    if (leftovers.length > 0) {
      options.push({ label: "Other", options: leftovers });
    }

    return options;
  }, []);

  const activeMeasurementAreaId = resolvePointAreaId(
    testPointData,
    sessionData.uuts,
    sessionData.measurementAreas,
    activePointUutId,
  );
  const activeMeasurementArea = sessionData.measurementAreas?.find(
    (area) => area.id === activeMeasurementAreaId,
  );

  // Keep the instrument inventory stable while moving between points. A point
  // only highlights its linked UUT; it does not hide the area's other choices.
  const relevantUuts = useMemo(() => {
    const allUuts = sessionData.uuts || [];
    if (!activeMeasurementAreaId) return allUuts;
    return allUuts.filter(
      (uut) =>
        String(uut.measurementAreaId) === String(activeMeasurementAreaId) ||
        (!uut.measurementAreaId &&
          activeMeasurementArea?.name &&
          uut.measurementArea === activeMeasurementArea.name),
    );
  }, [sessionData.uuts, activeMeasurementAreaId, activeMeasurementArea?.name]);

  const relevantTmdes = useMemo(() => {
    const allTmdes = sessionData.tmdes || [];
    if (!activeMeasurementAreaId) return allTmdes;
    return allTmdes.filter((tmde) => {
      if (tmde.measurementAreaId) {
        return tmde.measurementAreaId === activeMeasurementAreaId;
      }
      if (
        activeMeasurementArea?.name &&
        tmde.measurementArea === activeMeasurementArea.name
      ) {
        return true;
      }

      // Legacy TMDEs predate explicit area ownership. Infer their scope from
      // the points that already use them; truly unused legacy entries remain
      // available so they can be assigned and scoped without data migration.
      const inferredAreaIds = new Set(
        (sessionData.testPoints || [])
          .filter((point) =>
            (point.tmdeTolerances || []).some(
              (instance) =>
                instance.id === tmde.id || instance.sourceId === tmde.id,
            ),
          )
          .map((point) => point.measurementAreaId)
          .filter(Boolean),
      );
      return (
        inferredAreaIds.size === 0 ||
        inferredAreaIds.has(activeMeasurementAreaId)
      );
    });
  }, [
    sessionData.tmdes,
    sessionData.testPoints,
    activeMeasurementAreaId,
    activeMeasurementArea?.name,
  ]);

  const isDerived = testPointData.measurementType === "derived";
  const isUnassigned = associatedUutIds.length === 0;

  const availableVariables = useMemo(() => {
    if (!isDerived) return [];
    if (
      testPointData.variableMappings &&
      Object.values(testPointData.variableMappings).length > 0
    ) {
      const vars = Object.values(testPointData.variableMappings)
        .map((v) => (v ? String(v).trim() : "")) // <--- FIX: Ensure it is a string first
        .filter((v) => v !== "");
      return [...new Set(vars)];
    }
    return [];
  }, [testPointData, isDerived]);

  // --- HANDLERS ---
  const handleUutCheckboxChange = (uutId) => {
    onToggleUut(uutId);
  };

  const handleRangeChange = (
    uutId,
    newIndex,
    ranges,
    isActivePointUut = false,
  ) => {
    const selectedRange = ranges[newIndex];
    if (isActivePointUut && selectedRange) {
      // Persist the chosen range on THIS point only. Writing the tolerance
      // directly (rather than the UUT-keyed activeRangeIndices map) keeps the
      // selection point-specific — sibling points sharing the UUT are untouched.
      if (onUpdateTestPoint) {
        onUpdateTestPoint({ uutTolerance: selectedRange });
      }
      const compatibility = assessRangeCompatibility(
        selectedRange,
        uutNominal,
        "UUT range",
      );
      if (!compatibility.compatible) {
        setNotification({
          title: "UUT Range Warning",
          message: `${compatibility.reason} The range was selected, but it does not cover this measurement point.`,
        });
      }
    } else if (onRangeSelectionChange) {
      // Non-active UUTs only set the shared default used when defining new points.
      onRangeSelectionChange((prev) => ({ ...prev, [uutId]: newIndex }));
    }
  };

  const handleActionAdd = () => {
    if (!currentUutSelection || currentUutSelection.length === 0) {
      onDefineTestPoint([], null);
      return;
    }

    const primaryUutId = currentUutSelection[0];
    const primaryUut = relevantUuts.find((u) => u.id === primaryUutId);
    let resolvedTolerance = null;

    if (primaryUut) {
      const { activeRange } = resolveUutRange(primaryUut);
      resolvedTolerance = activeRange;
    }

    onDefineTestPoint(currentUutSelection, resolvedTolerance);
  };

  const handleEquationChange = (newEquationString) => {
    let expressionToParse = (newEquationString || "").trim();
    const equalsIndex = expressionToParse.indexOf("=");
    if (equalsIndex !== -1) {
      expressionToParse = expressionToParse.substring(equalsIndex + 1).trim();
    }

    // null = the expression doesn't parse (yet). Mid-edit states like "w*l+"
    // land here; keep the existing mappings instead of wiping them so the
    // user's variable names and TMDE assignments survive the edit.
    let variables = null;
    if (!expressionToParse) {
      variables = [];
    } else {
      try {
        const node = math.parse(expressionToParse);
        const varsSet = new Set();
        node.traverse(function (node) {
          if (
            node.isSymbolNode &&
            !math[node.name] &&
            !["e", "pi", "i"].includes(node.name.toLowerCase())
          ) {
            varsSet.add(node.name);
          }
        });
        variables = Array.from(varsSet).sort();
      } catch {
        variables = null;
      }
    }

    const patch = { equationString: newEquationString };
    if (variables !== null) {
      const currentMappings = testPointData.variableMappings || {};
      const newMappings = {};
      variables.forEach((v) => {
        // Fall back to the remembered name so re-typed variables keep their
        // identity (and any TMDEs assigned to that name reconnect).
        newMappings[v] =
          currentMappings[v] || rememberedVariableNamesRef.current[v] || "";
      });
      patch.variableMappings = newMappings;
    }

    if (onUpdateTestPoint) {
      onUpdateTestPoint(patch);
    }
  };

  const handleSymbolMenuToggle = () => {
    setIsLibraryOpen(false);
    positionEquationMenu(symbolButtonRef, setSymbolMenuPosition);
    setIsSymbolMenuOpen((open) => !open);
  };

  const handleLibraryMenuToggle = () => {
    setIsSymbolMenuOpen(false);
    positionEquationMenu(libraryButtonRef, setLibraryMenuPosition);
    setIsLibraryOpen((open) => !open);
  };

  const positionEquationMenu = useCallback((buttonRef, setPosition) => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      top: rect.bottom + 6,
      left: Math.min(
        Math.max(12, rect.right - 360),
        Math.max(12, window.innerWidth - 372),
      ),
    });
  }, []);

  useEffect(() => {
    if (!isSymbolMenuOpen && !isLibraryOpen) return undefined;

    const updateOpenMenuPosition = () => {
      if (isSymbolMenuOpen) {
        positionEquationMenu(symbolButtonRef, setSymbolMenuPosition);
      }
      if (isLibraryOpen) {
        positionEquationMenu(libraryButtonRef, setLibraryMenuPosition);
      }
    };

    updateOpenMenuPosition();
    window.addEventListener("scroll", updateOpenMenuPosition, true);
    window.addEventListener("resize", updateOpenMenuPosition);
    return () => {
      window.removeEventListener("scroll", updateOpenMenuPosition, true);
      window.removeEventListener("resize", updateOpenMenuPosition);
    };
  }, [isSymbolMenuOpen, isLibraryOpen, positionEquationMenu]);

  // Apply a library equation while preserving existing/remembered variable
  // names so TMDE assignments survive swapping equations.
  const applyLibraryEquation = (equation) => {
    const currentMappings = testPointData.variableMappings || {};
    const newMappings = {};
    Object.entries(equation.variables).forEach(([symbol, suggestedName]) => {
      newMappings[symbol] =
        currentMappings[symbol] ||
        rememberedVariableNamesRef.current[symbol] ||
        suggestedName;
    });
    rememberedVariableNamesRef.current = {
      ...rememberedVariableNamesRef.current,
      ...newMappings,
    };
    onUpdateTestPoint?.({
      equationString: equation.expression,
      variableMappings: newMappings,
    });
  };

  const handleLibrarySelect = (equation) => {
    setIsLibraryOpen(false);
    const current = (testPointData.equationString || "").trim();
    if (current && current !== equation.expression) {
      setNotification({
        title: "Replace Equation",
        message: `Replace the current equation with "${equation.name}" (${equation.expression})?`,
        confirmText: "Replace",
        secondaryText: "Cancel",
        onConfirm: () => {
          applyLibraryEquation(equation);
          setNotification(null);
        },
        onSecondary: () => setNotification(null),
      });
      return;
    }
    applyLibraryEquation(equation);
  };

  const handleSymbolClick = (symbol) => {
    const input = equationInputRef.current;
    if (!input) return;

    input.focus();
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const currentValue = input.value;
    const selectedText = currentValue.substring(start, end);

    let newValue;
    let newCursorPos;

    const isFunction = symbol.endsWith("()");

    if (isFunction) {
      const funcName = symbol.slice(0, -2);
      const textToInsert = `${funcName}(${selectedText})`;
      newValue =
        currentValue.substring(0, start) +
        textToInsert +
        currentValue.substring(end);
      newCursorPos = selectedText
        ? start + textToInsert.length
        : start + funcName.length + 1;
    } else {
      newValue =
        currentValue.substring(0, start) + symbol + currentValue.substring(end);
      newCursorPos = start + symbol.length;
    }

    handleEquationChange(newValue);

    setTimeout(() => {
      if (input) {
        input.focus();
        input.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  const symbolMenu = isSymbolMenuOpen
    ? ReactDOM.createPortal(
        <div
          className="add-point-symbol-popover"
          ref={symbolMenuRef}
          style={{ top: symbolMenuPosition.top, left: symbolMenuPosition.left }}
        >
          {Object.entries(symbolCategories).map(([category, symbols]) => (
            <div key={category} className="add-point-symbol-category">
              <h5>{category}</h5>
              <div className="add-point-symbol-grid">
                {symbols.map((item) => (
                  <SymbolButton
                    key={item.symbol}
                    symbol={item.symbol}
                    title={item.title}
                    onSymbolClick={handleSymbolClick}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )
    : null;

  const handleVariableMappingChange = (symbol, newName) => {
    const currentMappings = testPointData.variableMappings || {};
    // Fall back to the remembered name so clearing the field and retyping
    // still counts as a rename of the same variable.
    const oldName =
      String(currentMappings[symbol] || "").trim() ||
      String(rememberedVariableNamesRef.current[symbol] || "").trim();
    const trimmedNewName = String(newName || "").trim();

    // Store the raw text so multi-word names ("Applied Weight") can be typed;
    // comparisons elsewhere always trim.
    const newMappings = { ...currentMappings, [symbol]: newName };
    if (trimmedNewName) {
      rememberedVariableNamesRef.current[symbol] = trimmedNewName;
    }

    const patch = { variableMappings: newMappings };

    // Renaming a variable should carry its TMDE assignments along. Only do so
    // when this symbol exclusively owns the old name (another symbol mapped to
    // the same name keeps its assignments).
    const oldNameStillUsed = Object.entries(currentMappings).some(
      ([otherSymbol, name]) =>
        otherSymbol !== symbol && String(name || "").trim() === oldName,
    );
    if (oldName && trimmedNewName && oldName !== trimmedNewName && !oldNameStillUsed) {
      const retargeted = tmdeTolerancesData.map((tmde) =>
        String(tmde.variableType || "").trim() === oldName
          ? { ...tmde, variableType: trimmedNewName }
          : tmde,
      );
      if (retargeted.some((tmde, i) => tmde !== tmdeTolerancesData[i])) {
        patch.tmdeTolerances = retargeted;
      }
    }

    if (onUpdateTestPoint) {
      onUpdateTestPoint(patch);
    }
  };

  // Write a distribution divisor (e.g. "1.960") onto every tolerance
  // sub-component of a TMDE instance. getBudgetComponentsFromTolerance reads
  // `.distribution` off these sub-components, so this re-derives the budget and
  // (via the tmdeTolerances dependency) the risk metrics.
  const applyDistributionToTmde = (
    tmdeInstance,
    divisor,
    compKeys = ["reading", "readings_iv", "range", "floor"],
  ) => {
    // Preserve the instrument's originally-specced distribution the first time
    // it is overridden, so the override warning can always reference the true
    // spec value (and reverting to it is recognised as "back to spec").
    const writeComp = (comp) => ({
      ...comp,
      specDistribution: comp.specDistribution ?? comp.distribution,
      distribution: divisor,
    });
    const writeOn = (obj) => {
      const next = { ...obj };
      compKeys.forEach((k) => {
        if (next[k] && typeof next[k] === "object") {
          next[k] = writeComp(next[k]);
        }
      });
      return next;
    };

    const next = { ...tmdeInstance };
    if (next.tolerance && typeof next.tolerance === "object") {
      next.tolerance = writeOn(next.tolerance);
    } else if (
      next.tolerances &&
      typeof next.tolerances === "object" &&
      !Array.isArray(next.tolerances)
    ) {
      next.tolerances = writeOn(next.tolerances);
    } else {
      // Flattened instance: sub-components live directly on the instance.
      compKeys.forEach((k) => {
        if (next[k] && typeof next[k] === "object") {
          next[k] = writeComp(next[k]);
        }
      });
    }
    return next;
  };

  // Apply a transform to one TMDE instance, scoped either to the active point
  // or to every session point that carries that TMDE. "session" leaves the
  // saved instrument/library spec untouched — it only patches existing points.
  const applyTmdeInstanceChange = (targetId, transformInstance, scope) => {
    const matches = (t) => t.id === targetId || t.sourceId === targetId;
    if (scope === "session" && onApplyToSessionPoints) {
      onApplyToSessionPoints((tp) => {
        const tols = tp.tmdeTolerances || [];
        if (!tols.some(matches)) return tp;
        return {
          ...tp,
          tmdeTolerances: tols.map((t) => (matches(t) ? transformInstance(t) : t)),
        };
      });
      return;
    }
    onUpdateTestPoint({
      tmdeTolerances: tmdeTolerancesData.map((t) =>
        matches(t) ? transformInstance(t) : t,
      ),
    });
  };

  // Two-choice override prompt: keep the change for this point or push it to the
  // whole session. Both leave the instrument's found spec on file (the row's
  // deviation flag is what surfaces the difference).
  const promptSpecOverride = ({ title, message, targetId, transformInstance }) => {
    setNotification({
      title,
      message,
      confirmText: "This Point",
      secondaryText: "Whole Session",
      onConfirm: () => {
        applyTmdeInstanceChange(targetId, transformInstance, "point");
        setNotification(null);
      },
      onSecondary: () => {
        applyTmdeInstanceChange(targetId, transformInstance, "session");
        setNotification(null);
      },
    });
  };

  // Patch the manual Type-B entry inside a TMDE instance, mirroring the
  // normalization getBudgetComponentsFromTolerance uses to locate
  // manualComponents (top-level, `.tolerance`, or `.tolerances`).
  const patchInstanceManualComponent = (instance, manualId, patchMc) => {
    const patchList = (obj) => {
      if (!obj || !Array.isArray(obj.manualComponents)) return obj;
      return {
        ...obj,
        manualComponents: obj.manualComponents.map((mc, i) =>
          String(mc.id ?? i) === String(manualId) ? patchMc(mc) : mc,
        ),
      };
    };
    const next = { ...instance };
    if (next.tolerance && Array.isArray(next.tolerance.manualComponents)) {
      next.tolerance = patchList(next.tolerance);
    } else if (
      next.tolerances &&
      typeof next.tolerances === "object" &&
      !Array.isArray(next.tolerances) &&
      Array.isArray(next.tolerances.manualComponents)
    ) {
      next.tolerances = patchList(next.tolerances);
    } else {
      return patchList(next);
    }
    return next;
  };

  const handleComponentUpdate = (id, updates, component) => {
    // Manual Type-B value edit from the budget table. The entered magnitude
    // (toleranceLimit / standardUncertainty) deviates from the instrument's
    // found spec, so warn and let the user keep it on this point or the whole
    // session. The original spec figure is snapshotted the first time so the
    // deviation flag and tooltip can always reference it.
    if (
      updates.manualValue !== undefined &&
      component?.isManual &&
      component?.sourceTmdeId
    ) {
      const targetId = component.sourceTmdeId;
      const manualId = component.manualSourceId;
      const isStandard = component.manualInputMode === "standard";
      const valueKey = isStandard ? "standardUncertainty" : "toleranceLimit";
      const specKey = isStandard
        ? "specStandardUncertainty"
        : "specToleranceLimit";
      const newValue = updates.manualValue;
      const transformInstance = (t) =>
        patchInstanceManualComponent(t, manualId, (mc) => ({
          ...mc,
          [specKey]: mc[specKey] ?? mc[valueKey],
          [valueKey]: newValue,
        }));
      const specRef =
        component.specBaseline?.value ?? component.manualRawValue;
      promptSpecOverride({
        title: "Override Component Value — Warning",
        message: `This component is specced at ${specRef}${
          component.manualUnit ? ` ${component.manualUnit}` : ""
        } from the instrument's found spec. Changing it to ${newValue}${
          component.manualUnit ? ` ${component.manualUnit}` : ""
        } overrides that value (the instrument spec itself is unchanged). Apply this override to just this point, or to every point in the session that uses this device?`,
        targetId,
        transformInstance,
      });
      return;
    }

    // Distribution change on an instrument-attached manual Type-B component.
    // Route it to that component (NOT the accuracy band, which the generic
    // sourceTmdeId branch below would otherwise corrupt) and prompt the same
    // point/session override choice as the value edit.
    if (
      updates.distribution !== undefined &&
      component?.isManual &&
      component?.sourceTmdeId
    ) {
      const targetId = component.sourceTmdeId;
      const manualId = component.manualSourceId;
      const newDist = String(updates.distribution);
      const distLabel = (d) =>
        errorDistributions.find((e) => e.value === String(d))?.label ||
        `k=${d}`;
      const transformInstance = (t) =>
        patchInstanceManualComponent(t, manualId, (mc) => ({
          ...mc,
          specDistribution: mc.specDistribution ?? mc.distribution,
          distribution: newDist,
        }));
      promptSpecOverride({
        title: "Override Component Distribution — Warning",
        message: `This component is specced with a ${
          component.specBaseline?.distributionLabel ||
          distLabel(component.distributionDivisor)
        } distribution. Changing it to ${distLabel(
          newDist,
        )} overrides that (the instrument spec itself is unchanged). Apply this override to just this point, or to every point in the session that uses this device?`,
        targetId,
        transformInstance,
      });
      return;
    }

    // Distribution change on the UUT's own resolution row. This component is
    // synthesized from the UUT tolerance (it has no sourceTmdeId and isn't a
    // manual or TMDE component), so without this branch the change fell through
    // and the dropdown appeared frozen. Route the divisor back to the UUT
    // tolerance's resolution distribution so the budget + risk recompute.
    if (
      updates.distribution !== undefined &&
      (component?.componentId === "UUT Resolution" || id === "uut_resolution")
    ) {
      onUpdateTestPoint({
        uutTolerance: {
          ...uutToleranceData,
          measuringResolutionDistribution: updates.distribution,
        },
      });
      return;
    }

    // Distribution change on a TMDE-derived accuracy row: route the divisor
    // back to the originating TMDE instance so the budget + risk recompute (#6).
    if (updates.distribution !== undefined && component?.sourceTmdeId) {
      const divisor = updates.distribution;
      const targetId = component.sourceTmdeId;
      // The dB term is its own budget line item with its own distribution, so a
      // change there must not bleed into the accuracy band (and vice versa).
      const ident = String(component?.name || component?.id || "");
      const isDbRow = /-\s*dB$/i.test(ident.trim()) || /_db_/i.test(ident);

      const transformInstance = (t) => {
        // A Resolution row targets the resolution's own divisor, not the
        // accuracy sub-components (otherwise it would corrupt the accuracy
        // distribution with this value).
        if (component.isResolution)
          return { ...t, measuringResolutionDistribution: divisor };
        return isDbRow
          ? applyDistributionToTmde(t, divisor, ["db"])
          : applyDistributionToTmde(t, divisor);
      };
      const applyChange = () =>
        applyTmdeInstanceChange(targetId, transformInstance, "point");

      // The instrument's specced distribution lives on the budget row as
      // `distributionDivisor`. Overriding it here (the accuracy band or dB term,
      // not the resolution rounding model) deviates from how the instrument was
      // specified, so make the user confirm. The spec form is where you *define*
      // the distribution; this table is where you can *override* it.
      const distLabel = (d) =>
        errorDistributions.find((e) => e.value === String(d))?.label ||
        `k=${d}`;
      // Original specced value: the preserved snapshot if this point has been
      // overridden before, otherwise the value currently on the spec.
      const targetTmde = tmdeTolerancesData.find(
        (t) => t.id === targetId || t.sourceId === targetId,
      );
      const specSrc =
        targetTmde?.tolerance && typeof targetTmde.tolerance === "object"
          ? targetTmde.tolerance
          : targetTmde?.tolerances &&
              typeof targetTmde.tolerances === "object" &&
              !Array.isArray(targetTmde.tolerances)
            ? targetTmde.tolerances
            : targetTmde || {};
      const specSub = isDbRow
        ? specSrc.db
        : ["reading", "readings_iv", "range", "floor"]
            .map((k) => specSrc[k])
            .find((c) => c && typeof c === "object");
      const specDivisor =
        specSub?.specDistribution ??
        specSub?.distribution ??
        component?.distributionDivisor;
      const isSpecOverride =
        !component.isResolution &&
        specDivisor != null &&
        String(specDivisor) !== String(divisor);

      if (isSpecOverride) {
        promptSpecOverride({
          title: "Override Spec Distribution — Warning",
          message: `This measurement is specced with a ${distLabel(
            specDivisor,
          )} distribution. Changing it to ${distLabel(
            divisor,
          )} overrides the instrument's specified distribution (the instrument spec itself is unchanged). Apply this override to just this point, or to every point in the session that uses this device?`,
          targetId,
          transformInstance,
        });
        return;
      }

      applyChange();
      return;
    }

    // 1. Try Manual Components
    const currentManualComponents = testPointData.components || [];
    const manualComp = currentManualComponents.find((c) => c.id === id);

    // 1a. Distribution change on a manual Type B / Resolution component. Its
    // standard uncertainty was precomputed as (input / divisor), so changing
    // the divisor must recompute the value — it scales as 1/divisor. (Type A
    // has no divisor; its distribution is fixed Normal.)
    if (
      updates.distribution !== undefined &&
      manualComp &&
      manualComp.originalInput &&
      manualComp.type !== "A"
    ) {
      const oldDiv =
        parseFloat(manualComp.originalInput.errorDistributionDivisor) || 1;
      const newDivStr = String(updates.distribution);
      const newDiv = parseFloat(newDivStr);
      if (!isNaN(newDiv) && newDiv > 0 && oldDiv > 0) {
        const scale = oldDiv / newDiv;
        const baseLabel =
          oldErrorDistributions.find((d) => d.value === newDivStr)?.label ||
          newDivStr;
        const updated = {
          ...manualComp,
          value:
            typeof manualComp.value === "number"
              ? manualComp.value * scale
              : manualComp.value,
          value_native:
            typeof manualComp.value_native === "number"
              ? manualComp.value_native * scale
              : manualComp.value_native,
          distribution: manualComp.originalInput.isResolution
            ? `${baseLabel} (Res)`
            : baseLabel,
          originalInput: {
            ...manualComp.originalInput,
            errorDistributionDivisor: newDivStr,
          },
        };
        const updatedComponents = currentManualComponents.map((c) =>
          c.id === id ? updated : c,
        );
        onUpdateTestPoint({ components: updatedComponents });
      }
      return;
    }

    if (manualComp) {
      const updatedComponents = currentManualComponents.map((c) =>
        c.id === id ? { ...c, ...updates } : c,
      );
      onUpdateTestPoint({ components: updatedComponents });
      return;
    }
    // 2. Try TMDE Components
    if (tmdeTolerancesData.some((t) => t.id === id)) {
      const updatedTmdes = tmdeTolerancesData.map((t) =>
        t.id === id ? { ...t, ...updates } : t,
      );
      onUpdateTestPoint({ tmdeTolerances: updatedTmdes });
    }
  };

  const handleAssignTmdeToInput = (masterTmde, variableType) => {
    const existing = tmdeTolerancesData.find(
      (tmde) =>
        tmde.id === masterTmde.id || tmde.sourceId === masterTmde.id,
    );

    if (!variableType) {
      onUpdateTestPoint({
        tmdeTolerances: tmdeTolerancesData.filter(
          (tmde) =>
            tmde.id !== masterTmde.id && tmde.sourceId !== masterTmde.id,
        ),
      });
      return;
    }

    if (existing) {
      onUpdateTestPoint({
        tmdeTolerances: tmdeTolerancesData.map((tmde) =>
          tmde.id === existing.id ? { ...tmde, variableType } : tmde,
        ),
      });
      return;
    }

    const resolution = resolveUutRangeHelper(
      masterTmde,
      tmdeRangeIndices,
      null,
      null,
    );
    const activeRange = resolution.activeRange || {};
    const rangeSpecs = { ...activeRange };
    delete rangeSpecs.id;
    // Additive sources on one variable must share a unit so they can be summed.
    // Inherit the unit from any source already on this variable; fall back to the
    // range/instrument unit. Value starts empty so the user enters this piece.
    const sibling = tmdeTolerancesData.find(
      (t) => t.variableType === variableType && t.measurementPoint?.unit,
    );
    const defaultUnit =
      sibling?.measurementPoint?.unit ||
      activeRange.unit ||
      masterTmde.instrument?.functions?.[0]?.unit ||
      "";

    onUpdateTestPoint({
      tmdeTolerances: [
        ...tmdeTolerancesData,
        {
          ...masterTmde,
          ...rangeSpecs,
          id: masterTmde.id,
          sourceId: masterTmde.id,
          variableType,
          quantity: 1,
          measurementPoint: masterTmde.measurementPoint?.value
            ? masterTmde.measurementPoint
            : { value: "", unit: defaultUnit },
        },
      ],
    });
  };

  // Per-SOURCE measurement point update (additive composition): each source on a
  // variable carries its own value, and the variable is their sum. Edits one
  // source by id rather than broadcasting to every source of the variable type.
  const handleSourceNominalUpdate = (tmdeId, field, value) => {
    const nextTolerances = tmdeTolerancesData.map((tmde) =>
      tmde.id === tmdeId
        ? {
            ...tmde,
            measurementPoint: {
              ...(tmde.measurementPoint || { value: "", unit: "" }),
              [field]: value,
            },
          }
        : tmde,
    );
    onUpdateTestPoint({ tmdeTolerances: nextTolerances });
  };

  const handleToggleTmdeUsage = (tmdeId, isChecked) => {
    if (isChecked) {
      const sourceTmde = sessionData.tmdes.find((t) => t.id === tmdeId);
      if (sourceTmde) {
        const resolution = resolveUutRangeHelper(
          sourceTmde,
          tmdeRangeIndices,
          null,
          null,
        );
        const activeRange = resolution.activeRange || {};
        const compatibility = assessTmdeCompatibility(
          activeRange,
          uutNominal,
        );
        if (!compatibility.compatible) {
          setNotification({
            title: "Incompatible TMDE",
            message: compatibility.reason,
          });
          return;
        }
        const { id: rangeId, ...rangeSpecs } = activeRange;

        const newInstance = {
          ...sourceTmde,
          ...rangeSpecs,
          id: sourceTmde.id,
          sourceId: sourceTmde.id,
          quantity: 1,
        };

        const newTolerances = [...tmdeTolerancesData, newInstance];
        onUpdateTestPoint({ tmdeTolerances: newTolerances });
      }
    } else {
      const newTolerances = tmdeTolerancesData.filter(
        (t) => t.id !== tmdeId && t.sourceId !== tmdeId,
      );
      onUpdateTestPoint({ tmdeTolerances: newTolerances });
    }
  };

  const handleTmdeRangeChange = (tmde, newIndex, ranges) => {
    const activeInstance = tmdeTolerancesData.find((t) => t.id === tmde.id);
    const selectedRange = ranges[newIndex] || {};

    if (activeInstance && !isDerived) {
      const compatibility = assessTmdeCompatibility(
        selectedRange,
        uutNominal,
      );
      if (!compatibility.compatible) {
        setNotification({
          title: "Incompatible TMDE Range",
          message: compatibility.reason,
        });
        return;
      }
    }

    setTmdeRangeIndices((prev) => ({ ...prev, [tmde.id]: newIndex }));

    if (activeInstance && onUpdateTestPoint) {
      const { id: rangeId, ...rangeSpecs } = selectedRange;

      const updatedInstance = {
        ...activeInstance,
        ...rangeSpecs,
        id: activeInstance.id,
      };

      const updatedTolerances = tmdeTolerancesData.map((t) =>
        t.id === tmde.id ? updatedInstance : t,
      );
      onUpdateTestPoint({ tmdeTolerances: updatedTolerances });
    }
  };

  const equationDisplayData = useMemo(() => {
    if (!isDerived) return null;

    const currentMappings = testPointData.variableMappings || {};
    const vars = Object.keys(currentMappings)
      .sort()
      .map((symbol) => {
        const name = currentMappings[symbol];
        const assignedTmdes = tmdeTolerancesData.filter(
          (t) =>
            t.variableType &&
            name &&
            String(t.variableType).trim() === String(name).trim(),
        );
        const assignedTmde = assignedTmdes[0];

        return {
          symbol,
          name,
          isAssigned: assignedTmdes.length > 0,
          assignedTmdes,
          value: assignedTmde?.measurementPoint?.value,
          unit: assignedTmde?.measurementPoint?.unit,
        };
      });

    return {
      equation: testPointData.equationString || "",
      variables: vars,
    };
  }, [isDerived, testPointData, tmdeTolerancesData]);

  const getEquationTmdeLabel = (tmde) =>
    tmde?.description ||
    tmde?.name ||
    (tmde?.instrument
      ? `${tmde.instrument.manufacturer || ""} ${tmde.instrument.model || ""}`.trim()
      : "") ||
    "Unnamed TMDE";

  // Live validation of the equation editor's content: hard errors for
  // constructs the engines can't evaluate, warnings for shadowed mathjs
  // symbols and non-differentiable (Monte Carlo-only) equations.
  const equationValidation = useMemo(
    () =>
      isDerived ? validateEquation(testPointData.equationString || "") : null,
    [isDerived, testPointData.equationString],
  );

  // Save the editor's current equation to the persistent (global) library.
  // The measurement area defaults to the point's own area so the entry lands
  // in the right group.
  const handleSaveCurrentEquation = () => {
    if (!onSaveCustomEquation || !equationValidation) return;
    if (equationValidation.status !== "ok") return;

    const pointArea = (sessionData.measurementAreas || []).find(
      (area) =>
        area.id ===
        resolvePointAreaId(
          testPointData,
          sessionData.uuts || [],
          sessionData.measurementAreas || [],
        ),
    );
    const mappings = testPointData.variableMappings || {};
    const variables = {};
    equationValidation.variables.forEach((symbol) => {
      variables[symbol] = mappings[symbol] || symbol;
    });

    setIsLibraryOpen(false);
    setNotification({
      title: "Save Library Equation",
      message: "Name this equation before adding it to your library.",
      confirmText: "Save Equation",
      inputLabel: "Equation name",
      inputPlaceholder: "e.g. Capacitive reactance",
      validateInput: (rawName) =>
        String(rawName || "").trim() ? "" : "Enter an equation name.",
      onConfirm: (name) => {
        onSaveCustomEquation({
          id:
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `eq-${Date.now()}`,
          name,
          expression: stripEquationPrefix(testPointData.equationString),
          description: `Saved from the equation editor${pointArea?.name ? ` (${pointArea.name})` : ""}.`,
          measurementArea: pointArea?.name || "",
          measurementAreaColor: pointArea?.color || "",
          variables,
        });
        setNotification(null);
      },
    });
  };

  const handleDeleteCustomEquation = (equation) => {
    if (!onDeleteCustomEquation) return;
    if (
      window.confirm(
        `Delete "${equation.name}" from your equation library? This affects all sessions.`,
      )
    ) {
      onDeleteCustomEquation(equation.id);
    }
  };

  const hasMeasurementPoint =
    isDerived ||
    (uutNominal &&
      uutNominal.value !== undefined &&
      uutNominal.value !== "" &&
      uutNominal.value !== null);
  // This detailed table shows a single active point, so the Section column is
  // driven purely by whether THIS point has a section. If it was left blank
  // when the point was added, no Section column is shown (#4).
  const showSectionColumn = useMemo(
    () => Boolean(String(testPointData.section || "").trim()),
    [testPointData.section],
  );
  const hasUnassignedVariables =
    isDerived && equationDisplayData?.variables.some((v) => !v.isAssigned);

  const isBackendMappingError =
    calculationError &&
    (calculationError.includes("Variable mappings are missing") ||
      calculationError.includes("Input data missing") ||
      calculationError.includes("Internal error"));

  // --- Monte Carlo (GUM-S1) propagation mode ---
  // Linear stays the default (workbook parity); the MC path is offered when
  // the Layer-1 nonlinearity detector flags the operating point.
  const propagationMode =
    testPointData.propagationMode === "montecarlo" ? "montecarlo" : "linear";
  const nonlinearityWarnings = useMemo(
    () =>
      (calcResults?.calculatedBudgetComponents || [])
        .filter((c) => c.nonlinearityWarning)
        .map((c) => c.nonlinearityWarning),
    [calcResults],
  );
  const isStationaryPointError = Boolean(
    calculationError && /stationary point/i.test(calculationError),
  );
  const showMonteCarloSuggestion =
    isDerived &&
    propagationMode === "linear" &&
    (nonlinearityWarnings.length > 0 || isStationaryPointError);

  const calculatedNominal = calcResults?.calculatedNominalValue;
  const targetNominal = parseFloat(uutNominal?.value);

  const getCalculatedStatus = () => {
    if (isNaN(calculatedNominal) || isNaN(targetNominal)) return "neutral";
    const diff = Math.abs(calculatedNominal - targetNominal);
    const tolerance = Math.max(Math.abs(targetNominal * 0.0001), 1e-9);
    return diff <= tolerance ? "match" : "mismatch";
  };

  const calcStatus = getCalculatedStatus();

  // Sum-vs-range sanity hint: when the derived value (e.g. the additive sum of
  // several sources on one variable) lands outside the UUT's measurement range,
  // the resulting TUR/PFA are meaningless. Flag it explicitly rather than
  // letting the user puzzle over a wild risk number.
  // NB: use uutToleranceData (defined above) — activeResolvedTolerance is
  // declared further down, so referencing it here would hit the TDZ.
  const uutRangeMax = parseFloat(uutToleranceData?.max);
  // Only flag when the derived value also diverges from the target (calcStatus
  // "mismatch") — i.e. the additive sum genuinely blew up. A legitimate point
  // sitting just above its range-label max (calc ≈ target) must not warn.
  const calcExceedsRange =
    calcStatus === "mismatch" &&
    Number.isFinite(calculatedNominal) &&
    Number.isFinite(uutRangeMax) &&
    uutRangeMax > 0 &&
    Math.abs(calculatedNominal) > uutRangeMax * 1.05;

  const calcStatusStyle = {
    match: {
      borderColor: "var(--status-good)",
      backgroundColor: "rgba(76, 175, 80, 0.1)",
      color: "var(--status-good)",
      icon: faCheckCircle,
    },
    mismatch: {
      borderColor: "var(--status-bad)",
      backgroundColor: "rgba(255, 82, 82, 0.1)",
      color: "var(--status-bad)",
      icon: faTimesCircle,
    },
    neutral: {
      borderColor: "var(--border-color)",
      backgroundColor: "transparent",
      color: "var(--text-color-muted)",
      icon: null,
    },
  }[calcStatus];

  const primaryUutId = activePointUutId;
  const primaryUut = relevantUuts.find((u) => u.id === primaryUutId);

  const activeResolvedTolerance = useMemo(() => {
    if (!primaryUut) return uutToleranceData;
    const { activeRange } = resolveUutRange(primaryUut);
    return activeRange && Object.keys(activeRange).length > 0
      ? activeRange
      : uutToleranceData;
  }, [primaryUut, resolveUutRange, uutToleranceData]);

  // Auto-Save Effect
  useEffect(() => {
    if (activeResolvedTolerance && uutToleranceData) {
      const isDifferent =
        activeResolvedTolerance.range !== uutToleranceData.range ||
        activeResolvedTolerance.min != uutToleranceData.min ||
        activeResolvedTolerance.max != uutToleranceData.max ||
        activeResolvedTolerance.unit !== uutToleranceData.unit;

      if (isDifferent && onUpdateTestPoint) {
        onUpdateTestPoint({ uutTolerance: activeResolvedTolerance });
      }
    }
  }, [activeResolvedTolerance, uutToleranceData, onUpdateTestPoint]);

  const calculatedToleranceDisplay = useMemo(() => {
    const summary = getToleranceErrorSummary(
      activeResolvedTolerance,
      uutNominal,
    );
    return summary === "Not Set" || summary === "Not Calculated"
      ? "No Range / Spec"
      : summary;
  }, [activeResolvedTolerance, uutNominal]);

  return (
    <div className="configuration-panel">
      <div className="uut-measurement-grid">
        {/* 1. UUT INFORMATION */}
        <div className="panel-card uut-detail-card">
        <div className="panel-card-header">
          <div className="panel-card-title">
            <FontAwesomeIcon icon={faMicroscope} />
            <span>Unit Under Test</span>
          </div>
          <div className="panel-card-actions">
            {selectedUutIds.length > 0 && (
              <button
                className="btn-delete-selection"
                onClick={handleDeleteSelectedUuts}
                title={`Delete ${selectedUutIds.length} Selected UUTs`}
              >
                <FontAwesomeIcon icon={faTrashAlt} size="xs" />
              </button>
            )}
            <button
              className="btn-add-item"
              onClick={() =>
                onEditUut &&
                onEditUut(null, {
                  associateToPointId: testPointData.id,
                })
              }
              title="Add New UUT"
            >
              <FontAwesomeIcon icon={faPlus} size="xs" />
            </button>
          </div>
        </div>
        <div className="panel-table-container" style={{ maxHeight: "300px" }}>
          <table
            className="instrument-summary-table industry-table"
            onMouseLeave={() => {
              setHoveredCell({ tableId: null, colIndex: null });
              setHoveredRowId(null);
            }}
            style={{ tableLayout: "fixed" }}
          >
            <colgroup>
              <col style={{ width: "28%" }} />
              <col style={{ width: "42%" }} />
              <col style={{ width: "30%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Description</th>
                <th>Range</th>
                <th>Tolerance</th>
              </tr>
            </thead>
            <tbody>
              {relevantUuts.length === 0 ? (
                <tr className="panel-empty-row">
                  <td colSpan="3">No associated UUTs found.</td>
                </tr>
              ) : (
                relevantUuts.map((uut) => {
                  const { ranges, activeIndex, activeRange } =
                    resolveUutRange(uut);
                  const isLinked =
                    testPointData.associatedUutIds &&
                    testPointData.associatedUutIds.includes(uut.id);
                  const isActivePointUut =
                    testPointData.activeUutId === uut.id ||
                    (!testPointData.activeUutId &&
                      associatedUutIds[0] === uut.id);
                  const specRows = getSpecRows(activeRange);
                  const rowSpan = specRows.length > 0 ? specRows.length : 1;
                  const isSelected = selectedUutIds.includes(uut.id);

                  return (
                    <React.Fragment key={uut.id}>
                      <tr
                        className={`${isSelected ? `selected-row selected-instrument-start ${specRows.length <= 1 ? "selected-instrument-end" : ""}` : ""} ${isActivePointUut ? "active-point-uut-row" : ""} ${hoveredRowId === uut.id ? "row-hovered" : ""}`}
                        onMouseEnter={() => setHoveredRowId(uut.id)}
                        style={{
                          cursor: "pointer",
                        }}
                        onClick={(e) => handleUutClick(e, uut.id)}
                        onDoubleClick={() => onEditUut && onEditUut(uut)}
                        title="Click to select, Double-click to edit UUT details"
                      >
                        <td
                          rowSpan={rowSpan}
                          className={`cell-description ${hoveredCell.tableId === "uut_det" && hoveredCell.colIndex === 0 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "uut_det", colIndex: 0 })
                          }
                          style={{
                            color: isActivePointUut
                              ? "var(--primary-color)"
                              : isLinked
                                ? "var(--primary-color)"
                                : undefined,
                          }}
                        >
                          <div className="uut-description-content">
                            <span>{uut.description}</span>
                            {isActivePointUut && (
                              <span className="active-uut-badge">
                                Active UUT
                              </span>
                            )}
                          </div>
                        </td>

                        <td
                          rowSpan={rowSpan}
                          className={`cell-value ${hoveredCell.tableId === "uut_det" && hoveredCell.colIndex === 1 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "uut_det", colIndex: 1 })
                          }
                          onClick={(e) => e.stopPropagation()}
                        >
                          <select
                            className="session-selector"
                            value={activeIndex}
                            onChange={(e) =>
                              handleRangeChange(
                                uut.id,
                                parseInt(e.target.value),
                                ranges,
                                isActivePointUut,
                              )
                            }
                          >
                            {ranges.map((range, idx) => {
                              return (
                                <option key={idx} value={idx}>
                                  {formatRangeLabel(range, {
                                    preferBounds: true,
                                  })}
                                </option>
                              );
                            })}
                          </select>
                        </td>

                        <td
                          className={`cell-tolerance ${hoveredCell.tableId === "uut_det" && hoveredCell.colIndex === 2 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "uut_det", colIndex: 2 })
                          }
                          title={specRows[0]}
                        >
                          {specRows[0]}
                        </td>
                      </tr>

                      {specRows.slice(1).map((specComp, sIdx) => (
                        <tr
                          key={`${uut.id}-spec-${sIdx}`}
                          className={`spec-row ${isSelected ? `selected-spec-row selected-instrument-continuation ${sIdx === specRows.length - 2 ? "selected-instrument-end" : ""}` : ""} ${isActivePointUut ? "active-point-uut-spec-row" : ""} ${hoveredRowId === uut.id ? "hovered-spec-row" : ""}`}
                          onMouseEnter={() => setHoveredRowId(uut.id)}
                          style={{
                            cursor: "pointer",
                          }}
                        >
                          <td
                            className={`cell-spec ${hoveredCell.tableId === "uut_det" && hoveredCell.colIndex === 2 ? "col-hovered" : ""}`}
                            onMouseEnter={() =>
                              setHoveredCell({
                                tableId: "uut_det",
                                colIndex: 2,
                              })
                            }
                            style={{
                              borderTop: "1px dashed var(--border-color)",
                            }}
                            title={specComp}
                          >
                            {specComp}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        </div>

        {/* 2. MEASUREMENT POINT TABLE */}
        <div className="panel-card measurement-point-card">
        <div className="panel-card-header">
          <div className="panel-card-title">
            <FontAwesomeIcon icon={faRulerCombined} />
            <span>Measurement Point</span>
          </div>
          <div className="panel-card-actions">
            {!hasMeasurementPoint && (
              <button
                className="btn-add-item"
                onClick={handleActionAdd}
                title="Add Measurement Point"
              >
                <FontAwesomeIcon icon={faPlus} size="xs" />
              </button>
            )}
          </div>
        </div>
        <div className="panel-table-container">
          <table
            className="instrument-summary-table industry-table"
            style={{ width: "100%", tableLayout: "fixed" }}
          >
            <colgroup>
              {showSectionColumn && <col style={{ width: "24%" }} />}
              <col style={{ width: showSectionColumn ? "24%" : "30%" }} />
              <col style={{ width: showSectionColumn ? "14%" : "18%" }} />
              <col style={{ width: showSectionColumn ? "38%" : "52%" }} />
            </colgroup>
            <thead>
              <tr>
                {showSectionColumn && <th style={{ paddingLeft: "20px" }}>Section</th>}
                <th>Point</th>
                <th>Unit</th>
                <th>Tolerance</th>
              </tr>
            </thead>
            <tbody>
              {hasMeasurementPoint ? (
                <tr>
                  {showSectionColumn && (
                    <td style={{ paddingLeft: "20px" }}>
                      <div
                        style={{ fontWeight: 600, color: "var(--text-color)" }}
                      >
                        <EditableCell
                          value={testPointData.section}
                          onSave={(val) =>
                            onUpdateTestPoint &&
                            onUpdateTestPoint({ section: val })
                          }
                          placeholder="General"
                        />
                      </div>
                    </td>
                  )}

                  <td style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {/* Match the Section cell's weight/size so the two inline
                        inputs read as one cohesive set; the point keeps the
                        primary color to signal it's the nominal value. */}
                    <div
                      style={{
                        fontWeight: 600,
                        color: "var(--primary-color)",
                      }}
                    >
                      <EditableCell
                        value={uutNominal?.value}
                        onSave={(val) =>
                          onInlineUutUpdate && onInlineUutUpdate("nominal", val)
                        }
                        type="number"
                        placeholder="0.00"
                      />
                    </div>
                  </td>

                  <td>
                    <div style={{ fontWeight: 600, paddingLeft: "4px" }}>
                      {uutNominal?.unit}
                    </div>
                  </td>

                  <td>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      {isUnassigned &&
                      (!activeResolvedTolerance ||
                        Object.keys(activeResolvedTolerance).length === 0) ? (
                        <span
                          style={{
                            fontWeight: 400,
                            color: "var(--text-color-muted)",
                            fontStyle: "italic",
                          }}
                        >
                          No UUT / Spec
                        </span>
                      ) : (
                        <span
                          style={{
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            color: "var(--text-color)",
                          }}
                        >
                          {calculatedToleranceDisplay}
                        </span>
                      )}
                    </div>
                  </td>

                </tr>
              ) : (
                <tr className="panel-empty-row">
                  <td colSpan={showSectionColumn ? 4 : 3}>
                    No active point. Select a UUT range on the left and define a
                    point.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </div>
      </div>

      {/* --- MIDDLE ROW: EQUATION --- */}
      <div className="measurement-equation-section">
        {isDerived && equationDisplayData && (
          <div className="measurement-equation-block">
            <h3 className="panel-section-title">Measurement Equation</h3>
            <div className="measurement-equation-card measurement-equation-zoom-surface">
              <div className="scoped-zoom-content">
              <div className="add-point-equation-input measurement-equation-input-row">
                <input
                  ref={equationInputRef}
                  type="text"
                  className="measurement-equation-input"
                  value={equationDisplayData.equation}
                  onChange={(e) => handleEquationChange(e.target.value)}
                  placeholder="e.g. V / R or W * L"
                />
                <div className="measurement-equation-actions">
                  <button
                    type="button"
                    className="add-point-fx-button"
                    title="Insert function or symbol"
                    ref={symbolButtonRef}
                    onClick={handleSymbolMenuToggle}
                  >
                    f(x)
                  </button>
                  <button
                    type="button"
                    className="add-point-fx-button is-library"
                    title="Insert a common metrology equation"
                    ref={libraryButtonRef}
                    onClick={handleLibraryMenuToggle}
                  >
                    <FontAwesomeIcon icon={faBookOpen} />
                    Library
                  </button>
                </div>
              </div>
              {equationValidation &&
                (equationValidation.status === "invalid" ||
                  equationValidation.warnings.length > 0) && (
                <div
                  className="measurement-equation-validation"
                  role="status"
                  style={{ marginTop: "6px", fontSize: "0.84rem" }}
                >
                  {equationValidation.status === "invalid" ? (
                    <span style={{ color: "var(--status-bad, #dc2626)" }}>
                      <FontAwesomeIcon icon={faExclamationTriangle} />{" "}
                      {equationValidation.error}
                    </span>
                  ) : (
                    equationValidation.warnings.map((warning, idx) => (
                      <span
                        key={idx}
                        style={{ display: "block", color: "#b45309" }}
                      >
                        <FontAwesomeIcon icon={faExclamationTriangle} />{" "}
                        {warning}
                      </span>
                    ))
                  )}
                </div>
              )}
              {symbolMenu}
              {isLibraryOpen &&
                ReactDOM.createPortal(
                  <div
                    className="add-point-symbol-popover"
                    ref={libraryMenuRef}
                    style={{
                      top: libraryMenuPosition.top,
                      left: libraryMenuPosition.left,
                      maxHeight: "60vh",
                      overflowY: "auto",
                    }}
                  >
                    <EquationLibraryMenu
                      onSelect={handleLibrarySelect}
                      customEquations={customEquations}
                      onDeleteCustom={
                        onDeleteCustomEquation
                          ? handleDeleteCustomEquation
                          : undefined
                      }
                      onSaveCurrent={
                        onSaveCustomEquation
                          ? handleSaveCurrentEquation
                          : undefined
                      }
                      canSaveCurrent={equationValidation?.status === "ok"}
                      saveDisabledReason={
                        equationValidation?.status === "empty"
                          ? "Enter an equation in the editor first"
                          : equationValidation?.error || ""
                      }
                    />
                  </div>,
                  document.body,
                )}

              {equationDisplayData.variables.length > 0 && (
                <div className="var-map-grid measurement-equation-var-grid">
                  {equationDisplayData.variables.map((variable) => {
                    const requestedTmdeId =
                      equationTmdeSelections[variable.symbol];
                    const selectedTmde =
                      variable.assignedTmdes.find(
                        (tmde) => tmde.id === requestedTmdeId,
                      ) || variable.assignedTmdes[0];

                    return (
                      <div
                        key={variable.symbol}
                        className={`var-card-modern ${
                          variable.isAssigned ? "assigned" : "unassigned"
                        }`}
                      >
                        <div className="var-card-header">
                          <span className="var-symbol-badge">
                            {variable.symbol}
                          </span>
                          <input
                            type="text"
                            className="var-name-input"
                            value={variable.name || ""}
                            placeholder="Name this input"
                            onChange={(e) =>
                              handleVariableMappingChange(
                                variable.symbol,
                                e.target.value,
                              )
                            }
                            aria-label={`Display name for equation variable ${variable.symbol}`}
                          />
                        </div>
                        <div className="var-card-body">
                          <label className="measurement-equation-source-field">
                            <span>Measurement standard</span>
                            <select
                              className="var-source-select"
                              value={selectedTmde?.id || ""}
                              onChange={(e) =>
                                setEquationTmdeSelections((prev) => ({
                                  ...prev,
                                  [variable.symbol]: e.target.value,
                                }))
                              }
                              disabled={!variable.isAssigned}
                              aria-label={`TMDE for equation variable ${variable.symbol}`}
                            >
                              {!variable.isAssigned && (
                                <option value="">Assign a TMDE below</option>
                              )}
                              {variable.assignedTmdes.map((tmde) => (
                                <option key={tmde.id} value={tmde.id}>
                                  {getEquationTmdeLabel(tmde)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="measurement-equation-value-field">
                            <span>TMDE value</span>
                            <div className="var-value-display">
                              <input
                                type="number"
                                step="any"
                                className="var-value-input"
                                value={selectedTmde?.measurementPoint?.value ?? ""}
                                placeholder="Enter value"
                                disabled={!selectedTmde}
                                onChange={(e) =>
                                  handleSourceNominalUpdate(
                                    selectedTmde.id,
                                    "value",
                                    e.target.value,
                                  )
                                }
                                aria-label={`TMDE value for equation variable ${variable.symbol}`}
                              />
                              <span className="var-unit">
                                {selectedTmde?.measurementPoint?.unit || "—"}
                              </span>
                            </div>
                          </label>
                          <em
                            className={`measurement-equation-variable-status ${
                              variable.isAssigned ? "assigned" : "unassigned"
                            }`}
                          >
                            {variable.isAssigned
                              ? variable.assignedTmdes.length > 1
                                ? `${variable.assignedTmdes.length} assigned; switch above to compare values`
                                : "TMDE assigned"
                              : String(variable.name || "").trim()
                                ? "Assign a TMDE in the table below"
                                : "Name this input before assigning a TMDE"}
                          </em>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {calcStatus !== "neutral" && (
                <div
                  className="measurement-equation-status"
                  style={{
                    border: `1px solid ${calcStatusStyle.borderColor}`,
                    backgroundColor: calcStatusStyle.backgroundColor,
                    color: calcStatusStyle.color,
                  }}
                >
                  <div className="measurement-equation-status-main">
                    <FontAwesomeIcon icon={calcStatusStyle.icon} />
                    <span>
                      Calculated:{" "}
                      <strong>
                        {calculatedNominal?.toPrecision(6)} {uutNominal?.unit}
                      </strong>
                    </span>
                  </div>
                  <div className="measurement-equation-status-target">
                    (Target: {targetNominal?.toPrecision(6)} {uutNominal?.unit})
                  </div>
                </div>
              )}

              {calcExceedsRange && (
                <div
                  className="measurement-equation-status"
                  style={{
                    border: "1px solid var(--status-warning)",
                    backgroundColor: "rgba(255, 193, 7, 0.12)",
                    color: "var(--status-warning)",
                  }}
                >
                  <div className="measurement-equation-status-main">
                    <FontAwesomeIcon icon={faExclamationTriangle} />
                    <span>
                      Calculated value{" "}
                      <strong>
                        {calculatedNominal?.toPrecision(6)} {uutNominal?.unit}
                      </strong>{" "}
                      exceeds the UUT range (max {uutRangeMax?.toPrecision(6)}{" "}
                      {activeResolvedTolerance?.unit || uutNominal?.unit}) —
                      TUR/PFA will be meaningless. Check the source values or the
                      point setup.
                    </span>
                  </div>
                </div>
              )}

              {showMonteCarloSuggestion && (
                <div className="method-callout warn">
                  <div className="method-callout-main">
                    <FontAwesomeIcon icon={faExclamationTriangle} />
                    <span>
                      {isStationaryPointError
                        ? "This operating point is a stationary point of the equation — the linear (GUM) budget cannot evaluate it."
                        : "The linear (GUM) budget may understate uncertainty at this operating point:"}
                    </span>
                  </div>
                  {nonlinearityWarnings.length > 0 && (
                    <ul className="method-callout-list">
                      {nonlinearityWarnings.map((warning, idx) => (
                        <li key={idx}>{warning}</li>
                      ))}
                    </ul>
                  )}
                  <div className="method-callout-actions">
                    <button
                      type="button"
                      className="method-callout-btn"
                      onClick={() =>
                        onUpdateTestPoint({ propagationMode: "montecarlo" })
                      }
                    >
                      Re-evaluate with Monte Carlo
                    </button>
                    <span className="method-callout-hint">
                      GUM-S1 simulation will drive final budget and risk results.
                    </span>
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>
        )}

        {isDerived && propagationMode === "montecarlo" && !hasUnassignedVariables && (
          <MonteCarloCard
            testPointData={testPointData}
            tmdeTolerancesData={tmdeTolerancesData}
            manualComponents={testPointData.components || []}
            uutNominal={uutNominal}
            onUpdateTestPoint={onUpdateTestPoint}
          />
        )}
      </div>

      {/* --- BOTTOM ROW: TMDEs (Kept as is) --- */}
      <div style={{ marginBottom: "30px" }}>
        <div className="panel-card">
          <div className="panel-card-header">
            <div className="panel-card-title">
              <FontAwesomeIcon icon={faTools} />
              <span>Measurement Standards (TMDE)</span>
            </div>
            <div className="panel-card-actions">
              {selectedTmdeIds.length > 0 && (
                <button
                  className="btn-delete-selection"
                  onClick={handleDeleteSelectedTmdes}
                  title={`Delete ${selectedTmdeIds.length} Selected TMDEs`}
                >
                  <FontAwesomeIcon icon={faTrashAlt} size="xs" />
                </button>
              )}
              <button
                className="btn-add-item"
                onClick={onAddTmde}
                title="Add New TMDE"
              >
                <FontAwesomeIcon icon={faPlus} size="xs" />
              </button>
            </div>
          </div>

          <div className="panel-table-container">
            <table
              className="instrument-summary-table industry-table"
              onMouseLeave={() => {
                setHoveredCell({ tableId: null, colIndex: null });
                setHoveredRowId(null);
              }}
              style={{ tableLayout: "fixed" }}
            >
              <colgroup>
                {/* Direct points toggle usage. Derived points assign each
                    instrument to one mapped input; several instruments may
                    contribute to the same input budget. */}
                <col style={{ width: isDerived ? "24%" : "50px" }} />
                <col style={{ width: isDerived ? "30%" : "40%" }} />
                <col style={{ width: isDerived ? "22%" : "30%" }} />
                <col style={{ width: isDerived ? "24%" : "30%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ textAlign: isDerived ? "left" : "center" }}>
                    {isDerived ? "Assigned Input" : "Use"}
                  </th>
                  <th>Description</th>
                  <th>Range</th>
                  <th>Error Limit</th>
                </tr>
              </thead>
              <tbody>
                {relevantTmdes.length === 0 ? (
                  <tr className="panel-empty-row">
                    <td colSpan="4">
                      No TMDEs defined for this measurement area.
                    </td>
                  </tr>
                ) : (
                  relevantTmdes.map((masterTmde) => {
                    // Check selection state
                    const isSelectedRow = selectedTmdeIds.includes(
                      masterTmde.id,
                    );

                    const activeInstances = tmdeTolerancesData.filter(
                      (t) =>
                        t.id === masterTmde.id ||
                        (t.sourceId && t.sourceId === masterTmde.id),
                    );
                    const rowsToRender =
                      activeInstances.length > 0
                        ? activeInstances
                        : [masterTmde];

                    return rowsToRender.map((tmdeInstance, idx) => {
                      const isChecked = activeInstances.includes(tmdeInstance);
                      // const referencePoint = tmdeInstance.measurementPoint || { value: '', unit: '' }; // Removed unused reference

                      const savedTolerance = isChecked ? tmdeInstance : null;
                      const resolution = resolveUutRangeHelper(
                        masterTmde,
                        tmdeRangeIndices,
                        savedTolerance,
                        null,
                      );
                      const { ranges, activeIndex, activeRange } = resolution;
                      const compatibility = isDerived
                        ? { compatible: true, reason: "" }
                        : assessTmdeCompatibility(activeRange, uutNominal);

                      const effectiveTolerance = activeRange;
                      const specRows = getSpecRows(effectiveTolerance);
                      const rowSpan = specRows.length > 0 ? specRows.length : 1;

                      const safeDescription =
                        masterTmde.description ||
                        masterTmde.name ||
                        (masterTmde.instrument
                          ? `${masterTmde.instrument.manufacturer} ${masterTmde.instrument.model}`
                          : "Unknown TMDE");

                      return (
                        <React.Fragment key={`${masterTmde.id}-${idx}`}>
                          <tr
                            className={`tmde-row ${isChecked ? "active-point-tmde-row" : ""} ${isSelectedRow ? `selected-row selected-instrument-start ${specRows.length <= 1 ? "selected-instrument-end" : ""}` : ""} ${hoveredRowId === masterTmde.id ? "row-hovered" : ""}`}
                            onMouseEnter={() => setHoveredRowId(masterTmde.id)}
                            style={{
                              opacity: isChecked ? 1 : isSelectedRow ? 1 : 0.7,
                              cursor: "pointer",
                            }}
                            // Click Handlers
                            onClick={(e) => handleTmdeClick(e, masterTmde.id)}
                            onDoubleClick={(e) => {
                              // Don't open the editor when the user is double-
                              // clicking a value field (input/select) or an
                              // inline-editable cell to edit it in place.
                              if (
                                e.target.closest(
                                  'input, select, textarea, .editable-cell-display, .tmde-input-assignment',
                                )
                              )
                                return;
                              onEditTmde && onEditTmde(masterTmde);
                            }}
                            title="Click to select, Double-click to edit TMDE details"
                          >
                            <td
                              rowSpan={rowSpan}
                              style={{
                                textAlign: isDerived ? "left" : "center",
                                verticalAlign: "top",
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className={`${hoveredCell.tableId === "tmde_det" && hoveredCell.colIndex === 0 ? "col-hovered" : ""}`}
                              onMouseEnter={() =>
                                setHoveredCell({
                                  tableId: "tmde_det",
                                  colIndex: 0,
                                })
                              }
                            >
                              {isDerived ? (
                                <select
                                  className="tmde-input-assignment"
                                  value={
                                    isChecked
                                      ? tmdeInstance.variableType || ""
                                      : ""
                                  }
                                  onChange={(e) =>
                                    handleAssignTmdeToInput(
                                      masterTmde,
                                      e.target.value,
                                    )
                                  }
                                  aria-label={`Assign ${safeDescription} to equation input`}
                                >
                                  <option value="">Not used</option>
                                  {availableVariables.map((variableType) => (
                                    <option
                                      key={variableType}
                                      value={variableType}
                                    >
                                      {variableType}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  // Intentionally NOT disabled when incompatible:
                                  // a disabled checkbox swallows the click, so the
                                  // user gets no explanation. We keep it clickable
                                  // and explain why on attempt (see below).
                                  onChange={(e) => {
                                    if (
                                      !isChecked &&
                                      !compatibility.compatible
                                    ) {
                                      setNotification({
                                        title: "Can't Use This TMDE",
                                        message: `${compatibility.reason} Adjust the TMDE's range/unit (or the measurement point) so it covers this point, then try again.`,
                                      });
                                      return;
                                    }
                                    handleToggleTmdeUsage(
                                      masterTmde.id,
                                      e.target.checked,
                                    );
                                  }}
                                  title={
                                    compatibility.compatible
                                      ? "Use this TMDE"
                                      : `Can't use: ${compatibility.reason}`
                                  }
                                  style={{
                                    cursor:
                                      !isChecked && !compatibility.compatible
                                        ? "not-allowed"
                                        : "pointer",
                                    opacity:
                                      !isChecked && !compatibility.compatible
                                        ? 0.5
                                        : 1,
                                  }}
                                />
                              )}
                            </td>

                            <td
                              rowSpan={rowSpan}
                              className={`cell-description ${hoveredCell.tableId === "tmde_det" && hoveredCell.colIndex === 1 ? "col-hovered" : ""}`}
                              onMouseEnter={() =>
                                setHoveredCell({
                                  tableId: "tmde_det",
                                  colIndex: 1,
                                })
                              }
                            >
                              <div
                                style={{
                                  fontWeight: 600,
                                  color: isChecked
                                    ? "var(--primary-color)"
                                    : "var(--text-color)",
                                }}
                              >
                                {safeDescription}
                              </div>
                            </td>

                            <td
                              rowSpan={rowSpan}
                              className={`cell-value ${hoveredCell.tableId === "tmde_det" && hoveredCell.colIndex === 2 ? "col-hovered" : ""}`}
                              onMouseEnter={() =>
                                setHoveredCell({
                                  tableId: "tmde_det",
                                  colIndex: 2,
                                })
                              }
                              onClick={(e) => e.stopPropagation()}
                            >
                              <select
                                className="session-selector"
                                value={activeIndex}
                                onChange={(e) =>
                                  handleTmdeRangeChange(
                                    masterTmde,
                                    parseInt(e.target.value),
                                    ranges,
                                  )
                                }
                              >
                                {ranges.map((range, rIdx) => {
                                  // Show the actual measurement range (min–max),
                                  // not the spec string — the full spec already
                                  // lives in the Specification column.
                                  return (
                                    <option key={rIdx} value={rIdx}>
                                      {formatRangeLabel(range, {
                                        preferBounds: true,
                                      })}
                                    </option>
                                  );
                                })}
                              </select>
                            </td>

                            <td
                              className={`cell-tolerance ${hoveredCell.tableId === "tmde_det" && hoveredCell.colIndex === 3 ? "col-hovered" : ""}`}
                              onMouseEnter={() =>
                                setHoveredCell({
                                  tableId: "tmde_det",
                                  colIndex: 3,
                                })
                              }
                              title={specRows[0]}
                            >
                              {specRows[0]}
                            </td>
                          </tr>

                          {specRows.slice(1).map((specComp, sIdx) => (
                            <tr
                              key={`${masterTmde.id}-${idx}-spec-${sIdx}`}
                              className={`spec-row ${isChecked ? "active-point-tmde-spec-row" : ""} ${isSelectedRow ? `selected-spec-row selected-instrument-continuation ${sIdx === specRows.length - 2 ? "selected-instrument-end" : ""}` : ""} ${hoveredRowId === masterTmde.id ? "hovered-spec-row" : ""}`}
                              onMouseEnter={() =>
                                setHoveredRowId(masterTmde.id)
                              }
                              style={{
                                opacity: isChecked ? 1 : 0.7,
                              }}
                            >
                              <td
                                className={`${hoveredCell.tableId === "tmde_det" && hoveredCell.colIndex === 3 ? "col-hovered" : ""}`}
                                onMouseEnter={() =>
                                  setHoveredCell({
                                    tableId: "tmde_det",
                                    colIndex: 3,
                                  })
                                }
                                style={{
                                  borderTop: "1px dashed var(--border-color)",
                                }}
                                title={specComp}
                              >
                                {specComp}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    });
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {hasMeasurementPoint ? (
        hasUnassignedVariables || isBackendMappingError ? (
          <div
            className="placeholder-content"
            style={{ padding: "20px", color: "var(--text-color-muted)" }}
          >
            {hasUnassignedVariables
              ? "Map all equation variables to a TMDE above to calculate budget."
              : "Complete the equation configuration to calculate budget."}
          </div>
        ) : calculationError ? (
          <div className="form-section-warning">
            <p>Calculation Error: {calculationError}</p>
          </div>
        ) : (
          <>
            <UncertaintyBudgetTable
              components={calcResults?.calculatedBudgetComponents || []}
              onRemove={onRemoveComponent}
              onComponentUpdate={handleComponentUpdate}
              calcResults={calcResults}
              referencePoint={uutNominal}
              uncertaintyConfidence={sessionData.uncReq.uncertaintyConfidence}
              onRowContextMenu={onBudgetRowContextMenu}
              equationString={testPointData.equationString}
              measurementType={testPointData.measurementType}
              riskResults={riskResults}
              propagationMode={propagationMode}
              mcSummary={testPointData.mcSummary}
              onShowDerivedBreakdown={onShowDerivedBreakdown}
              onShowRiskBreakdown={onShowRiskBreakdown}
              showContribution={showContribution}
              setShowContribution={setShowContribution}
              hasTmde={tmdeTolerancesData.length > 0}
              onAddManualComponent={onAddManualComponent}
              onEdit={onEditManualComponent}
              onOpenRepeatability={onOpenRepeatability}
              onOpenCorrelation={onOpenCorrelation}
              setNotification={setNotification}
              onBudgetSettingsChange={onUpdateTestPoint}
              useEffectiveDofByGroup={
                testPointData.useEffectiveDofByGroup || {}
              }
            />
            {showContribution &&
              calcResults?.calculatedBudgetComponents?.length > 0 && (
                <PercentageBarGraph
                  type={testPointData.measurementType === "derived"}
                  unit={uutNominal?.unit || "Units"}
                  data={Object.fromEntries(
                    calcResults.calculatedBudgetComponents.map((item) => {
                      const value =
                        testPointData.measurementType === "derived"
                          ? item.contribution || 0
                          : item.value_native || item.value || 0;
                      const label = item.name.startsWith("Input: ")
                        ? item.name.substring(7)
                        : item.name;
                      return [label, value];
                    }),
                  )}
                />
              )}
          </>
        )
      ) : (
        <div
          className="placeholder-content"
          style={{
            marginTop: "30px",
            borderTop: "1px solid var(--border-color)",
            paddingTop: "30px",
          }}
        >
          <h3>Ready to Measure</h3>
          <p>
            Select a UUT Specification Range (top left) and define a Measurement
            Point (top right) to begin analysis.
          </p>
        </div>
      )}
    </div>
  );
}

const UncertaintyPanel = (props) => {
  const {
    testPointData,
    sessionData,
    onDefineTestPoint,
    onDeleteTestPoint,
    onSaveTestPoint,
  } = props;
  const viewMode = testPointData.viewMode || "point";

  if (viewMode !== "point") {
    return (
      <SummaryDashboard
        viewMode={viewMode}
        contextId={testPointData.id}
        rangeData={testPointData.rangeData}
        uutId={testPointData.uutId}
        sessionData={sessionData}
        onDefineTestPoint={onDefineTestPoint}
        onDeleteTestPoint={onDeleteTestPoint}
        onSaveTestPoint={onSaveTestPoint}
        onEditSession={props.handleOpenSessionEditor}
        selectedPointIds={props.selectedTablePointIds || []}
        setSelectedPointIds={props.setSelectedTablePointIds || (() => {})}
        // Global UUT Selection for Sidebar Quick Add
        currentUutSelection={props.currentUutSelection}
        setCurrentUutSelection={props.setCurrentUutSelection}
        // Navigation Handlers
        onSelectUut={props.onSelectUut}
        onSelectTestPoint={props.onSelectTestPoint}
        // New Actions Passed Down
        onDeleteUut={props.onDeleteUut}
        onDeleteTmdeDefinition={props.onDeleteTmdeDefinition}
        onEditUut={props.onEditUut}
        onEditTmde={props.onEditTmde}
        onAddTmde={props.onAddTmde}
      />
    );
  }

  return (
    <DetailedView
      {...props}
      onAddTmde={props.onAddTmde}
      onEditUut={props.onEditUut}
      onEditTmde={props.onEditTmde}
      onDeleteUut={props.onDeleteUut}
      onDeleteTmdeDefinition={props.onDeleteTmdeDefinition}
    />
  );
};

export default UncertaintyPanel;
