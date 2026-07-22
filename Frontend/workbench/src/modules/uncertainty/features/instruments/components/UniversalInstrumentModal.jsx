/**
 * src/features/instruments/components/UniversalInstrumentModal.jsx
 */
import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faTimes,
  faPlus,
  faTrashAlt,
  faArrowLeft,
  faSearch,
  faChevronDown,
  faChevronUp,
  faCube,
  faBookOpen,
  faMicroscope,
  faTools,
  faTag,
  faIndustry,
  faFingerprint,
  faSyncAlt,
  faFlask
} from "@fortawesome/free-solid-svg-icons";
import { v4 as uuidv4 } from "uuid";
import {
  errorDistributions,
  DISTRIBUTION_NOT_SET,
  getToleranceSummary,
  getUnitDisplayLabel,
  unitCategories,
  unitSystem,
} from "../../../utils/uncertaintyMath";
import TypeBComponentsEditor, { createTypeBComponent } from "./TypeBComponentsEditor";
import BuilderUnitSelect from "./BuilderUnitSelect";
import InlineMenuSelect from "../../../components/common/InlineMenuSelect";
import NotificationModal from "../../../components/modals/NotificationModal";
import { useFloatingWindow } from "../../../hooks/useFloatingWindow";
import useInstrumentSync from "../../../hooks/useInstrumentSync";
import { computeSyncState, diffFromSnapshot } from "../../../utils/instrumentSync";

import "./UniversalInstrumentModal.css";

// --- Helpers ---
const getCategorizedUnitOptions = (allUnits, referenceUnit) => {
  const options = [];
  const usedUnits = new Set();
  
  if (referenceUnit && allUnits.includes(referenceUnit)) {
    let refCategory = "Suggested";
    for (const [cat, units] of Object.entries(unitCategories)) {
      if (units.includes(referenceUnit)) {
        refCategory = cat;
        break;
      }
    }
    const categoryUnits = unitCategories[refCategory] || [referenceUnit];
    const prioritizedOptions = categoryUnits
      .filter((u) => allUnits.includes(u))
      .map((u) => { usedUnits.add(u); return { value: u, label: getUnitDisplayLabel(u) }; });
    options.push({ label: refCategory, options: prioritizedOptions });
  }

  Object.entries(unitCategories).forEach(([label, units]) => {
    if (options.some((opt) => opt.label === label)) return;
    const groupOptions = units
      .filter((u) => allUnits.includes(u) && !usedUnits.has(u))
      .map((u) => { usedUnits.add(u); return { value: u, label: getUnitDisplayLabel(u) }; });
    if (groupOptions.length > 0) options.push({ label, options: groupOptions });
  });

  const leftovers = allUnits
    .filter((u) => !usedUnits.has(u) && !["%", "ppm", "dB", "ppb"].includes(u))
    .map((u) => ({ value: u, label: getUnitDisplayLabel(u) }));
  if (leftovers.length > 0) options.push({ label: "Other", options: leftovers });

  return options;
};

const TOLERANCE_DIST_DEFAULT = "1.732";
const RESOLUTION_DIST_DEFAULT = "3.464";
const MAX_BUILDER_UNDO_STEPS = 50;
const BAND_KEYS = ["reading", "readings_iv", "range", "floor"];

const formatToleranceSummary = (tolerances) => {
    const summary = getToleranceSummary(tolerances);
    return (
        <span className={`tolerance-badge${summary === "Not Set" ? " is-empty" : ""}`}>
            {summary === "Not Set" ? "Set tolerance..." : summary}
        </span>
    );
};

const getBandDistribution = (tolerances = {}) => {
    const key = BAND_KEYS.find((k) => tolerances?.[k]);
    if (key) return tolerances[key].distribution || TOLERANCE_DIST_DEFAULT;
    return tolerances?.bandDistribution || null;
};

const applyBandDistribution = (tolerances = {}, value) => {
    const next = { ...(tolerances || {}) };
    let touched = false;
    BAND_KEYS.forEach((key) => {
        if (next[key] && typeof next[key] === "object") {
            next[key] = { ...next[key], distribution: value };
            touched = true;
        }
    });
    if (!touched) next.bandDistribution = value;
    return next;
};

const getDistributionLabel = (value, fallback = "Rectangular") => {
    const match = errorDistributions.find((dist) => String(dist.value) === String(value));
    return match?.label || fallback;
};

const valuePresent = (value) =>
    value !== undefined && value !== null && String(value).trim() !== "";

const toPlainNumber = (value) => {
    if (!valuePresent(value)) return "";
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(numeric) : String(value);
};

const getRangeUnit = (range = {}, fn = {}) =>
    range.unit || range.functionUnit || fn.unit || fn.units?.[0] || "";

// A unit-bearing row with no lower/upper bounds is the persisted form of an
// all-values specification. It lets an instrument carry a tolerance before (or
// without) a finite range and remains compatible with every point in that unit.
const createUnboundedBuilderRange = (unit = "") => ({
    id: uuidv4(),
    min: "",
    max: "",
    unit,
    resolution: "",
    resolutionUnit: unit,
    resolutionDistribution: RESOLUTION_DIST_DEFAULT,
    tolerances: {},
});

// A function is identified by its name. Range units are independent choices,
// so legacy data that stored one function per unit is folded into one builder
// section while retaining every range and unit.
const normalizeBuilderFunctions = (functions = []) => {
    const byName = new Map();
    (Array.isArray(functions) ? functions : []).forEach((sourceFn) => {
        const name = String(sourceFn?.name || "Measurement").trim() || "Measurement";
        const key = name.toLowerCase();
        const ranges = (Array.isArray(sourceFn?.ranges) ? sourceFn.ranges : []).map((range) => ({
            ...range,
            id: range?.id || uuidv4(),
        }));
        const rangeUnits = Array.from(
            new Set(
                ranges
                    .flatMap((range) => [range.unit, range.functionUnit])
                    .filter(Boolean)
                    .map((unit) => String(unit).trim())
                    .filter(Boolean),
            ),
        );
        const declaredUnits = Array.from(
            new Set([
                ...(Array.isArray(sourceFn?.units) ? sourceFn.units : []),
                sourceFn?.unit,
            ].filter(Boolean).map((unit) => String(unit).trim()).filter(Boolean)),
        );
        const units = rangeUnits.length ? rangeUnits : declaredUnits;
        const existing = byName.get(key);
        if (existing) {
            existing.ranges.push(...ranges);
            existing.units = Array.from(new Set([...existing.units, ...units]));
            existing.unit = existing.units[0] || existing.unit || "";
            return;
        }
        byName.set(key, {
            ...sourceFn,
            id: sourceFn?.id || uuidv4(),
            name,
            unit: units[0] || "",
            units,
            ranges,
        });
    });
    return Array.from(byName.values()).map((fn) =>
        fn.ranges.length > 0
            ? fn
            : { ...fn, ranges: [createUnboundedBuilderRange(fn.unit)] },
    );
};

const formatBuilderRangeSummary = (range = {}, fn = {}) => {
    const unitLabel = getUnitDisplayLabel(getRangeUnit(range, fn));
    if (range.isSingleValue) {
        const value = range.value ?? range.max ?? range.min ?? "";
        if (!valuePresent(value)) return "";
        return unitLabel ? `${value} ${unitLabel}` : String(value);
    }
    const min = range.min;
    const max = range.max;
    if (!valuePresent(min) && !valuePresent(max)) return "";
    const body =
        valuePresent(min) && valuePresent(max)
            ? `${min} to ${max}`
            : valuePresent(min)
              ? `from ${min}`
              : `to ${max}`;
    return unitLabel ? `${body} ${unitLabel}` : body;
};

const formatResolutionSummary = (range = {}, fn = {}) => {
    const value = range.resolution ?? range.measuringResolution;
    if (!valuePresent(value)) return "";
    const unitLabel = getUnitDisplayLabel(
        range.resolutionUnit || range.measuringResolutionUnit || getRangeUnit(range, fn),
    );
    return unitLabel ? `${value} ${unitLabel}` : String(value);
};

const TOLERANCE_TYPE_OPTIONS = [
    { key: "reading", label: "IV", title: "Indicated value" },
    { key: "range", label: "% FS", title: "Percent of full scale" },
    { key: "floor", label: "Floor", title: "Absolute floor value" },
    { key: "db", label: "dB", title: "Decibel value" },
    {
        key: "singleSided",
        label: "Single Sided",
        title: "One workbook-style acceptance limit",
    },
];

const TOLERANCE_SHAPE_OPTIONS = [
    {
        key: "symmetric",
        symbol: "±",
        label: "Symmetric",
        detail: "Equal plus and minus limits",
    },
    {
        key: "asymmetric",
        symbol: "+−",
        label: "Asymmetric",
        detail: "Independent plus and minus limits",
    },
];

const finiteNumber = (value) => Number.isFinite(parseFloat(value));

const getToleranceComponent = (tolerance = {}, typeKey) =>
    tolerance?.[typeKey] || null;

const toleranceComponentHasNumericValue = (typeKey, component) => {
    if (!component) return false;
    if (typeKey === "singleSided") return finiteNumber(component.limit);
    if (typeKey === "reading") {
        return (
            finiteNumber(component.value) ||
            finiteNumber(component.high) ||
            finiteNumber(component.low)
        );
    }
    return finiteNumber(component.high) || finiteNumber(component.low);
};

// A single-sided acceptance limit is a distinct workbook tolerance case. It
// cannot be combined with IV / FS / Floor / dB terms on the same range.
const applyToleranceCaseChange = (tolerance = {}, typeKey, component) => {
    const next = { ...tolerance, [typeKey]: component };
    if (!toleranceComponentHasNumericValue(typeKey, component)) {
        return pruneBlankToleranceTerms(next);
    }
    if (typeKey === "singleSided") {
        TOLERANCE_TYPE_OPTIONS.forEach(({ key }) => {
            if (key !== "singleSided") delete next[key];
        });
    } else {
        delete next.singleSided;
    }
    return pruneBlankToleranceTerms(next);
};

const toleranceHasAnyValue = (tolerance = {}) =>
    TOLERANCE_TYPE_OPTIONS.some((opt) =>
        toleranceComponentHasNumericValue(
            opt.key,
            getToleranceComponent(tolerance, opt.key),
        ),
    );

const pruneBlankToleranceTerms = (tolerance = {}) => {
    const next = { ...(tolerance || {}) };
    TOLERANCE_TYPE_OPTIONS.forEach(({ key }) => {
        if (
            Object.prototype.hasOwnProperty.call(next, key) &&
            !toleranceComponentHasNumericValue(key, next[key])
        ) {
            delete next[key];
        }
    });
    if (next.readings_iv) {
        if (!next.floor) next.floor = next.readings_iv;
        delete next.readings_iv;
    }
    return next;
};

const effectiveFloorTerm = (tolerance = {}) => {
    if (tolerance.floor && toleranceComponentHasNumericValue("floor", tolerance.floor)) {
        return tolerance.floor;
    }
    return tolerance.readings_iv || tolerance.floor;
};

const getBuilderBandDivisor = (tolerance = {}) => {
    if (!tolerance || typeof tolerance !== "object") return null;
    const key = BAND_KEYS.find((k) => tolerance[k]);
    if (key) return tolerance[key].distribution || TOLERANCE_DIST_DEFAULT;
    return tolerance.bandDistribution || null;
};

