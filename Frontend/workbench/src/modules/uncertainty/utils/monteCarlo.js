// GUM Supplement 1 (JCGM 101) Monte Carlo propagation engine.
//
// Why this exists: the first-order engine in uncertaintyMath.js
// (calculateDerivedUncertainty) is blind at stationary points — an input whose
// ∂f/∂x evaluates to 0 at the operating point (null/balance measurements,
// unity power factor, RSS terms near zero) contributes nothing to the linear
// budget even though its uncertainty really does propagate via higher-order
// terms. This module propagates by sampling each tolerance component from its
// ACTUAL distribution (the divisor dropdown already records it), evaluating
// the measurement equation per trial, and summarizing the empirical output
// distribution. It needs no derivatives at all, so zero-gradient,
// non-differentiable, and strongly nonlinear equations all come out right,
// including asymmetric/one-sided outputs (reported as a shortest coverage
// interval rather than a symmetric ±U).
//
// Everything is deterministic for a given seed, so reported numbers reproduce
// across sessions and machines. The engine is pure and synchronous; UI code
// should call it through monteCarlo.worker.js to stay off the render thread.

import * as math from "mathjs";
import {
  CumNorm,
  normalQuantile,
  getCorrelation,
  unitSystem,
  calculateUncertaintyFromToleranceObject,
} from "./uncertaintyMath";

// ==========================================
// Seeded PRNG (mulberry32) + Gaussian source
// ==========================================

export function createSeededRandom(seed = 0x9e3779b9) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box–Muller standard normals with spare caching.
export function makeGaussian(rng) {
  let spare = null;
  return function () {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    const u1 = rng(); // [0,1) → 1-u1 ∈ (0,1], log is safe
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(1 - u1));
    const theta = 2 * Math.PI * u2;
    spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}

// ==========================================
// Distributions
// ==========================================

// The budget UI stores each component's distribution as the divisor that maps
// its half-span to a standard uncertainty (errorDistributions in
// uncertaintyMath.js). Recover the shape from that divisor. All the
// "Normal (NN%)" divisors collapse to a normal with σ = u — the divisor only
// mattered for converting the spec to u, which has already happened.
const DIVISOR_SHAPES = [
  { value: Math.sqrt(3), id: "rectangular" },
  { value: 2 * Math.sqrt(3), id: "rectangular" },
  { value: Math.sqrt(6), id: "triangular" },
  { value: 2 * Math.sqrt(6), id: "triangular" },
  { value: Math.sqrt(2), id: "arcsine" }, // "U-Shaped"
  { value: 4.179, id: "rayleigh" },
];

export function distributionFromDivisor(divisor) {
  const d = parseFloat(divisor);
  if (!Number.isFinite(d)) return "normal";
  for (const { value, id } of DIVISOR_SHAPES) {
    if (Math.abs(d - value) < 0.01) return id;
  }
  return "normal";
}

// Inverse CDF of each zero-mean marginal with standard uncertainty u.
// Used with a Gaussian copula: p comes from Φ(z) of a (possibly correlated)
// standard normal, so one code path serves both independent and correlated
// sampling.
function inverseCdf(distribution, p, u) {
  switch (distribution) {
    case "rectangular": {
      const a = u * Math.sqrt(3); // half-width
      return a * (2 * p - 1);
    }
    case "triangular": {
      const a = u * Math.sqrt(6);
      return p <= 0.5
        ? a * (Math.sqrt(2 * p) - 1)
        : a * (1 - Math.sqrt(2 * (1 - p)));
    }
    case "arcsine": {
      const a = u * Math.SQRT2;
      return a * Math.sin(Math.PI * (p - 0.5));
    }
    case "rayleigh": {
      // Zero-mean shifted Rayleigh scaled so its std equals u.
      const sigma = u * Math.sqrt(2 / (4 - Math.PI));
      return sigma * (Math.sqrt(-2 * Math.log(1 - p)) - Math.sqrt(Math.PI / 2));
    }
    case "normal":
    default:
      return u * normalQuantile(p);
  }
}

