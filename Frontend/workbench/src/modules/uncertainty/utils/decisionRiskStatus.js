import { pfaPassesAtDisplayedPrecision } from "./risk8/riskEngine8";

export const decisionRiskLimit = (requiredPfa) => {
  const limit = Number(requiredPfa);
  return requiredPfa != null && requiredPfa !== "" && Number.isFinite(limit) && limit >= 0 ? limit : 2;
};

// Both displays use the session's Required PFA as the attention threshold.
// PFA acceptance retains Risk 8's displayed-precision comparison; PFR is a
// separate result and uses the exact threshold, as in the measurement list.
export const decisionRiskStatus = (value, requiredPfa, metric = "pfa") => {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "neutral";
  const numeric = Number(value);
  const limit = decisionRiskLimit(requiredPfa);
  if (numeric <= limit || (metric === "pfa" && pfaPassesAtDisplayedPrecision(numeric / 100, limit / 100))) return "good";
  return numeric > Math.max(limit * 2.5, limit + 3) ? "bad" : "warning";
};

export const decisionRiskColor = (value, requiredPfa, metric) => {
  const status = decisionRiskStatus(value, requiredPfa, metric);
  return status === "neutral" ? "var(--text-color-muted)" : `var(--status-${status})`;
};
