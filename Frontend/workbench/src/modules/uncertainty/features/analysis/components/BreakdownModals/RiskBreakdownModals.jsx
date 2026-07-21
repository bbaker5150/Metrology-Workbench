import React from "react";
import ReactDOM from "react-dom";
import * as Breakdowns from "./RiskBreakdownContent";
import Risk8BreakdownContent, { risk8ModalTitle } from "./Risk8BreakdownContent";
import useFloatingWindow from "../../../../hooks/useFloatingWindow";

const RiskBreakdownModal = ({ isOpen, onClose, modalType, data }) => {
  const { style: windowStyle, handleMouseDown } = useFloatingWindow({
    isOpen,
    defaultWidth: Math.min(860, window.innerWidth - 48),
    defaultHeight: Math.min(720, window.innerHeight - 120)
  });

  if (!isOpen || !data) return null;
  const { results, inputs } = data;

  const MODAL_CONFIG = {
    inputs:    { title: "Key Inputs Breakdown", Component: Breakdowns.InputsBreakdown },
    tur:       { title: "TUR Calculation Breakdown", Component: Breakdowns.TurBreakdown },
    tar:       { title: "TAR Calculation Breakdown", Component: Breakdowns.TarBreakdown },
    pfa:       { title: "PFA Calculation Breakdown", Component: Breakdowns.PfaBreakdown },
    pfr:       { title: "PFR Calculation Breakdown", Component: Breakdowns.PfrBreakdown },
    observedreop: { title: "Observed REOP Breakdown", Component: Breakdowns.ObservedReopBreakdown },
    maxreop:   { title: "Maximum REOP Breakdown", Component: Breakdowns.MaxReopBreakdown },
    truereop:  { title: "True REOP Breakdown", Component: Breakdowns.TrueReopBreakdown },
    gbinputs:  { title: "GB Inputs Breakdown", Component: Breakdowns.GBInputsBreakdown },
    gblow:     { title: "GB Low Breakdown", Component: Breakdowns.GBLowBreakdown },
    gbhigh:    { title: "GB High Breakdown", Component: Breakdowns.GBHighBreakdown },
    gbpfa:     { title: "GB PFA Breakdown", Component: Breakdowns.GBPFABreakdown },
    gbpfr:     { title: "GB PFR Breakdown", Component: Breakdowns.GBPFRBreakdown },
    gbmult:    { title: "GB Multiplier Breakdown", Component: Breakdowns.GBMultBreakdown },
    gbcalint:  { title: "GB Cal Interval Breakdown", Component: Breakdowns.GBCalIntBreakdown },
    gbmeasrel: { title: "GB Targeted REOP Breakdown", Component: Breakdowns.GBMeasRelBreakdown },
    nogbpfa:   { title: "No-GB PFA Breakdown", Component: Breakdowns.NoGBPFABreakdown },
    nogbpfr:   { title: "No-GB PFR Breakdown", Component: Breakdowns.NoGBPFRBreakdown },
    calint:    { title: "No GB Cal Interval Breakdown", Component: Breakdowns.NoGBCalIntBreakdown },
    measrel:   { title: "No GB Meas Rel Breakdown", Component: Breakdowns.NoGBMeasRelBreakdown },
  };

  const config = MODAL_CONFIG[modalType];
  if (!config) return null;

  const { title, Component } = config;
  const isKnownMeasurementRisk8 =
    results?.riskMethod === "risk8-single-sided-known" ||
    results?.riskMethod === "risk8-two-sided-symmetric" ||
    results?.riskMethod === "risk8-two-sided-asymmetric";
  const resolvedTitle = risk8ModalTitle(modalType, results) || title;

  return ReactDOM.createPortal(
    <div 
        className="modal-content breakdown-modal-content"
        style={{ 
            ...windowStyle, 
            zIndex: 2000,
        }}
    >
        <button onClick={onClose} className="modal-close-button">&times;</button>
        <h3
            className="breakdown-modal-title"
            onMouseDown={handleMouseDown} 
        >
            {resolvedTitle}
        </h3>
        
        <div className="modal-body-scrollable">
            {isKnownMeasurementRisk8 ? (
              <Risk8BreakdownContent modalType={modalType} results={results} inputs={inputs} />
            ) : (
              <Component results={results} inputs={inputs} />
            )}
        </div>
    </div>,
    document.body
  );
};

export default RiskBreakdownModal;
