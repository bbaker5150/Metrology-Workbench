// Secondary uncertainties belong to an instrument, independently of its ranges.
// Collect legacy range-owned sources by id so existing budget links survive.
export function instrumentUncertaintySources(item = {}) {
  const instrument = item.instrument || item;
  const ranges = [...(item.ranges || []), ...(instrument.ranges || []),
    ...(instrument.functions || []).flatMap(fn => fn.ranges || [])];
  const sources = new Map();
  for (const source of [...(instrument.tmdeSecondaryUncertainties || []),
    ...ranges.flatMap(range => (range.tolerances || range.tolerance || range).tmdeSecondaryUncertainties || [])]) {
    if (!sources.has(source.id)) sources.set(source.id, source);
  }
  return [...sources.values()];
}

export function withInstrumentUncertaintySources(item, sources) {
  const strip = value => {
    const { tmdeSecondaryUncertainties, ...rest } = value;
    return rest;
  };
  const cleanRange = range => ({ ...strip(range),
    ...(range.tolerances ? { tolerances: strip(range.tolerances) } : {}),
    ...(range.tolerance ? { tolerance: strip(range.tolerance) } : {}),
  });
  const clean = instrument => ({ ...instrument, tmdeSecondaryUncertainties: sources,
    ...(instrument.ranges ? { ranges: instrument.ranges.map(cleanRange) } : {}),
    ...(instrument.functions ? { functions: instrument.functions.map(fn => ({ ...fn, ranges: (fn.ranges || []).map(cleanRange) })) } : {}),
  });
  return item.instrument ? { ...item, instrument: clean(item.instrument),
    ...(item.ranges ? { ranges: item.ranges.map(cleanRange) } : {}) } : clean(item);
}

export function inheritInstrumentUncertaintySources(range, item, sources = instrumentUncertaintySources(item)) {
  if (!sources.length) return range;
  return { ...range, tmdeSecondaryUncertainties: sources,
    ...(range.tolerances ? { tolerances: { ...range.tolerances, tmdeSecondaryUncertainties: sources } } : {}),
    ...(range.tolerance ? { tolerance: { ...range.tolerance, tmdeSecondaryUncertainties: sources } } : {}),
  };
}
