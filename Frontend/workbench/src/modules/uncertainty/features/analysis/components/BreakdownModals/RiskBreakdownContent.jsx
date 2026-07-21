import Latex from "../../../../components/common/Latex";
import {
  InvNormalDistribution,
  vbNormSDist,
  resUp,
  resDwn,
} from "../../../../utils/uncertaintyMath";

// Helper to safely format numbers for display
const safePrecision = (val, precision = 4) => {
  const num = parseFloat(val);
  if (isNaN(num) || !isFinite(num)) return "N/A";
  return num.toPrecision(precision);
};

const safeFixed = (val, digits = 4) => {
  const num = parseFloat(val);
  if (isNaN(num) || !isFinite(num)) return "N/A";
  return num.toFixed(digits);
};

const safeExponential = (val, digits = 4) => {
  const num = parseFloat(val);
  if (isNaN(num) || !isFinite(num)) return "N/A";
  return num.toExponential(digits);
};

// Method banner for Monte Carlo-mode points: the displayed risk numbers come
// from empirical quadrant counting (GUM-S1) rather than the bivariate-normal
// closed forms derived below, which then serve as the reference model.
const EmpiricalMethodNote = ({ results }) => {
  if (results?.riskMethod !== "empirical") return null;
  return (
    <div
      className="breakdown-step"
      style={{
        border: "1px solid var(--accent-color, #4a90d9)",
        borderRadius: "6px",
        padding: "8px 12px",
        fontSize: "0.88rem",
      }}
    >
      <strong>Method: empirical (GUM-S1 Monte Carlo).</strong> This point's
      risk values are quadrant-counted from the measurement-error distribution
      simulated for this point (seeded, reproducible), not from the
      bivariate-normal integrals shown below. The UUT bias prior is still
      normal (same reliability deconvolution); only the measurement-error
      model is empirical, so the formulas below describe the closed-form
      reference these numbers replace.
    </div>
  );
};

const LegacyMetricBreakdown = ({
  title,
  description,
  value,
  equation,
  status,
}) => (
  <div className="modal-body-scrollable">
    <div className="breakdown-step">
      <h5>What this metric represents</h5>
      <p>{description}</p>
    </div>
    <div className="breakdown-step">
      <h5>Calculation</h5>
      <Latex>{`$$${equation}$$`}</Latex>
      <p>
        <strong>{title}: {safeFixed(value, 4)}%</strong>
      </p>
      {status && <p>Engine status: {status}</p>}
    </div>
  </div>
);

export const ObservedReopBreakdown = ({ results }) => (
  <LegacyMetricBreakdown
    title="Observed reliability"
    description="The probability that the reported measurement passes at the actual test-point TUR. It is the sum of correct accepts and false accepts."
    value={results?.observedReop}
    equation={`R_{obs}=P_{CA}+PFA=\\mathbf{${safePrecision(Number(results?.observedReop) / 100)}}`}
    status={results?.risk8?.out?.statusCore}
  />
);

export const MaxReopBreakdown = ({ results }) => (
  <LegacyMetricBreakdown
    title="Maximum achievable reliability"
    description="The calibration-uncertainty-limited pass probability at the current acceptance limits and test-point TUR."
    value={results?.maxReop}
    equation={`R_{max}=P_{pass}(GB\\mid\\mu_{obs},s_{c,in})=\\mathbf{${safePrecision(Number(results?.maxReop) / 100)}}`}
    status={results?.risk8?.out?.statusCore}
  />
);

export const TrueReopBreakdown = ({ results }) => (
  <LegacyMetricBreakdown
    title="True UUT reliability"
    description="The modeled probability that the true, unobserved UUT value is within specification. It is the sum of correct accepts and false rejects."
    value={results?.trueReop}
    equation={`R_{true}=P_{CA}+PFR=\\mathbf{${safePrecision(Number(results?.trueReop) / 100)}}`}
    status={results?.risk8?.out?.statusCore}
  />
);

export const GBMeasRelBreakdown = ({ results }) => (
  <LegacyMetricBreakdown
    title="Targeted reliability with guardbanding"
    description="The reliability operating point selected jointly with the guardband multiplier to satisfy the mitigation PFA and reliability requirements."
    value={results?.gbMeasRel}
    equation={`R_{GB}^{*}=\\min\\{R:PFA(g^{*},R)\\le PFA_{req},\\;R_{obs}(g^{*},R)\\ge R_{req}\\}=\\mathbf{${safePrecision(Number(results?.gbMeasRel) / 100)}}`}
    status={results?.risk8?.out?.statusMit}
  />
);

export const NoGBPFABreakdown = ({ results }) => (
  <LegacyMetricBreakdown
    title="PFA without guardbanding"
    description="The false-accept probability at the interval-only reliability recommendation. The acceptance limits remain unchanged."
    value={results?.noGbPfa}
    equation={`PFA_{int}=P_{obs}-P_{CA}=\\mathbf{${safePrecision(Number(results?.noGbPfa) / 100)}}`}
    status={results?.risk8?.out?.statusInt}
  />
);

export const NoGBPFRBreakdown = ({ results }) => (
  <LegacyMetricBreakdown
    title="PFR without guardbanding"
    description="The false-reject probability at the interval-only reliability recommendation. The acceptance limits remain unchanged."
    value={results?.noGbPfr}
    equation={`PFR_{int}=P_{true}-P_{CA}=\\mathbf{${safePrecision(Number(results?.noGbPfr) / 100)}}`}
    status={results?.risk8?.out?.statusInt}
  />
);

// ==========================================
// 1. KEY INPUTS BREAKDOWN
// ==========================================
export const InputsBreakdown = ({ results, inputs }) => {
  if (!results || !inputs) return null;

  // Calculate the effective span used by the math engine (centering on tolerance)
  const effectiveHalfSpan = Math.abs(inputs.LUp - inputs.LLow) / 2;

  const safeNativeUnit =
    results.nativeUnit === "%" ? "\\%" : results.nativeUnit || "units";

  const zScore = results.uDev > 0 ? effectiveHalfSpan / results.uDev : 0;
  const reliability = parseFloat(inputs.reliability);
  const p_cumulative = (1 + reliability) / 2;

  return (
    <div className="modal-body-scrollable">
      <div className="breakdown-step">
        <h5>
          Cal Process Error (u<sub>combined</sub>)
        </h5>
        <p>
          This value is the Combined Standard Uncertainty, calculated from the
          detailed budget.
        </p>
        <Latex>
          {`$$ u_{combined} = \\mathbf{${results.uCal.toPrecision(
            6,
          )}} \\text{ ${safeNativeUnit}} $$`}
        </Latex>
      </div>

      <div className="breakdown-step">
        <h5>
          Observed (measured) UUT Error (&sigma;<sub>observed</sub>)
        </h5>
        <p>
          This value is calculated using the Reliability Target (R) and the
          Effective Tolerance Span.
        </p>

        <p>
          <strong>1. Determine Z-Score from Reliability:</strong>
        </p>
        <Latex>
          {`$$ p = (1 + R) / 2 = (1 + ${reliability}) / 2 = \\mathbf{${p_cumulative.toFixed(
            4,
          )}} $$`}
        </Latex>
        <Latex>
          {`$$Z_{\\text{score}} = \\Phi^{-1}(p) = \\mathbf{${zScore.toPrecision(4)}}$$`}
        </Latex>

        <p style={{ marginTop: "10px" }}>
          <strong>2. Determine Effective Half-Span:</strong>
        </p>
        <p style={{ fontSize: "0.9em", color: "var(--text-color-muted)" }}>
          Note: The math engine centers the distribution on the tolerance
          midpoint, using the half-width of the total span.
        </p>
        <Latex>
          {`$$L_{eff} = \\frac{L_{Up} - L_{Low}}{2} = \\frac{${inputs.LUp.toPrecision(6)} - (${inputs.LLow.toPrecision(6)})}{2} = \\mathbf{${effectiveHalfSpan.toPrecision(6)}}$$`}
        </Latex>

        <p style={{ marginTop: "10px" }}>
          <strong>3. Calculate Observed Error:</strong>
        </p>
        <Latex>
          {`$$ \\sigma_{observed} = \\frac{L_{eff}}{Z_{score}} = \\frac{${effectiveHalfSpan.toPrecision(
            6,
          )}}{${zScore.toPrecision(4)}} = \\mathbf{${results.uDev.toPrecision(
            6,
          )}} \\text{ ${safeNativeUnit}} $$`}
        </Latex>
      </div>

      <div className="breakdown-step">
        <h5>
          UUT True Error (&sigma;<sub>uut</sub>)
        </h5>
        <p>
          The intrinsic error of the UUT, calculated by removing the calibration
          process uncertainty from the observed error.
        </p>
        <Latex>
          {`$$ \\sigma_{uut} = \\sqrt{\\sigma_{observed}^2 - u_{combined}^2} = \\sqrt{${results.uDev.toPrecision(
            6,
          )}^2 - ${results.uCal.toPrecision(
            6,
          )}^2} = \\mathbf{${results.uUUT.toPrecision(
            6,
          )}} \\text{ ${safeNativeUnit}} $$`}
        </Latex>
      </div>

      <div className="breakdown-step">
        <h5>UUT Tolerance Limits (L)</h5>
        <p>The specified absolute tolerance limits.</p>
        <Latex>
          {`$$ L_{Low} = \\mathbf{${parseFloat(inputs.LLow).toPrecision(
            6,
          )}} \\text{ ${safeNativeUnit}} $$`}
        </Latex>
        <Latex>
          {`$$ L_{Up} = \\mathbf{${parseFloat(inputs.LUp).toPrecision(
            6,
          )}} \\text{ ${safeNativeUnit}} $$`}
        </Latex>
      </div>

      <div className="breakdown-step">
        <h5>Acceptance Limits (A)</h5>
        <p>
          For Standard Risk Analysis (Non-Guardbanded), the Acceptance Limits
          are equal to the UUT Tolerance Limits.
        </p>
        <Latex>
          {`$$ A_{Low} = L_{Low} = \\mathbf{${results.ALow.toPrecision(
            6,
          )}} \\text{ ${safeNativeUnit}} $$`}
        </Latex>
        <Latex>
          {`$$ A_{Up} = L_{Up} = \\mathbf{${results.AUp.toPrecision(
            6,
          )}} \\text{ ${safeNativeUnit}} $$`}
        </Latex>
        <p
          style={{ fontSize: "0.85rem", fontStyle: "italic", marginTop: "5px" }}
        >
          Note: To see limits adjusted for Guardbanding, view the
          &quot;Guardband Analysis&quot; breakdowns.
        </p>
      </div>

      <div className="breakdown-step">
        <h5>Correlation (ρ)</h5>
        <p>
          The statistical correlation between the UUT&apos;s true error value
          and the observed (measured) value.
        </p>
        <Latex>
          {`$$ \\rho = \\frac{\\sigma_{UUT}}{\\sigma_{observed}} = \\frac{${results.uUUT.toPrecision(
            6,
          )}}{${results.uDev.toPrecision(
            6,
          )}} = \\mathbf{${results.correlation.toPrecision(6)}} $$`}
        </Latex>
      </div>
    </div>
  );
};

