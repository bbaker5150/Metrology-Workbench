import React, { useState, useMemo, useEffect, useRef } from "react";
import { unitSystem, errorDistributions } from "../../../utils/uncertaintyMath";
import { oldErrorDistributions } from "../utils/budgetUtils";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalculator,
  faCog,
  faPlus,
  faPencilAlt,
  faRedo,
  faProjectDiagram,
  faExclamationTriangle,
} from "@fortawesome/free-solid-svg-icons";

const DIST_OPTIONS = [
  "Normal",
  "Rectangular",
  "Triangular",
  "U-Shaped",
  "Lognormal",
  "Rayleigh",
];

const DIST_SELECT_STYLE = {
  width: "100%",
  padding: "2px 4px",
  backgroundColor: "transparent",
  color: "inherit",
  border: "1px solid transparent",
  borderRadius: "4px",
  fontSize: "inherit",
  cursor: "pointer",
  textAlign: "left",
};

const formatNumber = (value, sigFigs = 4) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return n.toPrecision(sigFigs);
};

// Blank when there is no finite DOF to report (Type B / ν = ∞), per the drafted
// layout — an empty cell reads cleaner than "Not used".
const formatDof = (dof) => {
  const n = Number(dof);
  if (dof === Infinity || !Number.isFinite(n)) return "";
  return formatNumber(n, 4);
};

// A component is "entered as a standard uncertainty" (Type A results, or a
// Type B typed in directly as uᵢ) when there is no underlying tolerance/error
// limit to show. For these the Tolerance Limit column is left blank — the value
// lives in the Standard Uncertainty column instead.
const isStandardUncertaintyEntry = (component) => {
  if (component.type === "A") return true;
  if (component.originalInput?.inputMode === "standard") return true;
  const dist = component.distribution || "";
  return /std\.?\s*unc/i.test(dist) || dist === "Other (Std. Unc.)";
};

// The tolerance (error) limit is the half-span the spec was entered as, i.e.
// the standard uncertainty multiplied back up by its distribution divisor:
//   limit = uᵢ × divisor.
const getComponentToleranceLimit = (component, std) => {
  let divisor =
    parseFloat(component.distributionDivisor) ||
    parseFloat(component.originalInput?.errorDistributionDivisor);
  if (!Number.isFinite(divisor) || divisor <= 0) divisor = 1;
  return { value: std.value * divisor, unit: std.unit };
};

const getComponentStdUncertainty = (component, fallbackUnit) => {
  if (component.value_native !== undefined && component.unit_native) {
    return {
      value: component.value_native,
      unit: component.unit_native,
    };
  }

  if (component.isBaseUnitValue && Number.isFinite(Number(component.value))) {
    const unit = component.unit_native || component.unit || fallbackUnit;
    const nativeUnitInfo = unitSystem.units[unit];
    if (nativeUnitInfo?.to_si) {
      return {
        value: Number(component.value) / nativeUnitInfo.to_si,
        unit,
      };
    }
  }

  return {
    value: component.value,
    unit: component.unit_native || component.unit || fallbackUnit || "ppm",
  };
};

// Human-readable tooltip describing how a row deviates from the found spec.
const buildDeviationTitle = (component) => {
  const base = component.specBaseline || {};
  const parts = [];
  if (base.valueOverridden && base.value != null) {
    const currentValue = component.manualRawValue;
    parts.push(
      currentValue != null
        ? `Value changed from ${base.value}${base.unit ? ` ${base.unit}` : ""} (spec) to ${currentValue}${component.manualUnit ? ` ${component.manualUnit}` : ""} (current)`
        : `Value differs from the ${base.value}${base.unit ? ` ${base.unit}` : ""} instrument spec`,
    );
  }
  if (base.distributionOverridden) {
    const specDistribution = base.distributionLabel || "the instrument spec";
    const currentDistribution =
      component.distribution ||
      component.distributionDivisor ||
      "the current selection";
    parts.push(
      `Distribution changed from ${specDistribution} (spec) to ${currentDistribution} (current)`,
    );
  }
  if (parts.length === 0) return "Modified from the instrument's found spec.";
  return `Modified from the instrument's found spec — ${parts.join(
    " and ",
  )}.`;
};

