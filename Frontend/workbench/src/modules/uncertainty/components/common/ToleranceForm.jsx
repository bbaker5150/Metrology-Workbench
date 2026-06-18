import React, { useMemo, useEffect, useState, useRef } from "react";
import ReactDOM from "react-dom";
import Select from "react-select";
import {
  unitSystem,
  unitCategories,
  errorDistributions,
  getUnitDisplayLabel,
  unitFilterOption,
} from "../../utils/uncertaintyMath";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrashAlt, faPlus } from "@fortawesome/free-solid-svg-icons";

// Helper to transform flat unit list into React-Select Grouped Options
const getCategorizedUnitOptions = (allUnits, referenceUnit) => {
  const options = [];
  const usedUnits = new Set();

  // 1. Prioritize Reference Unit
  if (referenceUnit && allUnits.includes(referenceUnit)) {
    let refCategory = "Suggested";
    for (const [cat, units] of Object.entries(unitCategories)) {
      if (units.includes(referenceUnit)) {
        refCategory = cat;
        break;
      }
    }

    const categoryUnits = unitCategories[refCategory] || [referenceUnit];
    const prioritizedOptions = categoryUnits
      .filter((u) => allUnits.includes(u))
      .map((u) => {
        usedUnits.add(u);
        return { value: u, label: getUnitDisplayLabel(u) };
      });

    options.push({ label: refCategory, options: prioritizedOptions });
  }

  // 2. Add remaining categories
  Object.entries(unitCategories).forEach(([label, units]) => {
    if (options.some((opt) => opt.label === label)) return;

    const groupOptions = units
      .filter((u) => allUnits.includes(u) && !usedUnits.has(u))
      .map((u) => {
        usedUnits.add(u);
        return { value: u, label: getUnitDisplayLabel(u) };
      });

    if (groupOptions.length > 0) {
      options.push({ label, options: groupOptions });
    }
  });

  // 3. Catch-all
  const leftovers = allUnits
    .filter((u) => !usedUnits.has(u) && !["%", "ppm", "dB", "ppb"].includes(u))
    .map((u) => ({ value: u, label: getUnitDisplayLabel(u) }));

  if (leftovers.length > 0) {
    options.push({ label: "Other", options: leftovers });
  }

  return options;
};

// --- Portal Style for Dropdowns ---
const portalStyle = {
  menuPortal: (base) => ({ ...base, zIndex: 99999 }),
  menu: (base) => ({ ...base, zIndex: 99999 }),
};

// --- Definitions ---
const componentDefinitions = {
  // "% of Indicated Value" is the reading-proportional accuracy term. It is
  // strictly relative (%, ppm, ppb) — it scales with the measured value. An
  // absolute, fixed indicated-value error is a "Floor Value" instead, so the
  // former separate "Readings (IV)" (raw indicated value) component is dropped
  // and any legacy data is migrated to Floor.
  reading: {
    label: "% of Indicated Value",
    defaultState: {
      high: "",
      low: "",
      unit: "%",
      distribution: "1.732",
      symmetric: true,
    },
  },
  range: {
    label: "% Full Scale",
    defaultState: {
      value: "",
      high: "",
      low: "",
      unit: "%",
      distribution: "1.732",
      symmetric: true,
    },
  },
  floor: {
    label: "Floor Value",
    defaultState: {
      high: "",
      low: "",
      unit: "",
      distribution: "1.732",
      symmetric: true,
    },
  },
  db: {
    label: "dB Value",
    defaultState: {
      high: "",
      low: "",
      multiplier: 20,
      ref: 1,
      distribution: "1.732",
      symmetric: true,
    },
  },
};

