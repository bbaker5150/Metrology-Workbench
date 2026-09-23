import React, { useMemo } from "react";
import { getPointBiasSources, getUutBiasDefault, resolveMeasurementBias } from "../../../utils/measurementBias";
import { calculateUncertaintyFromToleranceObject, resolveResolutionNative, snapLimitsToResolution, unitSystem } from "../../../utils/uncertaintyMath";
import { normalCDF } from "../../../utils/risk8/riskEngine8";

const WIDTH = 1000;
const LEFT = 68;
const RIGHT = 932;
const BASE = 246;
const TOP = 52;
const finite = value => value !== null && value !== "" && Number.isFinite(Number(value));
const format = value => Number(value).toLocaleString(undefined, { maximumSignificantDigits: 6 });
const signed = value => `${value >= 0 ? "+" : "−"}${format(Math.abs(value))}`;
const activeBias = spec => spec?.value !== undefined && spec?.value !== null && String(spec.value).trim() !== "" && !spec.corrected && Number(spec.value) !== 0;

export function hasActivePointBias(point = {}, session = {}) {
  const tolerance = point.uutTolerance || session.uutTolerance;
  if ((tolerance?.singleSided || tolerance?.tolerances?.singleSided)?.measurement === "unknown") return false;
  const uutSpec = point.uutBias?.mode === "override" ? point.uutBias : getUutBiasDefault(point, session);
  if (activeBias(uutSpec)) return true;
  if (point.measurementBias?.mode === "manual") return activeBias(point.measurementBias);
  return getPointBiasSources(point, session).some(source => activeBias(source.spec));
}

function displayLimits(point, session, referencePoint, riskResults) {
  if (finite(riskResults?.LLow) || finite(riskResults?.LUp)) {
    return { lower: finite(riskResults.LLow) ? Number(riskResults.LLow) : null,
      upper: finite(riskResults.LUp) ? Number(riskResults.LUp) : null };
  }
  const tolerance = point?.uutTolerance || session?.uutTolerance || {};
  const single = tolerance.singleSided || tolerance.tolerances?.singleSided;
  if (single) return { lower: single.direction === "low" && finite(single.limit) ? Number(single.limit) : null,
    upper: single.direction === "high" && finite(single.limit) ? Number(single.limit) : null };
  const nominal = Number(referencePoint.value);
  try {
    const { breakdown } = calculateUncertaintyFromToleranceObject(tolerance, referencePoint);
    const terms = (breakdown || []).filter(term => Number.isFinite(term.absoluteLow) && Number.isFinite(term.absoluteHigh));
    if (!terms.length) return { lower: null, upper: null };
    const lower = nominal + terms.reduce((sum, term) => sum + term.absoluteLow - nominal, 0);
    const upper = nominal + terms.reduce((sum, term) => sum + term.absoluteHigh - nominal, 0);
    const snapped = snapLimitsToResolution(lower, upper, resolveResolutionNative(tolerance, referencePoint.unit));
    return { lower: snapped.low, upper: snapped.high };
  } catch {
    return { lower: null, upper: null };
  }
}

function niceTicks(low, high) {
  const rough = (high - low) / 8;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].find(size => size * power >= rough) * power;
  const ticks = [];
  for (let value = Math.ceil(low / step) * step; value <= high + step * 1e-7 && ticks.length < 12; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}

function quantileCdf(quantiles, value) {
  if (value <= quantiles[0]) return 0;
  if (value >= quantiles.at(-1)) return 1;
  let low = 0, high = quantiles.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (quantiles[middle] <= value) low = middle;
    else high = middle;
  }
  const width = quantiles[high] - quantiles[low];
  return (low + (width > 0 ? (value - quantiles[low]) / width : 0)) / (quantiles.length - 1);
}

/** P(accept | true UUT value y): the integrand's measurement side. */
export function passProbabilityAtTrueValue(y, { lower, upper, calBias, calSigma, errorQuantiles }) {
  const shifted = y + calBias;
  if (Array.isArray(errorQuantiles) && errorQuantiles.length > 1) {
    return (upper === null ? 1 : quantileCdf(errorQuantiles, upper - shifted)) -
      (lower === null ? 0 : quantileCdf(errorQuantiles, lower - shifted));
  }
  if (!(calSigma > 0)) return (lower === null || shifted >= lower) && (upper === null || shifted <= upper) ? 1 : 0;
  return (upper === null ? 1 : normalCDF((upper - shifted) / calSigma)) -
    (lower === null ? 0 : normalCDF((lower - shifted) / calSigma));
}

