/**
 * Risk 8.0 equation-uncertainty Monte Carlo engine.
 *
 * STATISTICAL VALIDATION NOTE
 * ---------------------------
 * This is a literal, reviewable port of `frmCalEquationUncertainty.RunMonteCarlo`
 * from the final V8.00 workbook (unchanged from Beta.4 in that module). It does not reuse the
 * application's former GUM-S1/empirical-interval engine.  The workbook method is:
 *
 *   1. Treat every equation input as Normal(mean = x_i, standard deviation = u_i).
 *   2. Apply the user correlation matrix with a lower-triangular Cholesky factor.
 *   3. Evaluate the measurement equation N times (default 10,000; minimum 100).
 *   4. Report the sample standard deviation, denominator N - 1, as u_c.
 *   5. Estimate effective DOF with the workbook's first-order
 *      Welch-Satterthwaite denominator, but use the Monte Carlo u_c in its
 *      numerator: v_eff = u_c^4 / sum((c_i u_i)^4 / v_i).
 *   6. Obtain k from the two-sided Student-t quantile (Normal when v_eff is
 *      infinite), then U = k u_c.
 *
 * The workbook calls VBA `Randomize`, so production intentionally uses
 * `Math.random`.  Tests inject a deterministic RNG; that seam is for validation
 * only and is not persisted as an application seed. JavaScript and VBA use
 * different random generators: parity covers the distribution and propagation
 * method, not identical individual draws or identical unseeded results.
 */

import * as math from "../equationMath";
import { correlationKey } from "../uncertaintyMath";
import { risk8Cholesky } from "./correlationMath8";
export { risk8Cholesky } from "./correlationMath8";

export const RISK8_MC_DEFAULT_TRIALS = 10000;
export const RISK8_MC_MIN_TRIALS = 100;

export function risk8MonteCarloInputHash({
  equationString,
  inputs,
  correlations = {},
  trials,
}) {
  return JSON.stringify({
    equation: String(equationString || "").trim(),
    inputs: (inputs || []).map((input) => ({
      symbol: input.symbol,
      componentId: input.componentId,
      meanBase: Number(input.meanBase),
      standardUncertaintyBase: Number(input.standardUncertaintyBase),
      dof: input.dof === Infinity ? "Inf" : input.dof,
    })),
    correlations,
    trials: normalizeRisk8MonteCarloTrials(trials),
  });
}

export function normalizeRisk8MonteCarloTrials(value) {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return RISK8_MC_DEFAULT_TRIALS;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !["number", "string"].includes(typeof value)) {
    throw new Error("Monte Carlo trials must be numeric.");
  }
  // ReadTrials uses VBA CLng before checking the minimum: nearest integer,
  // with exact half-integers rounded to the even integer.
  const floor = Math.floor(numeric);
  const fraction = numeric - floor;
  const count = fraction === 0.5 ? floor + (Math.abs(floor % 2)) : Math.round(numeric);
  if (count < RISK8_MC_MIN_TRIALS) {
    throw new Error(`Monte Carlo trials must be at least ${RISK8_MC_MIN_TRIALS}.`);
  }
  if (count > 2147483647) {
    throw new Error("Monte Carlo trials exceed the workbook's integer range.");
  }
  return count;
}

/** Workbook-equivalent Box-Muller draw.  VBA consumes two uniforms per draw
 * and discards the sine companion, so this port deliberately does the same. */
export function risk8StandardNormal(rng = Math.random) {
  let u1 = 0;
  while (u1 <= 0) u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}


function buildCorrelationMatrix(inputs, correlations) {
  return inputs.map((left, i) =>
    inputs.map((right, j) => {
      if (i === j) return 1;
      const leftId = left.componentId || left.symbol;
      const rightId = right.componentId || right.symbol;
      if (leftId === rightId) return 1;
      const raw = correlations?.[correlationKey(leftId, rightId)];
      if (raw == null || raw === "") return 0;
      const coefficient = Number(raw);
      if (!Number.isFinite(coefficient)) {
        throw new Error("Correlation coefficients must be numeric.");
      }
      return coefficient;
    }),
  );
}

function compileEquation(equationString) {
  let expression = String(equationString || "").trim();
  const equals = expression.indexOf("=");
  if (equals >= 0) expression = expression.slice(equals + 1).trim();
  if (!expression) throw new Error("A measurement equation is required.");
  return math.parse(expression).compile();
}

function influenceScore(samples, outputs, inputIndex, outputMean) {
  const count = outputs.length;
  if (count < 2) return 0;
  const pairs = Array.from({ length: count }, (_, index) => ({
    x: samples[index][inputIndex],
    y: outputs[index],
  })).sort((a, b) => a.x - b.x);
  if (Math.abs(pairs[count - 1].x - pairs[0].x) <= 1e-12) return 0;

  // Exact workbook bin selection and equal-count allocation.
  let bins = count < 50 ? 5 : count < 200 ? 10 : 20;
  bins = Math.min(bins, count);
  const baseSize = Math.floor(count / bins);
  const extra = count % bins;
  let cursor = 0;
  let score = 0;
  for (let bin = 0; bin < bins; bin += 1) {
    const size = baseSize + (bin < extra ? 1 : 0);
    let sum = 0;
    for (let j = 0; j < size; j += 1) sum += pairs[cursor + j].y;
    const binMean = sum / size;
    score += size * (binMean - outputMean) ** 2;
    cursor += size;
  }
  return score;
}

