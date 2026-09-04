import { useMemo } from "react";

const formatMagnitude = (value) => {
  if (!Number.isFinite(Number(value))) return "0";
  if (Number(value) === 0) return "0";
  return Number(value).toPrecision(4);
};

// A native React contribution chart is intentionally used here instead of an
// imperative plotting canvas. Budget rows can change on every blur/select;
// rendering the bars from props keeps labels, percentages, and accessible text
// in the same React commit and avoids stale Plotly text/layout during resize.
const PercentageBarGraph = ({
  data,
  unit = "",
  valueMode = "magnitude",
  title = "Uncertainty contribution",
  valueLabel,
}) => {
  const rows = useMemo(() => {
    const entries = Object.entries(
      data && typeof data === "object" ? data : {},
    )
      .map(([label, value]) => ({ label, value: Math.abs(Number(value) || 0) }))
      .filter((entry) => entry.value > 0);
    const total = entries.reduce((sum, entry) => sum + entry.value, 0);
    return entries
      .map((entry) => ({
        ...entry,
        percentage: total > 0 ? (entry.value / total) * 100 : 0,
      }))
      .sort((a, b) => b.percentage - a.percentage);
  }, [data]);

  if (rows.length === 0) {
    return (
      <div className="bargraph-container contribution-plot-empty placeholder-content">
        <p>No significant error sources to display.</p>
      </div>
    );
  }

  const contributionLabel =
    valueLabel ||
    (valueMode === "share" ? "Variance contribution" : "Contribution");

  return (
    <section
      className="bargraph-container contribution-plot contribution-plot-native"
      aria-label={title}
    >
      <h5 className="contribution-plot-title">{title}</h5>
      <div className="contribution-plot-list">
        {rows.map(({ label, value, percentage }) => {
          const formattedValue =
            valueMode === "share"
              ? `${percentage.toFixed(2)}%`
              : [formatMagnitude(value), unit].filter(Boolean).join(" ");
          return (
            <div
              key={label}
              className="contribution-plot-row"
              data-contribution-label={label}
              data-contribution-percentage={percentage.toFixed(12)}
              title={`${label} — ${contributionLabel}: ${formattedValue}; share: ${percentage.toFixed(2)}%`}
            >
              <span className="contribution-plot-label">{label}</span>
              <span className="contribution-plot-track" aria-hidden="true">
                <span
                  className="contribution-plot-bar"
                  style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }}
                />
              </span>
              <output className="contribution-plot-value">
                {percentage.toFixed(1)}%
              </output>
            </div>
          );
        })}
      </div>
      <div className="contribution-plot-axis" aria-hidden="true">
        <span>0%</span>
        <span>25%</span>
        <span>50%</span>
        <span>75%</span>
        <span>100%</span>
      </div>
      <p className="contribution-plot-axis-title">Relative contribution (%)</p>
    </section>
  );
};

export default PercentageBarGraph;