// ==========================================
// 2. TUR BREAKDOWN
// ==========================================
export const TurBreakdown = ({ results, inputs }) => {
  if (!results || !inputs) return null;

  const safeNativeUnit =
    results.nativeUnit === "%" ? "\\%" : results.nativeUnit || "units";
  const uutToleranceSpan = inputs.LUp - inputs.LLow;
  const expandedUncertaintySpan = results.expandedUncertainty * 2;

  return (
    <div className="modal-body-scrollable">
      <EmpiricalMethodNote results={results} />
      <div className="breakdown-step">
        <h5>Step 1: Formula</h5>
        <p>
          The Test Uncertainty Ratio (TUR) is the ratio of the tolerance span to
          the expanded measurement uncertainty span.
        </p>
        <Latex>
          {
            "$$ TUR = \\frac{\\text{UUT Tolerance Span}}{\\text{Expanded Measurement Uncertainty Span}} = \\frac{2L}{2U} $$"
          }
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>Step 2: Inputs</h5>
        <ul>
          <li>
            Tolerance Span (2L):{" "}
            <Latex>{`$$ L_{Upper} - L_{Lower} = ${inputs.LUp.toPrecision(
              6,
            )} - (${inputs.LLow.toPrecision(
              6,
            )}) = ${uutToleranceSpan.toPrecision(
              4,
            )} \\text{ ${safeNativeUnit}} $$`}</Latex>
          </li>
          <li>
            Expanded Uncertainty Span (2U):{" "}
            <Latex>{`$$ 2 \\times U_{95} = 2 \\times ${results.expandedUncertainty.toPrecision(
              4,
            )} = \\mathbf{${expandedUncertaintySpan.toPrecision(
              4,
            )}} \\text{ ${safeNativeUnit}} $$`}</Latex>
          </li>
        </ul>
      </div>
      <div className="breakdown-step">
        <h5>Step 3: Final Calculation</h5>
        <Latex>{`$$ TUR = \\frac{${uutToleranceSpan.toPrecision(
          4,
        )}}{${expandedUncertaintySpan.toPrecision(
          4,
        )}} = \\mathbf{${results.tur.toFixed(4)}:1} $$`}</Latex>
      </div>
    </div>
  );
};

