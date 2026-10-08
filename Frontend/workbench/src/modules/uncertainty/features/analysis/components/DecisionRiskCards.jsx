import React, { useLayoutEffect, useRef } from "react";
import { decisionRiskLimit, decisionRiskStatus } from "../../../utils/decisionRiskStatus";

const names = { pfa: "Probability of false acceptance", pfr: "Probability of false rejection" };
const statusLabels = { good: "Within threshold", warning: "Above threshold", bad: "Above threshold", neutral: "Unavailable" };

function FittedRiskValue({ children, label }) {
  const containerRef = useRef(null);
  const valueRef = useRef(null);
  useLayoutEffect(() => {
    const fit = () => {
      const container = containerRef.current, value = valueRef.current;
      if (!container || !value || !container.clientWidth || !value.scrollWidth) return;
      value.style.transform = `scale(${Math.min(1, container.clientWidth / value.scrollWidth)})`;
    };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    if (containerRef.current) observer?.observe(containerRef.current);
    if (valueRef.current) observer?.observe(valueRef.current);
    return () => observer?.disconnect();
  }, [label]);
  return <dd ref={containerRef} aria-label={label}><span ref={valueRef} className="budget-decision-readout">{children}</span></dd>;
}

export default function DecisionRiskCards({ results, requiredPfa, formatValue, onShowBreakdown }) {
  const boundary = results?.riskMethod === "risk8-pfa-boundary";
  // Keep the final result slots visible even before inputs are complete. A dash
  // denotes unavailable data; zero remains a valid, color-coded probability.
  const metrics = ["pfa", "pfr"];
  return (
    <dl className="budget-decision-results" aria-label="Final decision risk">
      {metrics.map(metric => {
        const value = boundary ? null : results?.[metric];
        const status = decisionRiskStatus(value, requiredPfa, metric);
        const label = metric.toUpperCase();
        const explanation = status === "neutral"
          ? boundary ? `${metric.toUpperCase()} is unavailable when the measured value is unknown.` : `${names[metric]} is unavailable until the risk calculation is complete.`
          : `${names[metric]}. ${statusLabels[status]}. ${metric === "pfr" ? "Color uses the Required PFA reference threshold" : "Required PFA"}: ${decisionRiskLimit(requiredPfa)}%.`;
        return (
          <div key={metric} className={`budget-decision-card is-${status}`} title={`${explanation} Ctrl/Cmd-click or press Enter for the breakdown.`}
            tabIndex={onShowBreakdown ? 0 : undefined}
            onClick={event => { if (event.ctrlKey || event.metaKey) onShowBreakdown?.(metric); }}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onShowBreakdown?.(metric); } }}>
            <dt>{label}</dt>
            <FittedRiskValue label={`${label}: ${status === "neutral" ? "Unavailable" : `${formatValue(value)} percent, ${statusLabels[status]}`}`}>
              {status === "neutral" ? (boundary ? "NA" : "—") : <>{formatValue(value)}<span className="budget-decision-unit"> %</span></>}
            </FittedRiskValue>
          </div>
        );
      })}
    </dl>
  );
}
