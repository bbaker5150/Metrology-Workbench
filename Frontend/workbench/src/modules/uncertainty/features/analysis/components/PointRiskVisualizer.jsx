import React, { useId, useMemo, useState } from "react";
import { buildRiskDistributionModel, acceptanceAtTrueError, normalCurve } from "../../../utils/riskDistributionModel";
import { getUnitDisplayLabel } from "../../../utils/uncertaintyMath";
import "./PointRiskVisualizer.css";

const number = value => Number.isFinite(value) ? Number(value.toPrecision(4)).toString() : "—";
const percent = value => `${(value * 100).toFixed(2)}%`;

function DistributionPlot({ model, mean, sigma, kind, label, bounds, probe, companion }) {
  const id = useId().replace(/:/g, "");
  const [min, max] = model.domain;
  const width = 360, left = 32, right = 338, top = 18, bottom = 142;
  const x = value => left + (value - min) / (max - min) * (right - left);
  const clampX = value => Math.max(left, Math.min(right, x(value)));
  const curve = normalCurve(mean, sigma, model.domain);
  const path = (points, peak) => points.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(2)},${(bottom - p.y / peak * (bottom - top)).toFixed(2)}`).join(" ");
  const peak = sigma > 0 ? 1 / (sigma * Math.sqrt(2 * Math.PI)) : 1;
  const line = path(curve, peak);
  const area = curve.length ? `${line} L${x(curve.at(-1).x)},${bottom} L${x(curve[0].x)},${bottom} Z` : "";
  const band = bounds || [model.lower, model.upper];
  const low = clampX(band[0]), high = clampX(band[1]);
  const companionCurve = companion && normalCurve(companion.mean, companion.sigma, model.domain);
  return <svg viewBox={`0 0 ${width} 188`} role="img" aria-label={label} className={`risk-distribution-plot is-${kind}`}>
    <defs><clipPath id={`${id}-inside`}><rect x={low} y={top - 4} width={Math.max(0, high - low)} height={bottom - top + 6} /></clipPath></defs>
    <rect className="risk-distribution-band" x={low} y={top} width={Math.max(0, high - low)} height={bottom - top} />
    {companionCurve?.length > 0 && <path className="risk-distribution-companion" d={path(companionCurve, 1 / (companion.sigma * Math.sqrt(2 * Math.PI)))} />}
    {curve.length ? <>
      <path d={area} className="risk-distribution-area" />
      {bounds && <path d={area} clipPath={`url(#${id}-inside)`} className="risk-distribution-accepted" />}
      <path d={line} className="risk-distribution-line" />
    </> : <><line className="risk-distribution-line" x1={x(mean)} x2={x(mean)} y1={top} y2={bottom} /><text x={x(mean)} y={12} textAnchor="middle">No modeled spread</text></>}
    <line className="risk-distribution-axis" x1={left} x2={right} y1={bottom} y2={bottom} />
    {[model.lower, model.upper].filter(Number.isFinite).map((limit, i) => <line key={i} className="risk-distribution-limit" x1={x(limit)} x2={x(limit)} y1={top} y2={bottom} />)}
    {model.hasGuardBand && (kind === "observed" || kind === "probe") && bounds && [model.acceptLow, model.acceptHigh].filter(Number.isFinite).map((limit, i) => <line key={i} className="risk-distribution-accept-limit" x1={x(limit)} x2={x(limit)} y1={top} y2={bottom} />)}
    {probe != null && <line className="risk-distribution-probe" x1={x(probe)} x2={x(probe)} y1={top} y2={bottom} />}
    {Array.from({ length: 5 }, (_, i) => min + (max - min) * i / 4).map((tick, i) => <g key={i}>
      <line className="risk-distribution-axis" x1={x(tick)} x2={x(tick)} y1={bottom} y2={bottom + 4} />
      <text x={x(tick)} y={bottom + 17} textAnchor="middle">{number(tick)}</text>
    </g>)}
    <text x={width / 2} y={184} textAnchor="middle">Error relative to nominal{model.unit ? ` (${getUnitDisplayLabel(model.unit)})` : ""}</text>
  </svg>;
}

