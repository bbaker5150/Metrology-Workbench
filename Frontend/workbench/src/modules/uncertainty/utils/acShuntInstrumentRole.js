// A physical shunt has one library identity. TI acceptance limits and
// reference calibration uncertainties remain separate specifications.
export function instrumentForRole(definition, role) {
  const identity = definition?.acShuntIdentity;
  if (!identity?.roles?.includes('uut') || !identity.roles.includes('tmde')) return definition;
  const copy = structuredClone(definition);
  const source = copy.acShuntIdentity;
  if (role === 'uut') {
    source.referenceFunctions ??= copy.functions;
    source.referenceTypeBComponents ??= copy.typeBComponents || [];
    copy.functions = structuredClone(source.uutFunctions || []);
    copy.typeBComponents = structuredClone(source.uutTypeBComponents || []);
    source.usageRole = 'uut';
    copy.type = 'uut';
  } else if (source.usageRole === 'uut') {
    copy.functions = source.referenceFunctions;
    copy.typeBComponents = source.referenceTypeBComponents;
    delete source.referenceFunctions;
    delete source.referenceTypeBComponents;
    delete source.usageRole;
    copy.type = 'tmde';
  }
  if (copy.validatedSnapshot) copy.validatedSnapshot = {
    ...copy.validatedSnapshot, functions: structuredClone(copy.functions),
    typeBComponents: structuredClone(copy.typeBComponents || []),
  };
  return copy;
}

export function canonicalShuntDefinition(instrument) {
  if (instrument?.acShuntIdentity?.usageRole !== 'uut') return instrument;
  const result = instrumentForRole(instrument, 'tmde');
  result.acShuntIdentity.uutFunctions = structuredClone(instrument.functions || []);
  result.acShuntIdentity.uutTypeBComponents = structuredClone(instrument.typeBComponents || []);
  return result;
}
