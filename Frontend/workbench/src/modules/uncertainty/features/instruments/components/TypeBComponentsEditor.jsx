/**
 * TypeBComponentsEditor
 *
 * Shared editor for the Type B uncertainty components ASSOCIATED WITH AN
 * INSTRUMENT (not tied to a single range) — e.g. head pressure on a pressure
 * gage. These live on the instrument definition as `instrument.typeBComponents`
 * and are added to a budget automatically whenever that instrument's accuracy
 * contributes (see getBudgetComponentsFromTolerance).
 *
 * The component shape mirrors the per-range manual components authored in
 * ToleranceForm so budgetUtils resolves both with identical math:
 *   { id, name, unit, inputMode: "tolerance"|"standard",
 *     toleranceLimit, standardUncertainty, distribution }
 *
 * Controlled: `components` is the array, `onChange(nextArray)` receives the
 * updated list. Used by BOTH instrument-creation paths — the universal builder
 * and the inline tables (via a small popover) — so the feature is authored the
 * same way regardless of how the instrument was created.
 */
import React, { useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import {
  unitSystem,
  unitCategories,
  DISTRIBUTION_NOT_SET,
  getUnitDisplayLabel,
} from "../../../utils/uncertaintyMath";
import TypeBToleranceEditor, {
  TypeBDistributionSelect,
} from "./TypeBToleranceEditor";
import BuilderUnitSelect from "./BuilderUnitSelect";

const buildUnitOptions = (referenceUnit) => {
  const allUnits = Object.keys(unitSystem.units);
  const relative = [
    { value: "%", label: "% (of nominal)" },
    { value: "ppm", label: "ppm (of nominal)" },
    { value: "ppb", label: "ppb (of nominal)" },
  ];
  const options = [{ label: "Relative", options: relative }];
  const used = new Set(["%", "ppm", "ppb", "dB"]);

  if (referenceUnit && allUnits.includes(referenceUnit) && !used.has(referenceUnit)) {
    options.push({
      label: "Suggested",
      options: [{ value: referenceUnit, label: getUnitDisplayLabel(referenceUnit) }],
    });
    used.add(referenceUnit);
  }

  Object.entries(unitCategories).forEach(([label, units]) => {
    const groupOptions = units
      .filter((u) => allUnits.includes(u) && !used.has(u))
      .map((u) => {
        used.add(u);
        return { value: u, label: getUnitDisplayLabel(u) };
      });
    if (groupOptions.length > 0) options.push({ label, options: groupOptions });
  });

  const leftovers = allUnits
    .filter((u) => !used.has(u))
    .map((u) => ({ value: u, label: getUnitDisplayLabel(u) }));
  if (leftovers.length > 0) options.push({ label: "Other", options: leftovers });

  return options;
};

/** Factory for a fresh, empty associated Type B component. */
export const TYPE_B_SCOPE_OPTIONS = [
  { value: "instrument", label: "Entire instrument" },
  { value: "function", label: "Entire function" },
  { value: "range", label: "Range specific" },
];

export const createTypeBComponent = (referenceUnit, scopeContext = {}) => ({
  id: `typeb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
  name: "",
  unit: referenceUnit || "%",
  inputMode: "tolerance",
  toleranceLimit: "",
  standardUncertainty: "",
  distribution: DISTRIBUTION_NOT_SET,
  tolerance: {},
  scope: "instrument",
  functionId: scopeContext.functionId || "",
  rangeId: "",
});

const TypeBComponentsEditor = ({
  components = [],
  onChange,
  referenceUnit = "",
  showIntro = true,
  showAddButton = true,
  showInlineRemove = true,
  activeId = null,
  onActivate,
  functions = [],
  activeFunctionId = "",
}) => {
  const list = Array.isArray(components) ? components : [];
  const unitOptions = useMemo(() => buildUnitOptions(referenceUnit), [referenceUnit]);

  const addComponent = () =>
    onChange([
      ...list,
      createTypeBComponent(referenceUnit, { functionId: activeFunctionId }),
    ]);
  const updateComponent = (id, field, value) =>
    onChange(list.map((mc) => (mc.id === id ? { ...mc, [field]: value } : mc)));
  const removeComponent = (id) => onChange(list.filter((mc) => mc.id !== id));

  return (
    <div className="typeb-editor">
      {showIntro && (
        <small
          style={{
            display: "block",
            marginBottom: "10px",
            color: "var(--text-color-muted)",
            fontSize: "0.75rem",
          }}
        >
          Type B uncertainties carried with this instrument (e.g. head pressure on
          a pressure gage). Each is added to the budget whenever this instrument's
          accuracy contributes, and is resolved against the measurement point where
          it is used.
        </small>
      )}

      <div className="typeb-cards">
        {list.map((mc) => {
          const isStandard = mc.inputMode === "standard";
          const scope = mc.scope || "instrument";
          const selectedFunction =
            functions.find((fn) => String(fn.id) === String(mc.functionId)) ||
            functions.find((fn) => String(fn.id) === String(activeFunctionId)) ||
            functions[0] ||
            null;
          const selectedRange =
            selectedFunction?.ranges?.find(
              (range) => String(range.id) === String(mc.rangeId),
            ) || selectedFunction?.ranges?.[0] || null;
          const toleranceReferencePoint = {
            value:
              selectedRange?.max ??
              selectedRange?.value ??
              selectedRange?.min ??
              "",
            unit: mc.unit || selectedRange?.unit || selectedFunction?.unit || referenceUnit,
          };
          const updateScope = (nextScope) => {
            onChange(
              list.map((item) => {
                if (item.id !== mc.id) return item;
                const nextFunctionId =
                  item.functionId || activeFunctionId || functions[0]?.id || "";
                const nextFunction = functions.find(
                  (fn) => String(fn.id) === String(nextFunctionId),
                );
                const firstRangeId = nextFunction?.ranges?.[0]?.id || "";
                return {
                  ...item,
                  scope: nextScope,
                  functionId:
                    nextScope === "instrument"
                      ? ""
                      : nextFunctionId,
                  rangeId:
                    nextScope === "range"
                      ? item.rangeId || firstRangeId
                      : "",
                };
              }),
            );
          };
          const updateUnit = (nextUnit) => {
            onChange(
              list.map((item) => {
                if (item.id !== mc.id) return item;
                if (isStandard || !item.tolerance || typeof item.tolerance !== "object") {
                  return { ...item, unit: nextUnit };
                }
                const nextTolerance = Object.fromEntries(
                  Object.entries(item.tolerance).map(([key, value]) =>
                    value && typeof value === "object"
                      ? [key, { ...value, unit: nextUnit }]
                      : [key, value],
                  ),
                );
                return { ...item, unit: nextUnit, tolerance: nextTolerance };
              }),
            );
          };
          return (
            <div
              key={mc.id}
              className={`typeb-card${activeId === mc.id ? " is-active" : ""}`}
              onMouseDown={() => onActivate?.(mc.id)}
              onFocusCapture={() => onActivate?.(mc.id)}
            >
              <div className="function-spec-header typeb-card-header">
                <div className="function-name-control">
                  <input
                    type="text"
                    value={mc.name || ""}
                    onChange={(e) => updateComponent(mc.id, "name", e.target.value)}
                    placeholder="Component name (e.g., Head Pressure)"
                    aria-label="Type B component name"
                  />
                </div>
                <div className="function-unit-control">
                  <BuilderUnitSelect
                    value={mc.unit || ""}
                    onChange={updateUnit}
                    options={unitOptions}
                    ariaLabel="Type B component unit"
                    width="9ch"
                  />
                </div>
                {showInlineRemove && (
                  <button
                    type="button"
                    onClick={() => removeComponent(mc.id)}
                    className="typeb-card-remove"
                    title="Remove component"
                    aria-label="Remove Type B component"
                  >
                    x
                  </button>
                )}
                {!showInlineRemove && <span aria-hidden="true" />}
              </div>

              <div className="typeb-card-fields">
                <label className="typeb-scope-field">
                  <span>Applies to</span>
                  <select
                    value={scope}
                    onChange={(e) => updateScope(e.target.value)}
                    aria-label="Type B component scope"
                  >
                    {TYPE_B_SCOPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                {scope !== "instrument" && (
                  <label className="typeb-scope-field">
                    <span>Function</span>
                    <select
                      value={mc.functionId || activeFunctionId || functions[0]?.id || ""}
                      onChange={(e) =>
                        onChange(
                          list.map((item) =>
                            item.id === mc.id
                              ? {
                                  ...item,
                                  functionId: e.target.value,
                                  rangeId:
                                    scope === "range"
                                      ? functions.find(
                                          (fn) =>
                                            String(fn.id) ===
                                            String(e.target.value),
                                        )?.ranges?.[0]?.id || ""
                                      : item.rangeId,
                                }
                              : item,
                          ),
                        )
                      }
                      aria-label="Type B component function"
                      disabled={functions.length === 0}
                    >
                      <option value="">Select function…</option>
                      {functions.map((fn) => (
                        <option key={fn.id} value={fn.id}>
                          {fn.name || "Unnamed function"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {scope === "range" && (
                  <label className="typeb-scope-field">
                    <span>Range</span>
                    <select
                      value={mc.rangeId || ""}
                      onChange={(e) =>
                        updateComponent(mc.id, "rangeId", e.target.value)
                      }
                      aria-label="Type B component range"
                      disabled={!selectedFunction?.ranges?.length}
                    >
                      <option value="">Select range…</option>
                      {(selectedFunction?.ranges || []).map((range) => (
                        <option key={range.id} value={range.id}>
                          {range.min ?? ""} to {range.max ?? ""} {range.unit || selectedFunction?.unit || ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="typeb-field typeb-scope-field">
                  <span>Entry Mode</span>
                  <select
                    value={mc.inputMode || "tolerance"}
                    onChange={(e) => updateComponent(mc.id, "inputMode", e.target.value)}
                  >
                    <option value="tolerance">Tolerance limit (±)</option>
                    <option value="standard">Standard uncertainty (uᵢ)</option>
                  </select>
                </label>

                {isStandard ? (
                  <label className="typeb-field typeb-scope-field">
                    <span>Std. Uncertainty (uᵢ)</span>
                    <input
                      type="number"
                      step="any"
                      value={mc.standardUncertainty || ""}
                      onChange={(e) =>
                        updateComponent(mc.id, "standardUncertainty", e.target.value)
                      }
                      placeholder="e.g., 0.5"
                    />
                  </label>
                ) : (
                  <div className="typeb-field typeb-tolerance-field">
                    <span>Tolerance / Error limits</span>
                    <TypeBToleranceEditor
                      component={mc}
                      referencePoint={toleranceReferencePoint}
                      showDistribution={false}
                      onChange={(next) =>
                        onChange(list.map((item) => (item.id === mc.id ? next : item)))
                      }
                    />
                  </div>
                )}

                {!isStandard && (
                  <label className="typeb-field typeb-scope-field typeb-distribution-field">
                    <span>Distribution</span>
                    <TypeBDistributionSelect
                      component={mc}
                      referencePoint={toleranceReferencePoint}
                      onChange={(next) =>
                        onChange(list.map((item) => (item.id === mc.id ? next : item)))
                      }
                    />
                  </label>
                )}

              </div>
            </div>
          );
        })}

        {list.length === 0 && (
          <div
            className="builder-empty-state typeb-empty-state"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              minHeight: "100px",
              textAlign: "center",
              color: "var(--text-color-muted)",
              fontSize: "0.8rem",
              border: "1px dashed var(--border-color)",
              borderRadius: "8px",
              marginBottom: 0,
            }}
          >
            <span>No Type B Uncertainties yet.</span>
          </div>
        )}
      </div>

      {showAddButton && (
        <button
          type="button"
          className="lib-pill-btn"
          onClick={addComponent}
          style={{ marginTop: "10px" }}
          title="Add an associated Type B uncertainty"
        >
          <FontAwesomeIcon icon={faPlus} /> Add Type B
        </button>
      )}
    </div>
  );
};

export default TypeBComponentsEditor;
