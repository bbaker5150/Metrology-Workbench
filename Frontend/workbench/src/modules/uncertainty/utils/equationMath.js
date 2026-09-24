import { parse } from "mathjs";

// Mathjs accepts Greek mu (μ), but excludes the micro sign (µ) commonly
// entered by engineering keyboards. Extend its documented character hook so
// parsing, evaluation and differentiation retain the exact authored symbol.
const defaultIsAlpha = parse.isAlpha;
parse.isAlpha = (character, previous, next) =>
  character === "µ" || /^\p{Script=Greek}$/u.test(character) || defaultIsAlpha(character, previous, next);

export * from "mathjs";
