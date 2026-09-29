import * as math from './equationMath';
import { extractEquationVariables, stripEquationPrefix } from './equationValidation';
import { unitSystem, validateEquationUnits } from './uncertaintyMath';

// A numeric preview remains useful while units or budgets are being authored.
// Invalid units never become a validated uncertainty/risk calculation.
export function measurementPreview(point, calculatedValue) {
  const target = point.testPointInfo?.parameter || {};
  try {
    const expression = stripEquationPrefix(point.equationString || '');
    const symbols = extractEquationVariables(expression);
    const inputs = point.variableNominals || {};
    const units = Object.fromEntries(symbols.map(symbol => [symbol, inputs[symbol]?.unit || '']));
    const unitsMatch = validateEquationUnits(expression, units, target.unit).status === 'valid';
    let value = calculatedValue;
    if (!Number.isFinite(value) || !unitsMatch) {
      const scope = {};
      for (const symbol of symbols) {
        const input = inputs[symbol];
        if (input?.value == null || String(input.value).trim() === '' || !Number.isFinite(Number(input.value))) return { value: null, unitsMatch };
        scope[symbol] = unitsMatch ? unitSystem.toBaseUnit(Number(input.value), input.unit) : Number(input.value);
      }
      value = math.evaluate(expression, scope);
      if (unitsMatch) value = unitSystem.fromBaseUnit(value, target.unit);
    }
    return { value: Number.isFinite(value) ? value : null, unitsMatch };
  } catch {
    return { value: Number.isFinite(calculatedValue) ? calculatedValue : null, unitsMatch: false };
  }
}
