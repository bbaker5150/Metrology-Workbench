import React from "react";
import { explainRiskConstraint } from "../../../../utils/mitigationDiagnostics";
import { normalInvCDF } from "../../../../utils/risk8/riskEngine8";
import Latex from "../../../../components/common/Latex";

const finite = (value) =>
  typeof value === "number" && Number.isFinite(value);

const number = (value, digits = 6) =>
  finite(value) ? Number(value).toPrecision(digits) : "N/A";

const percent = (value, digits = 4) =>
  finite(value) ? `${Number(value).toFixed(digits)} %` : "N/A";

const fractionPercent = (value, digits = 4) =>
  finite(value) ? percent(value * 100, digits) : "N/A";

const Row = ({ label, value }) => (
  <div className="risk-spec">
    <span className="risk-spec-label">{label}</span>
    <span className="risk-spec-value">{value}</span>
  </div>
);

const Section = ({ title, children }) => (
  <section className="breakdown-step">
    <h5>{title}</h5>
    <div className="risk-inputs-grid">{children}</div>
  </section>
);

const MathStep = ({ title, description, equations = [] }) => (
  <section className="breakdown-step">
    <h5>{title}</h5>
    {description && <p>{description}</p>}
    {equations.map((equation, index) => (
      <Latex key={`${title}-${index}`}>{`$$ ${equation} $$`}</Latex>
    ))}
  </section>
);

const activeLimit = (results) =>
  finite(results?.LLow) ? results.LLow : results?.LUp;

const activeSide = (results) =>
  finite(results?.LLow) ? "Lower" : "Upper";

const withUnit = (value, unit, digits = 6) =>
  finite(value) ? `${number(value, digits)} ${unit}` : "N/A";

const latexNumber = (value, digits = 7) =>
  finite(value) ? Number(value).toPrecision(digits) : "\\mathrm{N/A}";

const latexPercent = (fraction, digits = 5) =>
  finite(fraction)
    ? `${Number(fraction * 100).toPrecision(digits)}\\%`
    : "\\mathrm{N/A}";

const isRisk8KnownMeasurement = (results) =>
  results?.riskMethod === "risk8-single-sided-known" ||
  results?.riskMethod === "risk8-two-sided-symmetric" ||
  results?.riskMethod === "risk8-two-sided-asymmetric";

const isTwoSidedRisk8 = (results) =>
  results?.riskMethod === "risk8-two-sided-symmetric" ||
  results?.riskMethod === "risk8-two-sided-asymmetric";

const FeasibilityExplanation = ({ modalType, results, children }) => {
  const out = results.risk8?.out || {};
  const single = !isTwoSidedRisk8(results);
  const mitigation = /^(gb|nogb|calint|measrel)/.test(modalType) && modalType !== "gbinputs";
  const status = /^(nogb|calint|measrel)/.test(modalType) ? out.statusInt : out.statusMit;
  const coreIssue = out.statusCore && out.statusCore !== "OK"
    ? explainRiskConstraint(out.statusCore, single) : "";
  const mitigationIssue = mitigation && !String(status).startsWith("solution found")
    ? explainRiskConstraint(status, single) : "";
  const issue = coreIssue || mitigationIssue;
  if (issue && !["tur", "tar", "maxreop"].includes(modalType)) {
    return <MathStep title="Calculation requirements" description={issue} />;
  }
  return <>
    {coreIssue && <MathStep title="Reliability feasibility" description={coreIssue} />}
    {mitigation && <MathStep
      title="PFA target comparison"
      description="PFA is compared at two decimal places in percent, using half-up rounding. Full precision is retained for all probability calculations. Observed reliability may be at most 0.00005 percentage points below its target."
      equations={[
        "Q(p)=\\left\\lfloor 10000\\max(p,0)+0.5000000001\\right\\rfloor,\\quad Q(PFA)\\le Q(PFA_{required})",
        "R_{obs}\\ge R_{required}-5\\times10^{-7}",
      ]}
    />}
    {children}
  </>;
};

// Both tolerance families use the same interval derivation. The diagnostics
// carry Beta.7's transformed q values for single-sided E/W models, and retain
// the original acceptance limits when evaluating the final aging state.
const IntervalCalculation = ({ modalType, results }) => {
  const { input = {}, out = {}, diagnostics = {} } = results.risk8 || {};
  const withGuardband = modalType === "gbcalint";
  const pair = withGuardband ? diagnostics.gbIntervalPair : diagnostics.reopOnlyIntervalPair;
  const final = withGuardband ? out.gbInterval : out.intInterval;
  const finalRisk = withGuardband ? diagnostics.guardbandIntervalRisk : diagnostics.reopOnly;
  const reference = withGuardband ? out.mitReop : out.intReop;
  const model = diagnostics.modelCode || input.decayModel || "E1";
  const single = !isTwoSidedRisk8(results);
  if (!finite(final) || !pair) {
    return <MathStep title="Calibration interval requirements"
      description={explainRiskConstraint(withGuardband ? out.statusMit : out.statusInt, single) || "A feasible reliability recommendation and a positive starting calibration interval are required."} />;
  }
  const trueModel = model === "E2" || model === "W2";
  const weibull = model === "W1" || model === "W2";
  return <>
    <MathStep title="Reliability used for interval adjustment"
      description="Evaluate the starting and recommended population on the original acceptance limits. Guardband changes affect the acceptance decision; they do not change the aging curve."
      equations={[
        `R_{reference,new}=\\mathbf{${latexNumber(reference)}}`,
        `I_0=\\mathbf{${latexNumber(Number(input.originalInterval))}}\\;\\text{months}`,
      ]} />
    {model === "D" ? <MathStep title="Diffusion interval calculation"
      description="The interval scales with UUT population variance. No reliability-floor transformation is needed for this variance model."
      equations={[
        "I_{new}=I_0\\frac{s_{u,new}^2}{s_{u,0}^2}",
        `I_{new}=${latexNumber(Number(input.originalInterval))}\\frac{${latexNumber(finalRisk?.su)}^2}{${latexNumber(diagnostics.core?.su)}^2}=\\mathbf{${latexNumber(final)}}\\;\\text{months}`,
      ]} /> : <MathStep title={`${weibull ? "Weibull" : "Exponential"} interval calculation`}
      description={`${trueModel ? "True" : "Observed"} reliability is used. ${single ? "Decay acts on excess reliability above 50%, q = 2R − 1; both q values must lie strictly between 0 and 1." : "Both reliability values must lie strictly between 0 and 1."}${weibull ? " Beta is the positive Weibull shape parameter." : ""}`}
      equations={[
        single ? "q=2R-1,\\quad 0<q<1" : "q=R,\\quad 0<q<1",
        `q_0=\\mathbf{${latexNumber(pair.originalR)}},\\quad q_{new}=\\mathbf{${latexNumber(pair.newTargetR)}}`,
        weibull ? "I_{new}=I_0\\left(\\frac{\\ln q_{new}}{\\ln q_0}\\right)^{1/\\beta}" : "I_{new}=I_0\\frac{\\ln q_{new}}{\\ln q_0}",
        `I_{new}=${latexNumber(Number(input.originalInterval))}\\left(\\frac{\\ln(${latexNumber(pair.newTargetR)})}{\\ln(${latexNumber(pair.originalR)})}\\right)${weibull ? `^{1/${latexNumber(Number(input.weibullBeta))}}` : ""}=\\mathbf{${latexNumber(final)}}\\;\\text{months}`,
      ]} />}
  </>;
};

