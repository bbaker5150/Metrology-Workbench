// Validation for user-entered measurement equations (the derived point's
// f(x) editor and the custom equation library).
//
// The equation pipeline is mathjs end to end: the editor extracts variables
// from the parse tree, the linear engine differentiates it symbolically, and
// the Monte Carlo engine compiles and evaluates it per trial. This module
// front-loads everything that can go wrong so the user finds out while typing
// — not as a cryptic NaN three screens later:
//
//   - hard ERRORS for constructs that can never be a measurement equation
//     (assignments, function definitions, matrices, strings, booleans,
//     unknown function names, bare uses of built-in function names);
//   - WARNINGS for things that work but deserve attention (symbols shadowed
//     by mathjs constants, variables the symbolic engine cannot
//     differentiate — fine in Monte Carlo mode, fatal for the linear budget).
//
// The variable-extraction rule here MUST stay identical to the editor's
// (UncertaintyPanel handleEquationChange): a SymbolNode whose name exists on
// the mathjs namespace is a constant, except E (the electrical input symbol).

import * as math from "mathjs";

// Constants the editor treats as math constants even though their lowercase
// names are guarded specially there.
const CONSTANT_NAMES = ["e", "pi", "i"];

// Boolean/relational/bitwise operator functions a measurement equation can't
// meaningfully contain — the result would be true/false or a bit pattern.
const NON_NUMERIC_OPERATORS = new Set([
  "equal",
  "unequal",
  "smaller",
  "smallerEq",
  "larger",
  "largerEq",
  "and",
  "or",
  "xor",
  "not",
  "bitAnd",
  "bitOr",
  "bitXor",
  "bitNot",
  "leftShift",
  "rightArithShift",
  "rightLogShift",
]);

/** Strip an optional "y =" style prefix, mirroring the editor/engines. */
export function stripEquationPrefix(rawEquation) {
  let expression = String(rawEquation ?? "").trim();
  const equalsIndex = expression.indexOf("=");
  if (equalsIndex !== -1) {
    expression = expression.substring(equalsIndex + 1).trim();
  }
  return expression;
}

/**
 * Extract the variable symbols of an expression with the SAME rule the
 * equation editor uses. Throws if the expression does not parse.
 */
export function extractEquationVariables(expression) {
  const node = math.parse(expression);
  const vars = new Set();
  node.traverse((n, path, parent) => {
    if (!n.isSymbolNode) return;
    // A FunctionNode's name is a SymbolNode too — never a variable.
    if (parent && parent.isFunctionNode && parent.fn === n) return;
    // E is an authored electrical input; Euler’s constant remains lowercase e.
    if (n.name !== "E" && (math[n.name] || CONSTANT_NAMES.includes(n.name))) return;
    vars.add(n.name);
  });
  // Traversal follows the expression, which is also the order users expect in
  // Measurement Inputs. Preserve it when a symbol is renamed.
  return Array.from(vars);
}

/**
 * Validate a measurement equation.
 *
 * @param {string} rawEquation  the editor's raw text (may include "y =").
 * @returns {{
 *   status: "empty" | "invalid" | "ok",
 *   error: string | null,        // set when status === "invalid"
 *   warnings: string[],          // advisory, status stays "ok"
 *   expression: string,          // text after the optional "=" prefix
 *   variables: string[],         // symbols in their first equation appearance
 *   nonDifferentiable: string[], // variables the symbolic engine can't handle
 * }}
 */
