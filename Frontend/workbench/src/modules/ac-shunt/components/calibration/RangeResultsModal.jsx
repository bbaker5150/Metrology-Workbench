import React from "react";
import { FaTimes } from "react-icons/fa";
import {
  TYPE_A_COVERAGE_FACTOR,
  expandedTypeAUncertainty,
} from "../../utils/uncertaintyPresentation";

const RangeSummaryTable = ({ title, results, prefix }) => {
  const READING_TYPES = [
    { label: "AC Open", key: "ac_open" },
    { label: "DC+", key: "dc_pos" },
    { label: "DC-", key: "dc_neg" },
    { label: "AC Close", key: "ac_close" },
  ];

  return (
    <div className="accordion-card" style={{ marginBottom: "15px" }}>
      <div className="accordion-header" style={{ cursor: "default" }}>
        <h4>{title}</h4>
      </div>
      <div className="accordion-content">
        <div className="table-container">
          <table className="cal-results-table">
            <thead>
              <tr>
                <th>Measurement</th>
                <th>Average (V)</th>
                <th title="Standard deviation of raw voltage samples within this phase. Diagnostic only — not the same as the headline Type A u_A.">Within-phase σ (V)</th>
              </tr>
            </thead>
            <tbody>
              {READING_TYPES.map((rt) => {
                const avgKey = `${prefix}${rt.key}_avg`;
                const stddevKey = `${prefix}${rt.key}_stddev`;
                const average = results?.[avgKey];
                const stddev = results?.[stddevKey];
                return (
                  <tr key={rt.key}>
                    <td>{rt.label}</td>
                    <td>{average ? average.toPrecision(8) : "---"}</td>
                    <td>{stddev ? stddev.toPrecision(4) : "---"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const ModalFinalResultCard = ({ value, uncertainty, nCycles }) => {
  const expandedUncertainty = expandedTypeAUncertainty(uncertainty);
  const hasUA = expandedUncertainty !== null;
  return (
    <div className="final-result-card modal-result-card">
      <h4>Calculated AC-DC Difference</h4>
      <p>
        {value != null ? parseFloat(value).toFixed(3) : "---"}
        {hasUA && (
          <span style={{ fontWeight: 500, opacity: 0.8 }}>
            &nbsp;±&nbsp;{expandedUncertainty.toFixed(3)}
          </span>
        )}
        <span> PPM</span>
      </p>
      {hasUA && nCycles ? (
        <p style={{ margin: "4px 0 0 0", fontSize: "0.78rem", opacity: 0.7 }}>
          Expanded Type A (U_A = {TYPE_A_COVERAGE_FACTOR}u_A, k = {TYPE_A_COVERAGE_FACTOR}, approx. 95%), N = {nCycles}
        </p>
      ) : null}
    </div>
  );
};

const RangeResultsModal = ({ isOpen, onClose, results, rangeInfo }) => {
  if (!isOpen || !results) return null;

  return (
    <div className="modal-overlay">
      <div
        className="modal-content"
        style={{ maxWidth: "800px", textAlign: "left" }}
      >
        <div
          className="modal-header"
          style={{
            textAlign: "center",
            borderBottom: "none",
            paddingBottom: 0,
          }}
        >
          <button onClick={onClose} className="modal-close-button">
            <FaTimes />
          </button>
        </div>

        <div className="modal-body" style={{ padding: "20px 0" }}>
          <ModalFinalResultCard
            value={
              results.pair_delta_uut_ppm
              ?? results.delta_uut_ppm_avg
              ?? results.delta_uut_ppm
            }
            uncertainty={
              results.pair_type_a_uncertainty_ppm
              ?? results.type_a_uncertainty_ppm
            }
            nCycles={results.cycles?.length || null}
          />
          <RangeSummaryTable
            title="Standard Instrument"
            results={results}
            prefix="std_"
          />
          <RangeSummaryTable
            title="Test Instrument"
            results={results}
            prefix="ti_"
          />
        </div>

        <div className="form-section-warning" style={{ margin: "15px 0 0 0" }}>
          <p style={{ margin: 0 }}>
            Results for: Samples{" "}
            <strong>{rangeInfo.start}</strong> to{" "}
            <strong>{rangeInfo.end}</strong>
          </p>
        </div>

        <div
          className="modal-actions"
          style={{
            justifyContent: "flex-end",
            paddingTop: "10px",
            marginTop: "10px",
          }}
        >
          <button onClick={onClose} className="button button-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default RangeResultsModal;
