/**
 * src/features/analysis/components/UncertaintyPanel.jsx
 */
import React, {
  useState,
  useEffect,
  useLayoutEffect,
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
  faLink,
  faLinkSlash,
  faChevronDown,
  faCopy,
  faPaste,
  faScissors,
  faEye,
  faEyeSlash,
} from "@fortawesome/free-solid-svg-icons";
import ContextMenu from "../../../components/common/ContextMenu";
import { formatRangeLabel } from "../../../utils/rangeFormatting";
import { getNextInstrumentSelection } from "../../../utils/instrumentSelection";
import {
  assessRangeCompatibility,
  assessTmdeCompatibility,
} from "../../../utils/tmdeCompatibility";
import { resolvePointAreaId } from "../../../utils/areaWorkspace";
import {
  functionKeyOf,
  makeFunctionKey,
  instrumentFunctions,
  instrumentHasFunction,
  resolveSessionFunctions,
  functionsForLibrary,
} from "../../../utils/functionGrouping";
import { createInstanceFromDefinition } from "../../../utils/instrumentFactory";
import { getInstrumentRangeRows } from "../../../utils/instrumentFunctionSelection";

// --- Constants ---
const customUnitSelectStyles = {
  menuPortal: (base) => ({ ...base, zIndex: 99999 }),
  menu: (base) => ({
    ...base,
    zIndex: 99999,
    width: "max-content",
    minWidth: "100%",
  }),
  menuList: (base) => ({
    ...base,
    overflowX: "hidden",
  }),
  control: (base) => ({
    ...base,
    minHeight: "24px",
    height: "24px",
    fontSize: "0.85rem",
    backgroundColor: "transparent",
    borderColor: "var(--border-color)",
    color: "var(--text-color)",
    boxShadow: "none",
    "&:hover": {
      borderColor: "var(--primary-color)",
    },
  }),
  valueContainer: (base) => ({
    ...base,
    height: "24px",
    padding: "0 4px",
    display: "flex",
    alignItems: "center",
  }),
  singleValue: (base) => ({
    ...base,
    color: "var(--text-color)",
    margin: 0,
  }),
  input: (base) => ({
    ...base,
    color: "var(--text-color)",
    margin: 0,
    padding: 0,
  }),
  indicatorsContainer: (base) => ({
    ...base,
    height: "24px",
  }),
  dropdownIndicator: (base) => ({
    ...base,
    padding: "0 4px",
    color: "var(--text-color-muted)",
  }),
  clearIndicator: (base) => ({
    ...base,
    padding: "0 2px",
  }),
  indicatorSeparator: () => ({ display: "none" }),
  option: (base) => ({
    ...base,
    whiteSpace: "nowrap",
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
  unitFilterOption,
  errorDistributions,
} from "../../../utils/uncertaintyMath";
import { oldErrorDistributions } from "../utils/budgetUtils";
import {
  computeSyncState,
  buildValidatedSnapshot,
  diffFromSnapshot,
} from "../../../utils/instrumentSync";
import { v4 as uuidv4 } from "uuid";
import useInstrumentSync from "../../../hooks/useInstrumentSync";

// Auto-assigned colors for areas created on the fly when a picked library
// instrument brings a measurement area the session doesn't have yet.
const AREA_PALETTE = [
  "#3498db", "#e67e22", "#2ecc71", "#9b59b6",
  "#e74c3c", "#1abc9c", "#f1c40f", "#34495e",
];

// Cross-view clipboard for cut/copy/paste of UUT/TMDE instrument rows. Kept at
// module scope (not React state) so a copy in one table view can be pasted in
// another, and so it doesn't trigger re-renders on its own.
//   { kind: "uut"|"tmde", mode: "copy"|"cut", item }
let instrumentClipboard = null;

// Cross-view clipboard for copy/cut/paste of a single RANGE row (distinct from
// the instrument clipboard above). Lets the user build one range and duplicate
// it across an instrument's many ranges.  { kind: "uut"|"tmde", range }
let rangeClipboard = null;

// Build a pasted instrument row. "copy" gets fresh ids (a true duplicate);
// "cut" preserves the original id (a move) and is applied to the source row.
const buildPastedInstrumentRow = (src, kind, area, mode) => {
  const areaFields =
    kind === "uut"
      ? {
          measurementAreaId: area ? area.id : "",
          measurementArea: area ? area.name : "",
          measurementAreaColor: area ? area.color : "",
        }
      : {
          measurementAreaId: area ? area.id : "",
          measurementArea: area ? area.name : "",
        };
  const nestedArea =
    kind === "tmde"
      ? {
          measurementArea: area ? area.name : src.instrument?.measurementArea || "",
          measurementAreaColor: area
            ? area.color
            : src.instrument?.measurementAreaColor || "",
        }
      : {};
  if (mode === "cut") {
    return {
      ...src,
      ...areaFields,
      instrument: src.instrument
        ? { ...src.instrument, ...nestedArea }
        : src.instrument,
    };
  }
  return {
    ...src,
    id: uuidv4(),
    ...areaFields,
    instrument: src.instrument
      ? { ...src.instrument, id: uuidv4(), ...nestedArea }
      : src.instrument,
  };
};

const scopeLibraryInstrumentToFunction = (instrument = {}, functionKey, fallbackFn = {}) => {
  if (!functionKey) return instrument;
  const functions = Array.isArray(instrument.functions) ? instrument.functions : [];
  const match = functions.find(
    (fn) => makeFunctionKey(fn.name, fn.unit) === functionKey,
  );
  const fallbackName = fallbackFn.name || "";
  const fallbackUnit = fallbackFn.unit || "";
  const matchingRangeRows = match
    ? []
    : getInstrumentRangeRows(instrument).filter(
        (range) =>
          makeFunctionKey(
            range.functionName || fallbackName,
            range.functionUnit || range.unit || fallbackUnit,
          ) === functionKey,
      );
  const scopedFunction = match
    ? { ...match, ranges: Array.isArray(match.ranges) ? match.ranges : [] }
    : matchingRangeRows.length > 0
      ? {
          id: uuidv4(),
          name: matchingRangeRows[0].functionName || fallbackName,
          unit:
            matchingRangeRows[0].functionUnit ||
            matchingRangeRows[0].unit ||
            fallbackUnit,
          ranges: matchingRangeRows.map(({ source, _index, ...range }) => range),
        }
    : {
        id: uuidv4(),
        name: fallbackName,
        unit: fallbackUnit,
        ranges: [],
      };
  return {
    ...instrument,
    functions: [scopedFunction],
  };
};

// Library-search dropdown shown under the description make/model fields.
// Portaled to <body> with fixed positioning so the cell's overflow:hidden
// (App.css) can't clip it. Position/top/left are set inline at render.
const descSearchDropdownStyle = {
  minWidth: "260px",
  zIndex: 99999,
  background: "var(--component-bg)",
  border: "1px solid var(--border-color)",
  borderRadius: "6px",
  boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
  maxHeight: "240px",
  overflowY: "auto",
};
const descSearchItemStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "6px 10px",
  cursor: "pointer",
  fontSize: "0.85rem",
  borderBottom: "1px solid var(--border-color)",
};

const buildGroupedUnitOptions = () => {
  const allSupportedUnits = Object.keys(unitSystem.units);
  const options = [];
  const usedUnits = new Set();

  Object.entries(unitCategories).forEach(([category, units]) => {
    const validUnits = units.filter((unit) => allSupportedUnits.includes(unit));
    if (validUnits.length > 0) {
      options.push({
        label: category,
        options: validUnits.map((unit) => {
          usedUnits.add(unit);
          return { value: unit, label: getUnitDisplayLabel(unit) };
        }),
      });
    }
  });

  const leftovers = allSupportedUnits
    .filter((unit) => !usedUnits.has(unit))
    .sort()
    .map((unit) => ({ value: unit, label: getUnitDisplayLabel(unit) }));

  if (leftovers.length > 0) options.push({ label: "Other", options: leftovers });
  return options;
};

const UnitSelect = ({ value = "", onChange, ariaLabel = "Unit", width = null }) => {
  const groupedUnitOptions = useMemo(() => buildGroupedUnitOptions(), []);
  const flatUnitOptions = useMemo(
    () => groupedUnitOptions.flatMap((group) => group.options || []),
    [groupedUnitOptions],
  );
  const selectedOption =
    flatUnitOptions.find((option) => option.value === value) || null;
  const unitWidth = useMemo(() => {
    const longestLabelLength = Math.max(
      4,
      ...flatUnitOptions.map((option) => String(option.label || option.value || "").length),
    );
    return `${Math.min(longestLabelLength + 5, 14)}ch`;
  }, [flatUnitOptions]);

  return (
    <div
      className="inline-unit-select"
      onMouseDown={(e) => e.stopPropagation()}
      aria-label={ariaLabel}
      style={{ "--inline-unit-width": width || unitWidth }}
    >
      <Select
        value={selectedOption}
        onChange={(option) => onChange(option ? option.value : "")}
        options={groupedUnitOptions}
        filterOption={unitFilterOption}
        placeholder="Unit"
        className="react-select-container inline-unit-react-select"
        classNamePrefix="react-select"
        menuPortalTarget={document.body}
        menuPosition="fixed"
        styles={customUnitSelectStyles}
      />
    </div>
  );
};

// Read/write a UUT/TMDE's tolerance for a specific range, matched by range id.
// The summary tables edit the INSTRUMENT's range spec directly (range.tolerances)
// — this is the canonical spec, distinct from per-point overrides (a detail-view
// concern). Handles the common instrument.functions[].ranges[] shape plus the
// instrument.ranges / item.ranges / single-default fallbacks.
const sameId = (a, b) => String(a) === String(b);
const rangeStateKey = (kind, itemId, rangeId) =>
  `${kind}:${itemId || ""}:${rangeId || "default"}`;
const itemStateKey = (kind, itemId) => `${kind}:${itemId || ""}`;
const cleanFunctionName = (value) => String(value || "").trim();
const functionNameMatches = (a, b) =>
  cleanFunctionName(a).toLowerCase() === cleanFunctionName(b).toLowerCase();
const cleanAreaName = (value) => String(value || "").trim();
const areaNameKey = (value) => cleanAreaName(value).toLowerCase();

const findCanonicalArea = (areas = [], area = {}) => {
  const byId = area?.id
    ? areas.find((candidate) => String(candidate.id) === String(area.id))
    : null;
  if (byId) return byId;

  const key = areaNameKey(area?.name);
  return key
    ? areas.find((candidate) => areaNameKey(candidate.name) === key) || null
    : null;
};

const referencesArea = (record = {}, area = {}, canonicalArea = null) => {
  const areaIds = [area?.id, canonicalArea?.id]
    .filter(Boolean)
    .map((id) => String(id));
  const areaNames = [area?.name, canonicalArea?.name]
    .map(areaNameKey)
    .filter(Boolean);
  const hasId = (id) => id && areaIds.includes(String(id));
  const hasName = (name) => {
    const key = areaNameKey(name);
    return key && areaNames.includes(key);
  };

  return (
    hasId(record.measurementAreaId) ||
    hasName(record.measurementArea) ||
    hasId(record.instrument?.measurementAreaId) ||
    hasName(record.instrument?.measurementArea)
  );
};
const getItemRangeTolerance = (item, rangeId) => {
  const inst = item?.instrument || {};
  const find = (ranges) => (ranges || []).find((r) => sameId(r.id, rangeId));
  if (Array.isArray(inst.functions)) {
    for (const fn of inst.functions) {
      const r = find(fn.ranges);
      if (r) return r.tolerances || r.tolerance || {};
    }
  }
  const r2 = find(inst.ranges);
  if (r2) return r2.tolerances || r2.tolerance || {};
  const r3 = find(item?.ranges);
  if (r3) return r3.tolerances || r3.tolerance || {};
  return item?.tolerance || inst.tolerance || {};
};
// The raw stored range object (clean min/max/unit/resolution + nested
// tolerances), used by the range clipboard so a paste duplicates the real range
// rather than the resolved/flattened render copy.
const findItemRange = (item, rangeId) => {
  const inst = item?.instrument || {};
  const find = (ranges) => (ranges || []).find((r) => sameId(r.id, rangeId));
  if (Array.isArray(inst.functions)) {
    for (const fn of inst.functions) {
      const r = find(fn.ranges);
      if (r) return r;
    }
  }
  return find(inst.ranges) || find(item?.ranges) || null;
};
const makeSeededRange = (item, inst = {}, rangePatch = {}) => ({
  id: uuidv4(),
  min: "",
  max: "",
  unit: "",
  resolution: "",
  tolerances: item?.tolerance || inst.tolerance || {},
  ...rangePatch,
});

export const applyItemRangeFunction = (item, rangeId, rawFunctionName) => {
  const inst = item?.instrument || {};
  const nextName = cleanFunctionName(rawFunctionName);
  const rangeMatches = (range) =>
    sameId(range?.id, rangeId) || sameId(range?.rangeId, rangeId);
  const functions = Array.isArray(inst.functions) ? inst.functions : [];

  if (functions.length > 0) {
    const sourceIndex = functions.findIndex((fn) =>
      (fn.ranges || []).some(rangeMatches),
    );
    const targetIndex = nextName
      ? functions.findIndex((fn) => functionNameMatches(fn.name, nextName))
      : -1;

    if (sourceIndex >= 0) {
      if (targetIndex >= 0 && targetIndex !== sourceIndex) {
        const rangeToMove = (functions[sourceIndex].ranges || []).find(rangeMatches);
        if (!rangeToMove) return item;
        return {
          ...item,
          instrument: {
            ...inst,
            functions: functions
              .map((fn, index) => {
                if (index === sourceIndex) {
                  return {
                    ...fn,
                    ranges: (fn.ranges || []).filter((range) => !rangeMatches(range)),
                  };
                }
                if (index === targetIndex) {
                  return {
                    ...fn,
                    ranges: [
                      ...(fn.ranges || []),
                      {
                        ...rangeToMove,
                        unit: rangeToMove.unit || fn.unit || functions[sourceIndex].unit || "",
                      },
                    ],
                  };
                }
                return fn;
              })
              .filter((fn, index) => index !== sourceIndex || (fn.ranges || []).length > 0),
          },
        };
      }

      return {
        ...item,
        instrument: {
          ...inst,
          functions: functions.map((fn, index) =>
            index === sourceIndex ? { ...fn, name: nextName } : fn,
          ),
        },
      };
    }

    const seededRange = makeSeededRange(item, inst, {
      unit: functions[targetIndex >= 0 ? targetIndex : 0]?.unit || "",
    });
    const appendIndex = targetIndex >= 0 ? targetIndex : 0;
    return {
      ...item,
      instrument: {
        ...inst,
        functions: functions.map((fn, index) =>
          index === appendIndex
            ? {
                ...fn,
                name: targetIndex >= 0 ? fn.name : nextName,
                ranges: [...(fn.ranges || []), seededRange],
              }
            : fn,
        ),
      },
    };
  }

  if (Array.isArray(inst.ranges) && inst.ranges.length > 0) {
    const matched = inst.ranges.find(rangeMatches) || inst.ranges[0];
    const remaining = inst.ranges.filter((range) => range !== matched);
    const { ranges: _legacyRanges, ...restInst } = inst;
    return {
      ...item,
      instrument: {
        ...restInst,
        functions: [
          {
            id: uuidv4(),
            name: nextName,
            unit: matched.unit || "",
            ranges: [matched],
          },
          ...(remaining.length
            ? [
                {
                  id: uuidv4(),
                  name: "",
                  unit: remaining[0]?.unit || "",
                  ranges: remaining,
                },
              ]
            : []),
        ],
      },
    };
  }

  const seededRange = makeSeededRange(item, inst);
  return {
    ...item,
    instrument: {
      ...inst,
      functions: [
        {
          id: uuidv4(),
          name: nextName,
          unit: seededRange.unit || "",
          ranges: [seededRange],
        },
      ],
    },
  };
};

// Merge a shallow patch into the matched range (e.g. {tolerances}, {resolution}).
export const applyItemRangePatch = (item, rangeId, rangePatch) => {
  const inst = item?.instrument || {};
  const has = (ranges) => (ranges || []).some((r) => sameId(r.id, rangeId));
  const patch = (ranges) =>
    (ranges || []).map((r) =>
      sameId(r.id, rangeId) ? { ...r, ...rangePatch } : r,
    );
  if (Array.isArray(inst.functions) && inst.functions.some((fn) => has(fn.ranges))) {
    return {
      ...item,
      instrument: {
        ...inst,
        functions: inst.functions.map((fn) =>
          has(fn.ranges) ? { ...fn, ranges: patch(fn.ranges) } : fn,
        ),
      },
    };
  }
  if (has(inst.ranges)) {
    return { ...item, instrument: { ...inst, ranges: patch(inst.ranges) } };
  }
  if (has(item?.ranges)) {
    return { ...item, ranges: patch(item.ranges) };
  }
  // No matching range. A pure tolerance edit has a sensible flat home, but a
  // freshly added inline instrument has no real range yet (its row renders a
  // synthetic "default" range), so a unit/min/max/resolution edit would patch
  // nothing and be silently dropped. Materialize a range to carry the edit.
  const isToleranceOnly =
    rangePatch.tolerances !== undefined &&
    Object.keys(rangePatch).length === 1;
  if (isToleranceOnly) {
    return { ...item, tolerance: rangePatch.tolerances };
  }
  const seededRange = {
    id: uuidv4(),
    min: "",
    max: "",
    unit: "",
    resolution: "",
    tolerances: item?.tolerance || inst.tolerance || {},
    ...rangePatch,
  };
  const existingFunctions = Array.isArray(inst.functions) ? inst.functions : [];
  if (existingFunctions.length > 0) {
    // Attach to the first function so units stay grouped under it.
    return {
      ...item,
      instrument: {
        ...inst,
        functions: existingFunctions.map((fn, i) =>
          i === 0
            ? {
                ...fn,
                unit: fn.unit || rangePatch.unit || "",
                ranges: [...(fn.ranges || []), seededRange],
              }
            : fn,
        ),
      },
    };
  }
  return {
    ...item,
    instrument: {
      ...inst,
      functions: [
        { id: uuidv4(), name: "", unit: rangePatch.unit || "", ranges: [seededRange] },
      ],
    },
  };
};
const applyItemRangeTolerance = (item, rangeId, tolerance) =>
  applyItemRangePatch(item, rangeId, { tolerances: tolerance });

// Copy a tolerance's TERM STRUCTURE but blank the numbers, so a freshly-added
// range inherits the same tolerance components (e.g. %IV + %FS + Floor) as the
// range it was added from — the user just fills in values. Keeps each term's
// unit/distribution/symmetric shape; drops sub-tolerance arrays (would carry
// values) and preserves scalar config like bandDistribution.
const blankToleranceFrom = (sourceTol = {}) => {
  if (!sourceTol || typeof sourceTol !== "object") return {};
  const out = {};
  Object.entries(sourceTol).forEach(([key, comp]) => {
    if (Array.isArray(comp)) return;
    if (comp && typeof comp === "object") {
      const next = { ...comp };
      if ("high" in next) next.high = "";
      if ("low" in next) next.low = "";
      if ("value" in next) next.value = "";
      out[key] = next;
    } else {
      out[key] = comp;
    }
  });
  return out;
};

// Add a blank range alongside the active range (same function), or remove one.
// Returns { item, newRangeId? }. At least one range is always kept.
const addRangeToItem = (item, activeRangeId) => {
  const inst = item?.instrument || {};
  const seededTolerances = blankToleranceFrom(getItemRangeTolerance(item, activeRangeId));
  const newRange = { id: uuidv4(), min: "", max: "", unit: "", resolution: "", tolerances: seededTolerances };
  if (Array.isArray(inst.functions) && inst.functions.length) {
    let fnIdx = inst.functions.findIndex((fn) =>
      (fn.ranges || []).some((r) => sameId(r.id, activeRangeId)),
    );
    if (fnIdx < 0) fnIdx = 0;
    const functions = inst.functions.map((fn, i) =>
      i === fnIdx
        ? { ...fn, ranges: [...(fn.ranges || []), { ...newRange, unit: fn.unit || "" }] }
        : fn,
    );
    return { item: { ...item, instrument: { ...inst, functions } }, newRangeId: newRange.id };
  }
  if (Array.isArray(inst.ranges)) {
    return {
      item: { ...item, instrument: { ...inst, ranges: [...inst.ranges, newRange] } },
      newRangeId: newRange.id,
    };
  }
  // No structured ranges yet: seed a functions array so future ranges nest cleanly.
  const existingTol = item.tolerance || inst.tolerance || {};
  const seeded = [
    { id: uuidv4(), min: "", max: "", unit: "", resolution: "", tolerances: existingTol },
    newRange,
  ];
  return {
    item: { ...item, instrument: { ...inst, functions: [{ id: uuidv4(), name: "", ranges: seeded }] } },
    newRangeId: newRange.id,
  };
};

// Deep-clone a range for the range clipboard / paste, with a fresh id so the
// pasted copy is an independent duplicate.
const cloneRangeForPaste = (range = {}) => {
  const clone = JSON.parse(JSON.stringify(range || {}));
  clone.id = uuidv4();
  return clone;
};

// Append a pasted (cloned) range next to the active range, mirroring
// addRangeToItem's function/array placement. Returns { item, newRangeId }.
const pasteRangeIntoItem = (item, activeRangeId, clipRange) => {
  const inst = item?.instrument || {};
  const newRange = cloneRangeForPaste(clipRange);
  if (Array.isArray(inst.functions) && inst.functions.length) {
    let fnIdx = inst.functions.findIndex((fn) =>
      (fn.ranges || []).some((r) => sameId(r.id, activeRangeId)),
    );
    if (fnIdx < 0) fnIdx = 0;
    const functions = inst.functions.map((fn, i) =>
      i === fnIdx ? { ...fn, ranges: [...(fn.ranges || []), newRange] } : fn,
    );
    return { item: { ...item, instrument: { ...inst, functions } }, newRangeId: newRange.id };
  }
  if (Array.isArray(inst.ranges)) {
    return {
      item: { ...item, instrument: { ...inst, ranges: [...inst.ranges, newRange] } },
      newRangeId: newRange.id,
    };
  }
  return {
    item: { ...item, instrument: { ...inst, functions: [{ id: uuidv4(), name: "", ranges: [newRange] }] } },
    newRangeId: newRange.id,
  };
};

const removeRangeFromItem = (item, rangeId) => {
  const inst = item?.instrument || {};
  const filt = (ranges) => (ranges || []).filter((r) => !sameId(r.id, rangeId));
  if (Array.isArray(inst.functions)) {
    const total = inst.functions.reduce((n, fn) => n + (fn.ranges || []).length, 0);
    if (total <= 1) return item; // never remove the last range
    return {
      ...item,
      instrument: {
        ...inst,
        functions: inst.functions.map((fn) => ({ ...fn, ranges: filt(fn.ranges) })),
      },
    };
  }
  if (Array.isArray(inst.ranges) && inst.ranges.length > 1) {
    return { ...item, instrument: { ...inst, ranges: filt(inst.ranges) } };
  }
  if (Array.isArray(item.ranges) && item.ranges.length > 1) {
    return { ...item, ranges: filt(item.ranges) };
  }
  return item;
};

// Render a number without scientific notation (e.g. "1e-7" -> "0.0000001") for
// display in editable cells. Non-numeric values pass through unchanged.
const toPlainNumber = (v) => {
  if (v === "" || v == null) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (n !== 0 && Math.abs(n) < 1e-4) {
    return n.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
  }
  return String(n);
};

// reading/range/floor share one "spec band" distribution (see ToleranceForm);
// surface its human label for the Distribution column. dB/manual keep their own
// and are only edited in the tolerance popover.
const BAND_DIST_KEYS = ["reading", "readings_iv", "range", "floor"];
// The spec-band divisor value (e.g. "1.732"). Returns null when the tolerance
// carries no band component (so the cell can render an em-dash, not a dropdown).
const getBandDistDivisor = (tolerance = {}) => {
  if (!tolerance || typeof tolerance !== "object") return null;
  const key = BAND_DIST_KEYS.find((k) => tolerance[k]);
  if (key) return tolerance[key].distribution || "1.732";
  return tolerance.bandDistribution || null;
};
const getBandDistLabel = (tolerance = {}) => {
  const divisor = getBandDistDivisor(tolerance);
  if (!divisor) return "—";
  return (
    errorDistributions.find((e) => e.value === String(divisor))?.label ||
    `k=${divisor}`
  );
};
// Write a new band divisor across all present band components of a tolerance.
const applyBandDistribution = (tolerance = {}, value) => {
  const next = { ...tolerance };
  let touched = false;
  BAND_DIST_KEYS.forEach((k) => {
    if (next[k]) {
      next[k] = { ...next[k], distribution: value };
      touched = true;
    }
  });
  if (!touched) next.bandDistribution = value;
  return next;
};

// Green/red/none sync indicator for a UUT/TMDE row, from its validated-library
// linkage (feature/inline-instrument-tables). Nested under .instrument when the
// row carries a full instrument definition.
const SyncBadge = ({ item, onSync }) => {
  // Two states only: green (in sync with the shared library) or red (out of
  // sync — a local-only / diverged instrument that can be synced).
  const state = computeSyncState(item?.instrument || item || {});
  const green = state === "green";
  return (
    <button
      type="button"
      className={`inline-sync-badge ${
        green ? "inline-sync-badge--green" : "inline-sync-badge--red"
      }`}
      onClick={(event) => {
        event.stopPropagation();
        onSync?.();
      }}
      disabled={!onSync}
      title={
        green
          ? "In sync with shared library"
          : "Out of sync (local) - click to sync to the shared library"
      }
      aria-label={
        green
          ? "In sync with shared library"
          : "Out of sync (local) - sync to the shared library"
      }
    >
      <FontAwesomeIcon icon={green ? faLink : faLinkSlash} />
    </button>
  );
};

const syncDiffSummary = (diffs = []) => {
  if (!diffs.length) return "This instrument will be promoted to the shared library.";
  const fields = diffs.map((diff) => diff.field).join(", ");
  return `Changed shared-library fields: ${fields}.`;
};

// Route a potentially-destructive (or easy-to-misclick) action through the
// shared notification modal so it always asks first. Falls back to running the
// action directly if no notification setter is available.
const confirmViaNotification = (
  setNotification,
  { title, message, confirmText = "Confirm", onConfirm },
) => {
  if (!setNotification) {
    onConfirm?.();
    return;
  }
  setNotification({
    title,
    message,
    confirmText,
    secondaryText: "Cancel",
    onConfirm: () => {
      setNotification(null);
      onConfirm?.();
    },
    onSecondary: () => setNotification(null),
  });
};

// Inline-editable Description cell: make / model / name as three tabbable
// sub-fields (feature/inline-instrument-tables). Edits stay local while typing
// and commit on blur, so we PUT the session once per field, not per keystroke.
// `onCommit(field, value)` receives field ∈ {make, model, name}.
// Per-area (+) button in the subsection header (replaces the instrument count).
// pointerEvents:auto is required because the area-section row sets
// `pointer-events:none` (App.css) — without this the button is unclickable.
const inlineAreaAddBtnStyle = {
  marginLeft: "8px",
  background: "transparent",
  border: "1px solid var(--border-color)",
  borderRadius: "4px",
  color: "var(--text-color-muted)",
  cursor: "pointer",
  padding: "0 7px",
  fontSize: "0.72rem",
  lineHeight: "1.6",
  pointerEvents: "auto",
};
const inlineDescInputStyle = {
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: "4px",
  padding: "2px 5px",
  color: "var(--text-color)",
  font: "inherit",
  width: "100%",
};
const EditableDescriptionCell = ({
  make = "",
  model = "",
  name = "",
  onCommit,
  instruments = [],
  onPickLibrary,
}) => {
  const [local, setLocal] = useState({ make, model, name });
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  useEffect(() => {
    setLocal({ make, model, name });
  }, [make, model, name]);

  // Live library matches as the user types (make/model/name). Token-AND search
  // over the user's local + shared library (the `instruments` prop).
  const query = `${local.make || ""} ${local.model || ""} ${local.name || ""}`
    .trim()
    .toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);
  const results = useMemo(() => {
    if (!onPickLibrary || !tokens.length) return [];
    const matches = (instruments || []).filter((inst) => {
      const hay = `${inst.manufacturer || ""} ${inst.model || ""} ${
        inst.description || ""
      }`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
    // Collapse each shared instrument and its linked local copies into one
    // "family": always surface the shared (in-sync) version, and only also list
    // a local when it actually diverges from shared (the changed version). This
    // stops an auto-created, unchanged local copy from hiding the shared entry.
    const families = new Map();
    const standalone = [];
    matches.forEach((inst) => {
      const family =
        inst.sourceId || (inst.scope === "validated" ? inst.id : null);
      if (!family) {
        standalone.push(inst);
        return;
      }
      if (!families.has(family)) families.set(family, { shared: null, locals: [] });
      const grp = families.get(family);
      if (inst.scope === "validated") grp.shared = inst;
      else grp.locals.push(inst);
    });
    const ordered = [];
    families.forEach((grp) => {
      if (grp.shared) ordered.push(grp.shared);
      grp.locals.forEach((loc) => {
        if (!grp.shared || diffFromSnapshot(loc).length > 0) ordered.push(loc);
      });
    });
    return [...ordered, ...standalone].slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instruments, query, onPickLibrary]);

  const props = (field) => ({
    value: local[field] || "",
    onChange: (e) => {
      setLocal((s) => ({ ...s, [field]: e.target.value }));
      setOpen(true);
    },
    onFocus: () => {
      setEditing(true);
      setOpen(true);
    },
    // Read the live DOM value on blur (not closure state) so a commit is never
    // missed when focus moves in the same tick as the last keystroke.
    onBlur: (e) => {
      const next = e.target.value || "";
      const baseline = { make, model, name }[field] || "";
      if (next !== baseline) onCommit(field, next);
      // Delay so an onMouseDown pick on a dropdown row registers first.
      setTimeout(() => {
        const root = anchorRef.current;
        if (!root || !root.contains(document.activeElement)) {
          setEditing(false);
          setOpen(false);
        }
      }, 150);
    },
    onKeyDown: (e) => {
      if (e.key === "Enter") e.currentTarget.blur();
      if (e.key === "Escape") setOpen(false);
    },
    onMouseDown: (e) => e.stopPropagation(),
    className: "inline-desc-input",
  });

  // Keep the portaled dropdown glued to the cell while the table scrolls, and
  // flip it above the row when there isn't room below (so the list never gets
  // truncated off the bottom of the page with no way to reach the rest).
  const [menuPos, setMenuPos] = useState(null);
  const updateMenuPos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const flipUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    setMenuPos({
      left: rect.left,
      width: rect.width,
      flipUp,
      top: flipUp ? undefined : rect.bottom + 2,
      bottom: flipUp ? window.innerHeight - rect.top + 2 : undefined,
      maxHeight: Math.max(120, Math.min(280, flipUp ? spaceAbove : spaceBelow)),
    });
  }, []);
  const showMenu = open && results.length > 0;
  useLayoutEffect(() => {
    if (!showMenu) {
      setMenuPos(null);
      return undefined;
    }
    updateMenuPos();
    // Capture-phase scroll so the menu tracks any scrolling ancestor (the
    // table container), not just the window.
    window.addEventListener("scroll", updateMenuPos, true);
    window.addEventListener("resize", updateMenuPos);
    return () => {
      window.removeEventListener("scroll", updateMenuPos, true);
      window.removeEventListener("resize", updateMenuPos);
    };
  }, [showMenu, updateMenuPos]);

  // Subtitle for a dropdown entry: "shared", or — for a local entry — what
  // differs from its shared origin, shown in place of the measurement area.
  const describeEntry = (inst) => {
    if (inst.scope === "validated") return "shared";
    if (!inst.sourceId && !inst.validatedSnapshot) return "local · new";
    const diffs = diffFromSnapshot(inst);
    if (!diffs.length) return "local";
    const labelFor = {
      manufacturer: "mfg",
      model: "model",
      description: "name",
      functions: "functions",
    };
    return `local · ${diffs.map((d) => labelFor[d.field] || d.field).join(", ")} changed`;
  };

  const combinedDescription =
    [local.make, local.name, local.model].filter(Boolean).join(" ") ||
    "Click to add description";
  return (
    <div ref={anchorRef} className="inline-desc-cell">
      {editing ? (
        <div className="inline-desc-fields" onMouseDown={(e) => e.stopPropagation()}>
          <label className="inline-desc-field">
            <input {...props("make")} placeholder="MFG" className="inline-desc-subinput" />
            <span>MFG</span>
          </label>
          <label className="inline-desc-field">
            <input {...props("name")} placeholder="Make" className="inline-desc-subinput" />
            <span>Make</span>
          </label>
          <label className="inline-desc-field">
            <input {...props("model")} placeholder="Model" className="inline-desc-subinput" />
            <span>Model</span>
          </label>
        </div>
      ) : (
        <button
          type="button"
          className={`inline-desc-combined${combinedDescription === "Click to add description" ? " is-empty" : ""}`}
          title="Edit manufacturer, model, and name"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => {
            setEditing(true);
            setOpen(true);
            requestAnimationFrame(() => {
              anchorRef.current?.querySelector("input")?.focus();
            });
          }}
        >
          {combinedDescription}
        </button>
      )}

      {showMenu &&
        menuPos &&
        ReactDOM.createPortal(
          <div
            className="inline-desc-search"
            style={{
              ...descSearchDropdownStyle,
              position: "fixed",
              left: menuPos.left,
              minWidth: Math.max(260, menuPos.width || 0),
              maxHeight: menuPos.maxHeight,
              ...(menuPos.flipUp
                ? { bottom: menuPos.bottom }
                : { top: menuPos.top }),
            }}
          >
            {results.map((inst) => (
              <div
                key={inst.id}
                className="inline-desc-search-item"
                style={descSearchItemStyle}
                // onMouseDown (not onClick) so it fires before the input blur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPickLibrary(inst);
                  setOpen(false);
                }}
              >
                <span style={{ fontWeight: 500 }}>
                  {[inst.manufacturer, inst.model].filter(Boolean).join(" ") ||
                    inst.description ||
                    "Unnamed"}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: "0.72rem",
                    color: "var(--text-color-muted)",
                  }}
                >
                  {describeEntry(inst)}
                </span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
};

// Inline-editable Resolution cell: numeric resolution plus an optional
// resolution unit. If no specific resolution unit is stored, it falls back to
// the active range unit.
const ResolutionCellInput = ({
  value = "",
  unit = "",
  fallbackUnit = "",
  onCommit,
  onCommitUnit,
  useResolution = false,
  onToggleUse,
}) => {
  const [v, setV] = useState(() => toPlainNumber(value));
  useEffect(() => {
    setV(toPlainNumber(value));
  }, [value]);
  return (
    <span className="inline-resolution-editor">
      <input
        type="text"
        inputMode="decimal"
        value={v}
        placeholder="—"
        onChange={(e) => setV(e.target.value)}
        onBlur={(e) => {
          if ((e.target.value || "") !== String(value ?? "")) onCommit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="inline-tolerance-input inline-resolution-input"
      />
      <UnitSelect
        value={unit || fallbackUnit || ""}
        ariaLabel="Resolution unit"
        onChange={onCommitUnit}
        width="58px"
      />
      {onToggleUse && (
        <input
          type="checkbox"
          className="inline-resolution-use"
          title="Include this resolution in the uncertainty budget"
          checked={!!useResolution}
          onChange={(e) => onToggleUse(e.target.checked)}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </span>
  );
};

// Inline range editor: editable min/max for the active range, with a compact
// switcher when an instrument has more than one range.
const TOLERANCE_TYPE_OPTIONS = [
  { key: "reading", label: "% IV", title: "Percent of indicated value" },
  { key: "range", label: "% FS", title: "Percent of full scale" },
  { key: "floor", label: "Floor", title: "Absolute floor value" },
  { key: "db", label: "dB", title: "Decibel value" },
];

const getToleranceComponent = (tolerance = {}, typeKey) =>
  tolerance?.[typeKey] || null;
const hasToleranceComponentValue = (component) => {
  if (!component) return false;
  return (
    component.high !== undefined ||
    component.low !== undefined ||
    component.value !== undefined
  );
};
const firstToleranceType = (tolerance = {}) =>
  TOLERANCE_TYPE_OPTIONS.find((opt) =>
    hasToleranceComponentValue(getToleranceComponent(tolerance, opt.key)),
  )?.key || "reading";
const defaultToleranceComponent = (typeKey, activeRange = {}, tolerance = {}) => {
  const distribution = getBandDistDivisor(tolerance) || "1.732";
  if (typeKey === "range") {
    return {
      value: activeRange?.max ?? "",
      high: "",
      low: "",
      unit: "%",
      distribution,
      symmetric: true,
    };
  }
  if (typeKey === "floor") {
    return {
      high: "",
      low: "",
      unit: activeRange?.unit || "",
      distribution,
      symmetric: true,
    };
  }
  if (typeKey === "db") {
    return {
      high: "",
      low: "",
      multiplier: 20,
      ref: 1,
      distribution,
      symmetric: true,
    };
  }
  return {
    value: "",
    high: "",
    low: "",
    unit: "%",
    distribution,
    symmetric: true,
  };
};
const componentLimitMagnitude = (component = {}, side = "high", typeKey = "") => {
  if (
    typeKey === "reading" &&
    component?.value !== undefined &&
    component.value !== null &&
    component.value !== ""
  ) {
    return toPlainNumber(Math.abs(parseFloat(component.value)));
  }
  const raw = component?.[side];
  if (raw !== undefined && raw !== null && raw !== "") {
    return toPlainNumber(Math.abs(parseFloat(raw)));
  }
  if (side === "low" && component?.high !== undefined && component.high !== "") {
    return toPlainNumber(Math.abs(parseFloat(component.high)));
  }
  if (
    typeKey !== "range" &&
    component?.value !== undefined &&
    component.value !== null &&
    component.value !== ""
  ) {
    return toPlainNumber(Math.abs(parseFloat(component.value)));
  }
  return "";
};
const componentUnitLabel = (typeKey, component = {}, activeRange = {}) => {
  if (typeKey === "reading") return "% IV";
  if (typeKey === "range") return "% FS";
  if (typeKey === "floor") {
    return getUnitDisplayLabel(component.unit || activeRange?.unit || "");
  }
  if (typeKey === "db") return "dB";
  return "";
};
const toleranceInputStyleFor = (value, { minCh = 5, maxCh = 12 } = {}) => {
  const length = String(value ?? "").trim().length || minCh;
  const ch = Math.min(Math.max(length + 2, minCh), maxCh);
  return {
    width: `${ch}ch`,
    flexBasis: `${ch}ch`,
  };
};

const activeToleranceTypeKeys = (tolerance = {}) =>
  TOLERANCE_TYPE_OPTIONS.filter((opt) =>
    Object.prototype.hasOwnProperty.call(tolerance || {}, opt.key),
  ).map((opt) => opt.key);

const ToleranceTermEditor = ({
  tolerance = {},
  activeRange = {},
  typeKey,
  selectedType,
  showHighSign = true,
  onSelectType,
  onCommit,
}) => {
  const component =
    getToleranceComponent(tolerance, typeKey) ||
    defaultToleranceComponent(typeKey, activeRange, tolerance);
  const [highValue, setHighValue] = useState(() =>
    componentLimitMagnitude(component, "high", typeKey),
  );
  const [lowValue, setLowValue] = useState(() =>
    componentLimitMagnitude(component, "low", typeKey),
  );
  const [fullScale, setFullScale] = useState(() =>
    toPlainNumber(component.value ?? activeRange?.max ?? ""),
  );

  useEffect(() => {
    setHighValue(componentLimitMagnitude(component, "high", typeKey));
    setLowValue(componentLimitMagnitude(component, "low", typeKey));
    setFullScale(toPlainNumber(component.value ?? activeRange?.max ?? ""));
  }, [typeKey, component.high, component.low, component.value, activeRange?.max]);

  const commit = (patch = {}) => {
    const next = {
      ...defaultToleranceComponent(typeKey, activeRange, tolerance),
      ...component,
      ...patch,
    };
    onCommit(typeKey, next);
  };
  const commitLimit = (side, raw) => {
    const trimmed = String(raw ?? "").trim();
    const parsed = parseFloat(trimmed);
    if (typeKey === "reading") {
      const magnitude = trimmed === "" || Number.isNaN(parsed) ? "" : String(Math.abs(parsed));
      commit({
        value: magnitude,
        high: magnitude,
        low: magnitude === "" ? "" : String(-Math.abs(parsed)),
        symmetric: true,
      });
      return;
    }
    const next = {
      high:
        component.high ??
        (highValue === "" ? "" : String(Math.abs(parseFloat(highValue)))),
      low:
        component.low ??
        (lowValue === "" ? "" : String(-Math.abs(parseFloat(lowValue)))),
    };
    if (side === "high") {
      next.high = trimmed === "" || Number.isNaN(parsed) ? "" : String(Math.abs(parsed));
    } else {
      next.low = trimmed === "" || Number.isNaN(parsed) ? "" : String(-Math.abs(parsed));
    }
    const high = parseFloat(next.high);
    const low = parseFloat(next.low);
    commit({
      ...next,
      symmetric:
        !Number.isNaN(high) &&
        !Number.isNaN(low) &&
        Math.abs(high + low) < 1e-9,
    });
  };
  const commitFullScale = (raw) => {
    const trimmed = String(raw ?? "").trim();
    if (trimmed === String(component.value ?? activeRange?.max ?? "")) return;
    commit({ value: trimmed });
  };
  const typeLabel = componentUnitLabel(typeKey, component, activeRange);
  const typeOption = TOLERANCE_TYPE_OPTIONS.find((opt) => opt.key === typeKey);

  return (
    <span className="inline-tolerance-term">
      <span className="inline-tolerance-limits">
        {showHighSign && <span className="inline-tolerance-symbol">+</span>}
        <input
          type="text"
          inputMode="decimal"
          value={highValue}
          placeholder="0"
          onChange={(e) => setHighValue(e.target.value)}
          onBlur={(e) => commitLimit("high", e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="inline-tolerance-input"
          style={toleranceInputStyleFor(highValue)}
        />
        {typeKey !== "reading" && (
          <>
            <span className="inline-tolerance-symbol">-</span>
            <input
              type="text"
              inputMode="decimal"
              value={lowValue}
              placeholder="0"
              onChange={(e) => setLowValue(e.target.value)}
              onBlur={(e) => commitLimit("low", e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="inline-tolerance-input"
              style={toleranceInputStyleFor(lowValue)}
            />
          </>
        )}
      </span>
      {typeLabel && (
        <button
          type="button"
          className={`inline-tolerance-chip inline-tolerance-chip--in-cell${typeKey === selectedType ? " is-active" : ""}`}
          title={`Select ${typeOption?.label || typeLabel} tolerance term`}
          onClick={() => onSelectType?.(typeKey)}
        >
          {typeLabel}
        </button>
      )}
      {typeKey === "range" && (
        <span className="inline-tolerance-fs">
          <span>(FS=</span>
          <input
            type="text"
            inputMode="decimal"
            value={fullScale}
            placeholder="max"
            onChange={(e) => setFullScale(e.target.value)}
            onBlur={(e) => commitFullScale(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="inline-tolerance-input inline-tolerance-input--fs"
            style={toleranceInputStyleFor(fullScale, { minCh: 6, maxCh: 14 })}
          />
          <span>{getUnitDisplayLabel(activeRange?.unit || "")}</span>
          <span>)</span>
        </span>
      )}
    </span>
  );
};

const InlineToleranceCell = ({
  tolerance = {},
  activeRange = {},
  typeKey,
  selectedType,
  editable,
  onSelectType,
  onCommit,
}) => {
  if (!editable) {
    return <>{getSpecRows(tolerance)[0]}</>;
  }

  const activeKeys = activeToleranceTypeKeys(tolerance);
  // No tolerance configured yet — don't auto-show a %IV term. Prompt the user to
  // add one via the column header (+); a new instrument starts with no tolerance.
  if (activeKeys.length === 0) {
    return (
      <div
        className="inline-tolerance-editor inline-tolerance-empty"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="inline-tol-empty">Set tolerance…</span>
      </div>
    );
  }
  const visibleKeys = activeKeys;

  return (
    <div className="inline-tolerance-editor" onMouseDown={(e) => e.stopPropagation()}>
      {visibleKeys.map((key, index) => (
        <span
          key={key}
          className={`inline-tolerance-term-group${key === selectedType ? " is-active" : ""}`}
          onMouseDown={() => onSelectType?.(key)}
        >
          {index > 0 && <span className="inline-tolerance-plus">+</span>}
          <ToleranceTermEditor
            tolerance={tolerance}
            activeRange={activeRange}
            typeKey={key}
            selectedType={selectedType}
            showHighSign={index === 0}
            onSelectType={onSelectType}
            onCommit={onCommit}
          />
        </span>
      ))}
    </div>
  );
};

const RangeCell = ({
  ranges = [],
  activeIndex,
  activeRange = {},
  editable,
  onSelect,
  onEditBound,
  onEditUnit,
  onPatchRange,
  allowSingleToggle = false,
}) => {
  if (!editable) {
    return (
      <select
        className="session-selector"
        value={activeIndex}
        onChange={(e) => onSelect(parseInt(e.target.value, 10))}
      >
        {ranges.map((range, idx) => (
          <option key={idx} value={idx}>
            {formatRangeLabel(range, { preferBounds: true })}
          </option>
        ))}
      </select>
    );
  }
  const unit = activeRange.unit || "";
  // A range can be a single value (e.g. a 30 kg weight) instead of a min–max
  // span. We mirror the value into min and max so all downstream math (%FS,
  // value-based range homing, etc.) keeps working unchanged.
  const isSingle = !!activeRange.isSingleValue;
  const singleValue = activeRange.value ?? activeRange.max ?? activeRange.min ?? "";
  const switchToSingle = () => {
    const v = activeRange.max ?? activeRange.min ?? "";
    onPatchRange?.({ isSingleValue: true, value: v, min: v, max: v });
  };
  const switchToRange = () => onPatchRange?.({ isSingleValue: false });
  const commitSingle = (raw) =>
    onPatchRange?.({ isSingleValue: true, value: raw, min: raw, max: raw });
  return (
    <div className="inline-range-editor" onMouseDown={(e) => e.stopPropagation()}>
      <div className="inline-range-main">
        {onPatchRange && allowSingleToggle && (
          <button
            type="button"
            className="inline-range-mode-toggle"
            title={isSingle ? "Switch to a min–max range" : "Switch to a single value"}
            aria-label={isSingle ? "Switch to a min–max range" : "Switch to a single value"}
            onClick={isSingle ? switchToRange : switchToSingle}
          >
            {isSingle ? "↔" : "•"}
          </button>
        )}
        {isSingle ? (
          <input
            key={`val-${activeRange.id}`}
            type="text"
            inputMode="decimal"
            defaultValue={toPlainNumber(singleValue)}
            placeholder="value"
            onBlur={(e) => commitSingle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="inline-tolerance-input inline-range-bound-input"
          />
        ) : (
          <>
            <input
              key={`min-${activeRange.id}`}
              type="text"
              inputMode="decimal"
              defaultValue={toPlainNumber(activeRange.min)}
              placeholder="min"
              onBlur={(e) => onEditBound("min", e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="inline-tolerance-input inline-range-bound-input"
            />
            <span style={{ color: "var(--text-color-muted)" }}>–</span>
            <input
              key={`max-${activeRange.id}`}
              type="text"
              inputMode="decimal"
              defaultValue={toPlainNumber(activeRange.max)}
              placeholder="max"
              onBlur={(e) => onEditBound("max", e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="inline-tolerance-input inline-range-bound-input"
            />
          </>
        )}
        <UnitSelect
          value={unit}
          ariaLabel="Range unit"
          onChange={(value) => onEditUnit(value)}
          width="58px"
        />
        {ranges.length > 1 && (
          <span className="inline-range-select-shell" title="Switch range">
            <select
              value={activeIndex}
              aria-label="Switch range"
              onChange={(e) => onSelect(parseInt(e.target.value, 10))}
              className="inline-range-chevron-select"
            >
              {ranges.map((range, idx) => (
                <option key={idx} value={idx}>
                  {formatRangeLabel(range, { preferBounds: true })}
                </option>
              ))}
            </select>
            <FontAwesomeIcon icon={faChevronDown} />
          </span>
        )}
      </div>
    </div>
  );
};

// A range that isn't fully entered yet — a freshly-added one with a blank
// bound. These float to the TOP of the expanded list so the new row sits right
// under the header controls while the user fills it in.
const rangeIsIncomplete = (range = {}) => {
  if (range?.isSingleValue) {
    return !Number.isFinite(parseFloat(range.value ?? range.min));
  }
  return (
    !Number.isFinite(parseFloat(range?.min)) ||
    !Number.isFinite(parseFloat(range?.max))
  );
};

const rangeLowerBound = (range = {}) => {
  const raw = range?.isSingleValue ? (range.value ?? range.min) : range?.min;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
};

const getVisibleRangeRows = (ranges = [], activeIndex = 0, activeRange = {}, showAll = false) => {
  if (showAll && ranges.length > 0) {
    // Order for the expanded "view all ranges" list:
    //   1. Incomplete (newly-added) ranges first, so the empty row the user is
    //      filling in sits at the top under the header controls.
    //   2. Then existing ranges, grouped by unit in first-seen order (so V and Ω
    //      ranges don't interleave) and sorted lowest-to-highest within a unit.
    // Once a new range's bounds are committed it stops being "incomplete" and
    // sorts into its proper ascending slot within its unit group.
    // Each row keeps its ORIGINAL array index — activation / active-range
    // tracking is index-based; only the display order changes.
    const unitOrder = new Map();
    ranges.forEach((r) => {
      const u = r?.unit || "";
      if (!unitOrder.has(u)) unitOrder.set(u, unitOrder.size);
    });
    return ranges
      .map((range, index) => ({
        range,
        index,
        key: range?.id || `${index}`,
      }))
      .sort((a, b) => {
        const ai = rangeIsIncomplete(a.range);
        const bi = rangeIsIncomplete(b.range);
        if (ai !== bi) return ai ? -1 : 1;
        if (ai && bi) return a.index - b.index;
        const ua = unitOrder.get(a.range?.unit || "") ?? 0;
        const ub = unitOrder.get(b.range?.unit || "") ?? 0;
        if (ua !== ub) return ua - ub;
        const la = rangeLowerBound(a.range);
        const lb = rangeLowerBound(b.range);
        if (la !== lb) return la - lb;
        return a.index - b.index;
      });
  }
  return [
    {
      range: activeRange || ranges[activeIndex] || {},
      index: activeIndex || 0,
      key: activeRange?.id || `${activeIndex || 0}`,
    },
  ];
};

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

const isInlineRowControlTarget = (target) =>
  target.closest(
    "input, select, textarea, button, .inline-desc-search, .react-select__control, .react-select__menu",
  );

const handleRowSelection = (e, id, setSelected) => {
  // Let inline editors handle their own clicks; only bare row areas toggle
  // selection (so the user can still select an instrument to copy/cut/delete).
  if (isInlineRowControlTarget(e.target)) {
    return;
  }
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

const formatResolutionLabel = (range = {}) => {
  const resolution = range?.resolution ?? range?.measuringResolution;
  if (resolution === undefined || resolution === null || resolution === "") {
    return "-";
  }

  const unit =
    range?.resolutionUnit || range?.measuringResolutionUnit || range?.unit || "";
  const unitLabel = getUnitDisplayLabel(unit);
  return `${resolution}${unitLabel ? ` ${unitLabel}` : ""}`;
};

// --- SHARED HELPER: Resolve UUT Range ---
const resolveUutRangeHelper = (
  uut,
  activeRangeIndices,
  savedTolerance,
  uutNominal,
  functionKey = null,
) => {
  // 1. Normalize Ranges
  let allRanges = getInstrumentRangeRows(uut, { flattenTolerances: true }).map(
    (r, i) => ({ ...r, _index: r._index ?? i }),
  );

  // Optional: scope to a single function so a multi-function instrument shown
  // under a function subsection only exposes that function's ranges. Falls back
  // to all ranges if the filter would empty the list (legacy/loose metadata).
  if (functionKey) {
    const scoped = allRanges.filter(
      (r) => makeFunctionKey(r.functionName, r.functionUnit || r.unit) === functionKey,
    );
    if (scoped.length > 0) allRanges = scoped;
  }

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
      // Stable range/function ids are preferred because function names and row
      // order can change as multifunction instruments evolve.
      if (
        r.rangeId &&
        savedTolerance.rangeId &&
        String(r.rangeId) === String(savedTolerance.rangeId)
      ) {
        return (
          !savedTolerance.functionId ||
          !r.functionId ||
          String(savedTolerance.functionId) === String(r.functionId)
        );
      }

      // Legacy ID Match
      if (r.id && savedTolerance.id && r.id === savedTolerance.id) return true;

      // Legacy Name Match
      if (savedTolerance.range && r.range && savedTolerance.range === r.range) {
        return savedTolerance.functionName
          ? savedTolerance.functionName === r.functionName
          : true;
      }

      // Props Match (Fallback)
      const minMatch = r.min == savedTolerance.min;
      const maxMatch = r.max == savedTolerance.max;
      const unitMatch = (r.unit || "") === (savedTolerance.unit || "");
      const functionIdMatch =
        savedTolerance.functionId && r.functionId
          ? String(savedTolerance.functionId) === String(r.functionId)
          : true;
      const funcMatch = r.functionName === savedTolerance.functionName; // strict function name

      // Looser function match if one is missing? No, stay strict.
      return (
        minMatch &&
        maxMatch &&
        unitMatch &&
        functionIdMatch &&
        (!r.functionName || funcMatch)
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

// Group instrument rows by FUNCTION subsection — shared by the Session Overview
// and the Detailed (point) view so both tables read identically. `groupedItems`
// are `{ type:"item", item, index }`; returns a flat list of `{type:"function"}`
// headers interleaved with item rows carrying `functionKey` + `rowKey` (the bare
// id for single-function instruments, `${functionKey}::${id}` for multi-function
// ones so each subsection's range state is independent). Empty subsections are
// emitted for user-added functions (session.functionGroups) with no instrument.
const buildFunctionGroupedRows = (groupedItems, sessionData, kind = null) => {
  const sessionFunctions = resolveSessionFunctions(sessionData, { kind });
  const fnByKey = new Map(sessionFunctions.map((fn) => [fn.key, fn]));
  const fnOrder = new Map(sessionFunctions.map((fn, index) => [fn.key, index]));
  const groups = new Map();

  groupedItems.forEach((row) => {
    const declared = instrumentFunctions(row.item);
    const seenFnKeys = new Set();
    const fnList = (
      declared.length
        ? declared
        : [{ key: makeFunctionKey("Measurement", ""), name: "Measurement", unit: "" }]
    ).filter((fn) => {
      if (seenFnKeys.has(fn.key)) return false;
      seenFnKeys.add(fn.key);
      return true;
    });
    const multi = fnList.length > 1;

    fnList.forEach((primary) => {
      const fn = fnByKey.get(primary.key) || {
        key: primary.key,
        name: primary.name,
        unit: primary.unit,
        color: null,
      };
      const tableFn = kind ? { ...fn, kind } : fn;
      if (!groups.has(fn.key)) {
        groups.set(fn.key, {
          type: "function",
          fn: tableFn,
          order: fnOrder.has(fn.key) ? fnOrder.get(fn.key) : Number.MAX_SAFE_INTEGER,
          items: [],
        });
      }
      groups.get(fn.key).items.push({
        ...row,
        functionKey: fn.key,
        rowKey: multi ? `${fn.key}::${row.item.id}` : row.item.id,
      });
    });
  });

  (sessionData.functionGroups || [])
    .filter((fg) => !kind || !fg.kind || fg.kind === kind)
    .forEach((fg) => {
    const key = makeFunctionKey(fg.name, fg.unit);
    if (!groups.has(key)) {
      const resolvedFn = fnByKey.get(key) || { key, name: fg.name, unit: fg.unit, color: null };
      const fn = { ...resolvedFn, ...(fg.kind ? { kind: fg.kind } : kind ? { kind } : {}) };
      groups.set(key, {
        type: "function",
        fn,
        order: fnOrder.has(key) ? fnOrder.get(key) : Number.MAX_SAFE_INTEGER,
        items: [],
      });
    }
  });

  return Array.from(groups.values())
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.fn.name.localeCompare(b.fn.name);
    })
    .flatMap((group) => [
      group,
      ...group.items.sort((a, b) => {
        const aLabel = (a.item.description || a.item.name || "").toLowerCase();
        const bLabel = (b.item.description || b.item.name || "").toLowerCase();
        return aLabel.localeCompare(bLabel);
      }),
    ]);
};

const stableSpecString = (value) => {
  const normalize = (input) => {
    if (input === undefined) return null;
    if (input === null || typeof input !== "object") return input;
    if (Array.isArray(input)) return input.map(normalize);
    return Object.keys(input)
      .sort()
      .reduce((acc, key) => {
        if (key === "_index") return acc;
        acc[key] = normalize(input[key]);
        return acc;
      }, {});
  };
  return JSON.stringify(normalize(value || {}));
};

const specsDiffer = (a, b) => stableSpecString(a) !== stableSpecString(b);

const pointUsesUut = (point = {}, uutId) =>
  String(point.activeUutId || "") === String(uutId) ||
  (point.associatedUutIds || []).some((id) => String(id) === String(uutId));

const findUpdatedUutToleranceForPoint = (previousUut, updatedUut, point) => {
  if (!point?.uutTolerance) return null;
  const previousResolution = resolveUutRangeHelper(
    previousUut,
    {},
    point.uutTolerance,
    point.testPointInfo?.parameter || null,
  );
  const previousRange = previousResolution.activeRange || point.uutTolerance;
  const updatedRanges = resolveUutRangeHelper(updatedUut, {}, null, null).ranges;
  const updatedRange =
    updatedRanges.find(
      (range) =>
        previousRange.rangeId &&
        range.rangeId &&
        String(range.rangeId) === String(previousRange.rangeId) &&
        (!previousRange.functionId ||
          !range.functionId ||
          String(range.functionId) === String(previousRange.functionId)),
    ) ||
    updatedRanges.find(
      (range) => previousRange.id && range.id && String(range.id) === String(previousRange.id),
    ) ||
    updatedRanges.find(
      (range) =>
        previousRange.range &&
        range.range === previousRange.range &&
        (!previousRange.functionName || range.functionName === previousRange.functionName),
    ) ||
    updatedRanges.find((range) => range._index === previousRange._index);

  return updatedRange || null;
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
  contextName,
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
  onSessionSave,
  // Global UUT Selection (synced with sidebar Quick Add)
  currentUutSelection = [],
  setCurrentUutSelection,
  instruments = [],
  onSaveInstrument,
  setNotification,
}) => {
  const [localLibraryChoices, setLocalLibraryChoices] = useState({});
  const [toleranceTypes, setToleranceTypes] = useState({});
  const [selectedToleranceKey, setSelectedToleranceKey] = useState(null);
  const [openToleranceAddMenu, setOpenToleranceAddMenu] = useState(null);
  // Add Function picker: null | "uut" | "tmde" (which table's button opened it).
  const [addFunctionMenu, setAddFunctionMenu] = useState(null);
  const [newFunctionDraft, setNewFunctionDraft] = useState({ name: "", unit: "" });
  const { syncToShared, getDiff } = useInstrumentSync();

  // Inline make/model/name edits from the Description cell. `name` is the
  // session label (uut.description / tmde.name); make+model live on the nested
  // instrument definition. Persisted through the whole-session save.
  const applyDescriptionPatch = (item, field, value) => {
    if (field === "name") {
      // Caller maps "name" to the right label key per role.
      return value;
    }
    const key = field === "make" ? "manufacturer" : "model";
    return { ...(item.instrument || {}), [key]: value };
  };

  const rowLabel = (kind, item) =>
    kind === "uut" ? item?.description || "" : item?.name || "";

  const itemInstrumentForLibrary = (kind, item) => {
    const inst = item?.instrument || {};
    const areaName =
      kind === "uut"
        ? item?.measurementArea || inst.measurementArea || ""
        : inst.measurementArea || item?.measurementArea || "";
    const areaColor =
      kind === "uut"
        ? item?.measurementAreaColor || inst.measurementAreaColor || ""
        : inst.measurementAreaColor || "";
    return {
      ...inst,
      id: inst.id || item?.libraryInstrumentId || item?.id || uuidv4(),
      manufacturer: inst.manufacturer || "",
      model: inst.model || "",
      description: rowLabel(kind, item) || inst.description || "",
      functions: inst.functions || [],
      measurementArea: areaName,
      measurementAreaColor: areaColor,
      scope: inst.scope || "local",
    };
  };

  const replaceSyncedItem = (kind, item, syncedInstrument) => {
    if (!onSessionSave || !syncedInstrument) return;
    const listKey = kind === "uut" ? "uuts" : "tmdes";
    const updatedItem = {
      ...item,
      libraryInstrumentId: syncedInstrument.id,
      instrument: {
        ...syncedInstrument,
        measurementArea:
          item.instrument?.measurementArea || syncedInstrument.measurementArea || "",
        measurementAreaColor:
          item.instrument?.measurementAreaColor ||
          syncedInstrument.measurementAreaColor ||
          "",
      },
    };
    onSessionSave({
      ...sessionData,
      [listKey]: (sessionData[listKey] || []).map((existing) =>
        existing.id === item.id ? updatedItem : existing,
      ),
    });
  };

  const handleSyncItem = (kind, item) => {
    if (!setNotification || !item) return;
    const instrument = itemInstrumentForLibrary(kind, item);
    const state = computeSyncState(instrument);
    const linked = Boolean(instrument.sourceId) || instrument.scope === "validated";
    const label = libraryLabel(instrument);

    if (state === "green") {
      setNotification({
        title: "Already Synced",
        message: `${label} already matches the shared library snapshot.`,
      });
      return;
    }

    setNotification({
      title: linked ? "Re-sync Instrument" : "Sync Instrument",
      message: `${syncDiffSummary(getDiff(instrument))} Enter the shared-library password to sync ${label}.`,
      inputLabel: "Shared library password",
      inputPlaceholder: "Password",
      confirmText: linked ? "Re-sync" : "Sync",
      validateInput: (value) => (!value.trim() ? "Password is required." : ""),
      onConfirm: async (password) => {
        const result = await syncToShared(instrument, password);
        if (result.ok && result.instrument) {
          replaceSyncedItem(kind, item, result.instrument);
          setLocalLibraryChoices((prev) => ({
            ...prev,
            [`${kind}:${item.id}`]: "shared",
          }));
          setNotification({
            title: "Sync Complete",
            message: `${label} is now synced with the shared library.`,
          });
          return;
        }
        setNotification({
          title: "Sync Error",
          message: result.message || "Could not sync this instrument.",
        });
      },
    });
  };

  const saveItemInstrumentToLocalLibrary = (kind, item) => {
    if (!onSaveInstrument || !item) return;
    const instrument = itemInstrumentForLibrary(kind, item);
    onSaveInstrument({
      ...instrument,
      scope: "local",
      sourceId:
        instrument.sourceId ||
        (instrument.scope === "validated" ? instrument.id : undefined),
      validatedSnapshot:
        instrument.validatedSnapshot ||
        (instrument.scope === "validated" ? buildValidatedSnapshot(instrument) : null),
    });
  };

  // New inline instruments are always saved to the local library automatically
  // (they stay local / out-of-sync until the user explicitly syncs them to the
  // shared library). The old "Save Local vs Session Only" prompt was removed.
  const promptLocalLibrarySave = (kind, item) => {
    if (!onSaveInstrument || !item?.instrument) return;
    const key = `${kind}:${item.id}`;
    setLocalLibraryChoices((prev) =>
      prev[key] === "local" ? prev : { ...prev, [key]: "local" },
    );
    saveItemInstrumentToLocalLibrary(kind, item);
  };

  const refreshSessionPointsForUut = (previousItem, updatedItem) => {
    if (!previousItem || !updatedItem) return sessionData.testPoints || [];
    return (sessionData.testPoints || []).map((point) => {
      if (!pointUsesUut(point, updatedItem.id)) return point;
      const nextTolerance = findUpdatedUutToleranceForPoint(
        previousItem,
        updatedItem,
        point,
      );
      if (!nextTolerance || !specsDiffer(point.uutTolerance, nextTolerance)) {
        return point;
      }
      return { ...point, uutTolerance: nextTolerance };
    });
  };

  // Re-sync every point's per-point TMDE instances with an edited master so a
  // change made in the Session Overview (e.g. ticking "use resolution", editing
  // a tolerance/range) flows straight into each point's budget — instead of
  // waiting for the instance to be rebuilt in the Detailed View. The instance's
  // per-point config (range index, quantity, asset id, variable, reading) is
  // preserved; only the spec carried from the master is refreshed.
  const refreshSessionPointsForTmde = (updatedItem) => {
    if (!updatedItem) return sessionData.testPoints || [];
    return (sessionData.testPoints || []).map((point) => {
      const instances = point.tmdeTolerances;
      if (!Array.isArray(instances) || instances.length === 0) return point;
      let touched = false;
      const nextInstances = instances.map((instance) => {
        if (!instance) return instance;
        const matchesMaster =
          String(instance.id) === String(updatedItem.id) ||
          String(instance.sourceId) === String(updatedItem.id);
        if (!matchesMaster) return instance;
        touched = true;
        return createInstanceFromDefinition(updatedItem, {
          existingId: instance.id,
          quantity: instance.quantity ?? 1,
          assetId: instance.assetId || "",
          userFunctionId: instance.functionId || "",
          userFunctionName: instance.functionName || "",
          userRangeId: instance.rangeId || "",
          userRangeIndex: instance._index ?? 0,
          userMeasurement: instance.measurementPoint,
          userVariable: instance.variableType || "",
        });
      });
      return touched ? { ...point, tmdeTolerances: nextInstances } : point;
    });
  };

  const persistInlineItem = (kind, updatedItem, { maybePromptLocal = false } = {}) => {
    const listKey = kind === "uut" ? "uuts" : "tmdes";
    const previousItem = (sessionData[listKey] || []).find(
      (item) => item.id === updatedItem.id,
    );
    const nextSession = {
      ...sessionData,
      [listKey]: (sessionData[listKey] || []).map((it) =>
        it.id === updatedItem.id ? updatedItem : it,
      ),
    };
    if (kind === "uut") {
      nextSession.testPoints = refreshSessionPointsForUut(previousItem, updatedItem);
    } else {
      nextSession.testPoints = refreshSessionPointsForTmde(updatedItem);
    }
    onSessionSave({
      ...nextSession,
    });
    if (
      onSaveInstrument &&
      (updatedItem.instrument?.sourceId ||
        updatedItem.instrument?.scope === "local" ||
        localLibraryChoices[`${kind}:${updatedItem.id}`] === "local")
    ) {
      saveItemInstrumentToLocalLibrary(kind, updatedItem);
    } else if (maybePromptLocal) {
      promptLocalLibrarySave(kind, updatedItem);
    }
  };

  const handleUutDescriptionEdit = (uutId, field, value) => {
    if (!onSessionSave) return;
    let updatedItem = null;
    const updatedUuts = (sessionData.uuts || []).map((u) => {
      if (u.id !== uutId) return u;
      updatedItem =
        field === "name"
          ? { ...u, description: value }
          : { ...u, instrument: applyDescriptionPatch(u, field, value) };
      return updatedItem;
    });
    onSessionSave({ ...sessionData, uuts: updatedUuts });
    if (updatedItem) {
      if (
        onSaveInstrument &&
        (updatedItem.instrument?.sourceId ||
          updatedItem.instrument?.scope === "local" ||
          localLibraryChoices[`uut:${updatedItem.id}`] === "local")
      ) {
        saveItemInstrumentToLocalLibrary("uut", updatedItem);
      } else {
        promptLocalLibrarySave("uut", updatedItem);
      }
    }
  };

  const handleTmdeDescriptionEdit = (tmdeId, field, value) => {
    if (!onSessionSave) return;
    let updatedItem = null;
    const updatedTmdes = (sessionData.tmdes || []).map((t) => {
      if (t.id !== tmdeId) return t;
      updatedItem =
        field === "name"
          ? { ...t, name: value }
          : { ...t, instrument: applyDescriptionPatch(t, field, value) };
      return updatedItem;
    });
    onSessionSave({ ...sessionData, tmdes: updatedTmdes });
    if (updatedItem) {
      if (
        onSaveInstrument &&
        (updatedItem.instrument?.sourceId ||
          updatedItem.instrument?.scope === "local" ||
          localLibraryChoices[`tmde:${updatedItem.id}`] === "local")
      ) {
        saveItemInstrumentToLocalLibrary("tmde", updatedItem);
      } else {
        promptLocalLibrarySave("tmde", updatedItem);
      }
    }
  };

  // --- Picking an existing library instrument from the description dropdown ---
  // Populate the row from the library instrument; if the instrument carries a
  // measurement area the session doesn't have yet, create it on the fly so the
  // row drops into a (new) area subsection automatically.
  const ensureAreaForInstrument = (areas, inst, { hiddenFromSidebar = false } = {}) => {
    const areaName = (inst.measurementArea || "").trim();
    if (!areaName) return { areas, area: null };
    const existing = (areas || []).find(
      (a) => (a.name || "").toLowerCase() === areaName.toLowerCase(),
    );
    if (existing) return { areas, area: existing };
    const color =
      typeof inst.measurementAreaColor === "string" &&
      inst.measurementAreaColor.startsWith("#")
        ? inst.measurementAreaColor
        : AREA_PALETTE[(areas || []).length % AREA_PALETTE.length];
    const area = { id: uuidv4(), name: areaName, color, hiddenFromSidebar };
    return { areas: [...(areas || []), area], area };
  };

  const instrumentDefFromLibrary = (existing, inst, { track = false, localCopy = false } = {}) => ({
    ...(existing || {}),
    id: existing?.id || uuidv4(),
    manufacturer: inst.manufacturer || "",
    model: inst.model || "",
    description: inst.description || "",
    functions: inst.functions || [],
    libraryInstrumentId: track ? inst.sourceId || inst.id : undefined,
    scope: track ? (localCopy ? "local" : inst.scope) : "local",
    sourceId: track ? inst.sourceId || (inst.scope === "validated" ? inst.id : undefined) : undefined,
    validatedSnapshot:
      track && (inst.scope === "validated" || localCopy)
        ? buildValidatedSnapshot(inst)
        : track
          ? existing?.validatedSnapshot || inst.validatedSnapshot || null
          : null,
  });

  const libraryLabel = (inst) =>
    inst.description ||
    `${inst.manufacturer || ""} ${inst.model || ""}`.trim() ||
    "Instrument";

  const applyPickedLibraryUut = (uutId, inst, options = {}) => {
    if (!onSessionSave) return;
    const { areas, area } = ensureAreaForInstrument(
      sessionData.measurementAreas || [],
      inst,
    );
    let updatedItem = null;
    const updatedUuts = (sessionData.uuts || []).map((u) =>
      u.id === uutId
        ? (updatedItem = {
            ...u,
            description: libraryLabel(inst),
            libraryInstrumentId: options.track ? inst.sourceId || inst.id : undefined,
            ...(area
              ? {
                  measurementAreaId: area.id,
                  measurementArea: area.name,
                  measurementAreaColor: area.color,
                }
              : {}),
            instrument: instrumentDefFromLibrary(u.instrument, inst, options),
          })
        : u,
    );
    onSessionSave({ ...sessionData, measurementAreas: areas, uuts: updatedUuts });
    if (updatedItem && (!options.track || options.saveLocal)) saveItemInstrumentToLocalLibrary("uut", updatedItem);
  };

  const applyPickedLibraryTmde = (tmdeId, inst, options = {}) => {
    if (!onSessionSave) return;
    const { areas, area } = ensureAreaForInstrument(
      sessionData.measurementAreas || [],
      inst,
      { hiddenFromSidebar: true },
    );
    let updatedItem = null;
    const updatedTmdes = (sessionData.tmdes || []).map((t) =>
      t.id === tmdeId
        ? (updatedItem = {
            ...t,
            name: libraryLabel(inst),
            isInstrumentBased: true,
            libraryInstrumentId: options.track ? inst.sourceId || inst.id : undefined,
            ...(area
              ? { measurementAreaId: area.id, measurementArea: area.name }
              : {}),
            instrument: {
              ...instrumentDefFromLibrary(t.instrument, inst, options),
              // TMDE grouping keys off the nested instrument's area name.
              measurementArea: area ? area.name : inst.measurementArea || "",
              measurementAreaColor: area
                ? area.color
                : inst.measurementAreaColor || "",
            },
          })
        : t,
    );
    onSessionSave({ ...sessionData, measurementAreas: areas, tmdes: updatedTmdes });
    if (updatedItem && (!options.track || options.saveLocal)) saveItemInstrumentToLocalLibrary("tmde", updatedItem);
  };

  const promptLibraryPick = (kind, itemId, inst, functionKey = null) => {
    // Load exactly the entry the user picked — never silently substitute a
    // diverged local copy for the shared one (or vice-versa). Picking the
    // shared (validated) entry gives the in-sync version; picking a local entry
    // gives that local version. Tracking stays available via the Sync badge.
    const isShared = inst.scope === "validated";
    const options = isShared
      ? { track: true, localCopy: false }
      : { track: Boolean(inst.sourceId) };
    const fallbackFn = functionKey
      ? resolveSessionFunctions(sessionData, { kind }).find((fn) => fn.key === functionKey)
      : null;
    const scopedInst = scopeLibraryInstrumentToFunction(inst, functionKey, fallbackFn);
    if (kind === "uut") applyPickedLibraryUut(itemId, scopedInst, options);
    else applyPickedLibraryTmde(itemId, scopedInst, options);
  };

  // --- Reassign an instrument to a different measurement area ---
  // UUT area lives on the session row; TMDE grouping keys off the nested
  // instrument's area name, so update both there. A freshly added inline row is
  // pinned to the top of the table; once it has an area it must flow into that
  // area's subsection, so we drop the pin here too — otherwise the row stays
  // stranded above the groups and never appears to "move" into the area.
  // Moving a shared (in-sync) instrument to a different area detaches it from
  // the shared definition: keep the link (sourceId/snapshot) so it can be
  // re-synced, but force it out of sync. Already-local instruments are left as
  // they are. Only invoked when `markLocal` is requested (drag-and-drop).
  const markInstrumentLocalIfShared = (instrument) => {
    if (!instrument) return instrument;
    if (computeSyncState(instrument) !== "green") return instrument;
    return {
      ...instrument,
      scope: "local",
      sourceId:
        instrument.sourceId ||
        (instrument.scope === "validated" ? instrument.id : undefined),
      validatedSnapshot:
        instrument.validatedSnapshot || buildValidatedSnapshot(instrument),
      localOverride: true,
    };
  };

  const handleChangeUutArea = (uutId, areaId, { markLocal = false } = {}) => {
    if (!onSessionSave) return;
    const area = (sessionData.measurementAreas || []).find(
      (a) => String(a.id) === String(areaId),
    );
    const updatedUuts = (sessionData.uuts || []).map((u) =>
      u.id === uutId
        ? {
            ...u,
            measurementAreaId: area ? area.id : "",
            measurementArea: area ? area.name : "",
            measurementAreaColor: area ? area.color : "",
            instrument: markLocal
              ? markInstrumentLocalIfShared(u.instrument)
              : u.instrument,
          }
        : u,
    );
    setPinnedInlineUutIds((prev) => prev.filter((id) => id !== uutId));
    onSessionSave({ ...sessionData, uuts: updatedUuts });
  };
  const handleChangeTmdeArea = (tmdeId, areaId, { markLocal = false } = {}) => {
    if (!onSessionSave) return;
    const area = (sessionData.measurementAreas || []).find(
      (a) => String(a.id) === String(areaId),
    );
    const updatedTmdes = (sessionData.tmdes || []).map((t) => {
      if (t.id !== tmdeId) return t;
      const withArea = {
        ...(t.instrument || {}),
        measurementArea: area ? area.name : "",
        measurementAreaColor: area ? area.color : "",
      };
      return {
        ...t,
        measurementAreaId: area ? area.id : "",
        measurementArea: area ? area.name : "",
        instrument: markLocal ? markInstrumentLocalIfShared(withArea) : withArea,
      };
    });
    setPinnedInlineTmdeIds((prev) => prev.filter((id) => id !== tmdeId));
    onSessionSave({ ...sessionData, tmdes: updatedTmdes });
  };

  // --- Drag a UUT/TMDE row from one measurement-area subsection to another ---
  // Dragging carries { id, kind } via the dataTransfer; dropping onto an area
  // header (or any row in that area) reassigns the instrument's area. Dragging a
  // shared instrument also flips it out of sync (markLocal).
  const [draggingInstrumentId, setDraggingInstrumentId] = useState(null);
  const handleInstrumentDragStart = (kind, item) => (e) => {
    // Don't hijack text selection / clicks inside the row's editable controls.
    if (
      e.target.closest(
        "input, select, textarea, button, a, .inline-desc-fields",
      )
    ) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify({ id: item.id, kind }));
    setDraggingInstrumentId(item.id);
  };
  const handleInstrumentDragEnd = () => setDraggingInstrumentId(null);
  const allowInstrumentDrop = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const resolveItemAreaId = (kind, item) => {
    if (!item) return "";
    if (kind === "uut") return item.measurementAreaId || "";
    if (item.measurementAreaId) return item.measurementAreaId;
    const name = item.instrument?.measurementArea || item.measurementArea || "";
    const area = (sessionData.measurementAreas || []).find(
      (a) => name && a.name === name,
    );
    return area ? area.id : "";
  };
  const handleInstrumentDropOnArea = (kind, targetAreaId) => (e) => {
    e.preventDefault();
    let payload = null;
    try {
      payload = JSON.parse(e.dataTransfer.getData("text/plain"));
    } catch {
      payload = null;
    }
    setDraggingInstrumentId(null);
    if (!payload || payload.kind !== kind) return;
    if (kind === "uut") handleChangeUutArea(payload.id, targetAreaId, { markLocal: true });
    else handleChangeTmdeArea(payload.id, targetAreaId, { markLocal: true });
  };

  // Create a new measurement area inline from the area control and assign it,
  // so a new instrument can define its own area without a sidebar round-trip.
  const handleCreateUutArea = (uutId, name) => {
    if (!onSessionSave) return;
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    const { areas, area } = ensureAreaForInstrument(
      sessionData.measurementAreas || [],
      { measurementArea: trimmed },
      { hiddenFromSidebar: true },
    );
    if (!area) return;
    const updatedUuts = (sessionData.uuts || []).map((u) =>
      u.id === uutId
        ? {
            ...u,
            measurementAreaId: area.id,
            measurementArea: area.name,
            measurementAreaColor: area.color,
          }
        : u,
    );
    setPinnedInlineUutIds((prev) => prev.filter((id) => id !== uutId));
    onSessionSave({ ...sessionData, measurementAreas: areas, uuts: updatedUuts });
  };
  const handleCreateTmdeArea = (tmdeId, name) => {
    if (!onSessionSave) return;
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    const { areas, area } = ensureAreaForInstrument(
      sessionData.measurementAreas || [],
      { measurementArea: trimmed },
    );
    if (!area) return;
    const updatedTmdes = (sessionData.tmdes || []).map((t) =>
      t.id === tmdeId
        ? {
            ...t,
            measurementAreaId: area.id,
            measurementArea: area.name,
            instrument: {
              ...(t.instrument || {}),
              measurementArea: area.name,
              measurementAreaColor: area.color,
            },
          }
        : t,
    );
    setPinnedInlineTmdeIds((prev) => prev.filter((id) => id !== tmdeId));
    onSessionSave({ ...sessionData, measurementAreas: areas, tmdes: updatedTmdes });
  };

  const handleCommitUutAreaName = (uutId, rawName) => {
    const trimmed = String(rawName || "").trim();
    if (!trimmed || trimmed.toLowerCase() === "unassigned") {
      handleChangeUutArea(uutId, "");
      return;
    }
    const existing = (sessionData.measurementAreas || []).find(
      (area) => String(area.name || "").toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) handleChangeUutArea(uutId, existing.id);
    else handleCreateUutArea(uutId, trimmed);
  };

  const handleCommitTmdeAreaName = (tmdeId, rawName) => {
    const trimmed = String(rawName || "").trim();
    if (!trimmed || trimmed.toLowerCase() === "unassigned") {
      handleChangeTmdeArea(tmdeId, "");
      return;
    }
    const existing = (sessionData.measurementAreas || []).find(
      (area) => String(area.name || "").toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) handleChangeTmdeArea(tmdeId, existing.id);
    else handleCreateTmdeArea(tmdeId, trimmed);
  };

  const toleranceTypeKey = (kind, item, rangeId) =>
    `${kind}:${item?.id || ""}:${rangeId || "default"}`;
  const getSelectedToleranceType = (kind, item, activeRange) => {
    const key = toleranceTypeKey(kind, item, activeRange?.id);
    return (
      toleranceTypes[key] ||
      firstToleranceType(getItemRangeTolerance(item, activeRange?.id) || activeRange || {})
    );
  };
  const setSelectedToleranceType = (kind, item, activeRange, typeKey) => {
    const key = toleranceTypeKey(kind, item, activeRange?.id);
    setToleranceTypes((prev) => ({ ...prev, [key]: typeKey }));
    setSelectedToleranceKey(key);
    if (kind === "uut") {
      setSelectedUutIds([item.id]);
      setSelectedTmdeIds([]);
    } else {
      setSelectedTmdeIds([item.id]);
      setSelectedUutIds([]);
    }
    const cur = getItemRangeTolerance(item, activeRange?.id) || {};
    if (!cur[typeKey]) {
      const updatedItem = applyItemRangeTolerance(item, activeRange?.id, {
        ...cur,
        [typeKey]: defaultToleranceComponent(typeKey, activeRange, cur),
      });
      persistInlineItem(kind, updatedItem);
    }
  };
  const setRangeToleranceComponent = (kind, item, activeRange, typeKey, component) => {
    if (!onSessionSave) return;
    setSelectedToleranceKey(toleranceTypeKey(kind, item, activeRange?.id));
    const cur = getItemRangeTolerance(item, activeRange?.id) || {};
    const next = { ...cur, [typeKey]: component };
    const updatedItem = applyItemRangeTolerance(item, activeRange?.id, next);
    persistInlineItem(kind, updatedItem);
  };

  // --- Add Function workflow ---
  // Register a function as a subsection (even before any instrument uses it) by
  // recording it in session.functionGroups. getGroupedInstrumentRows then renders
  // an empty subsection whose (+) lets the user add an instrument for it.
  const handleAddFunction = ({ name, unit }) => {
    if (!onSessionSave) return;
    const clean = String(name || "").trim();
    if (!clean) return;
    const kind = addFunctionMenu?.kind || null;
    const key = makeFunctionKey(clean, unit);
    const existing = Array.isArray(sessionData.functionGroups)
      ? sessionData.functionGroups
      : [];
    if (
      existing.some(
        (fg) =>
          makeFunctionKey(fg.name, fg.unit) === key &&
          (!kind || !fg.kind || fg.kind === kind),
      )
    ) {
      setAddFunctionMenu(null);
      return; // already present
    }
    onSessionSave({
      ...sessionData,
      functionGroups: [
        ...existing,
        { name: clean, unit: String(unit || "").trim(), ...(kind ? { kind } : {}) },
      ],
    });
    setAddFunctionMenu(null);
    setNewFunctionDraft({ name: "", unit: "" });
  };

  // Add a blank instrument already scoped to one function, so it lands in that
  // subsection. The user fills in make/model (or picks from the library via the
  // Description cell). A new instrument's function is the subsection's function.
  const handleAddInstrumentToFunction = (kind, fn) => {
    if (!onSessionSave) return;
    const fnDef = { name: fn.name, unit: fn.unit, ranges: [] };
    const instrument = {
      id: uuidv4(),
      manufacturer: "",
      model: "",
      description: "",
      functions: [fnDef],
    };
    if (kind === "uut") {
      const newUut = { id: uuidv4(), name: "", description: "", instrument };
      setSelectedUutIds([newUut.id]);
      onSessionSave({ ...sessionData, uuts: [newUut, ...(sessionData.uuts || [])] });
    } else {
      const newTmde = {
        id: uuidv4(),
        name: "",
        quantity: 1,
        assetId: "",
        isInstrumentBased: false,
        instrument,
      };
      setSelectedTmdeIds([newTmde.id]);
      onSessionSave({ ...sessionData, tmdes: [newTmde, ...(sessionData.tmdes || [])] });
    }
  };

  // Remove a function subsection. Only an empty function (no instrument declares
  // it and no test point uses it) can be deleted — it's just a functionGroups
  // metadata entry at that point. A function still in use must have its
  // instruments/points removed first (matches the old measurement-area guard).
  const handleDeleteFunction = (fn) => {
    if (!onSessionSave) return;
    const appliesToUut = !fn.kind || fn.kind === "uut";
    const appliesToTmde = !fn.kind || fn.kind === "tmde";
    const inUse =
      (appliesToUut &&
        (sessionData.uuts || []).some((u) => instrumentHasFunction(u, fn.key))) ||
      (appliesToTmde &&
        (sessionData.tmdes || []).some((t) => instrumentHasFunction(t, fn.key))) ||
      (appliesToUut &&
        (sessionData.testPoints || []).some((p) => functionKeyOf(p) === fn.key));
    if (inUse) {
      setNotification?.({
        title: "Function In Use",
        message:
          "Remove the instruments and measurement points using this function before deleting it.",
      });
      return;
    }
    onSessionSave({
      ...sessionData,
      functionGroups: (sessionData.functionGroups || []).filter(
        (fg) =>
          makeFunctionKey(fg.name, fg.unit) !== fn.key ||
          (fg.kind && fn.kind && fg.kind !== fn.kind),
      ),
    });
  };

  // Inline edit of the range's measuring resolution (the Resolution column).
  const setRangeResolution = (kind, item, rangeId, value) => {
    if (!onSessionSave) return;
    const updatedItem = applyItemRangePatch(item, rangeId, { resolution: value });
    persistInlineItem(kind, updatedItem);
  };
  const setRangeResolutionUnit = (kind, item, rangeId, value) => {
    if (!onSessionSave) return;
    const updatedItem = applyItemRangePatch(item, rangeId, { resolutionUnit: value });
    persistInlineItem(kind, updatedItem);
  };
  const setRangeUseResolution = (kind, item, rangeId, checked) => {
    if (!onSessionSave) return;
    const updatedItem = applyItemRangePatch(item, rangeId, { includeResolutionInBudget: checked });
    persistInlineItem(kind, updatedItem);
  };
  const setRangeUnit = (kind, item, rangeId, value) => {
    if (!onSessionSave) return;
    const updatedItem = applyItemRangePatch(item, rangeId, { unit: value });
    persistInlineItem(kind, updatedItem);
  };
  // --- Inline range editing: edit bounds, add, remove ---
  const persistItem = (kind, updatedItem) => {
    persistInlineItem(kind, updatedItem);
  };
  const handleEditRangeBound = (kind, item, rangeId, field, value) => {
    if (!onSessionSave) return;
    persistItem(kind, applyItemRangePatch(item, rangeId, { [field]: value }));
  };
  const patchRange = (kind, item, rangeId, patch) => {
    if (!onSessionSave) return;
    persistItem(kind, applyItemRangePatch(item, rangeId, patch));
  };
  const handleAddRange = (kind, item, activeRangeId, currentCount) => {
    if (!onSessionSave) return;
    const { item: updated, newRangeId } = addRangeToItem(item, activeRangeId);
    persistItem(kind, updated);
    const setIdx = kind === "uut" ? setLocalRangeIndices : setTmdeRangeIndices;
    // The new range is appended within ONE function, so its flattened index
    // isn't necessarily the last slot (a multi-function instrument keeps later
    // functions' ranges after it). Resolve its real index by id so it becomes
    // the active range; fall back to the appended-last assumption.
    const resolved = resolveUutRangeHelper(updated, {}, null, null).ranges || [];
    const newIdx = newRangeId
      ? resolved.findIndex((r) => sameId(r.id, newRangeId))
      : -1;
    setIdx((prev) => ({ ...prev, [item.id]: newIdx >= 0 ? newIdx : currentCount }));
    if (newRangeId) {
      setNewRangeKeys((prev) => {
        const next = new Set(prev);
        next.add(rangeStateKey(kind, item.id, newRangeId));
        return next;
      });
    }
  };
  const handleRemoveRange = (kind, item, rangeId) => {
    if (!onSessionSave) return;
    persistItem(kind, removeRangeFromItem(item, rangeId));
    setNewRangeKeys((prev) => {
      const next = new Set(prev);
      next.delete(rangeStateKey(kind, item.id, rangeId));
      return next;
    });
    const setIdx = kind === "uut" ? setLocalRangeIndices : setTmdeRangeIndices;
    setIdx((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  };

  // Inline edit of the spec-band distribution from the Distribution column —
  // writes back to the same instrument range spec the tolerance popover edits.
  const toggleShowAllRanges = (kind, itemId) => {
    setExpandedRangeKeys((prev) => {
      const next = new Set(prev);
      const key = itemStateKey(kind, itemId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isShowingAllRanges = (kind, itemId) =>
    expandedRangeKeys.has(itemStateKey(kind, itemId));

  const setRangeBandDistribution = (kind, item, rangeId, value) => {
    if (!onSessionSave) return;
    const cur = getItemRangeTolerance(item, rangeId) || {};
    const next = applyBandDistribution(cur, value);
    const updatedItem = applyItemRangeTolerance(item, rangeId, next);
    persistInlineItem(kind, updatedItem);
  };

  // ----- Function subsections (the table's grouping axis) -----
  // A function's color/name live in session.functionGroups, the same source the
  // sidebar reads, so a recolor/rename here is reflected in the sidebar tree.
  const upsertFunctionGroup = (fnKey, patch) => {
    const existing = Array.isArray(sessionData.functionGroups)
      ? sessionData.functionGroups
      : [];
    const patchKind = patch.kind || null;
    let found = false;
    const next = existing.map((fg) => {
      if (
        makeFunctionKey(fg.name, fg.unit) === fnKey &&
        (!patchKind || !fg.kind || fg.kind === patchKind)
      ) {
        found = true;
        return { ...fg, ...patch };
      }
      return fg;
    });
    if (!found) next.push(patch);
    return next;
  };

  const handleFunctionColorChange = (fn, color) => {
    if (!onSessionSave) return;
    onSessionSave({
      ...sessionData,
      functionGroups: upsertFunctionGroup(fn.key, {
        name: fn.name,
        unit: fn.unit,
        color,
        ...(fn.kind ? { kind: fn.kind } : {}),
      }),
    });
  };

  // Rename a function across every surface: the stored function-group metadata,
  // the function name on each instrument that declares it, and the parameter
  // name on each test point that belongs to it. Keeps the sidebar in sync.
  const handleFunctionRename = (fn, rawName) => {
    if (!onSessionSave) return;
    const name = String(rawName || "").trim();
    if (!name || name === fn.name) return;

    const renameInstruments = (list = []) =>
      list.map((item) => {
        const inst = item.instrument || item;
        const fns = Array.isArray(inst.functions) ? inst.functions : null;
        if (!fns) return item;
        let changed = false;
        const nextFns = fns.map((f) => {
          if (makeFunctionKey(f.name, f.unit) === fn.key) {
            changed = true;
            return { ...f, name };
          }
          return f;
        });
        if (!changed) return item;
        return item.instrument
          ? { ...item, instrument: { ...inst, functions: nextFns } }
          : { ...item, functions: nextFns };
      });

    const nextPoints =
      fn.kind === "tmde"
        ? sessionData.testPoints
        : (sessionData.testPoints || []).map((tp) => {
            if (functionKeyOf(tp) !== fn.key) return tp;
            const parameter = tp.testPointInfo?.parameter || {};
            return {
              ...tp,
              testPointInfo: {
                ...(tp.testPointInfo || {}),
                parameter: { ...parameter, name },
              },
            };
          });

    onSessionSave({
      ...sessionData,
      functionGroups: upsertFunctionGroup(fn.key, {
        name,
        unit: fn.unit,
        color: fn.color,
        ...(fn.kind ? { kind: fn.kind } : {}),
      }),
      uuts: fn.kind === "tmde" ? sessionData.uuts : renameInstruments(sessionData.uuts),
      tmdes: fn.kind === "uut" ? sessionData.tmdes : renameInstruments(sessionData.tmdes),
      testPoints: nextPoints,
    });
  };

  const renderFunctionColorSwatch = (fn) => {
    const color =
      typeof fn.color === "string" && fn.color.startsWith("#")
        ? fn.color
        : "#888888";
    const dotStyle = {
      display: "inline-block",
      width: "12px",
      height: "12px",
      borderRadius: "3px",
      marginRight: "8px",
      verticalAlign: "middle",
      backgroundColor: fn.color || "#888888",
    };
    if (!onSessionSave) return <span style={dotStyle} />;
    return (
      <label
        title="Click to change function color"
        onClick={(e) => e.stopPropagation()}
        style={{
          ...dotStyle,
          position: "relative",
          cursor: "pointer",
          border: "1px solid rgba(127,127,127,0.5)",
          overflow: "hidden",
          pointerEvents: "auto",
        }}
      >
        <input
          type="color"
          value={color}
          onChange={(e) => handleFunctionColorChange(fn, e.target.value)}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            opacity: 0,
            cursor: "pointer",
            padding: 0,
            border: "none",
          }}
        />
      </label>
    );
  };

  const renderFunctionNameEditor = (fn) => {
    if (!onSessionSave) {
      return <span style={{ color: fn.color }}>{fn.name}</span>;
    }
    return (
      <input
        className="inline-area-header-input"
        defaultValue={fn.name}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = fn.name;
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => handleFunctionRename(fn, e.target.value)}
        title="Edit function name"
        aria-label="Function subsection name"
        style={{
          color: fn.color,
          background: "transparent",
          border: "1px solid transparent",
          borderRadius: "4px",
          font: "inherit",
          fontWeight: 700,
          padding: "1px 4px",
          minWidth: "120px",
          pointerEvents: "auto",
        }}
      />
    );
  };

  const renderFunctionUnitChip = (fn) =>
    fn.unit ? (
      <span
        style={{
          marginLeft: "8px",
          opacity: 0.6,
          fontSize: "0.78em",
          fontWeight: 600,
        }}
      >
        {getUnitDisplayLabel(fn.unit)}
      </span>
    ) : null;

  // Per-subsection (+) — adds an instrument already scoped to this function.
  const renderFunctionAddButton = (kind, fn) => {
    if (!onSessionSave) return null;
    return (
      <button
        type="button"
        title={`Add ${kind === "uut" ? "UUT" : "TMDE"} with this function`}
        onClick={(e) => {
          e.stopPropagation();
          handleAddInstrumentToFunction(kind, fn);
        }}
        style={{
          marginLeft: "6px",
          pointerEvents: "auto",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "18px",
          height: "18px",
          padding: 0,
          borderRadius: "4px",
          border: "1px solid var(--border-color)",
          background: "transparent",
          color: "var(--text-color-muted)",
          cursor: "pointer",
          fontSize: "0.7em",
          lineHeight: 1,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--input-background)";
          e.currentTarget.style.color = "var(--text-color)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-color-muted)";
        }}
      >
        <FontAwesomeIcon icon={faPlus} size="xs" />
      </button>
    );
  };

  // Per-subsection delete (only acts on an unused function).
  const renderFunctionDeleteButton = (fn) => {
    if (!onSessionSave) return null;
    return (
      <button
        type="button"
        title="Delete function"
        onClick={(e) => {
          e.stopPropagation();
          handleDeleteFunction(fn);
        }}
        style={{
          marginLeft: "4px",
          pointerEvents: "auto",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "18px",
          height: "18px",
          padding: 0,
          borderRadius: "4px",
          border: "1px solid var(--border-color)",
          background: "transparent",
          color: "var(--text-color-muted)",
          cursor: "pointer",
          fontSize: "0.7em",
          lineHeight: 1,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--status-danger, #e74c3c)";
          e.currentTarget.style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-color-muted)";
        }}
      >
        <FontAwesomeIcon icon={faTrashAlt} size="xs" />
      </button>
    );
  };

  // The "Add Function" picker opened from a table's header button: pick a
  // function declared anywhere in the library, or define a brand-new one.
  const renderAddFunctionMenu = (kind) => {
    if (!addFunctionMenu || addFunctionMenu.kind !== kind) return null;
    const rect = addFunctionMenu.rect;
    const libraryFns = functionsForLibrary(instruments);
    const existingKeys = new Set(
      resolveSessionFunctions(sessionData, { kind }).map((fn) => fn.key),
    );
    const available = libraryFns.filter((fn) => !existingKeys.has(fn.key));
    const itemStyle = {
      display: "block",
      width: "100%",
      textAlign: "left",
      padding: "6px 10px",
      background: "transparent",
      border: "none",
      color: "var(--text-color)",
      cursor: "pointer",
      fontSize: "0.85em",
    };
    // Portal to <body> with fixed positioning so the menu is never clipped by a
    // short table / overflow container (lesson from the inline library dropdown).
    const MENU_WIDTH = 250;
    const left = rect
      ? Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
      : 8;
    // Open below the button, but clamp so the menu never starts off-screen on a
    // short viewport (it scrolls internally via maxHeight).
    const top = rect
      ? Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 80))
      : 60;
    return ReactDOM.createPortal(
      <>
        <div
          onClick={() => setAddFunctionMenu(null)}
          style={{ position: "fixed", inset: 0, zIndex: 4000 }}
        />
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top,
            left,
            width: `${MENU_WIDTH}px`,
            maxHeight: "min(360px, 70vh)",
            overflowY: "auto",
            background: "var(--component-bg)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            zIndex: 4001,
            padding: "8px",
          }}
        >
        <div
          style={{
            fontSize: "0.7rem",
            fontWeight: 700,
            textTransform: "uppercase",
            opacity: 0.6,
            padding: "2px 6px 6px",
          }}
        >
          Add function
        </div>
        {available.length > 0 ? (
          <div>
            {available.map((fn) => (
              <button
                key={fn.key}
                type="button"
                onClick={() => handleAddFunction(fn)}
                style={itemStyle}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--input-background)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                {fn.name}
                {fn.unit ? (
                  <span style={{ opacity: 0.6 }}> · {getUnitDisplayLabel(fn.unit)}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ padding: "6px 10px", opacity: 0.6, fontSize: "0.8em" }}>
            No more library functions
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: "6px",
            marginTop: "8px",
            paddingTop: "8px",
            borderTop: "1px solid var(--border-color)",
          }}
        >
          <input
            type="text"
            placeholder="New function"
            value={newFunctionDraft.name}
            onChange={(e) =>
              setNewFunctionDraft((d) => ({ ...d, name: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddFunction(newFunctionDraft);
              if (e.key === "Escape") setAddFunctionMenu(null);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              background: "var(--input-background)",
              border: "1px solid var(--border-color)",
              borderRadius: "4px",
              color: "var(--text-color)",
              padding: "4px 6px",
              fontSize: "0.82em",
            }}
          />
          <input
            type="text"
            placeholder="Unit"
            value={newFunctionDraft.unit}
            onChange={(e) =>
              setNewFunctionDraft((d) => ({ ...d, unit: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddFunction(newFunctionDraft);
              if (e.key === "Escape") setAddFunctionMenu(null);
            }}
            style={{
              width: "64px",
              background: "var(--input-background)",
              border: "1px solid var(--border-color)",
              borderRadius: "4px",
              color: "var(--text-color)",
              padding: "4px 6px",
              fontSize: "0.82em",
            }}
          />
          <button
            type="button"
            disabled={!newFunctionDraft.name.trim()}
            onClick={() => handleAddFunction(newFunctionDraft)}
            style={{
              background: "var(--primary-color)",
              border: "none",
              borderRadius: "4px",
              color: "#fff",
              padding: "4px 10px",
              cursor: newFunctionDraft.name.trim() ? "pointer" : "not-allowed",
              opacity: newFunctionDraft.name.trim() ? 1 : 0.5,
              fontSize: "0.82em",
            }}
          >
            Add
          </button>
        </div>
        </div>
      </>,
      document.body,
    );
  };
  // --- SELECTION STATE ---
  // Use global UUT selection for sync with sidebar Quick Add
  const selectedUutIds = currentUutSelection || [];
  const setSelectedUutIds = setCurrentUutSelection || (() => {});
  const [selectedTmdeIds, setSelectedTmdeIds] = useState([]);

  const [localRangeIndices, setLocalRangeIndices] = useState({});
  const [tmdeRangeIndices, setTmdeRangeIndices] = useState({});
  const [newRangeKeys, setNewRangeKeys] = useState(() => new Set());
  const [expandedRangeKeys, setExpandedRangeKeys] = useState(() => new Set());
  const [pinnedInlineUutIds, setPinnedInlineUutIds] = useState([]);
  const [pinnedInlineTmdeIds, setPinnedInlineTmdeIds] = useState([]);

  const getSelectedRangeTarget = (kind) => {
    const ids = kind === "uut" ? selectedUutIds : selectedTmdeIds;
    if (ids.length !== 1) return null;

    const items = kind === "uut" ? sessionData.uuts || [] : sessionData.tmdes || [];
    const item = items.find((candidate) => candidate.id === ids[0]);
    if (!item) return null;

    const rangeIndices = kind === "uut" ? localRangeIndices : tmdeRangeIndices;
    const { ranges, activeRange } = resolveUutRangeHelper(
      item,
      rangeIndices,
      null,
      null,
    );
    return { item, ranges, activeRange };
  };

  const handleAddSelectedRange = (kind) => {
    const target = getSelectedRangeTarget(kind);
    if (!target) return;
    const label = kind === "uut" ? "UUT" : "TMDE";
    confirmViaNotification(setNotification, {
      title: "Add Range",
      message: `Add a new range to this ${label}?`,
      confirmText: "Add Range",
      onConfirm: () =>
        handleAddRange(kind, target.item, target.activeRange?.id, target.ranges.length),
    });
  };

  const handleRemoveSelectedRange = (kind) => {
    const target = getSelectedRangeTarget(kind);
    if (!target || target.ranges.length <= 1) return;
    const label = kind === "uut" ? "UUT" : "TMDE";
    confirmViaNotification(setNotification, {
      title: "Delete Range",
      message: `Delete the active range from this ${label}? This can't be undone.`,
      confirmText: "Delete",
      onConfirm: () => handleRemoveRange(kind, target.item, target.activeRange?.id),
    });
  };

  const renderRangeHeaderActions = (kind) => {
    if (!onSessionSave) return null;

    const target = getSelectedRangeTarget(kind);
    const label = kind === "uut" ? "UUT" : "TMDE";
    const canAdd = Boolean(target);
    const canRemove = Boolean(target && target.ranges.length > 1);
    const canToggleAll = canRemove;
    const showingAll = Boolean(target && isShowingAllRanges(kind, target.item.id));

    return (
      <span className="range-header-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="range-header-action-btn range-header-action-btn--add"
          title={canAdd ? `Add range to selected ${label}` : `Select one ${label} to add a range`}
          aria-label={`Add range to selected ${label}`}
          disabled={!canAdd}
          onClick={() => handleAddSelectedRange(kind)}
        >
          <FontAwesomeIcon icon={faPlus} size="xs" />
        </button>
        <button
          type="button"
          className="range-header-action-btn range-header-action-btn--delete"
          title={
            canRemove
              ? `Remove active range from selected ${label}`
              : `Select one ${label} with multiple ranges to remove a range`
          }
          aria-label={`Remove active range from selected ${label}`}
          disabled={!canRemove}
          onClick={() => handleRemoveSelectedRange(kind)}
        >
          <FontAwesomeIcon icon={faTrashAlt} size="xs" />
        </button>
        <button
          type="button"
          className={`range-header-action-btn range-header-action-btn--view${showingAll ? " is-active" : ""}`}
          title={
            canToggleAll
              ? showingAll
                ? `Show active range only for selected ${label}`
                : `Show all ranges for selected ${label}`
              : `Select one ${label} with multiple ranges to view all ranges`
          }
          aria-label={
            showingAll
              ? `Show active range only for selected ${label}`
              : `Show all ranges for selected ${label}`
          }
          disabled={!canToggleAll}
          onClick={() => toggleShowAllRanges(kind, target.item.id)}
        >
          <FontAwesomeIcon icon={showingAll ? faEyeSlash : faEye} size="xs" />
        </button>
      </span>
    );
  };

  const getSelectedToleranceTarget = (kind) => {
    const target = getSelectedRangeTarget(kind);
    if (!target) return null;
    const tolerance =
      getItemRangeTolerance(target.item, target.activeRange?.id) ||
      target.activeRange ||
      {};
    const key = toleranceTypeKey(kind, target.item, target.activeRange?.id);
    const selectedType = getSelectedToleranceType(kind, target.item, target.activeRange);
    const configuredTypes = activeToleranceTypeKeys(tolerance);
    const missingTypes = TOLERANCE_TYPE_OPTIONS.filter(
      (opt) => !configuredTypes.includes(opt.key),
    );
    return {
      ...target,
      key,
      tolerance,
      selectedType,
      configuredTypes,
      missingTypes,
      hasSelectedTolerance: selectedToleranceKey === key,
    };
  };

  const handleAddSelectedToleranceType = (kind, typeKey) => {
    const target = getSelectedToleranceTarget(kind);
    if (!target || !typeKey) return;
    const next = {
      ...target.tolerance,
      [typeKey]:
        target.tolerance[typeKey] ||
        defaultToleranceComponent(typeKey, target.activeRange, target.tolerance),
    };
    const updatedItem = applyItemRangeTolerance(
      target.item,
      target.activeRange?.id,
      next,
    );
    persistInlineItem(kind, updatedItem);
    setToleranceTypes((prev) => ({
      ...prev,
      [toleranceTypeKey(kind, target.item, target.activeRange?.id)]: typeKey,
    }));
    setSelectedToleranceKey(target.key);
    setOpenToleranceAddMenu(null);
  };

  const handleRemoveSelectedToleranceType = (kind) => {
    const target = getSelectedToleranceTarget(kind);
    if (!target || !target.hasSelectedTolerance || !target.tolerance[target.selectedType]) {
      return;
    }
    const termLabel =
      TOLERANCE_TYPE_OPTIONS.find((opt) => opt.key === target.selectedType)?.label ||
      "tolerance";
    confirmViaNotification(setNotification, {
      title: "Delete Tolerance Term",
      message: `Delete the ${termLabel} tolerance term? This can't be undone.`,
      confirmText: "Delete",
      onConfirm: () => {
        const next = { ...target.tolerance };
        delete next[target.selectedType];
        const remaining = activeToleranceTypeKeys(next);
        const nextSelected = remaining[0] || "reading";
        const updatedItem = applyItemRangeTolerance(
          target.item,
          target.activeRange?.id,
          next,
        );
        persistInlineItem(kind, updatedItem);
        setToleranceTypes((prev) => ({
          ...prev,
          [toleranceTypeKey(kind, target.item, target.activeRange?.id)]: nextSelected,
        }));
        setSelectedToleranceKey(null);
      },
    });
  };

  const renderToleranceHeaderActions = (kind) => {
    if (!onSessionSave) return null;

    const target = getSelectedToleranceTarget(kind);
    const label = kind === "uut" ? "UUT" : "TMDE";
    const canAdd = Boolean(target && target.missingTypes.length > 0);
    const canRemove = Boolean(
      target && target.hasSelectedTolerance && target.tolerance[target.selectedType],
    );
    const menuOpen = openToleranceAddMenu === kind;

    return (
      <span className="range-header-actions tolerance-header-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="range-header-action-btn range-header-action-btn--add"
          title={canAdd ? `Add tolerance term to selected ${label}` : `Select one ${label} with an available tolerance type`}
          aria-label={`Add tolerance term to selected ${label}`}
          disabled={!canAdd}
          onClick={() => setOpenToleranceAddMenu((prev) => (prev === kind ? null : kind))}
        >
          <FontAwesomeIcon icon={faPlus} size="xs" />
        </button>
        <button
          type="button"
          className="range-header-action-btn range-header-action-btn--delete"
          title={
            canRemove
              ? `Remove selected ${TOLERANCE_TYPE_OPTIONS.find((opt) => opt.key === target.selectedType)?.label || "tolerance"} term`
              : `Select a configured tolerance term to remove`
          }
          aria-label={`Remove selected tolerance term from selected ${label}`}
          disabled={!canRemove}
          onClick={() => handleRemoveSelectedToleranceType(kind)}
        >
          <FontAwesomeIcon icon={faTrashAlt} size="xs" />
        </button>
        {menuOpen && target && (
          <div className="tolerance-add-menu">
            {target.missingTypes.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className="tolerance-add-menu-item"
                onClick={() => handleAddSelectedToleranceType(kind, opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </span>
    );
  };

  // Industry Grade Highlighting State
  const [hoveredCell, setHoveredCell] = useState({
    tableId: null,
    colIndex: null,
  });
  const [hoveredRowId, setHoveredRowId] = useState(null);

  // Activate a single range row in the expanded "view all ranges" view. Unlike a
  // normal instrument-row click (which toggles selection), this ALWAYS selects
  // the instrument and marks the clicked range as active, so the Range/Tolerance
  // column-header +/- buttons reliably target that specific range (e.g. adding a
  // tolerance term to a freshly-added range). Wired as onMouseDownCapture so it
  // fires before inner controls' own mousedown — clicking a tolerance component
  // on another range makes THAT range active too.
  const activateRangeRow = (kind, itemId, index) => {
    if (kind === "uut") setSelectedUutIds([itemId]);
    else setSelectedTmdeIds([itemId]);
    const setIdx = kind === "uut" ? setLocalRangeIndices : setTmdeRangeIndices;
    setIdx((prev) => ({ ...prev, [itemId]: index }));
  };

  // Per-range <td> cells for the expanded "view all ranges" rows. In expanded
  // mode each range is its OWN real table row (see the showAllRanges branches
  // below), so these cells line up column-for-column instead of drifting like
  // the old per-cell `.range-stack` columns did. Only ever used in onSessionSave
  // mode (the eye toggle is hidden otherwise), so we render the editable path
  // directly. `kind` is "uut" | "tmde".
  const renderRangeRowCells = (kind, item, range, { includeDistribution, canDelete }) => {
    const setRangeIdx = kind === "uut" ? setLocalRangeIndices : setTmdeRangeIndices;
    const tableId = kind;
    const tolerance = getItemRangeTolerance(item, range?.id) || range;
    const typeKey = getSelectedToleranceType(kind, item, range);
    const label = kind === "uut" ? "UUT" : "TMDE";
    const deleteRange = () => {
      if (!canDelete) return;
      confirmViaNotification(setNotification, {
        title: "Delete Range",
        message: `Delete this range from this ${label}? This can't be undone.`,
        confirmText: "Delete",
        onConfirm: () => handleRemoveRange(kind, item, range?.id),
      });
    };

    return (
      <>
        <td
          className={`cell-value ${hoveredCell.tableId === tableId && hoveredCell.colIndex === 1 ? "col-hovered" : ""}`}
          onMouseEnter={() => setHoveredCell({ tableId, colIndex: 1 })}
        >
          <div className="range-row-cell">
            <RangeCell
              ranges={[range]}
              activeIndex={0}
              activeRange={range}
              editable
              allowSingleToggle={newRangeKeys.has(rangeStateKey(kind, item.id, range?.id))}
              onSelect={(idx) => setRangeIdx((prev) => ({ ...prev, [item.id]: idx }))}
              onEditBound={(field, value) => handleEditRangeBound(kind, item, range?.id, field, value)}
              onEditUnit={(value) => setRangeUnit(kind, item, range?.id, value)}
              onPatchRange={(patch) => patchRange(kind, item, range?.id, patch)}
            />
            <button
              type="button"
              className="range-row-delete"
              title={canDelete ? "Delete this range" : "An instrument must keep at least one range"}
              aria-label="Delete this range"
              disabled={!canDelete}
              onClick={(e) => {
                e.stopPropagation();
                deleteRange();
              }}
            >
              <FontAwesomeIcon icon={faTrashAlt} size="xs" />
            </button>
          </div>
        </td>

        <td
          className={`cell-tolerance ${hoveredCell.tableId === tableId && hoveredCell.colIndex === 2 ? "col-hovered" : ""}`}
          onMouseEnter={() => setHoveredCell({ tableId, colIndex: 2 })}
          title={getSpecRows(tolerance)[0]}
        >
          <InlineToleranceCell
            tolerance={tolerance}
            activeRange={range}
            typeKey={typeKey}
            selectedType={
              selectedToleranceKey === toleranceTypeKey(kind, item, range?.id)
                ? typeKey
                : null
            }
            editable
            onSelectType={(nextTypeKey) =>
              setSelectedToleranceType(kind, item, range, nextTypeKey)
            }
            onCommit={(nextTypeKey, component) =>
              setRangeToleranceComponent(kind, item, range, nextTypeKey, component)
            }
          />
        </td>

        {includeDistribution && (
          <td className="cell-distribution" title="Spec band distribution">
            {getBandDistDivisor(tolerance) ? (
              <select
                className="session-selector"
                value={getBandDistDivisor(tolerance)}
                onChange={(e) =>
                  setRangeBandDistribution(kind, item, range?.id, e.target.value)
                }
              >
                {errorDistributions.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            ) : (
              getBandDistLabel(tolerance)
            )}
          </td>
        )}

        <td
          className={`cell-value ${hoveredCell.tableId === tableId && hoveredCell.colIndex === 3 ? "col-hovered" : ""}`}
          onMouseEnter={() => setHoveredCell({ tableId, colIndex: 3 })}
          title={formatResolutionLabel(range)}
        >
          <ResolutionCellInput
            value={range?.resolution ?? range?.measuringResolution}
            unit={range?.resolutionUnit ?? range?.measuringResolutionUnit}
            fallbackUnit={range?.unit}
            onCommit={(v) => setRangeResolution(kind, item, range?.id, v)}
            onCommitUnit={(value) => setRangeResolutionUnit(kind, item, range?.id, value)}
            useResolution={range?.includeResolutionInBudget}
            onToggleUse={(checked) => setRangeUseResolution(kind, item, range?.id, checked)}
          />
        </td>
      </>
    );
  };

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
    } else if (viewMode === "function") {
      // contextId is a function key (see utils/functionGrouping). Scope to the
      // points of that function and the UUTs that own at least one of them.
      const fnPoints = points.filter((tp) => functionKeyOf(tp) === contextId);
      const ownerIds = new Set(
        fnPoints.flatMap((tp) => (tp.associatedUutIds || []).map(String)),
      );
      displayTitle =
        fnPoints[0]?.testPointInfo?.parameter?.name ||
        contextName ||
        "Function";
      displaySubtitle = "Function Summary";
      points = fnPoints;
      uuts = uuts.filter((u) => ownerIds.has(String(u.id)));
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
        if (rangeData.rangeId && ptTol.rangeId) {
          const rangeIdMatch =
            String(rangeData.rangeId) === String(ptTol.rangeId);
          const functionIdMatch =
            !rangeData.functionId ||
            !ptTol.functionId ||
            String(rangeData.functionId) === String(ptTol.functionId);
          if (rangeIdMatch && functionIdMatch) return true;
        }
        if (rangeData._id !== undefined && ptTol._id !== undefined) {
          if (rangeData._id === ptTol._id) return true;
        }
        const minMatch = ptTol.min == rangeData.min;
        const maxMatch = ptTol.max == rangeData.max;
        const unitMatch = (ptTol.unit || "") === (rangeData.unit || "");
        const functionIdMatch =
          rangeData.functionId && ptTol.functionId
            ? String(ptTol.functionId) === String(rangeData.functionId)
            : true;
        const funcMatch = rangeData.functionName
          ? ptTol.functionName === rangeData.functionName
          : true;
        return minMatch && maxMatch && unitMatch && functionIdMatch && funcMatch;
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
  }, [viewMode, contextId, contextName, sessionData, rangeData, uutId]);

  const getGroupedInstrumentRows = useCallback(
    (items = [], source = "session", pinnedIds = [], kind = null) => {
      const pinnedSet = new Set(pinnedIds);
      const pinnedRows = [];
      const groupedItems = [];

      items.forEach((item, index) => {
        const row = { type: "item", item, index };
        if (pinnedSet.has(item.id)) {
          pinnedRows.push(row);
        } else {
          groupedItems.push(row);
        }
      });

      if (!showAreaColumn) {
        return [...pinnedRows, ...groupedItems];
      }

      return [...pinnedRows, ...buildFunctionGroupedRows(groupedItems, sessionData, kind)];
    },
    [sessionData, showAreaColumn],
  );

  // --- HANDLERS ---

  // Selection Handlers (Wrapped)
  // Selection Handlers (Wrapped)
  const handleUutClick = (e, id) => {
    if (!isInlineRowControlTarget(e.target)) {
      setSelectedToleranceKey(null);
    }
    handleRowSelection(e, id, setSelectedUutIds);
  };
  const handleTmdeClick = (e, id) => {
    if (!isInlineRowControlTarget(e.target)) {
      setSelectedToleranceKey(null);
    }
    handleRowSelection(e, id, setSelectedTmdeIds);
  };

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

  // --- Cut / copy / paste of instrument rows (context menu + ctrl-c/x/v) ---
  const [rowMenu, setRowMenu] = useState(null);

  const copyInstrument = (kind, item, mode = "copy") => {
    instrumentClipboard = { kind, mode, item: JSON.parse(JSON.stringify(item)) };
  };

  const pasteInstrument = (kind, targetAreaId) => {
    if (!onSessionSave || !instrumentClipboard) return;
    const clip = instrumentClipboard;
    if (clip.kind !== kind) return;
    const listKey = kind === "uut" ? "uuts" : "tmdes";
    const area = (sessionData.measurementAreas || []).find(
      (a) => String(a.id) === String(targetAreaId),
    );
    if (clip.mode === "cut") {
      const moved = buildPastedInstrumentRow(clip.item, kind, area, "cut");
      const list = (sessionData[listKey] || []).map((row) =>
        row.id === clip.item.id ? moved : row,
      );
      instrumentClipboard = null;
      onSessionSave({ ...sessionData, [listKey]: list });
    } else {
      const clone = buildPastedInstrumentRow(clip.item, kind, area, "copy");
      if (kind === "uut") setSelectedUutIds([clone.id]);
      else setSelectedTmdeIds([clone.id]);
      onSessionSave({
        ...sessionData,
        [listKey]: [clone, ...(sessionData[listKey] || [])],
      });
    }
  };

  const deleteInstrumentRow = (kind, id) => {
    if (kind === "uut") onDeleteUut?.([id]);
    else onDeleteTmdeDefinition?.([id]);
  };

  const openInstrumentRowMenu = (e, kind, item) => {
    if (!onSessionSave) return;
    e.preventDefault();
    e.stopPropagation();
    if (kind === "uut") setSelectedUutIds([item.id]);
    else setSelectedTmdeIds([item.id]);
    const canPaste = !!instrumentClipboard && instrumentClipboard.kind === kind;
    const areaId =
      kind === "uut" ? item.measurementAreaId : resolveItemAreaId("tmde", item);
    const items = [
      { label: "Copy", icon: faCopy, action: () => copyInstrument(kind, item, "copy") },
      { label: "Cut", icon: faScissors, action: () => copyInstrument(kind, item, "cut") },
    ];
    if (canPaste) {
      items.push({
        label: "Paste",
        icon: faPaste,
        action: () => pasteInstrument(kind, areaId),
      });
    }
    items.push({ type: "divider" });
    items.push({
      label: "Delete",
      icon: faTrashAlt,
      className: "destructive",
      action: () => deleteInstrumentRow(kind, item.id),
    });
    setRowMenu({ x: e.clientX, y: e.clientY, items });
  };

  // --- Range-row clipboard (copy/cut/paste a single range) ---
  const copyRange = (kind, item, rangeId) => {
    const r = findItemRange(item, rangeId);
    if (!r) return;
    const clone = JSON.parse(JSON.stringify(r));
    if (!clone.unit) {
      // Function-based instruments keep the unit on the function, not the range.
      // Capture the resolved unit so a pasted copy keeps its own unit group even
      // if dropped next to a different-unit range.
      const fn = (item?.instrument?.functions || []).find((f) =>
        (f.ranges || []).some((x) => sameId(x.id, rangeId)),
      );
      if (fn?.unit) clone.unit = fn.unit;
    }
    rangeClipboard = { kind, range: clone };
  };
  const cutRange = (kind, item, range, totalRanges) => {
    copyRange(kind, item, range?.id);
    if (totalRanges > 1) handleRemoveRange(kind, item, range?.id);
  };
  const pasteRange = (kind, item, activeRangeId) => {
    if (!onSessionSave || !rangeClipboard || rangeClipboard.kind !== kind) return;
    const { item: updated, newRangeId } = pasteRangeIntoItem(
      item,
      activeRangeId,
      rangeClipboard.range,
    );
    persistItem(kind, updated);
    const setIdx = kind === "uut" ? setLocalRangeIndices : setTmdeRangeIndices;
    const resolved = resolveUutRangeHelper(updated, {}, null, null).ranges || [];
    const newIdx = resolved.findIndex((r) => sameId(r.id, newRangeId));
    if (newIdx >= 0) setIdx((prev) => ({ ...prev, [item.id]: newIdx }));
  };
  const openRangeRowMenu = (e, kind, item, range, index, totalRanges) => {
    if (!onSessionSave) return;
    e.preventDefault();
    e.stopPropagation();
    activateRangeRow(kind, item.id, index);
    const canPaste = !!rangeClipboard && rangeClipboard.kind === kind;
    const canDelete = totalRanges > 1;
    const label = kind === "uut" ? "UUT" : "TMDE";
    const items = [
      { label: "Copy Range", icon: faCopy, action: () => copyRange(kind, item, range?.id) },
    ];
    if (canDelete) {
      items.push({
        label: "Cut Range",
        icon: faScissors,
        action: () => cutRange(kind, item, range, totalRanges),
      });
    }
    if (canPaste) {
      items.push({
        label: "Paste Range",
        icon: faPaste,
        action: () => pasteRange(kind, item, range?.id),
      });
    }
    if (canDelete) {
      items.push({ type: "divider" });
      items.push({
        label: "Delete Range",
        icon: faTrashAlt,
        className: "destructive",
        action: () =>
          confirmViaNotification(setNotification, {
            title: "Delete Range",
            message: `Delete this range from this ${label}? This can't be undone.`,
            confirmText: "Delete",
            onConfirm: () => handleRemoveRange(kind, item, range?.id),
          }),
      });
    }
    setRowMenu({ x: e.clientX, y: e.clientY, items });
  };

  useEffect(() => {
    const onKey = (e) => {
      if (!onSessionSave || !(e.ctrlKey || e.metaKey)) return;
      const ae = document.activeElement;
      if (
        ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.isContentEditable)
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      const oneUut = selectedUutIds.length === 1 ? selectedUutIds[0] : null;
      const oneTmde = selectedTmdeIds.length === 1 ? selectedTmdeIds[0] : null;
      const kind = oneUut ? "uut" : oneTmde ? "tmde" : null;
      const findItem = (k, id) =>
        (k === "uut" ? sessionData.uuts : sessionData.tmdes)?.find(
          (x) => x.id === id,
        );

      // When the selected instrument is expanded (view-all-ranges), copy/cut/
      // paste act on the ACTIVE RANGE rather than the whole instrument.
      if (kind && isShowingAllRanges(kind, oneUut || oneTmde)) {
        const target = getSelectedRangeTarget(kind);
        if (target?.activeRange) {
          if (key === "c" || key === "x") {
            e.preventDefault();
            e.stopImmediatePropagation();
            copyRange(kind, target.item, target.activeRange.id);
            if (key === "x" && target.ranges.length > 1) {
              handleRemoveRange(kind, target.item, target.activeRange.id);
            }
            return;
          }
          if (key === "v" && rangeClipboard && rangeClipboard.kind === kind) {
            e.preventDefault();
            e.stopImmediatePropagation();
            pasteRange(kind, target.item, target.activeRange.id);
            return;
          }
        }
      }

      if ((key === "c" || key === "x") && kind) {
        const item = findItem(kind, oneUut || oneTmde);
        if (item) {
          e.preventDefault();
          e.stopImmediatePropagation();
          copyInstrument(kind, item, key === "x" ? "cut" : "copy");
        }
      } else if (key === "v" && instrumentClipboard) {
        const pasteKind = instrumentClipboard.kind;
        // Only handle paste when a row of the clipboard's kind is selected, so
        // we never steal Ctrl+V from the app's point/UUT clipboard.
        const haveTarget =
          (pasteKind === "uut" && oneUut) || (pasteKind === "tmde" && oneTmde);
        if (!haveTarget) return;
        const areaId =
          pasteKind === "uut"
            ? (findItem("uut", oneUut) || {}).measurementAreaId || ""
            : resolveItemAreaId("tmde", findItem("tmde", oneTmde) || {});
        e.preventDefault();
        e.stopImmediatePropagation();
        pasteInstrument(pasteKind, areaId);
      }
    };
    // Capture phase so this preempts the app-level point/UUT clipboard handler
    // when an instrument-table row is the active selection.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUutIds, selectedTmdeIds, sessionData, onSessionSave, localRangeIndices, tmdeRangeIndices, expandedRangeKeys]);

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
          <div className="panel-card-actions" style={{ position: "relative" }}>
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
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setAddFunctionMenu((m) =>
                  m && m.kind === "uut" ? null : { kind: "uut", rect },
                );
              }}
              title="Add Function"
            >
              <FontAwesomeIcon icon={faPlus} size="xs" />
            </button>
            {renderAddFunctionMenu("uut")}
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
              <col style={{ width: "24%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "32%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "6%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Description</th>
                <th>
                  <span className="range-header-cell">
                    <span>Range(s)</span>
                    {renderRangeHeaderActions("uut")}
                  </span>
                </th>
                <th>
                  <span className="range-header-cell">
                    <span>Tolerance</span>
                    {renderToleranceHeaderActions("uut")}
                  </span>
                </th>
                <th>Resolution</th>
                <th className="cell-sync">Sync</th>
              </tr>
            </thead>
            <tbody>
              {getGroupedInstrumentRows(filteredUuts, "session", pinnedInlineUutIds, "uut").length === 0 ? (
                <tr className="panel-empty-row">
                  <td colSpan={5}>
                    No UUTs found in this context.
                  </td>
                </tr>
              ) : (
                getGroupedInstrumentRows(filteredUuts, "session", pinnedInlineUutIds, "uut").map((row) => {
                  if (row.type === "function") {
                    return (
                      <tr
                        key={`uut-fn-${row.fn.key}`}
                        className="instrument-area-section-row"
                      >
                        <td colSpan={5}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "2px",
                            }}
                          >
                            {renderFunctionColorSwatch(row.fn)}
                            {renderFunctionNameEditor(row.fn)}
                            {renderFunctionUnitChip(row.fn)}
                            {renderFunctionAddButton("uut", row.fn)}
                            {renderFunctionDeleteButton(row.fn)}
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  const uut = row.item;
                  // rowKey isolates per-subsection range state for multi-function
                  // instruments; it equals uut.id for single-function ones.
                  const uutRowKey = row.rowKey ?? uut.id;
                  const uutFnKey = row.functionKey ?? null;
                  let resolution = resolveUutRangeHelper(
                    uut,
                    { [uut.id]: localRangeIndices[uutRowKey] },
                    null,
                    null,
                    uutFnKey,
                  );

                  if (
                    viewMode === "range" &&
                    rangeData &&
                    localRangeIndices[uutRowKey] === undefined
                  ) {
                    const matchIndex = resolution.ranges.findIndex((r) => {
                      if (rangeData.rangeId && r.rangeId) {
                        const rangeIdMatch =
                          String(r.rangeId) === String(rangeData.rangeId);
                        const functionIdMatch =
                          !rangeData.functionId ||
                          !r.functionId ||
                          String(r.functionId) === String(rangeData.functionId);
                        if (rangeIdMatch && functionIdMatch) return true;
                      }
                      if (rangeData._id !== undefined && r._index !== undefined)
                        return r._index === rangeData._id;
                      const minMatch = r.min == rangeData.min;
                      const maxMatch = r.max == rangeData.max;
                      const unitMatch =
                        (r.unit || "") === (rangeData.unit || "");
                      const functionIdMatch =
                        rangeData.functionId && r.functionId
                          ? String(r.functionId) === String(rangeData.functionId)
                          : true;
                      return minMatch && maxMatch && unitMatch && functionIdMatch;
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
                  const activeTolerance =
                    getItemRangeTolerance(uut, activeRange?.id) || activeRange;
                  const selectedToleranceType = getSelectedToleranceType(
                    "uut",
                    uut,
                    activeRange,
                  );
                  const specRows = getSpecRows(activeTolerance);
                  const rowSpan = onSessionSave
                    ? 1
                    : specRows.length > 0
                      ? specRows.length
                      : 1;
                  const isSelected = selectedUutIds.includes(uut.id);
                  const showAllRanges = isShowingAllRanges("uut", uut.id);
                  const visibleRangeRows = getVisibleRangeRows(
                    ranges,
                    activeIndex,
                    activeRange,
                    showAllRanges,
                  );

                  // Expanded "view all ranges": one real <tr> per range so the
                  // Range / Tolerance / Resolution columns line up row-for-row.
                  // Description + Sync span the group via rowSpan; clicking a row
                  // selects that range so the header +/-/tolerance buttons act on it.
                  if (showAllRanges) {
                    const n = visibleRangeRows.length;
                    const canDelete = ranges.length > 1;
                    const activeRangeIndex = localRangeIndices[uutRowKey] ?? activeIndex;
                    return (
                      <React.Fragment key={uutRowKey}>
                        {visibleRangeRows.map(({ range, index, key }, i) => {
                          const isActiveRange = index === activeRangeIndex;
                          return (
                            <tr
                              key={key}
                              className={`inline-range-row${i === 0 ? " inline-range-row--first" : ""}${i === n - 1 ? " inline-range-row--last" : ""}${isSelected ? " instrument-selected" : ""}${isActiveRange ? " is-active-range" : ""} ${hoveredRowId === uut.id ? "row-hovered" : ""}`}
                              onMouseEnter={() => setHoveredRowId(uut.id)}
                              onContextMenu={(e) => openRangeRowMenu(e, "uut", uut, range, index, n)}
                              onMouseDownCapture={() => activateRangeRow("uut", uutRowKey, index)}
                              onClick={(e) => {
                                if (!isInlineRowControlTarget(e.target)) {
                                  setSelectedToleranceKey(null);
                                }
                              }}
                              style={{ cursor: "pointer" }}
                            >
                              {i === 0 && (
                                <td
                                  rowSpan={n}
                                  className={`cell-description ${hoveredCell.tableId === "uut" && hoveredCell.colIndex === 0 ? "col-hovered" : ""}`}
                                  onMouseEnter={() =>
                                    setHoveredCell({ tableId: "uut", colIndex: 0 })
                                  }
                                  title={uut.description}
                                >
                                  <EditableDescriptionCell
                                    name={uut.description}
                                    make={uut.instrument?.manufacturer}
                                    model={uut.instrument?.model}
                                    instruments={instruments}
                                    onPickLibrary={(inst) =>
                                      promptLibraryPick("uut", uut.id, inst, uutFnKey)
                                    }
                                    onCommit={(field, value) =>
                                      handleUutDescriptionEdit(uut.id, field, value)
                                    }
                                  />
                                </td>
                              )}
                              {renderRangeRowCells("uut", uut, range, {
                                includeDistribution: false,
                                canDelete,
                              })}
                              {i === 0 && (
                                <td
                                  rowSpan={n}
                                  className="cell-sync"
                                  style={{ textAlign: "center" }}
                                >
                                  <SyncBadge item={uut} onSync={() => handleSyncItem("uut", uut)} />
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  }

                  return (
                    <React.Fragment key={uutRowKey}>
                      <tr
                        className={`${isSelected ? "selected-row" : ""} ${hoveredRowId === uut.id ? "row-hovered" : ""}`}
                        onClick={(e) => handleUutClick(e, uut.id)}
                        onContextMenu={(e) => openInstrumentRowMenu(e, "uut", uut)}
                        onMouseEnter={() => setHoveredRowId(uut.id)}
                        draggable={!!onSessionSave && showAreaColumn}
                        onDragStart={handleInstrumentDragStart("uut", uut)}
                        onDragEnd={handleInstrumentDragEnd}
                        onDragOver={allowInstrumentDrop}
                        onDrop={handleInstrumentDropOnArea("uut", resolveItemAreaId("uut", uut))}
                        style={{
                          cursor: "pointer",
                          opacity: draggingInstrumentId === uut.id ? 0.4 : undefined,
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
                          {onSessionSave ? (
                            <EditableDescriptionCell
                              name={uut.description}
                              make={uut.instrument?.manufacturer}
                              model={uut.instrument?.model}
                              instruments={instruments}
                              onPickLibrary={(inst) =>
                                promptLibraryPick("uut", uut.id, inst, uutFnKey)
                              }
                              onCommit={(field, value) =>
                                handleUutDescriptionEdit(uut.id, field, value)
                              }
                            />
                          ) : (
                            uut.description
                          )}
                        </td>
                        <td
                          rowSpan={rowSpan}
                          className={`cell-value ${hoveredCell.tableId === "uut" && hoveredCell.colIndex === 1 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "uut", colIndex: 1 })
                          }
                          style={{ verticalAlign: "middle" }}
                        >
                          <div className={showAllRanges ? "range-stack" : undefined}>
                            {visibleRangeRows.map(({ range, index, key }) => (
                              <div className="range-stack-row" key={key}>
                                <RangeCell
                                  ranges={showAllRanges ? [range] : ranges}
                                  activeIndex={showAllRanges ? 0 : activeIndex}
                                  activeRange={range}
                                  editable={!!onSessionSave}
                                  allowSingleToggle={newRangeKeys.has(
                                    rangeStateKey("uut", uut.id, range?.id),
                                  )}
                                  onSelect={(idx) =>
                                    setLocalRangeIndices((prev) => ({ ...prev, [uutRowKey]: idx }))
                                  }
                                  onEditBound={(field, value) =>
                                    handleEditRangeBound("uut", uut, range?.id, field, value)
                                  }
                                  onEditUnit={(value) =>
                                    setRangeUnit("uut", uut, range?.id, value)
                                  }
                                  onPatchRange={(patch) =>
                                    patchRange("uut", uut, range?.id, patch)
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        </td>
                        <td
                          className={`cell-tolerance ${hoveredCell.tableId === "uut" && hoveredCell.colIndex === 2 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "uut", colIndex: 2 })
                          }
                          title={specRows[0]}
                        >
                          <div className={showAllRanges ? "range-stack" : undefined}>
                            {visibleRangeRows.map(({ range, key }) => {
                              const tolerance = getItemRangeTolerance(uut, range?.id) || range;
                              const typeKey = getSelectedToleranceType("uut", uut, range);
                              return (
                                <div className="range-stack-row" key={key}>
                                  {onSessionSave ? (
                                    <InlineToleranceCell
                                      tolerance={tolerance}
                                      activeRange={range}
                                      typeKey={typeKey}
                                      selectedType={
                                        selectedToleranceKey ===
                                        toleranceTypeKey("uut", uut, range?.id)
                                          ? typeKey
                                          : null
                                      }
                                      editable={!!onSessionSave}
                                      onSelectType={(nextTypeKey) =>
                                        setSelectedToleranceType("uut", uut, range, nextTypeKey)
                                      }
                                      onCommit={(nextTypeKey, component) =>
                                        setRangeToleranceComponent(
                                          "uut",
                                          uut,
                                          range,
                                          nextTypeKey,
                                          component,
                                        )
                                      }
                                    />
                                  ) : (
                                    getSpecRows(tolerance)[0]
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        <td
                          rowSpan={rowSpan}
                          className={`cell-value ${hoveredCell.tableId === "uut" && hoveredCell.colIndex === 3 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "uut", colIndex: 3 })
                          }
                          title={formatResolutionLabel(activeRange)}
                        >
                          <div className={showAllRanges ? "range-stack" : undefined}>
                            {visibleRangeRows.map(({ range, key }) => (
                              <div className="range-stack-row" key={key}>
                                {onSessionSave ? (
                                  <ResolutionCellInput
                                    value={range?.resolution ?? range?.measuringResolution}
                                    unit={range?.resolutionUnit ?? range?.measuringResolutionUnit}
                                    fallbackUnit={range?.unit}
                                    onCommit={(v) =>
                                      setRangeResolution("uut", uut, range?.id, v)
                                    }
                                    onCommitUnit={(value) =>
                                      setRangeResolutionUnit("uut", uut, range?.id, value)
                                    }
                                    useResolution={range?.includeResolutionInBudget}
                                    onToggleUse={(checked) =>
                                      setRangeUseResolution("uut", uut, range?.id, checked)
                                    }
                                  />
                                ) : (
                                  formatResolutionLabel(range)
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td
                          rowSpan={rowSpan}
                          className="cell-sync"
                          style={{ textAlign: "center" }}
                        >
                          <SyncBadge item={uut} onSync={() => handleSyncItem("uut", uut)} />
                        </td>
                      </tr>
                      {!onSessionSave && specRows.slice(1).map((specComp, sIdx) => (
                        <tr
                          key={`${uut.id}-spec-${sIdx}`}
                          className={`spec-row ${isSelected ? "selected-spec-row" : ""} ${hoveredRowId === uut.id ? "hovered-spec-row" : ""}`}
                          onMouseEnter={() => setHoveredRowId(uut.id)}
                          style={{ cursor: "pointer" }}
                          onClick={(e) => handleUutClick(e, uut.id)}
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
          <div className="panel-card-actions" style={{ position: "relative" }}>
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
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setAddFunctionMenu((m) =>
                  m && m.kind === "tmde" ? null : { kind: "tmde", rect },
                );
              }}
              title="Add Function"
            >
              <FontAwesomeIcon icon={faPlus} size="xs" />
            </button>
            {renderAddFunctionMenu("tmde")}
          </div>
        </div>
        <div className="panel-table-container">
          <table
            className="instrument-summary-table industry-table equipment-summary-table"
            onMouseLeave={() => {
              setHoveredCell({ tableId: null, colIndex: null });
              setHoveredRowId(null);
            }}
            style={{ tableLayout: "fixed" }}
          >
            <colgroup>
              <col style={{ width: "21%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "5%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Description</th>
                <th>
                  <span className="range-header-cell">
                    <span>Range</span>
                    {renderRangeHeaderActions("tmde")}
                  </span>
                </th>
                <th>
                  <span className="range-header-cell">
                    <span>Error Limit</span>
                    {renderToleranceHeaderActions("tmde")}
                  </span>
                </th>
                <th className="cell-distribution">Distribution</th>
                <th>Resolution</th>
                <th className="cell-sync">Sync</th>
              </tr>
            </thead>
            <tbody>
              {getGroupedInstrumentRows(filteredTmdes, "instrument", pinnedInlineTmdeIds, "tmde").length === 0 ? (
                <tr className="panel-empty-row">
                  <td colSpan={6}>No TMDEs found in session.</td>
                </tr>
              ) : (
                getGroupedInstrumentRows(filteredTmdes, "instrument", pinnedInlineTmdeIds, "tmde").map((row) => {
                  if (row.type === "function") {
                    return (
                      <tr
                        key={`tmde-fn-${row.fn.key}`}
                        className="instrument-area-section-row"
                      >
                        <td colSpan={6}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "2px",
                            }}
                          >
                            {renderFunctionColorSwatch(row.fn)}
                            {renderFunctionNameEditor(row.fn)}
                            {renderFunctionUnitChip(row.fn)}
                            {renderFunctionAddButton("tmde", row.fn)}
                            {renderFunctionDeleteButton(row.fn)}
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  const tmde = row.item;
                  const idx = row.index;
                  const tmdeRowKey = row.rowKey ?? tmde.id;
                  const tmdeFnKey = row.functionKey ?? null;
                  const resolution = resolveUutRangeHelper(
                    tmde,
                    { [tmde.id]: tmdeRangeIndices[tmdeRowKey] },
                    null,
                    null,
                    tmdeFnKey,
                  );
                  const { ranges, activeIndex, activeRange } = resolution;
                  const activeTolerance =
                    getItemRangeTolerance(tmde, activeRange?.id) || activeRange;
                  const selectedToleranceType = getSelectedToleranceType(
                    "tmde",
                    tmde,
                    activeRange,
                  );
                  const specRows = getSpecRows(activeTolerance);
                  const rowSpan = onSessionSave
                    ? 1
                    : specRows.length > 0
                      ? specRows.length
                      : 1;
                  const isSelected = selectedTmdeIds.includes(tmde.id);
                  const showAllRanges = isShowingAllRanges("tmde", tmde.id);
                  const visibleRangeRows = getVisibleRangeRows(
                    ranges,
                    activeIndex,
                    activeRange,
                    showAllRanges,
                  );

                  // Expanded "view all ranges": one real <tr> per range (see the
                  // UUT block above for the rationale). TMDE adds the Distribution
                  // per-range cell.
                  if (showAllRanges) {
                    const n = visibleRangeRows.length;
                    const canDelete = ranges.length > 1;
                    const activeRangeIndex = tmdeRangeIndices[tmdeRowKey] ?? activeIndex;
                    return (
                      <React.Fragment key={tmdeRowKey || idx}>
                        {visibleRangeRows.map(({ range, index, key }, i) => {
                          const isActiveRange = index === activeRangeIndex;
                          return (
                            <tr
                              key={key}
                              className={`inline-range-row${i === 0 ? " inline-range-row--first" : ""}${i === n - 1 ? " inline-range-row--last" : ""}${isSelected ? " instrument-selected" : ""}${isActiveRange ? " is-active-range" : ""} ${hoveredRowId === tmde.id ? "row-hovered" : ""}`}
                              onMouseEnter={() => setHoveredRowId(tmde.id)}
                              onContextMenu={(e) => openRangeRowMenu(e, "tmde", tmde, range, index, n)}
                              onMouseDownCapture={() => activateRangeRow("tmde", tmdeRowKey, index)}
                              onClick={(e) => {
                                if (!isInlineRowControlTarget(e.target)) {
                                  setSelectedToleranceKey(null);
                                }
                              }}
                              style={{ cursor: "pointer" }}
                            >
                              {i === 0 && (
                                <td
                                  rowSpan={n}
                                  className={`cell-description ${hoveredCell.tableId === "tmde" && hoveredCell.colIndex === 0 ? "col-hovered" : ""}`}
                                  onMouseEnter={() =>
                                    setHoveredCell({ tableId: "tmde", colIndex: 0 })
                                  }
                                  title={tmde.name}
                                >
                                  <EditableDescriptionCell
                                    name={tmde.name}
                                    make={tmde.instrument?.manufacturer}
                                    model={tmde.instrument?.model}
                                    instruments={instruments}
                                    onPickLibrary={(inst) =>
                                      promptLibraryPick("tmde", tmde.id, inst, tmdeFnKey)
                                    }
                                    onCommit={(field, value) =>
                                      handleTmdeDescriptionEdit(tmde.id, field, value)
                                    }
                                  />
                                </td>
                              )}
                              {renderRangeRowCells("tmde", tmde, range, {
                                includeDistribution: true,
                                canDelete,
                              })}
                              {i === 0 && (
                                <td
                                  rowSpan={n}
                                  className="cell-sync"
                                  style={{ textAlign: "center" }}
                                >
                                  <SyncBadge item={tmde} onSync={() => handleSyncItem("tmde", tmde)} />
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  }

                  return (
                    <React.Fragment key={tmdeRowKey || idx}>
                      <tr
                        className={`${isSelected ? "selected-row" : ""} ${hoveredRowId === tmde.id ? "row-hovered" : ""}`}
                        onClick={(e) => handleTmdeClick(e, tmde.id)}
                        onContextMenu={(e) => openInstrumentRowMenu(e, "tmde", tmde)}
                        onMouseEnter={() => setHoveredRowId(tmde.id)}
                        draggable={!!onSessionSave && showAreaColumn}
                        onDragStart={handleInstrumentDragStart("tmde", tmde)}
                        onDragEnd={handleInstrumentDragEnd}
                        onDragOver={allowInstrumentDrop}
                        onDrop={handleInstrumentDropOnArea("tmde", resolveItemAreaId("tmde", tmde))}
                        style={{
                          cursor: "pointer",
                          opacity: draggingInstrumentId === tmde.id ? 0.4 : undefined,
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
                          {onSessionSave ? (
                            <EditableDescriptionCell
                              name={tmde.name}
                              make={tmde.instrument?.manufacturer}
                              model={tmde.instrument?.model}
                                instruments={instruments}
                                onPickLibrary={(inst) =>
                                  promptLibraryPick("tmde", tmde.id, inst, tmdeFnKey)
                                }
                              onCommit={(field, value) =>
                                handleTmdeDescriptionEdit(tmde.id, field, value)
                              }
                            />
                          ) : (
                            <>
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
                            </>
                          )}
                        </td>
                        <td
                          rowSpan={rowSpan}
                          className={`cell-value ${hoveredCell.tableId === "tmde" && hoveredCell.colIndex === 1 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "tmde", colIndex: 1 })
                          }
                          style={{ verticalAlign: "middle" }}
                        >
                          <div className={showAllRanges ? "range-stack" : undefined}>
                            {visibleRangeRows.map(({ range, key }) => (
                              <div className="range-stack-row" key={key}>
                                <RangeCell
                                  ranges={showAllRanges ? [range] : ranges}
                                  activeIndex={showAllRanges ? 0 : activeIndex}
                                  activeRange={range}
                                  editable={!!onSessionSave}
                                  allowSingleToggle={newRangeKeys.has(
                                    rangeStateKey("tmde", tmde.id, range?.id),
                                  )}
                                  onSelect={(idx) =>
                                    setTmdeRangeIndices((prev) => ({ ...prev, [tmdeRowKey]: idx }))
                                  }
                                  onEditBound={(field, value) =>
                                    handleEditRangeBound("tmde", tmde, range?.id, field, value)
                                  }
                                  onEditUnit={(value) =>
                                    setRangeUnit("tmde", tmde, range?.id, value)
                                  }
                                  onPatchRange={(patch) =>
                                    patchRange("tmde", tmde, range?.id, patch)
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        </td>
                        <td
                          className={`cell-tolerance ${hoveredCell.tableId === "tmde" && hoveredCell.colIndex === 2 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "tmde", colIndex: 2 })
                          }
                          title={specRows[0]}
                        >
                          <div className={showAllRanges ? "range-stack" : undefined}>
                            {visibleRangeRows.map(({ range, key }) => {
                              const tolerance = getItemRangeTolerance(tmde, range?.id) || range;
                              const typeKey = getSelectedToleranceType("tmde", tmde, range);
                              return (
                                <div className="range-stack-row" key={key}>
                                  {onSessionSave ? (
                                    <InlineToleranceCell
                                      tolerance={tolerance}
                                      activeRange={range}
                                      typeKey={typeKey}
                                      selectedType={
                                        selectedToleranceKey ===
                                        toleranceTypeKey("tmde", tmde, range?.id)
                                          ? typeKey
                                          : null
                                      }
                                      editable={!!onSessionSave}
                                      onSelectType={(nextTypeKey) =>
                                        setSelectedToleranceType("tmde", tmde, range, nextTypeKey)
                                      }
                                      onCommit={(nextTypeKey, component) =>
                                        setRangeToleranceComponent(
                                          "tmde",
                                          tmde,
                                          range,
                                          nextTypeKey,
                                          component,
                                        )
                                      }
                                    />
                                  ) : (
                                    getSpecRows(tolerance)[0]
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        <td
                          rowSpan={rowSpan}
                          className="cell-distribution"
                          title="Spec band distribution"
                          style={{ verticalAlign: "middle" }}
                        >
                          <div className={showAllRanges ? "range-stack" : undefined}>
                            {visibleRangeRows.map(({ range, key }) => {
                              const tolerance = getItemRangeTolerance(tmde, range?.id) || range;
                              return (
                                <div className="range-stack-row" key={key}>
                                  {onSessionSave && getBandDistDivisor(tolerance) ? (
                                    <select
                                      className="session-selector"
                                      value={getBandDistDivisor(tolerance)}
                                      onChange={(e) =>
                                        setRangeBandDistribution("tmde", tmde, range?.id, e.target.value)
                                      }
                                    >
                                      {errorDistributions.map((d) => (
                                        <option key={d.value} value={d.value}>
                                          {d.label}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    getBandDistLabel(tolerance)
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        <td
                          rowSpan={rowSpan}
                          className={`cell-value ${hoveredCell.tableId === "tmde" && hoveredCell.colIndex === 3 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "tmde", colIndex: 3 })
                          }
                          title={formatResolutionLabel(activeRange)}
                        >
                          <div className={showAllRanges ? "range-stack" : undefined}>
                            {visibleRangeRows.map(({ range, key }) => (
                              <div className="range-stack-row" key={key}>
                                {onSessionSave ? (
                                  <ResolutionCellInput
                                    value={range?.resolution ?? range?.measuringResolution}
                                    unit={range?.resolutionUnit ?? range?.measuringResolutionUnit}
                                    fallbackUnit={range?.unit}
                                    onCommit={(v) =>
                                      setRangeResolution("tmde", tmde, range?.id, v)
                                    }
                                    onCommitUnit={(value) =>
                                      setRangeResolutionUnit("tmde", tmde, range?.id, value)
                                    }
                                    useResolution={range?.includeResolutionInBudget}
                                    onToggleUse={(checked) =>
                                      setRangeUseResolution("tmde", tmde, range?.id, checked)
                                    }
                                  />
                                ) : (
                                  formatResolutionLabel(range)
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td
                          rowSpan={rowSpan}
                          className="cell-sync"
                          style={{ textAlign: "center" }}
                        >
                          <SyncBadge item={tmde} onSync={() => handleSyncItem("tmde", tmde)} />
                        </td>
                      </tr>
                      {!onSessionSave && specRows.slice(1).map((specComp, sIdx) => (
                        <tr
                          key={`${tmde.id}-spec-${sIdx}`}
                          className={`spec-row ${isSelected ? "selected-spec-row" : ""} ${hoveredRowId === tmde.id ? "hovered-spec-row" : ""}`}
                          style={{ cursor: "pointer" }}
                          onClick={(e) => handleTmdeClick(e, tmde.id)}
                          onMouseEnter={() => setHoveredRowId(tmde.id)}
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

      <ContextMenu menu={rowMenu} onClose={() => setRowMenu(null)} />
    </div>
  );
};

function DetailedView({
  testPointData,
  sessionData,
  onSessionSave,
  onSaveInstrument,
  instruments = [],
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
  activeRangeIndices = {},
  onRangeSelectionChange,

  // Custom equation library (global, persisted like the instrument library)
  customEquations = [],
  onSaveCustomEquation,
  onDeleteCustomEquation,

  // NEW PROPS FOR ACTIONS
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
  // Declared here (alongside the other range-index state) so it precedes the
  // keydown effect that lists it as a dependency — otherwise referencing it in
  // the deps array hits a temporal dead zone during render.
  const [localRangeIndices, setLocalRangeIndices] = useState({});
  const [newRangeKeys, setNewRangeKeys] = useState(() => new Set());
  const [expandedRangeKeys, setExpandedRangeKeys] = useState(() => new Set());

  // --- NEW: Local Selection State ---
  const [selectedUutIds, setSelectedUutIds] = useState([]);
  const [selectedTmdeIds, setSelectedTmdeIds] = useState([]);
  const [equationTmdeSelections, setEquationTmdeSelections] = useState({});

  // --- Cut / copy / paste of instrument rows (shared module clipboard) ---
  const [rowMenu, setRowMenu] = useState(null);
  const resolveDetailAreaId = (kind, item) => {
    if (!item) return "";
    if (kind === "uut") return item.measurementAreaId || "";
    if (item.measurementAreaId) return item.measurementAreaId;
    const name = item.instrument?.measurementArea || item.measurementArea || "";
    const area = (sessionData.measurementAreas || []).find(
      (a) => name && a.name === name,
    );
    return area ? area.id : "";
  };
  const copyInstrument = (kind, item, mode = "copy") => {
    instrumentClipboard = { kind, mode, item: JSON.parse(JSON.stringify(item)) };
  };
  const pasteInstrument = (kind, targetAreaId) => {
    if (!onSessionSave || !instrumentClipboard) return;
    const clip = instrumentClipboard;
    if (clip.kind !== kind) return;
    const listKey = kind === "uut" ? "uuts" : "tmdes";
    const area = (sessionData.measurementAreas || []).find(
      (a) => String(a.id) === String(targetAreaId),
    );
    if (clip.mode === "cut") {
      const moved = buildPastedInstrumentRow(clip.item, kind, area, "cut");
      const list = (sessionData[listKey] || []).map((row) =>
        row.id === clip.item.id ? moved : row,
      );
      instrumentClipboard = null;
      onSessionSave({ ...sessionData, [listKey]: list });
    } else {
      const clone = buildPastedInstrumentRow(clip.item, kind, area, "copy");
      if (kind === "uut") setSelectedUutIds([clone.id]);
      else setSelectedTmdeIds([clone.id]);
      onSessionSave({
        ...sessionData,
        [listKey]: [clone, ...(sessionData[listKey] || [])],
      });
    }
  };
  const deleteInstrumentRow = (kind, id) => {
    if (kind === "uut") onDeleteUut?.([id]);
    else onDeleteTmdeDefinition?.([id]);
  };
  const openInstrumentRowMenu = (e, kind, item) => {
    if (!onSessionSave) return;
    e.preventDefault();
    e.stopPropagation();
    if (kind === "uut") setSelectedUutIds([item.id]);
    else setSelectedTmdeIds([item.id]);
    const canPaste = !!instrumentClipboard && instrumentClipboard.kind === kind;
    const areaId = resolveDetailAreaId(kind, item);
    const items = [
      { label: "Copy", icon: faCopy, action: () => copyInstrument(kind, item, "copy") },
      { label: "Cut", icon: faScissors, action: () => copyInstrument(kind, item, "cut") },
    ];
    if (canPaste) {
      items.push({
        label: "Paste",
        icon: faPaste,
        action: () => pasteInstrument(kind, areaId),
      });
    }
    items.push({ type: "divider" });
    items.push({
      label: "Delete",
      icon: faTrashAlt,
      className: "destructive",
      action: () => deleteInstrumentRow(kind, item.id),
    });
    setRowMenu({ x: e.clientX, y: e.clientY, items });
  };

  // --- Range-row clipboard (copy/cut/paste a single range) ---
  const copyRange = (kind, item, rangeId) => {
    const r = findItemRange(item, rangeId);
    if (!r) return;
    const clone = JSON.parse(JSON.stringify(r));
    if (!clone.unit) {
      // Function-based instruments keep the unit on the function, not the range.
      // Capture the resolved unit so a pasted copy keeps its own unit group even
      // if dropped next to a different-unit range.
      const fn = (item?.instrument?.functions || []).find((f) =>
        (f.ranges || []).some((x) => sameId(x.id, rangeId)),
      );
      if (fn?.unit) clone.unit = fn.unit;
    }
    rangeClipboard = { kind, range: clone };
  };
  const cutRange = (kind, item, range, totalRanges) => {
    copyRange(kind, item, range?.id);
    if (totalRanges > 1) handleRemoveRangeDetail(kind, item, range?.id);
  };
  const pasteRange = (kind, item, activeRangeId) => {
    if (!onSessionSave || !rangeClipboard || rangeClipboard.kind !== kind) return;
    const { item: updated, newRangeId } = pasteRangeIntoItem(
      item,
      activeRangeId,
      rangeClipboard.range,
    );
    persistInlineItemDetail(kind, updated);
    const setIdx = kind === "uut" ? setLocalRangeIndices : setTmdeRangeIndices;
    const resolved = resolveUutRangeHelper(updated, {}, null, null).ranges || [];
    const newIdx = resolved.findIndex((r) => sameId(r.id, newRangeId));
    if (newIdx >= 0) setIdx((prev) => ({ ...prev, [item.id]: newIdx }));
  };
  const openRangeRowMenu = (e, kind, item, range, index, totalRanges) => {
    if (!onSessionSave) return;
    e.preventDefault();
    e.stopPropagation();
    activateRangeRowDetail(kind, item.id, index);
    const canPaste = !!rangeClipboard && rangeClipboard.kind === kind;
    const canDelete = totalRanges > 1;
    const label = kind === "uut" ? "UUT" : "TMDE";
    const items = [
      { label: "Copy Range", icon: faCopy, action: () => copyRange(kind, item, range?.id) },
    ];
    if (canDelete) {
      items.push({
        label: "Cut Range",
        icon: faScissors,
        action: () => cutRange(kind, item, range, totalRanges),
      });
    }
    if (canPaste) {
      items.push({
        label: "Paste Range",
        icon: faPaste,
        action: () => pasteRange(kind, item, range?.id),
      });
    }
    if (canDelete) {
      items.push({ type: "divider" });
      items.push({
        label: "Delete Range",
        icon: faTrashAlt,
        className: "destructive",
        action: () =>
          confirmViaNotification(setNotification, {
            title: "Delete Range",
            message: `Delete this range from this ${label}? This can't be undone.`,
            confirmText: "Delete",
            onConfirm: () => handleRemoveRangeDetail(kind, item, range?.id),
          }),
      });
    }
    setRowMenu({ x: e.clientX, y: e.clientY, items });
  };

  useEffect(() => {
    const onKey = (e) => {
      if (!onSessionSave || !(e.ctrlKey || e.metaKey)) return;
      const ae = document.activeElement;
      if (
        ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.isContentEditable)
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      const oneUut = selectedUutIds.length === 1 ? selectedUutIds[0] : null;
      const oneTmde = selectedTmdeIds.length === 1 ? selectedTmdeIds[0] : null;
      const kind = oneUut ? "uut" : oneTmde ? "tmde" : null;
      const findItem = (k, id) =>
        (k === "uut" ? sessionData.uuts : sessionData.tmdes)?.find(
          (x) => x.id === id,
        );

      // Expanded instrument → copy/cut/paste act on the active range.
      if (kind && isShowingAllRangesDetail(kind, oneUut || oneTmde)) {
        const target = getSelectedRangeTargetDetail(kind);
        if (target?.activeRange) {
          if (key === "c" || key === "x") {
            e.preventDefault();
            e.stopImmediatePropagation();
            copyRange(kind, target.item, target.activeRange.id);
            if (key === "x" && target.ranges.length > 1) {
              handleRemoveRangeDetail(kind, target.item, target.activeRange.id);
            }
            return;
          }
          if (key === "v" && rangeClipboard && rangeClipboard.kind === kind) {
            e.preventDefault();
            e.stopImmediatePropagation();
            pasteRange(kind, target.item, target.activeRange.id);
            return;
          }
        }
      }

      if ((key === "c" || key === "x") && kind) {
        const item = findItem(kind, oneUut || oneTmde);
        if (item) {
          e.preventDefault();
          e.stopImmediatePropagation();
          copyInstrument(kind, item, key === "x" ? "cut" : "copy");
        }
      } else if (key === "v" && instrumentClipboard) {
        const pasteKind = instrumentClipboard.kind;
        const haveTarget =
          (pasteKind === "uut" && oneUut) || (pasteKind === "tmde" && oneTmde);
        if (!haveTarget) return;
        const areaId = resolveDetailAreaId(
          pasteKind,
          findItem(pasteKind, pasteKind === "uut" ? oneUut : oneTmde) || {},
        );
        e.preventDefault();
        e.stopImmediatePropagation();
        pasteInstrument(pasteKind, areaId);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUutIds, selectedTmdeIds, sessionData, onSessionSave, localRangeIndices, tmdeRangeIndices, expandedRangeKeys]);

  // Industry Grade Highlighting State
  // Industry Grade Highlighting State
  const [hoveredCell, setHoveredCell] = useState({
    tableId: null,
    colIndex: null,
  });
  const [hoveredRowId, setHoveredRowId] = useState(null);

  // ===========================================================================
  // Inline instrument editing in the measurement-point view — FULL PARITY with
  // the Session Overview (SummaryDashboard). Operates on the SAME session masters
  // (sessionData.uuts/.tmdes) via onSessionSave and reuses the module-level pure
  // helpers, so a UUT/TMDE edits identically in either view: description +
  // library search/pick, local-library auto-save (sync badge), range bounds /
  // add / remove, tolerance term edit / add / delete, resolution, area reassign.
  // ===========================================================================
  const [localLibraryChoices, setLocalLibraryChoices] = useState({});
  const [toleranceTypes, setToleranceTypes] = useState({});
  const [selectedToleranceKey, setSelectedToleranceKey] = useState(null);
  const [openToleranceAddMenu, setOpenToleranceAddMenu] = useState(null);
  const { syncToShared, getDiff } = useInstrumentSync();

  const rowLabel = (kind, item) =>
    kind === "uut" ? item?.description || "" : item?.name || "";
  const itemInstrumentForLibrary = (kind, item) => {
    const inst = item?.instrument || {};
    const areaName =
      kind === "uut"
        ? item?.measurementArea || inst.measurementArea || ""
        : inst.measurementArea || item?.measurementArea || "";
    const areaColor =
      kind === "uut"
        ? item?.measurementAreaColor || inst.measurementAreaColor || ""
        : inst.measurementAreaColor || "";
    return {
      ...inst,
      id: inst.id || item?.libraryInstrumentId || item?.id || uuidv4(),
      manufacturer: inst.manufacturer || "",
      model: inst.model || "",
      description: rowLabel(kind, item) || inst.description || "",
      functions: inst.functions || [],
      measurementArea: areaName,
      measurementAreaColor: areaColor,
      scope: inst.scope || "local",
    };
  };

  const replaceSyncedItem = (kind, item, syncedInstrument) => {
    if (!onSessionSave || !syncedInstrument) return;
    const listKey = kind === "uut" ? "uuts" : "tmdes";
    const updatedItem = {
      ...item,
      libraryInstrumentId: syncedInstrument.id,
      instrument: {
        ...syncedInstrument,
        measurementArea:
          item.instrument?.measurementArea || syncedInstrument.measurementArea || "",
        measurementAreaColor:
          item.instrument?.measurementAreaColor ||
          syncedInstrument.measurementAreaColor ||
          "",
      },
    };
    onSessionSave({
      ...sessionData,
      [listKey]: (sessionData[listKey] || []).map((existing) =>
        existing.id === item.id ? updatedItem : existing,
      ),
    });
  };

  const handleSyncItem = (kind, item) => {
    if (!setNotification || !item) return;
    const instrument = itemInstrumentForLibrary(kind, item);
    const state = computeSyncState(instrument);
    const linked = Boolean(instrument.sourceId) || instrument.scope === "validated";
    const label = libraryLabel(instrument);

    if (state === "green") {
      setNotification({
        title: "Already Synced",
        message: `${label} already matches the shared library snapshot.`,
      });
      return;
    }

    setNotification({
      title: linked ? "Re-sync Instrument" : "Sync Instrument",
      message: `${syncDiffSummary(getDiff(instrument))} Enter the shared-library password to sync ${label}.`,
      inputLabel: "Shared library password",
      inputPlaceholder: "Password",
      confirmText: linked ? "Re-sync" : "Sync",
      validateInput: (value) => (!value.trim() ? "Password is required." : ""),
      onConfirm: async (password) => {
        const result = await syncToShared(instrument, password);
        if (result.ok && result.instrument) {
          replaceSyncedItem(kind, item, result.instrument);
          setLocalLibraryChoices((prev) => ({
            ...prev,
            [`${kind}:${item.id}`]: "shared",
          }));
          setNotification({
            title: "Sync Complete",
            message: `${label} is now synced with the shared library.`,
          });
          return;
        }
        setNotification({
          title: "Sync Error",
          message: result.message || "Could not sync this instrument.",
        });
      },
    });
  };
  const saveItemInstrumentToLocalLibrary = (kind, item) => {
    if (!onSaveInstrument || !item) return;
    const instrument = itemInstrumentForLibrary(kind, item);
    onSaveInstrument({
      ...instrument,
      scope: "local",
      sourceId:
        instrument.sourceId ||
        (instrument.scope === "validated" ? instrument.id : undefined),
      validatedSnapshot:
        instrument.validatedSnapshot ||
        (instrument.scope === "validated" ? buildValidatedSnapshot(instrument) : null),
    });
  };
  const promptLocalLibrarySave = (kind, item) => {
    if (!onSaveInstrument || !item?.instrument) return;
    const key = `${kind}:${item.id}`;
    if (localLibraryChoices[key]) {
      if (localLibraryChoices[key] === "local")
        saveItemInstrumentToLocalLibrary(kind, item);
      return;
    }
    const saveLocal = () => {
      setLocalLibraryChoices((prev) => ({ ...prev, [key]: "local" }));
      saveItemInstrumentToLocalLibrary(kind, item);
      setNotification?.(null);
    };
    const sessionOnly = () => {
      setLocalLibraryChoices((prev) => ({ ...prev, [key]: "session" }));
      setNotification?.(null);
    };
    if (!setNotification) {
      saveLocal();
      return;
    }
    setNotification({
      title: "Save Instrument",
      message:
        "Save this new inline instrument to your local library so it appears in future searches?",
      confirmText: "Save Local",
      secondaryText: "Session Only",
      onConfirm: saveLocal,
      onSecondary: sessionOnly,
    });
  };
  const refreshPointTmdeInstance = (updatedItem, { reselectRange = false } = {}) => {
    if (!onUpdateTestPoint || !updatedItem) return;
    // When the underlying instrument is swapped wholesale (library pick), the old
    // instance's range index no longer maps to the new range list — pick a range
    // that covers this point instead (Priority C). For plain inline edits the
    // ranges are stable, so keep the user's current selection.
    const reselectedIndex = reselectRange
      ? resolveUutRangeHelper(
          updatedItem,
          {},
          null,
          isDerived ? null : uutNominal,
        ).activeIndex
      : null;
    let touched = false;
    const nextTolerances = (tmdeTolerancesData || []).map((instance) => {
      const matchesMaster =
        String(instance.id) === String(updatedItem.id) ||
        String(instance.sourceId) === String(updatedItem.id);
      if (!matchesMaster) return instance;

      touched = true;
      return createInstanceFromDefinition(updatedItem, {
        existingId: instance.id,
        quantity: instance.quantity ?? 1,
        assetId: instance.assetId || "",
        userFunctionId: instance.functionId || "",
        userFunctionName: instance.functionName || "",
        userRangeId: instance.rangeId || "",
        userRangeIndex:
          reselectedIndex ??
          instance._index ??
          tmdeRangeIndices[updatedItem.id] ??
          0,
        userMeasurement: instance.measurementPoint,
        userVariable: instance.variableType || "",
      });
    });

    if (touched) {
      onUpdateTestPoint({ tmdeTolerances: nextTolerances });
    }
  };
  const persistInlineItemDetail = (
    kind,
    updatedItem,
    { maybePromptLocal = false } = {},
  ) => {
    if (!onSessionSave) return;
    const listKey = kind === "uut" ? "uuts" : "tmdes";
    onSessionSave({
      ...sessionData,
      [listKey]: (sessionData[listKey] || []).map((it) =>
        it.id === updatedItem.id ? updatedItem : it,
      ),
    });
    if (
      onSaveInstrument &&
      (updatedItem.instrument?.sourceId ||
        updatedItem.instrument?.scope === "local" ||
        localLibraryChoices[`${kind}:${updatedItem.id}`] === "local")
    ) {
      saveItemInstrumentToLocalLibrary(kind, updatedItem);
    } else if (maybePromptLocal) {
      promptLocalLibrarySave(kind, updatedItem);
    }
    if (kind === "tmde") {
      refreshPointTmdeInstance(updatedItem);
    }
  };

  const handleDetailUutDescEdit = (uutId, field, value) => {
    if (!onSessionSave) return;
    let updatedItem = null;
    const updatedUuts = (sessionData.uuts || []).map((u) => {
      if (u.id !== uutId) return u;
      updatedItem =
        field === "name"
          ? { ...u, description: value }
          : {
              ...u,
              instrument: {
                ...(u.instrument || {}),
                [field === "make" ? "manufacturer" : "model"]: value,
              },
            };
      return updatedItem;
    });
    onSessionSave({ ...sessionData, uuts: updatedUuts });
    if (updatedItem) {
      if (
        onSaveInstrument &&
        (updatedItem.instrument?.sourceId ||
          updatedItem.instrument?.scope === "local" ||
          localLibraryChoices[`uut:${updatedItem.id}`] === "local")
      ) {
        saveItemInstrumentToLocalLibrary("uut", updatedItem);
      } else {
        promptLocalLibrarySave("uut", updatedItem);
      }
    }
  };
  const handleDetailTmdeDescEdit = (tmdeId, field, value) => {
    if (!onSessionSave) return;
    let updatedItem = null;
    const updatedTmdes = (sessionData.tmdes || []).map((t) => {
      if (t.id !== tmdeId) return t;
      updatedItem =
        field === "name"
          ? { ...t, name: value }
          : {
              ...t,
              instrument: {
                ...(t.instrument || {}),
                [field === "make" ? "manufacturer" : "model"]: value,
              },
            };
      return updatedItem;
    });
    onSessionSave({ ...sessionData, tmdes: updatedTmdes });
    if (updatedItem) {
      if (
        onSaveInstrument &&
        (updatedItem.instrument?.sourceId ||
          updatedItem.instrument?.scope === "local" ||
          localLibraryChoices[`tmde:${updatedItem.id}`] === "local")
      ) {
        saveItemInstrumentToLocalLibrary("tmde", updatedItem);
      } else {
        promptLocalLibrarySave("tmde", updatedItem);
      }
      // Keep this point's TMDE instance in sync with the edited master (parity
      // with persistInlineItemDetail), so an assigned TMDE's row/risk update.
      refreshPointTmdeInstance(updatedItem);
    }
  };

  // --- Library pick from the description dropdown (auto-creates the area) ---
  const ensureAreaForInstrument = (areas, inst, { hiddenFromSidebar = false } = {}) => {
    const areaName = (inst.measurementArea || "").trim();
    if (!areaName) return { areas, area: null };
    const existing = (areas || []).find(
      (a) => (a.name || "").toLowerCase() === areaName.toLowerCase(),
    );
    if (existing) return { areas, area: existing };
    const color =
      typeof inst.measurementAreaColor === "string" &&
      inst.measurementAreaColor.startsWith("#")
        ? inst.measurementAreaColor
        : AREA_PALETTE[(areas || []).length % AREA_PALETTE.length];
    const area = { id: uuidv4(), name: areaName, color, hiddenFromSidebar };
    return { areas: [...(areas || []), area], area };
  };
  const findLinkedLocalInstrument = (inst) => {
    const sourceId = inst?.sourceId || (inst?.scope === "validated" ? inst.id : null);
    if (!sourceId) return null;
    return (instruments || []).find(
      (candidate) =>
        candidate.scope === "local" &&
        String(candidate.sourceId) === String(sourceId),
    );
  };
  const instrumentDefFromLibrary = (existing, inst, { track = false, localCopy = false } = {}) => ({
    ...(existing || {}),
    id: existing?.id || uuidv4(),
    manufacturer: inst.manufacturer || "",
    model: inst.model || "",
    description: inst.description || "",
    functions: inst.functions || [],
    libraryInstrumentId: track ? inst.sourceId || inst.id : undefined,
    scope: track ? (localCopy ? "local" : inst.scope) : "local",
    sourceId: track ? inst.sourceId || (inst.scope === "validated" ? inst.id : undefined) : undefined,
    validatedSnapshot:
      track && (inst.scope === "validated" || localCopy)
        ? buildValidatedSnapshot(inst)
        : track
          ? existing?.validatedSnapshot || inst.validatedSnapshot || null
          : null,
  });
  const libraryLabel = (inst) =>
    inst.description ||
    `${inst.manufacturer || ""} ${inst.model || ""}`.trim() ||
    "Instrument";
  const applyPickedLibraryUut = (uutId, inst, options = {}) => {
    if (!onSessionSave) return;
    // In the per-point detail view the row is shown in the context of the active
    // measurement area (relevantUuts filters by it). Keep the UUT in its current
    // area instead of relocating it to the library instrument's stored area —
    // otherwise the row drops out of this view and only reappears in the
    // area-grouped Session Overview. Adopt the library area only if unassigned.
    const currentUut = (sessionData.uuts || []).find((u) => u.id === uutId);
    const hasExistingArea = !!(
      currentUut?.measurementAreaId || currentUut?.measurementArea
    );
    const { areas, area } = hasExistingArea
      ? { areas: sessionData.measurementAreas || [], area: null }
      : ensureAreaForInstrument(sessionData.measurementAreas || [], inst);
    let updatedItem = null;
    const updatedUuts = (sessionData.uuts || []).map((u) =>
      u.id === uutId
        ? (updatedItem = {
            ...u,
            description: libraryLabel(inst),
            libraryInstrumentId: options.track ? inst.sourceId || inst.id : undefined,
            ...(area
              ? {
                  measurementAreaId: area.id,
                  measurementArea: area.name,
                  measurementAreaColor: area.color,
                }
              : {}),
            instrument: instrumentDefFromLibrary(u.instrument, inst, options),
          })
        : u,
    );
    onSessionSave({ ...sessionData, measurementAreas: areas, uuts: updatedUuts });
    if (updatedItem && (!options.track || options.saveLocal))
      saveItemInstrumentToLocalLibrary("uut", updatedItem);
  };
  const applyPickedLibraryTmde = (tmdeId, inst, options = {}) => {
    if (!onSessionSave) return;
    // Keep the TMDE in its current measurement area (see applyPickedLibraryUut):
    // the detail table renders relevantTmdes filtered by the active area, so
    // relocating it to the library instrument's area would hide the row here and
    // only show it in the Session Overview. Adopt the library area if unassigned.
    const currentTmde = (sessionData.tmdes || []).find((t) => t.id === tmdeId);
    const hasExistingArea = !!(currentTmde?.measurementAreaId || currentTmde?.measurementArea);
    const hasCategory = !!currentTmde?.instrument?.measurementArea;
    const { areas, area } = hasExistingArea || hasCategory
      ? { areas: sessionData.measurementAreas || [], area: null }
      : ensureAreaForInstrument(sessionData.measurementAreas || [], inst, {
          hiddenFromSidebar: true,
        });
    const keepAreaName = hasExistingArea
      ? currentTmde?.instrument?.measurementArea ||
        currentTmde?.measurementArea ||
        ""
      : "";
    const keepAreaColor = hasExistingArea
      ? currentTmde?.instrument?.measurementAreaColor ||
        currentTmde?.measurementAreaColor ||
        ""
      : "";
    let updatedItem = null;
    const updatedTmdes = (sessionData.tmdes || []).map((t) =>
      t.id === tmdeId
        ? (updatedItem = {
            ...t,
            name: libraryLabel(inst),
            isInstrumentBased: true,
            libraryInstrumentId: options.track ? inst.sourceId || inst.id : undefined,
            ...(area
              ? { measurementAreaId: area.id, measurementArea: area.name }
              : {}),
            instrument: {
              ...instrumentDefFromLibrary(t.instrument, inst, options),
              measurementArea: area
                ? area.name
                : keepAreaName || inst.measurementArea || "",
              measurementAreaColor: area
                ? area.color
                : keepAreaColor || inst.measurementAreaColor || "",
            },
          })
        : t,
    );
    onSessionSave({ ...sessionData, measurementAreas: areas, tmdes: updatedTmdes });
    if (updatedItem && (!options.track || options.saveLocal))
      saveItemInstrumentToLocalLibrary("tmde", updatedItem);
    // Picking from the library is an inline edit too: rebuild this point's TMDE
    // instance from the new master so the detail table (which renders the
    // per-point instance for an assigned TMDE) and the risk calc reflect the
    // loaded instrument. Without this the master updates (the Session Overview
    // shows it) but the measurement-point row stays empty. Reselect the range so
    // the picked instrument lands on a range that covers this point.
    if (updatedItem) refreshPointTmdeInstance(updatedItem, { reselectRange: true });
  };
  const promptLibraryPick = (kind, itemId, inst, functionKey = null) => {
    // Load exactly the entry the user picked — never silently substitute a
    // diverged local copy for the shared one (or vice-versa). Picking the
    // shared (validated) entry gives the in-sync version; picking a local entry
    // gives that local version. Tracking stays available via the Sync badge.
    const isShared = inst.scope === "validated";
    const options = isShared
      ? { track: true, localCopy: false }
      : { track: Boolean(inst.sourceId) };
    const fallbackFn = functionKey
      ? resolveSessionFunctions(sessionData, { kind }).find((fn) => fn.key === functionKey)
      : null;
    const scopedInst = scopeLibraryInstrumentToFunction(inst, functionKey, fallbackFn);
    if (kind === "uut") applyPickedLibraryUut(itemId, scopedInst, options);
    else applyPickedLibraryTmde(itemId, scopedInst, options);
  };
  const handleChangeUutArea = (uutId, areaId) => {
    if (!onSessionSave) return;
    const area = (sessionData.measurementAreas || []).find((a) => a.id === areaId);
    const updatedUuts = (sessionData.uuts || []).map((u) =>
      u.id === uutId
        ? {
            ...u,
            measurementAreaId: area ? area.id : "",
            measurementArea: area ? area.name : "",
            measurementAreaColor: area ? area.color : "",
          }
        : u,
    );
    onSessionSave({ ...sessionData, uuts: updatedUuts });
  };
  const handleChangeTmdeArea = (tmdeId, areaId) => {
    if (!onSessionSave) return;
    const area = (sessionData.measurementAreas || []).find((a) => a.id === areaId);
    const updatedTmdes = (sessionData.tmdes || []).map((t) =>
      t.id === tmdeId
        ? {
            ...t,
            measurementAreaId: area ? area.id : "",
            measurementArea: area ? area.name : "",
            instrument: {
              ...(t.instrument || {}),
              measurementArea: area ? area.name : "",
              measurementAreaColor: area ? area.color : "",
            },
          }
        : t,
    );
    onSessionSave({ ...sessionData, tmdes: updatedTmdes });
  };

  // Create a new measurement area inline from the area control and assign it,
  // so a new instrument can define its own area without a sidebar round-trip.
  const handleCreateUutArea = (uutId, name) => {
    if (!onSessionSave) return;
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    const { areas, area } = ensureAreaForInstrument(
      sessionData.measurementAreas || [],
      { measurementArea: trimmed },
      { hiddenFromSidebar: true },
    );
    if (!area) return;
    const updatedUuts = (sessionData.uuts || []).map((u) =>
      u.id === uutId
        ? {
            ...u,
            measurementAreaId: area.id,
            measurementArea: area.name,
            measurementAreaColor: area.color,
          }
        : u,
    );
    onSessionSave({ ...sessionData, measurementAreas: areas, uuts: updatedUuts });
  };
  const handleCreateTmdeArea = (tmdeId, name) => {
    if (!onSessionSave) return;
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    const { areas, area } = ensureAreaForInstrument(
      sessionData.measurementAreas || [],
      { measurementArea: trimmed },
    );
    if (!area) return;
    const updatedTmdes = (sessionData.tmdes || []).map((t) =>
      t.id === tmdeId
        ? {
            ...t,
            measurementAreaId: area.id,
            measurementArea: area.name,
            instrument: {
              ...(t.instrument || {}),
              measurementArea: area.name,
              measurementAreaColor: area.color,
            },
          }
        : t,
    );
    onSessionSave({ ...sessionData, measurementAreas: areas, tmdes: updatedTmdes });
  };

  const handleCommitUutAreaName = (uutId, rawName) => {
    const trimmed = String(rawName || "").trim();
    if (!trimmed || trimmed.toLowerCase() === "unassigned") {
      handleChangeUutArea(uutId, "");
      return;
    }
    const existing = (sessionData.measurementAreas || []).find(
      (area) => String(area.name || "").toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) handleChangeUutArea(uutId, existing.id);
    else handleCreateUutArea(uutId, trimmed);
  };

  const handleCommitTmdeAreaName = (tmdeId, rawName) => {
    const trimmed = String(rawName || "").trim();
    if (!trimmed || trimmed.toLowerCase() === "unassigned") {
      handleChangeTmdeArea(tmdeId, "");
      return;
    }
    const existing = (sessionData.measurementAreas || []).find(
      (area) => String(area.name || "").toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) handleChangeTmdeArea(tmdeId, existing.id);
    else handleCreateTmdeArea(tmdeId, trimmed);
  };

  // --- Range bounds / unit / resolution / add / remove ---
  const handleEditRangeBoundDetail = (kind, item, rangeId, field, value) =>
    persistInlineItemDetail(
      kind,
      applyItemRangePatch(item, rangeId, { [field]: value }),
    );
  const setRangeUnitDetail = (kind, item, rangeId, value) =>
    persistInlineItemDetail(kind, applyItemRangePatch(item, rangeId, { unit: value }));
  const patchRangeDetail = (kind, item, rangeId, patch) =>
    persistInlineItemDetail(kind, applyItemRangePatch(item, rangeId, patch));
  const setRangeResolutionDetail = (kind, item, rangeId, value) =>
    persistInlineItemDetail(
      kind,
      applyItemRangePatch(item, rangeId, { resolution: value }),
    );
  const setRangeResolutionUnitDetail = (kind, item, rangeId, value) =>
    persistInlineItemDetail(
      kind,
      applyItemRangePatch(item, rangeId, { resolutionUnit: value }),
    );
  const setRangeUseResolutionDetail = (kind, item, rangeId, checked) =>
    persistInlineItemDetail(
      kind,
      applyItemRangePatch(item, rangeId, { includeResolutionInBudget: checked }),
    );
  // Spec-band distribution (the Distribution column) — writes the divisor back to
  // the same range tolerance the tolerance editor owns.
  const setRangeBandDistributionDetail = (kind, item, rangeId, value) => {
    if (!onSessionSave) return;
    const cur = getItemRangeTolerance(item, rangeId) || {};
    persistInlineItemDetail(
      kind,
      applyItemRangeTolerance(item, rangeId, applyBandDistribution(cur, value)),
    );
  };
  const handleAddRangeDetail = (kind, item, activeRangeId, currentCount) => {
    if (!onSessionSave) return;
    const { item: updated, newRangeId } = addRangeToItem(item, activeRangeId);
    persistInlineItemDetail(kind, updated);
    const setIdx = kind === "uut" ? setLocalRangeIndices : setTmdeRangeIndices;
    // Resolve the new range's real flattened index by id (it's appended within
    // one function, not necessarily the last slot — see handleAddRange).
    const resolved = resolveUutRangeHelper(updated, {}, null, null).ranges || [];
    const newIdx = newRangeId
      ? resolved.findIndex((r) => sameId(r.id, newRangeId))
      : -1;
    setIdx((prev) => ({ ...prev, [item.id]: newIdx >= 0 ? newIdx : currentCount }));
    if (newRangeId) {
      setNewRangeKeys((prev) => {
        const next = new Set(prev);
        next.add(rangeStateKey(kind, item.id, newRangeId));
        return next;
      });
    }
  };
  const handleRemoveRangeDetail = (kind, item, rangeId) => {
    if (!onSessionSave) return;
    persistInlineItemDetail(kind, removeRangeFromItem(item, rangeId));
    setNewRangeKeys((prev) => {
      const next = new Set(prev);
      next.delete(rangeStateKey(kind, item.id, rangeId));
      return next;
    });
    const setIdx = kind === "uut" ? setLocalRangeIndices : setTmdeRangeIndices;
    setIdx((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  };

  const toggleShowAllRangesDetail = (kind, itemId) => {
    setExpandedRangeKeys((prev) => {
      const next = new Set(prev);
      const key = itemStateKey(kind, itemId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isShowingAllRangesDetail = (kind, itemId) =>
    expandedRangeKeys.has(itemStateKey(kind, itemId));

  // --- Tolerance term machine (matches SummaryDashboard) ---
  const toleranceTypeKey = (kind, item, rangeId) =>
    `${kind}:${item?.id || ""}:${rangeId || "default"}`;
  const getSelectedToleranceTypeDetail = (kind, item, activeRange) => {
    const key = toleranceTypeKey(kind, item, activeRange?.id);
    return (
      toleranceTypes[key] ||
      firstToleranceType(
        getItemRangeTolerance(item, activeRange?.id) || activeRange || {},
      )
    );
  };
  const setSelectedToleranceTypeDetail = (kind, item, activeRange, typeKey) => {
    const key = toleranceTypeKey(kind, item, activeRange?.id);
    setToleranceTypes((prev) => ({ ...prev, [key]: typeKey }));
    setSelectedToleranceKey(key);
    if (kind === "uut") {
      setSelectedUutIds([item.id]);
      setSelectedTmdeIds([]);
    } else {
      setSelectedTmdeIds([item.id]);
      setSelectedUutIds([]);
    }
    const cur = getItemRangeTolerance(item, activeRange?.id) || {};
    if (!cur[typeKey]) {
      persistInlineItemDetail(
        kind,
        applyItemRangeTolerance(item, activeRange?.id, {
          ...cur,
          [typeKey]: defaultToleranceComponent(typeKey, activeRange, cur),
        }),
      );
    }
  };
  const setRangeToleranceComponentDetail = (
    kind,
    item,
    activeRange,
    typeKey,
    component,
  ) => {
    if (!onSessionSave) return;
    setSelectedToleranceKey(toleranceTypeKey(kind, item, activeRange?.id));
    const cur = getItemRangeTolerance(item, activeRange?.id) || {};
    persistInlineItemDetail(
      kind,
      applyItemRangeTolerance(item, activeRange?.id, { ...cur, [typeKey]: component }),
    );
  };

  // --- Range & tolerance header add/delete (act on the single-selected row) ---
  const getSelectedRangeTargetDetail = (kind) => {
    const ids = kind === "uut" ? selectedUutIds : selectedTmdeIds;
    if (ids.length !== 1) return null;
    const items = kind === "uut" ? sessionData.uuts || [] : sessionData.tmdes || [];
    const item = items.find((c) => c.id === ids[0]);
    if (!item) return null;
    const rangeIndices = kind === "uut" ? localRangeIndices : tmdeRangeIndices;
    const { ranges, activeRange } = resolveUutRangeHelper(
      item,
      rangeIndices,
      null,
      null,
    );
    return { item, ranges, activeRange };
  };
  const handleAddSelectedRangeDetail = (kind) => {
    const target = getSelectedRangeTargetDetail(kind);
    if (!target) return;
    const label = kind === "uut" ? "UUT" : "TMDE";
    confirmViaNotification(setNotification, {
      title: "Add Range",
      message: `Add a new range to this ${label}?`,
      confirmText: "Add Range",
      onConfirm: () =>
        handleAddRangeDetail(kind, target.item, target.activeRange?.id, target.ranges.length),
    });
  };
  const handleRemoveSelectedRangeDetail = (kind) => {
    const target = getSelectedRangeTargetDetail(kind);
    if (!target || target.ranges.length <= 1) return;
    const label = kind === "uut" ? "UUT" : "TMDE";
    confirmViaNotification(setNotification, {
      title: "Delete Range",
      message: `Delete the active range from this ${label}? This can't be undone.`,
      confirmText: "Delete",
      onConfirm: () => handleRemoveRangeDetail(kind, target.item, target.activeRange?.id),
    });
  };
  const renderRangeHeaderActionsDetail = (kind) => {
    if (!onSessionSave) return null;
    const target = getSelectedRangeTargetDetail(kind);
    const label = kind === "uut" ? "UUT" : "TMDE";
    const canAdd = Boolean(target);
    const canRemove = Boolean(target && target.ranges.length > 1);
    const canToggleAll = canRemove;
    const showingAll = Boolean(
      target && isShowingAllRangesDetail(kind, target.item.id),
    );
    return (
      <span className="range-header-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="range-header-action-btn range-header-action-btn--add"
          title={canAdd ? `Add range to selected ${label}` : `Select one ${label} to add a range`}
          aria-label={`Add range to selected ${label}`}
          disabled={!canAdd}
          onClick={() => handleAddSelectedRangeDetail(kind)}
        >
          <FontAwesomeIcon icon={faPlus} size="xs" />
        </button>
        <button
          type="button"
          className="range-header-action-btn range-header-action-btn--delete"
          title={canRemove ? `Remove active range from selected ${label}` : `Select one ${label} with multiple ranges to remove a range`}
          aria-label={`Remove active range from selected ${label}`}
          disabled={!canRemove}
          onClick={() => handleRemoveSelectedRangeDetail(kind)}
        >
          <FontAwesomeIcon icon={faTrashAlt} size="xs" />
        </button>
        <button
          type="button"
          className={`range-header-action-btn range-header-action-btn--view${showingAll ? " is-active" : ""}`}
          title={canToggleAll ? (showingAll ? `Show active range only for selected ${label}` : `Show all ranges for selected ${label}`) : `Select one ${label} with multiple ranges to view all ranges`}
          aria-label={showingAll ? `Show active range only for selected ${label}` : `Show all ranges for selected ${label}`}
          disabled={!canToggleAll}
          onClick={() => toggleShowAllRangesDetail(kind, target.item.id)}
        >
          <FontAwesomeIcon icon={showingAll ? faEyeSlash : faEye} size="xs" />
        </button>
      </span>
    );
  };

  // Detailed-View counterparts of activateRangeRow / renderRangeRowCells (see
  // the Session-Overview panel). Same behaviour, wired to the *Detail handlers
  // and this view's extra columns. `cols` carries the per-column index used for
  // column-hover highlighting, which differs between the UUT and TMDE tables.
  const activateRangeRowDetail = (kind, itemId, index) => {
    if (kind === "uut") setSelectedUutIds([itemId]);
    else setSelectedTmdeIds([itemId]);
    const setIdx = kind === "uut" ? setLocalRangeIndices : setTmdeRangeIndices;
    setIdx((prev) => ({ ...prev, [itemId]: index }));
  };

  const renderRangeRowCellsDetail = (
    kind,
    item,
    range,
    { includeDistribution, canDelete, cols },
  ) => {
    const tableId = kind === "uut" ? "uut_det" : "tmde_det";
    const tolerance = getItemRangeTolerance(item, range?.id) || range || {};
    const typeKey = getSelectedToleranceTypeDetail(kind, item, range);
    const label = kind === "uut" ? "UUT" : "TMDE";
    const deleteRange = () => {
      if (!canDelete) return;
      confirmViaNotification(setNotification, {
        title: "Delete Range",
        message: `Delete this range from this ${label}? This can't be undone.`,
        confirmText: "Delete",
        onConfirm: () => handleRemoveRangeDetail(kind, item, range?.id),
      });
    };

    return (
      <>
        <td
          className={`cell-value ${hoveredCell.tableId === tableId && hoveredCell.colIndex === cols.range ? "col-hovered" : ""}`}
          onMouseEnter={() => setHoveredCell({ tableId, colIndex: cols.range })}
        >
          <div className="range-row-cell">
            <RangeCell
              ranges={[range]}
              activeIndex={0}
              activeRange={range}
              editable
              allowSingleToggle={newRangeKeys.has(rangeStateKey(kind, item.id, range?.id))}
              onSelect={() => {}}
              onEditBound={(field, value) => handleEditRangeBoundDetail(kind, item, range?.id, field, value)}
              onEditUnit={(value) => setRangeUnitDetail(kind, item, range?.id, value)}
              onPatchRange={(patch) => patchRangeDetail(kind, item, range?.id, patch)}
            />
            <button
              type="button"
              className="range-row-delete"
              title={canDelete ? "Delete this range" : "An instrument must keep at least one range"}
              aria-label="Delete this range"
              disabled={!canDelete}
              onClick={(e) => {
                e.stopPropagation();
                deleteRange();
              }}
            >
              <FontAwesomeIcon icon={faTrashAlt} size="xs" />
            </button>
          </div>
        </td>

        <td
          className={`cell-tolerance ${hoveredCell.tableId === tableId && hoveredCell.colIndex === cols.tol ? "col-hovered" : ""}`}
          onMouseEnter={() => setHoveredCell({ tableId, colIndex: cols.tol })}
          title={getSpecRows(tolerance)[0]}
        >
          <InlineToleranceCell
            tolerance={tolerance}
            activeRange={range}
            typeKey={typeKey}
            selectedType={
              selectedToleranceKey === toleranceTypeKey(kind, item, range?.id)
                ? typeKey
                : null
            }
            editable
            onSelectType={(nextTypeKey) =>
              setSelectedToleranceTypeDetail(kind, item, range, nextTypeKey)
            }
            onCommit={(nextTypeKey, component) =>
              setRangeToleranceComponentDetail(kind, item, range, nextTypeKey, component)
            }
          />
        </td>

        {includeDistribution && (
          <td className="cell-distribution" title="Spec band distribution">
            {getBandDistDivisor(tolerance) ? (
              <select
                className="session-selector"
                value={getBandDistDivisor(tolerance)}
                onChange={(e) =>
                  setRangeBandDistributionDetail(kind, item, range?.id, e.target.value)
                }
              >
                {errorDistributions.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            ) : (
              getBandDistLabel(tolerance)
            )}
          </td>
        )}

        <td
          className={`cell-value ${hoveredCell.tableId === tableId && hoveredCell.colIndex === cols.res ? "col-hovered" : ""}`}
          onMouseEnter={() => setHoveredCell({ tableId, colIndex: cols.res })}
          title={formatResolutionLabel(range)}
        >
          <ResolutionCellInput
            value={range?.resolution ?? range?.measuringResolution}
            unit={range?.resolutionUnit ?? range?.measuringResolutionUnit}
            fallbackUnit={range?.unit}
            onCommit={(v) => setRangeResolutionDetail(kind, item, range?.id, v)}
            onCommitUnit={(value) => setRangeResolutionUnitDetail(kind, item, range?.id, value)}
            useResolution={range?.includeResolutionInBudget}
            onToggleUse={(checked) => setRangeUseResolutionDetail(kind, item, range?.id, checked)}
          />
        </td>
      </>
    );
  };

  const getSelectedToleranceTargetDetail = (kind) => {
    const target = getSelectedRangeTargetDetail(kind);
    if (!target) return null;
    const tolerance =
      getItemRangeTolerance(target.item, target.activeRange?.id) ||
      target.activeRange ||
      {};
    const key = toleranceTypeKey(kind, target.item, target.activeRange?.id);
    const selectedType = getSelectedToleranceTypeDetail(
      kind,
      target.item,
      target.activeRange,
    );
    const configuredTypes = activeToleranceTypeKeys(tolerance);
    const missingTypes = TOLERANCE_TYPE_OPTIONS.filter(
      (opt) => !configuredTypes.includes(opt.key),
    );
    return {
      ...target,
      key,
      tolerance,
      selectedType,
      configuredTypes,
      missingTypes,
      hasSelectedTolerance: selectedToleranceKey === key,
    };
  };
  const handleAddSelectedToleranceTypeDetail = (kind, typeKey) => {
    const target = getSelectedToleranceTargetDetail(kind);
    if (!target || !typeKey) return;
    const next = {
      ...target.tolerance,
      [typeKey]:
        target.tolerance[typeKey] ||
        defaultToleranceComponent(typeKey, target.activeRange, target.tolerance),
    };
    persistInlineItemDetail(
      kind,
      applyItemRangeTolerance(target.item, target.activeRange?.id, next),
    );
    setToleranceTypes((prev) => ({
      ...prev,
      [toleranceTypeKey(kind, target.item, target.activeRange?.id)]: typeKey,
    }));
    setSelectedToleranceKey(target.key);
    setOpenToleranceAddMenu(null);
  };
  const handleRemoveSelectedToleranceTypeDetail = (kind) => {
    const target = getSelectedToleranceTargetDetail(kind);
    if (
      !target ||
      !target.hasSelectedTolerance ||
      !target.tolerance[target.selectedType]
    )
      return;
    const termLabel =
      TOLERANCE_TYPE_OPTIONS.find((opt) => opt.key === target.selectedType)?.label ||
      "tolerance";
    confirmViaNotification(setNotification, {
      title: "Delete Tolerance Term",
      message: `Delete the ${termLabel} tolerance term? This can't be undone.`,
      confirmText: "Delete",
      onConfirm: () => {
        const next = { ...target.tolerance };
        delete next[target.selectedType];
        const remaining = activeToleranceTypeKeys(next);
        const nextSelected = remaining[0] || "reading";
        persistInlineItemDetail(
          kind,
          applyItemRangeTolerance(target.item, target.activeRange?.id, next),
        );
        setToleranceTypes((prev) => ({
          ...prev,
          [toleranceTypeKey(kind, target.item, target.activeRange?.id)]: nextSelected,
        }));
        setSelectedToleranceKey(null);
      },
    });
  };
  const renderToleranceHeaderActionsDetail = (kind) => {
    if (!onSessionSave) return null;
    const target = getSelectedToleranceTargetDetail(kind);
    const label = kind === "uut" ? "UUT" : "TMDE";
    const canAdd = Boolean(target && target.missingTypes.length > 0);
    const canRemove = Boolean(
      target && target.hasSelectedTolerance && target.tolerance[target.selectedType],
    );
    const menuOpen = openToleranceAddMenu === kind;
    return (
      <span
        className="range-header-actions tolerance-header-actions"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="range-header-action-btn range-header-action-btn--add"
          title={canAdd ? `Add tolerance term to selected ${label}` : `Select one ${label} with an available tolerance type`}
          aria-label={`Add tolerance term to selected ${label}`}
          disabled={!canAdd}
          onClick={() =>
            setOpenToleranceAddMenu((prev) => (prev === kind ? null : kind))
          }
        >
          <FontAwesomeIcon icon={faPlus} size="xs" />
        </button>
        <button
          type="button"
          className="range-header-action-btn range-header-action-btn--delete"
          title={canRemove ? `Remove selected ${TOLERANCE_TYPE_OPTIONS.find((opt) => opt.key === target.selectedType)?.label || "tolerance"} term` : `Select a configured tolerance term to remove`}
          aria-label={`Remove selected tolerance term from selected ${label}`}
          disabled={!canRemove}
          onClick={() => handleRemoveSelectedToleranceTypeDetail(kind)}
        >
          <FontAwesomeIcon icon={faTrashAlt} size="xs" />
        </button>
        {menuOpen && target && (
          <div className="tolerance-add-menu">
            {target.missingTypes.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className="tolerance-add-menu-item"
                onClick={() => handleAddSelectedToleranceTypeDetail(kind, opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </span>
    );
  };


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
    (uut, functionKey = null, rangeIndexOverride) => {
      const isActivePointUut =
        activePointUutId !== null &&
        String(activePointUutId) === String(uut.id);
      // For the active point, its own saved tolerance governs the range — the
      // UUT-keyed activeRangeIndices map is deliberately ignored so a range
      // change on one point never leaks onto sibling points sharing the UUT.
      const resolution = resolveUutRangeHelper(
        uut,
        isActivePointUut
          ? {}
          : rangeIndexOverride !== undefined
            ? { [uut.id]: rangeIndexOverride }
            : activeRangeIndices,
        isActivePointUut ? uutToleranceData : null,
        uutNominal,
        functionKey,
      );
      return resolution;
    },
    [activePointUutId, activeRangeIndices, uutToleranceData, uutNominal],
  );

  // --- Function subsections (detail view parity with the Session Overview) ---
  const [addFunctionMenu, setAddFunctionMenu] = useState(null);
  const [newFunctionDraft, setNewFunctionDraft] = useState({ name: "", unit: "" });

  const upsertFunctionGroupDetail = (fnKey, patch) => {
    const existing = Array.isArray(sessionData.functionGroups)
      ? sessionData.functionGroups
      : [];
    const patchKind = patch.kind || null;
    let found = false;
    const next = existing.map((fg) => {
      if (
        makeFunctionKey(fg.name, fg.unit) === fnKey &&
        (!patchKind || !fg.kind || fg.kind === patchKind)
      ) {
        found = true;
        return { ...fg, ...patch };
      }
      return fg;
    });
    if (!found) next.push(patch);
    return next;
  };

  const handleFunctionColorChange = (fn, color) => {
    if (!onSessionSave) return;
    onSessionSave({
      ...sessionData,
      functionGroups: upsertFunctionGroupDetail(fn.key, {
        name: fn.name,
        unit: fn.unit,
        color,
        ...(fn.kind ? { kind: fn.kind } : {}),
      }),
    });
  };

  const handleFunctionRename = (fn, rawName) => {
    if (!onSessionSave) return;
    const name = String(rawName || "").trim();
    if (!name || name === fn.name) return;
    const renameInstruments = (list = []) =>
      list.map((item) => {
        const inst = item.instrument || item;
        const fns = Array.isArray(inst.functions) ? inst.functions : null;
        if (!fns) return item;
        let changed = false;
        const nextFns = fns.map((f) => {
          if (makeFunctionKey(f.name, f.unit) === fn.key) {
            changed = true;
            return { ...f, name };
          }
          return f;
        });
        if (!changed) return item;
        return item.instrument
          ? { ...item, instrument: { ...inst, functions: nextFns } }
          : { ...item, functions: nextFns };
      });
    const nextPoints =
      fn.kind === "tmde"
        ? sessionData.testPoints
        : (sessionData.testPoints || []).map((tp) => {
            if (functionKeyOf(tp) !== fn.key) return tp;
            const parameter = tp.testPointInfo?.parameter || {};
            return {
              ...tp,
              testPointInfo: {
                ...(tp.testPointInfo || {}),
                parameter: { ...parameter, name },
              },
            };
          });
    onSessionSave({
      ...sessionData,
      functionGroups: upsertFunctionGroupDetail(fn.key, {
        name,
        unit: fn.unit,
        color: fn.color,
        ...(fn.kind ? { kind: fn.kind } : {}),
      }),
      uuts: fn.kind === "tmde" ? sessionData.uuts : renameInstruments(sessionData.uuts),
      tmdes: fn.kind === "uut" ? sessionData.tmdes : renameInstruments(sessionData.tmdes),
      testPoints: nextPoints,
    });
  };

  const handleAddFunction = ({ name, unit }) => {
    if (!onSessionSave) return;
    const clean = String(name || "").trim();
    if (!clean) return;
    const kind = addFunctionMenu?.kind || null;
    const key = makeFunctionKey(clean, unit);
    const existing = Array.isArray(sessionData.functionGroups)
      ? sessionData.functionGroups
      : [];
    if (
      existing.some(
        (fg) =>
          makeFunctionKey(fg.name, fg.unit) === key &&
          (!kind || !fg.kind || fg.kind === kind),
      )
    ) {
      setAddFunctionMenu(null);
      return;
    }
    onSessionSave({
      ...sessionData,
      functionGroups: [
        ...existing,
        { name: clean, unit: String(unit || "").trim(), ...(kind ? { kind } : {}) },
      ],
    });
    setAddFunctionMenu(null);
    setNewFunctionDraft({ name: "", unit: "" });
  };

  const handleAddInstrumentToFunction = (kind, fn) => {
    if (!onSessionSave) return;
    const instrument = {
      id: uuidv4(),
      manufacturer: "",
      model: "",
      description: "",
      functions: [{ name: fn.name, unit: fn.unit, ranges: [] }],
    };
    if (kind === "uut") {
      const newUut = { id: uuidv4(), name: "", description: "", instrument };
      setSelectedUutIds([newUut.id]);
      onSessionSave({ ...sessionData, uuts: [newUut, ...(sessionData.uuts || [])] });
    } else {
      const newTmde = {
        id: uuidv4(),
        name: "",
        quantity: 1,
        assetId: "",
        isInstrumentBased: false,
        instrument,
      };
      setSelectedTmdeIds([newTmde.id]);
      onSessionSave({ ...sessionData, tmdes: [newTmde, ...(sessionData.tmdes || [])] });
    }
  };

  const handleDeleteFunction = (fn) => {
    if (!onSessionSave) return;
    const appliesToUut = !fn.kind || fn.kind === "uut";
    const appliesToTmde = !fn.kind || fn.kind === "tmde";
    const inUse =
      (appliesToUut &&
        (sessionData.uuts || []).some((u) => instrumentHasFunction(u, fn.key))) ||
      (appliesToTmde &&
        (sessionData.tmdes || []).some((t) => instrumentHasFunction(t, fn.key))) ||
      (appliesToUut &&
        (sessionData.testPoints || []).some((p) => functionKeyOf(p) === fn.key));
    if (inUse) {
      setNotification?.({
        title: "Function In Use",
        message:
          "Remove the instruments and measurement points using this function before deleting it.",
      });
      return;
    }
    onSessionSave({
      ...sessionData,
      functionGroups: (sessionData.functionGroups || []).filter(
        (fg) =>
          makeFunctionKey(fg.name, fg.unit) !== fn.key ||
          (fg.kind && fn.kind && fg.kind !== fn.kind),
      ),
    });
  };

  const renderFunctionColorSwatch = (fn) => {
    const color =
      typeof fn.color === "string" && fn.color.startsWith("#") ? fn.color : "#888888";
    const dotStyle = {
      display: "inline-block",
      width: "12px",
      height: "12px",
      borderRadius: "3px",
      marginRight: "8px",
      verticalAlign: "middle",
      backgroundColor: fn.color || "#888888",
    };
    if (!onSessionSave) return <span style={dotStyle} />;
    return (
      <label
        title="Click to change function color"
        onClick={(e) => e.stopPropagation()}
        style={{
          ...dotStyle,
          position: "relative",
          cursor: "pointer",
          border: "1px solid rgba(127,127,127,0.5)",
          overflow: "hidden",
          pointerEvents: "auto",
        }}
      >
        <input
          type="color"
          value={color}
          onChange={(e) => handleFunctionColorChange(fn, e.target.value)}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            opacity: 0,
            cursor: "pointer",
            padding: 0,
            border: "none",
          }}
        />
      </label>
    );
  };

  const renderFunctionNameEditor = (fn) => {
    if (!onSessionSave) return <span style={{ color: fn.color }}>{fn.name}</span>;
    return (
      <input
        className="inline-area-header-input"
        defaultValue={fn.name}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = fn.name;
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => handleFunctionRename(fn, e.target.value)}
        title="Edit function name"
        aria-label="Function subsection name"
        style={{
          color: fn.color,
          background: "transparent",
          border: "1px solid transparent",
          borderRadius: "4px",
          font: "inherit",
          fontWeight: 700,
          padding: "1px 4px",
          minWidth: "120px",
          pointerEvents: "auto",
        }}
      />
    );
  };

  const renderFunctionUnitChip = (fn) =>
    fn.unit ? (
      <span style={{ marginLeft: "8px", opacity: 0.6, fontSize: "0.78em", fontWeight: 600 }}>
        {getUnitDisplayLabel(fn.unit)}
      </span>
    ) : null;

  const fnHeaderBtnStyle = {
    pointerEvents: "auto",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    height: "18px",
    padding: 0,
    borderRadius: "4px",
    border: "1px solid var(--border-color)",
    background: "transparent",
    color: "var(--text-color-muted)",
    cursor: "pointer",
    fontSize: "0.7em",
    lineHeight: 1,
  };

  const renderFunctionAddButton = (kind, fn) =>
    onSessionSave ? (
      <button
        type="button"
        title={`Add ${kind === "uut" ? "UUT" : "TMDE"} with this function`}
        onClick={(e) => {
          e.stopPropagation();
          handleAddInstrumentToFunction(kind, fn);
        }}
        style={{ ...fnHeaderBtnStyle, marginLeft: "6px" }}
      >
        <FontAwesomeIcon icon={faPlus} size="xs" />
      </button>
    ) : null;

  const renderFunctionDeleteButton = (fn) =>
    onSessionSave ? (
      <button
        type="button"
        title="Delete function"
        onClick={(e) => {
          e.stopPropagation();
          handleDeleteFunction(fn);
        }}
        style={{ ...fnHeaderBtnStyle, marginLeft: "4px" }}
      >
        <FontAwesomeIcon icon={faTrashAlt} size="xs" />
      </button>
    ) : null;

  const renderFunctionHeaderRow = (kind, fn, colSpan) => (
    <tr key={`${kind}-fn-${fn.key}`} className="instrument-area-section-row">
      <td colSpan={colSpan}>
        <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
          {renderFunctionColorSwatch(fn)}
          {renderFunctionNameEditor(fn)}
          {renderFunctionUnitChip(fn)}
          {renderFunctionAddButton(kind, fn)}
          {renderFunctionDeleteButton(fn)}
        </div>
      </td>
    </tr>
  );

  const renderAddFunctionMenu = (kind) => {
    if (!addFunctionMenu || addFunctionMenu.kind !== kind) return null;
    const rect = addFunctionMenu.rect;
    const existingKeys = new Set(
      resolveSessionFunctions(sessionData, { kind }).map((fn) => fn.key),
    );
    const available = functionsForLibrary(instruments).filter(
      (fn) => !existingKeys.has(fn.key),
    );
    const itemStyle = {
      display: "block",
      width: "100%",
      textAlign: "left",
      padding: "6px 10px",
      background: "transparent",
      border: "none",
      color: "var(--text-color)",
      cursor: "pointer",
      fontSize: "0.85em",
    };
    const MENU_WIDTH = 250;
    const left = rect
      ? Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
      : 8;
    const top = rect
      ? Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 80))
      : 60;
    const inputStyle = {
      flex: 1,
      minWidth: 0,
      background: "var(--input-background)",
      border: "1px solid var(--border-color)",
      borderRadius: "4px",
      color: "var(--text-color)",
      padding: "4px 6px",
      fontSize: "0.82em",
    };
    return ReactDOM.createPortal(
      <>
        <div
          onClick={() => setAddFunctionMenu(null)}
          style={{ position: "fixed", inset: 0, zIndex: 4000 }}
        />
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top,
            left,
            width: `${MENU_WIDTH}px`,
            maxHeight: "min(360px, 70vh)",
            overflowY: "auto",
            background: "var(--component-bg)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            zIndex: 4001,
            padding: "8px",
          }}
        >
          <div
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              textTransform: "uppercase",
              opacity: 0.6,
              padding: "2px 6px 6px",
            }}
          >
            Add function
          </div>
          {available.length > 0 ? (
            <div>
              {available.map((fn) => (
                <button
                  key={fn.key}
                  type="button"
                  onClick={() => handleAddFunction(fn)}
                  style={itemStyle}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--input-background)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  {fn.name}
                  {fn.unit ? (
                    <span style={{ opacity: 0.6 }}> · {getUnitDisplayLabel(fn.unit)}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ padding: "6px 10px", opacity: 0.6, fontSize: "0.8em" }}>
              No more library functions
            </div>
          )}
          <div
            style={{
              display: "flex",
              gap: "6px",
              marginTop: "8px",
              paddingTop: "8px",
              borderTop: "1px solid var(--border-color)",
            }}
          >
            <input
              type="text"
              placeholder="New function"
              value={newFunctionDraft.name}
              onChange={(e) =>
                setNewFunctionDraft((d) => ({ ...d, name: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddFunction(newFunctionDraft);
                if (e.key === "Escape") setAddFunctionMenu(null);
              }}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Unit"
              value={newFunctionDraft.unit}
              onChange={(e) =>
                setNewFunctionDraft((d) => ({ ...d, unit: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddFunction(newFunctionDraft);
                if (e.key === "Escape") setAddFunctionMenu(null);
              }}
              style={{ ...inputStyle, flex: "none", width: "64px" }}
            />
            <button
              type="button"
              disabled={!newFunctionDraft.name.trim()}
              onClick={() => handleAddFunction(newFunctionDraft)}
              style={{
                background: "var(--primary-color)",
                border: "none",
                borderRadius: "4px",
                color: "#fff",
                padding: "4px 10px",
                cursor: newFunctionDraft.name.trim() ? "pointer" : "not-allowed",
                opacity: newFunctionDraft.name.trim() ? 1 : 0.5,
                fontSize: "0.82em",
              }}
            >
              Add
            </button>
          </div>
        </div>
      </>,
      document.body,
    );
  };

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
  const isDerived = testPointData.measurementType === "derived";

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
    if (testPointData.measurementType === "derived") return allTmdes;
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
    testPointData.measurementType,
    activeMeasurementAreaId,
    activeMeasurementArea?.name,
  ]);

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
        String(tmde.id) === String(masterTmde.id) ||
        String(tmde.sourceId) === String(masterTmde.id),
    );

    if (!variableType) {
      onUpdateTestPoint({
        tmdeTolerances: tmdeTolerancesData.filter(
          (tmde) =>
            String(tmde.id) !== String(masterTmde.id) &&
            String(tmde.sourceId) !== String(masterTmde.id),
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
        // Auto-select the range that covers this point (Priority C) rather than
        // defaulting to range 0 — otherwise a multi-range TMDE whose first range
        // doesn't cover the point would be rejected as "Incompatible".
        const resolution = resolveUutRangeHelper(
          sourceTmde,
          tmdeRangeIndices,
          null,
          isDerived ? null : uutNominal,
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
      if (specsDiffer(activeResolvedTolerance, uutToleranceData) && onUpdateTestPoint) {
        onUpdateTestPoint({ uutTolerance: activeResolvedTolerance });
      }
    }
  }, [activeResolvedTolerance, uutToleranceData, onUpdateTestPoint]);

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
          <div className="panel-card-actions" style={{ position: "relative" }}>
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
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setAddFunctionMenu((m) =>
                  m && m.kind === "uut" ? null : { kind: "uut", rect },
                );
              }}
              title="Add Function"
            >
              <FontAwesomeIcon icon={faPlus} size="xs" />
            </button>
            {renderAddFunctionMenu("uut")}
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
              <col style={{ width: "24%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "8%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Description</th>
                <th>
                  <span className="range-header-cell">
                    <span>Range(s)</span>
                    {renderRangeHeaderActionsDetail("uut")}
                  </span>
                </th>
                <th>
                  <span className="range-header-cell">
                    <span>Tolerance</span>
                    {renderToleranceHeaderActionsDetail("uut")}
                  </span>
                </th>
                <th>Resolution</th>
                <th className="cell-sync">Sync</th>
              </tr>
            </thead>
            <tbody>
              {buildFunctionGroupedRows(
                relevantUuts.map((item, index) => ({ type: "item", item, index })),
                sessionData,
                "uut",
              ).length === 0 ? (
                <tr className="panel-empty-row">
                  <td colSpan="5">No associated UUTs found.</td>
                </tr>
              ) : (
                buildFunctionGroupedRows(
                  relevantUuts.map((item, index) => ({ type: "item", item, index })),
                  sessionData,
                  "uut",
                ).map((row) => {
                  if (row.type === "function") {
                    return renderFunctionHeaderRow("uut", row.fn, 5);
                  }
                  const uut = row.item;
                  const uutRowKey = row.rowKey ?? uut.id;
                  const uutFnKey = row.functionKey ?? null;
                  const { ranges, activeIndex, activeRange } =
                    resolveUutRange(uut, uutFnKey);
                  const isLinked =
                    testPointData.associatedUutIds &&
                    testPointData.associatedUutIds.includes(uut.id);
                  const isActivePointUut =
                    testPointData.activeUutId === uut.id ||
                    (!testPointData.activeUutId &&
                      associatedUutIds[0] === uut.id);
                  const specRows = getSpecRows(activeRange);
                  const rowSpan = !onSessionSave && specRows.length > 0 ? specRows.length : 1;
                  const isSelected = selectedUutIds.includes(uut.id);
                  const showAllRanges = isShowingAllRangesDetail("uut", uutRowKey);
                  const visibleRangeRows = getVisibleRangeRows(
                    ranges,
                    activeIndex,
                    activeRange,
                    showAllRanges,
                  );

                  // Expanded "view all ranges": one real <tr> per range so the
                  // columns line up (see the Session-Overview panel for rationale).
                  if (showAllRanges) {
                    const n = visibleRangeRows.length;
                    const canDelete = ranges.length > 1;
                    const activeRangeIndex = localRangeIndices[uutRowKey] ?? activeIndex;
                    return (
                      <React.Fragment key={uutRowKey}>
                        {visibleRangeRows.map(({ range, index, key }, i) => {
                          const isActiveRange = index === activeRangeIndex;
                          return (
                            <tr
                              key={key}
                              className={`inline-range-row${i === 0 ? " inline-range-row--first" : ""}${i === n - 1 ? " inline-range-row--last" : ""}${isSelected ? " instrument-selected" : ""}${isActiveRange ? " is-active-range" : ""}${isActivePointUut ? " active-point-uut-row" : ""} ${hoveredRowId === uut.id ? "row-hovered" : ""}`}
                              onMouseEnter={() => setHoveredRowId(uut.id)}
                              onContextMenu={(e) => openRangeRowMenu(e, "uut", uut, range, index, n)}
                              onMouseDownCapture={() => activateRangeRowDetail("uut", uutRowKey, index)}
                              onClick={(e) => {
                                if (!isInlineRowControlTarget(e.target)) {
                                  setSelectedToleranceKey(null);
                                }
                              }}
                              style={{ cursor: "pointer" }}
                            >
                              {i === 0 && (
                                <td
                                  rowSpan={n}
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
                                    <EditableDescriptionCell
                                      name={uut.description}
                                      make={uut.instrument?.manufacturer}
                                      model={uut.instrument?.model}
                                      instruments={instruments}
                                      onPickLibrary={(inst) =>
                                        promptLibraryPick("uut", uut.id, inst, uutFnKey)
                                      }
                                      onCommit={(field, value) =>
                                        handleDetailUutDescEdit(uut.id, field, value)
                                      }
                                    />
                                    {isActivePointUut && (
                                      <span className="active-uut-badge">Active UUT</span>
                                    )}
                                  </div>
                                </td>
                              )}
                              {renderRangeRowCellsDetail("uut", uut, range, {
                                includeDistribution: false,
                                canDelete,
                                cols: { range: 1, tol: 2, res: 3 },
                              })}
                              {i === 0 && (
                                <td
                                  rowSpan={n}
                                  className="cell-sync"
                                  style={{ textAlign: "center" }}
                                >
                                  <SyncBadge item={uut} onSync={() => handleSyncItem("uut", uut)} />
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  }

                  return (
                    <React.Fragment key={uutRowKey}>
                      <tr
                        className={`${isSelected ? `selected-row selected-instrument-start ${specRows.length <= 1 ? "selected-instrument-end" : ""}` : ""} ${isActivePointUut ? "active-point-uut-row" : ""} ${hoveredRowId === uut.id ? "row-hovered" : ""}`}
                        onMouseEnter={() => setHoveredRowId(uut.id)}
                        style={{
                          cursor: "pointer",
                        }}
                        onClick={(e) => handleUutClick(e, uut.id)}
                        onContextMenu={(e) => openInstrumentRowMenu(e, "uut", uut)}
                        title="Click to select"
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
                            {onSessionSave ? (
                              <EditableDescriptionCell
                                name={uut.description}
                                make={uut.instrument?.manufacturer}
                                model={uut.instrument?.model}
                                instruments={instruments}
                                onPickLibrary={(inst) =>
                                  promptLibraryPick("uut", uut.id, inst, uutFnKey)
                                }
                                onCommit={(field, value) =>
                                  handleDetailUutDescEdit(uut.id, field, value)
                                }
                              />
                            ) : (
                              <span>{uut.description}</span>
                            )}
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
                          style={{ verticalAlign: "middle" }}
                        >
                          <div className={showAllRanges ? "range-stack" : undefined}>
                            {visibleRangeRows.map(({ range, key }) => (
                              <div className="range-stack-row" key={key}>
                                <RangeCell
                                  ranges={showAllRanges ? [range] : ranges}
                                  activeIndex={showAllRanges ? 0 : activeIndex}
                                  activeRange={range}
                                  editable={!!onSessionSave}
                                  allowSingleToggle={newRangeKeys.has(
                                    rangeStateKey("uut", uut.id, range?.id),
                                  )}
                                  onSelect={(idx) =>
                                    handleRangeChange(
                                      uut.id,
                                      idx,
                                      ranges,
                                      isActivePointUut,
                                    )
                                  }
                                  onEditBound={(field, value) =>
                                    handleEditRangeBoundDetail("uut", uut, range?.id, field, value)
                                  }
                                  onEditUnit={(value) =>
                                    setRangeUnitDetail("uut", uut, range?.id, value)
                                  }
                                  onPatchRange={(patch) =>
                                    patchRangeDetail("uut", uut, range?.id, patch)
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        </td>

                        <td
                          className={`cell-tolerance ${hoveredCell.tableId === "uut_det" && hoveredCell.colIndex === 2 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "uut_det", colIndex: 2 })
                          }
                          title={!onSessionSave ? specRows[0] : undefined}
                        >
                          <div className={showAllRanges ? "range-stack" : undefined}>
                            {visibleRangeRows.map(({ range, key }) => {
                              const tolerance =
                                getItemRangeTolerance(uut, range?.id) ||
                                range ||
                                {};
                              const typeKey = getSelectedToleranceTypeDetail(
                                "uut",
                                uut,
                                range,
                              );
                              return (
                                <div className="range-stack-row" key={key}>
                                  {onSessionSave ? (
                                    <InlineToleranceCell
                                      tolerance={tolerance}
                                      activeRange={range}
                                      typeKey={typeKey}
                                      selectedType={
                                        selectedToleranceKey ===
                                        toleranceTypeKey("uut", uut, range?.id)
                                          ? typeKey
                                          : null
                                      }
                                      editable={!!onSessionSave}
                                      onSelectType={(nextTypeKey) =>
                                        setSelectedToleranceTypeDetail(
                                          "uut",
                                          uut,
                                          range,
                                          nextTypeKey,
                                        )
                                      }
                                      onCommit={(nextTypeKey, component) =>
                                        setRangeToleranceComponentDetail(
                                          "uut",
                                          uut,
                                          range,
                                          nextTypeKey,
                                          component,
                                        )
                                      }
                                    />
                                  ) : (
                                    getSpecRows(tolerance)[0]
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        <td
                          rowSpan={rowSpan}
                          className={`cell-value ${hoveredCell.tableId === "uut_det" && hoveredCell.colIndex === 3 ? "col-hovered" : ""}`}
                          onMouseEnter={() =>
                            setHoveredCell({ tableId: "uut_det", colIndex: 3 })
                          }
                          title={formatResolutionLabel(activeRange)}
                        >
                          <div className={showAllRanges ? "range-stack" : undefined}>
                            {visibleRangeRows.map(({ range, key }) => (
                              <div className="range-stack-row" key={key}>
                                {onSessionSave ? (
                                  <ResolutionCellInput
                                    value={range?.resolution ?? range?.measuringResolution}
                                    unit={range?.resolutionUnit ?? range?.measuringResolutionUnit}
                                    fallbackUnit={range?.unit}
                                    onCommit={(v) =>
                                      setRangeResolutionDetail("uut", uut, range?.id, v)
                                    }
                                    onCommitUnit={(value) =>
                                      setRangeResolutionUnitDetail("uut", uut, range?.id, value)
                                    }
                                    useResolution={range?.includeResolutionInBudget}
                                    onToggleUse={(checked) =>
                                      setRangeUseResolutionDetail("uut", uut, range?.id, checked)
                                    }
                                  />
                                ) : (
                                  formatResolutionLabel(range)
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td
                          rowSpan={rowSpan}
                          className="cell-sync"
                          style={{ textAlign: "center" }}
                        >
                          <SyncBadge item={uut} onSync={() => handleSyncItem("uut", uut)} />
                        </td>
                      </tr>

                      {!onSessionSave && specRows.slice(1).map((specComp, sIdx) => (
                        <tr
                          key={`${uutRowKey}-spec-${sIdx}`}
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
            <div className="panel-card-actions" style={{ position: "relative" }}>
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
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setAddFunctionMenu((m) =>
                    m && m.kind === "tmde" ? null : { kind: "tmde", rect },
                  );
                }}
                title="Add Function"
              >
                <FontAwesomeIcon icon={faPlus} size="xs" />
              </button>
              {renderAddFunctionMenu("tmde")}
            </div>
          </div>

          <div className="panel-table-container">
            <table
              className="instrument-summary-table industry-table equipment-detail-table"
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
                <col style={{ width: isDerived ? "10%" : "5%" }} />
                <col style={{ width: isDerived ? "20%" : "25%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "5%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ textAlign: isDerived ? "left" : "center" }}>
                    {isDerived ? "Assigned Input" : "Use"}
                  </th>
                  <th>Description</th>
                  <th>
                    <span className="range-header-cell">
                      <span>Range</span>
                      {renderRangeHeaderActionsDetail("tmde")}
                    </span>
                  </th>
                  <th>
                    <span className="range-header-cell">
                      <span>Error Limit</span>
                      {renderToleranceHeaderActionsDetail("tmde")}
                    </span>
                  </th>
                  <th className="cell-distribution">Distribution</th>
                  <th>Resolution</th>
                  <th className="cell-sync">Sync</th>
                </tr>
              </thead>
              <tbody>
                {buildFunctionGroupedRows(
                  relevantTmdes.map((item, index) => ({ type: "item", item, index })),
                  sessionData,
                  "tmde",
                ).length === 0 ? (
                  <tr className="panel-empty-row">
                    <td colSpan="7">
                      No TMDEs defined for this measurement area.
                    </td>
                  </tr>
                ) : (
                  buildFunctionGroupedRows(
                    relevantTmdes.map((item, index) => ({ type: "item", item, index })),
                    sessionData,
                    "tmde",
                  ).map((row) => {
                    if (row.type === "function") {
                      return renderFunctionHeaderRow("tmde", row.fn, 8);
                    }
                    const masterTmde = row.item;
                    const tmdeRowKey = row.rowKey ?? masterTmde.id;
                    const tmdeFnKey = row.functionKey ?? null;
                    // Check selection state
                    const isSelectedRow = selectedTmdeIds.includes(
                      masterTmde.id,
                    );

                    const activeInstances = tmdeTolerancesData.filter(
                      (t) =>
                        String(t.id) === String(masterTmde.id) ||
                        (t.sourceId && String(t.sourceId) === String(masterTmde.id)),
                    );
                    const rowsToRender =
                      activeInstances.length > 0
                        ? activeInstances
                        : [masterTmde];

                    return rowsToRender.map((tmdeInstance, idx) => {
                      const isChecked = activeInstances.includes(tmdeInstance);
                      // const referencePoint = tmdeInstance.measurementPoint || { value: '', unit: '' }; // Removed unused reference

                      const savedTolerance = isChecked ? tmdeInstance : null;
                      // Pass the point's nominal so an unassigned TMDE defaults to
                      // a range that actually covers this measurement point
                      // (resolveUutRangeHelper Priority C) instead of range 0.
                      const resolution = resolveUutRangeHelper(
                        masterTmde,
                        { [masterTmde.id]: tmdeRangeIndices[tmdeRowKey] },
                        savedTolerance,
                        isDerived ? null : uutNominal,
                        tmdeFnKey,
                      );
                      const { ranges, activeIndex, activeRange } = resolution;
                      const compatibility = isDerived
                        ? { compatible: true, reason: "" }
                        : assessTmdeCompatibility(activeRange, uutNominal);

                      const effectiveTolerance = activeRange;
                      const specRows = getSpecRows(effectiveTolerance);
                      const rowSpan = !onSessionSave && specRows.length > 0 ? specRows.length : 1;
                      const showAllRanges = isShowingAllRangesDetail(
                        "tmde",
                        tmdeRowKey,
                      );
                      const visibleRangeRows = getVisibleRangeRows(
                        ranges,
                        activeIndex,
                        activeRange,
                        showAllRanges,
                      );

                      const safeDescription =
                        masterTmde.description ||
                        masterTmde.name ||
                        (masterTmde.instrument
                          ? `${masterTmde.instrument.manufacturer} ${masterTmde.instrument.model}`
                          : "Unknown TMDE");

                      // Expanded "view all ranges": one real <tr> per range. The
                      // checkbox/derived assignment (col 0) and description (col 1)
                      // span the group via rowSpan on the first range row.
                      if (showAllRanges) {
                        const n = visibleRangeRows.length;
                        const canDelete = ranges.length > 1;
                        const activeRangeIndex =
                          tmdeRangeIndices[tmdeRowKey] ?? activeIndex;
                        const renderUsageCell = () =>
                          isDerived ? (
                            <select
                              className="tmde-input-assignment"
                              value={isChecked ? tmdeInstance.variableType || "" : ""}
                              onChange={(e) =>
                                handleAssignTmdeToInput(masterTmde, e.target.value)
                              }
                              aria-label={`Assign ${safeDescription} to equation input`}
                            >
                              <option value="">Not used</option>
                              {availableVariables.map((variableType) => (
                                <option key={variableType} value={variableType}>
                                  {variableType}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (!isChecked && !compatibility.compatible) {
                                  setNotification({
                                    title: "Can't Use This TMDE",
                                    message: `${compatibility.reason} Adjust the TMDE's range/unit (or the measurement point) so it covers this point, then try again.`,
                                  });
                                  return;
                                }
                                handleToggleTmdeUsage(masterTmde.id, e.target.checked);
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
                                  !isChecked && !compatibility.compatible ? 0.5 : 1,
                              }}
                            />
                          );
                        return (
                          <React.Fragment key={`${tmdeRowKey}-${idx}`}>
                            {visibleRangeRows.map(({ range, index, key }, i) => {
                              const isActiveRange = index === activeRangeIndex;
                              return (
                                <tr
                                  key={key}
                                  className={`tmde-row inline-range-row${i === 0 ? " inline-range-row--first" : ""}${i === n - 1 ? " inline-range-row--last" : ""}${isSelectedRow ? " instrument-selected" : ""}${isActiveRange ? " is-active-range" : ""}${isChecked ? " active-point-tmde-row" : ""} ${hoveredRowId === masterTmde.id ? "row-hovered" : ""}`}
                                  onMouseEnter={() => setHoveredRowId(masterTmde.id)}
                                  onContextMenu={(e) =>
                                    openRangeRowMenu(e, "tmde", masterTmde, range, index, n)
                                  }
                                  onMouseDownCapture={() =>
                                    activateRangeRowDetail("tmde", tmdeRowKey, index)
                                  }
                                  onClick={(e) => {
                                    if (!isInlineRowControlTarget(e.target)) {
                                      setSelectedToleranceKey(null);
                                    }
                                  }}
                                  style={{
                                    opacity: isChecked || isSelectedRow ? 1 : 0.7,
                                    cursor: "pointer",
                                  }}
                                >
                                  {i === 0 && (
                                    <td
                                      rowSpan={n}
                                      style={{
                                        textAlign: isDerived ? "left" : "center",
                                        verticalAlign: "middle",
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className={`${hoveredCell.tableId === "tmde_det" && hoveredCell.colIndex === 0 ? "col-hovered" : ""}`}
                                      onMouseEnter={() =>
                                        setHoveredCell({ tableId: "tmde_det", colIndex: 0 })
                                      }
                                    >
                                      {renderUsageCell()}
                                    </td>
                                  )}
                                  {i === 0 && (
                                    <td
                                      rowSpan={n}
                                      className={`cell-description ${hoveredCell.tableId === "tmde_det" && hoveredCell.colIndex === 1 ? "col-hovered" : ""}`}
                                      onMouseEnter={() =>
                                        setHoveredCell({ tableId: "tmde_det", colIndex: 1 })
                                      }
                                    >
                                      <EditableDescriptionCell
                                        name={masterTmde.name}
                                        make={masterTmde.instrument?.manufacturer}
                                        model={masterTmde.instrument?.model}
                                          instruments={instruments}
                                          onPickLibrary={(inst) =>
                                            promptLibraryPick("tmde", masterTmde.id, inst, tmdeFnKey)
                                          }
                                        onCommit={(field, value) =>
                                          handleDetailTmdeDescEdit(masterTmde.id, field, value)
                                        }
                                      />
                                    </td>
                                  )}
                                  {renderRangeRowCellsDetail("tmde", masterTmde, range, {
                                    includeDistribution: true,
                                    canDelete,
                                    cols: { range: 2, tol: 3, res: 4 },
                                  })}
                                  {i === 0 && (
                                    <td
                                      rowSpan={n}
                                      className="cell-sync"
                                      style={{ textAlign: "center" }}
                                    >
                                      <SyncBadge
                                        item={masterTmde}
                                        onSync={() => handleSyncItem("tmde", masterTmde)}
                                      />
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        );
                      }

                      return (
                        <React.Fragment key={`${tmdeRowKey}-${idx}`}>
                          <tr
                            className={`tmde-row ${isChecked ? "active-point-tmde-row" : ""} ${isSelectedRow ? `selected-row selected-instrument-start ${specRows.length <= 1 ? "selected-instrument-end" : ""}` : ""} ${hoveredRowId === masterTmde.id ? "row-hovered" : ""}`}
                            onMouseEnter={() => setHoveredRowId(masterTmde.id)}
                            style={{
                              opacity: isChecked ? 1 : isSelectedRow ? 1 : 0.7,
                              cursor: "pointer",
                            }}
                            onClick={(e) => handleTmdeClick(e, masterTmde.id)}
                            onContextMenu={(e) =>
                              openInstrumentRowMenu(e, "tmde", masterTmde)
                            }
                            title="Click to select"
                          >
                            <td
                              rowSpan={rowSpan}
                              style={{
                                textAlign: isDerived ? "left" : "center",
                                verticalAlign: "middle",
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
                              {onSessionSave ? (
                                <EditableDescriptionCell
                                  name={masterTmde.name}
                                  make={masterTmde.instrument?.manufacturer}
                                  model={masterTmde.instrument?.model}
                                    instruments={instruments}
                                    onPickLibrary={(inst) =>
                                      promptLibraryPick("tmde", masterTmde.id, inst, tmdeFnKey)
                                    }
                                  onCommit={(field, value) =>
                                    handleDetailTmdeDescEdit(
                                      masterTmde.id,
                                      field,
                                      value,
                                    )
                                  }
                                />
                              ) : (
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
                              )}
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
                              style={{ verticalAlign: "middle" }}
                            >
                              <div className={showAllRanges ? "range-stack" : undefined}>
                                {visibleRangeRows.map(({ range, key }) => (
                                  <div className="range-stack-row" key={key}>
                                    <RangeCell
                                      ranges={showAllRanges ? [range] : ranges}
                                      activeIndex={showAllRanges ? 0 : activeIndex}
                                      activeRange={range}
                                      editable={!!onSessionSave}
                                      allowSingleToggle={newRangeKeys.has(
                                        rangeStateKey("tmde", masterTmde.id, range?.id),
                                      )}
                                      onSelect={(idx) =>
                                        handleTmdeRangeChange(masterTmde, idx, ranges)
                                      }
                                      onEditBound={(field, value) =>
                                        handleEditRangeBoundDetail(
                                          "tmde",
                                          masterTmde,
                                          range?.id,
                                          field,
                                          value,
                                        )
                                      }
                                      onEditUnit={(value) =>
                                        setRangeUnitDetail(
                                          "tmde",
                                          masterTmde,
                                          range?.id,
                                          value,
                                        )
                                      }
                                      onPatchRange={(patch) =>
                                        patchRangeDetail(
                                          "tmde",
                                          masterTmde,
                                          range?.id,
                                          patch,
                                        )
                                      }
                                    />
                                  </div>
                                ))}
                              </div>
                            </td>

                            <td
                              className={`cell-tolerance ${hoveredCell.tableId === "tmde_det" && hoveredCell.colIndex === 3 ? "col-hovered" : ""}`}
                              onMouseEnter={() =>
                                setHoveredCell({
                                  tableId: "tmde_det",
                                  colIndex: 3,
                                })
                              }
                              title={!onSessionSave ? specRows[0] : undefined}
                            >
                              <div className={showAllRanges ? "range-stack" : undefined}>
                                {visibleRangeRows.map(({ range, key }) => {
                                  const tolerance =
                                    getItemRangeTolerance(
                                      masterTmde,
                                      range?.id,
                                    ) ||
                                    range ||
                                    {};
                                  const typeKey = getSelectedToleranceTypeDetail(
                                    "tmde",
                                    masterTmde,
                                    range,
                                  );
                                  return (
                                    <div className="range-stack-row" key={key}>
                                      {onSessionSave ? (
                                        <InlineToleranceCell
                                          tolerance={tolerance}
                                          activeRange={range}
                                          typeKey={typeKey}
                                          selectedType={
                                            selectedToleranceKey ===
                                            toleranceTypeKey(
                                              "tmde",
                                              masterTmde,
                                              range?.id,
                                            )
                                              ? typeKey
                                              : null
                                          }
                                          editable={!!onSessionSave}
                                          onSelectType={(nextTypeKey) =>
                                            setSelectedToleranceTypeDetail(
                                              "tmde",
                                              masterTmde,
                                              range,
                                              nextTypeKey,
                                            )
                                          }
                                          onCommit={(nextTypeKey, component) =>
                                            setRangeToleranceComponentDetail(
                                              "tmde",
                                              masterTmde,
                                              range,
                                              nextTypeKey,
                                              component,
                                            )
                                          }
                                        />
                                      ) : (
                                        getSpecRows(tolerance)[0]
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </td>

                            <td
                              rowSpan={rowSpan}
                              className="cell-distribution"
                              title="Spec band distribution"
                              style={{ verticalAlign: "middle" }}
                            >
                              <div className={showAllRanges ? "range-stack" : undefined}>
                                {visibleRangeRows.map(({ range, key }) => {
                                  const tolerance =
                                    getItemRangeTolerance(masterTmde, range?.id) || range;
                                  return (
                                    <div className="range-stack-row" key={key}>
                                      {onSessionSave &&
                                      getBandDistDivisor(tolerance) ? (
                                        <select
                                          className="session-selector"
                                          value={getBandDistDivisor(tolerance)}
                                          onChange={(e) =>
                                            setRangeBandDistributionDetail(
                                              "tmde",
                                              masterTmde,
                                              range?.id,
                                              e.target.value,
                                            )
                                          }
                                        >
                                          {errorDistributions.map((d) => (
                                            <option key={d.value} value={d.value}>
                                              {d.label}
                                            </option>
                                          ))}
                                        </select>
                                      ) : (
                                        getBandDistLabel(tolerance)
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </td>

                            <td
                              rowSpan={rowSpan}
                              className={`cell-value ${hoveredCell.tableId === "tmde_det" && hoveredCell.colIndex === 4 ? "col-hovered" : ""}`}
                              onMouseEnter={() =>
                                setHoveredCell({
                                  tableId: "tmde_det",
                                  colIndex: 4,
                                })
                              }
                              title={formatResolutionLabel(activeRange)}
                            >
                              <div className={showAllRanges ? "range-stack" : undefined}>
                                {visibleRangeRows.map(({ range, key }) => (
                                  <div className="range-stack-row" key={key}>
                                    {onSessionSave ? (
                                      <ResolutionCellInput
                                        value={
                                          range?.resolution ??
                                          range?.measuringResolution
                                        }
                                        unit={
                                          range?.resolutionUnit ??
                                          range?.measuringResolutionUnit
                                        }
                                        fallbackUnit={range?.unit}
                                        onCommit={(v) =>
                                          setRangeResolutionDetail(
                                            "tmde",
                                            masterTmde,
                                            range?.id,
                                            v,
                                          )
                                        }
                                        onCommitUnit={(value) =>
                                          setRangeResolutionUnitDetail(
                                            "tmde",
                                            masterTmde,
                                            range?.id,
                                            value,
                                          )
                                        }
                                        useResolution={range?.includeResolutionInBudget}
                                        onToggleUse={(checked) =>
                                          setRangeUseResolutionDetail(
                                            "tmde",
                                            masterTmde,
                                            range?.id,
                                            checked,
                                          )
                                        }
                                      />
                                    ) : isChecked ? (
                                      formatResolutionLabel(range)
                                    ) : (
                                      ""
                                    )}
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td
                              rowSpan={rowSpan}
                              className="cell-sync"
                              style={{ textAlign: "center" }}
                            >
                              <SyncBadge item={masterTmde} onSync={() => handleSyncItem("tmde", masterTmde)} />
                            </td>
                          </tr>

                          {!onSessionSave && specRows.slice(1).map((specComp, sIdx) => (
                            <tr
                              key={`${tmdeRowKey}-${idx}-spec-${sIdx}`}
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
      <ContextMenu menu={rowMenu} onClose={() => setRowMenu(null)} />
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
        contextName={testPointData.functionName}
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
        onSessionSave={props.onSessionSave}
        instruments={props.instruments || []}
        onSaveInstrument={props.onSaveInstrument}
        setNotification={props.setNotification}
      />
    );
  }

  return (
    <DetailedView
      {...props}
      onDeleteUut={props.onDeleteUut}
      onDeleteTmdeDefinition={props.onDeleteTmdeDefinition}
    />
  );
};

export default UncertaintyPanel;