export function validateEquation(rawEquation) {
  const expression = stripEquationPrefix(rawEquation);
  const result = {
    status: "ok",
    error: null,
    warnings: [],
    expression,
    variables: [],
    nonDifferentiable: [],
  };

  if (!expression) {
    result.status = "empty";
    return result;
  }

  // --- 1. Parse ---
  let node;
  try {
    node = math.parse(expression);
  } catch (e) {
    result.status = "invalid";
    result.error = `Equation does not parse: ${e.message}`;
    return result;
  }

  // --- 2. Structural checks (walk the whole tree) ---
  let structuralError = null;
  const shadowedConstants = new Set();
  const bareFunctionNames = new Set();
  const unknownFunctions = new Set();

  node.traverse((n, path, parent) => {
    if (structuralError) return;

    if (n.isAssignmentNode || n.isFunctionAssignmentNode) {
      structuralError =
        "Assignments are not allowed — enter just the right-hand expression (the editor treats everything before '=' as the result name).";
    } else if (n.isBlockNode) {
      structuralError =
        "Multiple statements (';') are not allowed — a measurement equation is a single expression.";
    } else if (n.isArrayNode || n.isObjectNode) {
      structuralError =
        "Matrices/arrays are not allowed — the equation must evaluate to a single number.";
    } else if (n.isIndexNode || n.isAccessorNode) {
      structuralError = "Indexing ('[..]' or '.') is not supported.";
    } else if (n.isRangeNode) {
      structuralError = "Ranges ('a:b') are not supported.";
    } else if (n.isConstantNode && typeof n.value === "string") {
      structuralError = "Text strings are not allowed in a measurement equation.";
    } else if (n.isOperatorNode && NON_NUMERIC_OPERATORS.has(n.fn)) {
      structuralError = `The '${n.op}' operator produces a true/false result, not a measurement value.`;
    } else if (n.isFunctionNode) {
      const fnName = n.fn?.name;
      if (fnName && typeof math[fnName] !== "function") {
        unknownFunctions.add(fnName);
      }
    } else if (n.isSymbolNode) {
      if (parent && parent.isFunctionNode && parent.fn === n) return;
      const name = n.name;
      if (name === "E" || CONSTANT_NAMES.includes(name)) return;
      const builtin = math[name];
      if (typeof builtin === "function") {
        // e.g. `sin * 2` or a variable named `cos`/`I` (math.I exists? as
        // function it would land here) — evaluates to the function object.
        bareFunctionNames.add(name);
      } else if (builtin !== undefined) {
        // Numeric/Complex constant (pi, tau, phi, E, LN2, …): silently treated
        // as that constant, NOT as a variable.
        shadowedConstants.add(name);
      }
    }
  });

  if (structuralError) {
    result.status = "invalid";
    result.error = structuralError;
    return result;
  }
  if (unknownFunctions.size > 0) {
    result.status = "invalid";
    result.error = `Unknown function${unknownFunctions.size > 1 ? "s" : ""}: ${[...unknownFunctions].join(", ")}. Use the f(x) menu to see the supported functions.`;
    return result;
  }
  if (bareFunctionNames.size > 0) {
    result.status = "invalid";
    result.error = `'${[...bareFunctionNames].join("', '")}' is a built-in mathjs function name and cannot be used as a variable — rename it (e.g. '${[...bareFunctionNames][0]}1').`;
    return result;
  }

  // --- 3. Variables ---
  result.variables = extractEquationVariables(expression);

  if (shadowedConstants.size > 0) {
    const names = [...shadowedConstants];
    result.warnings.push(
      `${names.map((s) => `'${s}'`).join(", ")} ${names.length > 1 ? "are" : "is"} a built-in mathjs constant${names.length > 1 ? "s" : ""} (e.g. phi = 1.618…), so it will NOT be treated as a variable. Rename it (e.g. '${names[0]}1') if you meant an input quantity.`,
    );
  }

  if (result.variables.length === 0) {
    result.warnings.push(
      "The equation has no input variables — it evaluates to a constant, so no uncertainty can propagate.",
    );
  }

  // --- 4. Type probe: evaluate with every variable = 1, 0.5, 2 ---
  // Domains can legitimately fail at probe values (real nominals may differ),
  // so an evaluation THROW is only a warning. A non-number RESULT TYPE
  // (boolean, function, matrix, …) can never become a measurement value.
  let probedOk = false;
  let probeTypeError = null;
  let producedComplex = false;
  try {
    const compiled = node.compile();
    for (const probeValue of [1, 0.5, 2]) {
      const scope = {};
      result.variables.forEach((v) => {
        scope[v] = probeValue;
      });
      try {
        const value = compiled.evaluate(scope);
        if (typeof value === "number") {
          if (Number.isFinite(value)) probedOk = true;
        } else if (value && value.isComplex) {
          producedComplex = true;
        } else {
          probeTypeError = `The equation evaluates to ${typeof value === "boolean" ? "true/false" : "a non-numeric result"}, not a number.`;
          break;
        }
      } catch {
        // domain failure at this probe — try the next value
      }
    }
  } catch (e) {
    result.status = "invalid";
    result.error = `Equation cannot be compiled: ${e.message}`;
    return result;
  }
  if (probeTypeError) {
    result.status = "invalid";
    result.error = probeTypeError;
    return result;
  }
  if (!probedOk) {
    result.warnings.push(
      producedComplex
        ? "The equation produced a complex (imaginary) result at test values — check for sqrt/log of expressions that can go negative at your operating point."
        : "The equation could not be evaluated at test values (domain error). It may still work at your actual nominal values — double-check operating ranges.",
    );
  }

  // --- 5. Differentiability probe (linear engine compatibility) ---
  result.variables.forEach((symbol) => {
    try {
      math.derivative(node, symbol);
    } catch {
      result.nonDifferentiable.push(symbol);
    }
  });
  if (result.nonDifferentiable.length > 0) {
    result.warnings.push(
      `Not symbolically differentiable in ${result.nonDifferentiable.map((s) => `'${s}'`).join(", ")} — the first-order (GUM) budget cannot evaluate this equation. Switch the point to Monte Carlo propagation, which needs no derivatives.`,
    );
  }

  return result;
}
