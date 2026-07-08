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
  effectiveFloorTerm,
  convertPpmToUnit,
  getUnitDisplayLabel,
  unitSystem,
  unitCategories,
  errorDistributions,
  DISTRIBUTION_NOT_SET,
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

export const scopeLibraryInstrumentToFunction = (
  instrument = {},
  functionKey,
  fallbackFn = {},
) => {
  if (!functionKey) return instrument;
  const functions = Array.isArray(instrument.functions) ? instrument.functions : [];
  const selectedName = functionNamePart(functionKey);
  const selectedUnit = functionUnitPart(functionKey);
  const functionMatches = (name, unit) => {
    const candidateKey = makeFunctionKey(name, unit);
    if (candidateKey === functionKey) return true;
    if (!selectedName || functionNamePart(candidateKey) !== selectedName) return false;
    return functionUnitsMatch(selectedUnit, functionUnitPart(candidateKey));
  };
  const match = functions.find((fn) => functionMatches(fn.name, fn.unit));
  const fallbackName = fallbackFn.name || "";
  const fallbackUnit =
    fallbackFn.unit !== undefined && fallbackFn.unit !== null
      ? String(fallbackFn.unit)
      : "";
  const matchingRangeRows = match
    ? []
    : getInstrumentRangeRows(instrument).filter(
        (range) => {
          const name = range.functionName || fallbackName;
          const unit = range.functionUnit || range.unit || fallbackUnit;
          return functionMatches(name, unit);
        },
      );
  const scopedFunction = match
    ? {
        ...match,
        name: fallbackName || match.name,
        unit: fallbackFn.unit !== undefined && fallbackFn.unit !== null ? fallbackUnit : match.unit,
        ranges: Array.isArray(match.ranges) ? match.ranges : [],
      }
    : matchingRangeRows.length > 0
      ? {
          id: uuidv4(),
          name: matchingRangeRows[0].functionName || fallbackName,
          unit:
            fallbackFn.unit !== undefined && fallbackFn.unit !== null
              ? fallbackUnit
              : matchingRangeRows[0].functionUnit || matchingRangeRows[0].unit,
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

const SI_PREFIX_OPTIONS = [
  { key: "", label: "Base", shortLabel: "Base" },
  { key: "p", label: "Pico", shortLabel: "p" },
  { key: "n", label: "Nano", shortLabel: "n" },
  { key: "u", label: "Micro", shortLabel: "u" },
  { key: "m", label: "Milli", shortLabel: "m" },
  { key: "c", label: "Centi", shortLabel: "c" },
  { key: "h", label: "Hecto", shortLabel: "h" },
  { key: "k", label: "Kilo", shortLabel: "k" },
  { key: "M", label: "Mega", shortLabel: "M" },
  { key: "G", label: "Giga", shortLabel: "G" },
  { key: "T", label: "Tera", shortLabel: "T" },
];

const SCALABLE_UNIT_FAMILIES = [
  { base: "V", prefixes: ["n", "u", "m", "", "k"] },
  { base: "A", prefixes: ["p", "n", "u", "m", "", "k"] },
  { base: "Ohm", prefixes: ["m", "", "k", "M", "G", "T"] },
  { base: "F", prefixes: ["p", "n", "u", "m", ""] },
  { base: "H", prefixes: ["u", "m", ""] },
  { base: "W", prefixes: ["m", "", "k", "M"] },
  { base: "Hz", prefixes: ["", "k", "M", "G", "T"] },
  { base: "s", prefixes: ["p", "n", "u", "m", ""] },
  { base: "m", prefixes: ["n", "u", "m", "c", "", "k"] },
  { base: "g", prefixes: ["u", "m", "", "k"] },
  { base: "rad", prefixes: ["m", ""] },
  { base: "L", prefixes: ["m", ""] },
  { base: "Pa", prefixes: ["", "h", "k", "M"] },
  { base: "N", prefixes: ["", "k"] },
  { base: "J", prefixes: ["", "k"] },
  { base: "Wh", prefixes: ["", "k"] },
  { base: "T", prefixes: ["u", "m", ""] },
];

const unitKeyFromParts = (base, prefix = "") => {
  if (!base) return "";
  if (base === "Ohm") return prefix ? `${prefix}Ohm` : "Ohm";
  if (base === "g" && prefix === "k") return "kg";
  return `${prefix}${base}`;
};

const buildUnitPartModel = () => {
  const allSupportedUnits = Object.keys(unitSystem.units);
  const supportedUnitSet = new Set(allSupportedUnits);
  const scalableByUnit = new Map();
  const baseOptionsByCategory = [];
  const usedBaseUnits = new Set();
  const usedScalableUnits = new Set();

  SCALABLE_UNIT_FAMILIES.forEach((family) => {
    const supportedPrefixes = family.prefixes.filter((prefix) =>
      supportedUnitSet.has(unitKeyFromParts(family.base, prefix)),
    );
    if (supportedPrefixes.length === 0) return;
    const defaultPrefix = supportedPrefixes.includes("") ? "" : supportedPrefixes[0];
    supportedPrefixes.forEach((prefix) => {
      const unit = unitKeyFromParts(family.base, prefix);
      scalableByUnit.set(unit, {
        base: family.base,
        prefix,
        defaultPrefix,
        prefixes: supportedPrefixes,
      });
      usedScalableUnits.add(unit);
    });
  });

  Object.entries(unitCategories).forEach(([category, units]) => {
    const categoryOptions = [];
    units.forEach((unit) => {
      if (!supportedUnitSet.has(unit)) return;
      const scalable = scalableByUnit.get(unit);
      const base = scalable?.base || unit;
      const key = `${category}:${base}`;
      if (usedBaseUnits.has(key)) return;
      usedBaseUnits.add(key);
      categoryOptions.push({
        value: base,
        label: getUnitDisplayLabel(base),
        category,
        scalable: Boolean(scalable),
        unit,
      });
    });
    if (categoryOptions.length > 0) {
      baseOptionsByCategory.push({ label: category, options: categoryOptions });
    }
  });

  const knownBaseValues = new Set(
    baseOptionsByCategory.flatMap((group) => group.options.map((option) => option.value)),
  );
  const leftovers = allSupportedUnits
    .filter((unit) => !usedScalableUnits.has(unit) && !knownBaseValues.has(unit))
    .sort()
    .map((unit) => ({
      value: unit,
      label: getUnitDisplayLabel(unit),
      category: "Other",
      scalable: false,
      unit,
    }));

  if (leftovers.length > 0) {
    baseOptionsByCategory.push({ label: "Other", options: leftovers });
  }

  return { baseOptionsByCategory, scalableByUnit };
};

const normalizeUnitToken = (unit) =>
  String(unit || "")
    .trim()
    .replace(/[₀０]/g, "0")
    .replace(/[₁１]/g, "1")
    .replace(/[₂２]/g, "2")
    .replace(/[³₃３]/g, "3")
    .replace(/[µμ]/g, "u")
    .replace(/Ω/g, "Ohm")
    .replace(/Ω/g, "Ohm")
    .replace(/°/g, "deg")
    .replace(/[·⋅]/g, "-")
    .replace(/\s+/g, "")
    .replace(/\.$/, "")
    .replace(/h20/gi, "h2o")
    .toLowerCase();

const resolveUnitOption = (flatUnitOptions, value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = normalizeUnitToken(raw);
  return (
    flatUnitOptions.find((option) => option.value === raw) ||
    flatUnitOptions.find(
      (option) =>
        normalizeUnitToken(option.value) === normalized ||
        normalizeUnitToken(option.label) === normalized,
    ) ||
    null
  );
};

const UnitSelect = ({ value = "", onChange, ariaLabel = "Unit", width = null }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuRect, setMenuRect] = useState(null);
  const [activeBase, setActiveBase] = useState("");
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const selectedRef = useRef(null);
  const activeRef = useRef(null);
  const groupedUnitOptions = useMemo(() => buildGroupedUnitOptions(), []);
  const flatUnitOptions = useMemo(
    () => groupedUnitOptions.flatMap((group) => group.options || []),
    [groupedUnitOptions],
  );
  const selectedOption = resolveUnitOption(flatUnitOptions, value);
  const selectedUnit = selectedOption?.value || "";
  const { baseOptionsByCategory, scalableByUnit } = useMemo(() => buildUnitPartModel(), []);
  const scalableByBase = useMemo(() => {
    const byBase = new Map();
    scalableByUnit.forEach((model) => {
      if (!byBase.has(model.base)) byBase.set(model.base, model);
    });
    return byBase;
  }, [scalableByUnit]);
  const selectedModel = scalableByUnit.get(selectedUnit);
  const selectedBase = selectedModel?.base || selectedUnit;
  const selectedPrefix = selectedModel?.prefix || "";
  const flatBaseOptions = useMemo(
    () => baseOptionsByCategory.flatMap((group) => group.options || []),
    [baseOptionsByCategory],
  );
  const selectedBaseOption =
    flatBaseOptions.find((option) => option.value === selectedBase) ||
    flatBaseOptions.find((option) => option.unit === selectedUnit) ||
    null;
  const normalizedQuery = normalizeUnitToken(query);
  const visibleGroups = useMemo(() => {
    if (!normalizedQuery) return baseOptionsByCategory;
    return baseOptionsByCategory
      .map((group) => ({
        ...group,
        options: (group.options || []).filter((option) => {
          const category = normalizeUnitToken(group.label);
          return (
            normalizeUnitToken(option.value).includes(normalizedQuery) ||
            normalizeUnitToken(option.label).includes(normalizedQuery) ||
            normalizeUnitToken(option.unit).includes(normalizedQuery) ||
            category.includes(normalizedQuery)
          );
        }),
      }))
      .filter((group) => group.options.length > 0);
  }, [baseOptionsByCategory, normalizedQuery]);
  const visibleOptions = useMemo(
    () => visibleGroups.flatMap((group) => group.options || []),
    [visibleGroups],
  );
  const unitWidth = useMemo(() => {
    const longestLabelLength = Math.max(
      4,
      ...flatBaseOptions.map((option) => String(option.label || option.value || "").length),
    );
    return `${Math.min(longestLabelLength + 10, 18)}ch`;
  }, [flatBaseOptions]);
  const prefixOptions = selectedModel
    ? selectedModel.prefixes
        .map((prefix) => SI_PREFIX_OPTIONS.find((option) => option.key === prefix))
        .filter(Boolean)
    : [];
  const prefixSelectWidth = selectedModel ? "74px" : "58px";
  const openMenu = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuRect({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 240),
      });
    }
    setQuery("");
    setActiveBase(selectedBase);
    setIsOpen(true);
  };
  const closeMenu = () => setIsOpen(false);
  const chooseBaseUnit = (option) => {
    if (option.scalable) {
      const model = scalableByBase.get(option.value);
      onChange(unitKeyFromParts(option.value, model?.defaultPrefix || ""));
    } else {
      onChange(option.unit || option.value);
    }
    closeMenu();
  };
  const choosePrefix = (prefix) => {
    if (!selectedModel) return;
    onChange(unitKeyFromParts(selectedModel.base, prefix));
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (
        rootRef.current?.contains(target) ||
        target?.closest?.(".inline-unit-menu")
      ) {
        return;
      }
      closeMenu();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (
      visibleOptions.length > 0 &&
      !visibleOptions.some((option) => option.value === activeBase)
    ) {
      setActiveBase(visibleOptions[0].value);
    }
  }, [activeBase, isOpen, visibleOptions]);

  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      (activeRef.current || selectedRef.current)?.scrollIntoView({ block: "nearest" });
    });
  }, [activeBase, isOpen, normalizedQuery]);

  return (
    <div
      ref={rootRef}
      className={`inline-unit-select${selectedModel ? " inline-unit-split-select" : ""}`}
      onMouseDown={(e) => e.stopPropagation()}
      aria-label={ariaLabel}
      style={{
        "--inline-unit-width": width || unitWidth,
        "--inline-prefix-width": prefixSelectWidth,
      }}
    >
      <button
        type="button"
        className={`inline-unit-combobox inline-unit-base-button${isOpen ? " is-open" : ""}`}
        aria-label={`${ariaLabel} base unit`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={selectedBaseOption?.label || selectedOption?.label || value || "Unit"}
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen) closeMenu();
          else openMenu();
        }}
      >
        <span>{selectedBaseOption?.label || selectedOption?.label || value || "Unit"}</span>
        <FontAwesomeIcon icon={faChevronDown} size="xs" />
      </button>
      {selectedModel && (
        <select
          className="inline-unit-prefix-select"
          value={selectedPrefix}
          aria-label={`${ariaLabel} prefix`}
          title="Unit prefix"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => choosePrefix(e.target.value)}
        >
          {prefixOptions.map((prefix) => (
            <option key={prefix.key || "base"} value={prefix.key}>
              {prefix.shortLabel}
            </option>
          ))}
        </select>
      )}
      {isOpen &&
        menuRect &&
        ReactDOM.createPortal(
          <div
            className="inline-unit-menu"
            style={{
              top: menuRect.top,
              left: menuRect.left,
              width: menuRect.width,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              ref={searchRef}
              className="inline-unit-search"
              value={query}
              placeholder="Search units..."
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  closeMenu();
                  return;
                }
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  if (visibleOptions.length === 0) return;
                  const currentIndex = Math.max(
                    0,
                    visibleOptions.findIndex((option) => option.value === activeBase),
                  );
                  const offset = e.key === "ArrowDown" ? 1 : -1;
                  const nextIndex =
                    (currentIndex + offset + visibleOptions.length) % visibleOptions.length;
                  setActiveBase(visibleOptions[nextIndex].value);
                  return;
                }
                if (e.key === "Enter") {
                  const activeOption =
                    visibleOptions.find((option) => option.value === activeBase) ||
                    visibleOptions[0];
                  if (activeOption) chooseBaseUnit(activeOption);
                }
              }}
            />
            <div className="inline-unit-options" role="listbox" aria-label={ariaLabel}>
              {visibleGroups.length === 0 ? (
                <div className="inline-unit-empty">No matching units</div>
              ) : (
                visibleGroups.map((group) => (
                  <div className="inline-unit-group" key={group.label}>
                    <div className="inline-unit-group-label">{group.label}</div>
                    {(group.options || []).map((option) => {
                      const isSelected = option.value === selectedBase;
                      const isActive = option.value === activeBase;
                      return (
                        <button
                          key={option.value}
                          ref={isActive ? activeRef : isSelected ? selectedRef : null}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`inline-unit-option${isSelected ? " is-selected" : ""}${
                            isActive ? " is-active" : ""
                          }`}
                          onMouseEnter={() => setActiveBase(option.value)}
                          onClick={() => chooseBaseUnit(option)}
                        >
                          <span>{option.label}</span>
                          <small>{option.scalable ? "Scaled" : option.unit || option.value}</small>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

// Read/write a UUT/TMDE's tolerance for a specific range, matched by range id.
// The summary tables edit the INSTRUMENT's range spec directly (range.tolerances)
// — this is the canonical spec, distinct from per-point overrides (a detail-view
// concern). Handles the common instrument.functions[].ranges[] shape plus the
// instrument.ranges / item.ranges / single-default fallbacks.
const sameId = (a, b) => String(a) === String(b);
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

// A range with no committed numeric bounds at all — used to detect "the user
// cleared this range" so we can prune it on blur. Note this is stricter than a
// half-filled range (min OR max missing), which stays put.
export const rangeIsBlank = (range = {}) => {
  const empty = (v) => v === "" || v === null || v === undefined;
  if (range?.isSingleValue) return empty(range.value) && empty(range.min);
  return empty(range.min) && empty(range.max);
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
const formatInstrumentIdentity = (source = {}, fallback = "Unnamed Instrument") => {
  const instrument = source.instrument || source || {};
  const manufacturer = instrument.manufacturer || source.manufacturer || "";
  const hasStructuredIdentity =
    manufacturer || instrument.description || instrument.name || instrument.model;
  const make =
    instrument.description ||
    instrument.name ||
    source.description ||
    (!hasStructuredIdentity ? source.name : "");
  const model = instrument.model || source.model || "";
  const parts = [];
  [manufacturer, make, model].forEach((part) => {
    const value = String(part || "").trim();
    if (!value) return;
    if (!parts.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      parts.push(value);
    }
  });
  return parts.join(" ") || source.description || source.name || fallback;
};

const findRangeForFunction = (source = {}, functionKey = null) => {
  const ranges = getInstrumentRangeRows(source);
  if (!ranges.length) return null;
  if (!functionKey) return ranges[0];
  const exact = ranges.find(
    (range) =>
      makeFunctionKey(
        range.functionName || "",
        range.functionUnit || range.unit || "",
      ) === functionKey,
  );
  if (exact) return exact;
  const loose = ranges.find((range) =>
    functionPartsMatch(range.functionName || "", range.functionUnit || range.unit || "", functionKey),
  );
  if (loose) return loose;
  return ranges[0];
};

const formatRangeToleranceDetail = (range = null) => {
  if (!range) return "";
  const rangeLabel = formatRangeLabel(range, { preferBounds: true });
  const specLabel = (getSpecRows(range)[0] || "").trim();
  const distributionLabel = getBandDistLabel(range);
  const isPlaceholder = (value) => {
    const normalized = String(value || "").trim();
    return !normalized || normalized === "-" || normalized === "\u2014";
  };
  return [rangeLabel, specLabel, distributionLabel]
    .filter((value) => !isPlaceholder(value))
    .join(" | ");
};

const formatInstrumentRangeDetail = (source = {}, functionKey = null) =>
  formatRangeToleranceDetail(findRangeForFunction(source, functionKey));

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
  functionKey = null,
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
    if (!onPickLibrary) return [];
    const matches = tokens.length
      ? (instruments || []).filter((inst) => {
          const hay = `${inst.manufacturer || ""} ${inst.model || ""} ${
            inst.description || ""
          }`.toLowerCase();
          return tokens.every((t) => hay.includes(t));
        })
      : instruments || [];
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
    return [...ordered, ...standalone];
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
            {results.map((inst) => {
              const detail = formatInstrumentRangeDetail(inst, functionKey);
              return (
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
                  <span
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatInstrumentIdentity(inst)}
                    </span>
                    {detail && (
                      <span
                        style={{
                          fontSize: "0.72rem",
                          color: "var(--text-color-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {detail}
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      flexShrink: 0,
                      fontSize: "0.72rem",
                      color: "var(--text-color-muted)",
                    }}
                  >
                    {describeEntry(inst)}
                  </span>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
};

// Default divisor for a resolution's rounding distribution — rectangular, the
// standard assumption for a least-significant-digit / quantization error.
const RESOLUTION_DIST_DEFAULT = "1.732";

// Clean read-view label for a resolution: "0.01 V" (with its distribution as a
// tooltip), or an empty string when no resolution has been entered yet.
const formatResolutionSummaryText = (value, unit, fallbackUnit) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "";
  }
  const unitLabel = getUnitDisplayLabel(unit || fallbackUnit || "");
  return unitLabel ? `${value} ${unitLabel}` : String(value);
};

// Inline-editable Resolution cell, mirroring the Range / Tolerance columns:
//   • Read view (default): the clean formatted resolution string (plus an
//     "edit / add" affordance), so the table snaps to a simple view at rest.
//   • Edit view (on click): the resolution magnitude, its unit, and the
//     distribution used when it enters the uncertainty budget.
// Closing is focus-driven (focusout), with the same portaled-unit-menu wrinkle
// the RangeCell handles (UnitSelect's menu lives on document.body).
const ResolutionCellInput = ({
  value = "",
  unit = "",
  fallbackUnit = "",
  distribution = "",
  editable = true,
  onCommit,
  onCommitUnit,
  onCommitDistribution,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [v, setV] = useState(() => toPlainNumber(value));
  const containerRef = useRef(null);
  useEffect(() => {
    setV(toPlainNumber(value));
  }, [value]);

  // Focus the magnitude field on open so a click-away always produces a
  // focusout (committing the in-progress value before the editor closes).
  useEffect(() => {
    if (!isEditing || !containerRef.current) return;
    const firstInput = containerRef.current.querySelector("input");
    firstInput?.focus();
  }, [isEditing]);

  // Document-click fallback close (portaled UnitSelect menu case, see RangeCell).
  useEffect(() => {
    if (!isEditing) return undefined;
    const onDocClick = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (containerRef.current?.contains(target)) return;
      if (target.closest(".inline-unit-menu")) return;
      setIsEditing(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [isEditing]);

  const summary = formatResolutionSummaryText(value, unit, fallbackUnit);

  if (!editable) {
    return <>{summary || "-"}</>;
  }

  if (!isEditing) {
    const openEditor = (e) => {
      e.stopPropagation();
      setIsEditing(true);
    };
    return (
      <span className="inline-tolerance-readview">
        <button
          type="button"
          className={`inline-tolerance-summary${summary ? "" : " is-empty"}`}
          title={summary ? "Click to edit resolution" : "Click to set a resolution"}
          onClick={openEditor}
        >
          {summary || "Set resolution…"}
        </button>
        {/* Same hover-revealed affordance as the range / tolerance columns. */}
        <button
          type="button"
          className="range-expand-btn"
          title="Edit resolution, unit, and distribution"
          aria-label="Edit resolution, unit, and distribution"
          onClick={openEditor}
        >
          <FontAwesomeIcon icon={faChevronDown} size="xs" />
          <span className="range-expand-btn-label">edit / add</span>
        </button>
      </span>
    );
  }

  const handleBlur = (event) => {
    const next = event.relatedTarget;
    if (next instanceof Element) {
      if (containerRef.current?.contains(next)) return;
      if (next.closest(".inline-unit-menu")) return;
    }
    setIsEditing(false);
  };

  const distValue = String(distribution || RESOLUTION_DIST_DEFAULT);

  return (
    <span
      ref={containerRef}
      className="inline-resolution-editor"
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={handleBlur}
    >
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
        className="inline-tolerance-input inline-resolution-input"
      />
      <UnitSelect
        value={unit || fallbackUnit || ""}
        ariaLabel="Resolution unit"
        onChange={onCommitUnit}
        width="72px"
      />
      {onCommitDistribution && (
        <select
          className="session-selector inline-resolution-dist"
          value={distValue}
          aria-label="Resolution distribution"
          title="Distribution used when this resolution enters the budget"
          onChange={(e) => onCommitDistribution(e.target.value)}
        >
          {errorDistributions.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      )}
    </span>
  );
};

// Two-view spec-band Distribution cell (TMDE tables): a clean label at rest, a
// distribution dropdown on click, snapping back on click-out — mirroring the
// Range / Tolerance / Resolution columns. Only interactive when the tolerance
// actually carries a spec band (a divisor); otherwise it renders a static "—".
const InlineDistributionCell = ({ divisor, editable = true, onChange }) => {
  const [isEditing, setIsEditing] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isEditing || !containerRef.current) return;
    containerRef.current.querySelector("select")?.focus();
  }, [isEditing]);

  const label = divisor
    ? errorDistributions.find((e) => e.value === String(divisor))?.label ||
      `k=${divisor}`
    : "—";

  // Read-only surfaces, or a tolerance with no spec band → just the clean label.
  if (!editable || !divisor) {
    return <>{label}</>;
  }

  if (!isEditing) {
    const open = (e) => {
      e.stopPropagation();
      setIsEditing(true);
    };
    return (
      <span className="inline-tolerance-readview">
        <button
          type="button"
          className="inline-tolerance-summary"
          title="Click to edit distribution"
          onClick={open}
        >
          {label}
        </button>
        {/* Same hover-revealed affordance as the other columns' editors. */}
        <button
          type="button"
          className="range-expand-btn"
          title="Edit distribution"
          aria-label="Edit distribution"
          onClick={open}
        >
          <FontAwesomeIcon icon={faChevronDown} size="xs" />
          <span className="range-expand-btn-label">edit / add</span>
        </button>
      </span>
    );
  }

  const handleBlur = (event) => {
    const next = event.relatedTarget;
    if (next && containerRef.current && containerRef.current.contains(next)) return;
    setIsEditing(false);
  };

  return (
    <span
      ref={containerRef}
      className="inline-distribution-editor"
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={handleBlur}
    >
      <select
        className="session-selector"
        value={divisor}
        aria-label="Spec band distribution"
        onChange={(e) => {
          onChange(e.target.value);
          setIsEditing(false);
        }}
      >
        {errorDistributions.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>
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
// True when a tolerance term carries an actual numeric magnitude (not just an
// empty shell). Used to decide which terms to keep vs. drop when the editable
// tolerance cell closes — blank terms are excluded so the clean summary stays
// tidy. For %FS the magnitude is the high/low percent, NOT the FS reference
// value, so a range term with only an FS value still counts as blank.
const toleranceComponentHasNumericValue = (typeKey, component) => {
  if (!component) return false;
  const finite = (x) => Number.isFinite(parseFloat(x));
  if (typeKey === "reading") {
    return finite(component.value) || finite(component.high) || finite(component.low);
  }
  return finite(component.high) || finite(component.low);
};
// Does this tolerance have at least one term with a real value? Drives the
// "Set tolerance…" placeholder vs. the compact summary in the read view.
const toleranceHasAnyValue = (tolerance = {}) =>
  TOLERANCE_TYPE_OPTIONS.some((opt) =>
    toleranceComponentHasNumericValue(opt.key, getToleranceComponent(tolerance, opt.key)),
  );
// Drop any tolerance term that carries no numeric value, leaving non-term keys
// (distribution, etc.) untouched. Applied on every tolerance write so a blank
// term the user left empty (or cleared) is excluded — no separate cleanup pass,
// which keeps a single write per edit and avoids clobbering races.
const pruneBlankToleranceTerms = (tolerance = {}) => {
  const next = { ...tolerance };
  TOLERANCE_TYPE_OPTIONS.forEach(({ key }) => {
    if (
      Object.prototype.hasOwnProperty.call(next, key) &&
      !toleranceComponentHasNumericValue(key, next[key])
    ) {
      delete next[key];
    }
  });
  // Fold the legacy `readings_iv` alias into `floor` so a spec never carries two
  // separate "Floor Value" terms (which downstream would double-count): promote
  // it when there's no floor yet, otherwise drop the stale duplicate.
  if (next.readings_iv) {
    if (!next.floor) next.floor = next.readings_iv;
    delete next.readings_iv;
  }
  return next;
};
const defaultToleranceComponent = (typeKey, activeRange = {}, tolerance = {}) => {
  const distribution = getBandDistDivisor(tolerance) || DISTRIBUTION_NOT_SET;
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
// Classify a tolerance term so the editor can pick the right input layout:
//   "symmetric"  — ±n (one input). Blank, mirrored, or both-zero limits.
//   "single"     — unilateral: exactly one limit is 0 (e.g. +1/-0 or +0/-1).
//   "asymmetric" — two non-zero limits with different magnitudes (+a/-b).
export const toleranceTermMode = (component = {}) => {
  const high = parseFloat(component?.high);
  const low = parseFloat(component?.low);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return "symmetric";
  const hZero = Math.abs(high) < 1e-12;
  const lZero = Math.abs(low) < 1e-12;
  if (hZero && lZero) return "symmetric";
  if (hZero || lZero) return "single";
  return Math.abs(Math.abs(high) - Math.abs(low)) > 1e-9 ? "asymmetric" : "symmetric";
};
// True when a term needs more than the single ± input (i.e. single-sided or
// asymmetric). Kept for callers/tests that just need the yes/no.
export const componentIsAsymmetric = (component = {}) =>
  toleranceTermMode(component) !== "symmetric";

const TOLERANCE_SHAPE_OPTIONS = [
  {
    key: "symmetric",
    symbol: "±",
    label: "Symmetric",
    detail: "Equal plus and minus limits",
  },
  {
    key: "single",
    symbol: "+0",
    label: "Single-sided",
    detail: "One limit is zero",
  },
  {
    key: "asymmetric",
    symbol: "+−",
    label: "Asymmetric",
    detail: "Independent plus and minus limits",
  },
];

const toleranceShapeOption = (mode) =>
  TOLERANCE_SHAPE_OPTIONS.find((option) => option.key === mode) ||
  TOLERANCE_SHAPE_OPTIONS[0];

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
  showHighSign = true,
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
  // Three-way per-term layout (non-reading): "symmetric" ± (one input),
  // "single" single-sided / unilateral (one input + a direction swap, the other
  // limit pinned to 0), or "asymmetric" (independent + / − inputs). reading is
  // always symmetric. The mode resyncs from the data on a term/range switch (not
  // on every keystroke) so it stays sticky while editing.
  const [mode, setMode] = useState(() =>
    typeKey === "reading" ? "symmetric" : toleranceTermMode(component),
  );
  const [shapeMenuRect, setShapeMenuRect] = useState(null);
  const shapeButtonRef = useRef(null);
  // For single-sided: true when the magnitude is on the − side (high pinned 0).
  const [singleNeg, setSingleNeg] = useState(
    () =>
      typeKey !== "reading" &&
      toleranceTermMode(component) === "single" &&
      Math.abs(parseFloat(component?.high) || 0) < 1e-12,
  );
  useEffect(() => {
    const m = typeKey === "reading" ? "symmetric" : toleranceTermMode(component);
    setMode(m);
    setSingleNeg(
      m === "single" && Math.abs(parseFloat(component?.high) || 0) < 1e-12,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeKey, activeRange?.id]);

  useEffect(() => {
    setHighValue(componentLimitMagnitude(component, "high", typeKey));
    setLowValue(componentLimitMagnitude(component, "low", typeKey));
    setFullScale(toPlainNumber(component.value ?? activeRange?.max ?? ""));
  }, [typeKey, component.high, component.low, component.value, activeRange?.max]);

  const termMode = typeKey === "reading" ? "symmetric" : mode;
  const currentShape = toleranceShapeOption(termMode);
  // The single-sided magnitude input binds to whichever side is non-zero.
  const singleValue = singleNeg ? lowValue : highValue;
  const setSingleValue = singleNeg ? setLowValue : setHighValue;

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
    // Symmetric (reading, or any term in ± mode): one magnitude mirrored to
    // both limits. reading also mirrors into `value`; %FS keeps its FS reference.
    if (termMode === "symmetric") {
      const magnitude = trimmed === "" || Number.isNaN(parsed) ? "" : String(Math.abs(parsed));
      const patch = {
        high: magnitude,
        low: magnitude === "" ? "" : String(-Math.abs(parsed)),
        symmetric: true,
      };
      if (typeKey === "reading") patch.value = magnitude;
      commit(patch);
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
  // Single-sided commit: magnitude on the chosen side, 0 on the other. A blank
  // value clears the term (so it prunes out like any other empty term).
  const commitSingleValue = (raw, neg = singleNeg) => {
    const trimmed = String(raw ?? "").trim();
    const parsed = parseFloat(trimmed);
    if (trimmed === "" || Number.isNaN(parsed)) {
      commit({ high: "", low: "", symmetric: false });
      return;
    }
    const mag = String(Math.abs(parsed));
    commit(
      neg
        ? { high: "0", low: String(-Math.abs(parsed)), symmetric: false }
        : { high: mag, low: "0", symmetric: false },
    );
  };
  // Switch a term's shape (symmetric / single-sided / asymmetric), carrying the
  // current magnitude across so the value isn't lost, and re-shaping the limits.
  const changeMode = (nextMode) => {
    setShapeMenuRect(null);
    if (nextMode === termMode) return;
    const curMag = termMode === "single" ? singleValue : highValue;
    const parsed = parseFloat(curMag);
    const mag = curMag === "" || Number.isNaN(parsed) ? "" : String(Math.abs(parsed));
    setMode(nextMode);
    setSingleNeg(false);
    if (nextMode === "symmetric") {
      setHighValue(mag);
      setLowValue(mag);
      commit({ high: mag, low: mag === "" ? "" : String(-Math.abs(parsed)), symmetric: true });
    } else if (nextMode === "single") {
      setHighValue(mag);
      setLowValue("0");
      if (mag !== "") commit({ high: mag, low: "0", symmetric: false });
    } else {
      // asymmetric: seed the low input from the current magnitude when empty.
      setHighValue(mag);
      if (lowValue === "" || lowValue === "0") setLowValue(mag);
    }
  };
  const toggleShapeMenu = () => {
    if (shapeMenuRect) {
      setShapeMenuRect(null);
      return;
    }
    const rect = shapeButtonRef.current?.getBoundingClientRect();
    if (rect) setShapeMenuRect(rect);
  };
  // Flip a single-sided term between + (high) and − (low) direction, keeping the
  // magnitude and pinning the other limit to 0.
  const toggleSingleDir = () => {
    const mag = singleValue;
    const nextNeg = !singleNeg;
    setSingleNeg(nextNeg);
    if (nextNeg) {
      setLowValue(mag);
      setHighValue("0");
    } else {
      setHighValue(mag);
      setLowValue("0");
    }
    commitSingleValue(mag, nextNeg);
  };
  const typeLabel = componentUnitLabel(typeKey, component, activeRange);
  const typeOption = TOLERANCE_TYPE_OPTIONS.find((opt) => opt.key === typeKey);
  const shapeMenu =
    typeKey !== "reading" && shapeMenuRect
      ? ReactDOM.createPortal(
          <>
            <div
              className="inline-tolerance-shape-backdrop"
              onMouseDown={() => setShapeMenuRect(null)}
            />
            <div
              className="inline-tolerance-shape-menu"
              style={{
                top: `${Math.min(shapeMenuRect.bottom + 6, window.innerHeight - 132)}px`,
                left: `${Math.max(
                  8,
                  Math.min(shapeMenuRect.right - 172, window.innerWidth - 180),
                )}px`,
              }}
              onMouseDown={(e) => e.preventDefault()}
              role="menu"
            >
              {TOLERANCE_SHAPE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`inline-tolerance-shape-option${
                    option.key === termMode ? " is-active" : ""
                  }`}
                  onClick={() => changeMode(option.key)}
                  role="menuitemradio"
                  aria-checked={option.key === termMode}
                >
                  <span className="inline-tolerance-shape-option-copy">
                    <span>{option.label}</span>
                    <small>{option.detail}</small>
                  </span>
                </button>
              ))}
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <span className="inline-tolerance-term">
      <span className="inline-tolerance-limits">
        {termMode === "symmetric" && (
          <>
            {showHighSign && <span className="inline-tolerance-symbol">±</span>}
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
          </>
        )}
        {termMode === "single" && (
          <>
            {showHighSign && <span className="inline-tolerance-symbol">+</span>}
            {singleNeg ? (
              <span className="inline-tolerance-zero" title="Upper limit is 0">
                0
              </span>
            ) : (
              <input
                type="text"
                inputMode="decimal"
                value={singleValue}
                placeholder="0"
                onChange={(e) => setSingleValue(e.target.value)}
                onBlur={(e) => commitSingleValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className="inline-tolerance-input"
                style={toleranceInputStyleFor(singleValue)}
              />
            )}
            <span className="inline-tolerance-symbol">-</span>
            {singleNeg ? (
              <input
                type="text"
                inputMode="decimal"
                value={singleValue}
                placeholder="0"
                onChange={(e) => setSingleValue(e.target.value)}
                onBlur={(e) => commitSingleValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className="inline-tolerance-input"
                style={toleranceInputStyleFor(singleValue)}
              />
            ) : (
              <span className="inline-tolerance-zero" title="Lower limit is 0">
                0
              </span>
            )}
            <button
              type="button"
              className="inline-tolerance-dir-toggle"
              title="Swap which side the limit applies to (the other stays 0)"
              aria-label="Swap single-sided direction"
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleSingleDir}
            >
              ⇄
            </button>
          </>
        )}
        {termMode === "asymmetric" && (
          <>
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
        {typeKey !== "reading" && (
          <>
            <button
              ref={shapeButtonRef}
              type="button"
              className={`inline-tolerance-shape-button${
                shapeMenuRect ? " is-open" : ""
              }`}
              title={`Tolerance shape: ${currentShape.label}`}
              aria-haspopup="menu"
              aria-expanded={Boolean(shapeMenuRect)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleShapeMenu}
            >
              <span>{currentShape.symbol}</span>
              <FontAwesomeIcon icon={faChevronDown} size="xs" />
            </button>
            {shapeMenu}
          </>
        )}
      </span>
      {typeLabel && (
        <span
          className="inline-tolerance-chip inline-tolerance-chip--in-cell"
          title={typeOption?.label || typeLabel}
        >
          {typeLabel}
        </span>
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

// Two-view tolerance / error-limit cell.
//   • Read view (default): a compact, clean "±(n %IV + n %FS + n lb)" summary —
//     only terms that actually carry a value are shown, so the column stays
//     easy to scan when nobody is editing.
//   • Edit view (on click): EVERY tolerance type is shown with blank fields. The
//     user fills in only the terms that apply; blank terms are dropped by the
//     commit itself (see setRangeToleranceComponent) so they're excluded from
//     both the summary and the math.
//
// Closing is driven by focus leaving the cell (onBlur / focusout), NOT a
// document mousedown listener: a mousedown close would unmount the inputs
// before their onBlur fires, silently dropping the value the user just typed.
// With focusout the focused input commits first, then the cell closes. The
// first field is auto-focused on open so there is always something to blur.
const InlineToleranceCell = ({
  tolerance = {},
  activeRange = {},
  editable,
  onCommit,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const containerRef = useRef(null);

  // Put focus in the first field when the editor opens so a later click-away
  // reliably produces a focusout (and commits the in-progress value).
  useEffect(() => {
    if (!isEditing || !containerRef.current) return;
    const firstInput = containerRef.current.querySelector("input");
    firstInput?.focus();
  }, [isEditing]);

  const summary = getSpecRows(tolerance)[0] || "-";

  // Read-only surfaces (no save handler) just render the clean summary.
  if (!editable) {
    return <>{summary}</>;
  }

  if (!isEditing) {
    const hasValue = toleranceHasAnyValue(tolerance);
    const openEditor = (e) => {
      e.stopPropagation();
      setIsEditing(true);
    };
    return (
      <span className="inline-tolerance-readview">
        <button
          type="button"
          className={`inline-tolerance-summary${hasValue ? "" : " is-empty"}`}
          title={hasValue ? "Click to edit tolerance" : "Click to set a tolerance"}
          onClick={openEditor}
        >
          {hasValue ? summary : "Set tolerance…"}
        </button>
        {/* Same hover-revealed affordance as the range column's expander, so
            the two columns advertise their editability the same way. */}
        <button
          type="button"
          className="range-expand-btn"
          title="Edit or add tolerance terms"
          aria-label="Edit or add tolerance terms"
          onClick={openEditor}
        >
          <FontAwesomeIcon icon={faChevronDown} size="xs" />
          <span className="range-expand-btn-label">edit / add</span>
        </button>
      </span>
    );
  }

  // Close only when focus moves OUTSIDE the cell. The blurred input's own onBlur
  // (commit) fires first as part of the same focus change, so the value is saved
  // before this re-render unmounts the inputs.
  const handleBlur = (event) => {
    const next = event.relatedTarget;
    if (next && containerRef.current && containerRef.current.contains(next)) {
      return;
    }
    setIsEditing(false);
  };

  return (
    <div
      ref={containerRef}
      className="inline-tolerance-editor inline-tolerance-editor--all"
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={handleBlur}
    >
      {TOLERANCE_TYPE_OPTIONS.map((opt) => (
        <span
          key={opt.key}
          className="inline-tolerance-term-group"
        >
          <ToleranceTermEditor
            tolerance={tolerance}
            activeRange={activeRange}
            typeKey={opt.key}
            showHighSign
            onCommit={onCommit}
          />
        </span>
      ))}
    </div>
  );
};

// Clean read-view label for a range: "−100 to 100 V", "30 kg" (single value),
// or a "Set range…" affordance when the range has no bounds yet.
const formatRangeSummary = (range = {}) => {
  if (range.isSingleValue) {
    const v = range.value ?? range.max ?? range.min ?? "";
    if (v === "") return "";
    const unitLabel = getUnitDisplayLabel(range.unit || "");
    return unitLabel ? `${v} ${unitLabel}` : String(v);
  }
  const hasBounds =
    range.min !== undefined &&
    range.min !== null &&
    range.min !== "" &&
    range.max !== undefined &&
    range.max !== null &&
    range.max !== "";
  if (!hasBounds && !(typeof range.range === "string" && range.range.trim())) {
    return "";
  }
  return formatRangeLabel(range, { preferBounds: true });
};

// Two-view range cell, mirroring InlineToleranceCell:
//   • Read view (default): the clean formatted range string (plus the range
//     switcher when the instrument has several ranges) — no input boxes.
//   • Edit view (on click): the min/max/unit editor.
// Closing is focus-driven (focusout), with one extra wrinkle: UnitSelect's
// dropdown is PORTALED to document.body, so focus moving into it looks like
// focus leaving the cell. Both the focusout handler and a document-click
// fallback therefore treat .inline-unit-menu as "still inside the editor".
// The click fallback also covers the portal case where focus never returns to
// the cell (picking a unit unmounts the focused search box), which would
// otherwise leave the editor open with no focusout to close it.
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
  const [isEditing, setIsEditing] = useState(false);
  const containerRef = useRef(null);

  // Focus the first field on open so a click-away always produces a focusout
  // (which commits the in-progress value before the editor closes).
  useEffect(() => {
    if (!isEditing || !containerRef.current) return;
    const firstInput = containerRef.current.querySelector("input");
    firstInput?.focus();
  }, [isEditing]);

  // Document-click fallback close (see component comment). Registered only
  // while editing; `click` (not mousedown) so the blurred input's commit runs
  // first as part of the same interaction.
  useEffect(() => {
    if (!isEditing) return undefined;
    const onDocClick = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (containerRef.current?.contains(target)) return;
      if (target.closest(".inline-unit-menu")) return;
      setIsEditing(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [isEditing]);

  // The in-cell range-selector dropdown was removed: when an instrument has
  // several ranges the "edit / add" expander already lists them all (and lets
  // the user pick the active one), so a second switcher here was redundant. The
  // editable read/edit views now snap to the clean active-range string only.
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

  if (!isEditing) {
    const summary = formatRangeSummary(activeRange);
    return (
      <div className="inline-range-editor" onMouseDown={(e) => e.stopPropagation()}>
        <div className="inline-range-main">
          <button
            type="button"
            className={`inline-tolerance-summary${summary ? "" : " is-empty"}`}
            title={summary ? "Click to edit range" : "Click to set a range"}
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
          >
            {summary || "Set range…"}
          </button>
        </div>
      </div>
    );
  }

  // Close only when focus moves OUTSIDE the cell (and outside the portaled
  // unit menu). The blurred input's own onBlur commit fires first as part of
  // the same focus change, so the value is saved before the inputs unmount.
  const handleBlur = (event) => {
    const next = event.relatedTarget;
    if (next instanceof Element) {
      if (containerRef.current?.contains(next)) return;
      if (next.closest(".inline-unit-menu")) return;
    }
    setIsEditing(false);
  };

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
    <div
      ref={containerRef}
      className="inline-range-editor"
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={handleBlur}
    >
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
          width="72px"
        />
      </div>
    </div>
  );
};

// The perpetual blank "add" row at the bottom of an expanded range list.
//
// It BUFFERS min/max/unit in local state (controlled inputs) and only creates a
// real range once — when focus leaves the row (blur to outside) or Enter is
// pressed. This is deliberate: an earlier version materialized on the first
// bound, which split the row you were typing in from the new (floated) range,
// duplicated the value, and broke Tab. Buffering keeps Tab flowing min→max in
// one stable row, creates exactly one range, and leaves the inputs clean for the
// next add. `onMaterialize({ min, max, unit })` does the actual insert.
export const GhostRangeRow = ({
  unit = "",
  includeDistribution = false,
  dataGroup,
  onMaterialize,
}) => {
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  // A brand-new range can be created directly as a single value (e.g. a 30 kg
  // mass) instead of a min–max span — the same "•"/"↔" toggle the real range
  // rows carry, so the very first range added has the affordance too.
  const [isSingle, setIsSingle] = useState(false);
  const [value, setValue] = useState("");
  const rowRef = useRef(null);

  const commit = () => {
    if (isSingle) {
      if (value === "") return; // nothing entered → stay a ghost
      onMaterialize({ isSingleValue: true, value, unit });
      setValue("");
      return;
    }
    if (min === "" && max === "") return; // nothing entered → stay a ghost
    // New ranges inherit the active range's unit (shown as the static label
    // below); it can be changed on the created row if needed. Keeping the unit
    // out of the ghost's tab order means Tab flows min → max → commit.
    onMaterialize({ min, max, unit });
    setMin("");
    setMax("");
  };
  const handleBlur = (event) => {
    // Only materialize when focus truly leaves the row (not on min→max tab, and
    // not when clicking the mode toggle inside the same row).
    if (rowRef.current && rowRef.current.contains(event.relatedTarget)) return;
    commit();
  };

  return (
    <tr
      ref={rowRef}
      className="inline-range-row inline-range-row--ghost inline-range-row--last"
      data-range-group={dataGroup}
      onBlur={handleBlur}
    >
      <td className="cell-value">
        <div className="range-row-cell range-row-cell--ghost">
          <div className="inline-range-editor" onMouseDown={(e) => e.stopPropagation()}>
            <div className="inline-range-main">
              <button
                type="button"
                className="inline-range-mode-toggle"
                title={isSingle ? "Switch to a min–max range" : "Switch to a single value"}
                aria-label={isSingle ? "Switch to a min–max range" : "Switch to a single value"}
                onClick={() => setIsSingle((s) => !s)}
              >
                {isSingle ? "↔" : "•"}
              </button>
              {isSingle ? (
                <input
                  type="text"
                  inputMode="decimal"
                  value={value}
                  placeholder="+ value"
                  aria-label="New single value"
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className="inline-tolerance-input inline-range-bound-input"
                />
              ) : (
                <>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={min}
                    placeholder="+ min"
                    aria-label="New range minimum"
                    onChange={(e) => setMin(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    className="inline-tolerance-input inline-range-bound-input"
                  />
                  <span style={{ color: "var(--text-color-muted)" }}>–</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={max}
                    placeholder="max"
                    aria-label="New range maximum"
                    onChange={(e) => setMax(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    className="inline-tolerance-input inline-range-bound-input"
                  />
                </>
              )}
              {unit ? (
                <span className="inline-range-ghost-unit" title="New range unit (inherited)">
                  {getUnitDisplayLabel(unit)}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </td>
      <td className="cell-tolerance">
        <span className="range-ghost-hint">—</span>
      </td>
      {includeDistribution && (
        <td className="cell-distribution">
          <span className="range-ghost-hint">—</span>
        </td>
      )}
      <td className="cell-value">
        <span className="range-ghost-hint">—</span>
      </td>
    </tr>
  );
};

const getVisibleRangeRows = (ranges = [], activeIndex = 0, activeRange = {}, showAll = false) => {
  if (showAll && ranges.length > 0) {
    // Expanded "view all ranges" is an editing surface, so rows stay in STABLE
    // stored order — no sorting or floating. Reordering while the user edits (an
    // earlier version floated "incomplete" rows to the top) yanks the row out
    // from under them and remounts its uncontrolled inputs mid-edit. New ranges
    // are appended, so they naturally appear at the bottom next to the ghost row.
    return ranges.map((range, index) => ({
      range,
      index,
      key: range?.id || `${index}`,
    }));
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
// rendered on a single line as e.g. "±(2% IV + 0.1% FS + 0.5 V)" rather than
// stacked rows (which waste vertical space and imply the terms are separate or
// apply to different ranges). "IV" = indicated value, "FS" = full scale; the
// absolute Floor term carries just its unit. EVERY present component is always
// shown — an asymmetric term keeps its own "+high/low" signs inline so it can
// share the one line instead of being split off (and dropped) into extra rows.
// Returns a single-element array of lines; callers render line [0]. (A spec that
// stores explicit sub-tolerances still expands to one line per sub-tolerance.)
export const getSpecRows = (tolerance) => {
  if (!tolerance) return ["-"];

  // Explicit sub-components (recursion): one combined line per sub-tolerance.
  if (Array.isArray(tolerance.tolerances) && tolerance.tolerances.length > 0) {
    const rows = [];
    tolerance.tolerances.forEach((t) => rows.push(...getSpecRows(t)));
    return rows;
  }

  // Components in display order, each with its abbreviation tag. Floor carries
  // no tag (it's a bare absolute value); dB's unit is shown inline.
  // `readings_iv` is a legacy alias of `floor` (the same absolute Floor Value),
  // never authored separately by the UI. It's read as a fallback for `floor`
  // below — NOT listed as its own term — so a spec carrying both isn't shown (or
  // summed) as two floor values.
  const componentConfig = [
    { key: "reading", tag: "IV" },
    { key: "range", tag: "FS" },
    { key: "floor", tag: "" },
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

  // unit + tag suffix shared by every term (e.g. "% IV", " V", " dB").
  const tagSuffix = (comp, tag) => {
    const unitLabel = getUnitDisplayLabel(comp.unit || "");
    // No space before "%"; a space before any worded/physical unit.
    const join = unitLabel === "%" || unitLabel === "" ? "" : " ";
    const unitPart = `${join}${unitLabel}`;
    return tag ? `${unitPart} ${tag}` : unitPart;
  };
  // A single term's body. Symmetric terms drop the sign when the whole spec is
  // symmetric (a leading ± is added once); otherwise they show their own ±, and
  // asymmetric terms show "+high/low".
  const termText = (comp, tag, { withSign }) => {
    const suffix = tagSuffix(comp, tag);
    if (comp.symmetric) {
      const sign = withSign ? "±" : "";
      return `${sign}${comp.mag}${suffix}`.trim();
    }
    // Asymmetric term: keep both signs. Parenthesize when sharing a line with
    // other signed terms so the "+high/low" reads cleanly (no stray "+ +").
    const body = `+${comp.high}/${comp.low}`;
    return `${withSign ? `(${body})` : body}${suffix}`.trim();
  };

  const present = [];
  let anyAsymmetric = false;
  for (const cfg of componentConfig) {
    // Floor folds in its legacy readings_iv alias (value-aware, so a blank floor
    // doesn't hide a real readings_iv).
    const source =
      cfg.key === "floor" ? effectiveFloorTerm(tolerance) : tolerance[cfg.key];
    const comp = parseComp(source, cfg.unit);
    if (!comp) continue;
    present.push({ comp, cfg });
    if (!comp.symmetric) anyAsymmetric = true;
  }

  if (present.length === 0) return [getToleranceSummary(tolerance)];

  // All symmetric: factor the ± out front — "± 2% IV" or "±(2% IV + 1% FS)".
  if (!anyAsymmetric) {
    if (present.length === 1) {
      return [`± ${termText(present[0].comp, present[0].cfg.tag, { withSign: false })}`];
    }
    const inner = present
      .map((p) => termText(p.comp, p.cfg.tag, { withSign: false }))
      .join(" + ");
    return [`±(${inner})`];
  }

  // Mixed/asymmetric: every term carries its own sign so they still share ONE
  // line (no component is dropped). e.g. "±2% IV + +1/-0.5% FS".
  const inner = present
    .map((p) => termText(p.comp, p.cfg.tag, { withSign: true }))
    .join(" + ");
  return [inner];
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

// The measuring-resolution detail for a point's UUT tolerance, used to offer
// "UUT Resolution" in the budget add menu (the resolution is included in the
// budget by adding it there, not via a per-spec checkbox). Mirrors how
// getUutResolutionComponent reads the resolution value/unit. Returns null when
// the UUT has no usable resolution.
const getPointResolutionDetail = (uutTolerance = {}) => {
  let tol = uutTolerance;
  if (Array.isArray(tol)) tol = tol[0];
  if (!tol || typeof tol !== "object") return null;
  const nested =
    tol.tolerances && typeof tol.tolerances === "object" ? tol.tolerances : {};
  const resVal = parseFloat(
    tol.measuringResolution ?? tol.resolution ?? nested.measuringResolution,
  );
  if (!Number.isFinite(resVal) || resVal <= 0) return null;
  const unit =
    tol.measuringResolutionUnit ||
    tol.resolutionUnit ||
    nested.measuringResolutionUnit ||
    tol.unit ||
    "";
  const included = !!(
    tol.includeResolutionInBudget ?? nested.includeResolutionInBudget
  );
  return { value: resVal, unit, included };
};

// The measuring-resolution detail for a TMDE INSTANCE on a point, so its
// resolution can be offered in the budget add menu the same way the UUT's is.
// A TMDE instance carries its range specs at the top level plus a `.tolerance`
// snapshot (see handleAssignTmdeToInput), so read both. Returns null when the
// TMDE has no usable resolution. `included` reflects whether it has already been
// opted into this point's budget.
const getTmdeResolutionDetail = (tmde = {}) => {
  if (!tmde || typeof tmde !== "object") return null;
  const nested =
    tmde.tolerance && typeof tmde.tolerance === "object" ? tmde.tolerance : {};
  const resVal = parseFloat(
    tmde.measuringResolution ??
      tmde.resolution ??
      nested.measuringResolution ??
      nested.resolution,
  );
  if (!Number.isFinite(resVal) || resVal <= 0) return null;
  const unit =
    tmde.measuringResolutionUnit ||
    tmde.resolutionUnit ||
    nested.measuringResolutionUnit ||
    nested.resolutionUnit ||
    tmde.unit ||
    nested.unit ||
    "";
  const included = !!(
    tmde.includeResolutionInBudget ?? nested.includeResolutionInBudget
  );
  return { value: resVal, unit, included };
};

// --- SHARED HELPER: Resolve UUT Range ---
export const resolveUutRangeHelper = (
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
      (r) => functionPartsMatch(r.functionName, r.functionUnit || r.unit, functionKey),
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
const buildFunctionGroupedRows = (
  groupedItems,
  sessionData,
  kind = null,
  { includeEmptyGroups = true, onlyFunctionKey = null, fallbackItemIds = [] } = {},
) => {
  const sessionFunctions = resolveSessionFunctions(sessionData, { kind });
  const fnByKey = new Map(sessionFunctions.map((fn) => [fn.key, fn]));
  const fnOrder = new Map(sessionFunctions.map((fn, index) => [fn.key, index]));
  const groups = new Map();
  const fallbackSet = new Set((fallbackItemIds || []).map(String));

  groupedItems.forEach((row) => {
    const declared = instrumentFunctions(row.item);
    const seenFnKeys = new Set();
    let fnList = (
      declared.length
        ? declared
        : [{ key: makeFunctionKey("Measurement", ""), name: "Measurement", unit: "" }]
    ).filter((fn) => {
      if (seenFnKeys.has(fn.key)) return false;
      seenFnKeys.add(fn.key);
      return true;
    });
    if (onlyFunctionKey) {
      const matchingKey = matchingInstrumentFunctionKey(row.item, onlyFunctionKey);
      fnList = fnList.filter((fn) => fn.key === matchingKey || fn.key === onlyFunctionKey);
      if (fnList.length === 0 && fallbackSet.has(String(row.item?.id))) {
        const resolved = fnByKey.get(onlyFunctionKey);
        fnList = [
          resolved || {
            key: onlyFunctionKey,
            name: functionNamePart(onlyFunctionKey) || "Measurement",
            unit: functionUnitPart(onlyFunctionKey),
            ranges: [],
          },
        ];
      }
    }
    if (fnList.length === 0) return;
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

  if (includeEmptyGroups) {
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
  }

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

const functionNamePart = (functionKey = "") =>
  String(functionKey || "").split("|")[0] || "";

const functionUnitPart = (functionKey = "") =>
  String(functionKey || "").split("|")[1] || "";

const functionUnitsMatch = (selectedUnit, candidateUnit) => {
  if (!selectedUnit) return true;
  if (!candidateUnit) return true;
  return normalizeUnitToken(selectedUnit) === normalizeUnitToken(candidateUnit);
};

const functionPartsMatch = (candidateName, candidateUnit, functionKey = null) => {
  if (!functionKey) return true;
  const selectedName = functionNamePart(functionKey);
  const selectedUnit = functionUnitPart(functionKey);
  const candidateKey = makeFunctionKey(candidateName, candidateUnit);
  if (candidateKey === functionKey) return true;
  if (!selectedName || functionNamePart(candidateKey) !== selectedName) return false;
  return functionUnitsMatch(selectedUnit, functionUnitPart(candidateKey));
};

const matchingInstrumentFunctionKey = (source = {}, functionKey = null) => {
  if (!functionKey) return null;
  const selectedName = functionNamePart(functionKey);
  const selectedUnit = functionUnitPart(functionKey);
  const functions = instrumentFunctions(source);
  const exact = functions.find((fn) => fn.key === functionKey);
  if (exact) return exact.key;

  if (!selectedName) return null;
  const nameMatch = functions.find((fn) => {
    const candidateName = functionNamePart(fn.key);
    if (candidateName !== selectedName) return false;
    return functionUnitsMatch(selectedUnit, functionUnitPart(fn.key));
  });
  return nameMatch?.key || null;
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
  onInstrumentSynced,
  setNotification,
}) => {
  const [localLibraryChoices, setLocalLibraryChoices] = useState({});
  // Add Function picker: null | "uut" | "tmde" (which table's button opened it).
  const [addFunctionMenu, setAddFunctionMenu] = useState(null);
  const [newFunctionDraft, setNewFunctionDraft] = useState({ name: "", unit: "" });
  const { syncToShared, getDiff } = useInstrumentSync(onInstrumentSynced);

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
          ? {
              ...u,
              description: value,
              // Mirror the name onto the instrument's description so it's part of
              // the SHARED spec: renaming now diverges from the validated library
              // (sync badge goes red), and once synced the new name re-imports
              // when the instrument is added again — instead of the old name.
              instrument: { ...(u.instrument || {}), description: value },
            }
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
          ? {
              ...t,
              name: value,
              // Mirror onto the instrument's description so the name is part of
              // the SHARED spec (sync diverges, re-import uses the new name).
              instrument: { ...(t.instrument || {}), description: value },
            }
          : { ...t, instrument: applyDescriptionPatch(t, field, value) };
      return updatedItem;
    });
    // Propagate the master edit into every point's TMDE instance snapshot (parity
    // with handleDetailTmdeDescEdit / persistInlineItem), so an assigned TMDE's
    // name/spec updates wherever it's used — including the measurement-equation
    // variable field — instead of showing the stale pre-rename value.
    const nextTestPoints = updatedItem
      ? refreshSessionPointsForTmde(updatedItem)
      : sessionData.testPoints;
    onSessionSave({ ...sessionData, tmdes: updatedTmdes, testPoints: nextTestPoints });
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

  const instrumentDefFromLibrary = (existing, inst, { track = false, localCopy = false } = {}) => {
    const pickedLocalId = inst.scope === "local" ? inst.id : null;
    const sourceId = inst.sourceId || (inst.scope === "validated" ? inst.id : undefined);
    const shouldTrack = track || Boolean(sourceId);
    return {
      ...(existing || {}),
      id: pickedLocalId || existing?.id || uuidv4(),
      manufacturer: inst.manufacturer || "",
      model: inst.model || "",
      description: inst.description || "",
      functions: inst.functions || [],
      libraryInstrumentId: shouldTrack ? inst.id : pickedLocalId || undefined,
      scope: shouldTrack ? (localCopy ? "local" : inst.scope) : "local",
      sourceId: shouldTrack ? sourceId : undefined,
      validatedSnapshot:
        shouldTrack && (inst.scope === "validated" || localCopy)
          ? buildValidatedSnapshot(inst)
          : shouldTrack
            ? existing?.validatedSnapshot || inst.validatedSnapshot || null
            : null,
    };
  };

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

  const setRangeToleranceComponent = (kind, item, activeRange, typeKey, component) => {
    if (!onSessionSave) return;
    const cur = getItemRangeTolerance(item, activeRange?.id) || {};
    // Prune blank terms in the same write so an empty (or just-cleared) term is
    // excluded without a second, racy cleanup pass.
    const next = pruneBlankToleranceTerms({ ...cur, [typeKey]: component });
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
  // The distribution used when this resolution enters the uncertainty budget.
  // Stored on the range as resolutionDistribution and mirrored to
  // measuringResolutionDistribution so the budget component picks it up.
  const setRangeResolutionDistribution = (kind, item, rangeId, value) => {
    if (!onSessionSave) return;
    const updatedItem = applyItemRangePatch(item, rangeId, {
      resolutionDistribution: value,
      measuringResolutionDistribution: value,
    });
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
  // Editing a range bound. Mirrors the tolerance cell's confirm-free model:
  // clearing a range's last numeric bound removes it outright (never the last
  // range). New ranges are created with a value, so they're never blank at
  // creation and won't be pruned mid-entry.
  const handleEditRangeBound = (kind, item, rangeId, field, value) => {
    if (!onSessionSave) return;
    const patched = applyItemRangePatch(item, rangeId, { [field]: value });
    const patchedRange = findItemRange(patched, rangeId);
    if (patchedRange && rangeIsBlank(patchedRange)) {
      const pruned = removeRangeFromItem(patched, rangeId);
      if (pruned !== patched) {
        persistItem(kind, pruned);
        setLocalRangeIndices((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        setTmdeRangeIndices((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        return;
      }
    }
    persistItem(kind, patched);
  };
  const patchRange = (kind, item, rangeId, patch) => {
    if (!onSessionSave) return;
    persistItem(kind, applyItemRangePatch(item, rangeId, patch));
  };
  // Create a range from the ghost add-row once the user has entered bounds and
  // left the row (the ghost buffers until then — see GhostRangeRow). Seeds the
  // tolerance structure from the active range, writes the entered bounds/unit in
  // one transform, and makes it the active range.
  const materializeGhostRange = (
    kind,
    item,
    activeRangeId,
    { min, max, unit, isSingleValue, value },
  ) => {
    if (!onSessionSave) return;
    if (isSingleValue ? value === "" : min === "" && max === "") return;
    const { item: withRange, newRangeId } = addRangeToItem(item, activeRangeId);
    const patch = isSingleValue
      ? { isSingleValue: true, value, min: value, max: value, unit }
      : { min, max, unit };
    const updated = applyItemRangePatch(withRange, newRangeId, patch);
    persistItem(kind, updated);
    const setIdx = kind === "uut" ? setLocalRangeIndices : setTmdeRangeIndices;
    const resolved = resolveUutRangeHelper(updated, {}, null, null).ranges || [];
    const newIdx = newRangeId ? resolved.findIndex((r) => sameId(r.id, newRangeId)) : -1;
    setIdx((prev) => ({ ...prev, [item.id]: newIdx >= 0 ? newIdx : 0 }));
  };
  const handleRemoveRange = (kind, item, rangeId) => {
    if (!onSessionSave) return;
    persistItem(kind, removeRangeFromItem(item, rangeId));
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
    // Sync color across BOTH kinds: a function shared by a TMDE and a UUT keeps a
    // single color so the two surfaces read as one organized group. Update every
    // stored entry matching this function key regardless of kind.
    const existing = Array.isArray(sessionData.functionGroups)
      ? sessionData.functionGroups
      : [];
    let found = false;
    let next = existing.map((fg) => {
      if (makeFunctionKey(fg.name, fg.unit) === fn.key) {
        found = true;
        return { ...fg, color };
      }
      return fg;
    });
    if (!found) {
      next = [
        ...next,
        {
          name: fn.name,
          unit: fn.unit,
          color,
          ...(fn.kind ? { kind: fn.kind } : {}),
        },
      ];
    }
    onSessionSave({ ...sessionData, functionGroups: next });
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
      <span
        className="inline-area-header-input function-header-name"
        contentEditable
        suppressContentEditableWarning
        tabIndex={0}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.currentTarget.textContent = fn.name;
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => handleFunctionRename(fn, e.currentTarget.textContent)}
        title="Edit function name"
        aria-label="Function subsection name"
        role="textbox"
        style={{ color: fn.color }}
      >
        {fn.name}
      </span>
    );
  };

  const renderFunctionUnitChip = (fn) =>
    fn.unit ? (
      <span className="function-header-unit-chip">
        {getUnitDisplayLabel(fn.unit)}
      </span>
    ) : null;

  // Per-subsection (+) — adds an instrument already scoped to this function.
  // Styled to match the column-header range add/delete controls for a cohesive,
  // tidy look across every table.
  const renderFunctionAddButton = (kind, fn) => {
    if (!onSessionSave) return null;
    return (
      <button
        type="button"
        className="range-header-action-btn range-header-action-btn--add function-header-action-btn"
        title={`Add ${kind === "uut" ? "UUT" : "TMDE"} with this function`}
        aria-label={`Add ${kind === "uut" ? "UUT" : "TMDE"} with this function`}
        onClick={(e) => {
          e.stopPropagation();
          handleAddInstrumentToFunction(kind, fn);
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
        className="range-header-action-btn range-header-action-btn--delete function-header-action-btn"
        title="Delete function"
        aria-label="Delete function"
        onClick={(e) => {
          e.stopPropagation();
          handleDeleteFunction(fn);
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
    const available = functionsForLibrary([
      ...(instruments || []),
      ...(sessionData.uuts || []),
      ...(sessionData.tmdes || []),
    ]);
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
            No library or session instrument functions
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
          <UnitSelect
            value={newFunctionDraft.unit}
            ariaLabel="New function unit"
            onChange={(unit) => setNewFunctionDraft((d) => ({ ...d, unit }))}
            width="9ch"
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
  const [expandedRangeKeys, setExpandedRangeKeys] = useState(() => new Set());
  // Click-away collapse: while any range list is expanded, a click that
  // lands outside that instrument's row group (tagged data-range-group) snaps it
  // shut — mirroring the tolerance cell's focus-out close across the multi-<tr>
  // expanded group (which has no single wrapper element to hang an onBlur on).
  useEffect(() => {
    if (expandedRangeKeys.size === 0) return undefined;
    const onDown = (e) => {
      // Clicking a non-focusable area (a plain cell/background) does NOT blur a
      // focused inline editor, so its onBlur commit — new range, tolerance edit,
      // clear-to-delete — would never run before the list collapses. Force the
      // focused editor to blur first so its commit lands.
      const clickedInsideGroup = e.target?.closest?.("[data-range-group]");
      if (!clickedInsideGroup) {
        const ae = document.activeElement;
        if (ae && typeof ae.blur === "function" && ae.closest?.("[data-range-group]")) {
          ae.blur();
        }
      }
      setExpandedRangeKeys((prev) => {
        if (prev.size === 0) return prev;
        let next = null;
        prev.forEach((key) => {
          const inside = e.target?.closest?.(`[data-range-group="${key}"]`);
          if (!inside) {
            if (!next) next = new Set(prev);
            next.delete(key);
          }
        });
        return next || prev;
      });
    };
    // Listen on "click" (fires after mousedown -> blur -> mouseup) so any
    // in-progress editor commits its onBlur BEFORE the list collapses and
    // unmounts it. A mousedown listener would collapse first and swallow the
    // pending commit (lost new range / tolerance / clear-to-delete).
    document.addEventListener("click", onDown);
    return () => document.removeEventListener("click", onDown);
  }, [expandedRangeKeys]);
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
  // mode. Deletion is confirm-free now: clearing a range's bounds prunes it (see
  // handleEditRangeBound) with an Undo toast — no per-row trash button.
  // `kind` is "uut" | "tmde".
  const renderRangeRowCells = (kind, item, range, { includeDistribution } = {}) => {
    const setRangeIdx = kind === "uut" ? setLocalRangeIndices : setTmdeRangeIndices;
    const tableId = kind;
    const tolerance = getItemRangeTolerance(item, range?.id) || range;

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
              allowSingleToggle
              onSelect={(idx) => setRangeIdx((prev) => ({ ...prev, [item.id]: idx }))}
              onEditBound={(field, value) =>
                handleEditRangeBound(kind, item, range?.id, field, value)
              }
              onEditUnit={(value) => setRangeUnit(kind, item, range?.id, value)}
              onPatchRange={(patch) => patchRange(kind, item, range?.id, patch)}
            />
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
            editable
            onCommit={(nextTypeKey, component) =>
              setRangeToleranceComponent(kind, item, range, nextTypeKey, component)
            }
          />
        </td>

        {includeDistribution && (
          <td className="cell-distribution" title="Spec band distribution">
            <InlineDistributionCell
              divisor={getBandDistDivisor(tolerance)}
              onChange={(value) =>
                setRangeBandDistribution(kind, item, range?.id, value)
              }
            />
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
            distribution={range?.resolutionDistribution ?? range?.measuringResolutionDistribution}
            onCommit={(v) => setRangeResolution(kind, item, range?.id, v)}
            onCommitUnit={(value) => setRangeResolutionUnit(kind, item, range?.id, value)}
            onCommitDistribution={(value) =>
              setRangeResolutionDistribution(kind, item, range?.id, value)
            }
          />
        </td>
      </>
    );
  };

  // The buffered "add" row at the bottom of an expanded range list.
  const renderGhostRangeRow = (kind, item, activeRange, { includeDistribution }) => (
    <GhostRangeRow
      key={`ghost-${kind}-${item.id}`}
      unit={activeRange?.unit || ""}
      includeDistribution={includeDistribution}
      dataGroup={itemStateKey(kind, item.id)}
      onMaterialize={(bounds) =>
        materializeGhostRange(kind, item, activeRange?.id ?? null, bounds)
      }
    />
  );

  // The single control that replaces the old +/trash/eye header trio: expands the
  // instrument's range list inline (where ranges are edited, added via the ghost
  // row, and removed by clearing bounds). Click-away collapses it (see the
  // expandedRangeKeys mousedown effect).
  const renderRangeExpandButton = (kind, item, rangeCount) => {
    if (!onSessionSave) return null;
    return (
      <button
        type="button"
        className="range-expand-btn"
        title="Show all ranges — edit, add, or remove"
        aria-label="Show all ranges"
        onClick={(e) => {
          e.stopPropagation();
          toggleShowAllRanges(kind, item.id);
        }}
      >
        <FontAwesomeIcon icon={faChevronDown} size="xs" />
        <span className="range-expand-btn-label">
          {rangeCount > 1 ? `${rangeCount} ranges` : "edit / add"}
        </span>
      </button>
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
      // points of that function and the instruments that declare it. Keep a
      // point-owner fallback for legacy UUTs whose function metadata is missing.
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
      uuts = uuts.filter(
        (u) =>
          matchingInstrumentFunctionKey(u, contextId) ||
          ownerIds.has(String(u.id)),
      );
      tmdes = tmdes.filter((tmde) =>
        matchingInstrumentFunctionKey(tmde, contextId),
      );
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
        const isFunctionView = viewMode === "function" && contextId;
        const functionKey = isFunctionView
          ? matchingInstrumentFunctionKey(item, contextId) || contextId
          : null;
        const row = {
          type: "item",
          item,
          index,
          ...(isFunctionView
            ? {
                functionKey,
                rowKey: `${functionKey}::${item.id}`,
              }
            : {}),
        };
        if (pinnedSet.has(item.id)) {
          pinnedRows.push(row);
        } else {
          groupedItems.push(row);
        }
      });

      if (viewMode === "function" && contextId) {
        return [...pinnedRows, ...groupedItems];
      }

      if (!showAreaColumn) {
        return [...pinnedRows, ...groupedItems];
      }

      return [...pinnedRows, ...buildFunctionGroupedRows(groupedItems, sessionData, kind)];
    },
    [contextId, sessionData, showAreaColumn, viewMode],
  );

  // --- HANDLERS ---

  // Selection Handlers (Wrapped)
  // Selection Handlers (Wrapped)
  const handleUutClick = (e, id) => {
    handleRowSelection(e, id, setSelectedUutIds);
  };
  const handleTmdeClick = (e, id) => {
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
  // Instant, confirm-free range deletion — the discoverable counterpart to
  // clear-to-delete, used by the context menu.
  const deleteRange = (kind, item, rangeId) => {
    if (!onSessionSave) return;
    const pruned = removeRangeFromItem(item, rangeId);
    if (pruned === item) return; // last-range guard: nothing removed
    handleRemoveRange(kind, item, rangeId);
  };
  const openRangeRowMenu = (e, kind, item, range, index, totalRanges) => {
    if (!onSessionSave) return;
    e.preventDefault();
    e.stopPropagation();
    activateRangeRow(kind, item.id, index);
    const canPaste = !!rangeClipboard && rangeClipboard.kind === kind;
    const canDelete = totalRanges > 1;
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
        action: () => deleteRange(kind, item, range?.id),
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
            <span>Units Under Test</span>
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
                  </span>
                </th>
                <th>Tolerance</th>
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
                          <div className="function-header-row">
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
                    const spanRows = n + 1; // +1 for the trailing ghost add-row
                    const activeRangeIndex = localRangeIndices[uutRowKey] ?? activeIndex;
                    return (
                      <React.Fragment key={uutRowKey}>
                        {visibleRangeRows.map(({ range, index, key }, i) => {
                          const isActiveRange = index === activeRangeIndex;
                          return (
                            <tr
                              key={key}
                              data-range-group={itemStateKey("uut", uut.id)}
                              className={`inline-range-row${i === 0 ? " inline-range-row--first" : ""}${isSelected ? " instrument-selected" : ""}${isActiveRange ? " is-active-range" : ""} ${hoveredRowId === uut.id ? "row-hovered" : ""}`}
                              onMouseEnter={() => setHoveredRowId(uut.id)}
                              onContextMenu={(e) => openRangeRowMenu(e, "uut", uut, range, index, n)}
                              onMouseDownCapture={() => activateRangeRow("uut", uutRowKey, index)}
                              style={{ cursor: "pointer" }}
                            >
                              {i === 0 && (
                                <td
                                  rowSpan={spanRows}
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
                                    functionKey={uutFnKey}
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
                              })}
                              {i === 0 && (
                                <td
                                  rowSpan={spanRows}
                                  className="cell-sync"
                                  style={{ textAlign: "center" }}
                                >
                                  <SyncBadge item={uut} onSync={() => handleSyncItem("uut", uut)} />
                                </td>
                              )}
                            </tr>
                          );
                        })}
                        {renderGhostRangeRow("uut", uut, activeRange, {
                          includeDistribution: false,
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
                              functionKey={uutFnKey}
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
                          <div className="range-collapsed-cell">
                            {visibleRangeRows.map(({ range, index, key }) => (
                              <div className="range-stack-row" key={key}>
                                <RangeCell
                                  ranges={showAllRanges ? [range] : ranges}
                                  activeIndex={showAllRanges ? 0 : activeIndex}
                                  activeRange={range}
                                  editable={!!onSessionSave}
                                  allowSingleToggle
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
                            {renderRangeExpandButton("uut", uut, ranges.length)}
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
                              return (
                                <div className="range-stack-row" key={key}>
                                  {onSessionSave ? (
                                    <InlineToleranceCell
                                      tolerance={tolerance}
                                      activeRange={range}
                                      editable={!!onSessionSave}
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
                                    distribution={range?.resolutionDistribution ?? range?.measuringResolutionDistribution}
                                    onCommit={(v) =>
                                      setRangeResolution("uut", uut, range?.id, v)
                                    }
                                    onCommitUnit={(value) =>
                                      setRangeResolutionUnit("uut", uut, range?.id, value)
                                    }
                                    onCommitDistribution={(value) =>
                                      setRangeResolutionDistribution("uut", uut, range?.id, value)
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
            <span>Test Measurement Device Equipment</span>
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
                  </span>
                </th>
                <th>Error Limit</th>
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
                          <div className="function-header-row">
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
                    const spanRows = n + 1; // +1 for the trailing ghost add-row
                    const activeRangeIndex = tmdeRangeIndices[tmdeRowKey] ?? activeIndex;
                    return (
                      <React.Fragment key={tmdeRowKey || idx}>
                        {visibleRangeRows.map(({ range, index, key }, i) => {
                          const isActiveRange = index === activeRangeIndex;
                          return (
                            <tr
                              key={key}
                              data-range-group={itemStateKey("tmde", tmde.id)}
                              className={`inline-range-row${i === 0 ? " inline-range-row--first" : ""}${isSelected ? " instrument-selected" : ""}${isActiveRange ? " is-active-range" : ""} ${hoveredRowId === tmde.id ? "row-hovered" : ""}`}
                              onMouseEnter={() => setHoveredRowId(tmde.id)}
                              onContextMenu={(e) => openRangeRowMenu(e, "tmde", tmde, range, index, n)}
                              onMouseDownCapture={() => activateRangeRow("tmde", tmdeRowKey, index)}
                              style={{ cursor: "pointer" }}
                            >
                              {i === 0 && (
                                <td
                                  rowSpan={spanRows}
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
                                    functionKey={tmdeFnKey}
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
                              })}
                              {i === 0 && (
                                <td
                                  rowSpan={spanRows}
                                  className="cell-sync"
                                  style={{ textAlign: "center" }}
                                >
                                  <SyncBadge item={tmde} onSync={() => handleSyncItem("tmde", tmde)} />
                                </td>
                              )}
                            </tr>
                          );
                        })}
                        {renderGhostRangeRow("tmde", tmde, activeRange, {
                          includeDistribution: true,
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
                              functionKey={tmdeFnKey}
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
                          <div className="range-collapsed-cell">
                            {visibleRangeRows.map(({ range, key }) => (
                              <div className="range-stack-row" key={key}>
                                <RangeCell
                                  ranges={showAllRanges ? [range] : ranges}
                                  activeIndex={showAllRanges ? 0 : activeIndex}
                                  activeRange={range}
                                  editable={!!onSessionSave}
                                  allowSingleToggle
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
                            {renderRangeExpandButton("tmde", tmde, ranges.length)}
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
                              return (
                                <div className="range-stack-row" key={key}>
                                  {onSessionSave ? (
                                    <InlineToleranceCell
                                      tolerance={tolerance}
                                      activeRange={range}
                                      editable={!!onSessionSave}
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
                                  <InlineDistributionCell
                                    divisor={getBandDistDivisor(tolerance)}
                                    editable={!!onSessionSave}
                                    onChange={(value) =>
                                      setRangeBandDistribution("tmde", tmde, range?.id, value)
                                    }
                                  />
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
                                    distribution={range?.resolutionDistribution ?? range?.measuringResolutionDistribution}
                                    onCommit={(v) =>
                                      setRangeResolution("tmde", tmde, range?.id, v)
                                    }
                                    onCommitUnit={(value) =>
                                      setRangeResolutionUnit("tmde", tmde, range?.id, value)
                                    }
                                    onCommitDistribution={(value) =>
                                      setRangeResolutionDistribution("tmde", tmde, range?.id, value)
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
  onInstrumentSynced,
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
  const [expandedRangeKeys, setExpandedRangeKeys] = useState(() => new Set());

  // --- NEW: Local Selection State ---
  const [selectedUutIds, setSelectedUutIds] = useState([]);
  const [selectedTmdeIds, setSelectedTmdeIds] = useState([]);
  const [equationTmdeSelections, setEquationTmdeSelections] = useState({});
  const [budgetTmdePicker, setBudgetTmdePicker] = useState(null);

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
        action: () => deleteRangeDetail(kind, item, range?.id),
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
  const { syncToShared, getDiff } = useInstrumentSync(onInstrumentSynced);

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
          ? {
              ...u,
              description: value,
              // Mirror onto the instrument's description so the name is part of
              // the SHARED spec (sync diverges, re-import uses the new name).
              instrument: { ...(u.instrument || {}), description: value },
            }
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
          ? {
              ...t,
              name: value,
              // Mirror onto the instrument's description so the name is part of
              // the SHARED spec (sync diverges, re-import uses the new name).
              instrument: { ...(t.instrument || {}), description: value },
            }
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
  const instrumentDefFromLibrary = (existing, inst, { track = false, localCopy = false } = {}) => {
    const pickedLocalId = inst.scope === "local" ? inst.id : null;
    const sourceId = inst.sourceId || (inst.scope === "validated" ? inst.id : undefined);
    const shouldTrack = track || Boolean(sourceId);
    return {
      ...(existing || {}),
      id: pickedLocalId || existing?.id || uuidv4(),
      manufacturer: inst.manufacturer || "",
      model: inst.model || "",
      description: inst.description || "",
      functions: inst.functions || [],
      libraryInstrumentId: shouldTrack ? inst.id : pickedLocalId || undefined,
      scope: shouldTrack ? (localCopy ? "local" : inst.scope) : "local",
      sourceId: shouldTrack ? sourceId : undefined,
      validatedSnapshot:
        shouldTrack && (inst.scope === "validated" || localCopy)
          ? buildValidatedSnapshot(inst)
          : shouldTrack
            ? existing?.validatedSnapshot || inst.validatedSnapshot || null
            : null,
    };
  };
  const libraryLabel = (inst) =>
    inst.description ||
    `${inst.manufacturer || ""} ${inst.model || ""}`.trim() ||
    "Instrument";
  const applyPickedLibraryUut = (uutId, inst, options = {}) => {
    if (!onSessionSave) return;
    // Keep the UUT in its current measurement area instead of relocating it to
    // the library instrument's stored area — a picked library instrument should
    // not silently move the UUT to a different area group. Adopt the library
    // area only if the UUT is currently unassigned.
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
  // Editing a bound: clearing a range's last numeric bound prunes it (never the
  // last range) — see the SummaryDashboard twin.
  const handleEditRangeBoundDetail = (kind, item, rangeId, field, value) => {
    if (!onSessionSave) return;
    const patched = applyItemRangePatch(item, rangeId, { [field]: value });
    const patchedRange = findItemRange(patched, rangeId);
    if (patchedRange && rangeIsBlank(patchedRange)) {
      const pruned = removeRangeFromItem(patched, rangeId);
      if (pruned !== patched) {
        persistInlineItemDetail(kind, pruned);
        setLocalRangeIndices((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        setTmdeRangeIndices((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        return;
      }
    }
    persistInlineItemDetail(kind, patched);
  };
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
  const setRangeResolutionDistributionDetail = (kind, item, rangeId, value) =>
    persistInlineItemDetail(
      kind,
      applyItemRangePatch(item, rangeId, {
        resolutionDistribution: value,
        measuringResolutionDistribution: value,
      }),
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
  const handleRemoveRangeDetail = (kind, item, rangeId) => {
    if (!onSessionSave) return;
    persistInlineItemDetail(kind, removeRangeFromItem(item, rangeId));
    const setIdx = kind === "uut" ? setLocalRangeIndices : setTmdeRangeIndices;
    setIdx((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  };
  // Create a range from the buffered ghost add-row (see SummaryDashboard twin).
  const materializeGhostRangeDetail = (
    kind,
    item,
    activeRangeId,
    { min, max, unit, isSingleValue, value },
  ) => {
    if (!onSessionSave) return;
    if (isSingleValue ? value === "" : min === "" && max === "") return;
    const { item: withRange, newRangeId } = addRangeToItem(item, activeRangeId);
    const patch = isSingleValue
      ? { isSingleValue: true, value, min: value, max: value, unit }
      : { min, max, unit };
    const updated = applyItemRangePatch(withRange, newRangeId, patch);
    persistInlineItemDetail(kind, updated);
    const setIdx = kind === "uut" ? setLocalRangeIndices : setTmdeRangeIndices;
    const resolved = resolveUutRangeHelper(updated, {}, null, null).ranges || [];
    const newIdx = newRangeId ? resolved.findIndex((r) => sameId(r.id, newRangeId)) : -1;
    setIdx((prev) => ({ ...prev, [item.id]: newIdx >= 0 ? newIdx : 0 }));
  };
  // Instant, confirm-free deletion (context-menu delete path).
  const deleteRangeDetail = (kind, item, rangeId) => {
    if (!onSessionSave) return;
    const pruned = removeRangeFromItem(item, rangeId);
    if (pruned === item) return;
    handleRemoveRangeDetail(kind, item, rangeId);
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

  // Click-away collapse for the expanded range list (see SummaryDashboard twin).
  useEffect(() => {
    if (expandedRangeKeys.size === 0) return undefined;
    const onDown = (e) => {
      // Clicking a non-focusable area (a plain cell/background) does NOT blur a
      // focused inline editor, so its onBlur commit — new range, tolerance edit,
      // clear-to-delete — would never run before the list collapses. Force the
      // focused editor to blur first so its commit lands.
      const clickedInsideGroup = e.target?.closest?.("[data-range-group]");
      if (!clickedInsideGroup) {
        const ae = document.activeElement;
        if (ae && typeof ae.blur === "function" && ae.closest?.("[data-range-group]")) {
          ae.blur();
        }
      }
      setExpandedRangeKeys((prev) => {
        if (prev.size === 0) return prev;
        let next = null;
        prev.forEach((key) => {
          const inside = e.target?.closest?.(`[data-range-group="${key}"]`);
          if (!inside) {
            if (!next) next = new Set(prev);
            next.delete(key);
          }
        });
        return next || prev;
      });
    };
    // Listen on "click" (fires after mousedown -> blur -> mouseup) so any
    // in-progress editor commits its onBlur BEFORE the list collapses and
    // unmounts it. A mousedown listener would collapse first and swallow the
    // pending commit (lost new range / tolerance / clear-to-delete).
    document.addEventListener("click", onDown);
    return () => document.removeEventListener("click", onDown);
  }, [expandedRangeKeys]);

  const setRangeToleranceComponentDetail = (
    kind,
    item,
    activeRange,
    typeKey,
    component,
  ) => {
    if (!onSessionSave) return;
    const cur = getItemRangeTolerance(item, activeRange?.id) || {};
    // Prune blank terms in the same write (see setRangeToleranceComponent).
    const next = pruneBlankToleranceTerms({ ...cur, [typeKey]: component });
    persistInlineItemDetail(
      kind,
      applyItemRangeTolerance(item, activeRange?.id, next),
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

  const renderRangeRowCellsDetail = (kind, item, range, { includeDistribution, cols }) => {
    const tableId = kind === "uut" ? "uut_det" : "tmde_det";
    const tolerance = getItemRangeTolerance(item, range?.id) || range || {};

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
              allowSingleToggle
              onSelect={() => {}}
              onEditBound={(field, value) =>
                handleEditRangeBoundDetail(kind, item, range?.id, field, value)
              }
              onEditUnit={(value) => setRangeUnitDetail(kind, item, range?.id, value)}
              onPatchRange={(patch) => patchRangeDetail(kind, item, range?.id, patch)}
            />
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
            editable
            onCommit={(nextTypeKey, component) =>
              setRangeToleranceComponentDetail(kind, item, range, nextTypeKey, component)
            }
          />
        </td>

        {includeDistribution && (
          <td className="cell-distribution" title="Spec band distribution">
            <InlineDistributionCell
              divisor={getBandDistDivisor(tolerance)}
              onChange={(value) =>
                setRangeBandDistributionDetail(kind, item, range?.id, value)
              }
            />
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
            distribution={range?.resolutionDistribution ?? range?.measuringResolutionDistribution}
            onCommit={(v) => setRangeResolutionDetail(kind, item, range?.id, v)}
            onCommitUnit={(value) => setRangeResolutionUnitDetail(kind, item, range?.id, value)}
            onCommitDistribution={(value) =>
              setRangeResolutionDistributionDetail(kind, item, range?.id, value)
            }
          />
        </td>
      </>
    );
  };

  // Buffered "add" row for the Detailed View (see SummaryDashboard twin). The
  // extra Distribution column means the ghost mirrors includeDistribution.
  const renderGhostRangeRowDetail = (kind, item, activeRange, { includeDistribution }) => (
    <GhostRangeRow
      key={`ghost-${kind}-${item.id}`}
      unit={activeRange?.unit || ""}
      includeDistribution={includeDistribution}
      dataGroup={itemStateKey(kind, item.id)}
      onMaterialize={(bounds) =>
        materializeGhostRangeDetail(kind, item, activeRange?.id ?? null, bounds)
      }
    />
  );
  const renderRangeExpandButtonDetail = (kind, item, rangeCount) => {
    if (!onSessionSave) return null;
    return (
      <button
        type="button"
        className="range-expand-btn"
        title="Show all ranges — edit, add, or remove"
        aria-label="Show all ranges"
        onClick={(e) => {
          e.stopPropagation();
          toggleShowAllRangesDetail(kind, item.id);
        }}
      >
        <FontAwesomeIcon icon={faChevronDown} size="xs" />
        <span className="range-expand-btn-label">
          {rangeCount > 1 ? `${rangeCount} ranges` : "edit / add"}
        </span>
      </button>
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
  const activePointFunctionKey = functionKeyOf(testPointData);
  const pointFunctionMatchesRow = useCallback(
    (functionKey = null) =>
      !functionKey ||
      !activePointFunctionKey ||
      functionKey === activePointFunctionKey,
    [activePointFunctionKey],
  );
  const isActivePointUutForFunction = useCallback(
    (uut, functionKey = null) =>
      activePointUutId !== null &&
      String(activePointUutId) === String(uut?.id) &&
      pointFunctionMatchesRow(functionKey),
    [activePointUutId, pointFunctionMatchesRow],
  );

  const resolveUutRange = useCallback(
    (uut, functionKey = null, rangeIndexOverride) => {
      const isActivePointUut = isActivePointUutForFunction(uut, functionKey);
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
    [activeRangeIndices, isActivePointUutForFunction, uutToleranceData, uutNominal],
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
    // Sync color across BOTH kinds: a function shared by a TMDE and a UUT keeps a
    // single color so the two surfaces read as one organized group. Update every
    // stored entry matching this function key regardless of kind.
    const existing = Array.isArray(sessionData.functionGroups)
      ? sessionData.functionGroups
      : [];
    let found = false;
    let next = existing.map((fg) => {
      if (makeFunctionKey(fg.name, fg.unit) === fn.key) {
        found = true;
        return { ...fg, color };
      }
      return fg;
    });
    if (!found) {
      next = [
        ...next,
        {
          name: fn.name,
          unit: fn.unit,
          color,
          ...(fn.kind ? { kind: fn.kind } : {}),
        },
      ];
    }
    onSessionSave({ ...sessionData, functionGroups: next });
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
      const newUut = {
        id: uuidv4(),
        name: "",
        description: "",
        measurementAreaId: activeMeasurementAreaId || "",
        measurementArea: activeMeasurementArea?.name || "",
        measurementAreaColor: activeMeasurementArea?.color || "",
        instrument,
      };
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
      <span
        className="inline-area-header-input function-header-name"
        contentEditable
        suppressContentEditableWarning
        tabIndex={0}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.currentTarget.textContent = fn.name;
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => handleFunctionRename(fn, e.currentTarget.textContent)}
        title="Edit function name"
        aria-label="Function subsection name"
        role="textbox"
        style={{ color: fn.color }}
      >
        {fn.name}
      </span>
    );
  };

  const renderFunctionUnitChip = (fn) =>
    fn.unit ? (
      <span className="function-header-unit-chip">
        {getUnitDisplayLabel(fn.unit)}
      </span>
    ) : null;

  const renderFunctionAddButton = (kind, fn) =>
    onSessionSave ? (
      <button
        type="button"
        className="range-header-action-btn range-header-action-btn--add function-header-action-btn"
        title={`Add ${kind === "uut" ? "UUT" : "TMDE"} with this function`}
        aria-label={`Add ${kind === "uut" ? "UUT" : "TMDE"} with this function`}
        onClick={(e) => {
          e.stopPropagation();
          handleAddInstrumentToFunction(kind, fn);
        }}
      >
        <FontAwesomeIcon icon={faPlus} size="xs" />
      </button>
    ) : null;

  const renderFunctionDeleteButton = (fn) =>
    onSessionSave ? (
      <button
        type="button"
        className="range-header-action-btn range-header-action-btn--delete function-header-action-btn"
        title="Delete function"
        aria-label="Delete function"
        onClick={(e) => {
          e.stopPropagation();
          handleDeleteFunction(fn);
        }}
      >
        <FontAwesomeIcon icon={faTrashAlt} size="xs" />
      </button>
    ) : null;

  const renderFunctionHeaderRow = (kind, fn, colSpan) => (
    <tr key={`${kind}-fn-${fn.key}`} className="instrument-area-section-row">
      <td colSpan={colSpan}>
        <div className="function-header-row">
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
    const available = functionsForLibrary([
      ...(instruments || []),
      ...(sessionData.uuts || []),
      ...(sessionData.tmdes || []),
    ]);
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
              No library or session instrument functions
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
            <UnitSelect
              value={newFunctionDraft.unit}
              ariaLabel="New function unit"
              onChange={(unit) => setNewFunctionDraft((d) => ({ ...d, unit }))}
              width="9ch"
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


  const relevantTmdes = useMemo(() => {
    // Detail view exposes the same TMDE inventory as Session Overview.
    return sessionData.tmdes || [];
  }, [sessionData.tmdes]);

  // The Detailed View lists the SAME instruments as the Session Overview —
  // the full session inventory grouped by function — and simply flags the
  // point's active UUT. It is deliberately NOT scoped to the point's
  // function/area: that scoping was the source of the two views disagreeing
  // (e.g. a point hiding a UUT that a stale association had stranded in another
  // area). Empty user-added function groups are included so a function added
  // from this view is immediately visible with its add-instrument row.
  const buildFullDetailRows = useCallback(
    (items, kind) => {
      const mapped = (items || []).map((item, index) => ({
        type: "item",
        item,
        index,
      }));
      return buildFunctionGroupedRows(mapped, sessionData, kind, {
        includeEmptyGroups: true,
      });
    },
    [sessionData],
  );

  const detailUutRows = useMemo(
    () => buildFullDetailRows(sessionData.uuts || [], "uut"),
    [buildFullDetailRows, sessionData.uuts],
  );

  const detailTmdeRows = useMemo(
    () => buildFullDetailRows(relevantTmdes, "tmde"),
    [buildFullDetailRows, relevantTmdes],
  );

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
    const currentNominal = testPointData.variableNominals?.[symbol];
    const inferredUnit = inferVariableUnit(trimmedNewName);
    if (trimmedNewName && inferredUnit && !currentNominal?.unit) {
      patch.variableNominals = {
        ...(testPointData.variableNominals || {}),
        [symbol]: {
          value: currentNominal?.value ?? "",
          unit: inferredUnit,
        },
      };
    }

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

  const inferVariableUnit = useCallback(
    (variableName) => {
      const targetName = String(variableName || "").trim().toLowerCase();
      if (!targetName) return "";

      const sessionFunction = resolveSessionFunctions(sessionData, {
        kind: "tmde",
      }).find((fn) => String(fn.name || "").trim().toLowerCase() === targetName);
      if (sessionFunction?.unit) return sessionFunction.unit;

      for (const tmde of relevantTmdes) {
        const match = instrumentFunctions(tmde).find(
          (fn) => String(fn.name || "").trim().toLowerCase() === targetName,
        );
        if (match?.unit) return match.unit;
      }
      return "";
    },
    [relevantTmdes, sessionData],
  );

  const getVariableNominal = useCallback(
    (symbol, variableName = "") => {
      const saved = testPointData.variableNominals?.[symbol] || {};
      return {
        value: saved.value ?? "",
        unit: saved.unit || inferVariableUnit(variableName),
      };
    },
    [inferVariableUnit, testPointData.variableNominals],
  );

  const handleVariableNominalUpdate = (symbol, field, value, variableName = "") => {
    const current = getVariableNominal(symbol, variableName);
    const varType = String(variableName || "").trim();
    const prevValue = current.value ?? "";
    const prevUnit = current.unit ?? "";

    // Keep the measurement point of any TMDE instances assigned to this variable
    // in step with the nominal as the user types it. Without this, an instance
    // assigned before the nominal existed keeps an empty measurementPoint, so its
    // input budget reads N/A until the TMDE is reassigned. Only refresh instances
    // that still track the variable nominal (an empty point, or one still equal to
    // the previous nominal) so manually-entered additive per-source values on a
    // multi-source variable are preserved.
    let nextTmdeTolerances = tmdeTolerancesData;
    if (varType) {
      let changed = false;
      const patched = tmdeTolerancesData.map((tmde) => {
        if (String(tmde.variableType || "").trim() !== varType) return tmde;
        const mp = tmde.measurementPoint || { value: "", unit: "" };
        const mpValue = mp.value ?? "";
        const mpUnit = mp.unit ?? "";
        if (field === "value") {
          const tracks = mpValue === "" || String(mpValue) === String(prevValue);
          if (!tracks) return tmde;
        } else if (field === "unit") {
          const tracks = mpUnit === "" || String(mpUnit) === String(prevUnit);
          if (!tracks) return tmde;
        } else {
          return tmde;
        }
        changed = true;
        return { ...tmde, measurementPoint: { ...mp, [field]: value } };
      });
      if (changed) nextTmdeTolerances = patched;
    }

    onUpdateTestPoint?.({
      variableNominals: {
        ...(testPointData.variableNominals || {}),
        [symbol]: {
          ...current,
          [field]: value,
        },
      },
      ...(nextTmdeTolerances !== tmdeTolerancesData
        ? { tmdeTolerances: nextTmdeTolerances }
        : {}),
    });
  };

  const getNominalForVariableType = useCallback(
    (variableType) => {
      const mappings = testPointData.variableMappings || {};
      const symbol = Object.entries(mappings).find(
        ([, name]) =>
          String(name || "").trim() === String(variableType || "").trim(),
      )?.[0];
      return symbol ? getVariableNominal(symbol, variableType) : null;
    },
    [getVariableNominal, testPointData.variableMappings],
  );

  const tmdeMasterIdOf = (tmde) => tmde?.sourceId ?? tmde?.id;
  const sameTmdeMaster = (tmde, masterTmde) =>
    String(tmdeMasterIdOf(tmde) ?? "") === String(masterTmde?.id ?? "");
  const sameVariableType = (tmde, variableType) =>
    String(tmde?.variableType || "").trim() === String(variableType || "").trim();
  const derivedTmdeInstanceId = (masterId, variableType) =>
    `${String(masterId)}::${String(variableType || "input").trim() || "input"}`;

  const handleAssignTmdeToInput = (
    masterTmde,
    variableType,
    functionKey = null,
    options = {},
  ) => {
    const variableSymbol = Object.entries(testPointData.variableMappings || {}).find(
      ([, name]) =>
        String(name || "").trim() === String(variableType || "").trim(),
    )?.[0];
    const savedVariableNominal =
      (variableSymbol && testPointData.variableNominals?.[variableSymbol]) || {};
    const inferredVariableUnit = inferVariableUnit(variableType);
    const existing = tmdeTolerancesData.find(
      (tmde) =>
        sameTmdeMaster(tmde, masterTmde) &&
        sameVariableType(tmde, variableType),
    );
    const variableNominal = getNominalForVariableType(variableType);
    const rangeNominal =
      variableNominal?.value !== "" && variableNominal?.unit
        ? variableNominal
        : null;
    const shouldApplyTmdeUnitDefault = (previousInstance = null) => {
      const previousUnit = previousInstance?.measurementPoint?.unit || "";
      const currentSavedUnit = savedVariableNominal.unit || "";
      return (
        !currentSavedUnit ||
        currentSavedUnit === previousUnit ||
        currentSavedUnit === inferredVariableUnit
      );
    };
    const buildAssignedInstance = (baseInstance = null, previousInstance = null) => {
      const resolution = resolveUutRangeHelper(
        masterTmde,
        tmdeRangeIndices,
        baseInstance,
        rangeNominal,
        functionKey,
      );
      const activeRange = resolution.activeRange || {};
      const rangeSpecs = { ...activeRange };
      delete rangeSpecs.id;
      const sibling = tmdeTolerancesData.find(
        (t) => t.variableType === variableType && t.measurementPoint?.unit,
      );
      const tmdeDefaultUnit =
        activeRange.unit ||
        activeRange.functionUnit ||
        masterTmde.instrument?.functions?.[0]?.unit ||
        instrumentFunctions(masterTmde)[0]?.unit ||
        "";
      const defaultUnit =
        (shouldApplyTmdeUnitDefault(previousInstance) && tmdeDefaultUnit) ||
        savedVariableNominal.unit ||
        tmdeDefaultUnit ||
        sibling?.measurementPoint?.unit ||
        variableNominal?.unit ||
        "";
      const nominalHasValue =
        variableNominal?.value !== "" &&
        variableNominal?.value !== null &&
        variableNominal?.value !== undefined;

      return {
        ...masterTmde,
        ...rangeSpecs,
        id:
          baseInstance?.id ||
          derivedTmdeInstanceId(masterTmde.id, variableType),
        sourceId: masterTmde.id,
        tolerance: rangeSpecs,
        variableType,
        quantity: baseInstance?.quantity ?? 1,
        measurementPoint:
          nominalHasValue
            ? { value: variableNominal.value, unit: defaultUnit }
            : baseInstance?.measurementPoint ||
              (masterTmde.measurementPoint?.value
                ? masterTmde.measurementPoint
                : { value: "", unit: defaultUnit }),
      };
    };
    const variableNominalPatchFor = (assignedInstance, previousInstance = null) => {
      if (!variableSymbol) return {};
      const nextUnit = assignedInstance?.measurementPoint?.unit || "";
      if (!nextUnit) return {};
      if (!shouldApplyTmdeUnitDefault(previousInstance)) return {};
      return {
        variableNominals: {
          ...(testPointData.variableNominals || {}),
          [variableSymbol]: {
            ...savedVariableNominal,
            value: savedVariableNominal.value ?? variableNominal?.value ?? "",
            unit: nextUnit,
          },
        },
      };
    };

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
      const updatedInstance = buildAssignedInstance(existing, existing);
      onUpdateTestPoint({
        tmdeTolerances: tmdeTolerancesData.map((tmde) =>
          tmde.id === existing.id
            ? updatedInstance
            : tmde,
        ),
        ...variableNominalPatchFor(updatedInstance, existing),
      });
      return updatedInstance.id;
    }

    const replaceInstance = options.replaceInstanceId
      ? tmdeTolerancesData.find(
          (tmde) => String(tmde.id) === String(options.replaceInstanceId),
        )
      : null;
    const newInstance = buildAssignedInstance(null, replaceInstance);

    if (replaceInstance) {
      onUpdateTestPoint({
        tmdeTolerances: tmdeTolerancesData.map((tmde) =>
          tmde.id === replaceInstance.id ? newInstance : tmde,
        ),
        ...variableNominalPatchFor(newInstance, replaceInstance),
      });
      return newInstance.id;
    }

    onUpdateTestPoint({
      tmdeTolerances: [
        ...tmdeTolerancesData,
        newInstance,
      ],
      ...variableNominalPatchFor(newInstance),
    });
    return newInstance.id;
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

  const handleToggleTmdeUsage = (tmdeId, isChecked, functionKey = null) => {
    if (isChecked) {
      if (
        tmdeTolerancesData.some(
          (t) => String(t.id) === String(tmdeId) || String(t.sourceId) === String(tmdeId),
        )
      ) {
        return;
      }
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
          functionKey,
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
          tolerance: rangeSpecs,
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

  const handleTmdeRangeChange = (tmde, newIndex, ranges, instance = null) => {
    const targetId = instance?.id || tmde.id;
    const activeInstance =
      instance ||
      tmdeTolerancesData.find(
        (t) =>
          String(t.id) === String(tmde.id) ||
          (!isDerived && String(t.sourceId) === String(tmde.id)),
      );
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

    setTmdeRangeIndices((prev) => ({ ...prev, [targetId]: newIndex }));

    if (activeInstance && onUpdateTestPoint) {
      const { id: rangeId, ...rangeSpecs } = selectedRange;

      const updatedInstance = {
        ...activeInstance,
        ...rangeSpecs,
        id: activeInstance.id,
        tolerance: rangeSpecs,
      };

      const updatedTolerances = tmdeTolerancesData.map((t) =>
        t.id === activeInstance.id ? updatedInstance : t,
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
        const nominal = getVariableNominal(symbol, name);

        return {
          symbol,
          name,
          isAssigned: assignedTmdes.length > 0,
          assignedTmdes,
          value: nominal.value,
          unit: nominal.unit,
        };
      });

    return {
      equation: testPointData.equationString || "",
      variables: vars,
    };
  }, [getVariableNominal, isDerived, testPointData, tmdeTolerancesData]);

  const getEquationTmdeLabel = (tmde) => {
    // Resolve the LIVE master by its link id so a rename in the TMDE table shows
    // up immediately here — the per-point instance carries a snapshot name that
    // would otherwise stay stale. Prefer the (session-level) TMDE name, matching
    // how the TMDE table labels the row; fall back to the instrument identity.
    const masterId = tmde?.sourceId ?? tmde?.id;
    const master = (sessionData.tmdes || []).find((m) => m.id === masterId);
    const name = String(master?.name ?? tmde?.name ?? "").trim();
    return name || formatInstrumentIdentity(master || tmde, "Unnamed TMDE");
  };

  const getBudgetTmdeDetail = (tmde) => {
    if (!budgetTmdePicker) return "";
    const rowKey = `${budgetTmdePicker.functionKey || "single"}::${tmde.id}`;
    const rangeNominal = isDerived
      ? budgetTmdePicker.scope?.nominalPoint || null
      : null;
    const resolution = resolveUutRangeHelper(
      tmde,
      tmdeRangeIndices,
      null,
      rangeNominal,
      budgetTmdePicker.functionKey,
    );
    const activeIndex =
      tmdeRangeIndices[rowKey] ??
      tmdeRangeIndices[tmde.id] ??
      resolution.activeIndex;
    const activeRange =
      resolution.ranges?.[activeIndex] ||
      resolution.activeRange ||
      findRangeForFunction(tmde, budgetTmdePicker.functionKey);
    return formatRangeToleranceDetail(activeRange);
  };

  const budgetFunctionKey = useCallback(
    (scope = null) => {
      if (isDerived) {
        return makeFunctionKey(
          scope?.variableType || scope?.label || "",
          scope?.nominalPoint?.unit || "",
        );
      }
      return functionKeyOf(testPointData);
    },
    [isDerived, testPointData],
  );

  const tmdeSupportsFunction = useCallback((tmde, functionKey) => {
    if (!functionKey) return true;
    if (instrumentHasFunction(tmde, functionKey)) return true;
    if (instrumentFunctions(tmde).some((fn) => functionPartsMatch(fn.name, fn.unit, functionKey))) {
      return true;
    }
    return getInstrumentRangeRows(tmde).some(
      (range) =>
        functionPartsMatch(
          range.functionName || "",
          range.functionUnit || range.unit || "",
          functionKey,
        ),
    );
  }, []);

  // Derived-variable relevance: an equation variable is identified by its
  // user-chosen NAME (e.g. "V_in"), which almost never equals a TMDE's
  // function name ("DC Voltage") — so name-keyed function matching can't work
  // here. What actually links them is the physical quantity: a TMDE is a
  // sensible suggestion when any of its functions/ranges measures in a unit
  // of the same dimension as the variable's nominal unit.
  const tmdeMatchesUnit = useCallback((tmde, unit) => {
    if (!unit) return true;
    const targetQuantity = unitSystem.getQuantity?.(unit) || null;
    const unitMatches = (candidate) => {
      if (!candidate) return false;
      if (normalizeUnitToken(candidate) === normalizeUnitToken(unit)) return true;
      if (!targetQuantity) return false;
      return unitSystem.getQuantity?.(candidate) === targetQuantity;
    };
    if (instrumentFunctions(tmde).some((fn) => unitMatches(fn.unit))) return true;
    return getInstrumentRangeRows(tmde).some((range) =>
      unitMatches(range.functionUnit || range.unit),
    );
  }, []);

  const openBudgetTmdePicker = useCallback(
    (scope, event = null, pickerOptions = {}) => {
      const functionKey = budgetFunctionKey(scope);
      const byLabel = (a, b) =>
        getEquationTmdeLabel(a).localeCompare(getEquationTmdeLabel(b));
      const isMatch = isDerived
        ? (tmde) => tmdeMatchesUnit(tmde, scope?.nominalPoint?.unit || "")
        : (tmde) => tmdeSupportsFunction(tmde, functionKey);
      const options = relevantTmdes.filter(isMatch).sort(byLabel);
      // Non-matching TMDEs stay reachable in a secondary section — the picker
      // suggests, it doesn't censor (deliberate cross-function/cross-unit
      // assignments are legitimate).
      const otherOptions = relevantTmdes
        .filter((tmde) => !isMatch(tmde))
        .sort(byLabel);
      // The UUT's measuring resolution is offered here too (direct points only),
      // so the user adds every kind of uncertainty source from one organized
      // menu instead of a separate per-spec checkbox.
      const resolutionDetail = isDerived ? null : getPointResolutionDetail(uutToleranceData);
      const resolutionOption =
        resolutionDetail && !resolutionDetail.included ? resolutionDetail : null;

      // A TMDE's own measuring resolution can also feed the budget. Offer it for
      // each TMDE already contributing to THIS scope (the whole point for a
      // direct measurement; just this variable for a derived one, so a TMDE's
      // resolution lands in that variable's own budget table — e.g. L's). Only
      // TMDEs with a usable resolution that isn't already opted in are listed.
      const scopeVariableType =
        scope?.variableType || scope?.label || null;
      const contributingTmdeInstances = isDerived
        ? tmdeTolerancesData.filter(
            (t) => t.variableType === scopeVariableType,
          )
        : tmdeTolerancesData;
      const tmdeResolutionOptions = contributingTmdeInstances
        .map((tmde) => {
          const detail = getTmdeResolutionDetail(tmde);
          if (!detail || detail.included) return null;
          return { tmde, ...detail };
        })
        .filter(Boolean);

      if (
        options.length === 0 &&
        otherOptions.length === 0 &&
        !resolutionOption &&
        tmdeResolutionOptions.length === 0
      ) {
        setNotification?.({
          title: "Nothing to Add",
          message: resolutionDetail
            ? "The UUT resolution is already in this budget. Add a TMDE in Session Overview to add more sources."
            : "Add a TMDE in Session Overview (or enter a UUT resolution) before adding to this budget.",
        });
        return;
      }
      const rect = event?.currentTarget?.getBoundingClientRect?.() || null;
      setBudgetTmdePicker({
        scope,
        functionKey,
        options,
        otherOptions,
        resolutionOption,
        tmdeResolutionOptions,
        rect,
        mode: pickerOptions.mode || "add",
        replaceInstanceId: pickerOptions.replaceInstanceId || null,
      });
    },
    [
      budgetFunctionKey,
      relevantTmdes,
      setNotification,
      tmdeMatchesUnit,
      tmdeSupportsFunction,
      isDerived,
      uutToleranceData,
      tmdeTolerancesData,
    ],
  );

  const addBudgetTmde = (tmde) => {
    if (!budgetTmdePicker) return;
    if (isDerived) {
      const nextInstanceId = handleAssignTmdeToInput(
        tmde,
        budgetTmdePicker.scope?.variableType || budgetTmdePicker.scope?.label,
        budgetTmdePicker.functionKey,
        {
          replaceInstanceId: budgetTmdePicker.replaceInstanceId,
        },
      );
      if (budgetTmdePicker.scope?.symbol && nextInstanceId) {
        setEquationTmdeSelections((prev) => ({
          ...prev,
          [budgetTmdePicker.scope.symbol]: nextInstanceId,
        }));
      }
    } else {
      handleToggleTmdeUsage(tmde.id, true, budgetTmdePicker.functionKey);
    }
    setBudgetTmdePicker(null);
  };

  // Add the UUT's measuring resolution to this point's budget by opting it in on
  // the point's tolerance — getUutResolutionComponent then folds it into the math.
  const addBudgetResolution = () => {
    if (!budgetTmdePicker) return;
    onUpdateTestPoint?.({
      uutTolerance: { ...uutToleranceData, includeResolutionInBudget: true },
    });
    setBudgetTmdePicker(null);
  };

  // Add a TMDE's measuring resolution to this budget by opting it in on that
  // TMDE instance — getBudgetComponentsFromTolerance then emits a "<TMDE> -
  // Resolution" component into the same budget table the TMDE's accuracy feeds
  // (the point's budget for a direct measurement; the variable's budget for a
  // derived one, since the instance is scoped to that variable).
  const addBudgetTmdeResolution = (tmde) => {
    if (!budgetTmdePicker || !tmde) return;
    applyTmdeInstanceChange(
      tmde.id ?? tmde.sourceId,
      (t) => ({
        ...t,
        // Set the flag on both the instance and its `.tolerance` snapshot: the
        // direct-measurement path reads `tmde.tolerance || tmde`, the derived
        // path reads the instance directly, so cover both.
        includeResolutionInBudget: true,
        ...(t.tolerance && typeof t.tolerance === "object"
          ? { tolerance: { ...t.tolerance, includeResolutionInBudget: true } }
          : {}),
      }),
      "point",
    );
    setBudgetTmdePicker(null);
  };

  const renderBudgetTmdePicker = () => {
    if (!budgetTmdePicker) return null;
    const scopeLabel = budgetTmdePicker.scope?.label || "Budget";
    const itemStyle = {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      width: "100%",
      textAlign: "left",
      padding: "7px 10px",
      background: "transparent",
      border: "none",
      borderRadius: "4px",
      color: "var(--text-color)",
      cursor: "pointer",
      fontSize: "0.85em",
    };
    const MENU_WIDTH = 360;
    const rect = budgetTmdePicker.rect;
    const left = rect
      ? Math.max(
          8,
          Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
        )
      : 8;
    const top = rect
      ? Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 80))
      : 60;
    return ReactDOM.createPortal(
      <>
        <div
          onClick={() => setBudgetTmdePicker(null)}
          style={{ position: "fixed", inset: 0, zIndex: 4000 }}
        />
        <div
          className="budget-settings-menu budget-tmde-picker-menu"
          style={{
            position: "fixed",
            top,
            left,
            width: `${MENU_WIDTH}px`,
            maxHeight: "min(360px, 70vh)",
            overflow: "auto",
            background: "var(--component-bg)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            zIndex: 4001,
            padding: "8px",
          }}
          onClick={(e) => e.stopPropagation()}
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
            {budgetTmdePicker.mode === "assign" ? "Assign" : "Add to"} {scopeLabel}
          </div>
          {/* Grouped by the TYPE of uncertainty source so the user knows exactly
              what they're adding to the budget. */}
          {(() => {
            const renderTmdeOption = (tmde) => {
              const detail = getBudgetTmdeDetail(tmde);
              return (
                <button
                  key={tmde.id}
                  type="button"
                  style={itemStyle}
                  onClick={() => addBudgetTmde(tmde)}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--input-background)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <FontAwesomeIcon icon={faTools} style={{ marginTop: "2px" }} />
                  <span
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {getEquationTmdeLabel(tmde)}
                    </span>
                    {detail && (
                      <span
                        style={{
                          fontSize: "0.72rem",
                          color: "var(--text-color-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {detail}
                      </span>
                    )}
                  </span>
                </button>
              );
            };
            const others = budgetTmdePicker.otherOptions || [];
            return (
              <>
                {budgetTmdePicker.options.length > 0 && (
                  <div>
                    <div className="budget-tmde-picker-category">
                      TMDEs
                    </div>
                    {budgetTmdePicker.options.map(renderTmdeOption)}
                  </div>
                )}
                {/* TMDEs that don't match this variable's unit / point's
                    function — still selectable, just de-emphasized, so the
                    picker never hides part of the session inventory. */}
                {others.length > 0 && (
                  <div>
                    <div className="budget-tmde-picker-category">
                      {budgetTmdePicker.options.length > 0
                        ? "Other TMDEs (different unit)"
                        : "All TMDEs"}
                    </div>
                    {others.map(renderTmdeOption)}
                  </div>
                )}
              </>
            );
          })()}
          {budgetTmdePicker.resolutionOption && (
            <div>
              <div className="budget-tmde-picker-category">UUT resolution</div>
              <button
                type="button"
                style={itemStyle}
                onClick={addBudgetResolution}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--input-background)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <FontAwesomeIcon icon={faRulerCombined} style={{ marginTop: "2px" }} />
                <span
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                    minWidth: 0,
                  }}
                >
                  <span>Measuring resolution</span>
                  <span
                    style={{
                      fontSize: "0.72rem",
                      color: "var(--text-color-muted)",
                    }}
                  >
                    {`${budgetTmdePicker.resolutionOption.value}${
                      getUnitDisplayLabel(budgetTmdePicker.resolutionOption.unit)
                        ? ` ${getUnitDisplayLabel(budgetTmdePicker.resolutionOption.unit)}`
                        : ""
                    } · rounding contribution`}
                  </span>
                </span>
              </button>
            </div>
          )}
          {(budgetTmdePicker.tmdeResolutionOptions || []).length > 0 && (
            <div>
              <div className="budget-tmde-picker-category">TMDE resolution</div>
              {budgetTmdePicker.tmdeResolutionOptions.map((option) => {
                const resUnitLabel = getUnitDisplayLabel(option.unit);
                return (
                  <button
                    key={`tmde-res-${option.tmde.id ?? option.tmde.sourceId}`}
                    type="button"
                    style={itemStyle}
                    onClick={() => addBudgetTmdeResolution(option.tmde)}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--input-background)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <FontAwesomeIcon icon={faRulerCombined} style={{ marginTop: "2px" }} />
                    <span
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {getEquationTmdeLabel(option.tmde)} resolution
                      </span>
                      <span
                        style={{
                          fontSize: "0.72rem",
                          color: "var(--text-color-muted)",
                        }}
                      >
                        {`${option.value}${resUnitLabel ? ` ${resUnitLabel}` : ""} · rounding contribution`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </>,
      document.body,
    );
  };

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
    isDerived &&
    equationDisplayData?.variables.some((v) => {
      if (!String(v.name || "").trim()) return true;
      if (v.value === "" || v.value === null || v.value === undefined) {
        return true;
      }
      return !v.unit;
    });

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
  const primaryUut = (sessionData.uuts || []).find((u) => u.id === primaryUutId);

  const activeResolvedTolerance = useMemo(() => {
    if (!primaryUut) return uutToleranceData;
    const { activeRange } = resolveUutRange(primaryUut);
    if (!(activeRange && Object.keys(activeRange).length > 0)) {
      return uutToleranceData;
    }
    // Whether the UUT resolution is in the budget is a PER-POINT choice (set from
    // the budget add menu), not a property of the shared range spec. So when the
    // point tolerance is re-derived from the range, keep the point's own flag —
    // otherwise a legacy range-level includeResolutionInBudget (from the old
    // "use resolution" checkbox) would keep re-adding it and removal wouldn't
    // stick.
    return {
      ...activeRange,
      includeResolutionInBudget:
        uutToleranceData?.includeResolutionInBudget ?? false,
    };
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
            <span>Units Under Test</span>
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
                  </span>
                </th>
                <th>Tolerance</th>
                <th>Resolution</th>
                <th className="cell-sync">Sync</th>
              </tr>
            </thead>
            <tbody>
              {detailUutRows.length === 0 ? (
                <tr className="panel-empty-row">
                  <td colSpan="5">No UUTs found in this context.</td>
                </tr>
              ) : (
                detailUutRows.map((row) => {
                  if (row.type === "function") {
                    return renderFunctionHeaderRow("uut", row.fn, 5);
                  }
                  const uut = row.item;
                  const uutRowKey = row.rowKey ?? uut.id;
                  const uutFnKey = row.functionKey ?? null;
                  const { ranges, activeIndex, activeRange } =
                    resolveUutRange(uut, uutFnKey);
                  const isPointFunctionRow = pointFunctionMatchesRow(uutFnKey);
                  const isLinked =
                    testPointData.associatedUutIds &&
                    testPointData.associatedUutIds.includes(uut.id) &&
                    isPointFunctionRow;
                  const isActivePointUut = isActivePointUutForFunction(
                    uut,
                    uutFnKey,
                  );
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
                    const spanRows = n + 1; // +1 for the trailing ghost add-row
                    const activeRangeIndex = localRangeIndices[uutRowKey] ?? activeIndex;
                    return (
                      <React.Fragment key={uutRowKey}>
                        {visibleRangeRows.map(({ range, index, key }, i) => {
                          const isActiveRange = index === activeRangeIndex;
                          return (
                            <tr
                              key={key}
                              data-range-group={itemStateKey("uut", uut.id)}
                              className={`inline-range-row${i === 0 ? " inline-range-row--first" : ""}${isSelected ? " instrument-selected" : ""}${isActiveRange ? " is-active-range" : ""}${isActivePointUut ? " active-point-uut-row" : ""} ${hoveredRowId === uut.id ? "row-hovered" : ""}`}
                              onMouseEnter={() => setHoveredRowId(uut.id)}
                              onContextMenu={(e) => openRangeRowMenu(e, "uut", uut, range, index, n)}
                              onMouseDownCapture={() => {
                                activateRangeRowDetail("uut", uutRowKey, index);
                                // With the in-cell range switcher removed, clicking a
                                // range row is how the active point picks which range
                                // applies to it (mirrors the old switcher's onSelect).
                                if (index !== activeRangeIndex) {
                                  handleRangeChange(uut.id, index, ranges, isActivePointUut);
                                }
                              }}
                              style={{ cursor: "pointer" }}
                            >
                              {i === 0 && (
                                <td
                                  rowSpan={spanRows}
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
                                      functionKey={uutFnKey}
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
                                cols: { range: 1, tol: 2, res: 3 },
                              })}
                              {i === 0 && (
                                <td
                                  rowSpan={spanRows}
                                  className="cell-sync"
                                  style={{ textAlign: "center" }}
                                >
                                  <SyncBadge item={uut} onSync={() => handleSyncItem("uut", uut)} />
                                </td>
                              )}
                            </tr>
                          );
                        })}
                        {renderGhostRangeRowDetail("uut", uut, activeRange, {
                          includeDistribution: false,
                          cols: { range: 1, tol: 2, res: 3 },
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
                                functionKey={uutFnKey}
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
                          <div className="range-collapsed-cell">
                            {visibleRangeRows.map(({ range, key }) => (
                              <div className="range-stack-row" key={key}>
                                <RangeCell
                                  ranges={showAllRanges ? [range] : ranges}
                                  activeIndex={showAllRanges ? 0 : activeIndex}
                                  activeRange={range}
                                  editable={!!onSessionSave}
                                  allowSingleToggle
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
                            {renderRangeExpandButtonDetail("uut", uut, ranges.length)}
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
                              return (
                                <div className="range-stack-row" key={key}>
                                  {onSessionSave ? (
                                    <InlineToleranceCell
                                      tolerance={tolerance}
                                      activeRange={range}
                                      editable={!!onSessionSave}
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
                                    distribution={range?.resolutionDistribution ?? range?.measuringResolutionDistribution}
                                    onCommit={(v) =>
                                      setRangeResolutionDetail("uut", uut, range?.id, v)
                                    }
                                    onCommitUnit={(value) =>
                                      setRangeResolutionUnitDetail("uut", uut, range?.id, value)
                                    }
                                    onCommitDistribution={(value) =>
                                      setRangeResolutionDistributionDetail("uut", uut, range?.id, value)
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
                            <span>TMDE</span>
                            <button
                                type="button"
                                className="var-source-select var-source-assign-btn"
                                disabled={!String(variable.name || "").trim()}
                                title={
                                  String(variable.name || "").trim()
                                    ? "Choose a TMDE for this input"
                                    : "Name this input first"
                                }
                                onClick={(event) =>
                                  openBudgetTmdePicker(
                                    {
                                      symbol: variable.symbol,
                                      variableType: variable.name,
                                      label: variable.name || variable.symbol,
                                      nominalPoint: {
                                        value: variable.value,
                                        unit: variable.unit,
                                      },
                                    },
                                    event,
                                    {
                                      mode: "assign",
                                      replaceInstanceId: selectedTmde?.id || null,
                                    },
                                  )
                                }
                                aria-label={`Assign a TMDE to equation variable ${variable.symbol}`}
                              >
                                {selectedTmde
                                  ? getEquationTmdeLabel(selectedTmde)
                                  : "Assign TMDE..."}
                            </button>
                          </label>
                          <label className="measurement-equation-value-field">
                            <span>Nominal value</span>
                            <div className="var-value-display">
                              <input
                                type="number"
                                step="any"
                                className="var-value-input"
                                value={variable.value ?? ""}
                                placeholder="Enter value"
                                disabled={!String(variable.name || "").trim()}
                                onChange={(e) =>
                                  handleVariableNominalUpdate(
                                    variable.symbol,
                                    "value",
                                    e.target.value,
                                    variable.name,
                                  )
                                }
                                aria-label={`Nominal value for equation variable ${variable.symbol}`}
                              />
                              <UnitSelect
                                value={variable.unit || ""}
                                onChange={(unit) =>
                                  handleVariableNominalUpdate(
                                    variable.symbol,
                                    "unit",
                                    unit,
                                    variable.name,
                                  )
                                }
                                ariaLabel={`Nominal unit for equation variable ${variable.symbol}`}
                                width="8.5ch"
                              />
                            </div>
                          </label>
                          <em
                            className={`measurement-equation-variable-status ${
                              variable.isAssigned ? "assigned" : "unassigned"
                            }`}
                          >
                            {variable.isAssigned
                              ? variable.assignedTmdes.length > 1
                                ? `${variable.assignedTmdes.length} budget TMDEs assigned`
                                : "Budget TMDE assigned"
                              : String(variable.name || "").trim()
                                ? "Assign a TMDE to build this input's budget"
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
              <span>Test Measurement Device Equipment</span>
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
                    </span>
                  </th>
                  <th>Error Limit</th>
                  <th className="cell-distribution">Distribution</th>
                  <th>Resolution</th>
                  <th className="cell-sync">Sync</th>
                </tr>
              </thead>
              <tbody>
                {detailTmdeRows.length === 0 ? (
                  <tr className="panel-empty-row">
                    <td colSpan="6">No TMDEs found in session.</td>
                  </tr>
                ) : (
                  detailTmdeRows.map((row) => {
                    if (row.type === "function") {
                      return renderFunctionHeaderRow("tmde", row.fn, 6);
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
                    const displayInstance = activeInstances[0] || masterTmde;
                    const rowsToRender =
                      activeInstances.length > 0 ? [displayInstance] : [masterTmde];

                    return rowsToRender.map((tmdeInstance, idx) => {
                      const isChecked = activeInstances.includes(tmdeInstance);
                      const rangeStateKey = isChecked
                        ? tmdeInstance.id
                        : tmdeRowKey;
                      // const referencePoint = tmdeInstance.measurementPoint || { value: '', unit: '' }; // Removed unused reference

                      const savedTolerance = isChecked ? tmdeInstance : null;
                      // Pass the point's nominal so an unassigned TMDE defaults to
                      // a range that actually covers this measurement point
                      // (resolveUutRangeHelper Priority C) instead of range 0.
                      const resolution = resolveUutRangeHelper(
                        masterTmde,
                        {
                          [masterTmde.id]:
                            tmdeRangeIndices[rangeStateKey] ??
                            tmdeRangeIndices[tmdeRowKey],
                        },
                        savedTolerance,
                        isDerived ? null : uutNominal,
                        tmdeFnKey,
                      );
                      const { ranges, activeIndex, activeRange } = resolution;

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

                      // Expanded "view all ranges": one real <tr> per range.
                      // Description and sync span the group via rowSpan on the
                      // first range row.
                      if (showAllRanges) {
                        const n = visibleRangeRows.length;
                        const spanRows = n + 1; // +1 for the trailing ghost add-row
                        const activeRangeIndex =
                          tmdeRangeIndices[rangeStateKey] ?? activeIndex;
                        return (
                          <React.Fragment key={`${tmdeRowKey}-${idx}`}>
                            {visibleRangeRows.map(({ range, index, key }, i) => {
                              const isActiveRange = index === activeRangeIndex;
                              return (
                                <tr
                                  key={key}
                                  data-range-group={itemStateKey("tmde", masterTmde.id)}
                                  className={`tmde-row inline-range-row${i === 0 ? " inline-range-row--first" : ""}${isSelectedRow ? " instrument-selected" : ""}${isActiveRange ? " is-active-range" : ""} ${hoveredRowId === masterTmde.id ? "row-hovered" : ""}`}
                                  onMouseEnter={() => setHoveredRowId(masterTmde.id)}
                                  onContextMenu={(e) =>
                                    openRangeRowMenu(e, "tmde", masterTmde, range, index, n)
                                  }
                                  onMouseDownCapture={() => {
                                    activateRangeRowDetail("tmde", tmdeRowKey, index);
                                    // Range switcher removed: activating a range row
                                    // is now how a TMDE's applied range is chosen for
                                    // this point (mirrors the old switcher's onSelect).
                                    if (index !== activeRangeIndex) {
                                      handleTmdeRangeChange(
                                        masterTmde,
                                        index,
                                        ranges,
                                        isChecked ? tmdeInstance : null,
                                      );
                                    }
                                  }}
                                  style={{
                                    opacity: isSelectedRow ? 1 : 0.85,
                                    cursor: "pointer",
                                  }}
                                >
                                  {i === 0 && (
                                    <td
                                      rowSpan={spanRows}
                                      className={`cell-description ${hoveredCell.tableId === "tmde_det" && hoveredCell.colIndex === 0 ? "col-hovered" : ""}`}
                                      onMouseEnter={() =>
                                        setHoveredCell({ tableId: "tmde_det", colIndex: 0 })
                                      }
                                    >
                                      <EditableDescriptionCell
                                        name={masterTmde.name}
                                        make={masterTmde.instrument?.manufacturer}
                                        model={masterTmde.instrument?.model}
                                        functionKey={tmdeFnKey}
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
                                    cols: { range: 1, tol: 2, res: 4 },
                                  })}
                                  {i === 0 && (
                                    <td
                                      rowSpan={spanRows}
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
                            {renderGhostRangeRowDetail("tmde", masterTmde, activeRange, {
                              includeDistribution: true,
                              cols: { range: 1, tol: 2, res: 4 },
                            })}
                          </React.Fragment>
                        );
                      }

                      return (
                        <React.Fragment key={`${tmdeRowKey}-${idx}`}>
                          <tr
                            className={`tmde-row ${isSelectedRow ? `selected-row selected-instrument-start ${specRows.length <= 1 ? "selected-instrument-end" : ""}` : ""} ${hoveredRowId === masterTmde.id ? "row-hovered" : ""}`}
                            onMouseEnter={() => setHoveredRowId(masterTmde.id)}
                            style={{
                              opacity: isSelectedRow ? 1 : 0.85,
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
                              className={`cell-description ${hoveredCell.tableId === "tmde_det" && hoveredCell.colIndex === 0 ? "col-hovered" : ""}`}
                              onMouseEnter={() =>
                                setHoveredCell({
                                  tableId: "tmde_det",
                                  colIndex: 0,
                                })
                              }
                            >
                              {onSessionSave ? (
                                <EditableDescriptionCell
                                  name={masterTmde.name}
                                  make={masterTmde.instrument?.manufacturer}
                                  model={masterTmde.instrument?.model}
                                  functionKey={tmdeFnKey}
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
                              className={`cell-value ${hoveredCell.tableId === "tmde_det" && hoveredCell.colIndex === 1 ? "col-hovered" : ""}`}
                              onMouseEnter={() =>
                                setHoveredCell({
                                  tableId: "tmde_det",
                                  colIndex: 1,
                                })
                              }
                              style={{ verticalAlign: "middle" }}
                            >
                              <div className="range-collapsed-cell">
                                {visibleRangeRows.map(({ range, key }) => (
                                  <div className="range-stack-row" key={key}>
                                    <RangeCell
                                      ranges={showAllRanges ? [range] : ranges}
                                      activeIndex={showAllRanges ? 0 : activeIndex}
                                      activeRange={range}
                                      editable={!!onSessionSave}
                                      allowSingleToggle
                                      onSelect={(idx) =>
                                        handleTmdeRangeChange(
                                          masterTmde,
                                          idx,
                                          ranges,
                                          isChecked ? tmdeInstance : null,
                                        )
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
                                {renderRangeExpandButtonDetail("tmde", masterTmde, ranges.length)}
                              </div>
                            </td>

                            <td
                              className={`cell-tolerance ${hoveredCell.tableId === "tmde_det" && hoveredCell.colIndex === 2 ? "col-hovered" : ""}`}
                              onMouseEnter={() =>
                                setHoveredCell({
                                  tableId: "tmde_det",
                                  colIndex: 2,
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
                                  return (
                                    <div className="range-stack-row" key={key}>
                                      {onSessionSave ? (
                                        <InlineToleranceCell
                                          tolerance={tolerance}
                                          activeRange={range}
                                          editable={!!onSessionSave}
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
                                      <InlineDistributionCell
                                        divisor={getBandDistDivisor(tolerance)}
                                        editable={!!onSessionSave}
                                        onChange={(value) =>
                                          setRangeBandDistributionDetail(
                                            "tmde",
                                            masterTmde,
                                            range?.id,
                                            value,
                                          )
                                        }
                                      />
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
                                        distribution={
                                          range?.resolutionDistribution ??
                                          range?.measuringResolutionDistribution
                                        }
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
                                        onCommitDistribution={(value) =>
                                          setRangeResolutionDistributionDetail(
                                            "tmde",
                                            masterTmde,
                                            range?.id,
                                            value,
                                          )
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
                              <SyncBadge item={masterTmde} onSync={() => handleSyncItem("tmde", masterTmde)} />
                            </td>
                          </tr>

                          {!onSessionSave && specRows.slice(1).map((specComp, sIdx) => (
                            <tr
                              key={`${tmdeRowKey}-${idx}-spec-${sIdx}`}
                              className={`spec-row ${isSelectedRow ? `selected-spec-row selected-instrument-continuation ${sIdx === specRows.length - 2 ? "selected-instrument-end" : ""}` : ""} ${hoveredRowId === masterTmde.id ? "hovered-spec-row" : ""}`}
                              onMouseEnter={() =>
                                setHoveredRowId(masterTmde.id)
                              }
                            >
                              <td
                                className={`${hoveredCell.tableId === "tmde_det" && hoveredCell.colIndex === 2 ? "col-hovered" : ""}`}
                                onMouseEnter={() =>
                                  setHoveredCell({
                                    tableId: "tmde_det",
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
              ? "Name each equation variable and enter its nominal value to calculate budget."
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
              onAddTmdeToBudget={openBudgetTmdePicker}
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
      {renderBudgetTmdePicker()}
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
        onInstrumentSynced={props.onInstrumentSynced}
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
