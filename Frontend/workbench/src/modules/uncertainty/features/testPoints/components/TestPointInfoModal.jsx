import SymbolButton from "../../../components/common/SymbolButton";
import React from "react";
import { getToleranceSummary } from "../../../utils/uncertaintyMath";

const TestPointInfoModal = ({ isOpen, onClose, testPoint }) => {
  if (!isOpen || !testPoint) return null;

  const uutToleranceDisplay = getToleranceSummary(testPoint.uutTolerance);
  const tmdeTolerances = testPoint.tmdeTolerances || [];

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ textAlign: "left" }}>
        <SymbolButton onClick={onClose} className="modal-close-button" />
        <h3>Test Point Details</h3>
        <div className="breakdown-step">
          <h5>Identification</h5>
          <p>
            <strong>Section:</strong> {testPoint.section || "N/A"}
          </p>
          <p>
            <strong>UUT: </strong> {testPoint.uutDescription || "N/A"}
          </p>
        </div>
        <div className="breakdown-step">
          <h5>Tolerances</h5>
          <p>
            <strong>UUT Tolerance:</strong> {uutToleranceDisplay}
          </p>

          {tmdeTolerances.length > 0 ? (
            tmdeTolerances.map((tmde, index) => (
              <p key={index}>
                <strong>TMDE ({tmde.name || `TMDE ${index + 1}`}): </strong>
                {getToleranceSummary(tmde)}
              </p>
            ))
          ) : (
            <p>
              <strong>TMDE Tolerance:</strong> Not Set
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default TestPointInfoModal;