const defaultToleranceComponent = (typeKey, activeRange = {}, tolerance = {}) => {
    const distribution = getBuilderBandDivisor(tolerance) || DISTRIBUTION_NOT_SET;
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
    if (typeKey === "singleSided") {
        return {
            direction: "high",
            measurement: "known",
            limit: "",
            unit: activeRange?.unit || "",
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
    if (typeKey === "reading" && valuePresent(component?.value)) {
        return toPlainNumber(Math.abs(parseFloat(component.value)));
    }
    const raw = component?.[side];
    if (valuePresent(raw)) {
        return toPlainNumber(Math.abs(parseFloat(raw)));
    }
    if (side === "low" && valuePresent(component?.high)) {
        return toPlainNumber(Math.abs(parseFloat(component.high)));
    }
    if (typeKey !== "range" && valuePresent(component?.value)) {
        return toPlainNumber(Math.abs(parseFloat(component.value)));
    }
    return "";
};

const toleranceTermMode = (component = {}) => {
    const high = parseFloat(component?.high);
    const low = parseFloat(component?.low);
    if (!Number.isFinite(high) || !Number.isFinite(low)) return "symmetric";
    const hZero = Math.abs(high) < 1e-12;
    const lZero = Math.abs(low) < 1e-12;
    if (hZero && lZero) return "symmetric";
    if (hZero || lZero) return "single";
    return Math.abs(Math.abs(high) - Math.abs(low)) > 1e-9
        ? "asymmetric"
        : "symmetric";
};

const toleranceShapeOption = (mode) =>
    TOLERANCE_SHAPE_OPTIONS.find((option) => option.key === mode) ||
    TOLERANCE_SHAPE_OPTIONS[0];

const componentUnitLabel = (typeKey, component = {}, activeRange = {}) => {
    if (typeKey === "reading") return "IV";
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

const getBuilderSpecRows = (tolerance = {}) => {
    if (!tolerance) return ["-"];
    if (Array.isArray(tolerance.tolerances) && tolerance.tolerances.length > 0) {
        const rows = [];
        tolerance.tolerances.forEach((t) => rows.push(...getBuilderSpecRows(t)));
        return rows;
    }

    const componentConfig = [
        { key: "reading", tag: "IV" },
        { key: "range", tag: "FS" },
        { key: "floor", tag: "" },
        { key: "db", tag: "", unit: "dB" },
    ];

    const parseComp = (part, unitOverride) => {
        if (!part) return null;
        const hasHL = finiteNumber(part.high) || finiteNumber(part.low);
        const hasVal = finiteNumber(part.value);
        if (!hasHL && !hasVal) return null;
        const unit = unitOverride || part.unit || "";
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

    const tagSuffix = (comp, tag) => {
        const unitLabel = getUnitDisplayLabel(comp.unit || "");
        const join = unitLabel === "%" || unitLabel === "" ? "" : " ";
        const unitPart = `${join}${unitLabel}`;
        return tag ? `${unitPart} ${tag}` : unitPart;
    };

    const termText = (comp, tag, { withSign }) => {
        const suffix = tagSuffix(comp, tag);
        if (comp.symmetric) {
            const sign = withSign ? "±" : "";
            return `${sign}${comp.mag}${suffix}`.trim();
        }
        const body = `+${comp.high}/${comp.low}`;
        return `${withSign ? `(${body})` : body}${suffix}`.trim();
    };

    const present = [];
    let anyAsymmetric = false;
    for (const cfg of componentConfig) {
        const source =
            cfg.key === "floor" ? effectiveFloorTerm(tolerance) : tolerance[cfg.key];
        const comp = parseComp(source, cfg.unit);
        if (!comp) continue;
        present.push({ comp, cfg });
        if (!comp.symmetric) anyAsymmetric = true;
    }

    if (present.length === 0) return [getToleranceSummary(tolerance)];

    if (!anyAsymmetric) {
        if (present.length === 1) {
            return [`± ${termText(present[0].comp, present[0].cfg.tag, { withSign: false })}`];
        }
        const inner = present
            .map((p) => termText(p.comp, p.cfg.tag, { withSign: false }))
            .join(" + ");
        return [`±(${inner})`];
    }

    const inner = present
        .map((p) => termText(p.comp, p.cfg.tag, { withSign: true }))
        .join(" + ");
    return [inner];
};

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
    const [mode, setMode] = useState(() =>
        typeKey === "reading" ? "symmetric" : toleranceTermMode(component),
    );
    const [shapeMenuRect, setShapeMenuRect] = useState(null);
    const shapeButtonRef = useRef(null);
    // Floor-only unit picker (absolute unit vs a ppm/%/ppb adder).
    const [unitMenuRect, setUnitMenuRect] = useState(null);
    const unitButtonRef = useRef(null);
    const [singleNeg, setSingleNeg] = useState(
        () =>
            typeKey !== "reading" &&
            toleranceTermMode(component) === "single" &&
            Math.abs(parseFloat(component?.high) || 0) < 1e-12,
    );

    useEffect(() => {
        const nextMode = typeKey === "reading" ? "symmetric" : toleranceTermMode(component);
        setMode(nextMode);
        setSingleNeg(
            nextMode === "single" &&
                Math.abs(parseFloat(component?.high) || 0) < 1e-12,
        );
    }, [typeKey, activeRange?.id]);

    useEffect(() => {
        setHighValue(componentLimitMagnitude(component, "high", typeKey));
        setLowValue(componentLimitMagnitude(component, "low", typeKey));
        setFullScale(toPlainNumber(component.value ?? activeRange?.max ?? ""));
    }, [typeKey, component.high, component.low, component.value, activeRange?.max]);

    const termMode = typeKey === "reading" ? "symmetric" : mode;
    const currentShape = toleranceShapeOption(termMode);
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
        if (termMode === "symmetric") {
            const magnitude =
                trimmed === "" || Number.isNaN(parsed) ? "" : String(Math.abs(parsed));
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
            next.high =
                trimmed === "" || Number.isNaN(parsed) ? "" : String(Math.abs(parsed));
        } else {
            next.low =
                trimmed === "" || Number.isNaN(parsed)
                    ? ""
                    : String(-Math.abs(parsed));
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

    const changeMode = (nextMode) => {
        setShapeMenuRect(null);
        if (nextMode === termMode) return;
        const curMag = termMode === "single" ? singleValue : highValue;
        const parsed = parseFloat(curMag);
        const mag =
            curMag === "" || Number.isNaN(parsed) ? "" : String(Math.abs(parsed));
        setMode(nextMode);
        setSingleNeg(false);
        if (nextMode === "symmetric") {
            setHighValue(mag);
            setLowValue(mag);
            commit({
                high: mag,
                low: mag === "" ? "" : String(-Math.abs(parsed)),
                symmetric: true,
            });
        } else if (nextMode === "single") {
            setHighValue(mag);
            setLowValue("0");
            if (mag !== "") commit({ high: mag, low: "0", symmetric: false });
        } else {
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

    const toggleUnitMenu = () => {
        if (unitMenuRect) {
            setUnitMenuRect(null);
            return;
        }
        const rect = unitButtonRef.current?.getBoundingClientRect();
        if (rect) setUnitMenuRect(rect);
    };
    // IV and Range/FS can use %, ppm, or ppb. Floor is always the range's
    // physical unit, while dB is fixed.
    const relativeUnitOptions = (() => {
        const native = activeRange?.unit || "";
        const opts = [];
        opts.push({ value: "%", label: "%" });
        opts.push({ value: "ppm", label: "ppm" });
        opts.push({ value: "ppb", label: "ppb" });
        return opts;
    })();
    const activeComponentUnit = component.unit || "%";
    const commitUnit = (unit) => {
        setUnitMenuRect(null);
        if (unit === activeComponentUnit) return;
        commit({ unit });
    };

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
                              top: `${Math.min(
                                  shapeMenuRect.bottom + 6,
                                  window.innerHeight - 132,
                              )}px`,
                              left: `${Math.max(
                                  8,
                                  Math.min(
                                      shapeMenuRect.right - 172,
                                      window.innerWidth - 180,
                                  ),
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

    const unitMenu =
        (typeKey === "reading" || typeKey === "range") && unitMenuRect
            ? ReactDOM.createPortal(
                  <>
                      <div
                          className="inline-tolerance-shape-backdrop"
                          onMouseDown={() => setUnitMenuRect(null)}
                      />
                      <div
                          className="inline-tolerance-shape-menu"
                          style={{
                              top: `${Math.min(
                                  unitMenuRect.bottom + 6,
                                  window.innerHeight - 132,
                              )}px`,
                              left: `${Math.max(
                                  8,
                                  Math.min(
                                      unitMenuRect.right - 132,
                                      window.innerWidth - 140,
                                  ),
                              )}px`,
                          }}
                          onMouseDown={(e) => e.preventDefault()}
                          role="menu"
                      >
                          {relativeUnitOptions.map((option) => (
                              <button
                                  key={option.value}
                                  type="button"
                                  className={`inline-tolerance-shape-option${
                                      option.value === activeComponentUnit ? " is-active" : ""
                                  }`}
                                  onClick={() => commitUnit(option.value)}
                                  role="menuitemradio"
                                  aria-checked={option.value === activeComponentUnit}
                              >
                                  <span className="inline-tolerance-shape-option-copy">
                                      <span>{option.label}</span>
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
                        {showHighSign && (
                            <span className="inline-tolerance-symbol">±</span>
                        )}
                        <input
                            type="text"
                            inputMode="decimal"
                            value={highValue}
                            placeholder="0"
                            onChange={(e) => setHighValue(e.target.value)}
                            onBlur={(e) => commitLimit("high", e.target.value)}
                            onKeyDown={(e) =>
                                e.key === "Enter" && e.currentTarget.blur()
                            }
                            className="inline-tolerance-input"
                            style={toleranceInputStyleFor(highValue)}
                        />
                    </>
                )}
                {termMode === "single" && (
                    <>
                        {showHighSign && (
                            <span className="inline-tolerance-symbol">+</span>
                        )}
                        {singleNeg ? (
                            <span
                                className="inline-tolerance-zero"
                                title="Upper limit is 0"
                            >
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
                                onKeyDown={(e) =>
                                    e.key === "Enter" && e.currentTarget.blur()
                                }
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
                                onKeyDown={(e) =>
                                    e.key === "Enter" && e.currentTarget.blur()
                                }
                                className="inline-tolerance-input"
                                style={toleranceInputStyleFor(singleValue)}
                            />
                        ) : (
                            <span
                                className="inline-tolerance-zero"
                                title="Lower limit is 0"
                            >
                                0
                            </span>
                        )}
                        <button
                            type="button"
                            className="inline-tolerance-dir-toggle"
                            title="Swap which side the limit applies to"
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
                        {showHighSign && (
                            <span className="inline-tolerance-symbol">+</span>
                        )}
                        <input
                            type="text"
                            inputMode="decimal"
                            value={highValue}
                            placeholder="0"
                            onChange={(e) => setHighValue(e.target.value)}
                            onBlur={(e) => commitLimit("high", e.target.value)}
                            onKeyDown={(e) =>
                                e.key === "Enter" && e.currentTarget.blur()
                            }
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
                            onKeyDown={(e) =>
                                e.key === "Enter" && e.currentTarget.blur()
                            }
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
            {typeLabel &&
                (typeKey === "reading" || typeKey === "range" ? (
                    <>
                        <button
                            ref={unitButtonRef}
                            type="button"
                            className={`inline-tolerance-chip inline-tolerance-chip--in-cell inline-tolerance-chip--button${
                                unitMenuRect ? " is-open" : ""
                            }`}
                            title={`${typeKey === "reading" ? "IV" : "Range/FS"} unit - click to change`}
                            aria-haspopup="menu"
                            aria-expanded={Boolean(unitMenuRect)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={toggleUnitMenu}
                        >
                            <span>{typeKey === "reading" ? `IV ${activeComponentUnit}` : `${activeComponentUnit} FS`}</span>
                            <FontAwesomeIcon icon={faChevronDown} size="xs" />
                        </button>
                        {unitMenu}
                    </>
                ) : (
                    <span
                        className={`inline-tolerance-chip inline-tolerance-chip--in-cell${
                            typeKey === "floor" || typeKey === "db" ? " inline-tolerance-chip--static" : ""
                        }`}
                        title={typeOption?.title || typeLabel}
                    >
                        {typeLabel}
                    </span>
                ))}
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
                        onKeyDown={(e) =>
                            e.key === "Enter" && e.currentTarget.blur()
                        }
                        className="inline-tolerance-input inline-tolerance-input--fs"
                        style={toleranceInputStyleFor(fullScale, {
                            minCh: 6,
                            maxCh: 14,
                        })}
                    />
                    <span>{getUnitDisplayLabel(activeRange?.unit || "")}</span>
                    <span>)</span>
                </span>
            )}
        </span>
    );
};

// Workbook single-sided tolerances are their own case: a High or Low limit and
// either a known or unknown measurement. This mirrors the inline editor rather
// than representing a threshold as a special IV/FS/Floor term.
const BuilderSingleSidedToleranceEditor = ({
    tolerance = {},
    activeRange = {},
    onCommit,
}) => {
    const stored = getToleranceComponent(tolerance, "singleSided");
    const component = stored || defaultToleranceComponent("singleSided", activeRange, tolerance);
    const [direction, setDirection] = useState(component.direction === "low" ? "low" : "high");
    const [measurement, setMeasurement] = useState(
        component.measurement === "unknown" ? "unknown" : "known",
    );
    const [limit, setLimit] = useState(() => toPlainNumber(component.limit));
    const [menuRect, setMenuRect] = useState(null);
    const menuButtonRef = useRef(null);

    useEffect(() => {
        if (!stored) return;
        setDirection(stored.direction === "low" ? "low" : "high");
        setMeasurement(stored.measurement === "unknown" ? "unknown" : "known");
        setLimit(toPlainNumber(stored.limit));
    }, [activeRange?.id, stored?.direction, stored?.measurement, stored?.limit]);

    const commit = (patch = {}) =>
        onCommit("singleSided", {
            ...defaultToleranceComponent("singleSided", activeRange, tolerance),
            ...component,
            direction,
            measurement,
            unit: component.unit || activeRange?.unit || "",
            ...patch,
        });
    const chooseDirection = (next) => {
        setMenuRect(null);
        setDirection(next);
        commit({ direction: next });
    };
    const chooseMeasurement = (next) => {
        setMeasurement(next);
        commit({ measurement: next });
    };
    const toggleMenu = () => {
        if (menuRect) return setMenuRect(null);
        const rect = menuButtonRef.current?.getBoundingClientRect();
        if (rect) setMenuRect(rect);
    };
    const directionMenu = menuRect
        ? ReactDOM.createPortal(
              <>
                  <div
                      className="inline-tolerance-shape-backdrop"
                      onMouseDown={() => setMenuRect(null)}
                  />
                  <div
                      className="inline-tolerance-shape-menu"
                      style={{
                          top: `${Math.min(menuRect.bottom + 6, window.innerHeight - 100)}px`,
                          left: `${Math.max(8, Math.min(menuRect.left, window.innerWidth - 140))}px`,
                      }}
                      onMouseDown={(event) => event.preventDefault()}
                      role="menu"
                  >
                      {["low", "high"].map((option) => (
                          <button
                              key={option}
                              type="button"
                              className={`inline-tolerance-shape-option${option === direction ? " is-active" : ""}`}
                              onClick={() => chooseDirection(option)}
                              role="menuitemradio"
                              aria-checked={option === direction}
                              aria-label={option === "low" ? "Low" : "High"}
                          >
                              <span className="inline-tolerance-shape-option-copy">
                                  <span>{option === "low" ? "Low (≥ lower limit)" : "High (≤ upper limit)"}</span>
                              </span>
                          </button>
                      ))}
                  </div>
              </>,
              document.body,
          )
        : null;
    const unit = getUnitDisplayLabel(component.unit || activeRange?.unit || "");
    const limitLabel = direction === "low" ? "Lower limit" : "Upper limit";

    return (
        <span className="inline-tolerance-term inline-tolerance-term--single-sided">
            <span className="inline-tolerance-single-sided-header">
                <button
                    ref={menuButtonRef}
                    type="button"
                    className={`inline-tolerance-chip inline-tolerance-chip--in-cell inline-tolerance-chip--button${menuRect ? " is-open" : ""}`}
                    aria-label="Single-sided direction"
                    aria-haspopup="menu"
                    aria-expanded={Boolean(menuRect)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={toggleMenu}
                >
                    {`Single Sided ${direction === "low" ? "Low" : "High"}`}
                    <FontAwesomeIcon icon={faChevronDown} size="xs" />
                </button>
            </span>
            {directionMenu}
            {[{ value: "known", label: "Measurement known" }, { value: "unknown", label: "Measurement unknown" }].map(({ value, label }) => {
                const selected = measurement === value;
                return (
                    <div key={value} className={`builder-single-sided-row${selected ? " is-selected" : ""}`}>
                        <label className="builder-single-sided-choice">
                            <input
                                type="radio"
                                name={`builder-single-sided-measurement-${activeRange?.id || "new"}`}
                                checked={selected}
                                onChange={() => chooseMeasurement(value)}
                            />
                            <span>{label}</span>
                        </label>
                        <span className="builder-single-sided-limits">
                            <span
                                className={`inline-tolerance-symbol builder-single-sided-symbol ${
                                    direction === "low" ? "is-low" : "is-high"
                                }`}
                                title={limitLabel}
                            >
                                {direction === "low" ? "â‰¥" : "â‰¤"}
                            </span>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={selected ? limit : ""}
                                aria-label={`${label} ${limitLabel}`}
                                disabled={!selected}
                                onChange={(event) => setLimit(event.target.value)}
                                onBlur={(event) => commit({ limit: event.target.value.trim() })}
                                onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                                className="inline-tolerance-input builder-single-sided-input"
                            />
                        </span>
                        {unit && <span className="builder-single-sided-unit">{unit}</span>}
                    </div>
                );
            })}
        </span>
    );
};

const BuilderRangeCell = ({
    range = {},
    fn = {},
    unitOptions = [],
    onPatch,
}) => {
    const [editing, setEditing] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!editing || !ref.current) return;
        ref.current.querySelector("input")?.focus();
    }, [editing]);

    const handleBlur = (event) => {
        const next = event.relatedTarget;
        if (next instanceof Element && ref.current?.contains(next)) return;
        if (next instanceof Element && next.closest(".inline-unit-menu")) return;
        setEditing(false);
    };

    const summary = formatBuilderRangeSummary(range, fn);
    const isSingle = !!range.isSingleValue;
    const singleValue = range.value ?? range.max ?? range.min ?? "";

    if (!editing) {
        return (
            <span className="inline-tolerance-readview builder-inline-readview">
                <button
                    type="button"
                    className={`inline-tolerance-summary${summary ? "" : " is-empty"}`}
                    title={summary ? "Click to edit range" : "Click to set a range"}
                    onClick={(e) => {
                        e.stopPropagation();
                        setEditing(true);
                    }}
                >
                    {summary || "Set range..."}
                </button>
                <button
                    type="button"
                    className="range-expand-btn"
                    title="Edit range"
                    aria-label="Edit range"
                    onClick={(e) => {
                        e.stopPropagation();
                        setEditing(true);
                    }}
                >
                    <FontAwesomeIcon icon={faChevronDown} size="xs" />
                    <span className="range-expand-btn-label">edit / add</span>
                </button>
            </span>
        );
    }

    return (
        <div
            ref={ref}
            className="builder-inline-range-editor"
            onMouseDown={(e) => e.stopPropagation()}
            onBlur={handleBlur}
        >
            <button
                type="button"
                className="inline-range-mode-toggle"
                title={isSingle ? "Switch to min-max range" : "Switch to single value"}
                aria-label={isSingle ? "Switch to min-max range" : "Switch to single value"}
                onClick={() => {
                    if (isSingle) {
                        onPatch({ isSingleValue: false });
                    } else {
                        const value = range.value ?? range.max ?? range.min ?? "";
                        onPatch({ isSingleValue: true, value, min: value, max: value });
                    }
                }}
            >
                {isSingle ? "↔" : "•"}
            </button>
            {isSingle ? (
                <input
                    type="text"
                    inputMode="decimal"
                    defaultValue={toPlainNumber(singleValue)}
                    placeholder="value"
                    className="inline-tolerance-input inline-range-bound-input"
                    onBlur={(e) =>
                        onPatch({
                            isSingleValue: true,
                            value: e.target.value,
                            min: e.target.value,
                            max: e.target.value,
                        })
                    }
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
            ) : (
                <>
                    <input
                        type="text"
                        inputMode="decimal"
                        defaultValue={toPlainNumber(range.min)}
                        placeholder="min"
                        className="inline-tolerance-input inline-range-bound-input"
                        onBlur={(e) => onPatch({ min: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    />
                    <span className="builder-inline-dash">-</span>
                    <input
                        type="text"
                        inputMode="decimal"
                        defaultValue={toPlainNumber(range.max)}
                        placeholder="max"
                        className="inline-tolerance-input inline-range-bound-input"
                        onBlur={(e) => onPatch({ max: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    />
                </>
            )}
            <BuilderUnitSelect
                value={getRangeUnit(range, fn)}
                onChange={(unit) => onPatch({ unit })}
                options={unitOptions}
                ariaLabel="Range unit"
                width="72px"
            />
        </div>
    );
};

const BuilderToleranceCell = ({
    range = {},
    fn = {},
    onToleranceComponentCommit,
}) => {
    const [editing, setEditing] = useState(false);
    const ref = useRef(null);
    const tolerance = range.tolerances || {};
    const activeRange = { ...range, unit: getRangeUnit(range, fn) };
    const summary = getBuilderSpecRows(tolerance)[0] || "";
    const hasValue = toleranceHasAnyValue(tolerance);

    useEffect(() => {
        if (!editing || !ref.current) return;
        ref.current.querySelector("input")?.focus();
    }, [editing]);

    const handleBlur = (event) => {
        const next = event.relatedTarget;
        if (next instanceof Element && ref.current?.contains(next)) return;
        setEditing(false);
    };

    if (editing) {
        return (
            <div
                ref={ref}
                className="inline-tolerance-editor inline-tolerance-editor--all builder-inline-tolerance-editor"
                onMouseDown={(e) => e.stopPropagation()}
                onBlur={handleBlur}
            >
                {TOLERANCE_TYPE_OPTIONS.map((opt) => (
                    <span key={opt.key} className="inline-tolerance-term-group">
                        {opt.key === "singleSided" ? (
                            <BuilderSingleSidedToleranceEditor
                                tolerance={tolerance}
                                activeRange={activeRange}
                                onCommit={onToleranceComponentCommit}
                            />
                        ) : (
                            <ToleranceTermEditor
                                tolerance={tolerance}
                                activeRange={activeRange}
                                typeKey={opt.key}
                                showHighSign
                                onCommit={onToleranceComponentCommit}
                            />
                        )}
                    </span>
                ))}
            </div>
        );
    }

    return (
        <span className="inline-tolerance-readview builder-inline-readview">
            <button
                type="button"
                className={`inline-tolerance-summary${hasValue ? "" : " is-empty"}`}
                title={hasValue ? "Click to edit tolerance" : "Click to set a tolerance"}
                aria-label={hasValue ? undefined : "Set tolerance"}
                onClick={(e) => {
                    e.stopPropagation();
                    setEditing(true);
                }}
            >
                {hasValue ? summary : "\u00a0"}
            </button>
        </span>
    );
};

const BuilderDistributionCell = ({ value, onChange }) => {
    const [editing, setEditing] = useState(false);
    const ref = useRef(null);
    const divisor = value ? String(value) : null;
    const label = divisor ? getDistributionLabel(divisor, `k=${divisor}`) : "-";

    useEffect(() => {
        if (editing) ref.current?.querySelector("button")?.focus();
    }, [editing]);

    if (!divisor) {
        return <span className="range-ghost-hint">-</span>;
    }

    if (!editing) {
        return (
            <span className="inline-tolerance-readview builder-inline-readview">
                <button
                    type="button"
                    className="inline-tolerance-summary"
                    title="Click to edit distribution"
                    onClick={(e) => {
                        e.stopPropagation();
                        setEditing(true);
                    }}
                >
                    {label}
                </button>
            </span>
        );
    }

    return (
        <span
            ref={ref}
            className="inline-distribution-editor"
            onBlur={(event) => {
                if (event.relatedTarget && ref.current?.contains(event.relatedTarget)) return;
                setEditing(false);
            }}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <InlineMenuSelect
                value={divisor}
                options={errorDistributions}
                ariaLabel="Spec band distribution"
                title="Distribution used for this tolerance band"
                onChange={(value) => {
                    onChange(value);
                    setEditing(false);
                }}
                width="118px"
                menuWidth={240}
                className="inline-distribution-select"
            />
        </span>
    );
};

const BuilderResolutionCell = ({
    range = {},
    fn = {},
    unitOptions = [],
    onPatch,
}) => {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(() =>
        toPlainNumber(range.resolution ?? range.measuringResolution),
    );
    const ref = useRef(null);

    useEffect(() => {
        setValue(toPlainNumber(range.resolution ?? range.measuringResolution));
    }, [range.resolution, range.measuringResolution]);

    useEffect(() => {
        if (!editing || !ref.current) return;
        ref.current.querySelector("input")?.focus();
    }, [editing]);

    const summary = formatResolutionSummary(range, fn);
    const selectedUnitValue =
        range.resolutionUnit || range.measuringResolutionUnit || getRangeUnit(range, fn);
    const distribution =
        range.resolutionDistribution ??
        range.measuringResolutionDistribution ??
        RESOLUTION_DIST_DEFAULT;

    if (!editing) {
        return (
            <span className="inline-tolerance-readview builder-inline-readview">
                <button
                    type="button"
                    className={`inline-tolerance-summary${summary ? "" : " is-empty"}`}
                    title={summary ? "Click to edit resolution" : "Click to set a resolution"}
                    aria-label={summary ? undefined : "Set resolution"}
                    onClick={(e) => {
                        e.stopPropagation();
                        setEditing(true);
                    }}
                >
                    {summary || "\u00a0"}
                </button>
            </span>
        );
    }

    return (
        <span
            ref={ref}
            className="builder-inline-resolution-editor"
            onMouseDown={(e) => e.stopPropagation()}
            onBlur={(event) => {
                const next = event.relatedTarget;
                if (next instanceof Element && ref.current?.contains(next)) return;
                if (next instanceof Element && next.closest(".inline-unit-menu")) return;
                setEditing(false);
            }}
        >
            <input
                type="text"
                inputMode="decimal"
                value={value}
                placeholder="-"
                className="inline-tolerance-input inline-resolution-input"
                onChange={(e) => setValue(e.target.value)}
                onBlur={(e) => onPatch({ resolution: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <BuilderUnitSelect
                value={selectedUnitValue}
                onChange={(unit) =>
                    onPatch({
                        resolutionUnit: unit,
                        measuringResolutionUnit: unit,
                    })
                }
                options={unitOptions}
                ariaLabel="Resolution unit"
                width="72px"
            />
            <InlineMenuSelect
                value={distribution}
                options={errorDistributions}
                ariaLabel="Resolution distribution"
                title="Distribution used when this resolution enters a budget"
                onChange={(value) =>
                    onPatch({
                        resolutionDistribution: value,
                        measuringResolutionDistribution: value,
                    })
                }
                width="72px"
                menuWidth={220}
                className="inline-resolution-dist inline-unit-like-selector inline-distribution-select"
            />
        </span>
    );
};

const DEFAULT_MEASUREMENT_AREA_NAME = "Unassigned";
const DEFAULT_MEASUREMENT_AREA_COLOR = "#3498db";

const getComparableLibraryInstrument = (instrument) => ({
    manufacturer: instrument?.manufacturer || "",
    model: instrument?.model || "",
    functions: instrument?.functions || []
});

const instrumentsMatch = (a, b) =>
    JSON.stringify(getComparableLibraryInstrument(a)) ===
    JSON.stringify(getComparableLibraryInstrument(b));

const hasValidatedSnapshot = (instrument = {}) =>
    instrument.validatedSnapshot != null &&
    typeof instrument.validatedSnapshot === "object" &&
    Object.keys(instrument.validatedSnapshot).length > 0;

const getInstrumentSourceStatus = (instrument = {}, linkedInstrument = null) => {
    const explicitScope = instrument?.scope;
    const linkedScope = linkedInstrument?.scope;
    const isShared =
        explicitScope === "validated" ||
        (!explicitScope && linkedScope === "validated") ||
        (linkedScope === "validated" && instrumentsMatch(instrument, linkedInstrument));

    if (isShared) {
        return {
            label: "Shared",
            tone: "shared",
            title: "Shared library instrument"
        };
    }

    const isLinkedLocal =
        Boolean(instrument?.sourceId) ||
        hasValidatedSnapshot(instrument) ||
        Boolean(linkedInstrument?.sourceId) ||
        hasValidatedSnapshot(linkedInstrument || {});

    // A linked instrument that still matches its captured validated snapshot is
    // in sync with the shared library (green link) even if this record is
    // scope:"local" — e.g. a synced instrument whose shared origin isn't in
    // this list, or one demoted by a legacy save. Reflect the synced state
    // instead of mislabeling it "Local". Requires a real snapshot to match, so
    // a merely-linked (never-synced) copy still reads "Local".
    const isSynced =
        hasValidatedSnapshot(instrument) &&
        diffFromSnapshot(instrument).length === 0;
    if (isSynced) {
        return {
            label: "Synced",
            tone: "shared",
            title: "In sync with the shared library"
        };
    }

    return {
        label: "Local",
        tone: "local",
        title: isLinkedLocal
            ? "Local instrument linked to a shared origin"
            : "Local instrument"
    };
};

const syncDiffSummary = (diffs = []) => {
    if (!diffs.length) return "This instrument will be promoted to the shared library.";
    return `Changed shared-library fields: ${diffs.map((diff) => diff.field).join(", ")}.`;
};

const InstrumentSourceBadge = ({ instrument, linkedInstrument = null }) => {
    const status = getInstrumentSourceStatus(instrument, linkedInstrument);
    return (
        <span
            className={`instrument-source-badge instrument-source-badge--${status.tone}`}
            title={status.title}
            aria-label={`Instrument source: ${status.label}`}
        >
            {status.label}
        </span>
    );
};

const UniversalInstrumentModal = ({
    isOpen,
    onClose,
    onSave,
    onSaveToLibrary,
    onDelete,
    onBatchAdd,
    onInstrumentSynced,
    mode = 'library', // 'uut', 'tmde', 'library'
    initialData = null,
    instruments = []
}) => {
    const [viewMode, setViewMode] = useState("edit");
    const [effectiveMode, setEffectiveMode] = useState(mode);

    const [searchTerm, setSearchTerm] = useState("");
    const [expandedDetail, setExpandedDetail] = useState(null);

    // Library list multi-select: ids of checked rows + the anchor for shift-range.
    const [selectedIds, setSelectedIds] = useState([]);
    const [selectionAnchor, setSelectionAnchor] = useState(null);
    // Delete confirmation. Routed through one choke-point so a password gate can
    // be added here later without touching the call sites.
    const [pendingDelete, setPendingDelete] = useState(null); // { ids: [...] }
    const [pendingSync, setPendingSync] = useState(null);
    const [syncNotice, setSyncNotice] = useState(null);
    const [pendingInstrumentSave, setPendingInstrumentSave] = useState(false);
    // Password prompt for writing an instrument to the validated (shared) library
    // from the builder. Any save that promotes/updates the shared definition is
    // password-gated by the backend, so it must be collected here first.
    const [pendingLibraryPassword, setPendingLibraryPassword] = useState(false);
    const [libraryPasswordError, setLibraryPasswordError] = useState("");
    const [libraryInstrumentId, setLibraryInstrumentId] = useState(null);
    const [initialInstrumentSignature, setInitialInstrumentSignature] = useState("");

    const [metaData, setMetaData] = useState({
        name: "", 
        measurementArea: DEFAULT_MEASUREMENT_AREA_NAME,
        measurementAreaId: "",
        measurementAreaColor: DEFAULT_MEASUREMENT_AREA_COLOR, 
        quantity: 1, 
        assetId: "" 
    });

    const [instrumentDef, setInstrumentDef] = useState({
        id: uuidv4(),
        manufacturer: "",
        model: "",
        description: "",
        scope: "local",
        functions: [],
        typeBComponents: []
    });

    const [activeFunctionId, setActiveFunctionId] = useState(null);
    const [activeTypeBId, setActiveTypeBId] = useState(null);
    const builderUndoHistoryRef = useRef([]);
    const builderUndoSnapshotRef = useRef(null);
    const builderUndoStateRef = useRef(null);
    const builderUndoReadyRef = useRef(false);
    const builderApplyingUndoRef = useRef(false);

    const { position, handleMouseDown } = useFloatingWindow({
        isOpen,
        defaultWidth: 1100,
        defaultHeight: 850
    });
    const { syncToShared, getDiff } = useInstrumentSync(onInstrumentSynced);

    useEffect(() => {
        if (isOpen) {
            setSearchTerm("");
            setExpandedDetail(null);
            setSelectedIds([]);
            setSelectionAnchor(null);
            setPendingDelete(null);
            setPendingSync(null);
            setSyncNotice(null);
            setPendingInstrumentSave(false);
            setPendingLibraryPassword(false);
            setLibraryPasswordError("");

            if (mode === 'library') {
                setViewMode("list");
            } else {
                setViewMode("edit");
            }
            setEffectiveMode(mode);

            if (initialData) {
                setViewMode("edit");
                const loadedInst = initialData.instrument || (initialData.functions ? initialData : null) || {
                    id: uuidv4(), manufacturer: "", model: "", description: "", scope: "local", functions: [], typeBComponents: []
                };
                const existingLibraryId =
                    initialData.libraryInstrumentId ||
                    loadedInst.libraryInstrumentId ||
                    (instruments.some((instrument) => instrument.id === loadedInst.id)
                        ? loadedInst.id
                        : null);
                const normalizedLoadedInst = {
                    ...loadedInst,
                    functions: normalizeBuilderFunctions(loadedInst.functions),
                };
                setLibraryInstrumentId(existingLibraryId);
                setInitialInstrumentSignature(
                    JSON.stringify(getComparableLibraryInstrument(normalizedLoadedInst))
                );
                setInstrumentDef(JSON.parse(JSON.stringify(normalizedLoadedInst)));
                if (normalizedLoadedInst.functions?.length > 0) setActiveFunctionId(normalizedLoadedInst.functions[0].id);
                else setActiveFunctionId(null);
                setActiveTypeBId(loadedInst.typeBComponents?.[0]?.id || null);

                setMetaData({
                    name: initialData.description || initialData.name || "",
                    measurementArea: initialData.measurementArea || DEFAULT_MEASUREMENT_AREA_NAME,
                    measurementAreaId: initialData.measurementAreaId || "",
                    measurementAreaColor: initialData.measurementAreaColor || DEFAULT_MEASUREMENT_AREA_COLOR,
                    quantity: initialData.quantity || 1,
                    assetId: initialData.assetId || ""
                });
            } else {
                setLibraryInstrumentId(null);
                setInitialInstrumentSignature(
                    JSON.stringify(getComparableLibraryInstrument({
                        manufacturer: "",
                        model: "",
                        functions: []
                    }))
                );
                setMetaData({
                    name: "",
                    measurementArea: DEFAULT_MEASUREMENT_AREA_NAME,
                    measurementAreaId: "",
                    measurementAreaColor: DEFAULT_MEASUREMENT_AREA_COLOR,
                    quantity: 1,
                    assetId: ""
                });
                setInstrumentDef({ id: uuidv4(), manufacturer: "", model: "", description: "", scope: "local", functions: [], typeBComponents: [] });
                setActiveFunctionId(null);
                setActiveTypeBId(null);
            }
        }
    }, [isOpen, initialData, mode]);

    // The app-level shortcut deliberately yields while this editor is open, so
    // the builder owns its own snapshot history. This captures button/menu
    // actions as well as committed field edits without ever undoing the session
    // behind the modal.
    useEffect(() => {
        const snapshot = {
            instrumentDef,
            metaData,
            activeFunctionId,
            activeTypeBId,
        };
        builderUndoStateRef.current = snapshot;
        if (!builderUndoReadyRef.current) return;

        if (builderApplyingUndoRef.current) {
            builderApplyingUndoRef.current = false;
            builderUndoSnapshotRef.current = JSON.parse(JSON.stringify(snapshot));
            return;
        }

        const previous = builderUndoSnapshotRef.current;
        const dataChanged = previous && (
            JSON.stringify(previous.instrumentDef) !== JSON.stringify(snapshot.instrumentDef) ||
            JSON.stringify(previous.metaData) !== JSON.stringify(snapshot.metaData)
        );
        if (dataChanged) {
            builderUndoHistoryRef.current.push(previous);
            if (builderUndoHistoryRef.current.length > MAX_BUILDER_UNDO_STEPS) {
                builderUndoHistoryRef.current.splice(
                    0,
                    builderUndoHistoryRef.current.length - MAX_BUILDER_UNDO_STEPS,
                );
            }
        }
        builderUndoSnapshotRef.current = JSON.parse(JSON.stringify(snapshot));
    }, [activeFunctionId, activeTypeBId, instrumentDef, metaData]);

    useEffect(() => {
        builderUndoReadyRef.current = false;
        builderUndoHistoryRef.current = [];
        builderUndoSnapshotRef.current = null;
        if (!isOpen) return undefined;

        // Let the modal's initialization effect finish loading initialData
        // before establishing the first (non-undoable) baseline.
        const timer = window.setTimeout(() => {
            const baseline = builderUndoStateRef.current;
            builderUndoSnapshotRef.current = baseline
                ? JSON.parse(JSON.stringify(baseline))
                : null;
            builderUndoReadyRef.current = true;
        }, 0);
        return () => window.clearTimeout(timer);
    }, [initialData, isOpen, mode]);

    useEffect(() => {
        if (!isOpen || viewMode !== "edit") return undefined;
        const handleBuilderUndo = (event) => {
            const key = String(event.key || "").toLowerCase();
            if (
                !(event.ctrlKey || event.metaKey) ||
                event.altKey ||
                event.shiftKey ||
                key !== "z"
            ) {
                return;
            }

            const active = document.activeElement;
            const isTextEntry =
                active?.tagName === "INPUT" ||
                active?.tagName === "TEXTAREA" ||
                active?.isContentEditable;
            if (isTextEntry) return; // retain the browser's native typing undo

            const previous = builderUndoHistoryRef.current.pop();
            if (!previous) return;
            event.preventDefault();
            builderApplyingUndoRef.current = true;
            builderUndoSnapshotRef.current = JSON.parse(JSON.stringify(previous));
            setInstrumentDef(previous.instrumentDef);
            setMetaData(previous.metaData);
            setActiveFunctionId(previous.activeFunctionId);
            setActiveTypeBId(previous.activeTypeBId);
        };
        window.addEventListener("keydown", handleBuilderUndo);
        return () => window.removeEventListener("keydown", handleBuilderUndo);
    }, [isOpen, viewMode]);

    const filteredInstruments = useMemo(() => {
        if (!searchTerm) return instruments;
        const lower = searchTerm.toLowerCase();
        return instruments.filter(i =>
            (i.manufacturer || "").toLowerCase().includes(lower) ||
            (i.model || "").toLowerCase().includes(lower) ||
            (i.description || "").toLowerCase().includes(lower)
        );
    }, [instruments, searchTerm]);

    const selectedInstrument = useMemo(
        () =>
            selectedIds.length === 1
                ? instruments.find((instrument) => instrument.id === selectedIds[0]) || null
                : null,
        [instruments, selectedIds],
    );

    const linkedSharedFor = useCallback(
        (instrument) => {
            const sourceId =
                instrument?.sourceId ||
                instrument?.libraryInstrumentId ||
                (instrument?.scope === "validated" ? instrument.id : null);
            if (!sourceId) return null;
            return instruments.find(
                (candidate) =>
                    candidate.scope === "validated" &&
                    String(candidate.id) === String(sourceId),
            ) || null;
        },
        [instruments],
    );

    const activeFunction = useMemo(() => 
        (instrumentDef.functions || []).find(f => f.id === activeFunctionId), 
    [instrumentDef.functions, activeFunctionId]);

    const typeBComponents = useMemo(
        () => (Array.isArray(instrumentDef.typeBComponents) ? instrumentDef.typeBComponents : []),
        [instrumentDef.typeBComponents],
    );

    const allUnitsRaw = useMemo(() => Object.keys(unitSystem.units), []);
    const categorizedUnitOptions = useMemo(() => {
        return getCategorizedUnitOptions(allUnitsRaw, activeFunction?.unit);
    }, [allUnitsRaw, activeFunction?.unit]);

    const modalTitle = useMemo(() => {
        if (effectiveMode === 'uut') return initialData ? "Edit UUT" : "Add New UUT";
        if (effectiveMode === 'tmde') return initialData ? "Edit TMDE" : "Add New TMDE";
        return "Instrument Manager";
    }, [effectiveMode, initialData]);

    const modeIcon = effectiveMode === 'uut' ? faMicroscope : (effectiveMode === 'tmde' ? faTools : faBookOpen);

    const isFormValid = useMemo(() => {
        // Mfr. + Model define the instrument; the trailing Name token is optional
        // (mirrors the inline tables, where a name/label is not required).
        if (!instrumentDef.manufacturer?.trim()) return false;
        if (!instrumentDef.model?.trim()) return false;
        return true;
    }, [instrumentDef.manufacturer, instrumentDef.model]);

    const isInstrumentInLibrary = useMemo(
        () => instruments.some(
            (instrument) =>
                instrument.id === libraryInstrumentId ||
                instrument.id === instrumentDef.id
        ),
        [instruments, libraryInstrumentId, instrumentDef.id]
    );

    const linkedLibraryInstrument = useMemo(
        () => instruments.find(
            (instrument) =>
                instrument.id === libraryInstrumentId ||
                instrument.id === instrumentDef.id
        ) || null,
        [instruments, libraryInstrumentId, instrumentDef.id]
    );

    const hasLibraryChanges = useMemo(() => {
        if (!linkedLibraryInstrument) return false;
        return JSON.stringify(getComparableLibraryInstrument(instrumentDef)) !==
            initialInstrumentSignature;
    }, [initialInstrumentSignature, instrumentDef, linkedLibraryInstrument]);

    // --- Library list multi-select (ctrl = toggle, shift = range) ---
    const handleRowSelect = (e, instId) => {
        // Move keyboard ownership from the auto-focused search box to the row
        // the user just selected. This makes Delete unambiguously target the
        // selected instrument while preserving native Delete inside search.
        e.currentTarget?.focus?.();
        const visibleIds = filteredInstruments.map((i) => i.id);
        const targetIdx = visibleIds.indexOf(instId);

        if (e.shiftKey && selectionAnchor) {
            const anchorIdx = visibleIds.indexOf(selectionAnchor);
            if (anchorIdx !== -1 && targetIdx !== -1) {
                const [lo, hi] =
                    anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
                const run = visibleIds.slice(lo, hi + 1);
                setSelectedIds(
                    e.ctrlKey || e.metaKey
                        ? Array.from(new Set([...selectedIds, ...run]))
                        : run,
                );
                return;
            }
        }
        if (e.ctrlKey || e.metaKey) {
            setSelectedIds((prev) =>
                prev.includes(instId)
                    ? prev.filter((x) => x !== instId)
                    : [...prev, instId],
            );
            setSelectionAnchor(instId);
            return;
        }
        // Plain click toggles a single selection (click again to clear).
        setSelectedIds((prev) =>
            prev.length === 1 && prev[0] === instId ? [] : [instId],
        );
        setSelectionAnchor(instId);
    };

    // Single delete choke-point — a password gate can wrap confirmDelete later.
    const requestDelete = (ids) => {
        const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
        if (list.length) setPendingDelete({ ids: list });
    };

    // The modal owns Delete while open. In library-list mode it follows the
    // existing toolbar delete path for the selected instruments; everywhere
    // else it simply prevents a stale analysis selection behind the modal from
    // receiving the key. Native text deletion remains untouched in editors.
    useEffect(() => {
        if (!isOpen) return undefined;
        const handleDeleteKey = (event) => {
            if (event.key !== "Delete") return;
            const active = document.activeElement;
            if (
                active &&
                (active.tagName === "INPUT" ||
                    active.tagName === "TEXTAREA" ||
                    active.isContentEditable)
            ) {
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();
            if (
                viewMode === "list" &&
                selectedIds.length > 0 &&
                onDelete &&
                !pendingDelete
            ) {
                setPendingDelete({ ids: [...selectedIds] });
            }
        };

        window.addEventListener("keydown", handleDeleteKey, true);
        return () => window.removeEventListener("keydown", handleDeleteKey, true);
    }, [isOpen, onDelete, pendingDelete, selectedIds, viewMode]);

    const confirmDelete = async () => {
        const ids = pendingDelete?.ids || [];
        // NOTE: insert password verification here when that feature lands.
        for (const id of ids) {
            // eslint-disable-next-line no-await-in-loop
            await onDelete?.(id);
        }
        setSelectedIds((prev) => prev.filter((x) => !ids.includes(x)));
        setPendingDelete(null);
    };

    const requestSync = (instrument) => {
        if (!instrument) return;
        const state = computeSyncState(instrument);
        const label = `${instrument.manufacturer || ""} ${instrument.model || ""}`.trim() ||
            instrument.description ||
            "this instrument";
        if (state === "green") {
            setSyncNotice({
                title: "Already Synced",
                message: `${label} already matches the shared library snapshot.`,
            });
            return;
        }
        setPendingSync({ instrument, label });
    };

    const confirmSync = async (password) => {
        if (!pendingSync?.instrument) return;
        const result = await syncToShared(pendingSync.instrument, password);
        if (result.ok && result.instrument) {
            const synced = result.instrument;
            setSelectedIds([synced.id]);
            setSelectionAnchor(synced.id);
            setLibraryInstrumentId(synced.id);
            setInstrumentDef((prev) => {
                const prevSourceId = prev.sourceId || prev.libraryInstrumentId || prev.id;
                const pendingSourceId =
                    pendingSync.instrument.sourceId ||
                    pendingSync.instrument.libraryInstrumentId ||
                    pendingSync.instrument.id;
                if (
                    String(prev.id) === String(pendingSync.instrument.id) ||
                    String(prevSourceId) === String(pendingSourceId) ||
                    String(prevSourceId) === String(synced.id)
                ) {
                    return {
                        ...synced,
                        measurementArea:
                            prev.measurementArea || synced.measurementArea || "",
                        measurementAreaColor:
                            prev.measurementAreaColor ||
                            synced.measurementAreaColor ||
                            "",
                    };
                }
                return prev;
            });
            setInitialInstrumentSignature(
                JSON.stringify(getComparableLibraryInstrument(synced)),
            );
            setPendingSync(null);
            setSyncNotice({
                title: "Sync Complete",
                message: `${pendingSync.label} is now synced with the shared library.`,
            });
            return;
        }
        setPendingSync(null);
        setSyncNotice({
            title: "Sync Error",
            message: result.message || "Could not sync this instrument.",
        });
    };

    const handleBulkUseAs = (useAs) => {
        const chosen = instruments.filter((i) => selectedIds.includes(i.id));
        if (!chosen.length) return;
        onBatchAdd?.(chosen, useAs);
        onClose();
    };

    const handleEditLibraryItem = (inst) => {
        const newDef = JSON.parse(JSON.stringify(inst));
        
        // --- FIX: Fully populate MetaData from Library Item ---
        setMetaData({
            name: inst.description || "", // Populate description for library edit
            measurementArea: inst.measurementArea || DEFAULT_MEASUREMENT_AREA_NAME, // Restore saved area
            measurementAreaColor: inst.measurementAreaColor || DEFAULT_MEASUREMENT_AREA_COLOR, // Restore saved color
            quantity: 1, 
            assetId: ""
        });

        if (effectiveMode !== 'library') {
            newDef.libraryInstrumentId = inst.id;
            setLibraryInstrumentId(inst.id);
            const autoName = `${inst.manufacturer || ''} ${inst.model || ''}`.trim();
            if (autoName) {
                // If creating UUT/TMDE, default name to Manufacturer + Model
                setMetaData(prev => ({ ...prev, name: autoName }));
            }
        }
        
        setInitialInstrumentSignature(
            JSON.stringify(getComparableLibraryInstrument(newDef))
        );
        setInstrumentDef(newDef);
        if (newDef.functions?.length > 0) setActiveFunctionId(newDef.functions[0].id);
        else setActiveFunctionId(null);
        setActiveTypeBId(newDef.typeBComponents?.[0]?.id || null);
        setViewMode("edit");
    };

    const handleCreateNew = () => {
        const newInstrument = {
            id: uuidv4(),
            manufacturer: "",
            model: "",
            description: "",
            scope: "local",
            functions: [],
            typeBComponents: []
        };
        setInstrumentDef(newInstrument);
        setLibraryInstrumentId(null);
        setInitialInstrumentSignature(
            JSON.stringify(getComparableLibraryInstrument(newInstrument))
        );
        setMetaData(prev => ({
            ...prev,
            name: "",
            measurementArea: DEFAULT_MEASUREMENT_AREA_NAME,
            measurementAreaId: "",
            measurementAreaColor: DEFAULT_MEASUREMENT_AREA_COLOR
        }));
        setActiveFunctionId(null);
        setActiveTypeBId(null);
        setViewMode("edit");
    };

    const handleMetaChange = (field, value) => {
        setMetaData(prev => ({ ...prev, [field]: value }));
    };

    // The Description/Name shown for an instrument is the live composition of its
    // three identity sub-fields — Mfr. (manufacturer), Model, and Name (the free
    // name/label stored as `description`) — exactly like the inline instrument
    // tables.
    const composedDescription = [
        instrumentDef.manufacturer,
        instrumentDef.model,
        metaData.name,
    ]
        .map((part) => (part || "").trim())
        .filter(Boolean)
        .join(" ");

    const updateTypeBComponents = (next) => {
        const normalized = Array.isArray(next) ? next : [];
        setInstrumentDef(prev => ({ ...prev, typeBComponents: normalized }));
        setActiveTypeBId(current =>
            normalized.some(component => component.id === current)
                ? current
                : normalized[0]?.id || null
        );
    };

    const typeBReferenceUnit =
        activeFunction?.unit || instrumentDef.functions?.[0]?.unit || "";

    const handleAddTypeBComponent = () => {
        const component = createTypeBComponent(typeBReferenceUnit, {
            functionId: activeFunctionId || "",
        });
        setActiveTypeBId(component.id);
        setInstrumentDef(prev => ({
            ...prev,
            typeBComponents: [
                ...(Array.isArray(prev.typeBComponents) ? prev.typeBComponents : []),
                component,
            ],
        }));
    };

    const handleDeleteActiveTypeBComponent = () => {
        const targetId =
            activeTypeBId && typeBComponents.some(component => component.id === activeTypeBId)
                ? activeTypeBId
                : typeBComponents[typeBComponents.length - 1]?.id;
        if (!targetId) return;
        updateTypeBComponents(typeBComponents.filter(component => component.id !== targetId));
    };

    const handleAddFunction = () => {
        const defaultUnit = "V";
        const newFunc = {
            id: uuidv4(),
            name: "New Function",
            unit: defaultUnit,
            units: [defaultUnit],
            ranges: [createUnboundedBuilderRange(defaultUnit)],
        };
        setInstrumentDef(prev => ({ ...prev, functions: [...prev.functions, newFunc] }));
        setActiveFunctionId(newFunc.id);
    };

    const updateActiveFunction = (key, value) => {
        setInstrumentDef(prev => ({
            ...prev,
            functions: prev.functions.map(f => f.id === activeFunctionId ? { ...f, [key]: value } : f)
        }));
    };

    const updateFunctionById = (functionId, patch) => {
        setInstrumentDef(prev => ({
            ...prev,
            functions: (prev.functions || []).map(fn =>
                fn.id !== functionId
                    ? fn
                    : {
                        ...fn,
                        ...patch,
                        ...(patch.unit !== undefined
                            ? {
                                units: Array.from(
                                    new Set([...(fn.units || []), fn.unit, patch.unit].filter(Boolean)),
                                ),
                            }
                            : {}),
                    }
            ),
        }));
    };

    const handleDeleteFunction = (id) => {
        const remaining = (instrumentDef.functions || []).filter(f => f.id !== id);
        setInstrumentDef(prev => ({
            ...prev,
            functions: (prev.functions || []).filter(f => f.id !== id),
        }));
        if (activeFunctionId === id || !remaining.some(f => f.id === activeFunctionId)) {
            setActiveFunctionId(remaining[0]?.id || null);
        }
    };

    const handleDeleteActiveFunction = () => {
        const targetId = activeFunctionId || instrumentDef.functions?.[0]?.id;
        if (targetId) handleDeleteFunction(targetId);
    };

    const handleAddRange = (functionId) => {
        const fn = instrumentDef.functions.find((candidate) => candidate.id === functionId);
        if (!fn) return;
        const newRange = {
            id: uuidv4(),
            min: "",
            max: "",
            unit: fn.unit || "",
            resolution: "",
            resolutionUnit: fn.unit || "",
            resolutionDistribution: RESOLUTION_DIST_DEFAULT,
            tolerances: {},
        };
        setInstrumentDef(prev => ({
            ...prev,
            functions: prev.functions.map(f =>
                f.id === functionId
                    ? {
                        ...f,
                        units: Array.from(new Set([...(f.units || []), f.unit, newRange.unit].filter(Boolean))),
                        ranges: [...(f.ranges || []), newRange],
                    }
                    : f
            )
        }));
    };

    const updateRangePatch = (functionId, rangeId, patch) => {
        setInstrumentDef(prev => ({
            ...prev,
            functions: prev.functions.map(f => {
                if (f.id !== functionId) return f;
                return {
                    ...f,
                    ...(patch.unit !== undefined
                        ? {
                            units: Array.from(
                                new Set([...(f.units || []), f.unit, patch.unit].filter(Boolean)),
                            ),
                        }
                        : {}),
                    ranges: (f.ranges || []).map(r =>
                        r.id === rangeId ? { ...r, ...patch } : r
                    ),
                };
            })
        }));
    };

    const updateRangeTolerance = (functionId, rangeId, updater) => {
        setInstrumentDef(prev => {
            let functionChanged = false;
            const functions = prev.functions.map(f => {
                if (f.id !== functionId) return f;
                let rangeChanged = false;
                const ranges = (f.ranges || []).map(r => {
                    if (r.id !== rangeId) return r;
                    const currentTolerance = r.tolerances || {};
                    const nextTolerance =
                        typeof updater === "function"
                            ? updater(currentTolerance)
                            : updater;
                    const normalizedTolerance = nextTolerance || {};
                    if (normalizedTolerance === currentTolerance) return r;
                    rangeChanged = true;
                    return { ...r, tolerances: normalizedTolerance };
                });
                if (!rangeChanged) return f;
                functionChanged = true;
                return {
                    ...f,
                    ranges,
                };
            });
            return functionChanged ? { ...prev, functions } : prev;
        });
    };

    const updateRangeBandDistribution = (functionId, rangeId, value) => {
        updateRangeTolerance(functionId, rangeId, (prev) =>
            applyBandDistribution(prev || {}, value),
        );
    };

    const handleDeleteRange = (functionId, rangeId) => {
        setInstrumentDef(prev => ({
            ...prev,
            functions: prev.functions.map(f => {
                if (f.id !== functionId) return f;
                const remaining = (f.ranges || []).filter(r => r.id !== rangeId);
                return {
                    ...f,
                    ranges: remaining.length > 0
                        ? remaining
                        : [createUnboundedBuilderRange(f.unit || f.units?.[0] || "")],
                };
            })
        }));
    };

    const buildSaveData = (savedLibraryId = libraryInstrumentId, { saveToLibrary = false } = {}) => {
        let finalData = {};
        if (effectiveMode === 'uut' || effectiveMode === 'tmde') {
            const shouldRemainShared = saveToLibrary && savedLibraryId;
            const sessionInstrument = {
                ...instrumentDef,
                scope: shouldRemainShared ? "validated" : "local",
                ...(savedLibraryId
                    ? {
                        libraryInstrumentId: savedLibraryId,
                        sourceId: instrumentDef.sourceId || savedLibraryId,
                    }
                    : {}),
                ...(!shouldRemainShared ? { localOverride: true } : { localOverride: false }),
            };
            finalData = {
                id: initialData?.id || uuidv4(),
                description: metaData.name, 
                name: metaData.name,
                measurementArea: metaData.measurementArea,
                measurementAreaId: metaData.measurementAreaId,
                measurementAreaColor: metaData.measurementAreaColor,
                instrument: sessionInstrument,
                ...(savedLibraryId ? { libraryInstrumentId: savedLibraryId } : {}),
                type: effectiveMode
            };
        } else {
            // Library Mode: Sync description with the input field (metaData.name)
            finalData = { 
                ...instrumentDef, 
                description: metaData.name, // Ensure description is updated from UI
                measurementArea: metaData.measurementArea, 
                measurementAreaColor: metaData.measurementAreaColor,
                type: 'library' 
            };
        }

        return finalData;
    };

    // Session-only save (never writes the shared library). Writing an instrument
    // to the validated library is password-gated and handled by
    // completeLibrarySave; this path keeps the edit local to the session.
    const completeSave = () => {
        const savedLibraryId =
            libraryInstrumentId || linkedLibraryInstrument?.id || null;
        const finalData = buildSaveData(savedLibraryId, { saveToLibrary: false });
        console.log("[UniversalInstrumentModal] Saving Data:", finalData);
        onSave(finalData);

        setLibraryInstrumentId(savedLibraryId);
        setPendingInstrumentSave(false);
        onClose();
    };

    // Push the edited definition up to the validated (shared) library. The
    // backend rejects validated writes without the shared-library password, so
    // the password is collected first (pendingLibraryPassword) and passed here.
    // On success the session copy is saved too; on failure we keep the prompt
    // open with an inline error so the user can retry.
    const completeLibrarySave = async (password) => {
        const isLibraryMode = effectiveMode === 'library';
        const savedLibraryId = isLibraryMode
            ? instrumentDef.id
            : linkedLibraryInstrument?.id || instrumentDef.id;

        const libraryInstrument = isLibraryMode
            ? {
                ...instrumentDef,
                id: savedLibraryId,
                scope: "validated",
                sourceId: instrumentDef.sourceId || savedLibraryId,
                localOverride: false,
                description: metaData.name || instrumentDef.description,
                measurementArea: metaData.measurementArea,
                measurementAreaColor: metaData.measurementAreaColor,
                type: 'library'
            }
            : {
                ...instrumentDef,
                id: savedLibraryId,
                scope: "validated",
                sourceId: savedLibraryId,
                localOverride: false,
                description: linkedLibraryInstrument?.description || metaData.name,
                measurementArea:
                    linkedLibraryInstrument?.measurementArea || metaData.measurementArea,
                measurementAreaColor:
                    linkedLibraryInstrument?.measurementAreaColor ||
                    metaData.measurementAreaColor,
                type: 'library'
            };

        const result = await syncToShared(libraryInstrument, password);
        if (!result.ok) {
            setLibraryPasswordError(
                result.message ||
                    (result.reason === "password"
                        ? "Invalid shared-library password."
                        : "Could not reach the shared library. Try again."),
            );
            return;
        }

        // In UUT/TMDE mode the session carries its own linked copy of the
        // instrument, so persist that too (via onSave). In library mode the
        // synced record IS the saved instrument (reconciled through
        // onInstrumentSynced), so an extra onSave would just re-POST it
        // unguarded and 403 — skip it and only close.
        if (!isLibraryMode) {
            const finalData = buildSaveData(savedLibraryId, { saveToLibrary: true });
            console.log("[UniversalInstrumentModal] Saving Data:", finalData);
            onSave(finalData);
        }

        setLibraryInstrumentId(savedLibraryId);
        setLibraryPasswordError("");
        setPendingLibraryPassword(false);
        setPendingInstrumentSave(false);
        onClose();
    };

    // Transition from the "update library vs session only" choice into the
    // password prompt for the shared-library write.
    const promptLibraryPassword = () => {
        setPendingInstrumentSave(false);
        setLibraryPasswordError("");
        setPendingLibraryPassword(true);
    };

    const handleSave = () => {
        if (!isFormValid) return;

        if (
            (effectiveMode === 'uut' || effectiveMode === 'tmde') &&
            onSaveToLibrary &&
            isInstrumentInLibrary &&
            hasLibraryChanges
        ) {
            setPendingInstrumentSave(true);
            return;
        }

        // Library mode: editing a validated (shared) instrument writes straight
        // to the shared library, which the backend password-gates. Collect the
        // password first instead of firing an unguarded save that 403s. New /
        // local instruments stay local and save without a password.
        if (effectiveMode === 'library' && instrumentDef.scope === 'validated') {
            promptLibraryPassword();
            return;
        }

        completeSave();
    };

    const toggleFunctionDetails = (e, instId, funcId) => {
        e.stopPropagation();
        if (expandedDetail && expandedDetail.instId === instId && expandedDetail.funcId === funcId) {
            setExpandedDetail(null);
        } else {
            setExpandedDetail({ instId, funcId });
        }
    };

    if (!isOpen) return null;

    return ReactDOM.createPortal(
        <div
            className="modal-content floating-window-content instrument-builder-wrapper"
            style={{
                position: 'fixed',
                top: position.y,
                left: position.x,
                margin: 0,
                width: '1100px',
                maxWidth: '95vw',
                height: '85vh',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 2100,
                overflow: 'hidden'
            }}
        >
            {/* --- Header --- */}
            <div
                className="modal-header"
                onMouseDown={handleMouseDown}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {viewMode === 'list' && (
                        <button className="icon-btn-ghost" onClick={() => setViewMode("edit")} title="Back to Editor">
                            <FontAwesomeIcon icon={faArrowLeft} />
                        </button>
                    )}
                    <h3 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <FontAwesomeIcon icon={modeIcon} style={{ color: 'var(--primary-color)' }} />
                        {viewMode === 'list' ? "Select Instrument from Library" : modalTitle}
                    </h3>
                </div>
                <button onClick={onClose} className="modal-close-button">&times;</button>
            </div>

            {/* --- Body --- */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                
                {/* --- VIEW: LIST --- */}
                {viewMode === "list" && (
                    <div className="list-view-container">
                         <div className="search-toolbar">
                            <div className="search-input-wrapper">
                                <FontAwesomeIcon icon={faSearch} className="search-icon" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    autoFocus
                                />
                            </div>
                            <button className="icon-btn-ghost" onClick={handleCreateNew} title="Create Manual Instrument">
                                <FontAwesomeIcon icon={faPlus} />
                            </button>
                        </div>

                        <div className="list-content">
                            <table className="library-table library-table--selectable">
                                <thead>
                                    <tr>
                                        <th style={{ width: '20%' }}>Manufacturer</th>
                                        <th style={{ width: '18%' }}>Model</th>
                                        <th style={{ width: '30%' }}>Description</th>
                                        <th style={{ width: '12%' }}>Source</th>
                                        <th style={{ width: '20%' }}>Functions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredInstruments.map(inst => {
                                        const isExpanded = expandedDetail?.instId === inst.id;
                                        const isRowSelected = selectedIds.includes(inst.id);
                                        const linkedShared = linkedSharedFor(inst);
                                        return (
                                            <React.Fragment key={inst.id}>
                                                <tr
                                                    onClick={(e) => handleRowSelect(e, inst.id)}
                                                    onDoubleClick={() => handleEditLibraryItem(inst)}
                                                    className={`hover-row ${isRowSelected ? 'row-selected' : ''}`}
                                                    title="Click to select (Ctrl/Shift for multi); double-click to open"
                                                    tabIndex={0}
                                                    aria-selected={isRowSelected}
                                                >
                                                    <td style={{ fontWeight: '600' }}>{inst.manufacturer}</td>
                                                    <td style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>{inst.model}</td>
                                                    <td style={{ color: 'var(--text-color-muted)' }}>{inst.description}</td>
                                                    <td>
                                                        <InstrumentSourceBadge
                                                            instrument={inst}
                                                            linkedInstrument={linkedShared}
                                                        />
                                                    </td>
                                                    <td onClick={e => e.stopPropagation()}>
                                                        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                                                            {inst.functions.map(f => (
                                                                <button
                                                                    key={f.id}
                                                                    onClick={(e) => toggleFunctionDetails(e, inst.id, f.id)}
                                                                    className={`status-pill ${isExpanded && expandedDetail.funcId === f.id ? "active" : ""}`}
                                                                >
                                                                    {f.name} <FontAwesomeIcon icon={isExpanded && expandedDetail.funcId === f.id ? faChevronUp : faChevronDown} size="xs" />
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </td>
                                                </tr>
                                                {isExpanded && (
                                                    <tr className="detail-row">
                                                        <td colSpan="5">
                                                            <div style={{padding: '10px', background: 'var(--background-color-secondary)'}}>
                                                                {(() => {
                                                                    const func = inst.functions.find(f => f.id === expandedDetail.funcId);
                                                                    if (!func) return null;
                                                                    return (
                                                                        <table className="ranges-table">
                                                                            <thead><tr><th>Min</th><th>Max</th><th>Resolution</th><th>Spec</th></tr></thead>
                                                                            <tbody>
                                                                                {func.ranges.map((r, i) => (
                                                                                    <tr key={i}>
                                                                                        <td>{r.min}</td>
                                                                                        <td>{r.max}</td>
                                                                                        <td>{r.resolution ?? 0}</td>
                                                                                        <td>{formatToleranceSummary(r.tolerances)}</td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    )
                                                                })()}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Selection action bar — appears once rows are checked. */}
                        {selectedIds.length > 0 && (
                            <div className="library-selection-bar">
                                <div className="library-selection-info">
                                    <span className="library-selection-count">
                                        {selectedIds.length}
                                    </span>
                                    <span className="library-selection-label">
                                        instrument{selectedIds.length > 1 ? 's' : ''} selected
                                    </span>
                                    <button
                                        className="library-selection-clear"
                                        onClick={() => { setSelectedIds([]); setSelectionAnchor(null); }}
                                    >
                                        Clear
                                    </button>
                                </div>
                                <div className="library-selection-actions">
                                    {onDelete && (
                                        <button
                                            className="lib-icon-btn lib-icon-btn--danger"
                                            title={`Delete ${selectedIds.length} from library`}
                                            onClick={() => requestDelete(selectedIds)}
                                        >
                                            <FontAwesomeIcon icon={faTrashAlt} />
                                        </button>
                                    )}
                                    <button
                                        className="lib-pill-btn"
                                        disabled={!selectedInstrument}
                                        title={
                                            selectedInstrument
                                                ? "Sync selected instrument to the shared library"
                                                : "Select one instrument to sync"
                                        }
                                        onClick={() => requestSync(selectedInstrument)}
                                    >
                                        <FontAwesomeIcon icon={faSyncAlt} /> Sync
                                    </button>
                                    {/* Library manager: choose how to bring the selection into the session. */}
                                    {mode === 'library' ? (
                                        <>
                                            <button
                                                className="lib-pill-btn"
                                                onClick={() => handleBulkUseAs('uut')}
                                            >
                                                <FontAwesomeIcon icon={faMicroscope} /> Use as UUT
                                            </button>
                                            <button
                                                className="lib-pill-btn"
                                                onClick={() => handleBulkUseAs('tmde')}
                                            >
                                                <FontAwesomeIcon icon={faTools} /> Use as TMDE
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            className="lib-pill-btn"
                                            onClick={() => handleBulkUseAs(effectiveMode)}
                                        >
                                            <FontAwesomeIcon icon={faPlus} /> Add {selectedIds.length}{' '}
                                            {effectiveMode === 'uut' ? 'UUT' : 'TMDE'}
                                            {selectedIds.length > 1 ? 's' : ''}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* --- VIEW: EDIT (BUILDER) --- */}
                {viewMode === "edit" && (
                    <div className="instrument-edit-layout">
                        {/* Top: Identity Card */}
                        <div className="identity-container">
                            <div className="identity-header">
                                <div className="identity-title">
                                    <span>Identification</span>
                                    <InstrumentSourceBadge
                                        instrument={instrumentDef}
                                        linkedInstrument={linkedLibraryInstrument}
                                    />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span
                                        className="builder-typeb-status"
                                        title="Associated Type B uncertainties are edited below the function specs"
                                    >
                                        <FontAwesomeIcon icon={faFlask} />
                                        {(instrumentDef.typeBComponents?.length || 0) > 0 && (
                                            <span className="typeb-count-badge">
                                                {instrumentDef.typeBComponents.length}
                                            </span>
                                        )}
                                    </span>
                                    <button className="icon-btn-ghost" onClick={() => setViewMode('list')} title="Import from Library">
                                        <FontAwesomeIcon icon={faBookOpen} />
                                    </button>
                                </div>
                            </div>
                            
                            {/* Identity mirrors the inline instrument tables: three
                                sub-fields — Mfr. / Model / Name — that snap together
                                into the Description/Name shown below. */}
                            <div className="identity-grid identity-grid-triple">
                                <div className="floating-input-group">
                                    <input
                                        type="text"
                                        value={instrumentDef.manufacturer}
                                        onChange={e => setInstrumentDef({ ...instrumentDef, manufacturer: e.target.value })}
                                        placeholder=" "
                                    />
                                    <label>Mfr.</label>
                                    <FontAwesomeIcon icon={faIndustry} className="input-icon" />
                                </div>

                                <div className="floating-input-group">
                                    <input
                                        type="text"
                                        value={instrumentDef.model}
                                        onChange={e => setInstrumentDef({ ...instrumentDef, model: e.target.value })}
                                        placeholder=" "
                                    />
                                    <label>Model</label>
                                    <FontAwesomeIcon icon={faTag} className="input-icon" />
                                </div>

                                <div className="floating-input-group">
                                    <input
                                        type="text"
                                        value={metaData.name}
                                        onChange={e => handleMetaChange('name', e.target.value)}
                                        placeholder=" "
                                    />
                                    <label>Name</label>
                                    <FontAwesomeIcon icon={faFingerprint} className="input-icon" />
                                </div>
                            </div>

                            <div className="identity-composed">
                                <span className="identity-composed-label">Description / Name</span>
                                <span
                                    className={`identity-composed-value${composedDescription ? "" : " is-empty"}`}
                                >
                                    {composedDescription || "Mfr. · Model · Name"}
                                </span>
                            </div>
                        </div>

                        <div className="instrument-spec-sheet">
                            <div className="spec-sheet-toolbar">
                                <h5>
                                    <FontAwesomeIcon icon={faCube} /> Functions and specifications
                                </h5>
                                <div className="spec-toolbar-actions">
                                    <button className="lib-pill-btn" onClick={handleAddFunction} title="Add Function">
                                        <FontAwesomeIcon icon={faPlus} /> Add Function
                                    </button>
                                    <button
                                        className="builder-x-action builder-toolbar-delete"
                                        onClick={handleDeleteActiveFunction}
                                        title="Delete selected function"
                                        aria-label="Delete selected function"
                                        disabled={(instrumentDef.functions || []).length === 0}
                                    >
                                        x
                                    </button>
                                </div>
                            </div>

                            <div className="spec-sheet-scroll">
                                {(instrumentDef.functions || []).length === 0 && (
                                    <div className="builder-empty-state">
                                        <FontAwesomeIcon icon={faCube} />
                                        <span>No functions yet.</span>
                                    </div>
                                )}

                                {(instrumentDef.functions || []).map((fn) => {
                                    const unitOptions = getCategorizedUnitOptions(allUnitsRaw, fn.unit);
                                    const ranges = Array.isArray(fn.ranges) ? fn.ranges : [];
                                    return (
                                        <section
                                            className={`function-spec-section${activeFunctionId === fn.id ? " is-active" : ""}`}
                                            key={fn.id}
                                            onMouseDown={() => setActiveFunctionId(fn.id)}
                                            onFocusCapture={() => setActiveFunctionId(fn.id)}
                                        >
                                            <div className="function-spec-header">
                                                <div className="function-name-control">
                                                    <FontAwesomeIcon icon={faCube} />
                                                    <input
                                                        type="text"
                                                        value={fn.name || ""}
                                                        onChange={(e) => updateFunctionById(fn.id, { name: e.target.value })}
                                                        aria-label="Function name"
                                                    />
                                                </div>
                                                <div className="function-unit-control">
                                                    <BuilderUnitSelect
                                                        value={fn.unit || ""}
                                                        onChange={(unit) => updateFunctionById(fn.id, { unit })}
                                                        options={unitOptions}
                                                        ariaLabel={`${fn.name || "Function"} unit`}
                                                        width="9ch"
                                                    />
                                                </div>
                                                <button
                                                    className="icon-btn-ghost"
                                                    onClick={() => handleAddRange(fn.id)}
                                                    title={`Add range to ${fn.name || "function"}`}
                                                    aria-label={`Add range to ${fn.name || "function"}`}
                                                >
                                                    <FontAwesomeIcon icon={faPlus} />
                                                </button>
                                            </div>

                                            <div className="ranges-table-container builder-ranges-table-container">
                                                <table className="ranges-table builder-spec-table">
                                                    <thead>
                                                        <tr>
                                                            <th style={{ width: "22%" }}>Range</th>
                                                            <th style={{ width: "36%" }}>Tolerance</th>
                                                            <th style={{ width: "15%" }}>Distribution</th>
                                                            <th style={{ width: "21%" }}>Resolution</th>
                                                            <th style={{ width: "40px" }}></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {ranges.map((range) => (
                                                            <tr key={range.id} className="builder-range-row">
                                                                <td>
                                                                    <BuilderRangeCell
                                                                        range={range}
                                                                        fn={fn}
                                                                        unitOptions={unitOptions}
                                                                        onPatch={(patch) =>
                                                                            updateRangePatch(fn.id, range.id, patch)
                                                                        }
                                                                    />
                                                                </td>
                                                                <td>
                                                                    <BuilderToleranceCell
                                                                        range={range}
                                                                        fn={fn}
                                                                        onToleranceComponentCommit={(typeKey, component) =>
                                                                            updateRangeTolerance(fn.id, range.id, (prev) =>
                                                                                applyToleranceCaseChange(
                                                                                    prev || {},
                                                                                    typeKey,
                                                                                    component,
                                                                                ),
                                                                            )
                                                                        }
                                                                    />
                                                                </td>
                                                                <td>
                                                                    <BuilderDistributionCell
                                                                        value={getBandDistribution(range.tolerances)}
                                                                        onChange={(value) =>
                                                                            updateRangeBandDistribution(fn.id, range.id, value)
                                                                        }
                                                                    />
                                                                </td>
                                                                <td>
                                                                    <BuilderResolutionCell
                                                                        range={range}
                                                                        fn={fn}
                                                                        unitOptions={unitOptions}
                                                                        onPatch={(patch) =>
                                                                            updateRangePatch(fn.id, range.id, patch)
                                                                        }
                                                                    />
                                                                </td>
                                                                <td>
                                                                    <button
                                                                        className="builder-x-action builder-range-delete"
                                                                        onClick={() => handleDeleteRange(fn.id, range.id)}
                                                                        title="Delete range"
                                                                        aria-label="Delete range"
                                                                    >
                                                                        x
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                        {ranges.length === 0 && (
                                                            <tr>
                                                                <td colSpan="5" className="builder-empty-range-cell">
                                                                    <button
                                                                        className="lib-pill-btn"
                                                                        onClick={() => handleAddRange(fn.id)}
                                                                    >
                                                                        <FontAwesomeIcon icon={faPlus} /> Add Range
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </section>
                                    );
                                })}

                                <section className="typeb-spec-section">
                                    <div className="spec-sheet-toolbar typeb-spec-toolbar">
                                        <h5>
                                            <FontAwesomeIcon icon={faFlask} /> Type B Uncertainties
                                        </h5>
                                        <div className="spec-toolbar-actions">
                                            <button
                                                className="lib-pill-btn"
                                                onClick={handleAddTypeBComponent}
                                                title="Add Type B uncertainty"
                                            >
                                                <FontAwesomeIcon icon={faPlus} /> Add Type B
                                            </button>
                                            <button
                                                className="builder-x-action builder-toolbar-delete"
                                                onClick={handleDeleteActiveTypeBComponent}
                                                title="Delete selected Type B"
                                                aria-label="Delete selected Type B"
                                                disabled={typeBComponents.length === 0}
                                            >
                                                x
                                            </button>
                                        </div>
                                    </div>
                                    <div className="typeb-section-body">
                                        <TypeBComponentsEditor
                                            components={typeBComponents}
                                            onChange={updateTypeBComponents}
                                            referenceUnit={typeBReferenceUnit}
                                            showIntro={false}
                                            showAddButton={false}
                                            showInlineRemove={false}
                                            activeId={activeTypeBId}
                                            onActivate={setActiveTypeBId}
                                            functions={instrumentDef.functions || []}
                                            activeFunctionId={activeFunctionId || ""}
                                        />
                                    </div>
                                </section>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="editor-actions">
                            <button 
                                className="icon-btn-ghost editor-save-button"
                                onClick={handleSave} 
                                disabled={!isFormValid}
                                title={!isFormValid ? "Fill Manufacturer, Model, and Description" : "Save Configuration"}
                                aria-label="Save configuration"
                            >
                                <FontAwesomeIcon icon={faCheck} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Delete confirmation — same warning modal as "Delete Measurement
                Point". Single choke-point: a password gate can wrap confirmDelete
                later without touching the call sites. */}
            <NotificationModal
                isOpen={!!pendingDelete}
                onClose={() => setPendingDelete(null)}
                title={
                    pendingDelete && pendingDelete.ids.length > 1
                        ? "Batch Delete"
                        : "Delete Instrument"
                }
                message={
                    pendingDelete && pendingDelete.ids.length > 1
                        ? `Are you sure you want to delete these ${pendingDelete.ids.length} instruments from the library? This affects all sessions.`
                        : "Are you sure you want to delete this instrument from the library? This affects all sessions."
                }
                confirmText="Delete"
                isIconConfirm={true}
                onConfirm={confirmDelete}
            />
            <NotificationModal
                isOpen={pendingInstrumentSave}
                onClose={() => setPendingInstrumentSave(false)}
                title={isInstrumentInLibrary ? "Update Library Instrument" : "Save Instrument"}
                message={
                    isInstrumentInLibrary
                        ? `This ${effectiveMode === 'uut' ? 'UUT' : 'TMDE'} has changes that differ from the library. Do you want to update the library and this session, or only this session?`
                        : `Do you want to save this ${effectiveMode === 'uut' ? 'UUT' : 'TMDE'} to the instrument library for future use?`
                }
                confirmText={
                    isInstrumentInLibrary
                        ? "Update Library & Session"
                        : "Save to Library & Session"
                }
                onConfirm={promptLibraryPassword}
                secondaryText="Session Only"
                onSecondary={() => completeSave()}
                secondaryIsPrimary={true}
            />
            <NotificationModal
                isOpen={pendingLibraryPassword}
                onClose={() => {
                    setPendingLibraryPassword(false);
                    setLibraryPasswordError("");
                }}
                title={isInstrumentInLibrary ? "Update Shared Library" : "Save to Shared Library"}
                message={
                    `${libraryPasswordError ? `${libraryPasswordError} ` : ""}Enter the shared-library password to ${
                        isInstrumentInLibrary ? "update" : "save"
                    } “${
                        metaData.name ||
                        `${instrumentDef.manufacturer || ""} ${instrumentDef.model || ""}`.trim() ||
                        "this instrument"
                    }” in the shared library.`
                }
                inputLabel="Shared library password"
                inputPlaceholder="Password"
                confirmText={
                    effectiveMode === 'library'
                        ? "Update Shared Library"
                        : isInstrumentInLibrary
                            ? "Update Library & Session"
                            : "Save to Library & Session"
                }
                validateInput={(value) => (!value.trim() ? "Password is required." : "")}
                onConfirm={completeLibrarySave}
            />
            <NotificationModal
                isOpen={!!pendingSync}
                onClose={() => setPendingSync(null)}
                title={
                    pendingSync &&
                    (pendingSync.instrument?.sourceId ||
                        pendingSync.instrument?.scope === "validated")
                        ? "Re-sync Instrument"
                        : "Sync Instrument"
                }
                message={
                    pendingSync
                        ? `${syncDiffSummary(getDiff(pendingSync.instrument))} Enter the shared-library password to sync ${pendingSync.label}.`
                        : ""
                }
                inputLabel="Shared library password"
                inputPlaceholder="Password"
                confirmText={
                    pendingSync &&
                    (pendingSync.instrument?.sourceId ||
                        pendingSync.instrument?.scope === "validated")
                        ? "Re-sync"
                        : "Sync"
                }
                validateInput={(value) => (!value.trim() ? "Password is required." : "")}
                onConfirm={confirmSync}
            />
            <NotificationModal
                isOpen={!!syncNotice}
                onClose={() => setSyncNotice(null)}
                title={syncNotice?.title}
                message={syncNotice?.message}
            />
        </div>,
        document.body
    );
};

export default UniversalInstrumentModal;
