import React, { useEffect, useId, useMemo, useState } from "react";
import {
  drawFromQuantiles,
  normalizeTwoSided,
} from "../../../utils/empiricalRisk";

const WIDTH = 920;
const HEIGHT = 330;
const PLOT_LEFT = 56;
const PLOT_RIGHT = 892;
const BASELINE = 252;
const CURVE_HEIGHT = 154;
const ZOOM_STEPS = [1, 1.35, 1.7, 2.2];

const MC_WIDTH = 920;
const MC_HEIGHT = 560;
const MC_PLOT = { left: 96, right: 896, top: 58, bottom: 498 };
const MC_SAMPLES = 3000;

const finite = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatNumber = (value, digits = 5) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/A";
  if (number === 0) return "0";
  if (Math.abs(number) >= 10000 || Math.abs(number) < 0.001) {
    return number.toExponential(3);
  }
  return Number(number.toPrecision(digits)).toString();
};

// Matches the PFA color thresholds used by the measurement point list
// (getPfaColor in App.jsx): >5% bad, >2% warning, otherwise good.
const pfaStatus = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "muted";
  if (parsed > 5) return "bad";
  if (parsed > 2) return "warning";
  return "good";
};

const distributionKind = (label = "") => {
  const normalized = String(label).toLowerCase();
  if (normalized.includes("rect") || normalized.includes("uniform")) return "uniform";
  if (normalized.includes("triang")) return "triangular";
  if (normalized.includes("u-shaped") || normalized.includes("ushaped")) return "ushaped";
  return "normal";
};

const distributionDivisor = (component) => {
  const explicit = Number(component?.distributionDivisor);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const label = String(component?.distribution || "").toLowerCase();
  const match = label.match(/k\s*=\s*([\d.]+)/);
  if (match) return Number(match[1]);
  if (label.includes("rect") || label.includes("uniform")) return Math.sqrt(3);
  if (label.includes("triang")) return Math.sqrt(6);
  if (label.includes("u-shaped") || label.includes("ushaped")) return Math.sqrt(2);
  if (label.includes("95")) return 1.96;
  if (label.includes("99")) return 2.576;
  return component?.type === "A" ? 1 : 2;
};

const divisorDescription = (distribution, divisor) => {
  const label = distribution || "Normal";
  const normalized = String(label).toLowerCase();
  const value = formatNumber(divisor);
  if (normalized.includes("rect") || normalized.includes("uniform")) {
    return `${label} (sqrt 3) - ${value}`;
  }
  if (normalized.includes("triang")) return `${label} (sqrt 6) - ${value}`;
  if (normalized.includes("u-shaped") || normalized.includes("ushaped")) {
    return `${label} (sqrt 2) - ${value}`;
  }
  if (normalized.includes("normal")) return `${label} - k=${value}`;
  return `${label} - divisor ${value}`;
};

const densityAt = (kind, normalizedX) => {
  if (kind === "uniform") return Math.abs(normalizedX) <= 1 ? 0.64 : 0;
  if (kind === "triangular") return Math.max(0, 1 - Math.abs(normalizedX));
  if (kind === "ushaped") {
    if (Math.abs(normalizedX) >= 1) return 0;
    return Math.min(1, 0.24 / Math.sqrt(Math.max(0.025, 1 - normalizedX ** 2)));
  }
  return Math.exp(-0.5 * normalizedX ** 2);
};

const buildCurve = ({ kind, center, spread, domainLow, domainHigh }) => {
  const safeSpread = Math.max(Math.abs(spread), (domainHigh - domainLow) / 1000);
  const points = [];
  for (let i = 0; i <= 180; i += 1) {
    const value = domainLow + ((domainHigh - domainLow) * i) / 180;
    points.push({ value, density: densityAt(kind, (value - center) / safeSpread) });
  }
  return points;
};

const curvePath = (points, toX, heightScale = 1) => {
  if (!points.length) return "";
  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${toX(point.value).toFixed(2)} ${(
          BASELINE -
          point.density * CURVE_HEIGHT * heightScale
        ).toFixed(2)}`,
    )
    .join(" ");
  return `${line} L ${toX(points.at(-1).value).toFixed(2)} ${BASELINE} L ${toX(
    points[0].value,
  ).toFixed(2)} ${BASELINE} Z`;
};

// Fill the area under a curve only for the sub-range [fromValue, toValue].
// Used to shade the out-of-tolerance tails of the true-error distribution so
// the "bad population" feeding false accepts is visible on the chart.
const partialCurvePath = (points, toX, fromValue, toValue, heightScale = 1) => {
  const slice = points.filter(
    (point) => point.value >= fromValue && point.value <= toValue,
  );
  if (slice.length < 2) return "";
  const line = slice
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${toX(point.value).toFixed(2)} ${(
          BASELINE -
          point.density * CURVE_HEIGHT * heightScale
        ).toFixed(2)}`,
    )
    .join(" ");
  return `${line} L ${toX(slice.at(-1).value).toFixed(2)} ${BASELINE} L ${toX(
    slice[0].value,
  ).toFixed(2)} ${BASELINE} Z`;
};

// Standard normal CDF (Abramowitz & Stegun 7.1.26). Used only to label the
// out-of-tolerance population share on the chart; the reported PFA/PFR still
// come from the risk engine, not from here.
const normCdf = (z) => {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.319381530 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
};

// Deterministic PRNG so the Monte Carlo cloud is stable between renders.
const mulberry32 = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const flattenComponents = (calcResults, nativeUnit) => {
  const groups = calcResults?.calculatedBudgetGroups || [];
  const seen = new Set();
  const options = [];

  groups.forEach((group) => {
    (group.components || []).forEach((component, index) => {
      const id = `${group.id || group.kind}-${component.id || index}`;
      if (seen.has(id)) return;
      seen.add(id);

      const native = Number(component.value_native);
      const contribution = Number(component.contribution);
      const raw = Number(component.value);
      const standardUncertainty = Number.isFinite(native)
        ? Math.abs(native)
        : Number.isFinite(contribution)
          ? Math.abs(contribution)
          : Math.abs(raw);

      if (!Number.isFinite(standardUncertainty) || standardUncertainty <= 0) return;

      options.push({
        id,
        name: component.name || "Uncertainty component",
        source: component.sourcePointLabel || group.label || "Budget component",
        distribution: component.distribution || "Normal",
        divisor: distributionDivisor(component),
        standardUncertainty,
        unit: component.unit_native || component.unit || group.unit || nativeUnit,
        type: component.type || "B",
        quantity: Number(component.quantity) || 1,
      });
    });
  });

  return options;
};