const TwoSidedCalculationChain = ({ modalType, results }) => {
  if (modalType === "tar" && results.tmdeLimits?.reason) return <p>{results.tmdeLimits.reason}</p>;
  const risk8 = results.risk8 || {};
  const out = risk8.out || {};
  const input = risk8.input || {};
  const diagnostics = risk8.diagnostics || {};
  const core = diagnostics.core;
  const recommended = diagnostics.recommended;
  const frame = risk8.meta?.frame || {};
  const lower = results.LLow;
  const upper = results.LUp;
  const span = upper - lower;
  const tmdeSpan = results.tmdeToleranceSpan;

  const probabilitySteps = (risk, label) => (
    <>
      <MathStep
        title={`${label}: normalized uncertainty`}
        description="The calculation normalizes the tolerance band to width 2, solves the observed population spread at the stated reliability, and removes calibration variance in quadrature."
        equations={[
          `s_{c,in}=\\frac{1}{1.96\\,TUR}=\\mathbf{${latexNumber(risk?.sc_in)}}`,
          `s_{c,solve}=\\frac{1}{1.96\\,TUR_{solve}}=\\mathbf{${latexNumber(risk?.sc_solve)}}`,
          `P(LTL<X<UTL)=R_{ref}=${latexNumber(risk === recommended ? out.mitReop : risk === diagnostics.reopOnly ? out.intReop : diagnostics.reop)}`,
          `s_u=\\sqrt{s_{o,ref}^{2}-s_{c,solve}^{2}}=\\mathbf{${latexNumber(risk?.su)}}`,
          `s_{obs}=\\sqrt{s_u^2+s_{c,in}^2}=\\mathbf{${latexNumber(risk?.sobs_in)}}`,
        ]}
      />
      <MathStep
        title={`${label}: decision probabilities`}
        description="The adaptive integral computes correct accept over the overlap of the true specification and observed acceptance regions; false accept and false reject are the remaining probability regions."
        equations={[
          `P_{obs}=P(GB_L<X_{obs}<GB_H)=\\mathbf{${latexNumber(risk?.pObs)}}`,
          `P_{true}=P(LTL<X_{true}<UTL)=\\mathbf{${latexNumber(risk?.pTrue)}}`,
          `P_{CA}=\\int_{LTL}^{UTL} f_{UUT}(y)P(GB_L<X_{obs}<GB_H\\mid y)\\,dy=\\mathbf{${latexNumber(risk?.pPCA)}}`,
          `PFA=P_{obs}-P_{CA}=\\mathbf{${latexNumber(risk?.pPFA)}}\\;(${latexPercent(risk?.pPFA)})`,
          `PFR=P_{true}-P_{CA}=\\mathbf{${latexNumber(risk?.pPFR)}}\\;(${latexPercent(risk?.pPFR)})`,
        ]}
      />
    </>
  );

  if (modalType === "tur") {
    return (
      <MathStep
        title="Two-sided TUR calculation"
        description="The calculation divides the full UUT tolerance width by the full expanded-uncertainty width."
        equations={[
          `W_{UUT}=U-L=${latexNumber(upper)}-${latexNumber(lower)}=${latexNumber(span)}`,
          `TUR=\\frac{W_{UUT}}{2U}=\\frac{${latexNumber(span)}}{2(${latexNumber(results.expandedUncertainty)})}=\\mathbf{${latexNumber(results.tur)}}`,
        ]}
      />
    );
  }
  if (modalType === "tar") {
    return (
      <MathStep
        title="Two-sided TAR calculation"
        description={results.tmdeLimits?.reason || `${results.tmdeLimits?.method || "TMDE specification limits"}. The full UUT tolerance width is divided by the full equivalent TMDE tolerance width.`}
        equations={[
          `TAR=\\frac{U-L}{T_{TMDE,high}-T_{TMDE,low}}=\\frac{${latexNumber(span)}}{${latexNumber(tmdeSpan)}}=\\mathbf{${latexNumber(results.tar)}}`,
        ]}
      />
    );
  }
  if (modalType === "gblow" || modalType === "gbhigh") {
    return (
      <MathStep
        title="Two-sided physical guardband limits"
        description="Two-sided guardbands contract about the tolerance midpoint. The physical lower limit rounds up and the upper limit rounds down; reliability and risk are then recalculated for the rounded acceptance region."
        equations={[
          `M=(L+U)/2,\\quad h=(U-L)/2`,
          `GB_L=\\operatorname{roundUp}_{res}(M-g_{continuous}h)=\\mathbf{${latexNumber(results.gbLow)}}`,
          `GB_H=\\operatorname{roundDown}_{res}(M+g_{continuous}h)=\\mathbf{${latexNumber(results.gbHigh)}}`,
          `g_{final}=(GB_H-GB_L)/(U-L)`,
          `g=\\mathbf{${latexNumber(out.gbMult)}}=\\mathbf{${latexPercent(out.gbMult)}}`,
        ]}
      />
    );
  }
  if (["gbmult", "gbpfa", "gbpfr"].includes(modalType)) {
    return (
      <>
        <MathStep
          title="mitigation solve"
          description="The solver searches for the largest acceptance region that meets both the required PFA and required reliability."
          equations={[
            `g^*=\\max\\{g:PFA(g)\\le ${latexNumber(Number(input.pfaTarget))},\\;R_{obs}(g)\\ge ${latexNumber(Number(input.reopTarget))}\\}`,
            `g^*=\\mathbf{${latexNumber(out.gbMult)}}`,
            `PFA_{GB}=\\mathbf{${latexNumber(out.mitPfa)}}\\;(${latexPercent(out.mitPfa)})`,
            `PFR_{GB}=\\mathbf{${latexNumber(out.mitPfr)}}\\;(${latexPercent(out.mitPfr)})`,
          ]}
        />
        {probabilitySteps(recommended, "Recommended guardband")}
      </>
    );
  }
  if (["gbcalint", "calint", "measrel"].includes(modalType)) {
    return <IntervalCalculation modalType={modalType} results={results} />;
  }
  if (modalType === "observedreop") {
    return (
      <MathStep
        title="Observed reliability at the test-point TUR"
        description="The observed reliability is the total probability that the reported measurement passes: correct accepts plus false accepts."
        equations={[
          `R_{obs}=P_{CA}+PFA=${latexNumber(core?.pPCA)}+${latexNumber(core?.pPFA)}=\\mathbf{${latexNumber(out.obs)}}`,
          `R_{obs}=\\mathbf{${latexPercent(out.obs)}}`,
        ]}
      />
    );
  }
  if (modalType === "maxreop") {
    return (
      <MathStep
        title="Maximum achievable reliability at the test-point TUR"
        description="This is the pass probability attainable with calibration uncertainty alone at the current acceptance limits. It is evaluated at the actual test TUR. Feasibility of assumed reliability is checked separately at the reference TUR and specification limits."
        equations={[
          `s_{c,in}=\\frac{1}{1.96\\,TUR}=\\mathbf{${latexNumber(core?.sc_in)}}`,
          `R_{max}=P(GB_L<X_{cal}<GB_H\\mid \\mu_{obs},s_{c,in})=\\mathbf{${latexNumber(out.maxReop)}}`,
          `R_{max}=\\mathbf{${latexPercent(out.maxReop)}}`,
        ]}
      />
    );
  }
  if (modalType === "truereop") {
    return (
      <MathStep
        title="True UUT reliability"
        description="The true reliability is the probability that the unobserved UUT value is inside specification. It equals correct accepts plus false rejects."
        equations={[
          `R_{true}=P_{CA}+PFR=${latexNumber(core?.pPCA)}+${latexNumber(core?.pPFR)}=\\mathbf{${latexNumber(out.trueReop)}}`,
          `R_{true}=\\mathbf{${latexPercent(out.trueReop)}}`,
        ]}
      />
    );
  }
  if (modalType === "gbmeasrel") {
    return (
      <>
        <MathStep
          title="Target reliability with guardbanding"
          description="The joint mitigation solver varies the acceptance multiplier and reliability, then retains the largest acceptance region that satisfies both targets."
          equations={[
            `R_{GB}^{*}=\\min\\{R:PFA(g^{*},R)\\le ${latexNumber(Number(input.pfaTarget))},\\;R_{obs}(g^{*},R)\\ge ${latexNumber(Number(input.reopTarget))}\\}`,
            `R_{GB}^{*}=\\mathbf{${latexNumber(out.mitReop)}}=\\mathbf{${latexPercent(out.mitReop)}}`,
          ]}
        />
        {probabilitySteps(recommended, "Recommended guardband")}
      </>
    );
  }
  if (modalType === "nogbpfa" || modalType === "nogbpfr") {
    return (
      <>
        <MathStep
          title="Interval-only reliability solve"
          description="The acceptance limits remain unchanged. The calculation solves only the reliability operating point needed to meet the PFA and reliability requirements."
          equations={[
            `R_{int}^{*}=\\min\\{R:PFA(R)\\le ${latexNumber(Number(input.pfaTarget))},\\;R_{obs}(R)\\ge ${latexNumber(Number(input.reopTarget))}\\}`,
            `R_{int}^{*}=\\mathbf{${latexNumber(out.intReop)}}`,
          ]}
        />
        {probabilitySteps(
          diagnostics.reopOnly,
          "Interval-only recommendation",
        )}
      </>
    );
  }
  if (modalType === "pfa" || modalType === "pfr") {
    return probabilitySteps(core, "Core risk");
  }
  return (
    <>
      <MathStep
        title="Normalize the physical asymmetric tolerance"
        description="Nominal remains normalized zero. The unequal physical limits are represented by an asymmetry delta in the width-2 frame."
        equations={[
          `h=\\frac{U-L}{2}=\\frac{${latexNumber(upper)}-${latexNumber(lower)}}{2}=\\mathbf{${latexNumber(frame.halfSpan)}}`,
          `\\delta=\\frac{U+L-2N}{U-L}=\\mathbf{${latexNumber(diagnostics.delta)}}`,
          `LTL=\\delta-1=\\mathbf{${latexNumber(diagnostics.LTL)}},\\quad UTL=\\delta+1=\\mathbf{${latexNumber(diagnostics.UTL)}}`,
          `\\mu=\\frac{x-N}{h}=\\mathbf{${latexNumber(risk8.meta?.mu)}}`,
        ]}
      />
      {probabilitySteps(core, "Core risk")}
    </>
  );
};

