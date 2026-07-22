const GREEK_SYMBOLS = {
  alpha: ["α", "\\alpha"],
  beta: ["β", "\\beta"],
  gamma: ["γ", "\\gamma"],
  delta: ["δ", "\\delta"],
  epsilon: ["ε", "\\epsilon"],
  zeta: ["ζ", "\\zeta"],
  eta: ["η", "\\eta"],
  theta: ["θ", "\\theta"],
  iota: ["ι", "\\iota"],
  kappa: ["κ", "\\kappa"],
  lambda: ["λ", "\\lambda"],
  mu: ["μ", "\\mu"],
  nu: ["ν", "\\nu"],
  xi: ["ξ", "\\xi"],
  omicron: ["ο", "o"],
  pi: ["π", "\\pi"],
  rho: ["ρ", "\\rho"],
  sigma: ["σ", "\\sigma"],
  tau: ["τ", "\\tau"],
  upsilon: ["υ", "\\upsilon"],
  phi: ["φ", "\\phi"],
  chi: ["χ", "\\chi"],
  psi: ["ψ", "\\psi"],
  omega: ["ω", "\\omega"],
  Alpha: ["Α", "A"],
  Beta: ["Β", "B"],
  Gamma: ["Γ", "\\Gamma"],
  Delta: ["Δ", "\\Delta"],
  Epsilon: ["Ε", "E"],
  Zeta: ["Ζ", "Z"],
  Eta: ["Η", "H"],
  Theta: ["Θ", "\\Theta"],
  Iota: ["Ι", "I"],
  Kappa: ["Κ", "K"],
  Lambda: ["Λ", "\\Lambda"],
  Mu: ["Μ", "M"],
  Nu: ["Ν", "N"],
  Xi: ["Ξ", "\\Xi"],
  Omicron: ["Ο", "O"],
  Pi: ["Π", "\\Pi"],
  Rho: ["Ρ", "P"],
  Sigma: ["Σ", "\\Sigma"],
  Tau: ["Τ", "T"],
  Upsilon: ["Υ", "\\Upsilon"],
  Phi: ["Φ", "\\Phi"],
  Chi: ["Χ", "X"],
  Psi: ["Ψ", "\\Psi"],
  Omega: ["Ω", "\\Omega"],
};

const parseGreekVariable = (rawName) => {
  const name = String(rawName || "");
  const separator = name.indexOf("_");
  const base = separator >= 0 ? name.slice(0, separator) : name;
  const symbol = GREEK_SYMBOLS[base];
  if (!symbol) return null;
  return {
    unicode: symbol[0],
    tex: symbol[1],
    suffix: separator >= 0 ? name.slice(separator + 1).replace(/_/g, "") : "",
  };
};

const escapeTexText = (value) =>
  String(value || "").replace(/([{}%$#&_])/g, "\\$1");

// An underscore is the explicit join marker: theta_Change becomes θChange,
// while thetaChange remains an ordinary, literal variable name.
export const formatEquationVariableSymbol = (name) => {
  const parsed = parseGreekVariable(name);
  if (!parsed) return String(name || "");
  return `${parsed.unicode}${parsed.suffix}`;
};

export const equationVariableToTex = (name) => {
  const parsed = parseGreekVariable(name);
  if (!parsed) return null;
  return parsed.suffix
    ? `${parsed.tex}\\mathrm{${escapeTexText(parsed.suffix)}}`
    : parsed.tex;
};

// mathjs exposes a SymbolNode handler specifically for presentation overrides.
// Evaluation continues to use the user's original variable name; only KaTeX's
// rendered expression is transformed.
export const equationTexOptions = {
  parenthesis: "keep",
  handler: (node) => {
    if (!node?.isSymbolNode) return undefined;
    return equationVariableToTex(node.name) || undefined;
  },
};

export default formatEquationVariableSymbol;
