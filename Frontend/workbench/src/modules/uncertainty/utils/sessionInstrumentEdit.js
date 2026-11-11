/** Merge a modal edit without leaving aliases attached to the old definition. */
export const mergeSessionInstrumentEdit = (previous, updated) => {
  const next = { ...previous, ...updated };
  const nextDefinitionId = updated.instrument?.id;
  if (nextDefinitionId == null || previous?.instrument?.id === nextDefinitionId) return next;

  const previousAliases = new Set([
    previous?.instrument?.id,
    previous?.libraryInstrumentId,
    previous?.instrument?.libraryInstrumentId,
  ].filter(value => value != null).map(String));
  for (const key of ["libraryInstrumentId", "definitionId", "instrumentId", "sourceInstrumentId"]) {
    if (next[key] != null && previousAliases.has(String(next[key]))) next[key] = nextDefinitionId;
  }
  if (next.sourceInstrument?.id != null && previousAliases.has(String(next.sourceInstrument.id))) {
    next.sourceInstrument = { ...next.sourceInstrument, id: nextDefinitionId };
  }
  return next;
};