const CalculationChain = ({ modalType, results }) => {
  if (modalType === "tar" && results.tmdeLimits?.reason) return <p>{results.tmdeLimits.reason}</p>;
  if (isTwoSidedRisk8(results)) {
    return <TwoSidedCalculationChain modalType={modalType} results={results} />;
  }
  const risk8 = results.risk8 || {};
  const out = risk8.out || {};
  const input = risk8.input || {};
  const diagnostics = risk8.diagnostics || {};
  const core = diagnostics.core;
  const recommended = diagnostics.recommended;
  const frame = risk8.meta?.frame || {};
  const lower = activeSide(results) === "Lower";
  const limit = activeLimit(results);
  const nominal = results.nominalValue ?? frame.center;
  const measured = results.riskAverage;
  const distance =
    finite(measured) && finite(limit) ? Math.abs(measured - limit) : NaN;
  const tmdeHalfSpan = results.tmdeToleranceSpan / 2;
  const g = finite(out.gbMult) ? out.gbMult : NaN;
  const rawPhysicalGB =
    finite(nominal) && finite(limit) && finite(g)
      ? lower
        ? nominal - g * (nominal - limit)
        : nominal + g * (limit - nominal)
      : NaN;
  const physicalGB = lower ? results.gbLow : results.gbHigh;
  const activeSign = lower ? "-1" : "+1";
  const passEquation = lower
    ? "P_{pass}(a;m,s)=1-\\Phi\\!\\left(\\frac{a-m}{s}\\right)"
    : "P_{pass}(a;m,s)=\\Phi\\!\\left(\\frac{a-m}{s}\\right)";

  const coreProbabilitySteps = (risk, label, finalMetric) => {
    if (!risk) {
      return (
        <MathStep
          title={`${label} calculation`}
          description="This probability calculation is unavailable for the current inputs. Review the tolerance, uncertainty, and reliability requirements."
        />
      );
    }
    const referenceReliability =
      risk === recommended
        ? out.mitReop
        : risk === diagnostics.reopOnly
          ? out.intReop
          : diagnostics.reop;
    const normalizedAcceptance =
      risk === recommended
        ? Number(out.gbMult) * diagnostics.activeUUT
        : diagnostics.activeGB;

    return (
      <>
        <MathStep
          title={`${label}: normalized calibration uncertainty`}
          description="The calculation uses a fixed 95% factor of 1.96 and normalizes uncertainty to the active one-sided tolerance span."
          equations={[
            `s_{c,in}=\\frac{1}{1.96\\,TUR}=\\frac{1}{1.96(${latexNumber(diagnostics.tur)})}=\\mathbf{${latexNumber(risk.sc_in)}}`,
            `s_{c,solve}=\\frac{1}{1.96\\,TUR_{solve}}=\\frac{1}{1.96(${latexNumber(diagnostics.turSolve)})}=\\mathbf{${latexNumber(risk.sc_solve)}}`,
          ]}
        />
        <MathStep
          title={`${label}: recover the UUT population spread`}
          description="The observed sigma is solved so the one-sided pass probability equals the assumed reliability. Calibration variance is then removed in quadrature."
          equations={[
            `\\mu_{obs}=\\mu+x_{cal}=${latexNumber(diagnostics.mu)}+${latexNumber(diagnostics.xcal)}=\\mathbf{${latexNumber(diagnostics.muObserved)}}`,
            `P_{pass}(${activeSign};\\mu_{obs},s_{o,ref})=R_{ref}=${latexNumber(referenceReliability)}`,
            `s_u=\\sqrt{s_{o,ref}^{2}-s_{c,solve}^{2}}=\\sqrt{${latexNumber(risk.so_ref)}^2-${latexNumber(risk.sc_solve)}^2}=\\mathbf{${latexNumber(risk.su)}}`,
            `s_{obs,in}=\\sqrt{s_u^2+s_{c,in}^2}=\\sqrt{${latexNumber(risk.su)}^2+${latexNumber(risk.sc_in)}^2}=\\mathbf{${latexNumber(risk.sobs_in)}}`,
          ]}
        />
        <MathStep
          title={`${label}: classify the probability regions`}
          description="PCA is the correct-accept probability: the true value is within the one-sided specification and the observed result passes the acceptance limit. Adaptive Simpson integration evaluates this joint probability."
          equations={[
            passEquation,
            `P_{obs}=P_{pass}(${latexNumber(normalizedAcceptance)};\\mu_{obs},s_{obs,in})=\\mathbf{${latexNumber(risk.pObs)}}`,
            `P_{true}=P_{pass}(${activeSign};\\mu,s_u)=\\mathbf{${latexNumber(risk.pTrue)}}`,
            `P_{CA}=\\int_{\\text{true pass region}} f_{UUT}(y)\\,P(\\text{test passes}\\mid y)\\,dy=\\mathbf{${latexNumber(risk.pPCA)}}`,
            `PFA=P_{obs}-P_{CA}=${latexNumber(risk.pObs)}-${latexNumber(risk.pPCA)}=\\mathbf{${latexNumber(risk.pPFA)}}\\;(${latexPercent(risk.pPFA)})`,
            `PFR=P_{true}-P_{CA}=${latexNumber(risk.pTrue)}-${latexNumber(risk.pPCA)}=\\mathbf{${latexNumber(risk.pPFR)}}\\;(${latexPercent(risk.pPFR)})`,
            finalMetric === "pfr"
              ? `\\boxed{PFR=${latexNumber(risk.pPFR)}}`
              : `\\boxed{PFA=${latexNumber(risk.pPFA)}}`,
          ]}
        />
      </>
    );
  };

  const intervalStep = (kind) => <IntervalCalculation modalType={kind} results={results} />;

  switch (modalType) {
    case "pfa":
      return coreProbabilitySteps(core, "Core risk", "pfa");
    case "pfr":
      return coreProbabilitySteps(core, "Core risk", "pfr");
    case "observedreop":
      return (
        <MathStep
          title="Observed reliability at the test-point TUR"
          description="The observed reliability is the probability that the reported measurement passes. That pass region is partitioned into correct accepts and false accepts."
          equations={[
            `R_{obs}=P_{CA}+PFA=${latexNumber(core?.pPCA)}+${latexNumber(core?.pPFA)}=\\mathbf{${latexNumber(out.obs)}}`,
            `R_{obs}=\\mathbf{${latexPercent(out.obs)}}`,
          ]}
        />
      );
    case "maxreop":
      return (
        <MathStep
          title="Maximum achievable reliability at the test-point TUR"
          description="The calculation evaluates the active acceptance limit using calibration uncertainty alone. This is the feasibility ceiling for the entered test-point TUR."
          equations={[
            `s_{c,in}=\\frac{1}{1.96\\,TUR}=\\mathbf{${latexNumber(core?.sc_in)}}`,
            `R_{max}=P_{pass}(GB;\\mu_{obs},s_{c,in})=\\mathbf{${latexNumber(out.maxReop)}}`,
            `R_{max}=\\mathbf{${latexPercent(out.maxReop)}}`,
          ]}
        />
      );
    case "truereop":
      return (
        <MathStep
          title="True UUT reliability"
          description="The true reliability is the probability that the unobserved UUT value is within specification. It is the sum of correct accepts and false rejects."
          equations={[
            `R_{true}=P_{CA}+PFR=${latexNumber(core?.pPCA)}+${latexNumber(core?.pPFR)}=\\mathbf{${latexNumber(out.trueReop)}}`,
            `R_{true}=\\mathbf{${latexPercent(out.trueReop)}}`,
          ]}
        />
      );
    case "tur":
      return (
        <MathStep
          title="Single-sided TUR calculation"
          description="The numerator is the distance from the measured point to the active specification limit; the denominator is expanded measurement uncertainty."
          equations={[
            `d=|x-L|=|${latexNumber(measured)}-${latexNumber(limit)}|=\\mathbf{${latexNumber(distance)}}`,
            `TUR=\\frac{d}{U}=\\frac{${latexNumber(distance)}}{${latexNumber(results.expandedUncertainty)}}=\\mathbf{${latexNumber(results.tur)}}`,
          ]}
        />
      );
    case "tar":
      return (
        <MathStep
          title="Single-sided TAR calculation"
          description="TAR uses the distance to the active UUT limit divided by one half of the total TMDE tolerance span."
          equations={[
            `d=|x-L|=|${latexNumber(measured)}-${latexNumber(limit)}|=\\mathbf{${latexNumber(distance)}}`,
            `T_{TMDE,half}=\\frac{T_{high}-T_{low}}{2}=\\frac{${latexNumber(results.tmdeToleranceSpan)}}{2}=\\mathbf{${latexNumber(tmdeHalfSpan)}}`,
            `TAR=\\frac{d}{T_{TMDE,half}}=\\frac{${latexNumber(distance)}}{${latexNumber(tmdeHalfSpan)}}=\\mathbf{${latexNumber(results.tar)}}`,
          ]}
        />
      );
    case "gblow":
    case "gbhigh":
      return (
        <MathStep
          title="Physical guardband conversion"
          description={`For a ${lower ? "lower" : "upper"} limit, the recommended normalized multiplier is converted about nominal, then snapped inward to the UUT resolution.`}
          equations={[
            lower
              ? `GB_{raw}=N-g(N-L)=${latexNumber(nominal)}-${latexNumber(g)}(${latexNumber(nominal)}-${latexNumber(limit)})=\\mathbf{${latexNumber(rawPhysicalGB)}}`
              : `GB_{raw}=N+g(U-N)=${latexNumber(nominal)}+${latexNumber(g)}(${latexNumber(limit)}-${latexNumber(nominal)})=\\mathbf{${latexNumber(rawPhysicalGB)}}`,
            `GB_{display}=\\operatorname{snap}_{inward}(GB_{raw},${latexNumber(results.gbInputs?.safeRes)})=\\mathbf{${latexNumber(physicalGB)}}`,
          ]}
        />
      );
    case "gbmult":
      return (
        <>
          <MathStep
            title="Guardband and reliability solver"
            description="The largest feasible acceptance region is found at the required observed reliability. Limits are rounded inward to measuring resolution, then reliability and risk are recalculated for those exact limits."
            equations={[
              `g^*=\\max\\{g\\in[0,1]:PFA(g)\\leq ${latexNumber(Number(input.pfaTarget))}\\;\\land\\;P_{obs}(g)\\geq ${latexNumber(Number(input.reopTarget))}\\}`,
              `g^*=\\mathbf{${latexNumber(g)}}=\\mathbf{${latexPercent(g)}}`,
              `R_{recommended}=\\mathbf{${latexNumber(out.mitReop)}}`,
            ]}
          />
          {coreProbabilitySteps(recommended, "Recommended guardband", "pfa")}
        </>
      );
    case "gbpfa":
      return coreProbabilitySteps(recommended, "Recommended guardband", "pfa");
    case "gbpfr":
      return coreProbabilitySteps(recommended, "Recommended guardband", "pfr");
    case "gbcalint":
      return intervalStep("gbcalint");
    case "gbmeasrel":
      return (
        <>
          <MathStep
            title="Target reliability with guardbanding"
            description="The joint solver varies guardband and reliability and retains the largest acceptance region that meets both mitigation targets."
            equations={[
              `R_{GB}^{*}=\\min\\{R:PFA(g^{*},R)\\le ${latexNumber(Number(input.pfaTarget))},\\;R_{obs}(g^{*},R)\\ge ${latexNumber(Number(input.reopTarget))}\\}`,
              `R_{GB}^{*}=\\mathbf{${latexNumber(out.mitReop)}}=\\mathbf{${latexPercent(out.mitReop)}}`,
            ]}
          />
          {coreProbabilitySteps(recommended, "Recommended guardband", "pfa")}
        </>
      );
    case "nogbpfa":
      return coreProbabilitySteps(
        diagnostics.reopOnly,
        "Interval-only recommendation",
        "pfa",
      );
    case "nogbpfr":
      return coreProbabilitySteps(
        diagnostics.reopOnly,
        "Interval-only recommendation",
        "pfr",
      );
    case "calint":
      return intervalStep("calint");
    case "measrel":
      return (
        <>
          <MathStep
            title="REOP-only solver"
            description="With the current guardband held fixed, first find the lowest reference reliability that meets the observed-reliability target. Increase it only if needed to meet the PFA target."
            equations={[
              `R^*=\\min\\{R:PFA(R)\\leq ${latexNumber(Number(input.pfaTarget))}\\;\\land\\;P_{obs}(R)\\geq ${latexNumber(Number(input.reopTarget))}\\}`,
              `R^*=\\mathbf{${latexNumber(out.intReop)}}=\\mathbf{${latexPercent(out.intReop)}}`,
            ]}
          />
          {coreProbabilitySteps(diagnostics.reopOnly, "REOP-only recommendation", "pfa")}
        </>
      );
    case "inputs":
    case "gbinputs":
    default:
      return (
        <>
          <MathStep
            title="Normalize the physical single-sided tolerance"
            description="Nominal is the zero of the frame and the active specification is mapped to -1 for a lower limit or +1 for an upper limit."
            equations={[
              `h=|N-L|=|${latexNumber(nominal)}-${latexNumber(limit)}|=\\mathbf{${latexNumber(frame.halfSpan)}}`,
              `\\mu=\\frac{x-N}{h}=\\frac{${latexNumber(measured)}-${latexNumber(nominal)}}{${latexNumber(frame.halfSpan)}}=\\mathbf{${latexNumber(risk8.meta?.mu)}}`,
              `x_{cal}=\\frac{b_{cal}}{h}=\\mathbf{${latexNumber(risk8.meta?.xcal)}}`,
            ]}
          />
          {coreProbabilitySteps(core, "Core risk", "pfa")}
        </>
      );
  }
};

