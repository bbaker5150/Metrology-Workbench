import { evaluateCaseDS, evaluateCaseSS, normalCDF, normalPDF } from "./risk8/riskEngine8";

const finite = value => typeof value === "number" && Number.isFinite(value);

// Read the same intermediate population model that produced the point's risk
// metrics. Explorations reuse its evaluator and never mutate the point.
export function buildRiskDistributionModel(riskResults, exploration = null) {
  const risk = riskResults?.risk8;
  const d = risk?.diagnostics;
  const frame = risk?.meta?.frame;
  if (!frame || !d?.core?.OK || risk.out?.statusCore !== "OK") {
    return { available: false, reason: risk?.out?.tolType >= 5
      ? "An unknown nominal uses an acceptance-boundary calculation. These population curves need a known nominal and an assumed REOP."
      : "Complete this point’s tolerance, uncertainty budget, and assumed REOP to see its error distributions.",
    };
  }
  const half = frame.halfSpan;
  if (!(half > 0) || !finite(frame.center)) return { available: false, reason: "The measurement point needs a valid tolerance scale." };
  const twoSided = d.mode === "two-sided";
  const reop = exploration?.reop ?? d.reop;
  const factor = exploration?.uncertaintyFactor ?? 1;
  if (!(factor > 0) || !(reop > 0 && reop < 1)) return { available: false, reason: "Choose an REOP between 0% and 100% and a positive uncertainty." };
  const tur = d.tur / factor;
  const fixedReference = risk.input?.turNeeded !== "" && risk.input?.turNeeded != null;
  const referenceTur = fixedReference ? d.turSolve : tur;
  const state = exploration ? (twoSided
    ? evaluateCaseDS(tur, reop, referenceTur, d.GBL, d.GBH, d.mu, d.LTL, d.UTL, d.xcal)
    : evaluateCaseSS(tur, reop, referenceTur, d.activeGB, d.activeUUT, d.mode, d.mu, d.xcal)) : d.core;
  if (!state.OK || !state.reopMet) return { available: false,
    reason: "This REOP is not feasible with these limits, biases, and reference calibration uncertainty. Adjust REOP or reset the exploration." };
  const lower = twoSided ? d.LTL * half : d.direction === "low" ? d.activeUUT * half : -Infinity;
  const upper = twoSided ? d.UTL * half : d.direction === "high" ? d.activeUUT * half : Infinity;
  const acceptLow = twoSided ? d.GBL * half : d.direction === "low" ? d.activeGB * half : -Infinity;
  const acceptHigh = twoSided ? d.GBH * half : d.direction === "high" ? d.activeGB * half : Infinity;
  const trueMean = d.mu * half, calMean = d.xcal * half;
  const trueSigma = state.su * half, calSigma = state.sc_in * half, observedSigma = state.sobs_in * half;
  const observedMean = trueMean + calMean;
  const extent = [0, lower, upper, acceptLow, acceptHigh,
    trueMean - 4 * trueSigma, trueMean + 4 * trueSigma,
    calMean - 4 * calSigma, calMean + 4 * calSigma,
    observedMean - 4 * observedSigma, observedMean + 4 * observedSigma].filter(finite);
  const min = Math.min(...extent), max = Math.max(...extent);
  const pad = Math.max((max - min) * 0.06, half * 0.1);
  return { available: true, state, reop, tur, referenceTur, fixedReference,
    nominal: frame.center, unit: riskResults.nativeUnit || "", half,
    lower, upper, acceptLow, acceptHigh, trueMean, calMean, observedMean,
    trueSigma, calSigma, observedSigma, referenceCalSigma: state.sc_solve * half,
    referenceObservedSigma: state.so_ref * half, domain: [min - pad, max + pad],
    hasGuardBand: Math.abs(acceptLow - lower) > half * 1e-9 || Math.abs(acceptHigh - upper) > half * 1e-9,
  };
}

export function acceptanceAtTrueError(model, error) {
  if (!model?.available || !finite(error)) return null;
  const mean = error + model.calMean;
  const cdf = bound => bound === Infinity ? 1 : bound === -Infinity ? 0 : normalCDF((bound - mean) / model.calSigma);
  const accepted = model.calSigma > 0 ? Math.max(0, Math.min(1, cdf(model.acceptHigh) - cdf(model.acceptLow)))
    : Number(mean >= model.acceptLow && mean <= model.acceptHigh);
  return { accepted, rejected: 1 - accepted, inTolerance: error >= model.lower && error <= model.upper, mean };
}

export function normalCurve(mean, sigma, domain, count = 181) {
  if (!(sigma > 0)) return [];
  // Include the peak and nearby samples even when the calibration distribution
  // is much narrower than the common error axis.
  const values = new Set(Array.from({ length: count }, (_, i) => domain[0] + (domain[1] - domain[0]) * i / (count - 1)));
  for (let i = -40; i <= 40; i++) values.add(mean + sigma * i / 10);
  return [...values].filter(x => x >= domain[0] && x <= domain[1]).sort((a, b) => a - b)
    .map(x => ({ x, y: normalPDF((x - mean) / sigma) / sigma }));
}