// ==========================================
// 3. TAR BREAKDOWN
// ==========================================
export const TarBreakdown = ({ results, inputs }) => {
  if (!results || !inputs) return null;

  const uutToleranceHigh = inputs.LUp;
  const uutToleranceLow = inputs.LLow;
  const uutToleranceSpan = uutToleranceHigh - uutToleranceLow;
  const uutNominalMid = (uutToleranceHigh + uutToleranceLow) / 2;

  const tmdeToleranceHighDev = results.tmdeToleranceHigh || 0;
  const tmdeToleranceLowDev = results.tmdeToleranceLow || 0;

  // The TMDE tolerance band must be centered on the TMDE's nominal value (the
  // same anchor calcTAR uses), not on the UUT acceptance-band midpoint. The
  // midpoint can drift off-nominal when the UUT tolerance is asymmetric or
  // snapped to resolution, which would shift the displayed span (e.g. showing
  // 19.93–19.97 instead of 19.98–20.02 for a 0.1%-of-reading spec at 20).
  const tmdeNominal = Number.isFinite(results.nominalValue)
    ? results.nominalValue
    : uutNominalMid;
  const tmdeToleranceHigh_Absolute = tmdeNominal + tmdeToleranceHighDev;
  const tmdeToleranceLow_Absolute = tmdeNominal + tmdeToleranceLowDev;

  const tmdeToleranceSpan = results.tmdeToleranceSpan;

  const uutBreakdown = results.uutBreakdownForTar || [];
  const tmdeBreakdown = results.tmdeBreakdownForTar || [];

  const safeNativeUnit =
    results.nativeUnit === "%" ? "\\%" : results.nativeUnit || "units";

  const uutSumString =
    uutBreakdown.length > 0
      ? uutBreakdown.map((comp) => comp.span.toPrecision(4)).join(" + ")
      : "0";
  const tmdeSumString =
    tmdeBreakdown.length > 0
      ? tmdeBreakdown.map((comp) => comp.span.toPrecision(4)).join(" + ")
      : "0";

  return (
    <div className="modal-body-scrollable">
      <div className="breakdown-step">
        <h5>Step 1: Formula</h5>
        <p>
          The Test Accuracy Ratio (TAR) is the ratio of the UUT&apos;s tolerance
          span to the TMDE&apos;s (Standard&apos;s) tolerance span.
        </p>
        <Latex>
          {
            "$$ TAR = \\frac{\\text{(UUT Tolerance High)} - \\text{(UUT Tolerance Low)}}{\\text{(TMDE Tolerance High)} - \\text{(TMDE Tolerance Low)}} $$"
          }
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>Step 2: Inputs</h5>
        <ul>
          <li>
            UUT Tolerance Span (Absolute Limits):
            <Latex>{`$$ (L_{Up}) - (L_{Low}) = ${uutToleranceHigh.toPrecision(
              6,
            )} - (${uutToleranceLow.toPrecision(6)}) $$`}</Latex>
            {uutBreakdown.length > 0 ? (
              <ul
                className="result-breakdown"
                style={{
                  paddingLeft: "20px",
                  fontSize: "0.9rem",
                  margin: "5px 0",
                }}
              >
                {uutBreakdown.map((comp, index) => (
                  <li key={index} style={{ border: "none", padding: "2px 0" }}>
                    <span className="label">{comp.name}</span>
                    <span className="value">
                      {comp.span.toPrecision(4)} {safeNativeUnit}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <em style={{ display: "block", margin: "5px 0" }}>
                (No UUT tolerance components found)
              </em>
            )}
            <Latex>{`$$ \\text{Total Span} = ${uutSumString} = \\mathbf{${uutToleranceSpan.toPrecision(
              4,
            )}} \\text{ ${safeNativeUnit}} $$`}</Latex>
          </li>

          <li>
            TMDE Tolerance Span (Absolute Limits):
            <Latex>{`$$ (L_{Up}) - (L_{Low}) = ${tmdeToleranceHigh_Absolute.toPrecision(
              6,
            )} - (${tmdeToleranceLow_Absolute.toPrecision(6)}) $$`}</Latex>
            {tmdeBreakdown.length > 0 ? (
              <ul
                className="result-breakdown"
                style={{
                  paddingLeft: "20px",
                  fontSize: "0.9rem",
                  margin: "5px 0",
                }}
              >
                {tmdeBreakdown.map((comp, index) => (
                  <li key={index} style={{ border: "none", padding: "2px 0" }}>
                    <span className="label">{comp.name}</span>
                    <span className="value">
                      {comp.span.toPrecision(4)} {safeNativeUnit}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <em style={{ display: "block", margin: "5px 0" }}>
                (No TMDE tolerances found)
              </em>
            )}
            <Latex>{`$$ \\text{Total Span} = ${tmdeSumString} = \\mathbf{${tmdeToleranceSpan.toPrecision(
              4,
            )}} \\text{ ${safeNativeUnit}} $$`}</Latex>
          </li>
        </ul>
      </div>
      <div className="breakdown-step">
        <h5>Step 3: Final Calculation</h5>
        <Latex>{`$$ TAR = \\frac{${uutToleranceSpan.toPrecision(
          4,
        )}}{${tmdeToleranceSpan.toPrecision(
          4,
        )}} = \\mathbf{${results.tar.toFixed(4)}:1} $$`}</Latex>
      </div>
    </div>
  );
};

// ==========================================
// 4. PFA BREAKDOWN
// ==========================================
export const PfaBreakdown = ({ results, inputs }) => {
  if (!results || !inputs) return null;

  const mid = (inputs.LUp + inputs.LLow) / 2;
  const LLow_norm = inputs.LLow - mid;
  const LUp_norm = inputs.LUp - mid;
  const ALow_norm = results.ALow - mid;
  const AUp_norm = results.AUp - mid;

  // Z-Scores (Normalized Limits) - use safe defaults to avoid division by zero
  const uUUT_safe = results.uUUT || 1;
  const uDev_safe = results.uDev || 1;
  const z_x_low = LLow_norm / uUUT_safe;
  const z_x_high = LUp_norm / uUUT_safe;
  const z_y_low = ALow_norm / uDev_safe;
  const z_y_high = AUp_norm / uDev_safe;

  // --- Calc variables for Observed Error breakdown ---
  const effectiveHalfSpan = Math.abs(inputs.LUp - inputs.LLow) / 2;
  const reliability = parseFloat(inputs.reliability);
  const zScoreObs = results.uDev > 0 ? effectiveHalfSpan / results.uDev : 0;

  const safeNativeUnit =
    results.nativeUnit === "%" ? "\\%" : results.nativeUnit || "units";

  return (
    <div className="modal-body-scrollable">
      <EmpiricalMethodNote results={results} />
      <div className="breakdown-step">
        <h5>Step 1: Formula</h5>
        <p>
          The Probability of False Accept (PFA) is the sum of the probabilities
          in the two &quot;False Accept&quot; regions of the risk scatterplot.
          This is calculated using the Bivariate Normal Cumulative Distribution
          Function (Φ₂).
        </p>
        <Latex>{"$$PFA = PFA_{Lower} + PFA_{Upper}$$"}</Latex>
      </div>
      <div className="breakdown-step">
        <h5>Step 2: Key Statistical Inputs</h5>
        <p>
          These values are derived from your budget and reliability settings.
        </p>
        <ul>
          <li>
            True UUT Error (σ<sub>uut</sub>):{" "}
            <strong>
              {safePrecision(results.uUUT, 4)} {safeNativeUnit}
            </strong>
            <Latex>{`$$\\sigma_{uut} = \\sqrt{\\sigma_{observed}^2 - u_{combined}^2}$$`}</Latex>
          </li>
          <li>
            <div style={{ marginBottom: "5px" }}>
              Observed Error (σ<sub>obs</sub>):{" "}
              <strong>
                {safePrecision(results.uDev, 4)} {safeNativeUnit}
              </strong>
            </div>
            <Latex>{`$$ L_{eff} = \\frac{L_{Up} - L_{Low}}{2} = ${safePrecision(effectiveHalfSpan, 4)} $$`}</Latex>
            <Latex>{`$$ Z_{score} = \\Phi^{-1}(\\frac{1+${reliability}}{2}) = ${safePrecision(zScoreObs, 4)} $$`}</Latex>
            <Latex>{`$$\\sigma_{observed} = \\frac{L_{eff}}{Z_{score}} = \\frac{${safePrecision(effectiveHalfSpan, 4)}}{${safePrecision(zScoreObs, 4)}} = \\mathbf{${safePrecision(results.uDev, 4)}}$$`}</Latex>
          </li>
          <li>
            Correlation (ρ):{" "}
            <Latex>{`$$ \\rho = \\frac{\\sigma_{uut}}{\\sigma_{obs}} = \\frac{${safePrecision(
              results.uUUT,
              4,
            )}}{${safePrecision(
              results.uDev,
              4,
            )}} = \\mathbf{${safeFixed(results.correlation, 4)}} $$`}</Latex>
          </li>
        </ul>
      </div>
      <div className="breakdown-step">
        <h5>Step 3: Normalized Limits (Z-Scores)</h5>
        <p>
          The limits are normalized by their respective standard deviations. (L
          = UUT Tolerance, A = Acceptance Limit)
        </p>
        <ul>
          <li>
            z<sub>x_low</sub> (True Error):{" "}
            <Latex>{`$$ \\frac{L_{Low}}{\\sigma_{uut}} = \\frac{${safePrecision(
              LLow_norm,
              4,
            )}}{${safePrecision(
              results.uUUT,
              4,
            )}} = \\mathbf{${safeFixed(z_x_low, 4)}} $$`}</Latex>
          </li>
          <li>
            z<sub>x_high</sub> (True Error):{" "}
            <Latex>{`$$ \\frac{L_{Up}}{\\sigma_{uut}} = \\frac{${safePrecision(
              LUp_norm,
              4,
            )}}{${safePrecision(
              results.uUUT,
              4,
            )}} = \\mathbf{${safeFixed(z_x_high, 4)}} $$`}</Latex>
          </li>
          <li>
            z<sub>y_low</sub> (Measured Error):{" "}
            <Latex>{`$$ \\frac{A_{Low}}{\\sigma_{obs}} = \\frac{${safePrecision(
              ALow_norm,
              4,
            )}}{${safePrecision(
              results.uDev,
              4,
            )}} = \\mathbf{${safeFixed(z_y_low, 4)}} $$`}</Latex>
          </li>
          <li>
            z<sub>y_high</sub> (Measured Error):{" "}
            <Latex>{`$$ \\frac{A_{Up}}{\\sigma_{obs}} = \\frac{${safePrecision(
              AUp_norm,
              4,
            )}}{${safePrecision(
              results.uDev,
              4,
            )}} = \\mathbf{${safeFixed(z_y_high, 4)}} $$`}</Latex>
          </li>
        </ul>
      </div>
      <div className="breakdown-step">
        <h5>Step 4: Bivariate Calculation</h5>
        <p>The probability for each tail (region) is calculated separately.</p>
        <p>
          <strong>Lower Tail Risk (PFA_Lower):</strong>
        </p>
        <Latex>
          {
            "$$P(z_x < z_{x\\_low} \\text{ and } z_{y\\_low} < z_y < z_{y\\_high})$$"
          }
        </Latex>
        <Latex>{`$$= \\Phi_2(z_{x\\_low}, z_{y\\_high}, \\rho) - \\Phi_2(z_{x\\_low}, z_{y\\_low}, \\rho)$$`}</Latex>
        <Latex>{`$$ = \\Phi_2(${safeFixed(z_x_low, 2)}, ${safeFixed(
          z_y_high,
          2,
        )}, ${safeFixed(results.correlation, 2)}) - \\Phi_2(${safeFixed(
          z_x_low,
          2,
        )}, ${safeFixed(z_y_low, 2)}, ${safeFixed(
          results.correlation,
          2,
        )}) $$`}</Latex>
        <Latex>{`$$ = \\mathbf{${safeExponential(
          results.pfa_term1 / 100,
          4,
        )}} $$`}</Latex>
        <p>
          <strong>Upper Tail Risk (PFA_Upper):</strong>
        </p>
        <Latex>
          {
            "$$P(z_x > z_{x\\_high} \\text{ and } z_{y\\_low} < z_y < z_{y\\_high})$$"
          }
        </Latex>
        <p>
          Calculated using symmetry:{" "}
          <Latex>{`$$= P(z_x < -z_{x\\_high} \\text{ and } -z_{y\\_high} < z_y < -z_{y\\_low})$$ `}</Latex>
        </p>
        <Latex>{`$$= \\Phi_2(-z_{x\\_high}, -z_{y\\_low}, \\rho) - \\Phi_2(-z_{x\\_high}, -z_{y\\_high}, \\rho)$$`}</Latex>
        <Latex>{`$$ = \\Phi_2(${safeFixed(-z_x_high, 2)}, ${safeFixed(
          -z_y_low,
          2,
        )}, ${safeFixed(
          results.correlation,
          2,
        )}) - \\Phi_2(${safeFixed(-z_x_high, 2)}, ${safeFixed(
          -z_y_high,
          2,
        )}, ${safeFixed(results.correlation, 2)}) $$`}</Latex>
        <Latex>{`$$ = \\mathbf{${safeExponential(
          results.pfa_term2 / 100,
          4,
        )}} $$`}</Latex>
      </div>
      <div className="breakdown-step">
        <h5>Step 5: Final PFA</h5>
        <Latex>{`$$PFA = PFA_{Lower} + PFA_{Upper}$$`}</Latex>
        <Latex>{`$$ = ${safeExponential(results.pfa_term1 / 100, 4)} + ${safeExponential(
          results.pfa_term2 / 100,
          4,
        )} = \\mathbf{${safeExponential(results.pfa / 100, 4)}} $$`}</Latex>
        <Latex>{`$$ \\text{Total PFA} = \\mathbf{${safeFixed(
          results.pfa,
          4,
        )}\\%} $$`}</Latex>
      </div>
    </div>
  );
};

// ==========================================
// 5. PFR BREAKDOWN
// ==========================================
export const PfrBreakdown = ({ results, inputs }) => {
  if (!results || !inputs) return null;

  const mid = (inputs.LUp + inputs.LLow) / 2;
  const LLow_norm = inputs.LLow - mid;
  const LUp_norm = inputs.LUp - mid;
  const ALow_norm = results.ALow - mid;
  const AUp_norm = results.AUp - mid;

  // Z-Scores (Normalized Limits)
  const z_x_low = LLow_norm / results.uUUT;
  const z_x_high = LUp_norm / results.uUUT;
  const z_y_low = ALow_norm / results.uDev;
  const z_y_high = AUp_norm / results.uDev;

  // --- Calc variables for Observed Error breakdown ---
  const effectiveHalfSpan = Math.abs(inputs.LUp - inputs.LLow) / 2;
  const reliability = parseFloat(inputs.reliability);
  const zScoreObs = results.uDev > 0 ? effectiveHalfSpan / results.uDev : 0;

  const safeNativeUnit =
    results.nativeUnit === "%" ? "\\%" : results.nativeUnit || "units";

  return (
    <div className="modal-body-scrollable">
      <EmpiricalMethodNote results={results} />
      <div className="breakdown-step">
        <h5>Step 1: Formula</h5>
        <p>
          The Probability of False Reject (PFR) is the sum of the probabilities
          in the two &quot;False Reject&quot; regions of the risk scatterplot.
          This is calculated using the Bivariate Normal Cumulative Distribution
          Function (Φ₂).
        </p>
        <Latex>{"$$PFR = PFR_{Lower} + PFR_{Upper}$$"}</Latex>
        <Latex>
          {
            "$$PFR_{Lower} = P(L_{Low} < \\text{True} < L_{Up} \\text{ and Measured} < A_{Low})$$"
          }
        </Latex>
        <Latex>
          {
            "$$PFR_{Upper} = P(L_{Low} < \\text{True} < L_{Up} \\text{ and Measured} > A_{Up})$$"
          }
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>Step 2: Key Statistical Inputs</h5>
        <p>
          These values are derived from your budget and reliability settings.
        </p>
        <ul>
          <li>
            True UUT Error (σ<sub>uut</sub>):{" "}
            <strong>
              {results.uUUT.toPrecision(4)} {safeNativeUnit}
            </strong>
            <Latex>{`$$\\sigma_{uut} = \\sqrt{\\sigma_{observed}^2 - u_{combined}^2}$$`}</Latex>
          </li>
          <li>
            <div style={{ marginBottom: "5px" }}>
              Observed Error (σ<sub>obs</sub>):{" "}
              <strong>
                {results.uDev.toPrecision(4)} {safeNativeUnit}
              </strong>
            </div>
            <Latex>{`$$ L_{eff} = \\frac{L_{Up} - L_{Low}}{2} = ${effectiveHalfSpan.toPrecision(4)} $$`}</Latex>
            <Latex>{`$$ Z_{score} = \\Phi^{-1}(\\frac{1+${reliability}}{2}) = ${zScoreObs.toPrecision(4)} $$`}</Latex>
            <Latex>{`$$\\sigma_{observed} = \\frac{L_{eff}}{Z_{score}} = \\frac{${effectiveHalfSpan.toPrecision(4)}}{${zScoreObs.toPrecision(4)}} = \\mathbf{${results.uDev.toPrecision(4)}}$$`}</Latex>
          </li>
          <li>
            Correlation (ρ):{" "}
            <Latex>{`$$ \\rho = \\frac{\\sigma_{uut}}{\\sigma_{obs}} = \\frac{${results.uUUT.toPrecision(
              4,
            )}}{${results.uDev.toPrecision(
              4,
            )}} = \\mathbf{${results.correlation.toFixed(4)}} $$`}</Latex>
          </li>
        </ul>
      </div>
      <div className="breakdown-step">
        <h5>Step 3: Normalized Limits (Z-Scores)</h5>
        <p>
          The limits are normalized by their respective standard deviations. (L
          = UUT Tolerance, A = Acceptance Limit)
        </p>
        <ul>
          <li>
            z<sub>x_low</sub> (True Error):{" "}
            <Latex>{`$$ \\frac{L_{Low}}{\\sigma_{uut}} = \\frac{${LLow_norm.toPrecision(
              4,
            )}}{${results.uUUT.toPrecision(
              4,
            )}} = \\mathbf{${z_x_low.toFixed(4)}} $$`}</Latex>
          </li>
          <li>
            z<sub>x_high</sub> (True Error):{" "}
            <Latex>{`$$ \\frac{L_{Up}}{\\sigma_{uut}} = \\frac{${LUp_norm.toPrecision(
              4,
            )}}{${results.uUUT.toPrecision(
              4,
            )}} = \\mathbf{${z_x_high.toFixed(4)}} $$`}</Latex>
          </li>
          <li>
            z<sub>y_low</sub> (Measured Error):{" "}
            <Latex>{`$$ \\frac{A_{Low}}{\\sigma_{obs}} = \\frac{${ALow_norm.toPrecision(
              4,
            )}}{${results.uDev.toPrecision(
              4,
            )}} = \\mathbf{${z_y_low.toFixed(4)}} $$`}</Latex>
          </li>
          <li>
            z<sub>y_high</sub> (Measured Error):{" "}
            <Latex>{`$$ \\frac{A_{Up}}{\\sigma_{obs}} = \\frac{${AUp_norm.toPrecision(
              4,
            )}}{${results.uDev.toPrecision(
              4,
            )}} = \\mathbf{${z_y_high.toFixed(4)}} $$`}</Latex>
          </li>
        </ul>
      </div>
      <div className="breakdown-step">
        <h5>Step 4: Bivariate Calculation</h5>
        <p>The probability for each side (region) is calculated separately.</p>
        <p>
          <strong>Lower Side Risk (PFR_Lower):</strong>
        </p>
        <Latex>
          {
            "$$P(z_{x\\_low} < z_x < z_{x\\_high} \\text{ and } z_y < z_{y\\_low})$$"
          }
        </Latex>
        <Latex>{`$$= \\Phi_2(z_{x\\_high}, z_{y\\_low}, \\rho) - \\Phi_2(z_{x\\_low}, z_{y\\_low}, \\rho)$$`}</Latex>
        <Latex>{`$$ = \\Phi_2(${z_x_high.toFixed(2)}, ${z_y_low.toFixed(
          2,
        )}, ${results.correlation.toFixed(2)}) - \\Phi_2(${z_x_low.toFixed(
          2,
        )}, ${z_y_low.toFixed(2)}, ${results.correlation.toFixed(
          2,
        )}) $$`}</Latex>
        <Latex>{`$$ = \\mathbf{${(results.pfr_term1 / 100).toExponential(
          4,
        )}} $$`}</Latex>
        <p>
          <strong>Upper Side Risk (PFR_Upper):</strong>
        </p>
        <Latex>
          {
            "$$P(z_{x\\_low} < z_x < z_{x\\_high} \\text{ and } z_y > z_{y\\_high})$$"
          }
        </Latex>
        <p>
          Calculated using symmetry:{" "}
          <Latex>{`$$= P(-z_{x\\_high} < z_x < -z_{x\\_low} \\text{ and } z_y < -z_{y\\_high})$$ `}</Latex>
        </p>
        <Latex>{`$$= \\Phi_2(-z_{x\\_low}, -z_{y\\_high}, \\rho) - \\Phi_2(-z_{x\\_high}, -z_{y\\_high}, \\rho)$$`}</Latex>
        <Latex>{`$$ = \\Phi_2(${-z_x_low.toFixed(2)}, ${-z_y_high.toFixed(
          2,
        )}, ${results.correlation.toFixed(
          2,
        )}) - \\Phi_2(${-z_x_high.toFixed(2)}, ${-z_y_high.toFixed(
          2,
        )}, ${results.correlation.toFixed(2)}) $$`}</Latex>
        <Latex>{`$$ = \\mathbf{${(results.pfr_term2 / 100).toExponential(
          4,
        )}} $$`}</Latex>
      </div>
      <div className="breakdown-step">
        <h5>Step 5: Final PFR</h5>
        <Latex>{`$$PFR = PFR_{Lower} + PFR_{Upper}$$`}</Latex>
        <Latex>{`$$ = ${(results.pfr_term1 / 100).toExponential(4)} + ${(
          results.pfr_term2 / 100
        ).toExponential(4)} = \\mathbf{${(results.pfr / 100).toExponential(
          4,
        )}} $$`}</Latex>
        <Latex>{`$$ \\text{Total PFR} = \\mathbf{${results.pfr.toFixed(
          4,
        )}\\%} $$`}</Latex>
      </div>
    </div>
  );
};

// ==========================================
// 6. GUARDBAND BREAKDOWNS (Individual Exports)
// ==========================================
export const GBInputsBreakdown = ({ inputs, results }) => {
  if (!results || !inputs) return null;
  return (
    <div className="modal-body-scrollable">
      <>
        <div className="breakdown-step">
          <h5>Uncertainty Requirements</h5>
          <p>
            These values are uncertainty requirements set on the Uncertalytics.
          </p>
          <Latex>{`$$ Measurement\\ Reliability\\ Target = \\mathbf{${
            inputs.guardBandInputs.measRelTarget * 100
          }}\\% $$`}</Latex>
          <Latex>{`$$ Measurement\\ Reliability\\ Calculated\\ Assumed = \\mathbf{${
            inputs.guardBandInputs.measrelCalcAssumed * 100
          }}\\% $$`}</Latex>
          <Latex>{`$$ PFA\\ Required = \\mathbf{${
            inputs.guardBandInputs.reqPFA * 100
          }}\\% $$`}</Latex>
          <Latex>{`$$ TUR\\ Required = \\mathbf{${inputs.guardBandInputs.reqTUR}} $$`}</Latex>
          <Latex>{`$$ Calibration\\ Interval = \\mathbf{${inputs.guardBandInputs.calibrationInt}} $$`}</Latex>
        </div>

        <div className="breakdown-step">
          <h5>Calculated TUR Value</h5>
          <p>
            The Test Uncertainty Ratio (TUR) is the ratio of the tolerance span
            to the expanded measurement uncertainty span.
          </p>
          <Latex>{`$$ TUR = \\mathbf{${inputs.guardBandInputs.turVal.toFixed(4)}:1} $$`}</Latex>
        </div>

        <div className="breakdown-step">
          <h5>
            Cal Process Error (u<sub>combined</sub>)
          </h5>
          <p>
            This value is the Combined Standard Uncertainty, calculated from the
            detailed budget.
          </p>
          <Latex>
            {`$$ u_{combined} = \\mathbf{${inputs.guardBandInputs.combUnc.toPrecision(
              6,
            )}} \\text{ ${inputs.guardBandInputs.nominalUnit}} $$`}
          </Latex>
        </div>

        <div className="breakdown-step">
          <h5>Nominal Value</h5>
          <p>The is the current measurement point.</p>
          <Latex>
            {`$$ Nominal = \\mathbf{${parseFloat(
              inputs.guardBandInputs.nominal,
            ).toPrecision(
              6,
            )}} \\text{ ${inputs.guardBandInputs.nominalUnit}} $$`}
          </Latex>
        </div>

        <div className="breakdown-step">
          <h5>UUT Tolerance Limits</h5>
          <p>The specified tolerance limits for the Unit Under Test (UUT).</p>
          <Latex>
            {`$$ Lower = \\mathbf{${parseFloat(
              inputs.guardBandInputs.uutLower,
            ).toPrecision(
              6,
            )}} \\text{ ${inputs.guardBandInputs.nominalUnit}} $$`}
          </Latex>
          <Latex>
            {`$$ Upper = \\mathbf{${parseFloat(
              inputs.guardBandInputs.uutUpper,
            ).toPrecision(
              6,
            )}} \\text{ ${inputs.guardBandInputs.nominalUnit}} $$`}
          </Latex>
        </div>

        <div className="breakdown-step">
          <h5>TMDE Tolerance Limits</h5>
          <p>
            The specified tolerance limits for the Test, Measurement, and
            Diagnostic Equipment (TMDE).
          </p>
          <Latex>
            {`$$ Lower = \\mathbf{${parseFloat(
              inputs.guardBandInputs.tmdeLower,
            ).toPrecision(
              6,
            )}} \\text{ ${inputs.guardBandInputs.nominalUnit}} $$`}
          </Latex>
          <Latex>
            {`$$ Upper = \\mathbf{${parseFloat(
              inputs.guardBandInputs.tmdeUpper,
            ).toPrecision(
              6,
            )}} \\text{ ${inputs.guardBandInputs.nominalUnit}} $$`}
          </Latex>
        </div>
      </>
    </div>
  );
};

export const GBLowBreakdown = ({ inputs, results }) => {
  if (!results || !inputs) return null;
  return (
    <div className="modal-body-scrollable">
      <div className="breakdown-step">
        <h5>Step 1: Formula</h5>
        <p>
          The Lower Guardband Tolerance (GB Low) is the product of the UUT Lower
          Tolerance times the Guardband Multiplier. Acceptance Tolerance are
          lowered to meet the required PFA in the cases that the PFA is above
          the {(inputs.reqPFA ?? 0) * 100}% PFA threshold.
        </p>
        <Latex>
          {"$$ GB_{LOW} = (L_{Lower} * GB_{MULTIPLIER}) + \\text{Nominal} $$"}
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>Step 2: Guardband Multiplier Calculation</h5>
        <p>
          Guardband Multiplier is calculated first to get our GB LOW and HIGH
          values. We recalculate the exact same PFA, but instead our acceptance
          limits are changed. GB Multiplier is initally 1 and decrements by 0.05
          recalculating PFA each time until PFA is equal to the required{" "}
          {results.gbInputs.reqPFA * 100}% PFA.
        </p>
      </div>
      <div className="breakdown-step">
        <h5>Step 3: Guardband Low Value</h5>
        <Latex>{`$$\\text{Calculated Guardband Multiplier} = ${results.gbResults.GBLOWMULT} \\\\
        = ${results.gbResults.GBLOWMULT} \\cdot ${inputs.LLow - inputs.guardBandInputs.nominal} \\\\
        = ${results.gbResults.GBLOWMULT * (inputs.LLow - inputs.guardBandInputs.nominal)} + ${inputs.guardBandInputs.nominal} \\\\
        = ${results.gbResults.GBLOWMULT * (inputs.LLow - inputs.guardBandInputs.nominal) + inputs.guardBandInputs.nominal} \\\\
        = \\text{ResDwn}(${results.gbResults.GBLOWMULT * (inputs.LLow - inputs.guardBandInputs.nominal) + inputs.guardBandInputs.nominal}) \\\\
        = ${resDwn(results.gbResults.GBLOWMULT * (inputs.LLow - inputs.guardBandInputs.nominal) + inputs.guardBandInputs.nominal, inputs.guardBandInputs.safeRes)}
        $$`}</Latex>
      </div>
      <div className="breakdown-step">
        <h5>
          Question: Why is this calculated Guard Band Multipler not the same as
          our final results?
        </h5>
        <p>
          Our GB Low value is rounded up to the nearest measuring resolutions
          place.
        </p>
      </div>
    </div>
  );
};

export const GBHighBreakdown = ({ inputs, results }) => {
  if (!results || !inputs) return null;
  return (
    <div className="modal-body-scrollable">
      <div className="breakdown-step">
        <h5>Step 1: Formula</h5>
        <p>
          The Upper Guardband Tolerance (GB Up) is the product of the UUT Upper
          Tolerance times the Guardband Multiplier. Acceptance Tolerance are
          lowered to meet the required PFA in the cases that the PFA is above
          the {(inputs.reqPFA ?? 0) * 100}% PFA threshold.
        </p>
        <Latex>
          {"$$ GB_{Up} = (L_{Up} * GB_{MULTIPLIER}) + \\text{Nominal} $$"}
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>Step 2: Guardband Multiplier Calculation</h5>
        <p>
          Guardband Multiplier is calculated first to get our GB LOW and HIGH
          values. We recalculate the exact same PFA, but instead our acceptance
          limits are changed. GB Multiplier is initally 1 and decrements by 0.05
          recalculating PFA each time until PFA is equal to the required{" "}
          {results.gbInputs.reqPFA * 100}% PFA.
        </p>
      </div>
      <div className="breakdown-step">
        <h5>Step 3: Guardband Up Value</h5>
        <Latex>{`$$\\text{Calculated Guardband Multiplier} = ${results.gbResults.GBLOWMULT} \\\\
        = ${results.gbResults.GBUPMULT} \\cdot ${inputs.LUp - inputs.guardBandInputs.nominal} \\\\
        = ${results.gbResults.GBUPMULT * (inputs.LUp - inputs.guardBandInputs.nominal)} + ${inputs.guardBandInputs.nominal} \\\\
        = ${results.gbResults.GBUPMULT * (inputs.LUp - inputs.guardBandInputs.nominal) + inputs.guardBandInputs.nominal} \\\\
        = \\text{ResUp}(${results.gbResults.GBUPMULT * (inputs.LUp - inputs.guardBandInputs.nominal) + inputs.guardBandInputs.nominal}) \\\\
        = ${resUp(results.gbResults.GBUPMULT * (inputs.LUp - inputs.guardBandInputs.nominal) + inputs.guardBandInputs.nominal, inputs.guardBandInputs.safeRes)}
        $$`}</Latex>
      </div>
      <div className="breakdown-step">
        <h5>
          Question: Why is this calculated Guard Band Multipler not the same as
          our final results?
        </h5>
        <p>
          Our GB Upper value is rounded down to the nearest measuring
          resolutions place.
        </p>
      </div>
    </div>
  );
};

export const GBPFABreakdown = ({ inputs, results }) => {
  if (!results || !inputs) return null;

  const gb = results.gbResults || {};
  const hasLegacyIntermediates = [
    gb.GBUP,
    gb.GBLOW,
    gb.GBPFAUUUT,
    gb.GBPFAUDEV,
    gb.GBPFACOR,
    gb.GBPFAT1,
    gb.GBPFAT2,
    gb.GBPFA,
  ].every((value) => Number.isFinite(Number(value)));
  if (!hasLegacyIntermediates) {
    return (
      <LegacyMetricBreakdown
        title="PFA with guardbanding"
        description="The false-accept probability evaluated at the recommended guardband and reliability operating point. Detailed legacy bivariate intermediates were not stored for this point, so the current engine result is shown safely."
        value={results.gbPfa ?? gb.GBPFA}
        equation={`PFA_{GB}=P_{obs,GB}-P_{CA,GB}=\\mathbf{${safePrecision(((results.gbPfa ?? gb.GBPFA) || 0) / 100)}}`}
        status={results?.risk8?.out?.statusMit}
      />
    );
  }

  // Use Guardband Limits for Normalization in this Breakdown
  const mid = (results.gbResults.GBUP + results.gbResults.GBLOW) / 2;
  const LLow_norm = inputs.LLow - mid;
  const LUp_norm = inputs.LUp - mid;
  const ALow_norm = results.gbResults.GBLOW - mid;
  const AUp_norm = results.gbResults.GBUP - mid;

  const z_x_low = LLow_norm / results.gbResults.GBPFAUUUT;
  const z_x_high = LUp_norm / results.gbResults.GBPFAUUUT;
  const z_y_low = ALow_norm / results.gbResults.GBPFAUDEV;
  const z_y_high = AUp_norm / results.gbResults.GBPFAUDEV;

  // Calculate effective half-span using GUARDBAND limits
  // This matches the math engine's basis for the GB sigma_obs calculation
  const effectiveHalfSpan =
    Math.abs(results.gbResults.GBUP - results.gbResults.GBLOW) / 2;
  const reliability = parseFloat(inputs.reliability);
  const zScoreObs =
    results.gbResults.GBPFAUDEV > 0
      ? effectiveHalfSpan / results.gbResults.GBPFAUDEV
      : 0;

  const safeNativeUnit =
    results.nativeUnit === "%" ? "\\%" : results.nativeUnit || "units";

  return (
    <div className="modal-body-scrollable">
      <EmpiricalMethodNote results={results} />
      <div className="breakdown-step">
        <h5>Step 1: Formula</h5>
        <p>
          The Probability of False Accept (PFA) with Guardband uses the{" "}
          <strong>Guardband Limits</strong> as the basis for calculating the
          observed process error.
        </p>
        <Latex>{"$$PFA = PFA_{Lower} + PFA_{Upper}$$"}</Latex>
      </div>
      <div className="breakdown-step">
        <h5>Step 2: Key Statistical Inputs</h5>
        <p>
          These values are derived from your budget and reliability settings.
        </p>
        <ul>
          <li>
            True UUT Error (σ<sub>uut</sub>):{" "}
            <strong>
              {results.gbResults.GBPFAUUUT.toPrecision(4)} {safeNativeUnit}
            </strong>
          </li>
          <li>
            <div style={{ marginBottom: "5px" }}>
              Observed Error (σ<sub>obs</sub>):{" "}
              <strong>
                {results.gbResults.GBPFAUDEV.toPrecision(4)} {safeNativeUnit}
              </strong>
            </div>
            <p style={{ fontSize: "0.9em", color: "var(--text-color-muted)" }}>
              For Guardband PFA, sigma is derived using the Guardband Span:
            </p>
            <Latex>{`$$L_{eff(GB)} = \\frac{GB_{Up} - GB_{Low}}{2} = ${effectiveHalfSpan.toPrecision(4)}$$`}</Latex>
            <Latex>{`$$Z_{score} = \\Phi^{-1}(\\frac{1+${reliability}}{2}) = ${zScoreObs.toPrecision(4)}$$`}</Latex>
            <Latex>{`$$\\sigma_{observed} = \\frac{L_{eff(GB)}}{Z_{score}} = \\frac{${effectiveHalfSpan.toPrecision(4)}}{${zScoreObs.toPrecision(4)}} = \\mathbf{${results.gbResults.GBPFAUDEV.toPrecision(4)}}$$`}</Latex>
          </li>
          <li>
            Correlation (ρ):{" "}
            <Latex>{`$$ \\rho = \\frac{\\sigma_{uut}}{\\sigma_{obs}} = \\frac{${results.gbResults.GBPFAUUUT.toPrecision(
              4,
            )}}{${results.gbResults.GBPFAUDEV.toPrecision(
              4,
            )}} = \\mathbf{${results.gbResults.GBPFACOR.toFixed(4)}} $$`}</Latex>
          </li>
        </ul>
      </div>
      <div className="breakdown-step">
        <h5>Step 3: Normalized Limits (Z-Scores)</h5>
        <p>
          The limits are normalized by their respective standard deviations. (L
          = UUT Tolerance, A = Acceptance Limit)
        </p>
        <ul>
          <li>
            z<sub>x_low</sub> (True Error):{" "}
            <Latex>{`$$ \\frac{L_{Low}}{\\sigma_{uut}} = \\frac{${LLow_norm.toPrecision(
              4,
            )}}{${results.gbResults.GBPFAUUUT.toPrecision(
              4,
            )}} = \\mathbf{${z_x_low.toFixed(4)}} $$`}</Latex>
          </li>
          <li>
            z<sub>x_high</sub> (True Error):{" "}
            <Latex>{`$$ \\frac{L_{Up}}{\\sigma_{uut}} = \\frac{${LUp_norm.toPrecision(
              4,
            )}}{${results.gbResults.GBPFAUUUT.toPrecision(
              4,
            )}} = \\mathbf{${z_x_high.toFixed(4)}} $$`}</Latex>
          </li>
          <li>
            z<sub>y_low</sub> (Measured Error):{" "}
            <Latex>{`$$ \\frac{A_{Low}}{\\sigma_{obs}} = \\frac{${ALow_norm.toPrecision(
              4,
            )}}{${results.gbResults.GBPFAUDEV.toPrecision(
              4,
            )}} = \\mathbf{${z_y_low.toFixed(4)}} $$`}</Latex>
          </li>
          <li>
            z<sub>y_high</sub> (Measured Error):{" "}
            <Latex>{`$$ \\frac{A_{Up}}{\\sigma_{obs}} = \\frac{${AUp_norm.toPrecision(
              4,
            )}}{${results.gbResults.GBPFAUDEV.toPrecision(
              4,
            )}} = \\mathbf{${z_y_high.toFixed(4)}} $$`}</Latex>
          </li>
        </ul>
      </div>
      <div className="breakdown-step">
        <h5>Step 4: Bivariate Calculation</h5>
        <p>The probability for each tail (region) is calculated separately.</p>
        <p>
          <strong>Lower Tail Risk (PFA_Lower):</strong>
        </p>
        <Latex>
          {
            "$$P(z_x < z_{x\\_low} \\text{ and } z_{y\\_low} < z_y < z_{y\\_high})$$"
          }
        </Latex>
        <Latex>{`$$= \\Phi_2(z_{x\\_low}, z_{y\\_high}, \\rho) - \\Phi_2(z_{x\\_low}, z_{y\\_low}, \\rho)$$`}</Latex>
        <Latex>{`$$ = \\Phi_2(${z_x_low.toFixed(2)}, ${z_y_high.toFixed(
          2,
        )}, ${results.gbResults.GBPFACOR.toFixed(2)}) - \\Phi_2(${z_x_low.toFixed(
          2,
        )}, ${z_y_low.toFixed(2)}, ${results.gbResults.GBPFACOR.toFixed(
          2,
        )}) $$`}</Latex>
        <Latex>{`$$ = \\mathbf{${(
          results.gbResults.GBPFAT1 / 100
        ).toExponential(4)}} $$`}</Latex>
        <p>
          <strong>Upper Tail Risk (PFA_Upper):</strong>
        </p>
        <Latex>
          {
            "$$P(z_x > z_{x\\_high} \\text{ and } z_{y\\_low} < z_y < z_{y\\_high})$$"
          }
        </Latex>
        <p>
          Calculated using symmetry:{" "}
          <Latex>{`$$= P(z_x < -z_{x\\_high} \\text{ and } -z_{y\\_high} < z_y < -z_{y\\_low})$$ `}</Latex>
        </p>
        <Latex>{`$$= \\Phi_2(-z_{x\\_high}, -z_{y\\_low}, \\rho) - \\Phi_2(-z_{x\\_high}, -z_{y\\_high}, \\rho)$$`}</Latex>
        <Latex>{`$$ = \\Phi_2(${-z_x_high.toFixed(2)}, ${-z_y_low.toFixed(
          2,
        )}, ${results.gbResults.GBPFACOR.toFixed(
          2,
        )}) - \\Phi_2(${-z_x_high.toFixed(2)}, ${-z_y_high.toFixed(
          2,
        )}, ${results.gbResults.GBPFACOR.toFixed(2)}) $$`}</Latex>
        <Latex>{`$$ = \\mathbf{${(
          results.gbResults.GBPFAT2 / 100
        ).toExponential(4)}} $$`}</Latex>
      </div>
      <div className="breakdown-step">
        <h5>Step 5: Final PFA</h5>
        <Latex>{`$$PFA = PFA_{Lower} + PFA_{Upper}$$`}</Latex>
        <Latex>{`$$ = ${(results.gbResults.GBPFAT1 / 100).toExponential(4)} + ${(
          results.gbResults.GBPFAT2 / 100
        ).toExponential(4)} = \\mathbf{${(
          results.gbResults.GBPFA / 100
        ).toExponential(4)}} $$`}</Latex>
        <Latex>{`$$ \\text{Total PFA} = \\mathbf{${results.gbResults.GBPFA.toFixed(
          4,
        )}\\%} $$`}</Latex>
      </div>
    </div>
  );
};

export const GBPFRBreakdown = ({ inputs, results }) => {
  if (!results || !inputs) return null;

  const gb = results.gbResults || {};
  const hasLegacyIntermediates = [
    gb.GBUP,
    gb.GBLOW,
    gb.GBPFAUUUT,
    gb.GBPFAUDEV,
    gb.GBPFACOR,
    gb.GBPFRT1,
    gb.GBPFRT2,
    gb.GBPFR,
  ].every((value) => Number.isFinite(Number(value)));
  if (!hasLegacyIntermediates) {
    return (
      <LegacyMetricBreakdown
        title="PFR with guardbanding"
        description="The false-reject probability evaluated at the recommended guardband and reliability operating point. Detailed legacy bivariate intermediates were not stored for this point, so the current engine result is shown safely."
        value={results.gbPfr ?? gb.GBPFR}
        equation={`PFR_{GB}=P_{true,GB}-P_{CA,GB}=\\mathbf{${safePrecision(((results.gbPfr ?? gb.GBPFR) || 0) / 100)}}`}
        status={results?.risk8?.out?.statusMit}
      />
    );
  }

  const mid = (results.gbResults.GBUP + results.gbResults.GBLOW) / 2;
  const LLow_norm = inputs.LLow - mid;
  const LUp_norm = inputs.LUp - mid;
  const ALow_norm = results.gbResults.GBLOW - mid;
  const AUp_norm = results.gbResults.GBUP - mid;

  const z_x_low = LLow_norm / results.gbResults.GBPFAUUUT;
  const z_x_high = LUp_norm / results.gbResults.GBPFAUUUT;
  const z_y_low = ALow_norm / results.gbResults.GBPFAUDEV;
  const z_y_high = AUp_norm / results.gbResults.GBPFAUDEV;

  // Use Guardband Limits for Normalization in this Breakdown
  const effectiveHalfSpan =
    Math.abs(results.gbResults.GBUP - results.gbResults.GBLOW) / 2;
  const reliability = parseFloat(inputs.reliability);
  const zScoreObs =
    results.gbResults.GBPFAUDEV > 0
      ? effectiveHalfSpan / results.gbResults.GBPFAUDEV
      : 0;

  const safeNativeUnit =
    results.nativeUnit === "%" ? "\\%" : results.nativeUnit || "units";

  return (
    <div className="modal-body-scrollable">
      <EmpiricalMethodNote results={results} />
      <div className="breakdown-step">
        <h5>Step 1: Formula</h5>
        <p>
          The Probability of False Reject (PFR) is the sum of the probabilities
          in the two &quot;False Reject&quot; regions of the risk scatterplot.
          This is calculated using the Bivariate Normal Cumulative Distribution
          Function (Φ₂).
        </p>
        <Latex>{"$$PFR = PFR_{Lower} + PFR_{Upper}$$"}</Latex>
        <Latex>
          {
            "$$PFR_{Lower} = P(L_{Low} < \\text{True} < L_{Up} \\text{ and Measured} < A_{Low})$$"
          }
        </Latex>
        <Latex>
          {
            "$$PFR_{Upper} = P(L_{Low} < \\text{True} < L_{Up} \\text{ and Measured} > A_{Up})$$"
          }
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>Step 2: Key Statistical Inputs</h5>
        <p>
          These values are derived from your budget and reliability settings.
        </p>
        <ul>
          <li>
            True UUT Error (σ<sub>uut</sub>):{" "}
            <strong>
              {results.gbResults.GBPFAUUUT.toPrecision(4)} {safeNativeUnit}
            </strong>
          </li>
          <li>
            <div style={{ marginBottom: "5px" }}>
              Observed Error (σ<sub>obs</sub>):{" "}
              <strong>
                {results.gbResults.GBPFAUDEV.toPrecision(4)} {safeNativeUnit}
              </strong>
            </div>
            <p style={{ fontSize: "0.9em", color: "var(--text-color-muted)" }}>
              For Guardband PFR, sigma is derived using the Guardband Span:
            </p>
            <Latex>{`$$L_{eff(GB)} = \\frac{GB_{Up} - GB_{Low}}{2} = ${effectiveHalfSpan.toPrecision(4)}$$`}</Latex>
            <Latex>{`$$Z_{score} = \\Phi^{-1}(\\frac{1+${reliability}}{2}) = ${zScoreObs.toPrecision(4)}$$`}</Latex>
            <Latex>{`$$\\sigma_{observed} = \\frac{L_{eff(GB)}}{Z_{score}} = \\frac{${effectiveHalfSpan.toPrecision(4)}}{${zScoreObs.toPrecision(4)}} = \\mathbf{${results.gbResults.GBPFAUDEV.toPrecision(4)}}$$`}</Latex>
          </li>
          <li>
            Correlation (ρ):{" "}
            <Latex>{`$$ \\rho = \\frac{\\sigma_{uut}}{\\sigma_{obs}} = \\frac{${results.gbResults.GBPFAUUUT.toPrecision(
              4,
            )}}{${results.gbResults.GBPFAUDEV.toPrecision(
              4,
            )}} = \\mathbf{${results.gbResults.GBPFACOR.toFixed(4)}} $$`}</Latex>
          </li>
        </ul>
      </div>
      <div className="breakdown-step">
        <h5>Step 3: Normalized Limits (Z-Scores)</h5>
        <p>
          The limits are normalized by their respective standard deviations. (L
          = UUT Tolerance, A = Acceptance Limit)
        </p>
        <ul>
          <li>
            z<sub>x_low</sub> (True Error):{" "}
            <Latex>{`$$ \\frac{L_{Low}}{\\sigma_{uut}} = \\frac{${LLow_norm.toPrecision(
              4,
            )}}{${results.gbResults.GBPFAUUUT.toPrecision(
              4,
            )}} = \\mathbf{${z_x_low.toFixed(4)}} $$`}</Latex>
          </li>
          <li>
            z<sub>x_high</sub> (True Error):{" "}
            <Latex>{`$$ \\frac{L_{Up}}{\\sigma_{uut}} = \\frac{${LUp_norm.toPrecision(
              4,
            )}}{${results.gbResults.GBPFAUUUT.toPrecision(
              4,
            )}} = \\mathbf{${z_x_high.toFixed(4)}} $$`}</Latex>
          </li>
          <li>
            z<sub>y_low</sub> (Measured Error):{" "}
            <Latex>{`$$ \\frac{A_{Low}}{\\sigma_{obs}} = \\frac{${ALow_norm.toPrecision(
              4,
            )}}{${results.gbResults.GBPFAUDEV.toPrecision(
              4,
            )}} = \\mathbf{${z_y_low.toFixed(4)}} $$`}</Latex>
          </li>
          <li>
            z<sub>y_high</sub> (Measured Error):{" "}
            <Latex>{`$$ \\frac{A_{Up}}{\\sigma_{obs}} = \\frac{${AUp_norm.toPrecision(
              4,
            )}}{${results.gbResults.GBPFAUDEV.toPrecision(
              4,
            )}} = \\mathbf{${z_y_high.toFixed(4)}} $$`}</Latex>
          </li>
        </ul>
      </div>
      <div className="breakdown-step">
        <h5>Step 4: Bivariate Calculation</h5>
        <p>The probability for each side (region) is calculated separately.</p>
        <p>
          <strong>Lower Side Risk (PFR_Lower):</strong>
        </p>
        <Latex>
          {
            "$$P(z_{x\\_low} < z_x < z_{x\\_high} \\text{ and } z_y < z_{y\\_low})$$"
          }
        </Latex>
        <Latex>{`$$= \\Phi_2(z_{x\\_high}, z_{y\\_low}, \\rho) - \\Phi_2(z_{x\\_low}, z_{y\\_low}, \\rho)$$`}</Latex>
        <Latex>{`$$ = \\Phi_2(${z_x_high.toFixed(2)}, ${z_y_low.toFixed(
          2,
        )}, ${results.gbResults.GBPFACOR.toFixed(2)}) - \\Phi_2(${z_x_low.toFixed(
          2,
        )}, ${z_y_low.toFixed(2)}, ${results.gbResults.GBPFACOR.toFixed(
          2,
        )}) $$`}</Latex>
        <Latex>{`$$ = \\mathbf{${(
          results.gbResults.GBPFRT1 / 100
        ).toExponential(4)}} $$`}</Latex>
        <p>
          <strong>Upper Side Risk (PFR_Upper):</strong>
        </p>
        <Latex>
          {
            "$$P(z_{x\\_low} < z_x < z_{x\\_high} \\text{ and } z_y > z_{y\\_high})$$"
          }
        </Latex>
        <p>
          Calculated using symmetry:{" "}
          <Latex>{`$$= P(-z_{x\\_high} < z_x < -z_{x\\_low} \\text{ and } z_y < -z_{y\\_high})$$ `}</Latex>
        </p>
        <Latex>{`$$= \\Phi_2(-z_{x\\_low}, -z_{y\\_high}, \\rho) - \\Phi_2(-z_{x\\_high}, -z_{y\\_high}, \\rho)$$`}</Latex>
        <Latex>{`$$ = \\Phi_2(${-z_x_low.toFixed(2)}, ${-z_y_high.toFixed(
          2,
        )}, ${results.gbResults.GBPFACOR.toFixed(
          2,
        )}) - \\Phi_2(${-z_x_high.toFixed(2)}, ${-z_y_high.toFixed(
          2,
        )}, ${results.gbResults.GBPFACOR.toFixed(2)}) $$`}</Latex>
        <Latex>{`$$ = \\mathbf{${(
          results.gbResults.GBPFRT2 / 100
        ).toExponential(4)}} $$`}</Latex>
      </div>
      <div className="breakdown-step">
        <h5>Step 5: Final PFR</h5>
        <Latex>{`$$PFR = PFR_{Lower} + PFR_{Upper}$$`}</Latex>
        <Latex>{`$$ = ${(results.gbResults.GBPFRT1 / 100).toExponential(4)} + ${(
          results.gbResults.GBPFRT2 / 100
        ).toExponential(4)} = \\mathbf{${(
          results.gbResults.GBPFR / 100
        ).toExponential(4)}} $$`}</Latex>
        <Latex>{`$$ \\text{Total PFR} = \\mathbf{${results.gbResults.GBPFR.toFixed(
          4,
        )}\\%} $$`}</Latex>
      </div>
    </div>
  );
};

export const GBMultBreakdown = ({ inputs, results }) => {
  if (!results || !inputs) return null;
  const safeNativeUnit =
    results.nativeUnit === "%" ? "\\%" : results.nativeUnit || "units";
  const uutToleranceUpper = (inputs.LUp ?? 0) - (results.gbInputs.nominal ?? 0);
  const gbUpper =
    (results.gbResults.GBUP ?? 0) - (results.gbInputs.nominal ?? 0);
  const reqPFA = results.gbInputs.reqPFA ?? 0;
  const nominal = results.gbInputs.nominal ?? 0;
  const gbUP = results.gbResults.GBUP ?? 0;
  const gbMult = results.gbResults.GBMULT ?? 0;
  const precise = 6;

  return (
    <div className="modal-body-scrollable">
      <div className="breakdown-step">
        <h5>Step 1: Formula</h5>
        <p>
          The Guardband Multiplier is the ratio of the UUT tolerance to the
          Guardbanded tolerance. Calculated by adjusting acceptance limits until
          required {reqPFA * 100}% PFA is met.
        </p>
        <Latex>
          {
            "$$ \\text{Guardband Multiplier} = \\frac{\\text{UUT Upper Tolerance}}{\\text{Guardband Upper Tolerance}} = \\frac{L_{Upper} - Nominal}{GB_{Upper} - Nominal} $$"
          }
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>Step 2: Inputs</h5>
        <ul>
          <li>
            Upper Tolerance :{" "}
            <Latex>{`$$ L_{Upper} - Nominal = ${inputs.LUp.toPrecision(
              precise,
            )} - (${nominal.toPrecision(
              precise,
            )}) = ${uutToleranceUpper.toPrecision(
              precise,
            )} \\text{ ${safeNativeUnit}} $$`}</Latex>
          </li>
          <li>
            Guardband Upper Tolerance :{" "}
            <Latex>{`$$ GB_{Upper} - Nominal = ${gbUP.toPrecision(4)} - ${nominal.toPrecision(precise)} 
              = \\mathbf{${gbUpper.toPrecision(precise)}} \\text{ ${safeNativeUnit}} $$`}</Latex>
          </li>
        </ul>
      </div>
      <div className="breakdown-step">
        <h5>Step 3: Final Calculation</h5>
        <Latex>{`$$ GB Multiplier = \\frac{${gbUpper.toPrecision(
          precise,
        )}}{${uutToleranceUpper.toPrecision(
          precise,
        )}} = \\mathbf{${gbMult.toFixed(precise)}} \\% $$`}</Latex>
      </div>
    </div>
  );
};

export const GBCalIntBreakdown = ({ inputs, results }) => {
  if (!results || !inputs) return null;
  const interval = inputs.guardBandInputs.calibrationInt || 0;
  const TstRUnc =
    (inputs.guardBandInputs.combUnc * inputs.guardBandInputs.turVal) /
      parseFloat(inputs.guardBandInputs.reqTUR) || 0;
  const nominal = inputs.guardBandInputs.nominal;
  const calInt = inputs.guardBandInputs.calibrationInt;
  const combinedUncertainty = inputs.guardBandInputs.combUnc;

  // OBS REL CALCULATIONS
  const LUP = inputs.LUp;
  const LLOW = inputs.LLow;
  const biasUncObs = Math.sqrt(
    ((LUP - LLOW) /
      (2 *
        InvNormalDistribution(
          (1 + inputs.guardBandInputs.measrelCalcAssumed) / 2,
        ))) **
      2 -
      TstRUnc ** 2,
  );
  const devUncObs = Math.sqrt(
    inputs.guardBandInputs.combUnc ** 2 + biasUncObs ** 2,
  );
  const obsRel =
    vbNormSDist((LUP - nominal) / devUncObs) -
    vbNormSDist((LLOW - nominal) / devUncObs);

  // PRED REL CALCULATIONS
  const GBUP = results.gbResults.GBUP;
  const GBLOW = results.gbResults.GBLOW;
  const biasUncRel = Math.sqrt(
    ((GBUP - GBLOW) /
      (2 *
        InvNormalDistribution(
          (1 + inputs.guardBandInputs.measRelTarget) / 2,
        ))) **
      2 -
      inputs.guardBandInputs.combUnc ** 2,
  );
  const devUncRel = Math.sqrt(
    inputs.guardBandInputs.combUnc ** 2 + biasUncRel ** 2,
  );
  const predRel =
    vbNormSDist((LUP - nominal) / devUncRel) -
    vbNormSDist((LLOW - nominal) / devUncRel);

  // FULL CALCULATIONS
  const calIntWGb =
    (Math.log(predRel) / Math.log(obsRel)) *
    inputs.guardBandInputs.calibrationInt;

  return (
    <div className="modal-body-scrollable">
      <div className="breakdown-step">
        <h5>Step 1: Formula</h5>
        <p>
          The Guardband Calibration Interval is calculated by the ratio of log
          of predicted reliability and log of observed reliability times the
          calibration interval. Predicted reliablity is calculated using
          guardband limits and observed uses UUT tolerance limits.
        </p>
        <Latex>
          {`$\\text{GB Calibration Interval} = \\frac{\\log{\\text{(Predicted Reliability)}}}{\\log{\\text{(Observed Reliability)}}} \\cdot \\text{Calibration Interval}$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>Inputs</h5>
        <Latex>
          {`$$\\text{Calibration Interval} = ${interval} \\\\
        \\text{L}_{UP} = ${LUP} \\\\
        \\text{L}_{LOW} = ${LLOW} \\\\
        \\text{GB}_{UP} = ${GBUP} \\\\
        \\text{GB}_{LOW} = ${GBLOW} \\\\ $$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>
          Step 2: Key Inputs and Calculations<br></br>
          Observed Reliability
        </h5>
        <Latex>
          {`$$
        \\text{Calibration Uncertainty} = \\frac{MeasUnc \\cdot TUR}{ReqTUR} = u_{Cal} = \\frac{${combinedUncertainty.toFixed(6)} \\cdot ${inputs.guardBandInputs.turVal.toFixed(6)}}{${inputs.guardBandInputs.reqTUR}} \\\\
        = ${TstRUnc}
        $$`}
        </Latex>
        <Latex>
          {`$
        \\text{Measurement Uncertainty} = MeasUnc = ${combinedUncertainty} \\\\
        \\text{Measurement Reliability Calculated/Assumed} = r = ${inputs.guardBandInputs.measrelCalcAssumed * 100}\\% \\\\
        $`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <Latex>
          {`$$\\text{Biased Uncertainty} = \\sqrt{\\left(\\frac{L_{Up} - L_{Low}}{2 \\cdot \\Phi^{-1}\\!\\left(\\tfrac{1+r}{2}\\right)}\\right)^{2} - u_{Cal}^{2}} \\\\
        = \\sqrt{\\left(\\frac{${LUP} - ${LLOW}}{2 \\cdot ${InvNormalDistribution((1 + inputs.guardBandInputs.measrelCalcAssumed) / 2)}}\\right)^{2} - (${TstRUnc})^{2}} \\\\
        = ${biasUncObs}
        $$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <Latex>
          {`$$\\text{Deviation Uncertainty} = \\sqrt{MeasUnc^{2} + BiasUnc^{2}} \\\\ 
        = \\sqrt{${combinedUncertainty}^{2} + ${biasUncObs}^{2}} \\\\
        = ${devUncObs}
        $$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <Latex>
          {`$$ObsRel = \\Phi\\left(\\frac{L_{Up}}{DevUnc}\\right) - \\Phi\\left(\\frac{L_{Low}}{DevUnc}\\right) \\\\
        = \\Phi\\left(\\frac{${LUP - nominal}}{${devUncObs}}\\right) - \\Phi\\left(\\frac{${LLOW - nominal}}{${devUncObs}}\\right) \\\\
        = ${obsRel}
        $$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>Predicted Reliability</h5>
        <Latex>
          {`$
        \\text{Calibration Uncertainty} = u_{Cal} = MeasUnc = ${combinedUncertainty} \\\\
        \\text{Measurement Reliability Target} = r = ${inputs.guardBandInputs.measRelTarget * 100}\\%  \\\\
        $`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <Latex>
          {`$$\\text{Biased Uncertainty} = \\sqrt{\\left(\\frac{GB_{Up} - GB_{Low}}{2 \\cdot \\Phi^{-1}\\!\\left(\\tfrac{1+r}{2}\\right)}\\right)^{2} - u_{Cal}^{2}} \\\\
        = \\sqrt{\\left(\\frac{${GBUP} - ${GBLOW}}{2 \\cdot ${InvNormalDistribution((1 + inputs.guardBandInputs.measRelTarget) / 2)}}\\right)^{2} - (${combinedUncertainty})^{2}} \\\\
        = ${biasUncRel}
        $$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <Latex>
          {`$$\\text{Deviation Uncertainty} = \\sqrt{MeasUnc^{2} + BiasUnc^{2}} \\\\
        = \\sqrt{${combinedUncertainty}^{2} + ${biasUncRel}^{2}} \\\\
        = ${devUncRel}
        $$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <Latex>
          {`$$PredRel = \\Phi\\left(\\frac{L_{Up}}{DevUnc}\\right) - \\Phi\\left(\\frac{L_{Low}}{DevUnc}\\right) \\\\
        = \\Phi\\left(\\frac{${LUP - nominal}}{${devUncRel}}\\right) - \\Phi\\left(\\frac{${LLOW - nominal}}{${devUncRel}}\\right) \\\\
        = ${predRel}
        $$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>Step 3: Results</h5>
        <Latex>
          {`$$\\text{GB Calibration Interval} = \\frac{\\log{\\text{(Predicted Reliability)}}}{\\log{\\text{(Observed Reliability)}}} \\cdot \\text{Calibration Interval} \\\\
      = \\frac{${Math.log(predRel)}}{${Math.log(obsRel)}} \\cdot ${calInt} \\\\
      = ${calIntWGb}
      $$`}
        </Latex>
      </div>
    </div>
  );
};

export const NoGBCalIntBreakdown = ({ inputs, results }) => {
  if (!results || !inputs) return null;

  const interval = inputs.guardBandInputs.calibrationInt || 0;
  const TstRUnc =
    (inputs.guardBandInputs.combUnc * inputs.guardBandInputs.turVal) /
      parseFloat(inputs.guardBandInputs.reqTUR) || 0;

  const nominal = inputs.guardBandInputs.nominal;
  const calInt = inputs.guardBandInputs.calibrationInt;
  const combinedUncertainty = inputs.guardBandInputs.combUnc;

  // OBS REL CALCULATIONS
  const LUP = inputs.LUp;
  const LLOW = inputs.LLow;
  const biasUncObs = Math.sqrt(
    ((LUP - LLOW) /
      (2 *
        InvNormalDistribution(
          (1 + inputs.guardBandInputs.measrelCalcAssumed) / 2,
        ))) **
      2 -
      TstRUnc ** 2,
  );
  const devUncObs = Math.sqrt(
    inputs.guardBandInputs.combUnc ** 2 + biasUncObs ** 2,
  );
  const obsRel =
    vbNormSDist((LUP - nominal) / devUncObs) -
    vbNormSDist((LLOW - nominal) / devUncObs);

  return (
    <div className="modal-body-scrollable">
      <div className="breakdown-step">
        <h5>Step 1: Formula</h5>
        <p>
          The Guardband Calibration Interval is calculated by the ratio of log
          of predicted reliability and log of observed reliability times the
          calibration interval. Predicted reliablity is calculated using
          guardband limits and observed uses UUT tolerance limits.
        </p>
        <Latex>
          {`$\\text{GB Calibration Interval} = \\frac{\\log{\\text{(Predicted Reliability)}}}{\\log{\\text{(Observed Reliability)}}} \\cdot \\text{Calibration Interval}$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>Inputs</h5>
        <Latex>
          {`$$\\text{Calibration Interval} = ${interval} \\\\
        \\text{L}_{UP} = ${LUP} \\\\
        \\text{L}_{LOW} = ${LLOW} \\\\$$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>
          Step 2: Key Inputs and Calculations<br></br>
          Observed Reliability
        </h5>
        <Latex>
          {`$$
        \\text{Calibration Uncertainty} = \\frac{MeasUnc \\cdot TUR}{ReqTUR} = u_{Cal} = \\frac{${combinedUncertainty.toFixed(6)} \\cdot ${inputs.guardBandInputs.turVal.toFixed(6)}}{${inputs.guardBandInputs.reqTUR}} \\\\
        = ${TstRUnc}
        $$`}
        </Latex>
        <Latex>
          {`$
        \\text{Measurement Uncertainty} = MeasUnc = ${combinedUncertainty} \\\\
        \\text{Measurement Reliability Calculated/Assumed} = r = ${inputs.guardBandInputs.measrelCalcAssumed * 100}\\% \\\\
        $`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <Latex>
          {`$$\\text{Biased Uncertainty} = \\sqrt{\\left(\\frac{L_{Up} - L_{Low}}{2 \\cdot \\Phi^{-1}\\!\\left(\\tfrac{1+r}{2}\\right)}\\right)^{2} - u_{Cal}^{2}} \\\\
        = \\sqrt{\\left(\\frac{${LUP} - ${LLOW}}{2 \\cdot ${InvNormalDistribution((1 + inputs.guardBandInputs.measrelCalcAssumed) / 2)}}\\right)^{2} - (${TstRUnc})^{2}} \\\\
        = ${biasUncObs}
        $$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <Latex>
          {`$$\\text{Deviation Uncertainty} = \\sqrt{MeasUnc^{2} + BiasUnc^{2}} \\\\ 
        = \\sqrt{${combinedUncertainty}^{2} + ${biasUncObs}^{2}} \\\\
        = ${devUncObs}
        $$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <Latex>
          {`$$ObsRel = \\Phi\\left(\\frac{L_{Up}}{DevUnc}\\right) - \\Phi\\left(\\frac{L_{Low}}{DevUnc}\\right) \\\\
        = \\Phi\\left(\\frac{${LUP - nominal}}{${devUncObs}}\\right) - \\Phi\\left(\\frac{${LLOW - nominal}}{${devUncObs}}\\right) \\\\
        = ${obsRel}
        $$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>Predicted Reliability</h5>

        <Latex>
          {results.pfa < inputs.guardBandInputs.reqPFA * 100
            ? `$$\\text{Predicted Reliability} = \\text{Measurement Reliability Target} =  ${inputs.guardBandInputs.measRelTarget}
        $$`
            : `$$\\text{Inital Predicted Reliability} = 1 - \\frac{\\lvert (1-Observed Reliability)\\rvert}{2} \\\\
        = ${1 - Math.abs(1 - obsRel) / 2}
        $$`}
        </Latex>
        <p>
          {results.pfa < inputs.guardBandInputs.reqPFA * 100
            ? ""
            : "This initial predicted reliability is plugged into the PFA calculation as 'r' and adjusted until PFA calculations meet the required PFA. The difference between predicted and observed reliability is added or subtracted to the initial predicted reliability until PFA meets the requirements. This difference is divided by 2 each iteration that it doesn't match PFA."}
        </p>
        <Latex>
          {results.pfa < inputs.guardBandInputs.reqPFA * 100
            ? ""
            : `$$\\text{Predicted Reliability} = ${results.gbResults.NOGBCALINTPRED}$$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>Step 3: Results</h5>
        <Latex>
          {`$$\\text{GB Calibration Interval} = \\frac{\\log{\\text{(Predicted Reliability)}}}{\\log{\\text{(Observed Reliability)}}} \\cdot \\text{Calibration Interval} \\\\
      ${
        results.pfa < inputs.guardBandInputs.reqPFA * 100
          ? `= \\frac{${Math.log(inputs.guardBandInputs.measRelTarget)}}{${Math.log(obsRel)}} \\cdot ${calInt} \\\\`
          : `= \\frac{${Math.log(results.gbResults.NOGBCALINTPRED)}}{${Math.log(obsRel)}} \\cdot ${calInt} \\\\`
      } \\\\
      = ${results.gbResults.NOGBCALINT}
      $$`}
        </Latex>
      </div>
    </div>
  );
};

export const NoGBMeasRelBreakdown = ({ inputs, results }) => {
  if (!results || !inputs) return null;

  const interval = inputs.guardBandInputs.calibrationInt || 0;
  const TstRUnc =
    (inputs.guardBandInputs.combUnc * inputs.guardBandInputs.turVal) /
      parseFloat(inputs.guardBandInputs.reqTUR) || 0;

  const nominal = inputs.guardBandInputs.nominal;
  const combinedUncertainty = inputs.guardBandInputs.combUnc;

  // OBS REL CALCULATIONS
  const LUP = inputs.LUp;
  const LLOW = inputs.LLow;
  const biasUncObs = Math.sqrt(
    ((LUP - LLOW) /
      (2 *
        InvNormalDistribution(
          (1 + inputs.guardBandInputs.measrelCalcAssumed) / 2,
        ))) **
      2 -
      TstRUnc ** 2,
  );
  const devUncObs = Math.sqrt(
    inputs.guardBandInputs.combUnc ** 2 + biasUncObs ** 2,
  );
  const obsRel =
    vbNormSDist((LUP - nominal) / devUncObs) -
    vbNormSDist((LLOW - nominal) / devUncObs);

  return (
    <div className="modal-body-scrollable">
      <div className="breakdown-step">
        <h5>Step 1: Formula</h5>
        <p>
          The Guardband Calibration Interval is calculated by the ratio of log
          of predicted reliability and log of observed reliability times the
          calibration interval. Predicted reliablity is calculated using
          guardband limits and observed uses UUT tolerance limits.
        </p>
        <Latex>
          {`$\\text{GB Calibration Interval} = \\frac{\\log{\\text{(Predicted Reliability)}}}{\\log{\\text{(Observed Reliability)}}} \\cdot \\text{Calibration Interval}$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>Inputs</h5>
        <Latex>
          {`$$\\text{Calibration Interval} = ${interval} \\\\
        \\text{L}_{UP} = ${LUP} \\\\
        \\text{L}_{LOW} = ${LLOW} \\\\$$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>
          Step 2: Key Inputs and Calculations<br></br>
          Observed Reliability
        </h5>
        <Latex>
          {`$$
        \\text{Calibration Uncertainty} = \\frac{MeasUnc \\cdot TUR}{ReqTUR} = u_{Cal} = \\frac{${combinedUncertainty.toFixed(6)} \\cdot ${inputs.guardBandInputs.turVal.toFixed(6)}}{${inputs.guardBandInputs.reqTUR}} \\\\
        = ${TstRUnc}
        $$`}
        </Latex>
        <Latex>
          {`$
        \\text{Measurement Uncertainty} = MeasUnc = ${combinedUncertainty} \\\\
        \\text{Measurement Reliability Calculated/Assumed} = r = ${inputs.guardBandInputs.measrelCalcAssumed * 100}\\% \\\\
        $`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <Latex>
          {`$$\\text{Biased Uncertainty} = \\sqrt{\\left(\\frac{L_{Up} - L_{Low}}{2 \\cdot \\Phi^{-1}\\!\\left(\\tfrac{1+r}{2}\\right)}\\right)^{2} - u_{Cal}^{2}} \\\\
        = \\sqrt{\\left(\\frac{${LUP} - ${LLOW}}{2 \\cdot ${InvNormalDistribution((1 + inputs.guardBandInputs.measrelCalcAssumed) / 2)}}\\right)^{2} - (${TstRUnc})^{2}} \\\\
        = ${biasUncObs}
        $$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <Latex>
          {`$$\\text{Deviation Uncertainty} = \\sqrt{MeasUnc^{2} + BiasUnc^{2}} \\\\ 
        = \\sqrt{${combinedUncertainty}^{2} + ${biasUncObs}^{2}} \\\\
        = ${devUncObs}
        $$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <Latex>
          {`$$ObsRel = \\Phi\\left(\\frac{L_{Up}}{DevUnc}\\right) - \\Phi\\left(\\frac{L_{Low}}{DevUnc}\\right) \\\\
        = \\Phi\\left(\\frac{${LUP - nominal}}{${devUncObs}}\\right) - \\Phi\\left(\\frac{${LLOW - nominal}}{${devUncObs}}\\right) \\\\
        = ${obsRel}
        $$`}
        </Latex>
      </div>
      <div className="breakdown-step">
        <h5>Measurement Reliability Needed</h5>

        <Latex>
          {results.pfa < inputs.guardBandInputs.reqPFA * 100
            ? `$$\\text{Measurement Reliability} = \\text{Measurement Reliability Target} =  ${inputs.guardBandInputs.measRelTarget}
        $$`
            : `$$\\text{Inital Predicted Reliability} = 1 - \\frac{\\lvert (1-Observed Reliability)\\rvert}{2} \\\\
        = ${1 - Math.abs(1 - obsRel) / 2}
        $$`}
        </Latex>
        <p>
          {results.pfa < inputs.guardBandInputs.reqPFA * 100
            ? ""
            : "This initial predicted reliability is plugged into the PFA calculation as 'r' and adjusted until PFA calculations meet the required PFA. The difference between predicted and observed reliability is added or subtracted to the initial predicted reliability until PFA meets the requirements. This difference is divided by 2 each iteration that it doesn't match PFA."}
        </p>
        <Latex>
          {results.pfa < inputs.guardBandInputs.reqPFA * 100
            ? ""
            : `$$\\text{Measurement Reliability} = ${results.gbResults.NOGBCALINTPRED}$$`}
        </Latex>
      </div>
    </div>
  );
};