// Subtle amber warning-triangle shown beside a source name when the row has
// been tweaked away from the instrument's specified value/distribution.
const DeviationFlag = ({ component }) => {
  if (!component.specOverride) return null;
  return (
    <span
      className="budget-deviation-flag"
      title={buildDeviationTitle(component)}
      aria-label={buildDeviationTitle(component)}
      style={{
        marginLeft: 6,
        color: "var(--status-warning, #e0a106)",
        cursor: "help",
        display: "inline-flex",
        verticalAlign: "middle",
      }}
    >
      <FontAwesomeIcon
        icon={faExclamationTriangle}
        style={{ fontSize: "0.78em" }}
      />
    </span>
  );
};

// Inline editor for a manual Type-B component's entered magnitude. Commits the
// raw value (in its own unit) back through onComponentUpdate, which prompts the
// user to keep the change for this point or the whole session.
const ManualValueCell = ({ component, onCommit, suffix }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const original =
    component.manualRawValue != null ? String(component.manualRawValue) : "";

  const begin = () => {
    setDraft(original);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const parsed = parseFloat(draft);
    if (!isNaN(parsed) && String(parsed) !== String(component.manualRawValue)) {
      onCommit?.(parsed);
    }
  };

  if (!editing) {
    return (
      <span
        className="budget-editable-value"
        title="Click to edit the entered value"
        onClick={begin}
        style={{
          cursor: "pointer",
          borderBottom: "1px dotted var(--border-color)",
        }}
      >
        {original || "—"}
        {suffix ? ` ${suffix}` : ""}
      </span>
    );
  }

  return (
    <input
      autoFocus
      type="number"
      className="mini-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      style={{
        width: "80px",
        padding: "2px 4px",
        background: "transparent",
        color: "inherit",
        border: "1px solid var(--primary-color)",
        borderRadius: 4,
      }}
    />
  );
};

const ResultsCard = ({
  title = "Results",
  results,
  unit,
  sigFigs,
  isFinal,
  useEffectiveDof,
  onToggleEffectiveDof,
  method = "linear",
}) => {
  // When effective DOF is off, ν_eff is not applied to k, so leave it blank.
  const effDofDisplay = useEffectiveDof ? formatDof(results?.effective_dof) : "";
  const unitSuffix = unit ? ` ${unit}` : "";

  return (
    <aside className={`budget-results-card ${isFinal ? "final" : ""}`}>
      <div className="budget-results-title">
        {title}
        {method === "montecarlo" && (
          <span className="method-chip">Monte Carlo</span>
        )}
      </div>
      <div className="budget-results-row">
        <span>Combined Uncertainty</span>
        <strong>
          {formatNumber(results?.combined, sigFigs)}
          {unitSuffix}
        </strong>
      </div>
      <div className="budget-results-row">
        <span className="budget-results-dof-label">
          <label
            className="direction-toggle-switch"
            title="Apply Welch–Satterthwaite effective degrees of freedom"
          >
            <input
              type="checkbox"
              checked={!!useEffectiveDof}
              disabled={method === "montecarlo"}
              onChange={(e) => onToggleEffectiveDof?.(e.target.checked)}
            />
            <span className="direction-toggle-slider"></span>
          </label>
          Effective DOF
        </span>
        <strong>{method === "montecarlo" ? "Empirical" : effDofDisplay}</strong>
      </div>
      <div className="budget-results-row">
        <span>Coverage Factor (k)</span>
        <strong>{formatNumber(results?.k_value, sigFigs)}</strong>
      </div>
      <div className="budget-results-row">
        <span>Expanded Uncertainty</span>
        <strong>
          {formatNumber(results?.expanded, sigFigs)}
          {unitSuffix}
        </strong>
      </div>
    </aside>
  );
};

