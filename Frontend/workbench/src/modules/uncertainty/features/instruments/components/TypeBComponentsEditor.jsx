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
import Select from "react-select";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFlask, faPlus } from "@fortawesome/free-solid-svg-icons";
import {
  unitSystem,
  unitCategories,
  errorDistributions,
  DISTRIBUTION_NOT_SET,
  getUnitDisplayLabel,
  unitFilterOption,
} from "../../../utils/uncertaintyMath";

const portalStyle = {
  menuPortal: (base) => ({ ...base, zIndex: 100000 }),
  menu: (base) => ({
    ...base,
    zIndex: 100000,
    backgroundColor: "var(--input-background)",
    color: "var(--text-color)",
  }),
  control: (base) => ({
    ...base,
    backgroundColor: "var(--input-background)",
    borderColor: "var(--border-color)",
    color: "var(--text-color)",
    minHeight: "34px",
    boxShadow: "none",
  }),
  singleValue: (base) => ({ ...base, color: "var(--text-color)" }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused ? "var(--primary-color)" : "transparent",
    color: state.isFocused ? "#fff" : "var(--text-color)",
    fontSize: "0.85rem",
  }),
};

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
export const createTypeBComponent = (referenceUnit) => ({
  id: `typeb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
  name: "",
  unit: referenceUnit || "%",
  inputMode: "tolerance",
  toleranceLimit: "",
  standardUncertainty: "",
  distribution: DISTRIBUTION_NOT_SET,
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
}) => {
  const list = Array.isArray(components) ? components : [];
  const unitOptions = useMemo(() => buildUnitOptions(referenceUnit), [referenceUnit]);
  const flatUnitOptions = useMemo(
    () => unitOptions.flatMap((g) => (g.options ? g.options : g)),
    [unitOptions],
  );

  const addComponent = () => onChange([...list, createTypeBComponent(referenceUnit)]);
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

      <div className="typeb-cards" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {list.map((mc) => {
          const isStandard = mc.inputMode === "standard";
          const selectedUnit = flatUnitOptions.find((o) => o.value === mc.unit) || null;
          return (
            <div
              key={mc.id}
              className={`typeb-card${activeId === mc.id ? " is-active" : ""}`}
              onMouseDown={() => onActivate?.(mc.id)}
              onFocusCapture={() => onActivate?.(mc.id)}
              style={{
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                padding: "10px",
                background: "var(--background-color-secondary)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <input
                  type="text"
                  value={mc.name || ""}
                  onChange={(e) => updateComponent(mc.id, "name", e.target.value)}
                  placeholder="Component name (e.g., Head Pressure)"
                  style={{ flex: 1 }}
                  aria-label="Type B component name"
                />
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
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isStandard ? "1fr 1fr 1fr" : "1fr 1fr 1fr 1fr",
                  gap: "8px",
                  alignItems: "end",
                }}
              >
                <label style={{ display: "flex", flexDirection: "column", gap: "3px", fontSize: "0.72rem" }}>
                  <span>Entry Mode</span>
                  <select
                    value={mc.inputMode || "tolerance"}
                    onChange={(e) => updateComponent(mc.id, "inputMode", e.target.value)}
                  >
                    <option value="tolerance">Tolerance limit (±)</option>
                    <option value="standard">Standard uncertainty (uᵢ)</option>
                  </select>
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: "3px", fontSize: "0.72rem" }}>
                  <span>{isStandard ? "Std. Uncertainty (±)" : "Tolerance Limit (±)"}</span>
                  <input
                    type="number"
                    step="any"
                    value={isStandard ? mc.standardUncertainty || "" : mc.toleranceLimit || ""}
                    onChange={(e) =>
                      updateComponent(
                        mc.id,
                        isStandard ? "standardUncertainty" : "toleranceLimit",
                        e.target.value,
                      )
                    }
                    placeholder="e.g., 0.5"
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: "3px", fontSize: "0.72rem" }}>
                  <span>Units</span>
                  <Select
                    value={selectedUnit}
                    onChange={(opt) => updateComponent(mc.id, "unit", opt ? opt.value : "")}
                    options={unitOptions}
                    filterOption={unitFilterOption}
                    classNamePrefix="react-select"
                    placeholder="Select…"
                    isSearchable
                    menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                    menuPosition="fixed"
                    styles={portalStyle}
                  />
                </label>

                {!isStandard && (
                  <label style={{ display: "flex", flexDirection: "column", gap: "3px", fontSize: "0.72rem" }}>
                    <span>Distribution</span>
                    <select
                      value={mc.distribution || DISTRIBUTION_NOT_SET}
                      onChange={(e) => updateComponent(mc.id, "distribution", e.target.value)}
                    >
                      {errorDistributions.map((dist) => (
                        <option key={dist.value} value={dist.value}>
                          {dist.value === DISTRIBUTION_NOT_SET
                            ? dist.label
                            : `${dist.label} (k=${dist.value})`}
                        </option>
                      ))}
                    </select>
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
            <FontAwesomeIcon icon={faFlask} />
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
