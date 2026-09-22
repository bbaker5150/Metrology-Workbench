import { explainRiskConstraint } from "../../../utils/mitigationDiagnostics";
import React from "react";
import RiskDistributionVisualizer from "./RiskDistributionVisualizer";
import RiskGauge from "./RiskGauge";

const RiskAnalysisDashboard = ({
  results,
  calcResults,
  onShowBreakdown,
  activeModals = [],
}) => {
  if (!results) return null;

  const isActive = (key) => activeModals.includes(key);
  const boundaryOnly = results.riskMethod === "risk8-pfa-boundary";
  const singleSidedKnown = results.riskMethod === "risk8-single-sided-known";

  const nativeUnit = results.nativeUnit || "units";
  const fmt = (v, p = 6) =>
    typeof v === "number" ? v.toPrecision(p) : "N/A";

  const inputSpecs = boundaryOnly
    ? [
        {
          label: "Measurement Status",
          value: "Unknown — PFA-only acceptance boundary",
        },
        {
          label: "Expanded Uncertainty",
          value: `${fmt(results.expandedUncertainty)} ${nativeUnit}`,
        },
        {
          label: "Lower Specification",
          value: `${fmt(results.LLow)} ${nativeUnit}`,
        },
        {
          label: "Upper Specification",
          value: `${fmt(results.LUp)} ${nativeUnit}`,
        },
      ]
    : singleSidedKnown
      ? [
          { label: "Measurement", value: `${fmt(results.riskAverage)} ${nativeUnit}` },
          { label: "Expanded Uncertainty", value: `${fmt(results.expandedUncertainty)} ${nativeUnit}` },
          { label: "Lower Specification", value: `${fmt(results.LLow)} ${nativeUnit}` },
          { label: "Upper Specification", value: `${fmt(results.LUp)} ${nativeUnit}` },
        ]
      : [
    {
      label: (
        <>
          True Error (σ<sub>uut</sub>)
        </>
      ),
      value: `${fmt(results.uUUT)} ${nativeUnit}`,
    },
    {
      label: (
        <>
          Combined Uncertainty (u<sub>cal</sub>)
        </>
      ),
      value: `${fmt(results.uCal)} ${nativeUnit}`,
    },
    {
      label: (
        <>
          Observed Error (σ<sub>obs</sub>)
        </>
      ),
      value: `${fmt(results.uDev)} ${nativeUnit}`,
    },
    { label: "UUT Lower Tolerance", value: `${fmt(results.LLow)} ${nativeUnit}` },
    { label: "UUT Upper Tolerance", value: `${fmt(results.LUp)} ${nativeUnit}` },
    { label: "Lower Acceptance", value: `${fmt(results.ALow)} ${nativeUnit}` },
    { label: "Upper Acceptance", value: `${fmt(results.AUp)} ${nativeUnit}` },
    { label: "Correlation (ρ)", value: fmt(results.correlation) },
      ];

  return (
    <div className="risk-dashboard">
      {results.riskAvailability === "unavailable" && <p className="risk-inputs-panel">{explainRiskConstraint(results.risk8?.out?.statusCore, singleSidedKnown)}</p>}
      <section className="risk-inputs-panel">
        <button
          type="button"
          className={`risk-inputs-header ${isActive("inputs") ? "active" : ""}`}
          onClick={() => onShowBreakdown("inputs")}
        >
          <span>Key Calculation Inputs</span>
          <span className="risk-inputs-hint">View breakdown</span>
        </button>
        <div className="risk-inputs-grid">
          {inputSpecs.map((spec, i) => (
            <div className="risk-spec" key={i}>
              <span className="risk-spec-label">{spec.label}</span>
              <span className="risk-spec-value">{spec.value}</span>
            </div>
          ))}
        </div>
      </section>

      {boundaryOnly ? (
        <>
          <RiskGauge
            label="Probability of False Accept"
            active={isActive("pfa")} onClick={() => onShowBreakdown("pfa")}
            value="NA"
            accent="accent-primary"
            note="Unavailable without a measured value."
          />
          <RiskGauge
            label={typeof results.ALow === "number" ? "Lower Acceptance Limit" : "Upper Acceptance Limit"}
            active={isActive(typeof results.ALow === "number" ? "gblow" : "gbhigh")}
            onClick={() => onShowBreakdown(typeof results.ALow === "number" ? "gblow" : "gbhigh")}
            value={`${fmt(
              typeof results.ALow === "number" ? results.ALow : results.AUp
            )} ${nativeUnit}`}
            accent="accent-guardband"
            note="TUR, REOP, PFR, and interval metrics are unavailable without a measured value."
          />
        </>
      ) : singleSidedKnown ? (
        <>
          <RiskGauge label="Probability of False Accept" value={`${fmt(results.pfa, 4)} %`} accent="accent-primary" active={isActive("pfa")} onClick={() => onShowBreakdown("pfa")} />
          <RiskGauge label="Probability of False Reject" value={`${fmt(results.pfr, 4)} %`} accent="accent-secondary" active={isActive("pfr")} onClick={() => onShowBreakdown("pfr")} />
          <RiskGauge label="Test Uncertainty Ratio" value={fmt(results.tur, 5)} accent="accent-primary" active={isActive("tur")} onClick={() => onShowBreakdown("tur")} />
          <RiskGauge label="Observed Reliability" value={`${fmt(results.observedReop, 4)} %`} accent="accent-secondary" />
        </>
      ) : results.riskAvailability === "unavailable" ? null : (
        <RiskDistributionVisualizer
          results={results}
          calcResults={calcResults}
          onShowBreakdown={onShowBreakdown}
          activeModals={activeModals}
        />
      )}
    </div>
  );
};

export default RiskAnalysisDashboard;
