// Function-first grouping helpers.
//
// "Function" is the primary organizing axis across the measurement-point sidebar
// and the instrument tables: a point belongs to the function named on the point
// itself (testPointInfo.parameter), and an instrument exposes one or more
// functions (instrument.functions[]). These helpers give every surface a single,
// consistent function identity so a point and the instruments that can measure it
// collapse under the same node.
//
// The key format is intentionally derived from a human-facing (name, unit) pair —
// NOT from any functionId on a range — so instruments that share a function name
// group together even when their internal range ids differ. The legacy
// range.functionId/functionName annotations are deliberately ignored here.

import { getInstrumentDefinition } from "./instrumentFunctionSelection";

const clean = (value) =>
  value === undefined || value === null ? "" : String(value).trim();

const DEFAULT_FUNCTION_NAME = "Measurement";

// Stable identity for a (name, unit) function pair. Name comparison is
// case-insensitive so "DC Voltage" and "dc voltage" don't fork into two nodes;
// unit is compared as-typed (units are already canonical tokens elsewhere).
export const makeFunctionKey = (name, unit) =>
  `${clean(name).toLowerCase() || DEFAULT_FUNCTION_NAME.toLowerCase()}|${clean(unit)}`;

// The function a measurement point belongs to, taken from the point's own
// parameter (the "Function Name" + base unit set in the Add Point modal).
export const functionKeyOf = (point) => {
  const parameter = point?.testPointInfo?.parameter || {};
  return makeFunctionKey(parameter.name, parameter.unit);
};

export const functionLabelOf = (point) => {
  const parameter = point?.testPointInfo?.parameter || {};
  return {
    key: makeFunctionKey(parameter.name, parameter.unit),
    name: clean(parameter.name) || DEFAULT_FUNCTION_NAME,
    unit: clean(parameter.unit),
  };
};

// Normalize an instrument's declared functions to [{ key, name, unit, ranges }].
// Falls back to a single synthetic function for legacy instruments that only
// carry a flat `ranges` array (or nothing) so they still participate in grouping.
export const instrumentFunctions = (source = {}) => {
  const instrument = getInstrumentDefinition(source);
  const fns = Array.isArray(instrument.functions) ? instrument.functions : [];

  if (fns.length > 0) {
    return fns.map((fn) => ({
      key: makeFunctionKey(fn.name, fn.unit),
      name: clean(fn.name) || DEFAULT_FUNCTION_NAME,
      unit: clean(fn.unit),
      ranges: Array.isArray(fn.ranges) ? fn.ranges : [],
    }));
  }

  const legacyRanges = Array.isArray(instrument.ranges) ? instrument.ranges : [];
  const name = clean(instrument.functionName) || DEFAULT_FUNCTION_NAME;
  const unit = clean(instrument.functionUnit) || clean(instrument.unit);
  return [
    {
      key: makeFunctionKey(name, unit),
      name,
      unit,
      ranges: legacyRanges,
    },
  ];
};

// True when an instrument declares (can measure) the given function key.
export const instrumentHasFunction = (source, functionKey) =>
  instrumentFunctions(source).some((fn) => fn.key === functionKey);

// The ranges an instrument exposes for a single function key. Returns [] when the
// instrument doesn't have that function. Used to scope a row's range/tolerance
// display to the subsection it's rendered under.
export const rangesForFunction = (source, functionKey) => {
  const match = instrumentFunctions(source).find(
    (fn) => fn.key === functionKey,
  );
  return match ? match.ranges : [];
};

// Default subsection colors, mirroring the old measurement-area palette so the
// look is familiar. A function keeps a stable color once the user picks one
// (stored in session.functionGroups); until then it gets a palette default.
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

// The single source of truth for the function set shown in BOTH the sidebar and
// the instrument tables, so a rename/recolor in one surface is reflected in the
// other. Merges:
//   - explicit session.functionGroups (user-added/empty functions + saved colors)
//   - functions declared by every UUT/TMDE instrument
//   - functions named by every test point's parameter
// Returns ordered [{ key, name, unit, color }] (explicit entries first, then the
// rest alphabetically), with a palette color filled in where none is stored.
export const resolveSessionFunctions = (sessionData = {}, { kind = null } = {}) => {
  const explicit = Array.isArray(sessionData.functionGroups)
    ? sessionData.functionGroups
    : [];
  const uuts = kind === "tmde" ? [] : sessionData.uuts || [];
  const tmdes = kind === "uut" ? [] : sessionData.tmdes || [];
  const points = kind === "tmde" ? [] : sessionData.testPoints || [];

  // key -> { key, name, unit, color, explicitOrder }
  const map = new Map();
  const add = (name, unit, color, explicitOrder) => {
    const key = makeFunctionKey(name, unit);
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: clean(name) || DEFAULT_FUNCTION_NAME,
        unit: clean(unit),
        color: color || null,
        explicitOrder,
      });
    } else if (color && !map.get(key).color) {
      map.get(key).color = color;
    }
  };

  explicit
    .filter((fn) => !kind || !fn.kind || fn.kind === kind)
    .forEach((fn, index) => add(fn.name, fn.unit, fn.color, index));
  [...uuts, ...tmdes].forEach((inst) =>
    instrumentFunctions(inst).forEach((fn) => add(fn.name, fn.unit)),
  );
  points.forEach((point) => {
    const label = functionLabelOf(point);
    add(label.name, label.unit);
  });

  const result = Array.from(map.values()).sort((a, b) => {
    const ao = a.explicitOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.explicitOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit);
  });

  result.forEach((fn, index) => {
    if (!fn.color) {
      fn.color = FUNCTION_COLOR_PALETTE[index % FUNCTION_COLOR_PALETTE.length];
    }
    delete fn.explicitOrder;
  });

  return result;
};

// Quick lookup of a function's resolved color by key.
export const colorForFunction = (sessionData, functionKey) =>
  resolveSessionFunctions(sessionData).find((fn) => fn.key === functionKey)
    ?.color || null;

// Distinct functions across a set of instruments (e.g. the shared library),
// ordered by name then unit. Feeds the "Add Function" picker.
export const functionsForLibrary = (instruments = []) => {
  const byKey = new Map();
  (instruments || []).forEach((instrument) => {
    instrumentFunctions(instrument).forEach(({ key, name, unit }) => {
      if (!byKey.has(key)) byKey.set(key, { key, name, unit });
    });
  });
  return Array.from(byKey.values()).sort(
    (a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit),
  );
};
