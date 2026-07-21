// Function-first grouping helpers.
//
// Function identity is name-based. Units belong to the ranges under a
// function, not to the function itself; one function can therefore expose
// multiple units (for example Weight in kg, lb, and oz).

import { getInstrumentDefinition } from "./instrumentFunctionSelection";

const clean = (value) =>
  value === undefined || value === null ? "" : String(value).trim();

const DEFAULT_FUNCTION_NAME = "Measurement";

// The optional unit argument remains accepted for source compatibility with
// older callers and persisted data, but it deliberately does not participate
// in the function identity.
export const makeFunctionKey = (name, _unit) =>
  clean(name).toLowerCase() || DEFAULT_FUNCTION_NAME.toLowerCase();

const canonicalKey = (value) => {
  const raw = clean(value);
  // Accept persisted pre-refactor keys ("name|unit") while returning the
  // new name-only identity for all comparisons.
  return makeFunctionKey(raw.includes("|") ? raw.split("|")[0] : raw);
};

const uniqueUnits = (...sources) =>
  Array.from(
    new Set(
      sources
        .flatMap((source) => (Array.isArray(source) ? source : [source]))
        .map(clean)
        .filter(Boolean),
    ),
  );

const functionUnits = (fn = {}, ranges = []) =>
  (() => {
    const rangeUnits = uniqueUnits(
      ranges.flatMap((range) => [range?.unit, range?.functionUnit]),
    );
    // Once ranges exist, they are the source of truth. The function-level
    // unit is only a legacy/default fallback for ranges that have no unit.
    return rangeUnits.length ? rangeUnits : uniqueUnits(fn.units, fn.unit);
  })();

// The function a measurement point belongs to, taken from the point's own
// parameter. Its unit is a point/range choice, not a function identity.
export const functionKeyOf = (point) => {
  const parameter = point?.testPointInfo?.parameter || {};
  return makeFunctionKey(parameter.name);
};

export const functionLabelOf = (point) => {
  const parameter = point?.testPointInfo?.parameter || {};
  const units = uniqueUnits(parameter.unit);
  return {
    key: makeFunctionKey(parameter.name),
    name: clean(parameter.name) || DEFAULT_FUNCTION_NAME,
    unit: units[0] || "",
    units,
  };
};

// Normalize an instrument's declared functions to
// [{ key, name, unit, units, ranges }]. Legacy flat ranges are grouped by the
// range-level functionName when present.
export const instrumentFunctions = (source = {}) => {
  const instrument = getInstrumentDefinition(source);
  const fns = Array.isArray(instrument.functions) ? instrument.functions : [];

  if (fns.length > 0) {
    const byKey = new Map();
    fns.forEach((fn) => {
      const ranges = Array.isArray(fn.ranges) ? fn.ranges : [];
      const key = makeFunctionKey(fn.name);
      const units = functionUnits(fn, ranges);
      const existing = byKey.get(key);
      if (existing) {
        existing.ranges = [...existing.ranges, ...ranges];
        existing.units = uniqueUnits(existing.units, units);
        existing.unit = existing.units[0] || "";
        return;
      }
      byKey.set(key, {
        key,
        name: clean(fn.name) || DEFAULT_FUNCTION_NAME,
        unit: units[0] || "",
        units,
        ranges,
      });
    });
    return Array.from(byKey.values());
  }

  const legacyRanges = Array.isArray(instrument.ranges) ? instrument.ranges : [];
  const fallbackName = clean(instrument.functionName) || DEFAULT_FUNCTION_NAME;
  const legacyGroups = new Map();
  legacyRanges.forEach((range) => {
    const name = clean(range?.functionName) || fallbackName;
    const key = makeFunctionKey(name);
    const existing = legacyGroups.get(key);
    if (existing) {
      existing.ranges.push(range);
      existing.units = uniqueUnits(existing.units, range?.unit, range?.functionUnit);
      existing.unit = existing.units[0] || "";
      return;
    }
    const units = uniqueUnits(range?.unit, range?.functionUnit).length
      ? uniqueUnits(range?.unit, range?.functionUnit)
      : uniqueUnits(instrument.functionUnit, instrument.unit);
    legacyGroups.set(key, {
      key,
      name,
      unit: units[0] || "",
      units,
      ranges: [range],
    });
  });
  if (legacyGroups.size > 0) return Array.from(legacyGroups.values());

  const units = uniqueUnits(instrument.functionUnit, instrument.unit);
  return [
    {
      key: makeFunctionKey(fallbackName),
      name: fallbackName,
      unit: units[0] || "",
      units,
      ranges: [],
    },
  ];
};

export const instrumentHasFunction = (source, functionKey) => {
  if (!clean(functionKey)) return false;
  const key = canonicalKey(functionKey);
  return instrumentFunctions(source).some((fn) => fn.key === key);
};

// Report each kind of dependency separately when a user tries to remove a
// function. A measurement point can outlive its deleted UUT, so treating all
// usage as one boolean produces the misleading impression that a UUT remains.
export const getFunctionDependencies = (sessionData = {}, fn = {}) => {
  const key = canonicalKey(fn.key || fn.name);
  const appliesToUut = !fn.kind || fn.kind === "uut";
  const appliesToTmde = !fn.kind || fn.kind === "tmde";

  return {
    uuts: appliesToUut
      ? (sessionData.uuts || []).filter((uut) => instrumentHasFunction(uut, key))
      : [],
    tmdes: appliesToTmde
      ? (sessionData.tmdes || []).filter((tmde) => instrumentHasFunction(tmde, key))
      : [],
    measurementPoints: appliesToUut
      ? (sessionData.testPoints || []).filter((point) => functionKeyOf(point) === key)
      : [],
  };
};