function densityPaths(mean, sigma, low, high, toX, passInputs) {
  const full = [], accepted = [];
  for (let index = 0; index <= 240; index++) {
    const x = low + (high - low) * index / 240;
    const density = Math.exp(-.5 * ((x - mean) / sigma) ** 2);
    const pass = passInputs ? passProbabilityAtTrueValue(x, passInputs) : 0;
    const px = toX(x).toFixed(2);
    full.push(`${index ? "L" : "M"}${px} ${(BASE - density * (BASE - TOP)).toFixed(2)}`);
    accepted.push(`${index ? "L" : "M"}${px} ${(BASE - density * pass * (BASE - TOP)).toFixed(2)}`);
  }
  return { line: full.join(" "), accepted: `${accepted.join(" ")} L${RIGHT} ${BASE} L${LEFT} ${BASE} Z` };
}

export function buildBiasDistributionModel(point, session, referencePoint, calcResults, riskResults) {
  const nominal = referencePoint?.value === "" || referencePoint?.value == null ? NaN : Number(referencePoint.value);
  if (!Number.isFinite(nominal)) return { unavailable: "Enter a measurement value to see the bias distribution." };
  const unit = referencePoint?.unit || "";
  const limits = displayLimits(point, session, referencePoint, riskResults);
  const acceptance = {
    lower: finite(riskResults?.ALow) ? Number(riskResults.ALow) : limits.lower,
    upper: finite(riskResults?.AUp) ? Number(riskResults.AUp) : limits.upper,
  };
  const calculationPoint = { ...point, testPointInfo: { ...point?.testPointInfo, parameter: referencePoint } };
  const resolved = resolveMeasurementBias(calculationPoint, session,
    finite(calcResults?.calculatedNominalValue) ? Number(calcResults.calculatedNominalValue) : undefined,
    { includeSources: false, limits });
  if (resolved.error) return { unavailable: resolved.error };
  const uutSpec = point?.uutBias?.mode === "override" ? point.uutBias : getUutBiasDefault(point, session);
  const uutBias = activeBias(uutSpec) ? resolved.uutBias : 0;
  const trueMean = finite(riskResults?.trueMean) ? Number(riskResults.trueMean) :
    finite(riskResults?.riskAverage) ? Number(riskResults.riskAverage) : resolved.riskAverage;
  const calBias = finite(riskResults?.calBias) ? Number(riskResults.calBias) : resolved.calBias;
  const riskSigma = Number(riskResults?.uUUT);
  const baseSpread = Number(calcResults?.combined_uncertainty_absolute_base);
  const budgetSigma = Number.isFinite(baseSpread) && baseSpread > 0
    ? (unit ? unitSystem.fromBaseUnit(baseSpread, unit) : baseSpread) : NaN;
  const hasRiskSpread = riskSigma > 0 && Number.isFinite(riskSigma);
  const sigma = hasRiskSpread ? riskSigma : budgetSigma;
  if (!(sigma > 0) || !Number.isFinite(sigma)) return { unavailable: "Complete the uncertainty budget to see the distribution." };
  const riskCalSigma = Number(riskResults?.riskCalSigma);
  const calSigma = riskCalSigma >= 0 && Number.isFinite(riskCalSigma) ? riskCalSigma :
    finite(riskResults?.uCal) ? Number(riskResults.uCal) : budgetSigma;
  const observedSigma = Number(riskResults?.uDev);
  const observedSpread = hasRiskSpread
    ? observedSigma > 0 && Number.isFinite(observedSigma) ? observedSigma : Math.hypot(sigma, Math.max(0, Number(calSigma) || 0))
    : sigma;
  const trueInterval = [trueMean - 2 * sigma, trueMean + 2 * sigma];
  const observedMean = trueMean + calBias;
  const observedInterval = [observedMean - 2 * observedSpread, observedMean + 2 * observedSpread];
  const effective = { lower: acceptance.lower === null ? null : acceptance.lower - calBias,
    upper: acceptance.upper === null ? null : acceptance.upper - calBias };
  const bounds = [nominal, trueMean, observedMean, ...trueInterval, ...observedInterval];
  for (const bound of [limits.lower, limits.upper, effective.lower, effective.upper]) if (bound !== null) bounds.push(bound);
  const min = Math.min(...bounds), max = Math.max(...bounds);
  const pad = Math.max((max - min) * .12, sigma * .6);
  const low = min - pad, high = max + pad;
  const toX = value => LEFT + (value - low) / (high - low) * (RIGHT - LEFT);
  const errorQuantiles = riskResults?.riskMethod === "empirical" && Array.isArray(riskResults.errorQuantiles)
    ? riskResults.errorQuantiles : null;
  const passInputs = hasRiskSpread && (acceptance.lower !== null || acceptance.upper !== null)
    ? { ...acceptance, calBias, calSigma, errorQuantiles } : null;
  return {
    nominal, unit, trueMean, uutBias, calBias, observedMean, sigma, calSigma, observedSpread,
    hasRiskSpread, limits, acceptance, effective, trueInterval, observedInterval,
    low, high, toX, ticks: niceTicks(low, high), passInputs,
    paths: densityPaths(trueMean, sigma, low, high, toX, passInputs),
  };
}

