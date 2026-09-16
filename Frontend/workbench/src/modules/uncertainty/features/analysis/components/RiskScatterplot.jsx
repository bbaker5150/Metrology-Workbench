import GrowingNumericInput from "../../../components/common/GrowingNumericInput";
import { useMemo, useState } from "react";
import { useTheme } from "../../../context/ThemeContext";
import Plotly from 'plotly.js-dist';
import createPlotlyComponent from 'react-plotly.js/factory';

// eslint-disable-next-line no-unused-vars
const Plot = createPlotlyComponent(Plotly);

let spareRandom = null;
function generateStandardNormal() {
  let val, u, v, s;
  if (spareRandom !== null) {
    val = spareRandom;
    spareRandom = null;
  } else {
    do {
      u = Math.random() * 2 - 1;
      v = Math.random() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    val = u * mul;
    spareRandom = v * mul;
  }
  return val;
}

function calculateBivariateRelativeLikelihood(x, y, sigmaX, sigmaY, rho) {
  const z = (Math.pow(x, 2) / Math.pow(sigmaX, 2)) - 
            (2 * rho * x * y / (sigmaX * sigmaY)) + 
            (Math.pow(y, 2) / Math.pow(sigmaY, 2));
  return Math.exp(-z / (2 * (1 - Math.pow(rho, 2))));
}

// --- SUB-COMPONENTS (Moved outside main component) ---
// eslint-disable-next-line no-unused-vars
const ColorSwatch = ({ color }) => (
    <span style={{
      display: 'inline-block', width: '10px', height: '10px', 
      borderRadius: '50%', backgroundColor: color, marginRight: '5px' 
    }}></span>
);

// eslint-disable-next-line no-unused-vars
const GradientSwatch = ({ colors }) => (
    <span style={{
      display: 'inline-block', width: '40px', height: '12px', 
      background: colors.heatmapGradient, marginRight: '5px',
      borderRadius: '2px', border: '1px solid #888'
    }}></span>
);

// eslint-disable-next-line no-unused-vars
const HelpOverlay = ({ onClose, colors, isDarkMode, vizMode, numPoints }) => {
    return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: colors.overlayBg, zIndex: 10,
      padding: '2rem', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', overflowY: 'auto'
    }}>
      <div style={{ maxWidth: '650px', color: colors.text }}>
        <h3 style={{ borderBottom: `2px solid ${colors.primary}`, paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
          Understanding This Chart
        </h3>
        
        {/* Universal Axis Info */}
        <div style={{ display:'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
          <div>
            <strong style={{ color: colors.primary, display: 'block', marginBottom: '0.5rem' }}>X-Axis: True Error</strong>
            <p style={{ fontSize: '0.85rem', opacity: 0.8, lineHeight: '1.5' }}>
              The actual, physical error of the device. In the real world, this is unknown.
              <br/><br/>
              <strong style={{color: colors.primary}}>-- Dashed Lines --</strong> mark the Specifications (Tolerance). Outside these lines = Bad Unit.
            </p>
          </div>
          <div>
            <strong style={{ color: colors.warning, display: 'block', marginBottom: '0.5rem' }}>Y-Axis: Measured Error</strong>
            <p style={{ fontSize: '0.85rem', opacity: 0.8, lineHeight: '1.5' }}>
              What the instrument reads during calibration (True Error + Measurement Uncertainty).
              <br/><br/>
              <strong style={{color: colors.warning}}>·· Dotted Lines ··</strong> mark the Acceptance Limits. Outside these lines = Fail Result.
            </p>
          </div>
        </div>

        {/* Dynamic Mode Explanations */}
        {vizMode === 'analytical' ? (
           <div style={{ margin: '1rem 0', padding: '15px', background: isDarkMode?'#333':'#f8f9fa', borderRadius: '8px', border: `1px solid ${isDarkMode?'#444':'#dee2e6'}` }}>
             <strong style={{ display: 'flex', alignItems: 'center', fontSize: '1rem', marginBottom: '0.5rem' }}>
               <GradientSwatch colors={colors} /> Analytical Heatmap
             </strong>
             <div style={{ fontSize: '0.9rem', opacity: 0.85, lineHeight: '1.6' }}>
               <p style={{ marginBottom: '1rem' }}>
                 This view uses the <strong>Bivariate Normal Probability Density Function (PDF)</strong>.
                 It calculates the exact mathematical likelihood of a measurement falling at any specific coordinate (x,y).
               </p>
               <ul style={{ paddingLeft: '20px', margin: 0 }}>
                 <li style={{ marginBottom: '5px' }}><strong>How it works:</strong> We use the calculated standard deviations (u_true, u_cal) and the correlation coefficient (ρ) to generate a "terrain" of risk.</li>
                 <li><strong>Interpretation:</strong> 
                    <span style={{ color: isDarkMode?'#fde725':'#08519c', fontWeight: 'bold' }}> Brightest</span> areas are the "Peak" of the bell curve (Most Likely). 
                    <span style={{ color: isDarkMode?'#440154':'#f7fbff', fontWeight: 'bold' }}> Dark</span> areas are the tails (Least Likely).
                 </li>
               </ul>
             </div>
           </div>
        ) : (
           <div style={{ margin: '1rem 0', padding: '15px', background: isDarkMode?'#333':'#f8f9fa', borderRadius: '8px', border: `1px solid ${isDarkMode?'#444':'#dee2e6'}` }}>
             <strong style={{ display: 'block', fontSize: '1rem', marginBottom: '0.5rem' }}>Monte Carlo Simulation</strong>
             <div style={{ fontSize: '0.9rem', opacity: 0.85, lineHeight: '1.6' }}>
               <p style={{ marginBottom: '1rem' }}>
                 This view performs a <strong>Random Simulation</strong> of {numPoints} individual calibration events.
               </p>
               <ul style={{ paddingLeft: '20px', marginBottom: '1rem' }}>
                 <li style={{ marginBottom: '5px' }}><strong>How it works:</strong> For every dot, we generate two random numbers (z-scores) based on the Bell Curve. One represents the Unit's error, the other represents the Calibrator's error. We add them together to simulate a measurement.</li>
               </ul>
               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                 <div><ColorSwatch color={colors.good}/> <strong>Correct Accept:</strong> Good Unit, Passed.</div>
                 <div><ColorSwatch color={colors.bad}/> <strong>False Accept:</strong> Bad Unit, but Passed.</div>
                 <div><ColorSwatch color={colors.warning}/> <strong>False Reject:</strong> Good Unit, Failed.</div>
                 <div><ColorSwatch color={colors.primary}/> <strong>Correct Reject:</strong> Bad Unit, Failed.</div>
               </div>
             </div>
           </div>
        )}
        
        <button 
          onClick={onClose}
          style={{
            marginTop: '1.5rem', padding: '0.6rem 2.5rem',
            background: colors.primary, color: '#fff', border: 'none',
            borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem'
          }}
        >
          Close Help
        </button>
      </div>
    </div>
  );
};


const RiskScatterplot = ({ results, inputs }) => {
  const isDarkMode = useTheme();
  const [numPoints, setNumPoints] = useState(3000);
  const [vizMode, setVizMode] = useState("monteCarlo"); 
  const [showHelp, setShowHelp] = useState(false);

  const colors = useMemo(() => {
    return {
      good: isDarkMode ? "#28a745" : "#198754",   
      bad: "#dc3545",                              
      warning: "#ffc107",                          
      primary: isDarkMode ? "#3b82f6" : "#007bff", 
      pointBorder: isDarkMode ? "#121212" : "#ffffff", 
      text: isDarkMode ? "#e0e0e0" : "#212529",
      bg: isDarkMode ? "#1e1e1e" : "#ffffff",
      overlayBg: isDarkMode ? "rgba(30, 30, 30, 0.98)" : "rgba(255, 255, 255, 0.98)",
      heatmapGradient: isDarkMode 
        ? "linear-gradient(to right, #440154, #31688e, #35b779, #fde725)" 
        : "linear-gradient(to right, #f7fbff, #6bgned, #08519c)"
    };
  }, [isDarkMode]);

  const plotData = useMemo(() => {
    if (!results || !inputs) return [];

    const { uUUT, uCal, uDev, correlation } = results;
    const { LLow, LUp } = inputs;
    const { ALow, AUp } = results; 

    const unit = results.nativeUnit || "Units";
    const hoverTemplate = `True: %{x:.3e} ${unit}<br>Meas: %{y:.3e} ${unit}<extra></extra>`;

    const mid = (LUp + LLow) / 2;
    const LUp_norm = LUp - mid;
    const LLow_norm = LLow - mid;
    const AUp_norm = AUp - mid;
    const ALow_norm = ALow - mid;

    // --- MODE 1: ANALYTICAL (HEATMAP) ---
    if (vizMode === "analytical") {
      const xRange = Math.max(Math.abs(LLow_norm), Math.abs(LUp_norm)) * 1.5;
      const yRange = Math.max(Math.abs(ALow_norm), Math.abs(AUp_norm)) * 1.5;
      
      const size = 100; 
      const x = [];
      const y = [];
      const z = [];

      for (let i = 0; i < size; i++) {
        const xVal = -xRange + (2 * xRange * i) / (size - 1);
        x.push(xVal);
        const rowZ = [];
        for (let j = 0; j < size; j++) {
           if (i === 0) { 
             const yVal = -yRange + (2 * yRange * j) / (size - 1);
             y.push(yVal);
           }
           const currX = xVal;
           const currY = -yRange + (2 * yRange * j) / (size - 1);
           rowZ.push(calculateBivariateRelativeLikelihood(currX, currY, uUUT, uDev, correlation));
        }
        z.push(rowZ);
      }

      const zTransposed = z[0].map((_, colIndex) => z.map(row => row[colIndex]));

      return [{
        z: zTransposed,
        x: x,
        y: y,
        type: 'contour',
        name: 'Likelihood',
        colorscale: isDarkMode ? 'Viridis' : 'Blues',
        contours: {
          coloring: 'heatmap',
          showlabels: false, 
        },
        colorbar: {
          title: 'Relative<br>Likelihood',
          titleside: 'top',
          tickvals: [0, 0.5, 1],
          ticktext: ['Low', 'Medium', 'High'],
          titlefont: { size: 11, color: colors.text },
          tickfont: { size: 10, color: colors.text }
        },
        hovertemplate: `True: %{x:.3e}<br>Meas: %{y:.3e}<br>Likelihood: %{z:.1%}<extra></extra>`
      }];
    }

    // --- MODE 2: MONTE CARLO (SCATTER) ---
    const data = { CA: { x: [], y: [] }, FA: { x: [], y: [] }, FR: { x: [], y: [] }, CR: { x: [], y: [] } };

    for (let i = 0; i < numPoints; i++) {
      const z1 = generateStandardNormal();
      const z2 = generateStandardNormal();
      const trueError = uUUT * z1;
      const calError = uCal * z2;
      const measuredError = trueError + calError;
      const isGood = trueError > LLow_norm && trueError < LUp_norm;
      const isAccept = measuredError > ALow_norm && measuredError < AUp_norm;

      let category;
      if (isGood && isAccept) category = "CA";
      else if (isGood && !isAccept) category = "FR";
      else if (!isGood && isAccept) category = "FA";
      else category = "CR";

      data[category].x.push(trueError);
      data[category].y.push(measuredError);
    }

    const markerBase = { line: { color: colors.pointBorder, width: 0.5 } };
    
    return [
      {
        ...data.CA,
        mode: "markers",
        type: "scatter",
        name: "Correct Accept",
        hovertemplate: hoverTemplate,
        marker: { ...markerBase, color: colors.good, size: 6, opacity: 0.5 },
      },
      {
        ...data.FA,
        mode: "markers",
        type: "scatter",
        name: "False Accept (PFA)",
        hovertemplate: hoverTemplate,
        marker: { ...markerBase, color: colors.bad, size: 8, opacity: 0.9 },
      },
      {
        ...data.FR,
        mode: "markers",
        type: "scatter",
        name: "False Reject (PFR)",
        hovertemplate: hoverTemplate,
        marker: { ...markerBase, color: colors.warning, size: 8, opacity: 0.9 },
      },
      {
        ...data.CR,
        mode: "markers",
        type: "scatter",
        name: "Correct Reject",
        hovertemplate: hoverTemplate,
        marker: { ...markerBase, color: colors.primary, size: 6, opacity: 0.5 },
      },
    ];
  }, [results, inputs, numPoints, colors, vizMode, isDarkMode]);

  const plotLayout = useMemo(() => {
    const mid = (inputs.LUp + inputs.LLow) / 2;
    const LUp_norm = inputs.LUp - mid;
    const LLow_norm = inputs.LLow - mid;
    const AUp_norm = results.AUp - mid;
    const ALow_norm = results.ALow - mid;

    const xMargin = (LUp_norm - LLow_norm) * 0.7;
    const yMargin = (AUp_norm - ALow_norm) * 0.7;

    const x_outer_L = LLow_norm - xMargin;
    const x_outer_R = LUp_norm + xMargin;
    const y_outer_T = AUp_norm + yMargin;
    const y_outer_B = ALow_norm - yMargin;

    const unit = results.nativeUnit || "Units";
    const gridColor = isDarkMode ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"; 
    const mutedTextColor = isDarkMode ? "#a0a0a0" : "#6c757d";
    const fontStack = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

    const labelPositions = {
      CA: { x: 0, y: 0, text: "Correct Accept" },
      FA_Left: { x: (LLow_norm + x_outer_L) / 2, y: 0, text: "False Accept" },
      FA_Right: { x: (LUp_norm + x_outer_R) / 2, y: 0, text: "False Accept" },
      FR_Top: { x: 0, y: (AUp_norm + y_outer_T) / 2, text: "False Reject" },
      FR_Bottom: { x: 0, y: (ALow_norm + y_outer_B) / 2, text: "False Reject" },
    };

    const regionAnnotations = Object.values(labelPositions).map((pos) => ({
      ...pos,
      showarrow: false,
      font: { family: fontStack, color: mutedTextColor, size: 11, weight: "bold" },
      bgcolor: isDarkMode ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)",
      borderpad: 4,
      opacity: 0.8,
    }));

    const createLimitLabel = (x, y, text, color, xanchor, yanchor) => ({
        x, y, text,
        showarrow: false,
        xanchor, yanchor,
        font: { family: fontStack, color: color, size: 10, weight: "bold" },
        bgcolor: isDarkMode ? "rgba(30,30,30,0.8)" : "rgba(255,255,255,0.8)",
        borderpad: 2
    });

    const limitAnnotations = [
      createLimitLabel(LLow_norm, y_outer_T, `L-Tol (${LLow_norm.toExponential(2)} ${unit})`, colors.primary, "center", "bottom"),
      createLimitLabel(LUp_norm, y_outer_T, `U-Tol (${LUp_norm.toExponential(2)} ${unit})`, colors.primary, "center", "bottom"),
      createLimitLabel(x_outer_R, ALow_norm, `L-Acc (${ALow_norm.toExponential(2)} ${unit})`, colors.warning, "left", "middle"),
      createLimitLabel(x_outer_R, AUp_norm, `U-Acc (${AUp_norm.toExponential(2)} ${unit})`, colors.warning, "left", "middle"),
    ];

    return {
      title: { text: "Risk Analysis", font: { family: fontStack, size: 16, color: colors.text } },
      autosize: true,
      xaxis: {
        title: { text: `True UUT Error (${unit})`, font: { family: fontStack, size: 12 } },
        zeroline: true, zerolinecolor: gridColor, gridcolor: gridColor,
        tickfont: { family: fontStack, size: 10, color: mutedTextColor },
        range: [LLow_norm - xMargin * 1.2, LUp_norm + xMargin * 1.2],
      },
      yaxis: {
        title: { text: `Measured Error (${unit})`, font: { family: fontStack, size: 12 } },
        zeroline: true, zerolinecolor: gridColor, gridcolor: gridColor,
        tickfont: { family: fontStack, size: 10, color: mutedTextColor },
        range: [ALow_norm - yMargin * 1.2, AUp_norm + yMargin * 1.2],
      },
      shapes: [
        { type: "line", x0: LLow_norm, x1: LLow_norm, y0: y_outer_B, y1: y_outer_T, line: { color: colors.primary, width: 2, dash: "dash" } },
        { type: "line", x0: LUp_norm, x1: LUp_norm, y0: y_outer_B, y1: y_outer_T, line: { color: colors.primary, width: 2, dash: "dash" } },
        { type: "line", x0: x_outer_L, x1: x_outer_R, y0: ALow_norm, y1: ALow_norm, line: { color: colors.warning, width: 2, dash: "dot" } },
        { type: "line", x0: x_outer_L, x1: x_outer_R, y0: AUp_norm, y1: AUp_norm, line: { color: colors.warning, width: 2, dash: "dot" } },
      ],
      annotations: [...regionAnnotations, ...limitAnnotations],
      legend: { orientation: "h", y: -0.15, x: 0.5, xanchor: "center", bgcolor: "transparent", font: { family: fontStack, size: 11, color: colors.text } },
      paper_bgcolor: colors.bg,
      plot_bgcolor: colors.bg,
      margin: { t: 40, b: 60, l: 60, r: 40 },
      hovermode: "closest",
    };
  }, [results, inputs, isDarkMode, colors]); // Removed vizMode

  const plotConfig = useMemo(() => ({
      responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d', 'toggleSpikelines']
    }), []);

  return (
    <div className="scatterplot-container" style={{ height: "450px", width: "100%", position: "relative", marginTop: "1rem" }}>
       
       {showHelp && (
         <HelpOverlay 
            onClose={() => setShowHelp(false)} 
            colors={colors}
            isDarkMode={isDarkMode}
            vizMode={vizMode}
            numPoints={numPoints}
         />
       )}

       <div className="plot-floating-control" style={{ 
          display: 'flex', gap: '10px', alignItems: 'center', 
          background: isDarkMode ? 'rgba(30,30,30,0.8)' : 'rgba(255,255,255,0.8)',
          padding: '5px 10px', borderRadius: '8px',
          boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
       }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label htmlFor="vizMode" style={{fontSize: '0.75rem', marginBottom: '2px', fontWeight: 'bold'}}>View Mode:</label>
            <select
                id="vizMode"
                value={vizMode}
                onChange={(e) => setVizMode(e.target.value)}
                style={{ padding: '2px', fontSize: '0.85rem' }}
            >
                <option value="monteCarlo">Monte Carlo (Simulation)</option>
                <option value="analytical">Analytical (Heat Map)</option>
            </select>
          </div>

          {vizMode === 'monteCarlo' && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                <label htmlFor="numPlotPoints" style={{fontSize: '0.75rem', marginBottom: '2px', fontWeight: 'bold'}}>Points:</label>
                <GrowingNumericInput
                    type="number"
                    id="numPlotPoints"
                    step="500"
                    min="500"
                    max="10000"
                    value={numPoints}
                    onChange={(e) => setNumPoints(Number(e.target.value))}
                    style={{ width: '60px', padding: '2px', fontSize: '0.85rem' }}
                />
            </div>
          )}

          <div style={{ borderLeft: `1px solid ${colors.text}`, paddingLeft: '10px', marginLeft: '5px' }}>
            <button
              onClick={() => setShowHelp(true)}
              title="Explain this chart"
              style={{
                background: 'transparent', border: `1px solid ${colors.text}`,
                color: colors.text, borderRadius: '50%', width: '24px', height: '24px',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 'bold'
              }}
            >
              ?
            </button>
          </div>
       </div>

       <Plot
          data={plotData}
          layout={plotLayout}
          config={plotConfig}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler={true}
       />
    </div>
  );
};

export default RiskScatterplot;