const ToleranceForm = ({
  tolerance,
  setTolerance,
  isUUT,
  referencePoint,
  hideDistribution = false,
  // Show the measuring-resolution block even when this isn't a UUT instance
  // (e.g. the instrument builder, where any instrument may later be used as a
  // UUT or TMDE). Resolution is never forced into the budget — an explicit
  // opt-in checkbox controls that (#10).
  showResolution = false,
  // When the resolution VALUE is edited in a ranges-table column (instrument
  // builder / UUT editor), hide the redundant value input here and show only
  // the opt-in checkbox.
  resolutionInTable = false,
  // Show the "Manual Components (Type B)" authoring section (instrument builder
  // / UUT-TMDE editors). The components are stored on tolerance.manualComponents
  // and resolved into the budget by getBudgetComponentsFromTolerance.
  showManualComponents = false,
}) => {
  const [isAddComponentVisible, setAddComponentVisible] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null); // Ref for the portal content

  const allUnits = useMemo(() => Object.keys(unitSystem.units), []);

  const physicalUnitOptions = useMemo(() => {
    return getCategorizedUnitOptions(allUnits, referencePoint?.unit);
  }, [allUnits, referencePoint]);

  const ratioUnitOptions = useMemo(() => {
    return [
      { value: "%", label: "%" },
      { value: "ppm", label: "ppm" },
      { value: "ppb", label: "ppb" },
    ];
  }, []);

  // Manual components may be relative (%/ppm/ppb) or absolute (a physical unit
  // of the reference quantity), so offer both, ratios first.
  const manualUnitOptions = useMemo(
    () => [
      { label: "Ratio", options: ratioUnitOptions },
      ...physicalUnitOptions,
    ],
    [ratioUnitOptions, physicalUnitOptions],
  );

  const manualComponents = Array.isArray(tolerance.manualComponents)
    ? tolerance.manualComponents
    : [];

  const handleAddManualComponent = () => {
    setTolerance((prev) => ({
      ...prev,
      manualComponents: [
        ...(Array.isArray(prev.manualComponents) ? prev.manualComponents : []),
        {
          id: `mc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
          name: "",
          unit: referencePoint?.unit || "%",
          inputMode: "tolerance",
          toleranceLimit: "",
          standardUncertainty: "",
          distribution: "1.732",
        },
      ],
    }));
  };

  const handleManualComponentChange = (id, field, value) => {
    setTolerance((prev) => ({
      ...prev,
      manualComponents: (prev.manualComponents || []).map((mc) =>
        mc.id === id ? { ...mc, [field]: value } : mc,
      ),
    }));
  };

  const handleRemoveManualComponent = (id) => {
    setTolerance((prev) => ({
      ...prev,
      manualComponents: (prev.manualComponents || []).filter(
        (mc) => mc.id !== id,
      ),
    }));
  };

  // Handle click outside to close the portal
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Check if click is inside the button (toggle)
      if (buttonRef.current && buttonRef.current.contains(event.target)) {
        return;
      }
      // Check if click is inside the dropdown (portal)
      if (dropdownRef.current && dropdownRef.current.contains(event.target)) {
        return;
      }
      
      setAddComponentVisible(false);
    };

    if (isAddComponentVisible) {
        document.addEventListener("mousedown", handleClickOutside);
        // Recalculate position on scroll to ensure it stays attached (simple version)
        window.addEventListener("scroll", () => setAddComponentVisible(false), true);
    }
    
    return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        window.removeEventListener("scroll", () => setAddComponentVisible(false), true);
    };
  }, [isAddComponentVisible]);

  // --- Legacy migration: the former standalone "Readings (IV)" component held a
  // raw (absolute) indicated-value error, which is mathematically a Floor Value.
  // Fold it into `floor` when no floor term is present. If a floor already
  // exists we leave readings_iv intact — the math still sums it — rather than
  // silently dropping a contribution.
  useEffect(() => {
    setTolerance((prev) => {
      if (!prev || !prev.readings_iv || prev.floor) return prev;
      const { readings_iv, ...rest } = prev;
      return { ...rest, floor: readings_iv };
    });
  }, [setTolerance]);

  // --- Auto-Update Units Hook ---
  useEffect(() => {
    if (!referencePoint?.unit) return;

    setTolerance((prev) => {
      let updated = false;
      const next = { ...prev };

      const checkAndSet = (key) => {
        if (next[key] && !next[key].unit) {
          next[key] = { ...next[key], unit: referencePoint.unit };
          updated = true;
        }
      };

      checkAndSet("floor");
      checkAndSet("readings_iv");

      if (isUUT && !next.measuringResolutionUnit) {
        next.measuringResolutionUnit = referencePoint.unit;
        updated = true;
      }

      return updated ? next : prev;
    });
  }, [referencePoint?.unit, isUUT, setTolerance]); 

  const handleChange = (e) => {
    const { name, value, checked, dataset } = e.target;

    if (dataset.type === "misc") {
      setTolerance((prev) => ({ ...prev, [name]: value }));
      return;
    }

    const { field, componentKey } = dataset;

    setTolerance((prev) => {
      const newTol = { ...prev };
      const comp = { ...newTol[componentKey] };
      let newHigh = comp.high;
      let newLow = comp.low;
      let newSymmetric = comp.symmetric;

      if (field === "symmetric") newSymmetric = checked;
      else if (field === "high") newHigh = value;
      else if (field === "low") newLow = value;
      else comp[field] = value;

      if (newSymmetric) {
        if (field === "high" || (field === "symmetric" && newHigh)) {
          const highVal = parseFloat(newHigh);
          newLow = !isNaN(highVal) ? String(-highVal) : "";
        }
      }

      comp.high = newHigh;
      comp.low = newLow;
      comp.symmetric = newSymmetric;
      newTol[componentKey] = comp;
      return newTol;
    });
  };

  const handleSelectChange = (
    selectedOption,
    field,
    componentKey,
    isMisc = false
  ) => {
    const value = selectedOption ? selectedOption.value : "";

    const fakeEvent = {
      target: {
        name: isMisc ? field : undefined,
        value: value,
        dataset: {
          type: isMisc ? "misc" : undefined,
          field: field,
          componentKey: componentKey,
        },
      },
    };

    handleChange(fakeEvent);
  };

  const handleToggleMenu = () => {
      if (!isAddComponentVisible && buttonRef.current) {
          const rect = buttonRef.current.getBoundingClientRect();
          // Open upwards if near bottom of screen
          const spaceBelow = window.innerHeight - rect.bottom;
          const openUp = spaceBelow < 250; 
          
          setDropdownPosition({
              left: rect.left,
              top: openUp ? (rect.top - 8) : (rect.bottom + 8),
              transform: openUp ? 'translateY(-100%)' : 'none'
          });
      }
      setAddComponentVisible(!isAddComponentVisible);
  };

  const handleAddComponent = (componentKey) => {
    if (componentKey && !tolerance[componentKey]) {
      const newState = { ...componentDefinitions[componentKey].defaultState };

      if (!newState.unit) {
        if (referencePoint?.unit) {
          newState.unit = referencePoint.unit;
        } else if (componentKey === "floor") {
          const validUnits = allUnits.filter(
            (u) => !["%", "ppm", "dB", "ppb"].includes(u)
          );
          if (validUnits.length > 0) {
            newState.unit = validUnits[0];
          }
        }
      }

      setTolerance((prev) => ({
        ...prev,
        [componentKey]: newState,
      }));
    }
    setAddComponentVisible(false);
  };

  const handleRemoveComponent = (key) => {
    setTolerance((prev) => {
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  };

  const renderComponentCard = (key) => {
    const componentData = tolerance[key];
    if (!componentData) return null;

    const distributionOptions = errorDistributions;

    const limitsSection = (
      <div className="input-group-asymmetric">
        <div>
          <label>Lower Limit</label>
          <input
            type="number"
            step="any"
            data-component-key={key}
            data-field="low"
            value={componentData.low || ""}
            onChange={handleChange}
            disabled={componentData.symmetric}
            placeholder="- value"
          />
        </div>
        <div>
          <label>Upper Limit</label>
          <input
            type="number"
            step="any"
            data-component-key={key}
            data-field="high"
            value={componentData.high || ""}
            onChange={handleChange}
            placeholder="+ value"
          />
        </div>
      </div>
    );

    const symmetricToggle = (
        <div className="toggle-switch-container" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '10px' }}>
          <input
            type="checkbox"
            id={`symmetric_${key}_${tolerance.id || "new"}`}
            data-component-key={key}
            data-field="symmetric"
            className="toggle-switch-checkbox"
            checked={!!componentData.symmetric}
            onChange={handleChange}
          />
          <label
            className="toggle-switch-label"
            htmlFor={`symmetric_${key}_${tolerance.id || "new"}`}
            style={{ transform: "scale(0.75)", margin: 0, border: '1px solid var(--border-color)' }}
          >
            <span className="toggle-switch-switch" />
          </label>
          <label
            htmlFor={`symmetric_${key}_${tolerance.id || "new"}`}
            className="toggle-option-label"
            style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-color-muted)", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.5px" }}
          >
            Symmetric
          </label>
        </div>
    );

    const renderUnitSection = (options) => {
        const flatOptions = options.flatMap((o) => (o.options ? o.options : o));
        const selectedValue = flatOptions.find(
          (opt) => opt.value === componentData.unit
        );
        return (
            <div>
                <label>Units</label>
                <Select
                  value={selectedValue || null}
                  onChange={(opt) => handleSelectChange(opt, "unit", key)}
                  options={options}
                  filterOption={unitFilterOption}
                  className="react-select-container"
                  classNamePrefix="react-select"
                  placeholder="Select..."
                  isSearchable={true}
                  menuPortalTarget={document.body}
                  menuPosition="fixed"
                  styles={portalStyle}
                />
            </div>
        );
    };

    const distributionSection = !hideDistribution ? (
        <div>
          <label>Distribution</label>
          <select
            data-component-key={key}
            data-field="distribution"
            value={componentData.distribution || "1.732"}
            onChange={handleChange}
            style={{width: '100%'}}
          >
            {distributionOptions.map((dist) => (
              <option key={dist.value} value={dist.value}>
                {dist.label} (k={dist.value})
              </option>
            ))}
          </select>
        </div>
    ) : null;

    let content = null;

    if (key === "range") {
         content = (
          <div className="config-stack">
            <div>
                <label>Range (FS) Value</label>
                <input
                type="number"
                step="any"
                data-component-key="range"
                data-field="value"
                value={componentData.value || ""}
                onChange={handleChange}
                placeholder="e.g., 100"
                />
            </div>
            {limitsSection}
            {renderUnitSection(ratioUnitOptions)}
          </div>
        );
    } else if (key === "db") {
        content = (
          <div className="config-stack">
            {limitsSection}
            <div className="input-group-asymmetric">
                <div>
                    <label>dB Equation Multiplier</label>
                    <input
                    type="number"
                    step="any"
                    data-component-key="db"
                    data-field="multiplier"
                    value={componentData.multiplier || 20}
                    onChange={handleChange}
                    />
                </div>
                <div>
                    <label>dB Reference Value</label>
                    <input
                    type="number"
                    step="any"
                    data-component-key="db"
                    data-field="ref"
                    value={componentData.ref || 1}
                    onChange={handleChange}
                    />
                </div>
            </div>
            {distributionSection}
          </div>
        );
    } else {
        // "% of Indicated Value" (reading) is strictly relative (%/ppm/ppb);
        // floor is an absolute value, so it only offers physical units.
        const unitOptions = (key === 'reading') ? ratioUnitOptions : physicalUnitOptions;
        content = (
          <div className="config-stack">
            {limitsSection}
            {renderUnitSection(unitOptions)}
          </div>
        );
    }

    return (
      <div className="component-card" key={key}>
        <div className="component-header">
          <h5>{componentDefinitions[key].label}</h5>
          
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {symmetricToggle}
            
            <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-color)', margin: '0 10px' }}></div>

            <button
              onClick={() => handleRemoveComponent(key)}
              className="remove-component-btn"
              title="Remove component"
            >
              <FontAwesomeIcon icon={faTrashAlt} />
            </button>
          </div>
        </div>
        <div className="component-body">{content}</div>
      </div>
    );
  };

  const addedComponents = Object.keys(tolerance).filter(
    (key) => componentDefinitions[key]
  );
  const availableComponents = Object.keys(componentDefinitions).filter(
    (key) => !tolerance[key]
  );

  // The reading / range / floor / readings-IV terms are pieces of ONE
  // manufacturer accuracy statement (e.g. "% of reading + floor"), not
  // independent error sources, so they share a single distribution shape. dB and
  // resolution are separate budget line items and keep their own. This avoids the
  // old behaviour where per-piece dropdowns were offered but only the first was
  // ever honoured by the budget. See getBudgetComponentsFromTolerance.
  const accuracyBandKeys = ["reading", "readings_iv", "range", "floor"];
  const presentBandKeys = accuracyBandKeys.filter((key) => tolerance[key]);
  const bandDistribution =
    presentBandKeys.length > 0
      ? tolerance[presentBandKeys[0]].distribution || "1.732"
      : "1.732";
  const bandDistributionOptions = errorDistributions;
  const handleBandDistributionChange = (value) => {
    setTolerance((prev) => {
      const next = { ...prev };
      accuracyBandKeys.forEach((key) => {
        if (next[key] && typeof next[key] === "object") {
          next[key] = { ...next[key], distribution: value };
        }
      });
      return next;
    });
  };

  return (
    <>
      <div className="components-container">
        {addedComponents.length > 0 ? (
          addedComponents.map((key) => renderComponentCard(key))
        ) : (
          <div
            className="placeholder-content"
            style={{
              minHeight: "100px",
              margin: "10px 0",
              backgroundColor: "transparent",
            }}
          >
            <p>No tolerance components added.</p>
          </div>
        )}
      </div>

      {!hideDistribution && presentBandKeys.length > 0 && (
        <div className="band-distribution-section" style={{ marginTop: "12px" }}>
          <label>Spec Distribution</label>
          <select
            value={bandDistribution}
            onChange={(e) => handleBandDistributionChange(e.target.value)}
            style={{ width: "100%" }}
          >
            {bandDistributionOptions.map((dist) => (
              <option key={dist.value} value={dist.value}>
                {dist.label} (k={dist.value})
              </option>
            ))}
          </select>
          <small
            style={{
              display: "block",
              marginTop: "4px",
              color: "var(--text-color-muted)",
              fontSize: "0.72rem",
            }}
          >
            Applies to the whole accuracy spec (reading, range, floor). A
            manufacturer limit is rectangular unless a confidence level or
            coverage factor is stated.
          </small>
        </div>
      )}

      <div className="add-component-wrapper"> 
        {availableComponents.length > 0 && (
          <button
            ref={buttonRef}
            className="add-component-button"
            onClick={handleToggleMenu}
            title="Add new tolerance component"
          >
            <FontAwesomeIcon icon={faPlus} />
            <span>Add Tolerance</span>
          </button>
        )}

        {/* PORTAL RENDER:
            This renders the dropdown into the document.body, escaping 
            any overflow:hidden containers in the Modal. 
            It uses the styles you defined in App.css (.add-component-dropdown).
        */}
        {isAddComponentVisible && availableComponents.length > 0 && ReactDOM.createPortal(
          <div 
            ref={dropdownRef}
            className="add-component-dropdown"
            style={{
                position: 'fixed',
                top: dropdownPosition.top,
                left: dropdownPosition.left,
                transform: dropdownPosition.transform,
                zIndex: 999999, // Ensure it's on top of everything
                // Width can be auto, or match the button if you prefer
            }}
          >
            <ul>
              {availableComponents.map((key) => (
                <li 
                    key={key} 
                    onClick={() => handleAddComponent(key)}
                >
                  {componentDefinitions[key].label}
                </li>
              ))}
            </ul>
          </div>,
          document.body
        )}
      </div>

      {showManualComponents && (
        <div
          className="form-section"
          style={{
            marginTop: "20px",
            borderTop: "1px solid var(--border-color)",
            paddingTop: "20px",
          }}
        >
          <label style={{ display: "block", marginBottom: "6px" }}>
            Manual Components (Type B)
          </label>
          <small
            style={{
              display: "block",
              marginBottom: "10px",
              color: "var(--text-color-muted)",
              fontSize: "0.72rem",
            }}
          >
            Extra Type B uncertainty sources carried with this spec (e.g.
            cal-cert uncertainty, drift). Each is resolved against the
            measurement point where the instrument is used.
          </small>

          <div className="components-container">
            {manualComponents.map((mc) => {
              const isStandard = mc.inputMode === "standard";
              const selectedUnit =
                manualUnitOptions
                  .flatMap((g) => (g.options ? g.options : g))
                  .find((o) => o.value === mc.unit) || null;
              return (
                <div className="component-card" key={mc.id}>
                  <div className="component-header">
                    <input
                      type="text"
                      value={mc.name || ""}
                      onChange={(e) =>
                        handleManualComponentChange(
                          mc.id,
                          "name",
                          e.target.value,
                        )
                      }
                      placeholder="Component name (e.g., Cal Uncertainty)"
                      style={{ flex: 1, marginRight: "10px" }}
                    />
                    <button
                      onClick={() => handleRemoveManualComponent(mc.id)}
                      className="remove-component-btn"
                      title="Remove component"
                    >
                      <FontAwesomeIcon icon={faTrashAlt} />
                    </button>
                  </div>
                  <div className="component-body">
                    <div className="config-stack">
                      <div className="input-group-asymmetric">
                        <div>
                          <label>Entry Mode</label>
                          <select
                            value={mc.inputMode || "tolerance"}
                            onChange={(e) =>
                              handleManualComponentChange(
                                mc.id,
                                "inputMode",
                                e.target.value,
                              )
                            }
                            style={{ width: "100%" }}
                          >
                            <option value="tolerance">
                              Tolerance limit (±)
                            </option>
                            <option value="standard">
                              Standard uncertainty (uᵢ)
                            </option>
                          </select>
                        </div>
                        <div>
                          <label>
                            {isStandard
                              ? "Standard Uncertainty (±)"
                              : "Tolerance Limit (±)"}
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={
                              isStandard
                                ? mc.standardUncertainty || ""
                                : mc.toleranceLimit || ""
                            }
                            onChange={(e) =>
                              handleManualComponentChange(
                                mc.id,
                                isStandard
                                  ? "standardUncertainty"
                                  : "toleranceLimit",
                                e.target.value,
                              )
                            }
                            placeholder="e.g., 0.001"
                          />
                        </div>
                      </div>
                      <div
                        className={isStandard ? "" : "input-group-asymmetric"}
                      >
                        <div>
                          <label>Units</label>
                          <Select
                            value={selectedUnit}
                            onChange={(opt) =>
                              handleManualComponentChange(
                                mc.id,
                                "unit",
                                opt ? opt.value : "",
                              )
                            }
                            options={manualUnitOptions}
                            filterOption={unitFilterOption}
                            className="react-select-container"
                            classNamePrefix="react-select"
                            placeholder="Select..."
                            isSearchable={true}
                            menuPortalTarget={document.body}
                            menuPosition="fixed"
                            styles={portalStyle}
                          />
                        </div>
                        {!isStandard && (
                          <div>
                            <label>Distribution</label>
                            <select
                              value={mc.distribution || "1.732"}
                              onChange={(e) =>
                                handleManualComponentChange(
                                  mc.id,
                                  "distribution",
                                  e.target.value,
                                )
                              }
                              style={{ width: "100%" }}
                            >
                              {bandDistributionOptions.map((dist) => (
                                <option key={dist.value} value={dist.value}>
                                  {dist.label} (k={dist.value})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {manualComponents.length === 0 && (
              <div
                className="placeholder-content"
                style={{
                  minHeight: "60px",
                  margin: "6px 0",
                  backgroundColor: "transparent",
                }}
              >
                <p>No manual components added.</p>
              </div>
            )}
          </div>

          <div className="add-component-wrapper">
            <button
              className="add-component-button"
              onClick={handleAddManualComponent}
              title="Add manual Type B component"
            >
              <FontAwesomeIcon icon={faPlus} />
              <span>Add Manual Component</span>
            </button>
          </div>
        </div>
      )}

      {(isUUT || showResolution) && (
        <div
          className="form-section"
          style={{
            marginTop: "20px",
            borderTop: "1px solid var(--border-color)",
            paddingTop: "20px",
          }}
        >
          {!resolutionInTable && (
            <>
              <label>Measuring Resolution (Least Significant Digit)</label>
              <div
                className="input-with-unit"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 120px",
                  gap: "10px",
                }}
              >
                <input
                  type="number"
                  step="any"
                  name="measuringResolution"
                  data-type="misc"
                  value={tolerance.measuringResolution || ""}
                  onChange={handleChange}
                  placeholder="e.g., 1"
                  style={{ width: "100%" }}
                />

                {/* Resolution Unit Selector */}
                <Select
                  value={
                    physicalUnitOptions
                      .flatMap((g) => (g.options ? g.options : g))
                      .find(
                        (opt) => opt.value === tolerance.measuringResolutionUnit
                      ) || null
                  }
                  onChange={(opt) =>
                    handleSelectChange(opt, "measuringResolutionUnit", null, true)
                  }
                  options={physicalUnitOptions}
                  filterOption={unitFilterOption}
                  className="react-select-container"
                  classNamePrefix="react-select"
                  placeholder="Unit"
                  isSearchable={true}
                  menuPortalTarget={document.body}
                  menuPosition="fixed"
                  styles={portalStyle}
                />
              </div>
            </>
          )}

          {/* Opt-in: resolution is excluded from the uncertainty budget unless
              the user explicitly enables it here (#10). */}
          {!resolutionInTable && <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginTop: "12px",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              name="includeResolutionInBudget"
              data-type="misc"
              checked={!!tolerance.includeResolutionInBudget}
              onChange={(e) =>
                setTolerance((prev) => ({
                  ...prev,
                  includeResolutionInBudget: e.target.checked,
                }))
              }
            />
            <span>Include resolution in uncertainty budget</span>
          </label>}
        </div>
      )}
    </>
  );
};

export default ToleranceForm;
