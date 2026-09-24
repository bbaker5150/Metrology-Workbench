// Apply a point-local override to exactly one authored uncertainty source.
// Source ids, rather than display names, keep renamed/similarly named sources
// distinct when linked budgets refresh from their instrument range.
export function patchTmdeUncertaintySource(tolerance, sourceId, updates) {
  const writeDistribution = value => {
    const next = { ...value };
    const keys = updates.componentKind === "dB" ? ["db"] : ["reading", "range", "floor", "readings_iv", "singleSided"];
    for (const key of keys) {
      if (next[key]) next[key] = { ...next[key], distribution: String(updates.distribution) };
    }
    return { ...next, bandDistribution: String(updates.distribution) };
  };
  if (sourceId === "primary") {
    const definition = updates.dynamicDefinition || tolerance.tmdeUncertaintyDefinition;
    if (!definition) return updates.distribution !== undefined ? writeDistribution(tolerance) : tolerance;
    return { ...tolerance, tmdeUncertaintyDefinition: definition && {
      ...definition, name: "TMDE Error",
      ...(updates.distribution !== undefined ? { distribution: String(updates.distribution) } : {}),
    } };
  }
  return { ...tolerance, tmdeSecondaryUncertainties: (tolerance.tmdeSecondaryUncertainties || []).map(source => {
    if (source.id !== sourceId) return source;
    if (source.kind === "table" || source.kind === "equation") return { ...source,
      dynamicDefinition: { ...(updates.dynamicDefinition || source.dynamicDefinition), name: source.name,
        ...(updates.distribution !== undefined ? { distribution: String(updates.distribution) } : {}) },
    };
    return updates.distribution !== undefined ? { ...source, tolerance: writeDistribution(source.tolerance) } : source;
  }) };
}

export function applyTmdeUncertaintyOverrides(tolerance) {
  return Object.entries(tolerance.tmdeUncertaintyOverrides || {}).reduce(
    (next, [sourceId, updates]) => patchTmdeUncertaintySource(next, sourceId, updates), tolerance,
  );
}