export default function PointRiskVisualizer({ riskResults, nominal }) {
  const [exploring, setExploring] = useState(false);
  const [reop, setReop] = useState(null);
  const [uncertaintyFactor, setUncertaintyFactor] = useState(1);
  const [probeFraction, setProbeFraction] = useState(0.65);
  const baseline = useMemo(() => buildRiskDistributionModel(riskResults), [riskResults]);
  const model = useMemo(() => buildRiskDistributionModel(riskResults, exploring
    ? { reop: reop ?? baseline.reop, uncertaintyFactor } : null), [riskResults, exploring, reop, uncertaintyFactor, baseline.reop]);
  const reset = () => { setReop(null); setUncertaintyFactor(1); setProbeFraction(0.65); };
  const quantity = value => `${number(value)}${model.unit ? ` ${getUnitDisplayLabel(model.unit)}` : ""}`;
  const limits = (low, high) => low === -Infinity ? `at or below ${quantity(high)}` : high === Infinity ? `at or above ${quantity(low)}` : `${quantity(low)} to ${quantity(high)}`;
  const trueError = model.available ? model.domain[0] + probeFraction * (model.domain[1] - model.domain[0]) : 0;
  const probe = acceptanceAtTrueError(model, trueError);
  const referenceDiffers = model.available && Math.abs(model.referenceTur - model.tur) > 1e-9;
  const outcome = probe?.inTolerance ? "false rejection" : "false acceptance";
  return <section className="risk-distribution-visualizer" aria-label="Risk distributions">
    <header className="risk-distribution-heading">
      <div><h4>True error + calibration error = observed error</h4>
        <p>The population model at {nominal?.value ?? "this point"}{nominal?.unit ? ` ${getUnitDisplayLabel(nominal.unit)}` : ""}. Bias moves a curve’s center; uncertainty changes its spread.</p></div>
      {baseline.available && <button type="button" className="risk-distribution-explore" aria-pressed={exploring}
        onClick={() => { reset(); setExploring(value => !value); }}>{exploring ? "Return to current point" : "Explore REOP & uncertainty"}</button>}
    </header>
    {exploring && <div className="risk-distribution-controls">
      <div className="risk-distribution-scenario-label"><strong>What-if exploration</strong><span>Changes here are not saved to the point.</span><button type="button" onClick={reset}>Reset</button></div>
      <label>Assumed REOP <output>{percent(reop ?? baseline.reop)}</output>
        <input aria-label="Explore assumed REOP" type="range" min="0.01" max="0.9999" step="0.0001" value={reop ?? baseline.reop} onChange={event => setReop(Number(event.target.value))} /></label>
      <label>Calibration uncertainty <output>{number(uncertaintyFactor)}× current</output>
        <input aria-label="Explore calibration uncertainty" type="range" min="0.25" max="3" step="0.05" value={uncertaintyFactor} onChange={event => setUncertaintyFactor(Number(event.target.value))} /></label>
    </div>}
    {!model.available ? <p className="risk-distribution-empty" role="status">{model.reason}</p> : <>
      <div className="risk-distribution-cards">
        <article className="risk-distribution-card is-true"><h5><span>1</span> True UUT error</h5><p>Inferred population spread, after separating calibration error.</p>
          <DistributionPlot model={model} mean={model.trueMean} sigma={model.trueSigma} kind="true" label="True UUT error distribution" bounds={[model.lower, model.upper]} />
          <dl><div><dt>Mean offset</dt><dd>{quantity(model.trueMean)}</dd></div><div><dt>σ true</dt><dd>{quantity(model.trueSigma)}</dd></div></dl>
          <strong>{percent(model.state.pTrue)} truly in tolerance</strong>
        </article>
        <article className="risk-distribution-card is-cal"><h5><span>2</span> Calibration error</h5><p>Spread from the budget uncertainty and TUR; centered on residual calibration bias.</p>
          <DistributionPlot model={model} mean={model.calMean} sigma={model.calSigma} kind="cal" label="Calibration process error distribution" />
          <dl><div><dt>Residual bias</dt><dd>{quantity(model.calMean)}</dd></div><div><dt>σ cal · risk model</dt><dd>{quantity(model.calSigma)}</dd></div></dl>
          <strong>TUR {number(model.tur)} : 1</strong>
        </article>
        <article className="risk-distribution-card is-observed"><h5><span>3</span> Observed error</h5><p>The errors we would see when this population is calibrated.</p>
          <DistributionPlot model={model} mean={model.observedMean} sigma={model.observedSigma} kind="observed" label="Observed error distribution" bounds={[model.acceptLow, model.acceptHigh]} />
          <dl><div><dt>Mean offset</dt><dd>{quantity(model.observedMean)}</dd></div><div><dt>σ observed</dt><dd>{quantity(model.observedSigma)}</dd></div></dl>
          <strong>{percent(model.state.pObs)} observed accepted</strong>
        </article>
      </div>
      <div className="risk-distribution-explanation">
        <p><strong>REOP sets the starting spread.</strong> Assumed reliability at the end of the calibration period (REOP) is {percent(model.reop)} at reference TUR {number(model.referenceTur)} : 1.
          {referenceDiffers ? " The current TUR differs from that reference, so the current observed acceptance rate can differ from assumed REOP." : " With these limits and bias, it determines the observed distribution’s width."}
          {model.hasGuardBand && " Acceptance limits include the point’s initial guard band; specification limits still define true conformance."}</p>
        {exploring && !model.fixedReference && <p>Reference TUR follows current TUR for this point. With REOP held fixed, changing calibration uncertainty keeps the observed spread fixed and changes the inferred true spread.</p>}
        <p><strong>σ² observed = σ² true + σ² cal.</strong> The reference spread gives σ true = √(σ² observed, reference − σ² cal, reference).
          {referenceDiffers && ` Reference σ observed: ${quantity(model.referenceObservedSigma)}; reference σ cal: ${quantity(model.referenceCalSigma)}.`}
          {" "}The current calibration spread is then combined with σ true.</p>
        <p className="risk-distribution-key">Tolerance error limits: {limits(model.lower, model.upper)}. {model.hasGuardBand ? `Acceptance error limits: ${limits(model.acceptLow, model.acceptHigh)}.` : "Acceptance uses the same limits."} σ means standard deviation.</p>
        <p className="risk-distribution-key">Shared error axis · Curve heights scaled separately for readability · Dashed lines: tolerance limits{model.hasGuardBand ? " · Dotted lines: acceptance limits" : ""} · Shading: area inside the relevant limits</p>
      </div>
      <div className="risk-distribution-probe-section">
        <div className="risk-distribution-probe-copy"><h5>Why a wrong decision can happen</h5><p>Choose a hypothetical true error. The calibration-error curve moves with it, showing the readings that could be observed.</p>
          <label>Hypothetical true error <output>{quantity(trueError)}</output>
            <input aria-label="Hypothetical true error" type="range" min="0" max="1" step="0.001" value={probeFraction} onChange={event => setProbeFraction(Number(event.target.value))} /></label>
          <p className={`risk-distribution-probe-result ${probe.inTolerance ? "is-inside" : "is-outside"}`}><strong>{probe.inTolerance ? "Truly in tolerance" : "Truly out of tolerance"}</strong>
            <span>{percent(probe.inTolerance ? probe.rejected : probe.accepted)} chance of {outcome} at this true error.</span></p>
          <p className="risk-distribution-key">This is a conditional chance at the selected error. Overall PFA/PFR also account for how often each true error occurs.</p>
        </div>
        <div><DistributionPlot model={model} mean={probe.mean} sigma={model.calSigma} kind="probe" label="Possible observed readings at the selected true error" bounds={[model.acceptLow, model.acceptHigh]} probe={trueError} companion={{ mean: model.trueMean, sigma: model.trueSigma }} />
          <div className="risk-distribution-probe-legend"><span>Blue outline: true population</span><span>Green area: accepted readings</span><span>Orange area: rejected readings</span></div>
        </div>
      </div>
      <div className="risk-distribution-outcomes">
        <div><h5>{exploring ? "Exploration" : "Current point"} · population outcomes</h5><p>PFA adds the out-of-tolerance population weighted by its chance of acceptance. PFR adds the in-tolerance population weighted by its chance of rejection.</p>
          <p>True reliability = PCA + PFR<br />Observed acceptance = PCA + PFA</p></div>
        <table aria-label="Population risk outcomes"><thead><tr><th scope="col">True condition</th><th scope="col">Accepted</th><th scope="col">Rejected</th></tr></thead><tbody>
          <tr><th scope="row">In tolerance</th><td><span>Correct accept · PCA</span><strong>{percent(model.state.pPCA)}</strong></td><td className="is-false-reject"><span>False reject · PFR</span><strong>{percent(model.state.pPFR)}</strong></td></tr>
          <tr><th scope="row">Out of tolerance</th><td className="is-false-accept"><span>False accept · PFA</span><strong>{percent(model.state.pPFA)}</strong></td><td><span>Correct reject · PCR</span><strong>{percent(model.state.pPCR)}</strong></td></tr>
        </tbody></table>
      </div>
      <footer>Normal, independent error model used by this point’s risk calculation. These are population probabilities at this measurement setting, not the probability that one specific unit is wrong. Corrected biases contribute only their remaining residual.</footer>
    </>}
  </section>;
}