// ==========================================
// Correlation (Gaussian copula, component level)
// ==========================================

function cholesky(matrix) {
  const n = matrix.length;
  const L = Array.from({ length: n }, () => new Float64Array(n));
  for (let j = 0; j < n; j++) {
    let d = matrix[j][j];
    for (let k = 0; k < j; k++) d -= L[j][k] * L[j][k];
    if (d < -1e-8) return null; // genuinely non-PSD
    // Zero pivot (singular but PSD, e.g. ρ = ±1) is fine: the row collapses
    // onto earlier factors, giving exactly comonotone samples.
    L[j][j] = d > 0 ? Math.sqrt(d) : 0;
    for (let i = j + 1; i < n; i++) {
      let s = matrix[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = L[j][j] > 0 ? s / L[j][j] : 0;
    }
  }
  return L;
}

// The app's correlation map is keyed by variable identity (componentId =
// variableType), but a variable's uncertainty may be several independent
// components. Spread the variable-level ρ across every cross-variable
// component pair, scaled so the variables' TOTAL covariance comes out as
// ρ·u_A·u_B (with u the RSS of the variable's components):
//   c_pair = ρ · (rss_A·rss_B) / (sum_A·sum_B)
// Within-variable pairs stay independent, matching the linear engine's RSS.
// Note: with non-normal marginals a Gaussian copula reproduces the target
// Pearson correlation only approximately (error ≲ ~2%) — the same order of
// approximation the linear engine makes by ignoring marginal shape entirely.
function buildComponentCholesky(comps, correlations) {
  if (!correlations || Object.keys(correlations).length === 0) return null;

  const groups = {};
  comps.forEach((c) => {
    const g = (groups[c.groupId] ||= { sum: 0, sq: 0 });
    g.sum += c.u;
    g.sq += c.u * c.u;
  });

  const n = comps.length;
  const R = Array.from({ length: n }, (_, i) => {
    const row = new Float64Array(n);
    row[i] = 1;
    return row;
  });
  let anyOffDiagonal = false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const gi = comps[i].groupId;
      const gj = comps[j].groupId;
      if (gi === gj) continue;
      const rho = getCorrelation(correlations, gi, gj);
      if (rho === 0) continue;
      const a = groups[gi];
      const b = groups[gj];
      let c = (rho * Math.sqrt(a.sq * b.sq)) / (a.sum * b.sum);
      c = Math.max(-1, Math.min(1, c));
      R[i][j] = c;
      R[j][i] = c;
      anyOffDiagonal = true;
    }
  }
  if (!anyOffDiagonal) return null;

  // Same defensive posture as combineWithCorrelation's variance clamp: an
  // over-correlated (non-PSD) matrix is blended toward identity until it
  // factors, rather than failing the whole evaluation.
  for (const lambda of [0, 1e-10, 1e-6, 1e-3, 1e-2]) {
    const M =
      lambda === 0
        ? R
        : R.map((row, i) =>
            row.map((v, j) => (i === j ? 1 : v * (1 - lambda)))
          );
    const L = cholesky(M);
    if (L) return L;
  }
  throw new Error(
    "Input correlation matrix is not positive semi-definite; cannot sample jointly."
  );
}

// ==========================================
// Shortest coverage interval (JCGM 101 §7.7)
// ==========================================

function shortestCoverageInterval(sortedSamples, n, probability) {
  if (n === 0) return { low: NaN, high: NaN };
  const w = Math.min(n, Math.max(1, Math.ceil(probability * n)));
  let bestLow = sortedSamples[0];
  let bestHigh = sortedSamples[n - 1];
  let bestWidth = bestHigh - bestLow;
  for (let i = 0; i + w - 1 < n; i++) {
    const width = sortedSamples[i + w - 1] - sortedSamples[i];
    if (width < bestWidth) {
      bestWidth = width;
      bestLow = sortedSamples[i];
      bestHigh = sortedSamples[i + w - 1];
    }
  }
  return { low: bestLow, high: bestHigh };
}

// ==========================================
// Main engine
// ==========================================