const MetricPill = ({
  label,
  value,
  hint,
  tone = "neutral",
  onClick,
  onMouseEnter,
  onMouseLeave,
}) => (
  <button
    type="button"
    className={`risk-viz-metric ${tone} ${onClick ? "clickable" : ""}`}
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
    onFocus={onMouseEnter}
    onBlur={onMouseLeave}
  >
    <span>{label}</span>
    <strong>{value}</strong>
    {hint && <em>{hint}</em>}
  </button>
);

const ZoomControls = ({ zoom, onChange }) => {
  const index = ZOOM_STEPS.indexOf(zoom);
  return (
    <div className="risk-viz-zoom-controls" aria-label="Chart zoom controls">
      <button
        type="button"
        aria-label="Zoom out"
        disabled={index <= 0}
        onClick={() => onChange(ZOOM_STEPS[Math.max(0, index - 1)])}
      >
        -
      </button>
      <span>{Math.round(zoom * 100)}%</span>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={index >= ZOOM_STEPS.length - 1}
        onClick={() =>
          onChange(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, index + 1)])
        }
      >
        +
      </button>
      <button
        type="button"
        className="reset"
        disabled={zoom === 1}
        onClick={() => onChange(1)}
      >
        Reset
      </button>
    </div>
  );
};

const LimitMarker = ({ x, label, value, unit, kind, top, testId }) => (
  <g className="risk-viz-limit-marker" data-testid={testId}>
    <line
      x1={x}
      x2={x}
      y1={top + 24}
      y2={BASELINE + 5}
      className={`risk-viz-limit-line ${kind}`}
    />
    <text x={x} y={top} textAnchor="middle" className={`risk-viz-limit-label ${kind}`}>
      {label}
    </text>
    <text x={x} y={top + 17} textAnchor="middle" className="risk-viz-limit-value">
      {formatNumber(value)} {unit}
    </text>
  </g>
);

const MC_OUTCOMES = [
  {
    id: "ca",
    short: "CA",
    label: "Correct accept",
    description: "In tolerance and accepted",
  },
  {
    id: "fa",
    short: "FA",
    label: "False accept",
    description: "Out of tolerance but accepted",
  },
  {
    id: "fr",
    short: "FR",
    label: "False reject",
    description: "In tolerance but rejected",
  },
  {
    id: "cr",
    short: "CR",
    label: "Correct reject",
    description: "Out of tolerance and rejected",
  },
];

