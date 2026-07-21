import { useMemo, useEffect, useRef } from "react";
import Plotly from "plotly.js-dist";
import { useTheme } from "../../../context/ThemeContext";

const PercentageBarGraph = ({ data, unit = "" }) => {
  const isDarkMode = useTheme();
  const plotContainer = useRef(null);

  // 1. Data Processing
  const processedData = useMemo(() => {
    let inputs = data;
    
    // Filter logic: Remove zero entries to keep the chart clean.
    if (inputs && typeof inputs === "object") {
      inputs = Object.fromEntries(Object.entries(inputs).filter(([, value]) => value !== 0));
    }

    if (!inputs || typeof inputs !== "object") return { labels: [], percentages: [], values: [] };

    const entries = Object.entries(inputs);
    
    // Sort entries by value ascending (Plotly draws bottom-to-top)
    entries.sort((a, b) => Number(a[1]) - Number(b[1]));

    const labels = entries.map(([key]) => key);
    const values = entries.map(([, val]) => Number(val));
    const total = values.reduce((acc, val) => acc + val, 0);

    // Calculate percentages
    const percentages = total === 0 ? values.map(() => 0) : values.map((val) => (val / total) * 100);

    return { labels, percentages, values };
  }, [data]);

  // Resolve the same design tokens used by the surrounding app. Plotly needs
  // concrete colors (CSS variables are not interpreted inside its SVG canvas),
  // so fallbacks keep tests and early renders deterministic.
  const themeColors = useMemo(() => {
    const styles =
      typeof window !== "undefined"
        ? window.getComputedStyle(document.body)
        : null;
    const token = (name, fallback) =>
      styles?.getPropertyValue(name)?.trim() || fallback;
    return {
      bg: "rgba(0, 0, 0, 0)",
      text: token("--text-color", isDarkMode ? "#e5e7eb" : "#172033"),
      subText: token(
        "--text-color-muted",
        isDarkMode ? "#94a3b8" : "#64748b",
      ),
      grid: token(
        "--border-color",
        isDarkMode ? "rgba(148, 163, 184, 0.16)" : "rgba(15, 23, 42, 0.1)",
      ),
      accent: token("--primary-color", isDarkMode ? "#38bdf8" : "#2563eb"),
    };
  }, [isDarkMode]);

  // 3. Construct Plot Data
  const plotData = useMemo(() => {
    const barThickness = processedData.labels.length <= 3 ? 0.5 : 0.66;

    const formatValue = (val) => {
        if (val === 0 || val === null) return "0";
        return Number(val).toPrecision(4);
    };

    const formattedValuesWithUnit = processedData.values.map(val => `${formatValue(val)} ${unit}`);

    return [
      {
        x: processedData.percentages,
        y: processedData.labels,
        customdata: formattedValuesWithUnit, 
        orientation: "h",
        type: "bar",
        width: barThickness,
        marker: {
          color: themeColors.accent,
          opacity: 0.86,
          line: {
            color: themeColors.accent,
            width: 0,
          },
          cornerradius: "28%",
        },
        hovertemplate: 
          `<b>%{y}</b><br>` +
          `Contribution: <b>%{customdata}</b><br>` + 
          `Share: %{x:.2f}%<br>` +
          `<extra></extra>`,
        text: processedData.percentages.map((p) => `${p.toFixed(1)}%`),
        textposition: "outside",
        cliponaxis: false,
        textfont: {
          family: "'Inter', sans-serif",
          color: themeColors.text,
          size: 11,
        }
      },
    ];
  }, [processedData, themeColors, unit]);

  // 4. Construct Layout
  const plotLayout = useMemo(() => {
    return {
        title: {
            text: "Uncertainty contribution",
            font: {
                family: "'Inter', sans-serif",
                size: 14,
                color: themeColors.text,
            },
            x: 0,
            xanchor: "left",
        },
        autosize: true,
        margin: { l: 150, r: 60, t: 48, b: 42 },
        bargap: 0.32,
        xaxis: { 
            title: {
                text: "Relative contribution (%)",
                font: { size: 10, color: themeColors.subText }
            },
            range: [0, 108],
            showgrid: true,
            gridcolor: themeColors.grid,
            gridwidth: 1,
            griddash: "dot",
            zeroline: false,
            ticksuffix: "%",
            dtick: 20,
            tickfont: { color: themeColors.subText, family: "'Inter', sans-serif" },
            fixedrange: true
        },
        yaxis: { 
            automargin: true,
            showgrid: false,
            zeroline: false,
            tickfont: { 
                color: themeColors.text, 
                family: "'Inter', sans-serif", 
                size: 11,
            },
            fixedrange: true,
        },
        paper_bgcolor: themeColors.bg,
        plot_bgcolor: themeColors.bg,
        showlegend: false,
        hoverlabel: {
          bgcolor: isDarkMode ? "#172033" : "#ffffff",
          bordercolor: themeColors.grid,
          font: { color: themeColors.text, family: "'Inter', sans-serif" },
        },
        transition: { duration: 260, easing: "cubic-in-out" },
    };
  }, [isDarkMode, themeColors]);

  // The contribution plot is informational and fixed-range, so a mode bar only
  // adds visual noise. In particular, do not expose Plotly's snapshot action.
  const plotConfig = useMemo(
    () => ({
      responsive: true,
      displaylogo: false,
      displayModeBar: false,
    }),
    [],
  );

  // Draw/redraw the chart whenever its data, layout, or config changes. Plotly
  // is imported directly (see top of file) rather than read off `window` — the
  // app never assigns `window.Plotly`, so the old global lookup silently no-oped
  // and the chart never appeared.
  useEffect(() => {
    const el = plotContainer.current;
    if (!el || plotData.length === 0) return;
    try {
      Plotly.react(el, plotData, plotLayout, plotConfig);
    } catch (err) {
      console.error("Failed to render contribution plot", err);
    }
  }, [plotData, plotLayout, plotConfig]);

  // Keep the plot sized to its container (it lives in a flex column whose width
  // settles after first paint) and tear it down on unmount so no stale chart or
  // resize observer leaks.
  useEffect(() => {
    const el = plotContainer.current;
    if (!el) return undefined;
    let observer;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        if (!el.isConnected) return;
        try {
          const resize = Plotly.Plots.resize(el);
          if (resize && typeof resize.catch === "function") {
            resize.catch(() => {
              /* Plotly may reject while the responsive panel is hidden. */
            });
          }
        } catch {
          /* not drawn yet */
        }
      });
      observer.observe(el);
    }
    return () => {
      observer?.disconnect();
      try {
        Plotly.purge(el);
      } catch {
        /* nothing to purge */
      }
    };
  }, []);

  if (processedData.percentages.length === 0) {
      return (
          <div className="bargraph-container contribution-plot-empty placeholder-content">
              <p style={{fontStyle: 'italic'}}>No significant error sources to display.</p>
          </div>
      )
  }

  const chartHeight = Math.min(
    500,
    Math.max(300, processedData.labels.length * 44 + 120),
  );
  return (
    <div
      ref={plotContainer}
      className="bargraph-container contribution-plot"
      style={{ "--contribution-plot-height": `${chartHeight}px` }}
    />
  );
};

export default PercentageBarGraph;