/**
 * Propagate uncertainty through a measurement equation by Monte Carlo
 * simulation (GUM Supplement 1).
 *
 * @param {Object} options
 * @param {string} options.equationString  e.g. "y = V * I * cos(phi)" — text
 *        before "=" is stripped, same convention as calculateDerivedUncertainty.
 * @param {Array}  options.inputs  one entry per equation variable:
 *        { symbol, groupId, nominalBase, components: [{ u, distribution }] }
 *        — nominalBase and every u in consistent (base SI) units; distribution
 *        is "rectangular" | "triangular" | "arcsine" | "rayleigh" | "normal".
 * @param {Object} [options.correlations]  the app's sparse map keyed by
 *        correlationKey(groupIdA, groupIdB).
 * @param {number} [options.coverageProbability=0.95]
 * @param {number} [options.seed]  PRNG seed; same seed ⇒ identical results.
 * @param {number} [options.samples=200000]  trial count when adaptive=false.
 * @param {boolean}[options.adaptive=false]  run in batches until the batch
 *        spread of u stabilizes (simplified JCGM 101 §7.9), up to maxSamples.
 * @param {boolean}[options.returnSamples=false]  include the raw output
 *        samples (Float64Array) for downstream empirical risk integration.
 *
 * @returns {{ mean, standardUncertainty, intervalLow, intervalHigh,
 *            coverageProbability, samplesUsed, seed, samples? }}
 *          All values in the same (base) units as the inputs. The interval is
 *          the SHORTEST interval containing coverageProbability of the
 *          samples, so it is asymmetric whenever the output distribution is.
 */
