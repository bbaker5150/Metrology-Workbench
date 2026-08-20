import React, {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  unitSystem,
  errorDistributions,
  distributionDivisorValue,
  getUnitDisplayLabel,
} from "../../../utils/uncertaintyMath";
import { oldErrorDistributions } from "../utils/budgetUtils";
import {
  applyManualToleranceDistribution,
  getInlineManualDraft,
  normalizeInlineManualComponent,
} from "../utils/manualComponentUtils";
const PercentageBarGraph = lazy(() => import("./ContributionPlot"));
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalculator,
  faPlus,
  faPencilAlt,
  faProjectDiagram,
  faExclamationTriangle,
  faChartBar,
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

// Result cards should expose useful precision without leaking floating-point
// noise. Eight significant digits keeps small metrology values readable while
// avoiding readouts such as 0.00999981624765.
const formatCalculatedResult = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  if (n === 0) return "0";
  return String(Number(n.toPrecision(8)));
};

const fullPrecisionValue = (value) => {
  if (value === undefined || value === null || value === "") return "N/A";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return numeric === Infinity ? "Infinity" : "N/A";
  return String(value);
};

const simplifyBudgetLabel = (label = "") =>
  String(label).replace(
    /^(.+?)\s+\([^)]*\)(\s+Uncertainty Budget)$/i,
    "$1$2",
  );

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
  if (component.isPropagationSummary) return true;
  if (component.type === "A") return true;
  if (component.originalInput?.inputMode === "standard") return true;
  const dist = component.distribution || "";
  return /std\.?\s*unc/i.test(dist) || dist === "Other (Std. Unc.)";
};

const hasFiniteDof = (dof) => {
  const n = Number(dof);
  return Number.isFinite(n) && n > 0;
};

const shouldShowDofColumn = (items = []) =>
  items.some((item) => item?.type === "A" || hasFiniteDof(item?.dof));

const getComponentDisplayName = (component) => {
  const quantity = component.quantity || 1;
  const name =
    (component.isBudgetInstance ? component.name : null) ||
    component.sourceDisplayName ||
    component.tmdeIdentity ||
    component.name ||
    "Uncertainty component";
  return quantity > 1 ? `${name} (Qty: ${quantity})` : name;
};

const enumerateComponentDisplayNames = (
  components = [],
  getLabel = getComponentDisplayName,
) => {
  const counts = new Map();
  return components.map((component, index) => {
    const baseLabel = String(
      getLabel(component, index) || "Uncertainty component",
    ).trim();
    const occurrence = (counts.get(baseLabel) || 0) + 1;
    counts.set(baseLabel, occurrence);
    return occurrence === 1 ? baseLabel : `${baseLabel} (${occurrence})`;
  });
};

const isInstrumentLinkedTypeB = (component = {}) =>
  Boolean(
    component.typeBSourceId ||
      component.typeBSourceTmdeId ||
      component.fromInstrument,
  );

const isStandaloneManualComponent = (component = {}) =>
  !component.isPropagationSummary &&
  !component.isResolution &&
  !component.sourceTmdeId &&
  !isInstrumentLinkedTypeB(component) &&
  Boolean(
    component.isInlineManual ||
      (component.originalInput && !component.isCore),
  );

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
        title="Edit value"
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

