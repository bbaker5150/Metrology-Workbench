import * as math from "mathjs";
import React, { useState, useEffect, useMemo, useRef } from "react";
import ReactDOM from "react-dom";
import Select from "react-select";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBookOpen,
  faCheck,
  faGripHorizontal,
  faLayerGroup,
  faMicroscope,
  faPlus,
  faTrashAlt,
} from "@fortawesome/free-solid-svg-icons";
import { v4 as uuidv4 } from "uuid";
import {
  getUnitDisplayLabel,
  unitSystem,
  unitCategories,
  unitFilterOption,
} from "../../../utils/uncertaintyMath";
// Shared, engine-verified f(x) symbol catalog.
import { symbolCategories } from "../../../utils/equationSymbols";
import NotificationModal from "../../../components/modals/NotificationModal";
import EquationLibraryMenu from "../../analysis/components/EquationLibraryMenu";
import "./AddTestPointModal.css";

const customSelectStyles = {
  menuPortal: (base) => ({ ...base, zIndex: 99999 }),
  menu: (base) => ({ ...base, zIndex: 99999 }),
  control: (base) => ({
    ...base,
    minHeight: "40px",
    height: "40px",
    backgroundColor: "var(--input-background)",
    borderColor: "var(--border-color)",
    color: "var(--text-color)",
    boxShadow: "none",
  }),
  valueContainer: (base) => ({
    ...base,
    height: "40px",
    padding: "0 10px",
    display: "flex",
    alignItems: "center",
  }),
  singleValue: (base) => ({ ...base, color: "var(--text-color)" }),
  input: (base) => ({ ...base, margin: 0, padding: 0, color: "var(--text-color)" }),
  indicatorsContainer: (base) => ({ ...base, height: "40px" }),
};

const createPointRow = (overrides = {}) => ({
  id: uuidv4(),
  section: "",
  value: "",
  qualifierValue: "",
  ...overrides,
});

const SymbolButton = ({ onSymbolClick, symbol, title }) => (
  <button
    type="button"
    className="add-point-symbol-button"
    title={title || `Insert ${symbol}`}
    onClick={() => onSymbolClick(symbol)}
  >
    {symbol.replace("()", "( )")}
  </button>
);

