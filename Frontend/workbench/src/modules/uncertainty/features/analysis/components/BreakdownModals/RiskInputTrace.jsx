import React from "react";
import { getUnitDisplayLabel, unitSystem } from "../../../../utils/uncertaintyMath";
import { resolveMeasurementBias } from "../../../../utils/measurementBias";
const value = number => number !== null && number !== undefined && Number.isFinite(Number(number)) ? Number(number).toPrecision(7) : "Not available";
const standard = (component, unit) => component.value_native ?? (component.isBaseUnitValue
  ? component.value / (unitSystem.units[component.unit_native || component.unit || unit]?.to_si || 1) : component.value);
const errorLimit = (component, group) => {
  if (component.dynamicDefinition) {
    const definition = component.dynamicDefinition;
    const equation = definition.mode === "limits" ? `${definition.lowerEquation} to ${definition.upperEquation}` : definition.equation;
    return `${definition.kind === "equation" ? `f = ${equation}; ` : ""}${component.dynamicSummary || "Not resolved"}`;
  }
  if (component.isPropagationSummary) return "Combined equation inputs";
  const divisor = Number(component.distributionDivisor || component.originalInput?.errorDistributionDivisor);
  const limit = component.toleranceLimit_native ?? (divisor > 0 ? Number(standard(component, group.unit)) * divisor : null);
  return limit != null ? `± ${value(limit)} ${getUnitDisplayLabel(component.unit_native || group.unit || "")}` : "See source specification";
};
const meanings = {
  inputs: "These are the values used to calculate the risk of the measurement decision.",
  tur: "TUR compares the UUT tolerance to expanded measurement uncertainty. A higher ratio means uncertainty occupies less of the allowed tolerance.",
  tar: "TAR compares UUT error limits with the selected measuring instruments’ error limits. Manual uncertainty components belong in TUR, not in this specification ratio.",
  pfa: "PFA is the probability of accepting an item whose true value is outside specification.",
  pfr: "PFR is the probability of rejecting an item whose true value is inside specification.",
  observedreop: "Observed reliability is the proportion expected to pass when measurement uncertainty and bias are present.",
  truereop: "True reliability is the proportion whose true values are within specification, before the measurement decision.",
  maxreop: "Maximum reliability is the model’s achievable limit with the current uncertainty and bias.",
  gbinputs: "Guardbanding moves the acceptance limits inward to reduce the chance of false acceptance.",
  gblow: "This is the lower acceptance limit after applying the guardband and resolution rounding.",
  gbhigh: "This is the upper acceptance limit after applying the guardband and resolution rounding.",
  gbpfa: "This is false-accept probability using the recommended guardbanded acceptance limits.",
  gbpfr: "This is false-reject probability using the recommended guardbanded acceptance limits.",
  gbmult: "The multiplier determines how much of the original tolerance remains available for acceptance.",
  gbcalint: "The proposed calibration interval uses the reliability needed with guardbanding and the selected aging model.",
  gbmeasrel: "This is the reliability needed to meet the risk target with guardbanding.",
  nogbpfa: "This is false-accept probability with the recommended reliability and the original acceptance limits.",
  nogbpfr: "This is false-reject probability with the recommended reliability and the original acceptance limits.",
  calint: "The proposed calibration interval uses the reliability needed without guardbanding and the selected aging model.",
  measrel: "This is the reliability needed to meet the risk target without guardbanding.",
};
export default function RiskInputTrace({ modalType, results, trace }) {
  if (!trace?.point) return <p>{meanings[modalType]}</p>;
  const { point, session, calculation = {} } = trace;
  const unit = getUnitDisplayLabel(results.nativeUnit || point.testPointInfo?.parameter?.unit || "");
  const unknown = results.riskMethod === "risk8-pfa-boundary";
  const bias = resolveMeasurementBias(point, session, results.measurementAverage, { limits: { lower: results.LLow, upper: results.LUp } });
  const groups = calculation.calculatedBudgetGroups || point.calculatedBudgetGroups || [];
  const rows = groups.length ? groups : [{ id: "budget", label: "Measurement uncertainty budget", components: calculation.calculatedBudgetComponents || point.calculatedBudgetComponents || [], results: {} }];
  return <div className="risk-input-trace">
    <p>{meanings[modalType]}</p>
    <section className="breakdown-step"><h5>1. Start with the specification and measurement</h5>
      <p>{unknown ? "No measured value is known. The model calculates an acceptance boundary from uncertainty and the requested false-accept risk; it cannot calculate population false-reject risk or reliability." : "The lower and upper specification limits define conforming true values. Acceptance limits define which observed readings pass. A missing side means the specification is open in that direction."}</p>
      <dl><dt>Nominal measurement</dt><dd>{value(results.nominalValue)} {unit}</dd><dt>Lower / upper specification limits</dt><dd>{value(results.LLow)} / {value(results.LUp)} {unit}</dd></dl>
    </section>
    <section className="breakdown-step"><h5>2. Build the measurement uncertainty</h5>
      <p>Each row below contributes standard uncertainty (one standard deviation). Error limits are converted using the row’s distribution divisor. Independent contributions combine as the square root of the sum of their squares. Correlations add signed cross terms; equation inputs use their sensitivity coefficients before combining.</p>
      {rows.map(group => <div key={group.id}><h6>{group.label || "Budget"}</h6>
        {group.components?.length ? <div style={{ overflowX: "auto" }}><table className="risk-source-trace"><thead><tr><th>Source</th><th>Method</th><th>Error limit / rule</th><th>Distribution / divisor</th><th>Standard uncertainty</th></tr></thead><tbody>{group.components.map((component, index) => <tr key={`${component.id}-${index}`}>
          <td>{component.name || "Unnamed component"}</td><td>{component.dynamicDefinition?.kind === "table" ? "Tabular" : component.dynamicDefinition ? "Equation" : component.isResolution ? "Resolution" : component.isManual || component.isInlineManual ? "Manual" : component.type === "A" ? "Repeated readings" : "Instrument / propagated input"}</td>
          <td>{errorLimit(component, group)}</td>
          <td>{component.distribution || "Not set"}{component.distributionDivisor ? ` / ${component.distributionDivisor}` : ""}</td>
          <td>{component.pendingReason || component.inlineValidation || `${value(standard(component, group.unit))} ${getUnitDisplayLabel(component.unit_native || group.unit || "")}`}</td>
        </tr>)}</tbody></table></div> : group.rows?.length ? <>
          <p>Measurement equation: {point.equationString}. For each input, multiply its standard uncertainty by its signed sensitivity coefficient.</p>
          {group.rows.map(row => <p key={row.id}>{row.variable}: u = {value(row.standardUncertainty)} {getUnitDisplayLabel(row.unit || "")}; sensitivity c = {value(row.sensitivityCoefficient)}; |c × u| = {value(row.contribution)} {getUnitDisplayLabel(group.unit || "")}.</p>)}
          {Object.entries(point.inputCorrelations || {}).map(([pair, coefficient]) => <p key={pair}>Correlation between {pair.split("|").join(" and ")}: {value(coefficient)}. Add 2 × correlation × signed contribution 1 × signed contribution 2 to the summed variance.</p>)}
        </> : <p>No source rows are available for this budget.</p>}
        {group.results && <p>Combined u = {value(group.results.combined)} {getUnitDisplayLabel(group.unit || "")}; coverage factor k = {value(group.results.k_value)}; expanded U = k × u = {value(group.results.expanded)} {getUnitDisplayLabel(group.unit || "")}.</p>}
      </div>)}
      <p>Risk calculation uses combined u = {value(results.uCal)} {unit} and expanded U = {value(results.expandedUncertainty)} {unit}. {point.budgetPropagationMethod === "montecarlo" ? "Monte Carlo propagation uses the simulated output distribution." : "The calculation steps below use these final uncertainty values."}</p>
    </section>
    <section className="breakdown-step"><h5>3. Apply signed bias</h5>
      <p>Bias shifts the mean; it is not added to uncertainty in quadrature. Correcting a bias removes its mean shift while retaining the uncertainty of the correction.</p>
      {unknown ? <p>For an unknown measurement, this tolerance model ignores UUT and calibration biases. Saved bias settings are retained for known measurements.</p> : <>
        <p>UUT bias = {value(bias.uutBias)} {unit} ({bias.uutOrigin}); UUT mean = nominal + UUT bias = {value(bias.riskAverage)} {unit}.</p>
        <p>{point.measurementBias?.mode === "manual" ? "The entered net system bias replaces individual source biases." : "Net system bias is the signed sum of the source contributions below. Absolute source biases are multiplied by quantity and equation sensitivity. Percentage biases use the final UUT tolerance frame."}</p>
        {bias.sources.map(source => <p key={source.key || source.id}>{source.label || source.name || "Source"}: {source.spec?.value ?? "Not set"} {source.spec?.kind === "percent" ? "% of tolerance frame" : getUnitDisplayLabel(source.spec?.unit || source.inputUnit || "")} — {source.spec?.corrected ? "corrected; contribution is zero" : `quantity ${source.quantity || 1}, sensitivity ${value(source.sensitivity)}, signed contribution ${value(source.contribution)} ${unit}`}.</p>)}
        <p>Net calibration bias = {value(bias.calBias)} {unit}; observed mean = UUT mean + calibration bias = {value(bias.riskAverage + bias.calBias)} {unit}.</p>
        {bias.error && <p role="alert">{bias.error}</p>}
      </>}
    </section>
    <h5>4. Follow the calculation for this metric</h5>
    <p>The substituted equations below show the normalization, probability calculation, and any guardband or interval adjustment. Probability 0.01 means 1%; N/A means the model cannot supply that quantity with the available inputs.</p>
  </div>;
}