export function runMonteCarloPropagation({
  equationString,
  inputs,
  correlations = {},
  coverageProbability = 0.95,
  seed = 0x5eed,
  samples = 200000,
  adaptive = false,
  batchSize = 50000,
  maxSamples = 1000000,
  relTol = 0.005,
  returnSamples = false,
  quantileCount = 0,
}) {
  if (!equationString || !Array.isArray(inputs)) {
    throw new Error("Monte Carlo propagation requires an equation and inputs.");
  }
  let expression = equationString.trim();
  const equalsIndex = expression.indexOf("=");
  if (equalsIndex !== -1) {
    expression = expression.substring(equalsIndex + 1).trim();
  }
  if (!expression) throw new Error("Equation expression is empty.");
  const compiled = math.parse(expression).compile();

  // Flatten uncertain components; zero-u components perturb nothing.
  const comps = [];
  inputs.forEach((input, inputIndex) => {
    (input.components || []).forEach((c) => {
      const u = parseFloat(c.u);
      if (Number.isFinite(u) && u > 0) {
        comps.push({
          u,
          distribution: c.distribution || "normal",
          inputIndex,
          groupId: input.groupId ?? input.symbol,
        });
      }
    });
  });

  const L = buildComponentCholesky(comps, correlations);

  const scope = {};
  const cap = adaptive ? maxSamples : samples;
  const ys = new Float64Array(cap);
  const gauss = makeGaussian(createSeededRandom(seed));
  const z = new Float64Array(comps.length);
  const zc = L ? new Float64Array(comps.length) : z;

  let n = 0;
  const batchUs = [];
  const perBatch = adaptive ? batchSize : samples;
  while (n < cap) {
    const end = Math.min(n + perBatch, cap);
    // Welford within the batch, for the adaptive stability check.
    let bCount = 0;
    let bMean = 0;
    let bM2 = 0;
    for (; n < end; n++) {
      for (let i = 0; i < comps.length; i++) z[i] = gauss();
      if (L) {
        for (let i = 0; i < comps.length; i++) {
          let s = 0;
          for (let k = 0; k <= i; k++) s += L[i][k] * z[k];
          zc[i] = s;
        }
      }
      for (const input of inputs) scope[input.symbol] = input.nominalBase;
      for (let i = 0; i < comps.length; i++) {
        const c = comps[i];
        let dx;
        if (c.distribution === "normal") {
          dx = c.u * zc[i]; // exact, skips the Φ/Φ⁻¹ round trip
        } else {
          let p = CumNorm(zc[i]);
          if (p < 1e-16) p = 1e-16;
          else if (p > 1 - 1e-16) p = 1 - 1e-16;
          dx = inverseCdf(c.distribution, p, c.u);
        }
        scope[inputs[c.inputIndex].symbol] += dx;
      }
      const y = compiled.evaluate(scope);
      if (typeof y !== "number" || !Number.isFinite(y)) {
        // A non-finite/complex trial means the input distributions reach
        // outside the equation's domain (e.g. sqrt of a value that can go
        // negative) — a real finding, not a numerical hiccup.
        throw new Error(
          "Equation produced a non-finite result during simulation: the input uncertainties extend outside the equation's domain."
        );
      }
      ys[n] = y;
      bCount++;
      const d = y - bMean;
      bMean += d / bCount;
      bM2 += d * (y - bMean);
    }
    batchUs.push(bCount > 1 ? Math.sqrt(bM2 / (bCount - 1)) : 0);
    if (!adaptive) break;
    if (batchUs.length >= 3) {
      const m = batchUs.length;
      const mu = batchUs.reduce((a, b) => a + b, 0) / m;
      const sd = Math.sqrt(
        batchUs.reduce((a, b) => a + (b - mu) ** 2, 0) / (m - 1)
      );
      if (mu === 0 || sd / Math.sqrt(m) <= relTol * mu) break;
    }
  }

  // Final statistics over all trials.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += ys[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (ys[i] - mean) ** 2;
  variance = n > 1 ? variance / (n - 1) : 0;

  const sorted = ys.slice(0, n);
  sorted.sort();
  const { low, high } = shortestCoverageInterval(sorted, n, coverageProbability);

  const result = {
    mean,
    standardUncertainty: Math.sqrt(variance),
    intervalLow: low,
    intervalHigh: high,
    coverageProbability,
    samplesUsed: n,
    seed,
  };
  if (quantileCount > 1 && n > 0) {
    // Evenly spaced quantiles of the OUTPUT distribution (p_k = k/(m-1),
    // endpoints included). A compact, persistable stand-in for the full sample
    // set: downstream risk integration resamples measurement errors from this
    // table by inverse-CDF interpolation (see empiricalRisk.js).
    const m = Math.floor(quantileCount);
    const quantiles = new Array(m);
    for (let k = 0; k < m; k++) {
      quantiles[k] = sorted[Math.round((k * (n - 1)) / (m - 1))];
    }
    result.quantiles = quantiles;
  }
  if (returnSamples) result.samples = sorted;
  return result;
}

// User-selectable trial-count ceiling for a point's simulation. The default
// matches the original fixed cap; more trials trade runtime for smoother
// distribution tails (empirical PFA resolves smaller probabilities).
export const DEFAULT_MC_MAX_SAMPLES = 400000;
export const MC_SAMPLE_CHOICES = [
  50000, 100000, 200000, 400000, 1000000, 2000000,
];

// Normalize a persisted/typed trial count to a sane simulation cap. Anything
// non-numeric falls back to the default, so points saved before this setting
// existed hash identically to "default" and stay fresh.
export function normalizeMcSampleCount(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MC_MAX_SAMPLES;
  return Math.min(Math.max(n, 10000), 5000000);
}

/**
 * Canonical hash of everything that feeds a Monte Carlo run for a derived
 * point. Shared by useMonteCarlo (to key its cache), the persisted mcSummary,
 * and the risk pipeline (to detect a stale summary after the user edits the
 * equation, TMDEs, manual components, correlations, or trial count). All
 * consumers MUST pass the RECONCILED TMDE instance list so the hashes agree.
 */
export function computeMcInputsHash({
  equationString,
  variableMappings,
  correlations,
  tmdeTolerances,
  manualComponents,
  maxSamples,
}) {
  if (!equationString) return null;
  try {
    return JSON.stringify({
      eq: equationString,
      map: variableMappings || {},
      cor: correlations || {},
      tmde: tmdeTolerances || [],
      man: manualComponents || [],
      n: normalizeMcSampleCount(maxSamples),
    });
  } catch {
    return null;
  }
}