const AddTestPointModal = ({
  isOpen,
  onClose,
  onSave,
  initialData,
  previousTestPointData = null,
  sessionData = null,
}) => {
  const [position, setPosition] = useState(() => {
    if (typeof window === "undefined") return { x: 0, y: 0 };
    return {
      x: Math.max(0, (window.innerWidth - 920) / 2),
      y: Math.max(0, (window.innerHeight - 720) / 2),
    };
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const [formData, setFormData] = useState({
    functionName: "Measurement",
    paramUnit: "",
    qualName: "Frequency",
    qualUnit: "kHz",
    measurementType: "direct",
    equationString: "",
    variableMappings: {},
  });
  const [pointRows, setPointRows] = useState([createPointRow()]);
  const [hasQualifier, setHasQualifier] = useState(false);
  const [notification, setNotification] = useState(null);
  const [equationVariables, setEquationVariables] = useState([]);
  const [isSymbolMenuOpen, setIsSymbolMenuOpen] = useState(false);
  const [symbolMenuPosition, setSymbolMenuPosition] = useState({ top: 0, left: 0 });
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [libraryMenuPosition, setLibraryMenuPosition] = useState({ top: 0, left: 0 });
  const [cursorPos, setCursorPos] = useState(null);

  const equationInputRef = useRef(null);
  const symbolButtonRef = useRef(null);
  const symbolMenuRef = useRef(null);
  const libraryButtonRef = useRef(null);
  const libraryMenuRef = useRef(null);

  const groupedUnitOptions = useMemo(() => {
    const allSupportedUnits = Object.keys(unitSystem.units);
    const options = [];
    const usedUnits = new Set();

    Object.entries(unitCategories).forEach(([category, units]) => {
      const validUnits = units.filter((u) => allSupportedUnits.includes(u));
      if (validUnits.length > 0) {
        options.push({
          label: category,
          options: validUnits.map((u) => {
            usedUnits.add(u);
            return { value: u, label: getUnitDisplayLabel(u) };
          }),
        });
      }
    });

    const leftovers = allSupportedUnits
      .filter((u) => !usedUnits.has(u))
      .sort()
      .map((u) => ({ value: u, label: getUnitDisplayLabel(u) }));

    if (leftovers.length > 0) options.push({ label: "Other", options: leftovers });
    return options;
  }, []);

  const contextUuts = useMemo(() => {
    const ids = initialData?.associatedUutIds || previousTestPointData?.associatedUutIds || [];
    return ids
      .map((id) => (sessionData?.uuts || []).find((u) => String(u.id) === String(id)))
      .filter(Boolean);
  }, [initialData, previousTestPointData, sessionData]);

  const handleMouseDown = (e) => {
    // The f(x) / Library popovers are portaled to <body> at coordinates
    // captured when they open, so they don't track the modal as it moves.
    // Dismiss them when a drag begins rather than leaving an orphaned dropdown
    // floating at the old spot.
    setIsSymbolMenuOpen(false);
    setIsLibraryOpen(false);
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      });
    };
    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragOffset, isDragging]);

  const updateEquationVariables = (equation) => {
    if (!equation) {
      setEquationVariables([]);
      setFormData((prev) => ({ ...prev, variableMappings: {} }));
      return;
    }

    let expressionToParse = equation.trim();
    const equalsIndex = expressionToParse.indexOf("=");
    if (equalsIndex !== -1) {
      expressionToParse =
        equalsIndex < expressionToParse.length - 1
          ? expressionToParse.substring(equalsIndex + 1).trim()
          : "";
    }

    if (!expressionToParse) {
      setEquationVariables([]);
      setFormData((prev) => ({ ...prev, variableMappings: {} }));
      return;
    }

    try {
      const node = math.parse(expressionToParse);
      const variables = new Set();
      node.traverse((child) => {
        if (
          child.isSymbolNode &&
          !math[child.name] &&
          !["e", "pi", "i"].includes(child.name.toLowerCase())
        ) {
          variables.add(child.name);
        }
      });
      const sortedVars = Array.from(variables).sort();
      setEquationVariables(sortedVars);
      setFormData((prev) => {
        const variableMappings = {};
        sortedVars.forEach((v) => {
          variableMappings[v] = prev.variableMappings[v] || "";
        });
        return { ...prev, variableMappings };
      });
    } catch {
      /* Mid-edit expressions (e.g. "w*l+") don't parse; keep the last good
         variable list and mappings rather than wiping them. */
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const baseData = previousTestPointData || {};
    const overrideData = initialData || {};
    const isEditing = !!overrideData.id;
    const source = isEditing ? overrideData : { ...baseData, ...overrideData };
    const sourceParam = source.testPointInfo?.parameter || {};
    const sourceQualifier = source.testPointInfo?.qualifier || {};
    const inferredRange = source.uutTolerance || {};
    const inferredFunction =
      sourceParam.name ||
      inferredRange.functionName ||
      contextUuts[0]?.instrument?.functions?.[0]?.name ||
      "Measurement";
    const inferredUnit =
      sourceParam.unit ||
      inferredRange.unit ||
      contextUuts[0]?.instrument?.functions?.[0]?.unit ||
      "";

    setHasQualifier(!!sourceQualifier.value);
    setFormData({
      functionName: inferredFunction,
      paramUnit: inferredUnit,
      qualName: sourceQualifier.name || "Frequency",
      qualUnit: sourceQualifier.unit || "kHz",
      measurementType: source.measurementType || "direct",
      equationString: source.equationString || "",
      variableMappings: { ...(source.variableMappings || {}) },
    });
    setPointRows([
      createPointRow({
        section: source.section || "",
        value: isEditing ? sourceParam.value || "" : "",
        qualifierValue: isEditing ? sourceQualifier.value || "" : "",
      }),
    ]);

    if (source.measurementType === "derived") {
      updateEquationVariables(source.equationString);
    } else {
      setEquationVariables([]);
    }
  }, [contextUuts, initialData, isOpen, previousTestPointData]);

  useEffect(() => {
    if (cursorPos !== null && equationInputRef.current) {
      equationInputRef.current.focus();
      equationInputRef.current.setSelectionRange(cursorPos, cursorPos);
      setCursorPos(null);
    }
  }, [cursorPos, formData.equationString]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        symbolMenuRef.current &&
        !symbolMenuRef.current.contains(event.target) &&
        symbolButtonRef.current &&
        !symbolButtonRef.current.contains(event.target)
      ) {
        setIsSymbolMenuOpen(false);
      }
      if (
        libraryMenuRef.current &&
        !libraryMenuRef.current.contains(event.target) &&
        libraryButtonRef.current &&
        !libraryButtonRef.current.contains(event.target)
      ) {
        setIsLibraryOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!isOpen) return null;

  const isEditing = !!initialData?.id;
  const unitValue =
    groupedUnitOptions.flatMap((g) => g.options).find((opt) => opt.value === formData.paramUnit) ||
    null;
  const qualUnitValue =
    groupedUnitOptions.flatMap((g) => g.options).find((opt) => opt.value === formData.qualUnit) ||
    null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (name === "equationString") updateEquationVariables(value);
  };

  const updateRow = (rowId, field, value) => {
    setPointRows((rows) => rows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)));
  };

  const addRow = () => {
    const last = pointRows[pointRows.length - 1] || {};
    setPointRows((rows) => [...rows, createPointRow({ section: last.section || "" })]);
  };

  const removeRow = (rowId) => {
    setPointRows((rows) => (rows.length > 1 ? rows.filter((row) => row.id !== rowId) : rows));
  };

  const handleSymbolMenuToggle = () => {
    const rect = symbolButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setSymbolMenuPosition({
        top: rect.bottom + 6,
        left: Math.max(12, rect.right - 360),
      });
    }
    setIsSymbolMenuOpen((open) => !open);
  };

  const handleLibraryMenuToggle = () => {
    const rect = libraryButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setLibraryMenuPosition({
        top: rect.bottom + 6,
        left: Math.max(12, rect.right - 360),
      });
    }
    setIsLibraryOpen((open) => !open);
  };

  // Insert a library equation: non-destructive (confirm before replacing a
  // different non-empty equation), pre-filling the variable map with the
  // library's suggested names while letting any existing name for the same
  // symbol win.
  const handleLibrarySelect = (equation) => {
    setIsLibraryOpen(false);
    const current = (formData.equationString || "").trim();
    if (
      current &&
      current !== equation.expression &&
      !window.confirm(
        `Replace the current equation with "${equation.name}" (${equation.expression})?`,
      )
    ) {
      return;
    }
    setFormData((prev) => {
      const currentMappings = prev.variableMappings || {};
      const newMappings = {};
      Object.entries(equation.variables).forEach(([symbol, suggestedName]) => {
        newMappings[symbol] = currentMappings[symbol] || suggestedName;
      });
      return {
        ...prev,
        equationString: equation.expression,
        variableMappings: newMappings,
      };
    });
    updateEquationVariables(equation.expression);
  };

  const handleSymbolClick = (symbol) => {
    const input = equationInputRef.current;
    if (!input) return;

    input.focus();
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const currentValue = input.value;
    const selectedText = currentValue.substring(start, end);
    const isFunction = symbol.endsWith("()");
    let newValue;
    let newCursorPos;

    if (isFunction) {
      const funcName = symbol.slice(0, -2);
      const textToInsert = `${funcName}(${selectedText})`;
      newValue = currentValue.substring(0, start) + textToInsert + currentValue.substring(end);
      newCursorPos = selectedText ? start + textToInsert.length : start + funcName.length + 1;
    } else {
      newValue = currentValue.substring(0, start) + symbol + currentValue.substring(end);
      newCursorPos = start + symbol.length;
    }

    setFormData((prev) => ({ ...prev, equationString: newValue }));
    updateEquationVariables(newValue);
    setCursorPos(newCursorPos);
  };

  const handleMappingChange = (variableSymbol, userFriendlyName) => {
    setFormData((prev) => ({
      ...prev,
      variableMappings: {
        ...prev.variableMappings,
        [variableSymbol]: userFriendlyName,
      },
    }));
  };

  const handleSave = () => {
    const validRows = pointRows.filter((row) => String(row.value || "").trim() !== "");
    const missingVariableNames =
      formData.measurementType === "derived" &&
      equationVariables.some(
        (v) => !formData.variableMappings[v] || formData.variableMappings[v].trim() === "",
      );

    if (
      !formData.paramUnit ||
      validRows.length === 0 ||
      (formData.measurementType === "derived" && !formData.equationString) ||
      missingVariableNames
    ) {
      setNotification({
        title: "Missing Information",
        message:
          "Add at least one point value, choose a base unit, and complete equation details for derived points.",
      });
      return;
    }

    const associatedUutIds =
      initialData?.associatedUutIds ?? previousTestPointData?.associatedUutIds ?? [];
    const qualifierBase = hasQualifier
      ? { name: formData.qualName || "Qualifier", unit: formData.qualUnit || "" }
      : null;

    const buildPayload = (row) => ({
      section: row.section?.trim() || "",
      testPointInfo: {
        parameter: {
          name: formData.functionName || "Measurement",
          value: row.value,
          unit: formData.paramUnit,
        },
        qualifier: qualifierBase
          ? { ...qualifierBase, value: row.qualifierValue || "" }
          : null,
      },
      measurementType: formData.measurementType,
      equationString: formData.equationString,
      variableMappings: formData.variableMappings,
      measurementAreaId: initialData?.measurementAreaId || previousTestPointData?.measurementAreaId || null,
      associatedUutIds,
      uutTolerance: initialData?.uutTolerance || previousTestPointData?.uutTolerance || null,
    });

    if (isEditing) {
      onSave({ id: initialData.id, ...buildPayload(validRows[0]) });
    } else {
      onSave(validRows.map(buildPayload));
    }
  };

  const symbolMenu = isSymbolMenuOpen
    ? ReactDOM.createPortal(
        <div
          className="add-point-symbol-popover"
          ref={symbolMenuRef}
          style={{ top: symbolMenuPosition.top, left: symbolMenuPosition.left }}
        >
          {Object.entries(symbolCategories).map(([category, symbols]) => (
            <div key={category} className="add-point-symbol-category">
              <h5>{category}</h5>
              <div className="add-point-symbol-grid">
                {symbols.map((item) => (
                  <SymbolButton
                    key={item.symbol}
                    symbol={item.symbol}
                    title={item.title}
                    onSymbolClick={handleSymbolClick}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )
    : null;

  const libraryMenu = isLibraryOpen
    ? ReactDOM.createPortal(
        <div
          className="add-point-symbol-popover"
          ref={libraryMenuRef}
          style={{
            top: libraryMenuPosition.top,
            left: libraryMenuPosition.left,
            maxHeight: "60vh",
            overflowY: "auto",
          }}
        >
          <EquationLibraryMenu onSelect={handleLibrarySelect} />
        </div>,
        document.body,
      )
    : null;

  return ReactDOM.createPortal(
    <>
      {notification && (
        <NotificationModal
          isOpen={!!notification}
          onClose={() => setNotification(null)}
          title={notification.title}
          message={notification.message}
        />
      )}
      {symbolMenu}
      {libraryMenu}

      <div
        className="modal-content floating-window-content add-point-modal"
        style={{
          position: "fixed",
          top: position.y,
          left: position.x,
          margin: 0,
          width: "920px",
          maxWidth: "94vw",
          maxHeight: "90vh",
          zIndex: 2000,
        }}
      >
        <div className="add-point-header" onMouseDown={handleMouseDown}>
          <div className="add-point-title">
            <FontAwesomeIcon icon={faGripHorizontal} className="add-point-drag-icon" />
            <div className="add-point-title-text">
              <h3>{isEditing ? "Edit Measurement Point" : "Add Measurement Points"}</h3>
              <div className="add-point-header-meta">
                <span className="add-point-header-chip" title="UUT context">
                  <FontAwesomeIcon icon={faMicroscope} />
                  <span>
                    {contextUuts[0]?.description || contextUuts[0]?.name || "No UUT selected"}
                    {contextUuts.length > 1 ? ` +${contextUuts.length - 1}` : ""}
                  </span>
                </span>
                {formData.functionName && (
                  <span className="add-point-header-chip" title="Function">
                    <FontAwesomeIcon icon={faLayerGroup} />
                    <span>{formData.functionName}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="modal-close-button" style={{ position: "static" }}>
            &times;
          </button>
        </div>

        <div className="add-point-body">
          <section className="add-point-main">
            <div className="add-point-section">
              <div className="add-point-section-header">
                <h4>Function</h4>
                <div className="add-point-type-toggle" role="group" aria-label="Measurement type">
                  <button
                    type="button"
                    className={formData.measurementType === "direct" ? "active" : ""}
                    onClick={() => setFormData((prev) => ({ ...prev, measurementType: "direct" }))}
                  >
                    Direct
                  </button>
                  <button
                    type="button"
                    className={formData.measurementType === "derived" ? "active" : ""}
                    onClick={() => setFormData((prev) => ({ ...prev, measurementType: "derived" }))}
                  >
                    Derived
                  </button>
                </div>
              </div>

              <div className="add-point-form-grid">
                <label>
                  <span>Function Name</span>
                  <input
                    type="text"
                    name="functionName"
                    value={formData.functionName}
                    onChange={handleChange}
                    placeholder="e.g., DC Voltage"
                  />
                </label>
                <label>
                  <span>Base Unit</span>
                  <Select
                    name="paramUnit"
                    value={unitValue}
                    onChange={(opt) =>
                      setFormData((prev) => ({ ...prev, paramUnit: opt ? opt.value : "" }))
                    }
                    options={groupedUnitOptions}
                    filterOption={unitFilterOption}
                    placeholder="Unit"
                    classNamePrefix="react-select"
                    menuPortalTarget={document.body}
                    menuPosition="fixed"
                    styles={customSelectStyles}
                  />
                </label>
              </div>

              {formData.measurementType === "derived" && (
                <div className="add-point-derived-block">
                  <label className="add-point-equation-label">
                    <span>Equation</span>
                    <div className="add-point-equation-input">
                      <input
                        ref={equationInputRef}
                        type="text"
                        name="equationString"
                        value={formData.equationString}
                        onChange={handleChange}
                        placeholder="e.g., V / I"
                      />
                      <div className="add-point-equation-actions">
                        <button
                          type="button"
                          className="add-point-fx-button"
                          ref={symbolButtonRef}
                          onClick={handleSymbolMenuToggle}
                          title="Insert function or symbol"
                        >
                          f(x)
                        </button>
                        <button
                          type="button"
                          className="add-point-fx-button is-library"
                          ref={libraryButtonRef}
                          onClick={handleLibraryMenuToggle}
                          title="Insert a common metrology equation"
                        >
                          <FontAwesomeIcon icon={faBookOpen} />
                          Library
                        </button>
                      </div>
                    </div>
                  </label>

                  {equationVariables.length > 0 && (
                    <div className="add-point-variable-map">
                      {equationVariables.map((variable) => (
                        <label key={variable}>
                          <span>{variable} =</span>
                          <input
                            type="text"
                            value={formData.variableMappings[variable] || ""}
                            onChange={(e) => handleMappingChange(variable, e.target.value)}
                            placeholder="Display name"
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="add-point-section">
              <div className="add-point-section-header">
                <h4>Point Values</h4>
                {!isEditing && (
                  <button type="button" className="add-point-text-button" onClick={addRow}>
                    <FontAwesomeIcon icon={faPlus} /> Add Row
                  </button>
                )}
              </div>

              <div className={`add-point-rows ${hasQualifier ? "has-qualifier" : ""}`}>
                <div className="add-point-row add-point-row-head">
                  <span>Section</span>
                  <span>Value</span>
                  {hasQualifier && <span>{formData.qualName || "Qualifier"}</span>}
                  <span></span>
                </div>
                {pointRows.map((row, index) => (
                  <div key={row.id} className="add-point-row">
                    <input
                      type="text"
                      value={row.section}
                      onChange={(e) => updateRow(row.id, "section", e.target.value)}
                      placeholder={index === 0 ? "Optional" : ""}
                    />
                    <input
                      type="text"
                      value={row.value}
                      onChange={(e) => updateRow(row.id, "value", e.target.value)}
                      placeholder="Nominal value"
                    />
                    {hasQualifier && (
                      <input
                        type="text"
                        value={row.qualifierValue}
                        onChange={(e) => updateRow(row.id, "qualifierValue", e.target.value)}
                        placeholder="Qualifier value"
                      />
                    )}
                    <button
                      type="button"
                      className="add-point-row-delete"
                      onClick={() => removeRow(row.id)}
                      disabled={pointRows.length === 1}
                      title="Remove row"
                    >
                      <FontAwesomeIcon icon={faTrashAlt} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="add-point-qualifier-strip">
                <label className="add-point-checkbox">
                  <input
                    type="checkbox"
                    checked={hasQualifier}
                    onChange={(e) => setHasQualifier(e.target.checked)}
                  />
                  <span>Use qualifier</span>
                </label>
                {hasQualifier && (
                  <div className="add-point-qualifier-controls">
                    <input
                      type="text"
                      name="qualName"
                      value={formData.qualName}
                      onChange={handleChange}
                      placeholder="Qualifier name"
                    />
                    <Select
                      value={qualUnitValue}
                      onChange={(opt) =>
                        setFormData((prev) => ({ ...prev, qualUnit: opt ? opt.value : "" }))
                      }
                      options={groupedUnitOptions}
                      filterOption={unitFilterOption}
                      placeholder="Unit"
                      classNamePrefix="react-select"
                      menuPortalTarget={document.body}
                      menuPosition="fixed"
                      styles={customSelectStyles}
                    />
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        <div className="add-point-footer">
          <button
            className="btn-large-icon add-point-save"
            onClick={handleSave}
            title={isEditing ? "Save measurement point" : "Add measurement points"}
          >
            <FontAwesomeIcon icon={faCheck} />
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
};

export default AddTestPointModal;