/**
 * Run the workbook's equation Monte Carlo in base SI units.
 *
 * inputs: [{ symbol, componentId, meanBase, standardUncertaintyBase }]
 */
export function runRisk8EquationMonteCarlo({
  equationString,
  inputs,
  correlations = {},
  trials = RISK8_MC_DEFAULT_TRIALS,
  rng = Math.random,
}) {
  const count = normalizeRisk8MonteCarloTrials(trials);
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("At least one equation input is required for Monte Carlo.");
  }
  const normalizedInputs = inputs.map((input) => {
    const meanBase = Number(input.meanBase);
    const standardUncertaintyBase = Number(input.standardUncertaintyBase);
    if (!input.symbol || !Number.isFinite(meanBase)) {
      throw new Error("Every Monte Carlo input requires a symbol and numeric mean.");
    }
    if (!Number.isFinite(standardUncertaintyBase) || standardUncertaintyBase < 0) {
      throw new Error("Every Monte Carlo standard uncertainty must be non-negative.");
    }
    return { ...input, meanBase, standardUncertaintyBase };
  });

  const compiled = compileEquation(equationString);
  const correlationMatrix = buildCorrelationMatrix(normalizedInputs, correlations);
  const lower = risk8Cholesky(correlationMatrix);
  const outputs = new Float64Array(count);
  const samples = Array.from({ length: count }, () =>
    new Float64Array(normalizedInputs.length),
  );
  const independent = new Float64Array(normalizedInputs.length);
  const scope = {};
  let outputMean = 0;

  for (let trial = 0; trial < count; trial += 1) {
    for (let i = 0; i < normalizedInputs.length; i += 1) {
      independent[i] = risk8StandardNormal(rng);
    }
    for (let i = 0; i < normalizedInputs.length; i += 1) {
      let correlatedNormal = 0;
      for (let k = 0; k <= i; k += 1) {
        correlatedNormal += lower[i][k] * independent[k];
      }
      const sampled =
        normalizedInputs[i].meanBase +
        normalizedInputs[i].standardUncertaintyBase * correlatedNormal;
      samples[trial][i] = sampled;
      scope[normalizedInputs[i].symbol] = sampled;
    }
    const output = compiled.evaluate(scope);
    if (typeof output !== "number" || !Number.isFinite(output)) {
      throw new Error(
        `The equation did not evaluate to a numeric value during Monte Carlo trial ${trial + 1}.`,
      );
    }
    outputs[trial] = output;
    outputMean += output;
  }

  outputMean /= count;
  let sumSquares = 0;
  for (let trial = 0; trial < count; trial += 1) {
    sumSquares += (outputs[trial] - outputMean) ** 2;
  }
  const standardUncertaintyBase = Math.sqrt(sumSquares / (count - 1));

  const rawInfluence = normalizedInputs.map((_, inputIndex) =>
    influenceScore(samples, outputs, inputIndex, outputMean),
  );
  const totalInfluence = rawInfluence.reduce((sum, value) => sum + value, 0);
  const influenceFractions = rawInfluence.map((value) =>
    // A zero total leaves workbook Influence cells blank, not 0%.
    totalInfluence > 0 ? value / totalInfluence : null,
  );

  // The nominal is f(x-bar), not the Monte Carlo mean.  This is how the
  // workbook populates NominalResult, including for nonlinear equations.
  const nominalScope = Object.fromEntries(
    normalizedInputs.map((input) => [input.symbol, input.meanBase]),
  );
  const nominalResultBase = compiled.evaluate(nominalScope);
  if (typeof nominalResultBase !== "number" || !Number.isFinite(nominalResultBase)) {
    throw new Error("The equation did not evaluate to a numeric nominal value.");
  }

  return {
    method: "Risk 8.0 Monte Carlo",
    trials: count,
    nominalResultBase,
    meanBase: outputMean,
    standardUncertaintyBase,
    influenceFractions,
    // Persist the compact audit trail, never the potentially enormous sample
    // arrays.  These are the exact matrices used for every generated trial and
    // let the UI explain the workbook-equivalent propagation without rerunning
    // a different random experiment just to render a breakdown.
    inputs: normalizedInputs.map((input) => ({
      symbol: input.symbol,
      componentId: input.componentId || null,
      meanBase: input.meanBase,
      standardUncertaintyBase: input.standardUncertaintyBase,
    })),
    correlationMatrix: correlationMatrix.map((row) => Array.from(row)),
    choleskyMatrix: lower.map((row) => Array.from(row)),
  };
}