const RiskDistributionVisualizer = ({
  results,
  calcResults,
  onShowBreakdown,
  activeModals = [],
}) => {
  const gradientId = useId().replace(/:/g, "");
  const [mode, setMode] = useState("decision");
  const [showGuardband, setShowGuardband] = useState(false);
  const [riskZoom, setRiskZoom] = useState(1);
  const [mcZoom, setMcZoom] = useState(1);
  const [componentZoom, setComponentZoom] = useState(1);
  // Cross-highlight between the metric pills / outcome rows and the chart:
  // "ucal" emphasizes the calibration variance slice + the ±U decision zones,
  // "risk" emphasizes just the zones and out-of-tolerance tails.
  const [hovered, setHovered] = useState(null);
  const usesMonteCarlo = results.riskMethod === "empirical";
  const monteCarloStale =
    results.riskMethod !== "empirical" && results.mcStale === true;

  useEffect(() => {
    setMode(usesMonteCarlo ? "montecarlo" : "decision");
  }, [usesMonteCarlo]);
  const componentOptions = useMemo(
    () => flattenComponents(calcResults, results.nativeUnit),
    [calcResults, results.nativeUnit],
  );
  const [selectedComponentId, setSelectedComponentId] = useState("");
  const selectedComponent =
    componentOptions.find((component) => component.id === selectedComponentId) ||
    componentOptions[0];

  const guardbandAvailable =
    Number.isFinite(Number(results.gbResults?.GBLOW)) &&
    Number.isFinite(Number(results.gbResults?.GBUP));
  const guardbandEnabled = showGuardband && guardbandAvailable;
  const nominal = finite(
    results.nominalValue,
    (finite(results.LLow) + finite(results.LUp)) / 2,
  );
  const toleranceLow = finite(results.LLow);
  const toleranceHigh = finite(results.LUp);
  const acceptanceLow = guardbandEnabled
    ? finite(results.gbResults.GBLOW)
    : finite(results.ALow, results.LLow);
  const acceptanceHigh = guardbandEnabled
    ? finite(results.gbResults.GBUP)
    : finite(results.AUp, results.LUp);
  // Acceptance limits usually coincide with the tolerance limits; only draw
  // them separately when they actually differ.
  const acceptanceDistinct =
    acceptanceLow !== toleranceLow || acceptanceHigh !== toleranceHigh;

  const decisionChart = useMemo(() => {
    const trueSigma = Math.max(Math.abs(finite(results.uUUT)), 1e-12);
    const observedSigma = Math.max(Math.abs(finite(results.uDev)), trueSigma);
    const calSigma = Math.abs(finite(results.uCal));
    const expandedU = Math.abs(finite(results.expandedUncertainty));
    const widestSigma = Math.max(trueSigma, observedSigma);
    const domainLow = Math.min(toleranceLow, acceptanceLow, nominal - widestSigma * 4.2);
    const domainHigh = Math.max(toleranceHigh, acceptanceHigh, nominal + widestSigma * 4.2);
    const paddedSpan = Math.max(domainHigh - domainLow, widestSigma * 8, 1e-12);
    const low = domainLow - paddedSpan * 0.08;
    const high = domainHigh + paddedSpan * 0.08;
    const toX = (value) =>
      PLOT_LEFT + ((value - low) / (high - low)) * (PLOT_RIGHT - PLOT_LEFT);

    const truePoints = buildCurve({
      kind: "normal",
      center: nominal,
      spread: trueSigma,
      domainLow: low,
      domainHigh: high,
    });
    const observedPoints = buildCurve({
      kind: "normal",
      center: nominal,
      spread: observedSigma,
      domainLow: low,
      domainHigh: high,
    });

    // Out-of-tolerance population: the true-error mass beyond each tolerance
    // limit. This is the pool a false accept must be drawn from — NOT PFA
    // itself, which is the joint event of one of these still reading inside
    // acceptance.
    const pOOT =
      (normCdf((toleranceLow - nominal) / trueSigma) +
        (1 - normCdf((toleranceHigh - nominal) / trueSigma))) *
      100;

    // ±U decision-risk zones around each acceptance limit: the band where
    // measurement noise can flip the accept/reject call, so where PFA and PFR
    // mass actually lives. Wider expanded uncertainty -> wider zones -> more
    // risk, which ties u_cal/U directly to the outcome.
    const zoneFor = (limit, key) => {
      const lo = toX(limit - expandedU);
      const hi = toX(limit + expandedU);
      return { key, x: Math.min(lo, hi), width: Math.abs(hi - lo) };
    };
    const riskZones =
      expandedU > 0
        ? [zoneFor(acceptanceLow, "low"), zoneFor(acceptanceHigh, "high")]
        : [];

    return {
      low,
      high,
      toX,
      trueVar: trueSigma ** 2,
      calVar: calSigma ** 2,
      pOOT,
      riskZones,
      ootLowPath: partialCurvePath(truePoints, toX, low, toleranceLow, 0.82),
      ootHighPath: partialCurvePath(truePoints, toX, toleranceHigh, high, 0.82),
      // Reject mass: the observed-result curve beyond the acceptance limits.
      // Unlike PFA/PFR (joint events) this is an exact 1-D marginal — the
      // overall fraction of results the lab rejects. Bigger than the true
      // out-of-tolerance tails because calibration uncertainty widens the
      // observed curve; that gap is where false decisions come from.
      rejectLowPath: partialCurvePath(observedPoints, toX, low, acceptanceLow, 1),
      rejectHighPath: partialCurvePath(observedPoints, toX, acceptanceHigh, high, 1),
      truePath: curvePath(truePoints, toX, 0.82),
      observedPath: curvePath(observedPoints, toX, 1),
    };
  }, [acceptanceHigh, acceptanceLow, nominal, results, toleranceHigh, toleranceLow]);

  // Joint simulation behind the 9-quadrant plot: each trial draws a true UUT
  // error, then observes it through the calibration uncertainty. Comparing
  // the true error against tolerance and the observed result against
  // acceptance classifies the trial as CA / FA / FR / CR.
  const monteCarlo = useMemo(() => {
    const trueSigma = Math.max(Math.abs(finite(results.uUUT)), 1e-12);
    const calSigma = Math.abs(finite(results.uCal));
    const observedSigma = Math.sqrt(trueSigma ** 2 + calSigma ** 2);
    // Layer 3: for Monte Carlo-mode points, draw measurement errors from the
    // point's ACTUAL simulated distribution (centered quantile table) instead
    // of a normal — the plotted quadrants then match the reported empirical
    // PFA/PFR, asymmetry included.
    const errorQuantiles =
      Array.isArray(results.errorQuantiles) &&
      results.errorQuantiles.length > 1
        ? results.errorQuantiles
        : null;
    // Center the truth frame exactly where the risk math centered it. For
    // empirical (Monte Carlo) points that is normalizeTwoSided's symmetrized
    // frame around the risk average (the MC mean) — using anything else makes
    // the plotted FA/FR fractions drift from the reported PFA/PFR.
    const riskAverage = finite(results.riskAverage, nominal);
    const frame = errorQuantiles
      ? normalizeTwoSided(riskAverage, toleranceLow, toleranceHigh)
      : null;
    const center = frame ? frame.center : nominal;
    const tolLow = frame ? -frame.L : toleranceLow - nominal;
    const tolHigh = frame ? frame.L : toleranceHigh - nominal;
    const accLow = acceptanceLow - center;
    const accHigh = acceptanceHigh - center;
    const xMax =
      Math.max(Math.abs(tolLow), Math.abs(tolHigh), trueSigma * 3.5) * 1.18;
    const yMax =
      Math.max(Math.abs(accLow), Math.abs(accHigh), observedSigma * 3.5) * 1.18;
    const toX = (value) =>
      MC_PLOT.left + ((value + xMax) / (2 * xMax)) * (MC_PLOT.right - MC_PLOT.left);
    const toY = (value) =>
      MC_PLOT.bottom - ((value + yMax) / (2 * yMax)) * (MC_PLOT.bottom - MC_PLOT.top);

    const rand = mulberry32(0x515ca11);
    const points = [];
    const counts = { ca: 0, fa: 0, fr: 0, cr: 0 };
    for (let i = 0; i < MC_SAMPLES; i += 1) {
      // Box-Muller transform: two independent standard normal draws.
      const radius = Math.sqrt(-2 * Math.log(1 - rand()));
      const angle = 2 * Math.PI * rand();
      const trueError = trueSigma * radius * Math.cos(angle);
      const measurementError = errorQuantiles
        ? drawFromQuantiles(errorQuantiles, rand())
        : calSigma * radius * Math.sin(angle);
      const observedError = trueError + measurementError;
      const inTolerance = trueError >= tolLow && trueError <= tolHigh;
      const accepted = observedError >= accLow && observedError <= accHigh;
      const outcome = inTolerance
        ? accepted
          ? "ca"
          : "fr"
        : accepted
          ? "fa"
          : "cr";
      counts[outcome] += 1;
      if (Math.abs(trueError) <= xMax && Math.abs(observedError) <= yMax) {
        points.push({ x: toX(trueError), y: toY(observedError), outcome });
      }
    }

    // 3x3 grid of outcome regions delimited by the tolerance (vertical) and
    // acceptance (horizontal) limits.
    const xEdges = [-xMax, tolLow, tolHigh, xMax];
    const yEdges = [-yMax, accLow, accHigh, yMax];
    const regions = [];
    for (let col = 0; col < 3; col += 1) {
      for (let row = 0; row < 3; row += 1) {
        const inTolerance = col === 1;
        const accepted = row === 1;
        regions.push({
          key: `${col}-${row}`,
          x: toX(xEdges[col]),
          y: toY(yEdges[row + 1]),
          width: toX(xEdges[col + 1]) - toX(xEdges[col]),
          height: toY(yEdges[row]) - toY(yEdges[row + 1]),
          outcome: inTolerance
            ? accepted
              ? "ca"
              : "fr"
            : accepted
              ? "fa"
              : "cr",
        });
      }
    }

    return {
      tolLow,
      tolHigh,
      accLow,
      accHigh,
      center,
      xMax,
      yMax,
      toX,
      toY,
      points,
      counts,
      regions,
      correlation: finite(results.correlation, trueSigma / observedSigma),
      empirical: Boolean(errorQuantiles),
    };
  }, [acceptanceHigh, acceptanceLow, nominal, results, toleranceHigh, toleranceLow]);

  const componentChart = useMemo(() => {
    if (!selectedComponent) return null;
    const kind = distributionKind(selectedComponent.distribution);
    const standard = selectedComponent.standardUncertainty;
    const limit = standard * selectedComponent.divisor;
    const shapeSpread = kind === "normal" ? standard : limit;
    const domainLimit = kind === "normal" ? Math.max(limit, standard * 4) : limit * 1.22;
    const low = -domainLimit;
    const high = domainLimit;
    const toX = (value) =>
      PLOT_LEFT + ((value - low) / (high - low)) * (PLOT_RIGHT - PLOT_LEFT);
    return {
      limit,
      standard,
      toX,
      path: curvePath(
        buildCurve({
          kind,
          center: 0,
          spread: shapeSpread,
          domainLow: low,
          domainHigh: high,
        }),
        toX,
      ),
    };
  }, [selectedComponent]);

  const pfa = guardbandEnabled ? results.gbResults.GBPFA : results.pfa;
  const pfr = guardbandEnabled ? results.gbResults.GBPFR : results.pfr;
  const calculatedRisk = { fa: pfa, fr: pfr };

  // Variance decomposition behind the two curves: observed spread is the true
  // spread widened by calibration uncertainty, added in quadrature. Render the
  // squared (variance) shares since that is what actually adds linearly.
  const totalVar = decisionChart.trueVar + decisionChart.calVar;
  const compositionAvailable = Number.isFinite(totalVar) && totalVar > 0;
  const calShare = compositionAvailable
    ? (decisionChart.calVar / totalVar) * 100
    : 0;
  const trueShare = 100 - calShare;

  const guardbandToggle = (
    <label
      className={`risk-viz-guardband ${!guardbandAvailable ? "disabled" : ""}`}
      title={
        guardbandAvailable
          ? "Compare calculated guardband limits"
          : "No converged guardband limits are available"
      }
    >
      <input
        type="checkbox"
        checked={guardbandEnabled}
        disabled={!guardbandAvailable}
        onChange={(event) => setShowGuardband(event.target.checked)}
      />
      <span className="risk-viz-toggle-track"><span /></span>
      Apply guardband
    </label>
  );

  return (
    <section className="risk-viz-shell">
      <header className="risk-viz-header">
        <div>
          <span className="risk-viz-eyebrow">Decision confidence</span>
          <h3>
            Tolerance &amp; Uncertainty Visualizer
            {usesMonteCarlo && <span className="method-chip">Monte Carlo</span>}
          </h3>
          <p>
            See how measurement uncertainty interacts with specification and
            acceptance limits.
          </p>
        </div>
        <div className="risk-viz-mode-switch" aria-label="Visualizer mode">
          <button
            type="button"
            className={mode === "decision" ? "active" : ""}
            onClick={() => setMode("decision")}
          >
            Risk View
          </button>
          <button
            type="button"
            className={mode === "montecarlo" ? "active" : ""}
            onClick={() => setMode("montecarlo")}
            disabled={!usesMonteCarlo}
            title={
              usesMonteCarlo
                ? "View empirical Monte Carlo decision outcomes"
                : "Enable Monte Carlo propagation on this point to view empirical outcomes"
            }
          >
            Monte Carlo
          </button>
          <button
            type="button"
            className={mode === "component" ? "active" : ""}
            onClick={() => setMode("component")}
            disabled={!componentOptions.length}
          >
            Component View
          </button>
        </div>
      </header>
      {monteCarloStale && (
        <div className="budget-risk-method-note stale">
          Monte Carlo results are out of date. The visualizer is showing linear
          GUM results until the simulation refreshes.
        </div>
      )}

      {mode === "decision" && (
        <>
          <div className="risk-viz-toolbar">
            <div className="risk-viz-legend">
              <span className="true"><i /> True UUT error</span>
              <span className="observed"><i /> Observed result</span>
              <span className="tolerance"><i /> Tolerance</span>
              {acceptanceDistinct && (
                <span className="acceptance">
                  <i /> {guardbandEnabled ? "Guardband acceptance" : "Acceptance"}
                </span>
              )}
              <span className="oot"><i /> Out of tolerance (true)</span>
              <span className="reject"><i /> Rejected (observed)</span>
              {decisionChart.riskZones.length > 0 && (
                <span className="riskzone"><i /> &plusmn;U decision zone</span>
              )}
            </div>
            {guardbandToggle}
          </div>

          {compositionAvailable && (
            <div
              className={`risk-viz-composition ${
                hovered === "ucal" ? "emphasize-ucal" : ""
              }`}
              data-testid="risk-composition"
            >
              <div className="risk-viz-composition-head">
                <span className="risk-viz-eyebrow">Risk anatomy</span>
                <p>
                  What you <strong>observe</strong> is the UUT&apos;s{" "}
                  <strong>true</strong> spread widened by the{" "}
                  <strong>calibration</strong> uncertainty. Variances add, so the
                  squared terms stack &mdash; the bigger the blue slice, the more
                  the observed curve outruns the true curve and the more decision
                  risk (PFA / PFR) you carry.
                </p>
              </div>
              <div className="risk-viz-variance-eqn" data-testid="risk-variance-eqn">
                <span className="total">
                  &sigma;<sub>obs</sub>
                  <strong>{formatNumber(results.uDev)}</strong>
                  <sup>2</sup>
                </span>
                <em>=</em>
                <span className="true">
                  &sigma;<sub>true</sub>
                  <strong>{formatNumber(results.uUUT)}</strong>
                  <sup>2</sup>
                </span>
                <em>+</em>
                <span className="observed">
                  u<sub>cal</sub>
                  <strong>{formatNumber(results.uCal)}</strong>
                  <sup>2</sup>
                </span>
                <em className="unit">{results.nativeUnit}</em>
              </div>
              <div
                className="risk-viz-variance-bar"
                role="img"
                aria-label={`True variance ${formatNumber(
                  trueShare,
                  3,
                )} percent, calibration variance ${formatNumber(
                  calShare,
                  3,
                )} percent of the observed variance`}
              >
                <div
                  className="seg true"
                  style={{ width: `${Math.max(0, trueShare)}%` }}
                  title="True UUT variance"
                >
                  <span>
                    &sigma;<sub>true</sub>
                    <sup>2</sup> &middot; {formatNumber(trueShare, 3)}%
                  </span>
                </div>
                <div
                  className="seg observed"
                  style={{ width: `${Math.max(0, calShare)}%` }}
                  title="Calibration variance"
                >
                  <span>
                    u<sub>cal</sub>
                    <sup>2</sup> &middot; {formatNumber(calShare, 3)}%
                  </span>
                </div>
              </div>
              <div className="risk-viz-variance-legend">
                <span className="true">
                  <i /> True UUT spread &sigma;<sub>true</sub> ={" "}
                  {formatNumber(results.uUUT)} {results.nativeUnit}
                </span>
                <span className="observed">
                  <i /> Calibration u<sub>cal</sub> ={" "}
                  {formatNumber(results.uCal)} {results.nativeUnit}
                </span>
                <span className="total">
                  Observed &sigma;<sub>obs</sub> = {formatNumber(results.uDev)}{" "}
                  {results.nativeUnit} &middot; correlation &rho; ={" "}
                  {formatNumber(results.correlation, 3)}
                </span>
              </div>
            </div>
          )}

          <div className="risk-viz-main-grid">
            <div className="risk-viz-chart-card">
              <div className="risk-viz-chart-topline">
                <ZoomControls zoom={riskZoom} onChange={setRiskZoom} />
              </div>
              <div className="risk-viz-canvas">
                <svg
                  className={`risk-viz-svg ${hovered ? `emphasize-${hovered}` : ""}`}
                  style={{ width: `${riskZoom * 100}%` }}
                  viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                  role="img"
                  aria-label="Tolerance, acceptance, true error, and observed result distributions"
                >
                <defs>
                  <linearGradient id={`${gradientId}-observed`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.52" />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.03" />
                  </linearGradient>
                  <linearGradient id={`${gradientId}-true`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.02" />
                  </linearGradient>
                </defs>

                <rect
                  x={decisionChart.toX(toleranceLow)}
                  y="56"
                  width={Math.max(
                    0,
                    decisionChart.toX(toleranceHigh) - decisionChart.toX(toleranceLow),
                  )}
                  height="196"
                  className="risk-viz-tolerance-band"
                />
                {acceptanceDistinct && (
                  <rect
                    x={decisionChart.toX(acceptanceLow)}
                    y="92"
                    width={Math.max(
                      0,
                      decisionChart.toX(acceptanceHigh) -
                        decisionChart.toX(acceptanceLow),
                    )}
                    height="160"
                    className={`risk-viz-acceptance-band ${guardbandEnabled ? "guardbanded" : ""}`}
                  />
                )}

                {decisionChart.riskZones.map((zone) => (
                  <rect
                    key={zone.key}
                    x={zone.x}
                    y="56"
                    width={Math.max(0, zone.width)}
                    height="196"
                    className="risk-viz-risk-zone"
                    data-testid={`risk-zone-${zone.key}`}
                  />
                ))}

                <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={BASELINE} y2={BASELINE} className="risk-viz-axis" />
                <line
                  x1={decisionChart.toX(nominal)}
                  x2={decisionChart.toX(nominal)}
                  y1="46"
                  y2={BASELINE + 8}
                  className="risk-viz-center-line"
                />

                {decisionChart.ootLowPath && (
                  <path
                    d={decisionChart.ootLowPath}
                    className="risk-viz-oot-fill"
                    data-testid="risk-oot-low"
                  />
                )}
                {decisionChart.ootHighPath && (
                  <path
                    d={decisionChart.ootHighPath}
                    className="risk-viz-oot-fill"
                    data-testid="risk-oot-high"
                  />
                )}

                <path
                  d={decisionChart.truePath}
                  fill={`url(#${gradientId}-true)`}
                  className="risk-viz-true-curve"
                />
                <path
                  d={decisionChart.observedPath}
                  fill={`url(#${gradientId}-observed)`}
                  className="risk-viz-observed-curve"
                />

                {decisionChart.rejectLowPath && (
                  <path
                    d={decisionChart.rejectLowPath}
                    className="risk-viz-reject-fill"
                    data-testid="risk-reject-low"
                  />
                )}
                {decisionChart.rejectHighPath && (
                  <path
                    d={decisionChart.rejectHighPath}
                    className="risk-viz-reject-fill"
                    data-testid="risk-reject-high"
                  />
                )}

                {/* Acceptance gate on the observed axis: results landing in
                    this span are accepted, outside it rejected. Its boundaries
                    are the acceptance limits — coincident with tolerance here,
                    pulled inward when guardbanded. */}
                <g className="risk-viz-accept-bracket" data-testid="risk-accept-bracket">
                  <line
                    x1={decisionChart.toX(acceptanceLow)}
                    x2={decisionChart.toX(acceptanceHigh)}
                    y1="238"
                    y2="238"
                  />
                  <line
                    x1={decisionChart.toX(acceptanceLow)}
                    x2={decisionChart.toX(acceptanceLow)}
                    y1="234"
                    y2="244"
                  />
                  <line
                    x1={decisionChart.toX(acceptanceHigh)}
                    x2={decisionChart.toX(acceptanceHigh)}
                    y1="234"
                    y2="244"
                  />
                  <text
                    x={decisionChart.toX((acceptanceLow + acceptanceHigh) / 2)}
                    y="232"
                    textAnchor="middle"
                    className="risk-viz-accept-label"
                  >
                    {guardbandEnabled ? "Accept (guardbanded)" : "Accept"} &mdash; observed result here
                  </text>
                </g>

                <LimitMarker
                  x={decisionChart.toX(toleranceLow)}
                  label="LTL"
                  value={toleranceLow}
                  unit={results.nativeUnit}
                  kind="tolerance"
                  top={32}
                  testId="risk-limit-tolerance-ltl"
                />
                <LimitMarker
                  x={decisionChart.toX(toleranceHigh)}
                  label="UTL"
                  value={toleranceHigh}
                  unit={results.nativeUnit}
                  kind="tolerance"
                  top={32}
                  testId="risk-limit-tolerance-utl"
                />
                {acceptanceDistinct && (
                  <>
                    <LimitMarker
                      x={decisionChart.toX(acceptanceLow)}
                      label={guardbandEnabled ? "GBL" : "LAL"}
                      value={acceptanceLow}
                      unit={results.nativeUnit}
                      kind="acceptance"
                      top={68}
                      testId={`risk-limit-acceptance-${guardbandEnabled ? "gbl" : "lal"}`}
                    />
                    <LimitMarker
                      x={decisionChart.toX(acceptanceHigh)}
                      label={guardbandEnabled ? "GBU" : "UAL"}
                      value={acceptanceHigh}
                      unit={results.nativeUnit}
                      kind="acceptance"
                      top={68}
                      testId={`risk-limit-acceptance-${guardbandEnabled ? "gbu" : "ual"}`}
                    />
                  </>
                )}

                <text x={decisionChart.toX(nominal)} y="284" className="risk-viz-axis-label" textAnchor="middle">
                  {formatNumber(nominal)} {results.nativeUnit}
                </text>
                <text x={decisionChart.toX(nominal)} y="310" className="risk-viz-nominal-label" textAnchor="middle">
                  Nominal / calculated mean
                </text>
                </svg>
              </div>
              <div className="risk-viz-chart-caption">
                <span>
                  The same limit lines gate <strong>both</strong> curves:{" "}
                  <strong>tolerance</strong> on the true curve (purple tails =
                  out of tolerance, &asymp; {formatNumber(decisionChart.pOOT, 3)}
                  %) and <strong>acceptance</strong> on the observed curve (amber
                  tails = rejected).
                </span>
                <span>
                  The observed curve is wider, so its rejected tails outsize the
                  true out-of-tolerance tails &mdash; that mismatch, inside the{" "}
                  <strong>&plusmn;U</strong> zones, is the false accept / reject
                  risk. Click a probability for the exact 2-D integral.
                </span>
              </div>
            </div>

            <aside className="risk-viz-outcomes">
              <div className="risk-viz-outcomes-heading">
                <span>Decision outcomes</span>
                <strong>{guardbandEnabled ? "Guardbanded" : "As specified"}</strong>
              </div>
              <button
                type="button"
                data-testid="risk-outcome-pfa"
                className={`risk-viz-outcome status-${pfaStatus(pfa)} ${activeModals.includes(
                  guardbandEnabled ? "gbpfa" : "pfa",
                ) ? "active" : ""}`}
                onClick={() => onShowBreakdown(guardbandEnabled ? "gbpfa" : "pfa")}
                onMouseEnter={() => setHovered("risk")}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered("risk")}
                onBlur={() => setHovered(null)}
              >
                <span className="risk-viz-outcome-icon">FA</span>
                <span>
                  <small>False accept probability</small>
                  <strong>{formatNumber(pfa, 4)}%</strong>
                  <em>Bad unit reported as passing</em>
                </span>
              </button>
              <button
                type="button"
                data-testid="risk-outcome-pfr"
                className={`risk-viz-outcome status-muted ${activeModals.includes(
                  guardbandEnabled ? "gbpfr" : "pfr",
                ) ? "active" : ""}`}
                onClick={() => onShowBreakdown(guardbandEnabled ? "gbpfr" : "pfr")}
                onMouseEnter={() => setHovered("risk")}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered("risk")}
                onBlur={() => setHovered(null)}
              >
                <span className="risk-viz-outcome-icon">FR</span>
                <span>
                  <small>False reject probability</small>
                  <strong>{formatNumber(pfr, 4)}%</strong>
                  <em>Good unit reported as failing</em>
                </span>
              </button>
              <div className="risk-viz-reading-guide">
                <p>Click a probability for the full calculation breakdown.</p>
              </div>
            </aside>
          </div>

          <div className="risk-viz-metrics">
            <MetricPill
              label="Combined standard uncertainty"
              value={`${formatNumber(results.uCal)} ${results.nativeUnit}`}
              hint="Calibration spread: widens the blue observed curve beyond the purple true-error curve"
              onClick={() => onShowBreakdown("inputs")}
              onMouseEnter={() => setHovered("ucal")}
              onMouseLeave={() => setHovered(null)}
            />
            <MetricPill
              label="Expanded uncertainty"
              value={`+/- ${formatNumber(results.expandedUncertainty)} ${results.nativeUnit}`}
              hint="Combined uncertainty x coverage factor k: the +/- reported with each result"
            />
            <MetricPill
              label="Tolerance used"
              value={`${formatNumber(results.LUp - results.LLow)} ${results.nativeUnit}`}
              hint="Green band: full span between the LTL and UTL markers"
            />
            <MetricPill
              label={guardbandEnabled ? "Guardband acceptance width" : "Acceptance width"}
              value={`${formatNumber(acceptanceHigh - acceptanceLow)} ${results.nativeUnit}`}
              hint={
                acceptanceDistinct
                  ? "Amber band: observed results inside it are reported as passing"
                  : "Matches the tolerance band: observed results inside it pass"
              }
              tone={guardbandEnabled ? "guardband" : "neutral"}
            />
          </div>
        </>
      )}

      {mode === "montecarlo" && (
        <>
          <div className="risk-viz-toolbar">
            <p className="risk-viz-mc-intro">
              Each dot is one simulated calibration: its true error (horizontal)
              versus the result you would observe (vertical).
            </p>
            {guardbandToggle}
          </div>

          <div className="risk-viz-main-grid">
            <div className="risk-viz-chart-card">
              <div className="risk-viz-chart-topline">
                <ZoomControls zoom={mcZoom} onChange={setMcZoom} />
              </div>
              <div className="risk-viz-canvas">
                <svg
                  className="risk-viz-svg montecarlo"
                  style={{ width: `${mcZoom * 100}%` }}
                  viewBox={`0 0 ${MC_WIDTH} ${MC_HEIGHT}`}
                  role="img"
                  aria-label="Monte Carlo simulation of true error versus observed result"
                >
                  {monteCarlo.regions.map((region) => (
                    <rect
                      key={region.key}
                      x={region.x}
                      y={region.y}
                      width={Math.max(0, region.width)}
                      height={Math.max(0, region.height)}
                      className={`risk-viz-mc-region ${region.outcome}`}
                    />
                  ))}
                  {monteCarlo.regions.map((region) =>
                    region.width > 56 && region.height > 36 ? (
                      <text
                        key={`label-${region.key}`}
                        x={region.x + region.width / 2}
                        y={region.y + region.height / 2 + 7}
                        textAnchor="middle"
                        className={`risk-viz-mc-region-label ${region.outcome}`}
                      >
                        {MC_OUTCOMES.find((o) => o.id === region.outcome).short}
                      </text>
                    ) : null,
                  )}

                  {/* Zero crosshair */}
                  <line
                    x1={monteCarlo.toX(0)}
                    x2={monteCarlo.toX(0)}
                    y1={MC_PLOT.top}
                    y2={MC_PLOT.bottom}
                    className="risk-viz-center-line"
                  />
                  <line
                    x1={MC_PLOT.left}
                    x2={MC_PLOT.right}
                    y1={monteCarlo.toY(0)}
                    y2={monteCarlo.toY(0)}
                    className="risk-viz-center-line"
                  />

                  {monteCarlo.points.map((point, index) => (
                    <circle
                      key={index}
                      cx={point.x.toFixed(1)}
                      cy={point.y.toFixed(1)}
                      r="2.4"
                      className={`risk-viz-mc-dot ${point.outcome}`}
                    />
                  ))}

                  {/* Tolerance limits on the true-error axis */}
                  {[
                    [monteCarlo.tolLow, "LTL"],
                    [monteCarlo.tolHigh, "UTL"],
                  ].map(([value, label]) => (
                    <g key={label}>
                      <line
                        x1={monteCarlo.toX(value)}
                        x2={monteCarlo.toX(value)}
                        y1={MC_PLOT.top - 6}
                        y2={MC_PLOT.bottom}
                        className="risk-viz-limit-line tolerance"
                      />
                      <text
                        x={monteCarlo.toX(value)}
                        y={MC_PLOT.top - 30}
                        textAnchor="middle"
                        className="risk-viz-limit-label tolerance"
                      >
                        {label}
                      </text>
                      <text
                        x={monteCarlo.toX(value)}
                        y={MC_PLOT.top - 13}
                        textAnchor="middle"
                        className="risk-viz-limit-value"
                      >
                        {formatNumber(value + monteCarlo.center)}{" "}
                        {results.nativeUnit}
                      </text>
                    </g>
                  ))}

                  {/* Acceptance limits on the observed-result axis */}
                  {[
                    [monteCarlo.accLow, guardbandEnabled ? "GBL" : "LAL"],
                    [monteCarlo.accHigh, guardbandEnabled ? "GBU" : "UAL"],
                  ].map(([value, label]) => (
                    <g key={label}>
                      <line
                        x1={MC_PLOT.left}
                        x2={MC_PLOT.right}
                        y1={monteCarlo.toY(value)}
                        y2={monteCarlo.toY(value)}
                        className="risk-viz-limit-line acceptance"
                      />
                      <text
                        x={MC_PLOT.right - 6}
                        y={monteCarlo.toY(value) - 7}
                        textAnchor="end"
                        className="risk-viz-limit-label acceptance"
                      >
                        {label} {formatNumber(value + monteCarlo.center)}{" "}
                        {results.nativeUnit}
                      </text>
                    </g>
                  ))}

                  {/* Axes */}
                  <text
                    x={(MC_PLOT.left + MC_PLOT.right) / 2}
                    y={MC_HEIGHT - 14}
                    textAnchor="middle"
                    className="risk-viz-mc-axis-title"
                  >
                    True UUT error (relative to nominal)
                  </text>
                  <text
                    x="0"
                    y="0"
                    textAnchor="middle"
                    transform={`translate(24 ${(MC_PLOT.top + MC_PLOT.bottom) / 2}) rotate(-90)`}
                    className="risk-viz-mc-axis-title"
                  >
                    Observed result error
                  </text>
                  {[-monteCarlo.xMax, 0, monteCarlo.xMax].map((value, index) => (
                    <text
                      key={`x-${index}`}
                      x={monteCarlo.toX(value)}
                      y={MC_PLOT.bottom + 26}
                      textAnchor={index === 0 ? "start" : index === 2 ? "end" : "middle"}
                      className="risk-viz-axis-label"
                    >
                      {formatNumber(value, 3)}
                    </text>
                  ))}
                  {[-monteCarlo.yMax, monteCarlo.yMax].map((value, index) => (
                    <text
                      key={`y-${index}`}
                      x={MC_PLOT.left - 8}
                      y={monteCarlo.toY(value) + (index === 0 ? 0 : 14)}
                      textAnchor="end"
                      className="risk-viz-axis-label"
                    >
                      {formatNumber(value, 3)}
                    </text>
                  ))}
                </svg>
              </div>
              <div className="risk-viz-chart-caption">
                <span>
                  Dots cluster along the diagonal because the observed result
                  follows the true error (correlation ρ ={" "}
                  {formatNumber(monteCarlo.correlation, 3)}).
                  {monteCarlo.empirical &&
                    " Measurement errors are drawn from this point's actual Monte Carlo distribution (GUM-S1), so these quadrants match the reported empirical PFA/PFR."}
                </span>
              </div>
            </div>

            <aside className="risk-viz-outcomes">
              <div className="risk-viz-outcomes-heading">
                <span>Simulated outcomes</span>
                <strong>{MC_SAMPLES.toLocaleString()} trials</strong>
              </div>
              {MC_OUTCOMES.map((outcome) => {
                const simulated = (monteCarlo.counts[outcome.id] / MC_SAMPLES) * 100;
                const calculated = calculatedRisk[outcome.id];
                const clickable = outcome.id === "fa" || outcome.id === "fr";
                const content = (
                  <>
                    <span className={`risk-viz-outcome-icon mc-${outcome.id}`}>
                      {outcome.short}
                    </span>
                    <span>
                      <small>{outcome.label}</small>
                      <strong>{formatNumber(simulated, 3)}%</strong>
                      <em>
                        {outcome.description}
                        {calculated !== undefined &&
                          ` - calculated ${formatNumber(calculated, 4)}%`}
                      </em>
                    </span>
                  </>
                );
                return clickable ? (
                  <button
                    type="button"
                    key={outcome.id}
                    className={`risk-viz-outcome mc-${outcome.id}`}
                    onClick={() =>
                      onShowBreakdown(
                        outcome.id === "fa"
                          ? guardbandEnabled ? "gbpfa" : "pfa"
                          : guardbandEnabled ? "gbpfr" : "pfr",
                      )
                    }
                  >
                    {content}
                  </button>
                ) : (
                  <div key={outcome.id} className={`risk-viz-outcome static mc-${outcome.id}`}>
                    {content}
                  </div>
                );
              })}
              <div className="risk-viz-reading-guide">
                <p>
                  False accept and false reject percentages converge toward the
                  calculated PFA / PFR as more trials are simulated. Click
                  either one for the exact integral breakdown.
                </p>
              </div>
            </aside>
          </div>
        </>
      )}

      {mode === "component" && (
        <div className="risk-viz-component-view">
          <div className="risk-viz-component-controls">
            <label htmlFor="risk-component-select">Budget component</label>
            <select
              id="risk-component-select"
              value={selectedComponent?.id || ""}
              onChange={(event) => setSelectedComponentId(event.target.value)}
            >
              {componentOptions.map((component) => (
                <option key={component.id} value={component.id}>
                  {component.name} - {component.source}
                </option>
              ))}
            </select>
            {selectedComponent && (
              <div className="risk-viz-component-meta">
                <span><small>Distribution</small><strong>{selectedComponent.distribution}</strong></span>
                <span><small>Type</small><strong>Type {selectedComponent.type}</strong></span>
                <span><small>Quantity</small><strong>{selectedComponent.quantity}</strong></span>
              </div>
            )}
          </div>

          {selectedComponent && componentChart && (
            <div className="risk-viz-component-chart">
              <div className="risk-viz-chart-topline">
                <ZoomControls zoom={componentZoom} onChange={setComponentZoom} />
              </div>
              <div className="risk-viz-canvas">
                <svg
                  className="risk-viz-svg component"
                  style={{ width: `${componentZoom * 100}%` }}
                  viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                  role="img"
                  aria-label={`${selectedComponent.name} uncertainty distribution`}
                >
                <defs>
                  <linearGradient id={`${gradientId}-component`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.48" />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.03" />
                  </linearGradient>
                </defs>
                <rect
                  x={componentChart.toX(-componentChart.limit)}
                  y="56"
                  width={
                    componentChart.toX(componentChart.limit) -
                    componentChart.toX(-componentChart.limit)
                  }
                  height="196"
                  className="risk-viz-component-limit-band"
                />
                <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={BASELINE} y2={BASELINE} className="risk-viz-axis" />
                <line
                  x1={componentChart.toX(0)}
                  x2={componentChart.toX(0)}
                  y1="46"
                  y2={BASELINE + 8}
                  className="risk-viz-center-line"
                />
                <path
                  d={componentChart.path}
                  fill={`url(#${gradientId}-component)`}
                  className="risk-viz-component-curve"
                />
                <LimitMarker
                  x={componentChart.toX(-componentChart.limit)}
                  label="- limit"
                  value={-componentChart.limit}
                  unit={selectedComponent.unit}
                  kind="tolerance"
                  top={32}
                  testId="component-limit-lower"
                />
                <LimitMarker
                  x={componentChart.toX(componentChart.limit)}
                  label="+ limit"
                  value={componentChart.limit}
                  unit={selectedComponent.unit}
                  kind="tolerance"
                  top={32}
                  testId="component-limit-upper"
                />
                <text x={componentChart.toX(0)} y="284" className="risk-viz-axis-label" textAnchor="middle">0</text>
                <text x={componentChart.toX(0)} y="310" className="risk-viz-nominal-label" textAnchor="middle">
                  Error relative to nominal
                </text>
                </svg>
              </div>
              <div className="risk-viz-component-readouts">
                <MetricPill
                  label="Tolerance / error limit"
                  value={`+/- ${formatNumber(componentChart.limit)} ${selectedComponent.unit}`}
                  hint="Shaded band: the component's full error containment"
                />
                <MetricPill
                  label="Distribution divisor"
                  value={divisorDescription(
                    selectedComponent.distribution,
                    selectedComponent.divisor,
                  )}
                  hint="Converts the limit to a standard uncertainty"
                />
                <MetricPill
                  label="Standard uncertainty"
                  value={`${formatNumber(componentChart.standard)} ${selectedComponent.unit}`}
                  hint="Limit / divisor: what enters the combined budget"
                  tone="primary"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default RiskDistributionVisualizer;
