import React from "react";
import { decisionRiskLimit, decisionRiskStatus } from "../../../utils/decisionRiskStatus";

const names = { pfa: "Probability of false acceptance", pfr: "Probability of false rejection" };
const statusLabels = { good: "Within threshold", warning: "Above threshold", bad: "Above threshold", neutral: "Unavailable" };

export default function DecisionRiskCards({ results, requiredPfa, formatValue }) {
  const boundary = results?.riskMethod === "risk8-pfa-boundary";
  // Keep the final result slots visible even before inputs are complete. A dash
  // denotes unavailable data; zero remains a valid, color-coded probability.
  const metrics = ["pfa", "pfr"];
  return (
    <dl className="budget-decision-results" aria-label="Final decision risk">
      {metrics.map(metric => {
        const value = boundary && metric === "pfr" ? null : results?.[metric];
        const status = decisionRiskStatus(value, requiredPfa, metric);
        const label = metric === "pfa" && boundary ? "PFA at Boundary" : metric.toUpperCase();
        const explanation = status === "neutral"
          ? boundary && metric === "pfr" ? "PFR is unavailable when the measured value is unknown." : `${names[metric]} is unavailable until the risk calculation is complete.`
          : `${names[metric]}. ${statusLabels[status]}. ${metric === "pfr" ? "Color uses the Required PFA reference threshold" : "Required PFA"}: ${decisionRiskLimit(requiredPfa)}%.`;
        return (
          <div key={metric} className={`budget-decision-card is-${status}`} title={explanation}>
            <dt>{label}</dt>
            <dd aria-label={`${label}: ${status === "neutral" ? "Unavailable" : `${formatValue(value)} percent, ${statusLabels[status]}`}`}>
              {status === "neutral" ? "—" : <>{formatValue(value)}<span className="budget-decision-unit"> %</span></>}
            </dd>
            <dd className="budget-decision-caption">{names[metric]}</dd>
          </div>
        );
      })}
    </dl>
  );
}
