const sameId = (a, b) =>
  a !== undefined &&
  a !== null &&
  b !== undefined &&
  b !== null &&
  String(a) === String(b);

const firstValue = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const toRangeIndex = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
};

export const getInstrumentDefinition = (masterDef = {}) =>
  masterDef?.instrument || masterDef || {};

const getFunctions = (instrument = {}) =>
  Array.isArray(instrument.functions) ? instrument.functions : [];

const getLegacyRanges = (instrument = {}) =>
  Array.isArray(instrument.ranges) ? instrument.ranges : [];

const getFunctionRanges = (fn = {}) => (Array.isArray(fn.ranges) ? fn.ranges : []);

export const annotateRangeWithFunction = (
  range = {},
  fn = null,
  rangeIndex = null,
) => {
  // A function may expose ranges in different units. Prefer the range's own
  // unit when annotating it; the function unit is only the default for legacy
  // ranges that do not carry one.
  const functionUnit = firstValue(
    range.functionUnit,
    range.unit,
    fn?.unit,
    fn?.units?.[0],
    "",
  );
  const rangeId = firstValue(range.rangeId, range.id);
  const rangeName = firstValue(
    range.rangeName,
    typeof range.range === "string" ? range.range : undefined,
    "",
  );

  return {
    ...range,
    functionId: firstValue(fn?.id, range.functionId),
    functionName: firstValue(fn?.name, range.functionName),
    functionUnit,
    unit: firstValue(range.unit, range.functionUnit, functionUnit, ""),
    rangeId,
    rangeName,
    ...(rangeIndex !== null && rangeIndex !== undefined
      ? { _index: rangeIndex }
      : {}),
  };
};

export const getInstrumentRangeRows = (
  source = {},
  { flattenTolerances = false } = {},
) => {
  const instrument = getInstrumentDefinition(source);
  const rows = [];
  const pushRange = (range, fn = null, sourceName = "") => {
    const annotated = annotateRangeWithFunction(range, fn, rows.length);
    rows.push({
      ...(flattenTolerances
        ? {
            ...annotated,
            ...(annotated.tolerances || annotated.tolerance || {}),
          }
        : annotated),
      source: sourceName || annotated.source || "",
    });
  };

  if (Array.isArray(source.ranges) && source.ranges.length > 0) {
    source.ranges.forEach((range) => pushRange(range, null, "custom"));
  } else if (getFunctions(instrument).length > 0) {
    getFunctions(instrument).forEach((fn) => {
      getFunctionRanges(fn).forEach((range) => pushRange(range, fn, "function"));
    });
  } else if (getLegacyRanges(instrument).length > 0) {
    getLegacyRanges(instrument).forEach((range) =>
      pushRange(range, null, "simple"),
    );
  } else {
    const baseTolerance = source.tolerance || instrument.tolerance;
    if (baseTolerance) {
      pushRange(
        { id: "default", range: "Default", ...baseTolerance, isSingle: true },
        null,
        "single",
      );
    }
  }

  return rows;
};

const findFunctionForRangeId = (functions, rangeId) => {
  if (rangeId === undefined || rangeId === null || rangeId === "") return null;
  return functions.find((fn) =>
    getFunctionRanges(fn).some((range) =>
      sameId(firstValue(range.rangeId, range.id), rangeId),
    ),
  ) || null;
};

const resolveFunction = (functions, selection = {}) => {
  if (!functions.length) return null;

  const functionId = firstValue(selection.userFunctionId, selection.functionId);
  if (functionId !== undefined) {
    const byId = functions.find((fn) => sameId(fn.id, functionId));
    if (byId) return byId;
  }

  const functionName = firstValue(selection.userFunctionName, selection.functionName);
  if (functionName !== undefined) {
    const byName = functions.find((fn) => fn.name === functionName);
    if (byName) return byName;
  }

  const rangeId = firstValue(selection.userRangeId, selection.rangeId);
  const byRange = findFunctionForRangeId(functions, rangeId);
  if (byRange) return byRange;

  return functions[0];
};

