import React from "react";
import RiskGauge from "./RiskGauge";

const RiskMitigationDashboard = ({ results, onShowBreakdown, activeModals = [] }) => {
  if (!results) return null;

  const guardBandInputs = results.gbInputs;
  const guardBand = results.gbResults;

  const isActive = (key) => activeModals.includes(key);
  const boundaryOnly = results.riskMethod === "risk8-pfa-boundary";
  const singleSidedKnown = results.riskMethod === "risk8-single-sided-known";

  const nativeUnit = results.nativeUnit || "units";

  // Formatters that gracefully degrade to "N/A" when the math engine could not
  // converge on guard-band limits.
  const fmtPct = (v) => (typeof v === "number" ? `${v.toFixed(4)} %` : "N/A");
  const fmtNum = (v, d = 4) => (typeof v === "number" ? v.toFixed(d) : "N/A");
  const fmtLimit = (v) =>
    typeof v === "number" ? v.toFixed(results.uutResolution + 1) : "N/A";
  const fmt = (v, p = 6) => (typeof v === "number" ? v.toPrecision(p) : "N/A");

  if (boundaryOnly) {
    const isLower = typeof guardBand.GBLOW === "number";
    const acceptanceLimit = isLower ? guardBand.GBLOW : guardBand.GBUP;
    const specLimit = isLower ? guardBandInputs.uutLower : guardBandInputs.uutUpper;

    return (
      <div className="risk-dashboard">
        <section className="risk-inputs-panel">
          <div className="risk-inputs-header">
            <span>Single-Sided Measurement Unknown</span>
          </div>
          <div className="risk-inputs-grid">
            <div className="risk-spec">
              <span className="risk-spec-label">Specification Limit</span>
              <span className="risk-spec-value">{fmt(specLimit)} {nativeUnit}</span>
            </div>
            <div className="risk-spec">
              <span className="risk-spec-label">Expanded Uncertainty</span>
              <span className="risk-spec-value">{fmt(guardBandInputs.expandedUncertainty)} {nativeUnit}</span>
            </div>
            <div className="risk-spec">
              <span className="risk-spec-label">Required PFA</span>
              <span className="risk-spec-value">{fmtPct(guardBand.GBPFA)}</span>
            </div>
            <div className="risk-spec">
              <span className="risk-spec-label">Available Calculation</span>
              <span className="risk-spec-value">PFA-only acceptance boundary</span>
            </div>
          </div>
        </section>

        <RiskGauge
          label={isLower ? "Lower Acceptance Limit" : "Upper Acceptance Limit"}
          value={`${fmt(acceptanceLimit)} ${nativeUnit}`}
          accent="accent-guardband"
          note="Calculated from expanded uncertainty and the requested PFA."
        />
        <RiskGauge
          label="Probability of False Accept at Boundary"
          value={fmtPct(guardBand.GBPFA)}
          accent="accent-guardband"
          note="PFR, TUR, REOP, and calibration-interval recommendations require a measured value and remain N/A."
        />
      </div>
    );
  }

  if (singleSidedKnown) {
    const isLower = typeof guardBand.GBLOW === "number";
    return (
      <div className="risk-dashboard">
        <section className="risk-inputs-panel">
          <button type="button" className={`risk-inputs-header ${isActive("gbinputs") ? "active" : ""}`} onClick={() => onShowBreakdown("gbinputs")}><span>Single-Sided Measurement Known</span><span className="risk-inputs-hint">View breakdown</span></button>
          <div className="risk-inputs-grid">
            <div className="risk-spec"><span className="risk-spec-label">Specification Limit</span><span className="risk-spec-value">{fmt(isLower ? guardBandInputs.uutLower : guardBandInputs.uutUpper)} {nativeUnit}</span></div>
            <div className="risk-spec"><span className="risk-spec-label">TUR</span><span className="risk-spec-value">{fmt(results.tur)}</span></div>
            <div className="risk-spec"><span className="risk-spec-label">Required PFA</span><span className="risk-spec-value">{fmtPct((guardBandInputs.reqPFA || 0) * 100)}</span></div>
            <div className="risk-spec"><span className="risk-spec-label">Measurement Reliability Target</span><span className="risk-spec-value">{fmtPct((guardBandInputs.measRelTarget || 0) * 100)}</span></div>
          </div>
        </section>
        <RiskGauge label={isLower ? "Lower Acceptance Limit" : "Upper Acceptance Limit"} value={`${fmt(isLower ? guardBand.GBLOW : guardBand.GBUP)} ${nativeUnit}`} accent="accent-guardband" active={isActive(isLower ? "gblow" : "gbhigh")} onClick={() => onShowBreakdown(isLower ? "gblow" : "gbhigh")} />
        <RiskGauge label="PFA with Guard Banding" value={fmtPct(guardBand.GBPFA)} accent="accent-guardband" active={isActive("gbpfa")} onClick={() => onShowBreakdown("gbpfa")} />
        <RiskGauge label="PFR with Guard Banding" value={fmtPct(guardBand.GBPFR)} accent="accent-guardband" active={isActive("gbpfr")} onClick={() => onShowBreakdown("gbpfr")} />
        <RiskGauge label="Recommended Calibration Interval" value={typeof guardBand.GBCALINT === "number" ? `${fmtNum(guardBand.GBCALINT, 2)} months` : "N/A"} accent="accent-guardband" active={isActive("gbcalint")} onClick={() => onShowBreakdown("gbcalint")} />
      </div>
    );
  }

  const inputSpecs = [
    { label: "Calibration Interval", value: `${guardBandInputs.calibrationInt} months` },
    { label: "Required PFA", value: `${guardBandInputs.reqPFA * 100}%` },
    { label: "Required TUR", value: guardBandInputs.reqTUR },
    {
      label: "Measurement Reliability Target",
      value: `${guardBandInputs.measRelTarget * 100}%`,
    },
    {
      label: "Measurement Reliability Calculated/Assumed",
      value: `${guardBandInputs.measrelCalcAssumed * 100}%`,
    },
    { label: "TUR Result", value: fmt(guardBandInputs.turVal || 0) },
    {
      label: (
        <>
          Combined Uncertainty (u<sub>cal</sub>)
        </>
      ),
      value: `${fmt(guardBandInputs.combUnc)} ${nativeUnit}`,
    },
    { label: "Nominal", value: `${fmt(guardBandInputs.nominal)} ${nativeUnit}` },
    {
      label: "UUT Lower Tolerance",
      value: `${fmt(guardBandInputs.uutLower)} ${nativeUnit}`,
    },
    {
      label: "UUT Upper Tolerance",
      value: `${fmt(guardBandInputs.uutUpper)} ${nativeUnit}`,
    },
    {
      label: "TMDE Lower Tolerance",
      value: `${fmt(guardBandInputs.tmdeLower)} ${nativeUnit}`,
    },
    {
      label: "TMDE Upper Tolerance",
      value: `${fmt(guardBandInputs.tmdeUpper)} ${nativeUnit}`,
    },
  ];

  return (
    <div className="risk-dashboard">
      <section className="risk-inputs-panel">
        <button
          type="button"
          className={`risk-inputs-header ${isActive("gbinputs") ? "active" : ""}`}
          onClick={() => onShowBreakdown("gbinputs")}
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

      <RiskGauge
        label="GB Limit Low Value"
        value={fmtLimit(guardBand.GBLOW)}
        accent="accent-guardband"
        note="Guardbanded UUT Lower Tolerance Limit."
        active={isActive("gblow")}
        onClick={() => onShowBreakdown("gblow")}
      />

      <RiskGauge
        label="GB Limit High Value"
        value={fmtLimit(guardBand.GBUP)}
        accent="accent-guardband"
        note="Guardbanded UUT Upper Tolerance Limit."
        active={isActive("gbhigh")}
        onClick={() => onShowBreakdown("gbhigh")}
      />

      <RiskGauge
        label="Probability of False Accept (PFA) with Guard Banding"
        value={fmtPct(guardBand.GBPFA)}
        accent="accent-guardband"
        breakdown={[
          { label: "Lower Tail Risk", value: fmtPct(guardBand.GBPFAT1) },
          { label: "Upper Tail Risk", value: fmtPct(guardBand.GBPFAT2) },
        ]}
        active={isActive("gbpfa")}
        onClick={() => onShowBreakdown("gbpfa")}
      />

      <RiskGauge
        label="Probability of False Reject (PFR) with Guard Banding"
        value={fmtPct(guardBand.GBPFR)}
        accent="accent-guardband"
        breakdown={[
          { label: "Lower Side Risk", value: fmtPct(guardBand.GBPFRT1) },
          { label: "Upper Side Risk", value: fmtPct(guardBand.GBPFRT2) },
        ]}
        active={isActive("gbpfr")}
        onClick={() => onShowBreakdown("gbpfr")}
      />

      <RiskGauge
        label="Guard Band Multiplier"
        value={fmtPct(guardBand.GBMULT)}
        accent="accent-guardband"
        note="Ratio between the guardband tolerance limits and UUT tolerance limits."
        active={isActive("gbmult")}
        onClick={() => onShowBreakdown("gbmult")}
      />

      <RiskGauge
        label="Calibration Interval with Guard Banding"
        value={fmtNum(guardBand.GBCALINT)}
        accent="accent-guardband"
        note="Recommended Calibration Interval with Guard Band Tolerance Limits."
        active={isActive("gbcalint")}
        onClick={() => onShowBreakdown("gbcalint")}
      />

      <RiskGauge
        label="Calibration without Guard Banding"
        value={fmtNum(guardBand.NOGBCALINT)}
        accent="accent-guardband"
        note="Recommended Calibration Interval without Guard Band Tolerance Limits."
        active={isActive("calint")}
        onClick={() => onShowBreakdown("calint")}
      />

      <RiskGauge
        label="Measurement Reliability Needed without Guard Banding"
        value={fmtPct(guardBand.NOGBMEASREL)}
        accent="accent-guardband"
        note="Required Measurement Reliability without Guard Banding."
        active={isActive("measrel")}
        onClick={() => onShowBreakdown("measrel")}
      />
    </div>
  );
};

export default RiskMitigationDashboard;
