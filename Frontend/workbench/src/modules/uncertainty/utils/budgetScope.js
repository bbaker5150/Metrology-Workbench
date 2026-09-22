// Equation symbols identify input budgets; display names are optional and mutable.
export const inputSymbol = (component, mappings = {}) => {
  if (component?.variableSymbol) return component.variableSymbol;
  if (!component?.variableType) return null;
  const matches = Object.keys(mappings).filter(symbol => mappings[symbol] === component.variableType);
  return matches.length === 1 ? matches[0] : null;
};
export const belongsToInput = (component, symbol, mappings = {}) =>
  symbol ? inputSymbol(component, mappings) === symbol : !component.variableSymbol && !component.variableType;
export const inputBinding = scope => scope?.kind === "input"
  ? { variableSymbol: scope.variableSymbol || scope.variable, variableType: scope.variableType || "" } : {};