function rangeLabel(lower, upper, unit) {
  return `${lower === null ? "−∞" : format(lower)} to ${upper === null ? "+∞" : format(upper)} ${unit}`;
}

export default function BiasDistributionVisualizer({ point, session, referencePoint, calcResults, riskResults }) {
  const visible = hasActivePointBias(point, session);
  const model = useMemo(() => visible ? buildBiasDistributionModel(point, session, referencePoint, calcResults, riskResults) : null,
    [visible, point, session, referencePoint, calcResults, riskResults]);
  if (!visible) return null;
  return <section className="budget-bias-viz" aria-labelledby="budget-bias-viz-heading">
    <header className="budget-bias-viz-heading">
      <div><span className="budget-bias-viz-eyebrow">BIAS DISTRIBUTION</span><h4 id="budget-bias-viz-heading">One UUT curve, one measurement decision</h4>
        <p>The curve describes possible true UUT values. The shaded area weights each value by its chance of an accepted reading.</p></div>
    </header>
    {model.unavailable ? <p className="budget-bias-viz-empty" role="status">{model.unavailable}</p> : <>
      <div className="budget-bias-viz-facts">
        <div><span>Measurement point</span><strong>{format(model.nominal)} {model.unit}</strong></div>
        <div><span>UUT tolerance</span><strong>{rangeLabel(model.limits.lower, model.limits.upper, model.unit)}</strong></div>
        <div><span>UUT bias</span><strong>{signed(model.uutBias)} {model.unit}</strong></div>
        <div><span>TMDE / system bias</span><strong>{signed(model.calBias)} {model.unit}</strong></div>
      </div>
      <div className="budget-bias-viz-plot" tabIndex={0} aria-label="Scroll horizontally to inspect the measured distribution axis">
        <svg viewBox={`0 0 ${WIDTH} 424`} role="img" aria-label={`True UUT distribution centered at ${format(model.trueMean)} ${model.unit}. Tolerance ${rangeLabel(model.limits.lower, model.limits.upper, model.unit)}. Effective acceptance on the true-value axis ${rangeLabel(model.effective.lower, model.effective.upper, model.unit)}.`}>
          {(model.limits.lower !== null || model.limits.upper !== null) && <rect className="budget-bias-viz-band" x={model.toX(model.limits.lower ?? model.low)} y="38" width={model.toX(model.limits.upper ?? model.high) - model.toX(model.limits.lower ?? model.low)} height={BASE - 38}/>}
          {[[model.limits.lower, "LOWER TOLERANCE", "start"], [model.limits.upper, "UPPER TOLERANCE", "end"]].filter(([value]) => value !== null).map(([value, label, anchor]) => <g key={label}>
            <line className="budget-bias-viz-limit" x1={model.toX(value)} x2={model.toX(value)} y1="38" y2={BASE}/>
            <text className="budget-bias-viz-limit-label" x={model.toX(value)} y="27" textAnchor={anchor}>{label} {format(value)}</text>
          </g>)}
          {model.passInputs && model.calSigma > 0 && [model.effective.lower, model.effective.upper].filter(value => value !== null).map((value, index) => <rect key={index} className="budget-bias-viz-transition" x={model.toX(value - 2 * model.calSigma)} y="70" width={model.toX(value + 2 * model.calSigma) - model.toX(value - 2 * model.calSigma)} height={BASE - 70}/>)}
          {model.passInputs && <path className="budget-bias-viz-accepted-area" data-testid="bias-accepted-area" d={model.paths.accepted}><title>True UUT density weighted by the chance that its reading is accepted</title></path>}
          <path className="budget-bias-viz-density-line" data-testid="bias-density-curve" d={model.paths.line}><title>One true UUT distribution centered at {format(model.trueMean)} {model.unit}</title></path>
          {[[model.effective.lower, "ACCEPT IF TRUE ≥"], [model.effective.upper, "ACCEPT IF TRUE ≤"]].filter(([value]) => value !== null).map(([value, label], index) => <g key={label}>
            <line className="budget-bias-viz-effective-line" x1={model.toX(value)} x2={model.toX(value)} y1="55" y2={BASE}/>
            <title>{label} {format(value)} {model.unit} before measurement uncertainty</title>
          </g>)}
          <line className="budget-bias-viz-axis" x1={LEFT} x2={RIGHT} y1={BASE} y2={BASE}/>
          {model.ticks.map(tick => <g key={tick}><line className="budget-bias-viz-tick" x1={model.toX(tick)} x2={model.toX(tick)} y1={BASE} y2={BASE + 7}/><text className="budget-bias-viz-tick-label" x={model.toX(tick)} y={BASE + 27} textAnchor="middle">{format(tick)}</text></g>)}
          <text className="budget-bias-viz-axis-unit" x={RIGHT} y={BASE + 45} textAnchor="end">True UUT value ({model.unit || "units"})</text>
          <line className="budget-bias-viz-nominal" data-testid="bias-nominal-line" x1={model.toX(model.nominal)} x2={model.toX(model.nominal)} y1="49" y2={BASE}/>
          <line className="budget-bias-viz-mean" data-testid="bias-mean-line" x1={model.toX(model.trueMean)} x2={model.toX(model.trueMean)} y1="49" y2={BASE}/>
          {[[model.nominal, "Point", "budget-bias-viz-point", 302], [model.trueMean, "UUT center", "budget-bias-viz-uut", 326]].map(([value, label, className, y]) => <g key={label} className={className}>
            <circle cx={model.toX(value)} cy={BASE} r="4"/><line x1={model.toX(value)} x2={model.toX(value)} y1={BASE + 5} y2={y - 14}/>
            <text x={model.toX(value) + (label === "Point" ? -10 : 10)} y={y} textAnchor={label === "Point" ? "end" : "start"}>{label}: {format(value)} {model.unit}</text>
          </g>)}
          <g className="budget-bias-viz-true-span"><text x={LEFT} y="351">TRUE UUT · ±2σ</text><line x1={model.toX(model.trueInterval[0])} x2={model.toX(model.trueInterval[1])} y1="362" y2="362"/></g>
          <g className="budget-bias-viz-observed-span"><text x={LEFT} y="386">OBSERVED READINGS · ±2σ</text><line x1={model.toX(model.observedInterval[0])} x2={model.toX(model.observedInterval[1])} y1="398" y2="398"/></g>
        </svg>
      </div>
      <div className="budget-bias-viz-legend" aria-label="Chart key">
        <span><i className="is-uut"/>True UUT density</span>
        {model.passInputs && <span><i className="is-accepted"/>Accepted-reading weight</span>}
        <span><i className="is-tolerance"/>UUT tolerance</span><span><i className="is-effective"/>No-error acceptance threshold</span>
      </div>
      <div className="budget-bias-viz-steps">
        <div><span className="budget-bias-viz-step-number">UUT MODEL</span><h5>Bias sets the center</h5>
          <p>Center {format(model.trueMean)} {model.unit} = {format(model.trueMean - model.uutBias)} {model.unit} + {signed(model.uutBias)} {model.unit}. Current UUT spread σ = {format(model.sigma)} {model.unit}.</p>
          <strong>±2σ span: {format(model.trueInterval[0])} to {format(model.trueInterval[1])} {model.unit}</strong></div>
        <div><span className="budget-bias-viz-step-number">TMDE BIAS</span><h5>Every reading shifts</h5>
          <p>Every possible reading is shifted by {signed(model.calBias)} {model.unit} before random measurement error. On this true-value axis, the no-error threshold moves the opposite way.</p>
          <strong>No-error thresholds: {rangeLabel(model.effective.lower, model.effective.upper, model.unit)}</strong></div>
        <div><span className="budget-bias-viz-step-number">UNCERTAINTY</span><h5>Pass edges become gradual</h5>
          <p>{model.hasRiskSpread ? `Calibration spread σ = ${format(model.calSigma)} ${model.unit}. It changes each true value's chance of passing; observed spread σ = ${format(model.observedSpread)} ${model.unit}.` : `Combined budget u = ${format(model.sigma)} ${model.unit}. The observed spread is available when risk inputs are complete.`}</p>
          <strong>Observed ±2σ span: {format(model.observedInterval[0])} to {format(model.observedInterval[1])} {model.unit}</strong></div>
      </div>
      <p className="budget-bias-viz-note">{model.passInputs
        ? "Green shading is the part of the single UUT density weighted by acceptance probability. Risk also checks whether each true value is inside its UUT tolerance. The ±2σ bars are guides, not hard bounds."
        : "The curve is a normal budget-spread guide. Complete risk inputs to show the acceptance-weighted area and calculated UUT population spread."} The risk engine can re-estimate UUT spread when bias changes because it fits the assumed reliability.</p>
    </>}
  </section>;
}