const UncertaintyBudgetTable = ({
  components,
  onRemove,
  onEdit,
  calcResults,
  referencePoint,
  uncertaintyConfidence,
  onRowContextMenu,
  equationString,
  measurementType,
  riskResults,
  onShowDerivedBreakdown,
  onShowRiskBreakdown,
  showContribution,
  setShowContribution,
  onAddManualComponent,
  onAddTmdeToBudget,
  onOpenRepeatability,
  setNotification,
  onComponentUpdate,
  onOpenCorrelation,
  onBudgetSettingsChange,
  useEffectiveDofByGroup = {},
  propagationMode = "linear",
  mcSummary = null,
}) => {
  // Effective DOF is toggled per (sub)budget. Persist the change as a patch to
  // the keyed map (variableType / "equation" / "final"). Default ON.
  const handleToggleEffectiveDof = (groupKey, checked) =>
    onBudgetSettingsChange?.({
      useEffectiveDofByGroup: { ...useEffectiveDofByGroup, [groupKey]: checked },
    });
  const groupDofKey = (group) =>
    group.kind === "input"
      ? group.variableType
      : group.kind === "equation"
        ? "equation"
        : "final";
  const confidencePercent = parseFloat(uncertaintyConfidence) || 95;
  const derivedUnit = referencePoint?.unit || "Units";
  const derivedName = referencePoint?.name || "Derived";
  const isDirect = measurementType === "direct";
  const [showGuardband, setShowGuardband] = useState(false);
  const [uiSigFigs] = useState(4);
  const [uncertaintySigFigsByGroup, setUncertaintySigFigsByGroup] = useState(
    {},
  );
  const [expandedSigFigs, setExpandedSigFigs] = useState(5);
  const [riskSigFigs, setRiskSigFigs] = useState(4);
  const [showSettings, setShowSettings] = useState(false);
  const [openSectionSettings, setOpenSectionSettings] = useState(null);
  const settingsRef = useRef(null);
  const getGroupSigFigs = (group) =>
    uncertaintySigFigsByGroup[group.id] ?? 4;

  useEffect(() => {
    function handleClickOutside(event) {
      if (settingsRef.current && !settingsRef.current.contains(event.target)) {
        setShowSettings(false);
      }
      if (!event.target.closest(".budget-section-settings-wrap")) {
        setOpenSectionSettings(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const derivedSymbol = useMemo(() => {
    if (measurementType !== "derived" || !equationString) return null;
    const eqParts = equationString.split("=");
    return eqParts.length > 1 ? eqParts[0].trim() : null;
  }, [equationString, measurementType]);

  const budgetTitle = derivedSymbol
    ? `${derivedName} (${derivedSymbol}) Uncertainty Budget`
    : `${derivedName} Uncertainty Budget`;

  const groups = useMemo(() => {
    if (calcResults?.calculatedBudgetGroups?.length) {
      return calcResults.calculatedBudgetGroups;
    }
    return [
      {
        id: "final_budget",
        kind: "final",
        label: `${derivedName || "Final"} Uncertainty Budget`,
        unit: derivedUnit,
        components: components || [],
        results: {
          combined: calcResults?.combined_uncertainty,
          effective_dof: calcResults?.effective_dof,
          k_value: calcResults?.k_value,
          expanded: calcResults?.expanded_uncertainty,
        },
      },
    ];
  }, [calcResults, components, derivedName, derivedUnit]);

  const renderDistributionCell = (component) => {
    if (component.sourceTmdeId || component.isCore || component.isResolution) {
      return <span>{component.distribution || "Normal"}</span>;
    }

    if (component.originalInput !== undefined) {
      if (component.type === "A") {
        return <span>{component.distribution || "Normal"}</span>;
      }
      return (
        <select
          className="mini-select"
          value={component.originalInput.errorDistributionDivisor || "1.732"}
          onChange={(e) =>
            onComponentUpdate?.(component.id, { distribution: e.target.value }, component)
          }
          style={DIST_SELECT_STYLE}
        >
          {oldErrorDistributions.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      );
    }

    if (component.distributionDivisor !== undefined) {
      return (
        <select
          className="mini-select"
          value={component.distributionDivisor}
          onChange={(e) =>
            onComponentUpdate?.(component.id, { distribution: e.target.value }, component)
          }
          style={DIST_SELECT_STYLE}
        >
          {errorDistributions.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      );
    }

    if (component.distribution === "Other (Std. Unc.)") {
      return <span>Other (Std. Unc.)</span>;
    }

    return (
      <select
        className="mini-select"
        value={component.distribution || "Normal"}
        onChange={(e) =>
          onComponentUpdate?.(component.id, { distribution: e.target.value }, component)
        }
        style={DIST_SELECT_STYLE}
      >
        {DIST_OPTIONS.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    );
  };

  const renderActions = (component) => {
    // The UUT resolution is opted into the budget from the add menu, so it gets a
    // remove control here (but not the manual-component edit pencil).
    if (component.isResolution) {
      return (
        <div className="budget-row-actions">
          <span
            onClick={() => onRemove?.(component.id, component)}
            className="delete-action"
            title="Remove from budget"
          >
            x
          </span>
        </div>
      );
    }
    if (component.isCore && !component.sourceTmdeId) return null;
    // A TMDE-sourced row's tolerance is edited directly on the instrument tables
    // now, so it only gets a remove control here — no edit pencil.
    const showEdit = !component.missingTolerance && !component.sourceTmdeId;
    return (
      <div className="budget-row-actions">
        {showEdit && (
          <span
            onClick={(e) => onEdit?.(e, component)}
            className="action-icon"
            title="Edit Component"
          >
            <FontAwesomeIcon icon={faPencilAlt} />
          </span>
        )}
        <span
          onClick={() => onRemove?.(component.id, component)}
          className="delete-action"
          title="Remove Component"
        >
          x
        </span>
      </div>
    );
  };

  const renderComponentTable = (group) => (
    <table className="uncertainty-budget-table">
      <thead>
        <tr>
          <th>Error Source Name</th>
          <th>Source / Nominal</th>
          <th>Tolerance Limit</th>
          <th>Error Limit Distribution</th>
          <th>Type (A/B)</th>
          <th>DOF</th>
          <th>Standard Uncertainty</th>
          <th></th>
        </tr>
      </thead>
      <tbody className="component-group-tbody">
        {(group.components || []).map((component) => {
          const std = getComponentStdUncertainty(component, group.unit);
          const tolLimit = getComponentToleranceLimit(component, std);
          const quantity = component.quantity || 1;
          const displayName =
            quantity > 1 ? `${component.name} (Qty: ${quantity})` : component.name;
          const isStdEntry = isStandardUncertaintyEntry(component);
          // The entered magnitude of a manual Type-B is editable inline. A
          // tolerance-mode entry edits the Tolerance Limit cell; a directly-
          // entered standard uncertainty edits the Standard Uncertainty cell.
          const editableTolerance = component.isManual && !isStdEntry;
          const editableStd = component.isManual && isStdEntry;
          const commitManualValue = (value) =>
            onComponentUpdate?.(component.id, { manualValue: value }, component);
          return (
            <tr
              key={component.id}
              onContextMenu={(e) => onRowContextMenu?.(e, component)}
            >
              <td>
                {displayName}
                <DeviationFlag component={component} />
              </td>
              <td>{component.sourcePointLabel || "N/A"}</td>
              <td>
                {editableTolerance ? (
                  <ManualValueCell
                    component={component}
                    onCommit={commitManualValue}
                    suffix={component.manualUnit || tolLimit.unit}
                  />
                ) : isStdEntry ? (
                  ""
                ) : (
                  `${formatNumber(tolLimit.value, uiSigFigs)} ${tolLimit.unit}`
                )}
              </td>
              <td>{renderDistributionCell(component)}</td>
              <td>{component.type || "B"}</td>
              <td>{formatDof(component.dof)}</td>
              <td>
                {editableStd ? (
                  <ManualValueCell
                    component={component}
                    onCommit={commitManualValue}
                    suffix={component.manualUnit || std.unit}
                  />
                ) : (
                  `${formatNumber(std.value, getGroupSigFigs(group))} ${std.unit}`
                )}
              </td>
              <td className="action-cell">{renderActions(component)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const renderEquationTable = (group) => (
    <>
    <table className="uncertainty-budget-table">
      <thead>
        <tr>
          <th>Input Variable</th>
          <th>Nominal Value</th>
          <th>DOF</th>
          <th>Standard Uncertainty</th>
          <th>Sensitivity Coefficient</th>
          <th>Contribution</th>
        </tr>
      </thead>
      <tbody className="component-group-tbody">
        {(group.rows || []).map((row) => (
          <tr key={row.id}>
            <td>{row.name}</td>
            <td>{row.nominalValue || "N/A"}</td>
            <td>{formatDof(row.dof)}</td>
            <td>
              {formatNumber(row.standardUncertainty, getGroupSigFigs(group))}{" "}
              {row.unit}
            </td>
            <td>{formatNumber(row.sensitivityCoefficient, 4)}</td>
            <td>
              {formatNumber(row.contribution, getGroupSigFigs(group))}{" "}
              {derivedUnit}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    {group.correlationApplied && (
      <p className="budget-correlation-note">
        Combined uncertainty includes input correlations (ρ); without
        correlation (RSS) it would be{" "}
        {formatNumber(group.uncorrelatedCombined, getGroupSigFigs(group))}{" "}
        {group.unit}.
      </p>
    )}
    </>
  );

  const getPfaClass = (pfa) => {
    if (pfa > 5) return "status-bad";
    if (pfa > 2) return "status-warning";
    return "status-good";
  };

  const handleGuardbandToggle = (isChecked) => {
    setShowGuardband(isChecked);
    if (!isChecked) return;
    const gbLowValid =
      riskResults?.gbResults?.GBLOW !== undefined &&
      !isNaN(riskResults.gbResults.GBLOW);
    const gbUpValid =
      riskResults?.gbResults?.GBUP !== undefined &&
      !isNaN(riskResults.gbResults.GBUP);
    if (gbLowValid && gbUpValid) return;
    setNotification?.({
      title: "Convergence Failure",
      isFloating: true,
      message:
        "The math engine could not converge on guard band limits because the calculated TUR is significantly lower than the required TUR. Increase the required TUR or improve the uncertainty budget to allow a viable solution.",
    });
  };

  // Slim risk metric cards for the bottom of the panel. These mirror the
  // sidebar columns but give an at-a-glance read for the open point; clicking a
  // card opens its breakdown (same handler as the sidebar).
  const renderRiskMetrics = () => {
    if (!riskResults) return null;
    const corePods = [
      ["pfa", "PFA", `${riskResults.pfa?.toPrecision(riskSigFigs)}%`, getPfaClass(riskResults.pfa)],
      ["pfr", "PFR", `${riskResults.pfr?.toPrecision(riskSigFigs)}%`, "neutral"],
      ["tur", "TUR", `${riskResults.tur?.toFixed(2)}:1`, "neutral"],
    ];
    if (isDirect) {
      corePods.push(["tar", "TAR", `${riskResults.tar?.toFixed(2)}:1`, "neutral"]);
    }
    const gb = riskResults.gbResults;
    const fmtGb = (v) =>
      Number.isFinite(Number(v)) ? Number(v).toPrecision(riskSigFigs) : "N/A";

    return (
      <div className="budget-risk-strip">
        <div className="budget-risk-pods">
          {corePods.map(([key, label, value, klass]) => (
            <button
              type="button"
              key={key}
              className={`risk-pod ${klass}`}
              onClick={() => onShowRiskBreakdown?.(key)}
              title={`${label} — view breakdown`}
            >
              <span className="risk-pod-label">{label}</span>
              <span className="risk-pod-value">{value}</span>
            </button>
          ))}
        </div>
        {showGuardband && gb && (
          <div className="budget-risk-pods guardband">
            {[
              ["gblow", "GB Low", fmtGb(gb.GBLOW)],
              ["gbhigh", "GB High", fmtGb(gb.GBUP)],
              ["gbmult", "GB Mult", `${fmtGb(gb.GBMULT)}%`],
              ["gbpfa", "PFA·GB", `${fmtGb(gb.GBPFA)}%`],
              ["gbpfr", "PFR·GB", `${fmtGb(gb.GBPFR)}%`],
            ].map(([key, label, value]) => (
              <button
                type="button"
                key={key}
                className="risk-pod neutral"
                onClick={() => onShowRiskBreakdown?.(key)}
                title={`${label} — view breakdown`}
              >
                <span className="risk-pod-label">{label}</span>
                <span className="risk-pod-value">{value}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Compact settings popover for the bottom readout. Only controls the sig figs
  // shown in THIS results area (expanded uncertainty + risk metrics) — the
  // budget tables above format independently.
  const renderResultSettings = () => (
    <div ref={settingsRef} className="budget-settings-wrap">
      <button
        type="button"
        className="budget-result-settings-btn"
        onClick={() => setShowSettings(!showSettings)}
        title="Display settings"
      >
        <FontAwesomeIcon icon={faCog} />
      </button>
      {showSettings && (
        <div className="budget-settings-menu">
          <h5>Display</h5>
          <label className="budget-settings-check">
            <input
              type="checkbox"
              checked={showContribution}
              onChange={(e) => setShowContribution(e.target.checked)}
            />
            Show contribution
          </label>
          <label className="budget-settings-check">
            <input
              type="checkbox"
              checked={showGuardband}
              onChange={(e) => handleGuardbandToggle(e.target.checked)}
            />
            Show guardband
          </label>
          <h5>Display Precision</h5>
          <label>
            Expanded Unc (U) Sig Figs
            <input
              type="number"
              min="1"
              max="10"
              value={expandedSigFigs}
              onChange={(e) =>
                setExpandedSigFigs(Math.max(1, parseInt(e.target.value) || 2))
              }
            />
          </label>
          <label>
            Risk Sig Figs
            <input
              type="number"
              min="1"
              max="10"
              value={riskSigFigs}
              onChange={(e) =>
                setRiskSigFigs(Math.max(1, parseInt(e.target.value) || 2))
              }
            />
          </label>
        </div>
      )}
    </div>
  );

  const getGroupScope = (group) => ({
    variableType: group.variableType,
    label: group.label.replace(/\s+Uncertainty Budget$/i, ""),
    nominalPoint: group.nominalPoint || {
      value: group.nominalValue,
      unit: group.unit,
    },
  });

  const runSectionAction = (action) => {
    setOpenSectionSettings(null);
    action();
  };

  const canAddTmdeForGroup = (group) =>
    Boolean(onAddTmdeToBudget) &&
    ((measurementType === "derived" && group.kind === "input") ||
      (measurementType === "direct" && group.kind === "final"));

  const renderSectionSettings = (group) => {
    const canAddManual =
      group.kind === "input" ||
      group.kind === "equation" ||
      group.kind === "final";
    const canAddRepeatability =
      group.kind === "input" || (isDirect && group.kind === "final");

    return (
      <div className="budget-section-settings-wrap">
        <button
          type="button"
          title={`Settings for ${group.label}`}
          aria-label={`Settings for ${group.label}`}
          aria-expanded={openSectionSettings === group.id}
          onClick={() =>
            setOpenSectionSettings((open) =>
              open === group.id ? null : group.id,
            )
          }
        >
          <FontAwesomeIcon icon={faCog} />
        </button>
        {openSectionSettings === group.id && (
          <div className="budget-settings-menu budget-section-settings-menu">
            {(canAddManual ||
              canAddRepeatability ||
              group.kind === "equation") && <h5>Actions</h5>}
            {canAddManual && (
              <button
                type="button"
                className="budget-settings-action"
                onClick={() =>
                  runSectionAction(() =>
                    onAddManualComponent?.(
                      group.kind === "input" ? getGroupScope(group) : null,
                    ),
                  )
                }
              >
                <FontAwesomeIcon icon={faPlus} />
                Add Manual Component
              </button>
            )}
            {canAddRepeatability && (
              <button
                type="button"
                className="budget-settings-action"
                onClick={(event) =>
                  runSectionAction(() =>
                    group.kind === "input"
                      ? onOpenRepeatability?.(event, getGroupScope(group))
                      : onOpenRepeatability?.(event),
                  )
                }
              >
                <FontAwesomeIcon icon={faRedo} />
                Repeatability
              </button>
            )}
            {group.kind === "equation" && (
              <>
                {onOpenCorrelation && components?.length >= 2 && (
                  <button
                    type="button"
                    className="budget-settings-action"
                    onClick={() => runSectionAction(onOpenCorrelation)}
                  >
                    <FontAwesomeIcon icon={faProjectDiagram} />
                    Input Correlation Matrix
                  </button>
                )}
                <button
                  type="button"
                  className="budget-settings-action"
                  onClick={() => runSectionAction(onShowDerivedBreakdown)}
                >
                  <FontAwesomeIcon icon={faCalculator} />
                  Calculation Breakdown
                </button>
              </>
            )}
            <h5>Table Precision</h5>
            <label>
              Uncertainty Sig Figs
              <input
                type="number"
                min="1"
                max="10"
                value={getGroupSigFigs(group)}
                onChange={(event) =>
                  setUncertaintySigFigsByGroup((current) => ({
                    ...current,
                    [group.id]: Math.min(
                      10,
                      Math.max(1, parseInt(event.target.value, 10) || 1),
                    ),
                  }))
                }
              />
            </label>
          </div>
        )}
      </div>
    );
  };

  const finalGroup = groups.find((group) => group.kind === "final");
  const usesMonteCarlo =
    propagationMode === "montecarlo" &&
    riskResults?.riskMethod === "empirical" &&
    mcSummary;
  let mcNative = null;
  if (usesMonteCarlo) {
    const convert = (value) => unitSystem.fromBaseUnit(value, derivedUnit);
    const mean = convert(mcSummary.meanBase);
    const low = convert(mcSummary.intervalLowBase);
    const high = convert(mcSummary.intervalHighBase);
    const combined = convert(mcSummary.uBase);
    const up = high - mean;
    const down = mean - low;
    const expanded = (up + down) / 2;
    mcNative = {
      combined,
      expanded,
      up,
      down,
      k_value: combined > 0 ? expanded / combined : null,
      effective_dof: null,
    };
  }
  const finalDisplayResults = mcNative || finalGroup?.results;
  const finalExpanded = finalDisplayResults?.expanded;
  // Coverage factor for the footnote — read from the SAME computed result the
  // expanded uncertainty above uses, never hardcoded. It already tracks the
  // configured confidence and any Type A repeatability that lowers the
  // effective DOF (which raises k via the Student-t quantile).
  const displayK = finalDisplayResults?.k_value ?? calcResults?.k_value;

  return (
    <div className="budget-stack">
      <div className="budget-stack-header">
        <div>
          <h3 className="panel-section-title">
            {budgetTitle}
          </h3>
        </div>
      </div>

      {groups.map((group) => (
        <React.Fragment key={group.id}>
          <section className="budget-section-row">
            <div
              className={`budget-stack-section ${group.kind === "final" ? "final" : ""}`}
            >
              <div className="budget-section-title-row">
                <h4>{group.label}</h4>
                <div className="budget-section-title-actions">
                  {canAddTmdeForGroup(group) && (
                    <button
                      type="button"
                      className="btn-add-item"
                      title={`Add TMDE to ${group.label}`}
                      aria-label={`Add TMDE to ${group.label}`}
                      onClick={(event) =>
                        onAddTmdeToBudget(getGroupScope(group), event)
                      }
                    >
                      <FontAwesomeIcon icon={faPlus} size="xs" />
                    </button>
                  )}
                  {renderSectionSettings(group)}
                </div>
              </div>
              <div className="budget-section-table-wrap">
                {group.kind === "equation"
                  ? renderEquationTable(group)
                  : renderComponentTable(group)}
              </div>
            </div>
            <ResultsCard
              title={group.kind === "final" ? "Final Results" : "Results"}
              results={
                group.kind === "final" && mcNative ? mcNative : group.results
              }
              unit={group.unit}
              sigFigs={getGroupSigFigs(group)}
              isFinal={group.kind === "final"}
              useEffectiveDof={
                (useEffectiveDofByGroup[groupDofKey(group)] ?? true) !== false
              }
              onToggleEffectiveDof={(checked) =>
                handleToggleEffectiveDof(groupDofKey(group), checked)
              }
              method={
                group.kind === "final" && usesMonteCarlo
                  ? "montecarlo"
                  : "linear"
              }
            />
          </section>
        </React.Fragment>
      ))}

      {calcResults && (
        <div className="final-result-display budget-stack-final-display">
          <div className="budget-final-toggles">{renderResultSettings()}</div>
          <span className="final-result-label final-result-label-row">
            Expanded Uncertainty (U)
            {usesMonteCarlo && <span className="method-chip">Monte Carlo</span>}
          </span>
          <div className="final-result-value">
            {usesMonteCarlo
              ? `+${formatNumber(mcNative.up, expandedSigFigs)} / -${formatNumber(
                  mcNative.down,
                  expandedSigFigs,
                )}`
              : `+/- ${formatNumber(finalExpanded, expandedSigFigs)}`}
            <span className="final-result-unit">{derivedUnit}</span>
          </div>
          <span className="final-result-confidence-note">
            {usesMonteCarlo
              ? `Empirical shortest ${confidencePercent}% coverage interval from the GUM-S1 simulation.`
              : `The reported expanded uncertainty uses k=${formatNumber(
                  displayK,
                  4,
                )} at ${confidencePercent}%.`}
          </span>
          {propagationMode === "montecarlo" && !usesMonteCarlo && (
            <span className="budget-risk-method-note stale">
              Monte Carlo results are refreshing. Linear GUM totals are shown
              temporarily.
            </span>
          )}
          {renderRiskMetrics()}
        </div>
      )}
    </div>
  );
};

export default UncertaintyBudgetTable;