export const getFunctionDependencyMessage = (dependencies = {}) => {
  const counts = [
    [dependencies.uuts?.length || 0, "UUT"],
    [dependencies.tmdes?.length || 0, "TMDE"],
    [dependencies.measurementPoints?.length || 0, "measurement point"],
  ].filter(([count]) => count > 0);
  if (counts.length === 0) return "";

  const labels = counts.map(
    ([count, label]) => `${count} ${label}${count === 1 ? "" : "s"}`,
  );
  const dependencyList =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")}${labels.length > 2 ? "," : ""} and ${labels.at(-1)}`;
  return `This function still has ${dependencyList}. Delete ${
    counts.reduce((total, [count]) => total + count, 0) === 1 ? "it" : "them"
  } before deleting the function.`;
};

// Put instruments that can perform the active table function at the top of a
// library picker without hiding the rest of the library. Shared definitions
// lead local variants within each group, matching the picker convention used
// elsewhere in the workbench. The explicit index tie-breaker makes the result
// stable even in runtimes where Array#sort stability is not guaranteed.
export const rankInstrumentsForFunction = (instruments = [], functionKey) => {
  if (!clean(functionKey)) return [...(instruments || [])];

  return (instruments || [])
    .map((instrument, index) => ({
      instrument,
      index,
      matchesFunction: instrumentHasFunction(instrument, functionKey),
      isShared: instrument?.scope === "validated",
    }))
    .sort((a, b) => {
      if (a.matchesFunction !== b.matchesFunction) {
        return a.matchesFunction ? -1 : 1;
      }
      if (a.isShared !== b.isShared) return a.isShared ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ instrument }) => instrument);
};

// Ranges are aggregated when legacy or builder data contains multiple function
// entries with the same name but different unit defaults.
export const rangesForFunction = (source, functionKey) =>
  clean(functionKey)
    ? instrumentFunctions(source)
        .filter((fn) => fn.key === canonicalKey(functionKey))
        .flatMap((fn) => fn.ranges || [])
    : [];

export const FUNCTION_COLOR_PALETTE = [
  "#3498db",
  "#2ecc71",
  "#e67e22",
  "#9b59b6",
  "#e74c3c",
  "#1abc9c",
  "#f1c40f",
  "#34495e",
];

// Resolve the shared function list used by the sidebar and instrument tables.
// Each result includes a compatibility `unit` (the first unit) and the full
// deduplicated `units` list for measurement-point creation.
export const resolveSessionFunctions = (sessionData = {}, { kind = null } = {}) => {
  const explicit = Array.isArray(sessionData.functionGroups)
    ? sessionData.functionGroups
    : [];

  const buildFunctions = (kindFilter) => {
    const uuts = kindFilter === "tmde" ? [] : sessionData.uuts || [];
    const tmdes = kindFilter === "uut" ? [] : sessionData.tmdes || [];
    const points = kindFilter === "tmde" ? [] : sessionData.testPoints || [];
    const map = new Map();
    const add = (name, unitOrUnits, color, explicitOrder) => {
      const key = makeFunctionKey(name);
      const units = uniqueUnits(unitOrUnits);
      const existing = map.get(key);
      if (existing) {
        existing.units = uniqueUnits(existing.units, units);
        existing.unit = existing.units[0] || "";
        if (color && !existing.color) existing.color = color;
        return;
      }
      map.set(key, {
        key,
        name: clean(name) || DEFAULT_FUNCTION_NAME,
        unit: units[0] || "",
        units,
        color: color || null,
        explicitOrder,
      });
    };

    explicit
      .filter((fn) => !kindFilter || !fn.kind || fn.kind === kindFilter)
      .forEach((fn, index) => add(fn.name, [fn.unit, fn.units], fn.color, index));
    [...uuts, ...tmdes].forEach((inst) =>
      instrumentFunctions(inst).forEach((fn) => add(fn.name, fn.units || fn.unit)),
    );
    points.forEach((point) => {
      const label = functionLabelOf(point);
      add(label.name, label.units || label.unit);
    });

    return Array.from(map.values()).sort((a, b) => {
      const ao = a.explicitOrder ?? Number.MAX_SAFE_INTEGER;
      const bo = b.explicitOrder ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit);
    });
  };

  const globalColorByKey = new Map();
  buildFunctions(null).forEach((fn, index) => {
    globalColorByKey.set(
      fn.key,
      fn.color || FUNCTION_COLOR_PALETTE[index % FUNCTION_COLOR_PALETTE.length],
    );
  });

  const result = buildFunctions(kind);
  result.forEach((fn) => {
    fn.color =
      globalColorByKey.get(fn.key) || fn.color || FUNCTION_COLOR_PALETTE[0];
    delete fn.explicitOrder;
  });
  return result;
};

export const colorForFunction = (sessionData, functionKey) =>
  resolveSessionFunctions(sessionData).find(
    (fn) => fn.key === canonicalKey(functionKey),
  )?.color || null;

export const functionsForLibrary = (instruments = []) => {
  const byKey = new Map();
  (instruments || []).forEach((instrument) => {
    instrumentFunctions(instrument).forEach(({ key, name, unit, units }) => {
      const existing = byKey.get(key);
      if (existing) {
        existing.units = uniqueUnits(existing.units, units, unit);
        existing.unit = existing.units[0] || "";
      } else {
        byKey.set(key, {
          key,
          name,
          unit: unit || "",
          units: uniqueUnits(units, unit),
        });
      }
    });
  });
  return Array.from(byKey.values()).sort(
    (a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit),
  );
};