const metricDetails = (modalType, results) => {
  const out = results.risk8?.out || {};
  const inputs = results.gbInputs || {};
  const unit = results.nativeUnit || "units";
  const side = activeSide(results);
  const limit = activeLimit(results);
  const asymmetric = results?.riskMethod === "risk8-two-sided-asymmetric";
  const twoSided = isTwoSidedRisk8(results);

  switch (modalType) {
    case "pfa":
      return {
        title: "Probability of False Accept",
        explanation:
          twoSided
            ? "The calculation evaluates both false-accept regions of the two-sided tolerance using the shared normalized two-sided model."
            : "The calculation evaluates the single-sided false-accept region using the test TUR, assumed reliability, normalized UUT bias, calibration bias, and the active acceptance limit.",
        rows: [
          ["PFA", percent(results.pfa)],
          ["Observed reliability at test TUR", fractionPercent(out.obs)],
          ["Maximum reliability at test TUR", fractionPercent(out.maxReop)],
          ["True reliability at test TUR", fractionPercent(out.trueReop)],
        ],
      };
    case "pfr":
      return {
        title: "Probability of False Reject",
        explanation:
          twoSided
            ? "The calculation evaluates both false-reject regions of the two-sided tolerance from the same model used for PFA."
            : "The calculation evaluates the complementary single-sided false-reject region from the same normalized test model used for PFA.",
        rows: [
          ["PFR", percent(results.pfr)],
          ["Observed reliability at test TUR", fractionPercent(out.obs)],
          ["Specification sides", twoSided ? "Lower and upper" : side],
        ],
      };
    case "observedreop":
      return {
        title: "Observed Reliability at Test-Point TUR",
        explanation:
          "This is the probability that the reported measurement falls inside the current acceptance limits at the actual test-point TUR.",
        rows: [
          ["Observed reliability", fractionPercent(out.obs)],
          ["Correct-accept probability", fractionPercent(results.risk8?.diagnostics?.core?.pPCA)],
          ["False-accept probability", fractionPercent(results.risk8?.diagnostics?.core?.pPFA)],
        ],
      };
    case "maxreop":
      return {
        title: "Maximum Achievable Reliability",
        explanation:
          "This is the calibration-uncertainty-limited pass probability at the current acceptance limits and test-point TUR.",
        rows: [
          ["Maximum achievable reliability", fractionPercent(out.maxReop)],
          ["Calibration sigma at test TUR", number(results.risk8?.diagnostics?.core?.sc_in)],
          ["Observed mean in normalized units", number(results.risk8?.diagnostics?.muObserved)],
        ],
      };
    case "truereop":
      return {
        title: "True UUT Reliability",
        explanation:
          "This is the modeled probability that the true, unobserved UUT value is within its specification limits.",
        rows: [
          ["True UUT reliability", fractionPercent(out.trueReop)],
          ["Correct-accept probability", fractionPercent(results.risk8?.diagnostics?.core?.pPCA)],
          ["False-reject probability", fractionPercent(results.risk8?.diagnostics?.core?.pPFR)],
        ],
      };
    case "tur":
      return {
        title: "Test Uncertainty Ratio",
        explanation:
          twoSided
            ? "For a two-sided tolerance, TUR is the full UUT tolerance width divided by twice the expanded measurement uncertainty."
            : "For a known single-sided point, TUR is the physical distance from the measured value to the active specification limit divided by expanded measurement uncertainty.",
        rows: [
          [twoSided ? "Full UUT tolerance width" : "Distance to active limit", withUnit(twoSided ? results.LUp - results.LLow : Math.abs(results.riskAverage - limit), unit)],
          ["Expanded measurement uncertainty", withUnit(results.expandedUncertainty, unit)],
          ["TUR", number(results.tur)],
        ],
      };
    case "tar":
      return {
        title: "Test Accuracy Ratio",
        explanation:
          results.tmdeLimits?.reason || `${results.tmdeLimits?.method || "TMDE specification limits"}. TAR compares specification widths. Risk probabilities use TUR and the uncertainty budget.`,
        rows: [
          ["TAR", number(results.tar)],
          [twoSided ? "Full UUT tolerance width" : "Distance from measurement to active limit", withUnit(twoSided ? results.LUp - results.LLow : Math.abs(results.riskAverage - limit), unit)],
          [twoSided ? "Full TMDE tolerance width" : "TMDE half-span", withUnit(results.tmdeToleranceSpan == null ? undefined : results.tmdeToleranceSpan / (twoSided ? 1 : 2), unit)],
        ],
      };
    case "gblow":
    case "gbhigh": {
      const lower = modalType === "gblow";
      return {
        title: `${lower ? "Lower" : "Upper"} Guardband Limit`,
        explanation:
          "The calculation converts the recommended normalized guardband multiplier back to a physical acceptance limit and then applies the UUT resolution rule.",
        rows: [
          ["Physical acceptance limit", withUnit(lower ? results.gbLow : results.gbHigh, unit)],
          ["Recommended guardband", percent(results.gbMult)],
          ["UUT resolution", withUnit(inputs.safeRes, unit)],
        ],
      };
    }
    case "gbpfa":
    case "gbpfr": {
      const isPfa = modalType === "gbpfa";
      return {
        title: `${isPfa ? "PFA" : "PFR"} with Guardbanding`,
        explanation:
          "This is the probability result at the recommended guardband and recommended reliability operating point.",
        rows: [
          [isPfa ? "PFA with guardband" : "PFR with guardband", percent(isPfa ? results.gbPfa : results.gbPfr)],
          ["Required PFA", fractionPercent(inputs.reqPFA)],
          ["Required reliability", fractionPercent(inputs.measRelTarget)],
          ["Recommended reference reliability", fractionPercent(out.mitReop)],
          ["Observed reliability at rounded limits", fractionPercent(out.mitObs)],
        ],
      };
    }
    case "gbmult":
      return {
        title: "Guardband Multiplier",
        explanation:
          "The calculation solves for the guardband multiplier and reliability combination that satisfies the requested PFA and reliability targets.",
        rows: [
          ["Initial guardband", percent(Number(inputs.initialGB) * 100)],
          ["Recommended guardband", percent(results.gbMult)],
          ...(twoSided
            ? [
                ["Lower physical acceptance limit", withUnit(results.gbLow, unit)],
                ["Upper physical acceptance limit", withUnit(results.gbHigh, unit)],
              ]
            : [[`${side} physical acceptance limit`, withUnit(side === "Lower" ? results.gbLow : results.gbHigh, unit)]]),
        ],
      };
    case "gbcalint":
      return {
        title: "Calibration Interval with Guardbanding",
        explanation:
          "The interval recommendation converts the reliability change required by the guardband mitigation through the selected reliability-decay model.",
        rows: [
          ["Original interval", finite(inputs.calibrationInt) ? `${number(inputs.calibrationInt)} months` : "N/A"],
          ["Recommended interval", finite(results.gbCalInt) ? `${number(results.gbCalInt)} months` : "N/A"],
          ["Recommended reference reliability", fractionPercent(out.mitReop)],
          ["Observed reliability at rounded limits", fractionPercent(out.mitObs)],
        ],
      };
    case "gbmeasrel":
      return {
        title: "Targeted Reliability with Guardbanding",
        explanation:
          "This is the reliability operating point selected jointly with the guardband multiplier to meet the mitigation requirements.",
        rows: [
          ["Targeted reliability with guardbanding", percent(results.gbMeasRel)],
          ["PFA with guardbanding", percent(results.gbPfa)],
          ["PFR with guardbanding", percent(results.gbPfr)],
          ["Recommended guardband", percent(results.gbMult)],
        ],
      };
    case "nogbpfa":
    case "nogbpfr": {
      const isPfa = modalType === "nogbpfa";
      return {
        title: `${isPfa ? "PFA" : "PFR"} without Guardbanding`,
        explanation:
          "This is the probability result at the interval-only reliability recommendation. Acceptance limits are unchanged; only the reliability operating point and interval are adjusted.",
        rows: [
          [isPfa ? "PFA without guardbanding" : "PFR without guardbanding", percent(isPfa ? results.noGbPfa : results.noGbPfr)],
          ["Targeted reliability without guardbanding", percent(results.noGbMeasRel)],
          ["Recommended interval", finite(results.noGbCalInt) ? `${number(results.noGbCalInt)} months` : "N/A"],
        ],
      };
    }
    case "calint":
      return {
        title: "Calibration Interval without Guardbanding",
        explanation:
          "This recommendation holds the current acceptance limit fixed and changes only the reliability operating point to meet the targets.",
        rows: [
          ["Original interval", finite(inputs.calibrationInt) ? `${number(inputs.calibrationInt)} months` : "N/A"],
          ["Recommended interval", finite(results.noGbCalInt) ? `${number(results.noGbCalInt)} months` : "N/A"],
          ["Required reliability", percent(results.noGbMeasRel)],
        ],
      };
    case "measrel":
      return {
        title: "Measurement Reliability without Guardbanding",
        explanation:
          "This is the reliability operating point required to meet the targets while retaining the current acceptance limit.",
        rows: [
          ["Required measurement reliability", percent(results.noGbMeasRel)],
          ["PFA at recommended reliability", fractionPercent(out.intPfa)],
          ["PFR at recommended reliability", fractionPercent(out.intPfr)],
        ],
      };
    case "gbinputs":
    case "inputs":
    default:
      return {
        title: "Calculation Inputs",
        explanation:
          twoSided
            ? `These are the physical and normalized values passed to the ${asymmetric ? "two-sided asymmetric" : "two-sided symmetric"} measurement-known model.`
            : "These are the physical and normalized values passed to the single-sided measurement-known model.",
        rows: [
          ["Tolerance type", results.risk8?.meta?.tolType ?? "N/A"],
          ...(twoSided
            ? [
                ["Lower specification limit", withUnit(results.LLow, unit)],
                ["Upper specification limit", withUnit(results.LUp, unit)],
              ]
            : [
                ["Active specification side", side],
                ["Active specification limit", withUnit(limit, unit)],
              ]),
          ["Measured value", withUnit(results.riskAverage, unit)],
          ["Expanded uncertainty", withUnit(results.expandedUncertainty, unit)],
          ["TUR", number(results.tur)],
          ["Assumed reliability", fractionPercent(inputs.measrelCalcAssumed)],
          ["Normalized UUT bias (mu)", number(results.risk8?.meta?.mu)],
          ["Normalized calibration bias", number(results.risk8?.meta?.xcal)],
        ],
      };
  }
};

