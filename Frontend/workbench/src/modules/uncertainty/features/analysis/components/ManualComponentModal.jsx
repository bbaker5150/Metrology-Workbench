import React, { useState, useEffect, useMemo } from "react";
import ReactDOM from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faPenSquare } from "@fortawesome/free-solid-svg-icons";
import ConversionInfo from "../../../components/common/ConversionInfo";
import {
  convertToPPM,
  getUnitDisplayLabel,
  unitSystem,
} from "../../../utils/uncertaintyMath";
import { oldErrorDistributions } from "../utils/budgetUtils";

// Resolution is no longer entered here. It is a per-range instrument field
// that auto-populates the budget when the UUT opts in (see ToleranceForm /
// getUutResolutionComponent). This modal handles standard Type A/B components.
const ManualComponentModal = ({
  isOpen,
  onClose,
  onSave,
  existingComponent,
  uutNominal,
  budgetScope = null,
}) => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const emptyComponent = {
    name: "",
    type: "B",
    inputMode: "tolerance",
    errorDistributionDivisor: "1.732",
    toleranceLimit: "",
    unit: "ppm",
    standardUncertainty: "",
    useFiniteDof: false,
    dof: "",
  };

  const [component, setComponent] = useState(emptyComponent);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      const width = 800;
      const height = 520;
      const x =
        typeof window !== "undefined"
          ? Math.max(0, (window.innerWidth - width) / 2)
          : 0;
      const y =
        typeof window !== "undefined"
          ? Math.max(0, (window.innerHeight - height) / 2)
          : 0;
      setPosition({ x, y });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    setError(null);
    if (existingComponent) {
      const existingDof = parseFloat(existingComponent.dof);
      const hasFiniteDof =
        existingComponent.dof !== Infinity && Number.isFinite(existingDof);
      const inputMode =
        existingComponent.originalInput?.inputMode ||
        (existingComponent.originalInput?.standardUncertainty
          ? "standard"
          : "tolerance");

      setComponent({
        id: existingComponent.id,
        name: existingComponent.name || "",
        type: existingComponent.type || "B",
        inputMode,
        standardUncertainty:
          existingComponent.originalInput?.standardUncertainty || "",
        toleranceLimit: existingComponent.originalInput?.toleranceLimit || "",
        errorDistributionDivisor:
          existingComponent.originalInput?.errorDistributionDivisor || "1.732",
        unit:
          existingComponent.originalInput?.unit ||
          existingComponent.unit_native ||
          existingComponent.unit ||
          "ppm",
        useFiniteDof: hasFiniteDof,
        dof: hasFiniteDof ? String(existingDof) : "",
      });
    } else {
      setComponent({
        ...emptyComponent,
        name: budgetScope ? `${budgetScope.label} - Manual` : "",
        unit: uutNominal?.unit || "ppm",
      });
    }
  }, [isOpen, existingComponent, uutNominal, budgetScope]);

  const handleMouseDown = (e) => {
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
  }, [isDragging, dragOffset]);

  const unitOptions = useMemo(() => {
    const nominalUnit = uutNominal?.unit;
    if (!nominalUnit) return ["%", "ppm", "ppb"];

    const relevant = unitSystem.getRelevantUnits(nominalUnit);
    return [
      "%",
      "ppm",
      "ppb",
      ...relevant.filter(
        (u) => u !== "%" && u !== "ppm" && u !== "ppb" && u !== "dB",
      ),
    ];
  }, [uutNominal]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setComponent((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = () => {
    const usesStandardUncertainty =
      component.type === "A" || component.inputMode === "standard";
    // Degrees of freedom only apply to Type A uncertainties. Type B bounds are
    // treated as fully reliable (ν = ∞) and drop out of Welch–Satterthwaite.
    const isTypeA = component.type === "A";
    const dof = isTypeA && component.useFiniteDof ? parseFloat(component.dof) : Infinity;

    if (!component.name?.trim()) {
      setError("Component Name is required.");
      return;
    }
    if (isTypeA && component.useFiniteDof && (isNaN(dof) || dof < 1)) {
      setError("Finite DoF must be a number greater than or equal to 1.");
      return;
    }

    let valueInPPM = NaN;
    let valueNative = NaN;

    if (usesStandardUncertainty) {
      const stdUnc = parseFloat(component.standardUncertainty);
      if (isNaN(stdUnc) || stdUnc <= 0) {
        setError("Provide a valid positive standard uncertainty.");
        return;
      }

      const { value: ppm, warning } = convertToPPM(
        stdUnc,
        component.unit,
        uutNominal?.value,
        uutNominal?.unit,
        null,
        true,
      );
      if (warning) {
        setError(warning);
        return;
      }
      valueInPPM = ppm;
      valueNative = stdUnc;
    } else {
      const rawValue = parseFloat(component.toleranceLimit);
      const divisor = parseFloat(component.errorDistributionDivisor);
      if (isNaN(rawValue) || rawValue <= 0 || isNaN(divisor) || divisor <= 0) {
        setError("Provide a valid positive tolerance limit and distribution.");
        return;
      }

      const { value: ppm, warning } = convertToPPM(
        rawValue,
        component.unit,
        uutNominal?.value,
        uutNominal?.unit,
        null,
        true,
      );
      if (warning) {
        setError(warning);
        return;
      }
      valueInPPM = ppm / divisor;
      valueNative = rawValue / divisor;
    }

    let finalValueNative = valueNative;
    let finalUnitNative = component.unit;
    const isRelative = ["%", "ppm", "ppb"].includes(component.unit);

    if (isRelative && uutNominal?.value && uutNominal?.unit) {
      const nominalVal = parseFloat(uutNominal.value);
      if (!isNaN(nominalVal)) {
        finalValueNative = (valueInPPM / 1000000) * Math.abs(nominalVal);
        finalUnitNative = uutNominal.unit;
      }
    }

    const distributionLabel = usesStandardUncertainty
      ? component.type === "A"
        ? "Normal"
        : "Standard Uncertainty"
      : oldErrorDistributions.find(
          (d) => d.value === component.errorDistributionDivisor,
        )?.label;

    onSave({
      ...component,
      name: component.name.trim(),
      value: valueInPPM,
      value_native: finalValueNative,
      unit_native: finalUnitNative,
      dof,
      distribution: distributionLabel,
      originalInput: {
        inputMode: usesStandardUncertainty ? "standard" : "tolerance",
        standardUncertainty: component.standardUncertainty,
        toleranceLimit: component.toleranceLimit,
        errorDistributionDivisor: component.errorDistributionDivisor,
        unit: component.unit,
        useFiniteDof: component.useFiniteDof,
      },
    });
  };

  if (!isOpen) return null;

  const renderUnitInput = (name, value, placeholder) => (
    <div className="input-with-unit">
      <input
        type="number"
        step="any"
        name={name}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
      />
      <select name="unit" value={component.unit} onChange={handleChange}>
        {unitOptions.map((u) => (
          <option key={u} value={u}>
            {getUnitDisplayLabel(u)}
          </option>
        ))}
      </select>
    </div>
  );

  return ReactDOM.createPortal(
    <div
      className="modal-content floating-window-content"
      style={{
        maxWidth: "95vw",
        width: "800px",
        display: "flex",
        flexDirection: "column",
        position: "fixed",
        top: position.y,
        left: position.x,
        margin: 0,
        zIndex: 9999,
        height: "auto",
        maxHeight: "90vh",
      }}
    >
      <div
        onMouseDown={handleMouseDown}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "10px",
          borderBottom: "1px solid var(--border-color)",
          paddingBottom: "15px",
          cursor: "move",
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "8px",
              backgroundColor: "var(--primary-color-light)",
              color: "var(--primary-color)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.2rem",
            }}
          >
            <FontAwesomeIcon icon={faPenSquare} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.3rem" }}>
              {existingComponent ? "Edit Component" : "Manual Component"}
            </h3>
            {budgetScope && !existingComponent && (
              <div
                style={{
                  color: "var(--text-color-muted)",
                  fontSize: "0.85rem",
                  marginTop: "2px",
                }}
              >
                {budgetScope.label} uncertainty budget
              </div>
            )}
          </div>
        </div>

        <button
          onClick={onClose}
          className="modal-close-button"
          style={{ position: "static", transform: "none" }}
        >
          &times;
        </button>
      </div>

      <div style={{ overflowY: "auto", paddingRight: "5px" }}>
        {error && <div className="form-section-warning">{error}</div>}

        <div
          className="config-stack"
          style={{ paddingTop: "10px", textAlign: "left" }}
        >
          <div className="config-column">
            <label>Component Name</label>
            <input
              type="text"
              name="name"
              value={component.name}
              onChange={handleChange}
              placeholder="e.g., Thermal Expansion"
            />
          </div>

          <div className="config-column">
            <label>Type</label>
            <select name="type" value={component.type} onChange={handleChange}>
              <option value="A">Type A</option>
              <option value="B">Type B</option>
            </select>
          </div>

          {component.type === "B" && (
            <div className="config-column">
              <label>Entry Mode</label>
              <select
                name="inputMode"
                value={component.inputMode}
                onChange={handleChange}
              >
                <option value="tolerance">Tolerance limit</option>
                <option value="standard">Standard uncertainty</option>
              </select>
            </div>
          )}

          {(component.type === "A" || component.inputMode === "standard") && (
            <div className="config-column">
              <label>Standard Uncertainty (u_i)</label>
              {renderUnitInput(
                "standardUncertainty",
                component.standardUncertainty,
                "e.g., 0.00025",
              )}
              <ConversionInfo
                value={component.standardUncertainty}
                unit={component.unit}
                nominal={uutNominal}
              />
            </div>
          )}

          {component.type === "B" && component.inputMode === "tolerance" && (
            <>
              <div className="config-column">
                <label>Distribution</label>
                <select
                  name="errorDistributionDivisor"
                  value={component.errorDistributionDivisor}
                  onChange={handleChange}
                >
                  {oldErrorDistributions.map((dist) => (
                    <option key={dist.value} value={dist.value}>
                      {dist.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="config-column">
                <label>Tolerance Limit (+/-)</label>
                {renderUnitInput(
                  "toleranceLimit",
                  component.toleranceLimit,
                  "e.g., 0.001",
                )}
                <ConversionInfo
                  value={component.toleranceLimit}
                  unit={component.unit}
                  nominal={uutNominal}
                />
              </div>
            </>
          )}

          {component.type === "A" ? (
            <div className="config-column manual-dof-column">
              <label>Degrees of Freedom</label>
              <label className="manual-dof-toggle">
                <input
                  type="checkbox"
                  name="useFiniteDof"
                  checked={!!component.useFiniteDof}
                  onChange={handleChange}
                />
                <span>Use finite DoF</span>
              </label>
              {component.useFiniteDof && (
                <input
                  type="number"
                  step="1"
                  min="1"
                  name="dof"
                  value={component.dof}
                  onChange={handleChange}
                  placeholder="e.g., 9"
                />
              )}
            </div>
          ) : (
            <div className="config-column manual-dof-column">
              <label>Degrees of Freedom</label>
              <span style={{ color: "var(--text-color-muted)", fontSize: "0.85rem" }}>
                Type B treated as infinite (ν = ∞)
              </span>
            </div>
          )}
        </div>

        <div className="modal-actions" style={{ marginTop: "20px" }}>
          <button
            onClick={handleSubmit}
            title="Save Component"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--primary-color)",
              cursor: "pointer",
              fontSize: "1.5rem",
              transition: "transform 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "scale(1.2)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            <FontAwesomeIcon icon={faCheck} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ManualComponentModal;
