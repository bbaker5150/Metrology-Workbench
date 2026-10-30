import { parse, derivative } from "./equationMath";

// Parsing, symbolic differentiation and compilation depend on the expression,
// never the measurement values. Keep only those immutable programs: each call
// still evaluates against its current scope, units and uncertainty sources.
// Bound the cache so visiting many sessions does not retain every equation.
export function createDerivedEquationCache(limit = 64) {
  const plans = new Map();
  return expression => {
    let plan = plans.get(expression);
    if (plan) {
      plans.delete(expression);
      plans.set(expression, plan);
      return plan;
    }
    const node = parse(expression);
    let compiled;
    const first = new Map();
    const second = new Map();
    const getDerivative = (symbol, order = 1) => {
      const cache = order === 1 ? first : second;
      if (!cache.has(symbol)) {
        const source = order === 1 ? node : getDerivative(symbol).node;
        const derivativeNode = derivative(source, symbol);
        cache.set(symbol, {
          node: derivativeNode,
          expression: derivativeNode.toString(),
          compiled: derivativeNode.compile(),
        });
      }
      return cache.get(symbol);
    };
    plan = {
      node,
      evaluate: scope => (compiled ||= node.compile()).evaluate(scope),
      getDerivative,
    };
    plans.set(expression, plan);
    if (plans.size > limit) plans.delete(plans.keys().next().value);
    return plan;
  };
}

export const getDerivedEquationPlan = createDerivedEquationCache();
