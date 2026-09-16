// Isolated reviewer/smoke-test entry: real React breakdowns, synthetic workbook
// cases only. It never loads a session, database, or connected SharePoint list.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '/src/index.css';
import '/src/modules/uncertainty/App.css';
import RiskBreakdownModal from '/src/modules/uncertainty/features/analysis/components/BreakdownModals/RiskBreakdownModals.jsx';
import { computeRiskRow8 } from '/src/modules/uncertainty/utils/risk8/riskBridge8';
import { buildKnownMeasurementDiagnostics, buildKnownTwoSidedDiagnostics, toKnownMeasurementSummary } from '/src/modules/uncertainty/utils/risk8/knownMeasurementRisk8';
import { toUnknownMeasurementSummary } from '/src/modules/uncertainty/utils/risk8/unknownMeasurementRisk8';
import vectors from '/src/modules/uncertainty/utils/risk8/beta7Vectors.json';

const root = createRoot(document.getElementById('root'));
window.renderRiskCase = (id, metric) => {
  const vector = vectors.cases.find(v => v.id === id);
  if (!vector) throw Error(`Missing case ${id}`);
  const input = vector.input;
  const result = { ...computeRiskRow8(input, { enforceMinimumInputs: false }), input };
  const type = result.out.tolType, twoSided = type <= 2;
  const halfSpan = twoSided ? (input.upperLimit - input.lowerLimit) / 2
    : type === 3 ? input.nominal - input.lowerLimit : input.upperLimit - input.nominal;
  result.meta = { frame: { center: input.nominal, halfSpan }, mu: input.mu, xcal: input.xcal, tolType: type };
  result.diagnostics = type <= 2 ? buildKnownTwoSidedDiagnostics(result)
    : type <= 4 ? buildKnownMeasurementDiagnostics(result, type === 3 ? 'low' : 'high') : null;
  const results = {
    ...(type <= 4 ? toKnownMeasurementSummary(result) : toUnknownMeasurementSummary(result)),
    LLow: input.lowerLimit === '' ? undefined : input.lowerLimit,
    LUp: input.upperLimit === '' ? undefined : input.upperLimit,
    // Synthetic measured value is the nominal. Only the modeled UUT population
    // mean carries mu; a bias must not move physical TUR/TAR geometry.
    nominalValue: input.nominal, measurementAverage: input.nominal,
    riskAverage: input.nominal + (input.mu || 0) * halfSpan,
    expandedUncertainty: type <= 4 ? halfSpan / input.tur : input.uCal,
    nativeUnit: 'V', tmdeToleranceSpan: .2, tar: 10,
    gbInputs: { reqPFA: input.pfaTarget, measRelTarget: input.reopTarget,
      measrelCalcAssumed: input.reop, calibrationInt: input.originalInterval,
      initialGB: input.initialGB, safeRes: input.resolution },
    risk8: result,
  };
  root.render(<div data-case={`${id}/${metric}`}>
    <RiskBreakdownModal key={`${id}/${metric}`} isOpen onClose={() => {}} modalType={metric} data={{ results, inputs: {} }} />
  </div>);
};
window.riskPreviewReady = true;