export const risk8ModalTitle = (modalType, results) =>
  results?.riskMethod === "risk8-pfa-boundary" ? "Single-Sided Acceptance Boundary Breakdown" : isRisk8KnownMeasurement(results)
    ? `${metricDetails(modalType, results).title} Breakdown`
    : null;

const Risk8BreakdownContent = ({ modalType, results }) => {
  if (results?.riskMethod === "risk8-pfa-boundary") {
    const inputs = results.gbInputs || {};
    const lower = finite(results.LLow);
    const limit = lower ? results.LLow : results.LUp;
    const acceptance = lower ? results.gbLow ?? results.ALow : results.gbHigh ?? results.AUp;
    const uncertainty = results.expandedUncertainty;
    const alpha = inputs.reqPFA;
    const z = finite(alpha) && alpha > 0 && alpha < .5 ? normalInvCDF(alpha) : undefined;
    return <div className="modal-body-scrollable" data-testid="risk8-breakdown">
      <MathStep title="Single-sided tolerance with unknown measurement"
        description="Expanded uncertainty and the requested PFA set a conservative acceptance boundary. Without a measured value, population PFR, TUR, reliability, and calibration intervals are unavailable."
        equations={[
          `s_c=U_{cal}/1.96=${latexNumber(uncertainty)}/1.96=\\mathbf{${latexNumber(uncertainty / 1.96)}}`,
          `z_\\alpha=\\Phi^{-1}(${latexNumber(alpha)})=\\mathbf{${latexNumber(z)}}`,
          lower ? "GB_{raw}=L-s_c z_\\alpha" : "GB_{raw}=U+s_c z_\\alpha",
          `GB=\\operatorname{${lower ? 'roundUp' : 'roundDown'}}_{res}(GB_{raw})=\\mathbf{${latexNumber(acceptance)}}`,
        ]} />
      <MathStep title="Achieved PFA after resolution rounding"
        description="Round the lower limit up or the upper limit down. Recalculate the normal tail probability at this final physical boundary; the achieved PFA may be below the target."
        equations={[
          lower ? "PFA=1-\\Phi((GB-L)/s_c)" : "PFA=\\Phi((GB-U)/s_c)",
          `L_{active}=\\mathbf{${latexNumber(limit)}},\\quad res=\\mathbf{${latexNumber(inputs.safeRes || 0)}}`,
          `PFA_{achieved}=\\mathbf{${latexPercent(results.risk8?.out?.mitPfa)}}`,
        ]} />
    </div>;
  }
  if (!isRisk8KnownMeasurement(results)) return null;
  const details = metricDetails(modalType, results);
  const unit = results.nativeUnit || "units";
  const frame = results.risk8?.meta?.frame || {};
  const asymmetric = results.riskMethod === "risk8-two-sided-asymmetric";
  const symmetric = results.riskMethod === "risk8-two-sided-symmetric";

  return (
    <div className="modal-body-scrollable" data-testid="risk8-breakdown">
      <div className="breakdown-step">
        <strong>
          Method: {asymmetric ? "two-sided asymmetric" : symmetric ? "two-sided symmetric" : "single-sided"} measurement known.
        </strong>
        <p>{details.explanation}</p>
      </div>

      <Section title={details.title}>
        {details.rows.map(([label, value]) => (
          <Row key={label} label={label} value={value} />
        ))}
      </Section>

      <FeasibilityExplanation modalType={modalType} results={results}>
        <CalculationChain modalType={modalType} results={results} />
      </FeasibilityExplanation>

      <Section title={isTwoSidedRisk8(results) ? "Normalized Two-Sided Model" : "Normalized Single-Sided Model"}>
        <Row label="Frame center" value={withUnit(frame.center, unit)} />
        <Row label="Frame half-span" value={withUnit(frame.halfSpan, unit)} />
        {isTwoSidedRisk8(results) && (
          <>
            <Row label="Asymmetry delta" value={number(results.risk8?.diagnostics?.delta)} />
            <Row label="Normalized lower limit" value={number(results.risk8?.diagnostics?.LTL)} />
            <Row label="Normalized upper limit" value={number(results.risk8?.diagnostics?.UTL)} />
          </>
        )}
        <Row label="Normalized UUT bias (mu)" value={number(results.risk8?.meta?.mu)} />
        <Row label="Normalized calibration bias" value={number(results.risk8?.meta?.xcal)} />
      </Section>
    </div>
  );
};

export default Risk8BreakdownContent;
