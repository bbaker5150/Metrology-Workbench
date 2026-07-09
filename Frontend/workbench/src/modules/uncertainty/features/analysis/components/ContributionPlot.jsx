import { useMemo, useEffect, useRef, useCallback } from "react";
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

  // 2. Define Theme Colors
  const themeColors = useMemo(() => {
    return isDarkMode
      ? {
          bg: "#1e1e1e",           
          text: "#e0e0e0",         
          subText: "#a0a0a0",      
          grid: "#2c3e50",
          barColor: "rgba(6, 182, 212, 0.3)", // Neon Cyan with transparency
          barBorder: "#22d3ee",
          fontColor: "#ffffff"
        }
      : {
          bg: "#ffffff",           
          text: "#212529",         
          subText: "#6c757d",      
          grid: "#e9ecef",         
          barColor: "rgba(59, 130, 246, 0.8)", 
          barBorder: "#2563eb",
          fontColor: "#212529"
        };
  }, [isDarkMode]);

  // 3. Construct Plot Data
  const plotData = useMemo(() => {
    const barThickness = processedData.labels.length <= 3 ? 0.3 : 0.6;

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
          color: themeColors.barColor,
          line: {
            color: themeColors.barBorder, 
            width: 2 
          },
          cornerradius: 5 
        },
        hovertemplate: 
          `<b>%{y}</b><br>` +
          `Contribution: <b>%{customdata}</b><br>` + 
          `Share: %{x:.2f}%<br>` +
          `<extra></extra>`,
        text: processedData.percentages.map((p, i) => {
             return `${formattedValuesWithUnit[i]} (${p.toFixed(1)}%)`;
        }),
        // CHANGED: Forced text to be outside the bar
        textposition: "outside", 
        // CHANGED: Allows text to render slightly outside plot area if needed (helper)
        cliponaxis: false,
        textfont: {
          family: "'Inter', sans-serif",
          color: themeColors.fontColor,
          weight: 600
        }
      },
    ];
  }, [processedData, themeColors, unit]);

  // 4. Construct Layout
  const plotLayout = useMemo(() => {
    return {
        title: {
            text: "Uncertainty Contribution",
            font: {
                family: "'Inter', sans-serif",
                size: 18,
                color: themeColors.text,
                weight: 600
            },
            x: 0.05,
        },
        autosize: true,
        margin: { l: 180, r: 100, t: 60, b: 50 }, 
        xaxis: { 
            title: {
                text: "Percent Contribution (%)",
                font: { size: 12, color: themeColors.subText }
            },
            // CHANGED: Increased range from 115 to 135 to make room for the text 
            // pushing out to the right
            range: [0, 135], 
            showgrid: true,
            gridcolor: themeColors.grid,
            gridwidth: 1,
            griddash: 'dot',
            zeroline: false,
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
                size: 12 
            },
            fixedrange: true
        },
        paper_bgcolor: themeColors.bg,
        plot_bgcolor: themeColors.bg,
        showlegend: false,
        transition: {
            duration: 500,
            easing: "cubic-in-out"
        }
    };
  }, [themeColors]);

  // 5. Custom Download Handler (CSP-Safe)
  const handleDownload = useCallback(async (gd) => {
    try {
        // Step 1: Get the SVG as a 'data:' URI (Allowed by most CSPs, unlike 'blob:')
        // We use 'svg' format here because Plotly uses blobs for PNG generation, which fails.
        const svgDataUrl = await Plotly.toImage(gd, {
            format: 'svg',
            height: 500,
            width: 700,
            scale: 2
        });

        // Step 2: Manually rasterize the SVG to a Canvas to create a PNG
        const canvas = document.createElement('canvas');
        canvas.width = 1400; // 700 * 2 (scale)
        canvas.height = 1000; // 500 * 2 (scale)
        const ctx = canvas.getContext('2d');

        const img = new Image();
        
        // Wrap image loading in a promise to await it
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = svgDataUrl;
        });

        // Step 3: Draw background (Canvas is transparent by default)
        ctx.fillStyle = themeColors.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Step 4: Draw the plot image
        ctx.drawImage(img, 0, 0);

        // Step 5: Convert Canvas to PNG Data URL
        const pngDataUrl = canvas.toDataURL('image/png');
        
        // Step 6: Trigger Download
        const link = document.createElement('a');
        link.download = 'uncertainty_contribution.png';
        link.href = pngDataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        console.error("Snapshot failed:", err);
    }
  }, [themeColors]);

  const plotConfig = useMemo(() => {
    const cameraIcon = Plotly?.Icons?.camera || {
        width: 1000,
        path: "M500 750q104 0 177-73t73-177-73-177-177-73-177 73-73 177 73 177 177 73zm0-417q70 0 119 49t49 119-49 119-119 49-119-49-49-119 49-119 119-49z"
    };

    return { 
      responsive: true, 
      displaylogo: false,
      // Remove default 'toImage' which fails in Electron
      modeBarButtonsToRemove: ['toImage', 'zoom2d', 'pan2d', 'select2d', 'lasso2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d', 'resetScale2d'],
      modeBarButtonsToAdd: [
        {
          name: 'Download Snapshot',
          icon: cameraIcon,
          click: handleDownload
        }
      ]
    };
  }, [handleDownload]); // Re-create config if handler changes

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
        try {
          Plotly.Plots.resize(el);
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
          <div className="bargraph-container placeholder-content" style={{height: '300px', minHeight: 'unset'}}>
              <p style={{fontStyle: 'italic'}}>No significant error sources to display.</p>
          </div>
      )
  }

  return <div ref={plotContainer} className="bargraph-container" style={{ border: `1px solid ${themeColors.grid}` }}></div>;
};

export default PercentageBarGraph;