const InlineManualComponentRow = ({
  component,
  referencePoint,
  showDof,
  sigFigs,
  ToleranceEditorComponent,
  applyToleranceChange,
  formatToleranceSummary,
  onCommit,
  onRemove,
}) => {
  const rowRef = useRef(null);
  const nameInputRef = useRef(null);
  const [editing, setEditing] = useState(Boolean(component.inlineDraft));
  const [draft, setDraft] = useState(() => getInlineManualDraft(component));
  const draftRef = useRef(draft);
  const pendingFinishRef = useRef(null);

  const updateDraft = (updater) => {
    setDraft((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      draftRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    if (!editing) {
      const next = getInlineManualDraft(component);
      draftRef.current = next;
      setDraft(next);
    }
  }, [component, editing]);

  useEffect(() => {
    if (!component.inlineDraft) return;
    setEditing(true);
    const frame = window.requestAnimationFrame(() => nameInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [component.inlineDraft]);

  useEffect(
    () => () => {
      if (pendingFinishRef.current) {
        window.clearTimeout(pendingFinishRef.current);
      }
    },
    [],
  );

  const finish = () => {
    if (pendingFinishRef.current) {
      window.clearTimeout(pendingFinishRef.current);
      pendingFinishRef.current = null;
    }
    onCommit?.(draftRef.current);
    setEditing(false);
  };

  useEffect(() => {
    if (!editing) return undefined;
    const handleOutsidePointer = (event) => {
      if (
        event.target?.closest?.(
          ".inline-tolerance-shape-menu, .inline-tolerance-shape-backdrop, .inline-unit-menu",
        )
      ) {
        return;
      }
      if (!rowRef.current?.contains(event.target)) {
        // Pointer-down happens before the focused tolerance input's blur. Give
        // that blur one event turn to commit its final term into draftRef, then
        // persist the exact draft the user can see rather than the prior empty
        // value (which used to make the row snap back to "Not Set").
        if (pendingFinishRef.current) {
          window.clearTimeout(pendingFinishRef.current);
        }
        pendingFinishRef.current = window.setTimeout(finish, 0);
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () =>
      document.removeEventListener("pointerdown", handleOutsidePointer, true);
    // The latest draft is intentionally captured so clicking outside commits
    // exactly what is visible in the expanded row.
  }, [editing, draft]);

  const preview = useMemo(
    () =>
      normalizeInlineManualComponent({
        component,
        draft,
        referencePoint,
      }),
    [component, draft, referencePoint],
  );
  const std = getComponentStdUncertainty(preview, referencePoint?.unit);
  const inputMode =
    draft.type === "A" ? "standard" : draft.inputMode || "tolerance";
  const toleranceDistribution = String(
    draft.tolerance?.reading?.distribution ||
      draft.tolerance?.range?.distribution ||
      draft.tolerance?.floor?.distribution ||
      draft.tolerance?.readings_iv?.distribution ||
      draft.tolerance?.db?.distribution ||
      draft.tolerance?.bandDistribution ||
      draft.errorDistributionDivisor ||
      "1.732",
  );
  const unitOptions = useMemo(() => {
    const relevant = referencePoint?.unit
      ? unitSystem.getRelevantUnits(referencePoint.unit)
      : [];
    return Array.from(
      new Set(["%", "ppm", "ppb", draft.unit, referencePoint?.unit, ...relevant]),
    ).filter(Boolean);
  }, [draft.unit, referencePoint?.unit]);

  const setEntryMode = (nextMode) => {
    updateDraft((current) => {
      const divisor =
        distributionDivisorValue(current.errorDistributionDivisor) ||
        distributionDivisorValue("1.732");
      if (nextMode === "standard") {
        const tolerance = Number(current.toleranceLimit);
        const calculatedTolerance = Number(preview?.value_native);
        return {
          ...current,
          inputMode: "standard",
          standardUncertainty:
            current.standardUncertainty ||
            (Number.isFinite(calculatedTolerance) && calculatedTolerance > 0
              ? String(calculatedTolerance)
              : Number.isFinite(tolerance) && tolerance > 0
                ? String(tolerance / divisor)
              : ""),
        };
      }
      const standard = Number(current.standardUncertainty);
      return {
        ...current,
        inputMode: "tolerance",
        toleranceLimit:
          current.toleranceLimit ||
          (Number.isFinite(standard) && standard > 0
            ? String(standard * divisor)
            : ""),
      };
    });
  };

  const handleTypeChange = (type) => {
    updateDraft((current) => {
      if (type !== "A") return { ...current, type: "B" };
      const divisor =
        distributionDivisorValue(current.errorDistributionDivisor) ||
        distributionDivisorValue("1.732");
      const tolerance = Number(current.toleranceLimit);
      const calculatedTolerance = Number(preview?.value_native);
      return {
        ...current,
        type: "A",
        inputMode: "standard",
        standardUncertainty:
          current.standardUncertainty ||
          (Number.isFinite(calculatedTolerance) && calculatedTolerance > 0
            ? String(calculatedTolerance)
            : Number.isFinite(tolerance) && tolerance > 0
              ? String(tolerance / divisor)
            : ""),
      };
    });
  };

  const handleRowKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      updateDraft(getInlineManualDraft(component));
      setEditing(false);
    }
  };

  const removeAction = (
    <div className="budget-row-actions">
      <span
        onClick={(event) => {
          event.stopPropagation();
          onRemove?.(component.id, component);
        }}
        className="delete-action"
        title="Remove Component"
      >
        x
      </span>
    </div>
  );

  if (!editing) {
    const original = component.originalInput || {};
    const isStandard =
      component.type === "A" || original.inputMode === "standard";
    const tolerance = Number(original.toleranceLimit);
    const structuredTolerance = original.tolerance || component.tolerance || {};
    const structuredSummary = formatToleranceSummary?.(structuredTolerance)?.[0];
    const toleranceText =
      !isStandard && structuredSummary && structuredSummary !== "-"
        ? structuredSummary
        : !isStandard && Number.isFinite(tolerance) && tolerance > 0
          ? `${tolerance} ${getUnitDisplayLabel(original.unit || component.manualUnit)}`
          : "Not Set";
    return (
      <tr
        ref={rowRef}
        className={`budget-inline-manual-row${component.inlineValidation ? " has-warning" : ""}`}
        title={
          component.inlineValidation ||
          "Click anywhere on this manual component to edit it"
        }
        onClick={() => setEditing(true)}
      >
        <td>
          {component.name || (
            <span className="inline-tolerance-summary is-empty budget-inline-not-set">
              Not Set
            </span>
          )}
        </td>
        <td>{toleranceText}</td>
        <td>{component.distribution || "Not Set"}</td>
        <td>{component.type || "B"}</td>
        {showDof && <td>{formatDof(component.dof)}</td>}
        <td>
          {Number(std.value) > 0 ? (
            `${formatNumber(std.value, sigFigs)} ${getUnitDisplayLabel(std.unit)}`
          ) : (
            <span className="inline-tolerance-summary is-empty budget-inline-not-set">
              Not Set
            </span>
          )}
        </td>
        <td className="action-cell">{removeAction}</td>
      </tr>
    );
  }

  const magnitudeInput = (field, label) => (
    <div className="budget-inline-magnitude">
      <input
        type="number"
        step="any"
        min="0"
        className="budget-inline-input budget-inline-number"
        aria-label={label}
        value={draft[field]}
        onChange={(event) =>
          updateDraft((current) => ({
            ...current,
            [field]: event.target.value,
          }))
        }
      />
      <select
        className="mini-select budget-inline-unit"
        aria-label={`${label} unit`}
        value={draft.unit}
        onChange={(event) =>
          updateDraft((current) => ({ ...current, unit: event.target.value }))
        }
      >
        {unitOptions.map((unit) => (
          <option key={unit} value={unit}>
            {getUnitDisplayLabel(unit)}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <tr
      ref={rowRef}
      className="budget-inline-manual-row is-editing"
      onKeyDown={handleRowKeyDown}
    >
      <td>
        <input
          ref={nameInputRef}
          type="text"
          className="budget-inline-input budget-inline-name"
          aria-label="Error source name"
          value={draft.name}
          onChange={(event) =>
            updateDraft((current) => ({ ...current, name: event.target.value }))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              finish();
            }
          }}
        />
      </td>
      <td className="budget-inline-tolerance-cell">
        {draft.type === "A" ? (
          <span className="budget-inline-empty">—</span>
        ) : inputMode === "tolerance" ? (
          ToleranceEditorComponent ? (
            <ToleranceEditorComponent
              tolerance={draft.tolerance || {}}
              activeRange={{
                id: component.id,
                max: referencePoint?.value,
                unit: referencePoint?.unit || draft.unit || "",
              }}
              editable
              openRequested
              onCommit={(typeKey, nextTerm) =>
                updateDraft((current) => {
                  const nextTolerance = applyToleranceChange
                    ? applyToleranceChange(
                        current.tolerance || {},
                        typeKey,
                        nextTerm,
                      )
                    : { ...(current.tolerance || {}), [typeKey]: nextTerm };
                  return {
                    ...current,
                    tolerance: applyManualToleranceDistribution(
                      nextTolerance,
                      current.errorDistributionDivisor || "1.732",
                    ),
                    toleranceLimit: "",
                  };
                })
              }
            />
          ) : (
            magnitudeInput("toleranceLimit", "Tolerance limit")
          )
        ) : (
          <button
            type="button"
            className="budget-inline-mode-button"
            onClick={() => setEntryMode("tolerance")}
          >
            Enter tolerance limit
          </button>
        )}
      </td>
      <td>
        {draft.type === "A" ? (
          <span>Normal</span>
        ) : inputMode === "standard" ? (
          <span>Standard uncertainty (k=1)</span>
        ) : (
          <select
            className="mini-select budget-inline-distribution"
            aria-label="Error limit distribution"
            value={toleranceDistribution}
            onChange={(event) =>
              updateDraft((current) => ({
                ...current,
                errorDistributionDivisor: event.target.value,
                tolerance: applyManualToleranceDistribution(
                  current.tolerance,
                  event.target.value,
                ),
              }))
            }
          >
            {oldErrorDistributions.map((distribution) => (
              <option key={distribution.value} value={distribution.value}>
                {distribution.label}
              </option>
            ))}
          </select>
        )}
      </td>
      <td>
        <select
          className="mini-select budget-inline-type"
          aria-label="Uncertainty type"
          value={draft.type}
          onChange={(event) => handleTypeChange(event.target.value)}
        >
          <option value="A">A</option>
          <option value="B">B</option>
        </select>
      </td>
      {showDof && <td>{draft.type === "A" ? formatDof(component.dof) : ""}</td>}
      <td>
        {inputMode === "standard" ? (
          magnitudeInput("standardUncertainty", "Standard uncertainty")
        ) : (
          <button
            type="button"
            className="inline-tolerance-summary is-empty budget-inline-not-set-action"
            onClick={() => setEntryMode("standard")}
          >
            Not Set
          </button>
        )}
      </td>
      <td className="action-cell">{removeAction}</td>
    </tr>
  );
};

const MonteCarloTrialsInput = ({ value, onCommit, disabled = false }) => {
  const [draft, setDraft] = useState(String(value || 10000));
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isInteger(parsed) && parsed >= 100) onCommit?.(parsed);
    else setDraft(String(value || 10000));
  };
  return (
    <label
      className={`budget-mc-trials${disabled ? " is-disabled" : ""}`}
      title={disabled ? "Enable Monte Carlo to edit the trial count" : "Monte Carlo trial count"}
      onClick={(event) => event.stopPropagation()}
    >
      <span>N</span>
      <input
        type="number"
        min="100"
        step="1"
        value={draft}
        aria-label="Monte Carlo trials"
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
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
}) => {
  // When effective DOF is off, ν_eff is not applied to k, so leave it blank.
  const effDofDisplay = useEffectiveDof ? formatDof(results?.effective_dof) : "";
  const unitSuffix = unit ? ` ${unit}` : "";

  return (
    <aside className={`budget-results-card ${isFinal ? "final" : ""}`}>
      <div className="budget-results-title">
        {title}
      </div>
      <div
        className="budget-results-row"
        title={fullPrecisionValue(results?.combined)}
      >
        <span>Combined Uncertainty</span>
        <strong>
          {formatCalculatedResult(results?.combined)}
          {unitSuffix}
        </strong>
      </div>
      <div
        className="budget-results-row"
        title={fullPrecisionValue(results?.effective_dof)}
      >
        <span className="budget-results-dof-label">
          <label
            className="direction-toggle-switch"
            title="Apply Welch–Satterthwaite effective degrees of freedom"
          >
            <input
              type="checkbox"
              checked={!!useEffectiveDof}
              onChange={(e) => onToggleEffectiveDof?.(e.target.checked)}
            />
            <span className="direction-toggle-slider"></span>
          </label>
          Effective DOF
        </span>
        <strong>{effDofDisplay}</strong>
      </div>
      <div
        className="budget-results-row"
        title={fullPrecisionValue(results?.k_value)}
      >
        <span>Coverage Factor (k)</span>
        <strong>{formatNumber(results?.k_value, sigFigs)}</strong>
      </div>
      <div
        className="budget-results-row"
        title={fullPrecisionValue(results?.expanded)}
      >
        <span>Expanded Uncertainty</span>
        <strong>
          {formatCalculatedResult(results?.expanded)}
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
  ToleranceEditorComponent,
  applyToleranceChange,
  formatToleranceSummary,
  onOpenCorrelation,
  onBudgetSettingsChange,
  useEffectiveDofByGroup = {},
  budgetPropagationMethod,
  monteCarloTrials = 10000,
  onPropagationMethodChange,
  onMonteCarloTrialsChange,
  rangeWarningsByGroup = {},
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
  const derivedUnit = referencePoint?.unit || "Units";
  const derivedName = referencePoint?.name || "Derived";
  const isDirect = measurementType === "direct";
  const [uiSigFigs] = useState(4);
  // Per-(sub)budget sig figs are no longer user-configurable — the tables render
  // at a fixed precision. Kept as a helper so existing call sites are untouched.
  const getGroupSigFigs = () => uiSigFigs;

  const groups = useMemo(() => {
    if (calcResults?.calculatedBudgetGroups?.length) {
      return calcResults.calculatedBudgetGroups;
    }
    const nativeCombined = Number.isFinite(
      Number(calcResults?.combined_uncertainty_absolute_base),
    )
      ? unitSystem.fromBaseUnit(
          Number(calcResults.combined_uncertainty_absolute_base),
          derivedUnit,
        )
      : calcResults?.combined_uncertainty;
    const nativeExpanded = Number.isFinite(
      Number(calcResults?.expanded_uncertainty_absolute_base),
    )
      ? unitSystem.fromBaseUnit(
          Number(calcResults.expanded_uncertainty_absolute_base),
          derivedUnit,
        )
      : calcResults?.expanded_uncertainty;
    return [
      {
        id: "final_budget",
        kind: "final",
        label: `${derivedName || "Final"} Uncertainty Budget`,
        unit: derivedUnit,
        components: components || [],
        results: {
          combined: nativeCombined,
          effective_dof: calcResults?.effective_dof,
          k_value: calcResults?.k_value,
          expanded: nativeExpanded,
        },
      },
    ];
  }, [calcResults, components, derivedName, derivedUnit]);

  // Budget rows can be updated through several paths (inline manual edits,
  // instrument-linked specifications, resolution inclusion, and propagation
  // controls). Some of those paths preserve nested object identities. Use a
  // content signature so the open chart always follows the displayed budget,
  // even when React receives a structurally shared calculation result.
  const contributionRevision = JSON.stringify({
    components: calcResults?.calculatedBudgetComponents || components || [],
    groups: calcResults?.calculatedBudgetGroups || groups,
    monteCarloInfluence: calcResults?.monteCarlo?.influenceFractions || [],
    budgetPropagationMethod,
  });

  const renderDistributionCell = (component) => {
    if (component.isPropagationSummary) {
      return <span>{component.distribution}</span>;
    }
    if (isInstrumentLinkedTypeB(component)) {
      return <span>{component.distribution || "Not Set"}</span>;
    }

    // Every TMDE-derived row is governed by the instrument builder / inline
    // instrument editor. The budget is an inclusion surface only, so never
    // expose a second distribution override here (which could leave one of the
    // paired TMDE error-limit rows out of sync with the instrument spec).
    if (component.sourceTmdeId) {
      return <span>{component.distribution || "Not Set"}</span>;
    }

    if (component.isCore || component.isResolution) {
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
    if (component.isPropagationSummary) {
      return null;
    }
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
    const showEdit =
      !component.missingTolerance &&
      !component.sourceTmdeId &&
      !isInstrumentLinkedTypeB(component) &&
      !isStandaloneManualComponent(component);
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

  const renderComponentTable = (group) => {
    const showDof = shouldShowDofColumn(group.components || []);
    // %IV on a final-budget manual component is defined by the selected UUT
    // measurement point. Input-variable subbudgets instead use that variable's
    // nominal. Do not let a calculated group summary replace either reference.
    const manualReferencePoint =
      group.kind === "input"
        ? group.nominalPoint || {
            value: group.nominalValue,
            unit: group.unit,
          }
        : referencePoint;
    // Manual rows are authored in the order they were added, but generated
    // rows (such as UUT resolution) can be rebuilt after them. Keep all manual
    // additions at the bottom without disturbing either group's stable order.
    const orderedComponents = [
      ...(group.components || []).filter(
        (component) => !isStandaloneManualComponent(component),
      ),
      ...(group.components || []).filter(isStandaloneManualComponent),
    ];
    const displayNames = enumerateComponentDisplayNames(orderedComponents);
    return (
    <table className="uncertainty-budget-table">
      <thead>
          <tr>
            <th>Error Source Name</th>
            <th>Tolerance Limit</th>
            <th>Error Limit Distribution</th>
            <th>Type (A/B)</th>
          {showDof && <th>DOF</th>}
            <th>Standard Uncertainty</th>
            <th></th>
        </tr>
      </thead>
      <tbody className="component-group-tbody">
        {orderedComponents.map((component, componentIndex) => {
          if (isStandaloneManualComponent(component)) {
            return (
              <InlineManualComponentRow
                key={component.id}
                component={component}
                referencePoint={manualReferencePoint}
                showDof={showDof}
                sigFigs={getGroupSigFigs(group)}
                ToleranceEditorComponent={ToleranceEditorComponent}
                applyToleranceChange={applyToleranceChange}
                formatToleranceSummary={formatToleranceSummary}
                onCommit={(inlineManualDraft) =>
                  onComponentUpdate?.(
                    component.id,
                    {
                      inlineManualDraft,
                      referencePoint: manualReferencePoint,
                    },
                    component,
                  )
                }
                onRemove={onRemove}
              />
            );
          }
          const std = getComponentStdUncertainty(component, group.unit);
          const tolLimit = getComponentToleranceLimit(component, std);
          const displayName = displayNames[componentIndex];
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
              <td>
                {editableTolerance ? (
                  <ManualValueCell
                    component={component}
                    onCommit={commitManualValue}
                    suffix={component.manualUnit || tolLimit.unit}
                  />
                ) : component.isPropagationSummary ? (
                  `${formatNumber(std.value, getGroupSigFigs(group))} ${std.unit}`
                ) : isStdEntry ? (
                  ""
                ) : (
                  `${formatNumber(tolLimit.value, uiSigFigs)} ${tolLimit.unit}`
                )}
              </td>
              <td>{renderDistributionCell(component)}</td>
              <td>{component.type || "B"}</td>
              {showDof && <td>{formatDof(component.dof)}</td>}
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
  };

  const renderEquationTable = (group) => {
    const showDof = shouldShowDofColumn(group.rows || []);
    const showInfluence = group.method === "montecarlo";
    return (
    <>
    <table className="uncertainty-budget-table">
      <thead>
        <tr>
          <th>Input Variable</th>
          {showDof && <th>DOF</th>}
          <th>Standard Uncertainty</th>
          <th>Sensitivity Coefficient</th>
          <th>Contribution</th>
          {showInfluence && <th>MC Influence</th>}
        </tr>
      </thead>
      <tbody className="component-group-tbody">
        {(group.rows || []).map((row) => (
          <tr key={row.id}>
            <td>{row.name}</td>
            {showDof && <td>{formatDof(row.dof)}</td>}
            <td>
              {formatNumber(row.standardUncertainty, getGroupSigFigs(group))}{" "}
              {row.unit}
            </td>
            <td>{formatNumber(row.sensitivityCoefficient, 4)}</td>
            <td>
              {formatNumber(row.contribution, getGroupSigFigs(group))}{" "}
              {derivedUnit}
            </td>
            {showInfluence && (
              <td>
                {Number.isFinite(Number(row.influence))
                  ? `${(Number(row.influence) * 100).toFixed(2)}%`
                  : ""}
              </td>
            )}
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
  };

  // Compact settings popover for the bottom readout. Only controls the sig figs
  // shown in THIS results area (expanded uncertainty + risk metrics) — the
  // budget tables above format independently.
  const getGroupScope = (group) => ({
    kind: group.kind,
    variableType: group.variableType,
    label: group.label.replace(/\s+Uncertainty Budget$/i, ""),
    nominalPoint: group.nominalPoint || {
      value: group.nominalValue,
      unit: group.unit,
    },
    // What the unified "Add component to budget" menu should offer for this
    // (sub)budget. Manual components belong in any input/final budget;
    // repeatability (a Type A term) in input budgets and the direct final.
    canAddManual: group.kind === "input" || group.kind === "final",
    canAddRepeatability:
      group.kind === "input" || (isDirect && group.kind === "final"),
  });

  const canAddTmdeForGroup = (group) =>
    Boolean(onAddTmdeToBudget) &&
    // Derived: TMDEs are assigned per input variable; the final budget's "+"
    // exists so the derived UUT's own measuring resolution can be added there
    // (matching the direct final budget), instead of a nominal-scaling manual
    // component.
    ((measurementType === "derived" &&
      (group.kind === "input" || group.kind === "final")) ||
      (measurementType === "direct" && group.kind === "final"));

  // The measurement-equation table's two actions (correlation matrix +
  // calculation breakdown) now live as clean buttons in that table's header,
  // instead of behind a settings cog. Add Manual Component / Repeatability moved
  // into the unified "Add component to budget" (+) menu for input/final budgets.
  const renderEquationActions = () => (
    <>
      {onOpenCorrelation && components?.length >= 2 && (
        <button
          type="button"
          className="budget-section-action-btn"
          title="Input correlation matrix"
          aria-label="Input correlation matrix"
          onClick={() => onOpenCorrelation()}
        >
          <FontAwesomeIcon icon={faProjectDiagram} />
        </button>
      )}
      <button
        type="button"
        className="budget-section-action-btn"
        title="Calculation breakdown"
        aria-label="Calculation breakdown"
        onClick={() => onShowDerivedBreakdown?.()}
      >
        <FontAwesomeIcon icon={faCalculator} />
      </button>
    </>
  );

  const contributionChart = useMemo(() => {
    if (!showContribution) return null;

    // Object keys drive the Plotly category labels. Preserve repeated source
    // names instead of silently replacing an earlier contributor.
    const toChartData = (items, getValue) => {
      const data = {};
      const labels = enumerateComponentDisplayNames(
        items,
        (item) =>
          String(
            item?.name || item?.label || "Uncertainty component",
          ).replace(/^Input:\s*/, ""),
      );
      items.forEach((item, index) => {
        const value = Math.abs(Number(getValue(item, index)) || 0);
        if (value > 0) data[labels[index]] = value;
      });
      return data;
    };
    const asChart = (data, options = {}) =>
      Object.keys(data).length > 0
        ? { data, revision: contributionRevision, ...options }
        : null;

    if (measurementType === "derived") {
      const equationGroup = groups.find((group) => group.kind === "equation");
      const equationRows = equationGroup?.rows || [];
      const method = equationGroup?.method || budgetPropagationMethod;
      const finalComponents =
        groups.find((group) => group.kind === "final")?.components || [];
      const standaloneComponents = finalComponents.filter(
        (component) => !component.isPropagationSummary,
      );
      const propagationSummary = finalComponents.find(
        (component) => component.isPropagationSummary,
      );
      const nativeEquationStandardUncertainty = [
        propagationSummary?.contribution,
        propagationSummary?.value_native,
        propagationSummary?.value,
        equationGroup?.results?.combined,
      ]
        .map(Number)
        .find((value) => Number.isFinite(value) && value > 0);
      const equationVariance = Number.isFinite(
        nativeEquationStandardUncertainty,
      )
        ? nativeEquationStandardUncertainty ** 2
        : 0;
      const standaloneVarianceRows = standaloneComponents.map((component) => {
        const standardUncertainty = Math.abs(
          Number(
            component.contribution ??
              component.value_native ??
              component.value,
          ) || 0,
        );
        return {
          ...component,
          chartVariance: standardUncertainty ** 2,
        };
      });
      const inputGroups = groups.filter((group) => group.kind === "input");
      const expandEquationSourceRows = (row) => {
        const inputGroup = inputGroups.find(
          (group) =>
            (row.variable && group.variable === row.variable) ||
            (row.variableType && group.variableType === row.variableType),
        );
        const sourceRows = (inputGroup?.components || [])
          .map((component) => {
            const standardUncertainty = Math.abs(
              Number(
                getComponentStdUncertainty(component, inputGroup?.unit).value,
              ) || 0,
            );
            const quantity = Math.max(1, Number(component.quantity) || 1);
            return {
              ...component,
              name:
                component.name ||
                component.sourceDisplayName ||
                component.tmdeIdentity ||
                row.name,
              sourceVariance: standardUncertainty ** 2 * quantity,
            };
          })
          .filter((component) => component.sourceVariance > 0);
        const sourceVarianceTotal = sourceRows.reduce(
          (sum, component) => sum + component.sourceVariance,
          0,
        );
        if (sourceVarianceTotal <= 0 || sourceRows.length === 0) return [row];
        return sourceRows.map((component) => ({
          ...component,
          chartVariance:
            (component.sourceVariance / sourceVarianceTotal) *
            Math.max(0, Number(row.chartVariance) || 0),
        }));
      };

      if (method === "montecarlo") {
        const fallbackInfluences = calcResults?.monteCarlo?.influenceFractions || [];
        const rawInfluences = equationRows.map((row, index) =>
          Math.max(
            0,
            Number(row.influence ?? fallbackInfluences[index]) || 0,
          ),
        );
        const influenceTotal = rawInfluences.reduce(
          (sum, influence) => sum + influence,
          0,
        );
        const allocatedEquationRows = equationRows.map((row, index) => ({
            ...row,
            chartVariance:
              (influenceTotal > 0
                ? rawInfluences[index] / influenceTotal
                : 0) * equationVariance,
          }));
        const chartRows = [
          ...allocatedEquationRows.flatMap(expandEquationSourceRows),
          ...standaloneVarianceRows,
        ];
        return asChart(
          toChartData(chartRows, (row) => row.chartVariance),
          {
            unit: "",
            valueMode: "share",
            valueLabel: "Variance contribution",
            title: "Monte Carlo uncertainty contribution",
          },
        );
      }

      // Taylor propagation rows contain c_i * u_i in the derived point's
      // native unit. First find each row's relative share of the equation
      // variance, then allocate the ACTUAL equation variance back across those
      // rows. The reconciliation matters when correlation or nonlinear terms
      // make the equation result differ from the plain RSS of its displayed
      // first-order rows. Standalone final-budget sources then join the exact
      // same variance pool used by Monte Carlo.
      const taylorRows = equationRows.map((row) => {
        const contribution = Math.abs(Number(row.contribution) || 0);
        return { ...row, rawVariance: contribution ** 2 };
      });
      const taylorRowVariance = taylorRows.reduce(
        (sum, row) => sum + row.rawVariance,
        0,
      );
      const reconciledEquationVariance =
        equationVariance > 0 ? equationVariance : taylorRowVariance;
      const allocatedTaylorRows = taylorRows.map((row) => ({
          ...row,
          chartVariance:
            taylorRowVariance > 0
              ? (row.rawVariance / taylorRowVariance) *
                reconciledEquationVariance
              : 0,
        }));
      const chartRows = [
        ...allocatedTaylorRows.flatMap(expandEquationSourceRows),
        ...standaloneVarianceRows,
      ];
      return asChart(
        toChartData(chartRows, (row) => row.chartVariance),
        {
          unit: "",
          valueMode: "share",
          valueLabel: "Variance contribution",
          title: "Taylor series uncertainty contribution",
        },
      );
    }

    const sourceComponents = calcResults?.calculatedBudgetComponents || [];
    const sourceRows = sourceComponents.map((component) => {
      const standardUncertainty = Math.abs(
        Number(
          component.contribution ??
            component.value_native ??
            component.value,
        ) || 0,
      );
      const quantity = Math.max(1, Number(component.quantity) || 1);
      return {
        ...component,
        chartVariance: standardUncertainty ** 2 * quantity,
      };
    });
    return asChart(
      toChartData(sourceRows, (item) => item.chartVariance),
      {
        unit: "",
        valueMode: "share",
        valueLabel: "Variance contribution",
        title: "Uncertainty contribution",
      },
    );
  }, [
    budgetPropagationMethod,
    calcResults?.calculatedBudgetComponents,
    calcResults?.monteCarlo?.influenceFractions,
    contributionRevision,
    derivedUnit,
    groups,
    measurementType,
    showContribution,
  ]);
  const isMonteCarlo = budgetPropagationMethod === "montecarlo";
  const setMonteCarloEnabled = (enabled) =>
    onPropagationMethodChange?.(enabled ? "montecarlo" : "equation");

  const renderPropagationControl = () => (
    <div
      className="budget-propagation-control"
      title="Choose Taylor Series or Monte Carlo uncertainty propagation"
    >
      <span className={`budget-propagation-label ${!isMonteCarlo ? "is-active" : ""}`}>
        Taylor Series
      </span>
      <label className="direction-toggle-switch">
        <input
          type="checkbox"
          checked={isMonteCarlo}
          aria-label="Use Monte Carlo approximation"
          onChange={(event) => setMonteCarloEnabled(event.target.checked)}
        />
        <span className="direction-toggle-slider"></span>
      </label>
      <span className={`budget-propagation-label ${isMonteCarlo ? "is-active" : ""}`}>
        Monte Carlo
      </span>
      <MonteCarloTrialsInput
        value={monteCarloTrials}
        onCommit={onMonteCarloTrialsChange}
        disabled={!isMonteCarlo}
      />
    </div>
  );
  // Coverage factor for the footnote — read from the SAME computed result the
  // expanded uncertainty above uses, never hardcoded. It already tracks the
  // configured confidence and any Type A repeatability that lowers the
  // effective DOF (which raises k via the Student-t quantile).
  return (
    <div className="budget-stack">
      {groups.map((group) => (
        <React.Fragment key={group.id}>
          <section className="budget-section-row">
            <div
              className={`budget-stack-section ${group.kind === "final" ? "final" : ""}`}
            >
              <div className="budget-section-title-row">
                <h4>{simplifyBudgetLabel(group.label)}</h4>
                <div className="budget-section-title-actions">
                  {group.kind === "final" && (
                    <>
                      <button
                        type="button"
                        className={`budget-contribution-button${showContribution ? " is-active" : ""}`}
                        title={showContribution ? "Hide contribution chart" : "Show contribution chart"}
                        aria-label={showContribution ? "Hide contribution chart" : "Show contribution chart"}
                        aria-pressed={!!showContribution}
                        onClick={() => setShowContribution?.(!showContribution)}
                      >
                        <FontAwesomeIcon icon={faChartBar} />
                      </button>
                    </>
                  )}
                  {group.kind === "equation" && !isDirect &&
                    renderPropagationControl()}
                  {group.kind === "equation"
                    ? renderEquationActions()
                    : canAddTmdeForGroup(group) && (
                      <>
                        {(rangeWarningsByGroup[groupDofKey(group)] || []).length > 0 && (
                          <span
                            className="budget-range-warning"
                            title="Selected range does not include the nominal"
                            aria-label="Selected range does not include the nominal"
                          >
                            <FontAwesomeIcon icon={faExclamationTriangle} />
                          </span>
                        )}
                        <button
                          type="button"
                          className="btn-add-item"
                          data-tour="budget-add-component"
                          title="Add component to budget"
                          aria-label="Add component to budget"
                          onClick={(event) =>
                            onAddTmdeToBudget(getGroupScope(group), event)
                          }
                        >
                          <FontAwesomeIcon icon={faPlus} size="xs" />
                        </button>
                      </>
                      )}
                </div>
              </div>
              <div className="budget-section-table-wrap">
                {group.kind === "equation"
                  ? renderEquationTable(group)
                  : renderComponentTable(group)}
              </div>
              {group.kind === "final" && calcResults && (
                <div className="budget-final-support">
                  {contributionChart && (
                    <Suspense
                      fallback={
                        <div className="budget-contribution-loading" role="status">
                          Loading contribution chart...
                        </div>
                      }
                    >
                      <PercentageBarGraph
                        data={contributionChart.data}
                        revision={contributionChart.revision}
                        unit={contributionChart.unit}
                        valueMode={contributionChart.valueMode}
                        valueLabel={contributionChart.valueLabel}
                        title={contributionChart.title}
                      />
                    </Suspense>
                  )}
                </div>
              )}
            </div>
            <ResultsCard
              title={group.kind === "final" ? "Final Results" : "Results"}
              results={
                group.results
              }
              unit={group.kind === "final" ? derivedUnit : group.unit || derivedUnit}
              sigFigs={getGroupSigFigs(group)}
              isFinal={group.kind === "final"}
              useEffectiveDof={
                (useEffectiveDofByGroup[groupDofKey(group)] ?? true) !== false
              }
              onToggleEffectiveDof={(checked) =>
                handleToggleEffectiveDof(groupDofKey(group), checked)
              }
            />
          </section>
        </React.Fragment>
      ))}

    </div>
  );
};

export default UncertaintyBudgetTable;