const resolveRange = (ranges, selection = {}) => {
  if (!ranges.length) return { activeRange: {}, rangeIndex: 0 };

  const rangeId = firstValue(selection.userRangeId, selection.rangeId);
  if (rangeId !== undefined) {
    const byIdIndex = ranges.findIndex((range) =>
      sameId(firstValue(range.rangeId, range.id), rangeId),
    );
    if (byIdIndex >= 0) {
      return { activeRange: ranges[byIdIndex], rangeIndex: byIdIndex };
    }
  }

  const requestedIndex =
    toRangeIndex(selection.userRangeIndex) ??
    toRangeIndex(selection.rangeIndex) ??
    toRangeIndex(selection._index);
  const rangeIndex = requestedIndex !== null && ranges[requestedIndex]
    ? requestedIndex
    : 0;

  return { activeRange: ranges[rangeIndex] || {}, rangeIndex };
};

export const flattenRangeSpecs = (range = {}, functionUnit = "", functionMeta = {}) => {
  const rawSpecs = range?.tolerances || range?.tolerance || {};
  const resolvedFunctionUnit = firstValue(
    range.functionUnit,
    range.unit,
    functionMeta.functionUnit,
    functionUnit,
    "",
  );
  const resolvedRangeId = firstValue(range.rangeId, range.id);
  const rangeName =
    firstValue(range.rangeName, typeof range.range === "string" ? range.range : undefined, "");

  return {
    min: range.min,
    max: range.max,
    unit: resolvedFunctionUnit || "",
    functionId: firstValue(functionMeta.functionId, range.functionId),
    functionName: firstValue(functionMeta.functionName, range.functionName),
    functionUnit: resolvedFunctionUnit || "",
    rangeId: resolvedRangeId,
    rangeName,
    _index: firstValue(functionMeta.rangeIndex, range._index),

    resolution: range.resolution ?? rawSpecs.resolution,
    resolutionUnit: range.resolutionUnit ?? rawSpecs.resolutionUnit,
    includeResolutionInBudget:
      range.includeResolutionInBudget ?? rawSpecs.includeResolutionInBudget,
    measuringResolution: range.measuringResolution ?? rawSpecs.measuringResolution,
    measuringResolutionUnit:
      range.measuringResolutionUnit ?? rawSpecs.measuringResolutionUnit,
    measuringResolutionDistribution:
      range.measuringResolutionDistribution ??
      rawSpecs.measuringResolutionDistribution,

    ...(range.isSingleValue
      ? { isSingleValue: true, value: range.value }
      : {}),

    ...rawSpecs,
  };
};

export const resolveInstrumentSelection = (masterDef = {}, selection = {}) => {
  const instrument = getInstrumentDefinition(masterDef);
  const functions = getFunctions(instrument);
  const activeFunction = resolveFunction(functions, selection);
  const ranges = activeFunction
    ? getFunctionRanges(activeFunction)
    : getLegacyRanges(instrument);
  const { activeRange, rangeIndex } = resolveRange(ranges, selection);

  const functionId = firstValue(
    activeFunction?.id,
    selection.userFunctionId,
    selection.functionId,
    activeRange.functionId,
  );
  const functionName = firstValue(
    activeFunction?.name,
    selection.userFunctionName,
    selection.functionName,
    activeRange.functionName,
    "",
  );
  const functionUnit = firstValue(
    activeRange.functionUnit,
    activeRange.unit,
    selection.userFunctionUnit,
    selection.functionUnit,
    activeFunction?.unit,
    activeFunction?.units?.[0],
    "",
  );
  const rangeId = firstValue(activeRange.rangeId, activeRange.id, selection.rangeId);
  const specs = flattenRangeSpecs(activeRange, functionUnit, {
    functionId,
    functionName,
    functionUnit,
    rangeIndex,
  });

  return {
    instrument,
    functions,
    activeFunction,
    ranges,
    activeRange,
    rangeIndex,
    functionId,
    functionName,
    functionUnit,
    rangeId,
    specs,
  };
};