// ==========================================
// Bridge from the app's derived-point data
// ==========================================

/**
 * Build runMonteCarloPropagation inputs from the SAME data the linear engine
 * consumes (variable mappings + TMDE instances + manual components), but
 * keeping per-tolerance-component granularity so each piece is sampled from
 * its own distribution. Mirrors calculateDerivedUncertainty's input
 * processing: additive composition across TMDEs on one variable, quantity as
 * independent instances, ppm-based uncertainties anchored on each TMDE's own
 * measurement point.
 *
 * @returns {{ inputs: Array, missingTypes: Array<string> }}
 */
export function buildMonteCarloInputs(
  variableMappings,
  tmdeTolerances = [],
  manualComponents = []
) {
  const byType = {};

  tmdeTolerances.forEach((tmde) => {
    if (
      !tmde.variableType ||
      !tmde.measurementPoint ||
      tmde.measurementPoint.value === "" ||
      tmde.measurementPoint.unit === ""
    ) {
      return;
    }
    const nominalValue = parseFloat(tmde.measurementPoint.value);
    if (isNaN(nominalValue)) return;

    const { breakdown } = calculateUncertaintyFromToleranceObject(
      tmde.tolerance || tmde,
      tmde.measurementPoint,
      true
    );
    const nominalInBase = unitSystem.toBaseUnit(
      nominalValue,
      tmde.measurementPoint.unit
    );
    const quantity = parseInt(tmde.quantity, 10) || 1;

    const entry = (byType[tmde.variableType] ||= {
      nominalBase: 0,
      components: [],
      unit: tmde.measurementPoint.unit,
    });
    entry.nominalBase += nominalInBase * quantity;
    (breakdown || []).forEach((comp) => {
      // ppm semantics, mirroring the linear engine (an input whose nominal is
      // exactly 0 contributes no relative uncertainty there either).
      const uBase = (comp.u_i / 1e6) * Math.abs(nominalInBase);
      if (!(uBase > 0)) return;
      const distribution = distributionFromDivisor(comp.divisor);
      for (let q = 0; q < quantity; q++) {
        entry.components.push({ u: uBase, distribution });
      }
    });
  });

  (manualComponents || []).forEach((comp) => {
    const varType = comp.variableType || comp.name;
    const existing = byType[varType];
    const nativeUnit = comp.unit_native || comp.unit || existing?.unit || "";
    const uNative =
      comp.value_native !== undefined && comp.value_native !== null
        ? parseFloat(comp.value_native)
        : parseFloat(comp.value);

    if (existing && !isNaN(uNative) && nativeUnit) {
      const uBase = unitSystem.toBaseUnit(uNative, nativeUnit);
      if (!isNaN(uBase) && uBase > 0) {
        existing.components.push({ u: uBase, distribution: "normal" });
      }
      return;
    }

    const nominalValue = parseFloat(comp.nominal);
    if (!isNaN(nominalValue)) {
      const nominalInBase = comp.unit
        ? unitSystem.toBaseUnit(nominalValue, comp.unit)
        : nominalValue;
      const uValNative = parseFloat(comp.value) || 0;
      const uBase = comp.unit
        ? unitSystem.toBaseUnit(uValNative, comp.unit)
        : uValNative;
      const entry = (byType[varType] ||= {
        nominalBase: nominalInBase,
        components: [],
        unit: comp.unit || "",
      });
      if (uBase > 0) entry.components.push({ u: uBase, distribution: "normal" });
    }
  });

  const inputs = [];
  const missingTypes = [];
  Object.entries(variableMappings || {}).forEach(([symbol, type]) => {
    const entry = byType[type];
    if (!entry) {
      missingTypes.push(type);
      return;
    }
    inputs.push({
      symbol,
      groupId: type, // correlation-map identity, matches the budget row's type
      nominalBase: entry.nominalBase,
      components: entry.components,
    });
  });

  return { inputs, missingTypes };
}
