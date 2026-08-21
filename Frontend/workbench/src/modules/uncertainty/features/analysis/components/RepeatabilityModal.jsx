import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import Select from "react-select";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faPlus,
  faRotateLeft,
  faTimes,
  faTrashAlt,
} from "@fortawesome/free-solid-svg-icons";
import {
  getUnitDisplayLabel,
  unitCategories,
  unitFilterOption,
  unitSystem,
} from "../../../utils/uncertaintyMath";
import { useFloatingWindow } from "../../../hooks/useFloatingWindow";

const getCategorizedUnitOptions = (allUnits, referenceUnit) => {
  const options = [];
  const usedUnits = new Set();

  if (referenceUnit && allUnits.includes(referenceUnit)) {
    let referenceCategory = "Suggested";
    for (const [category, units] of Object.entries(unitCategories)) {
      if (units.includes(referenceUnit)) {
        referenceCategory = category;
        break;
      }
    }
    const categoryUnits = unitCategories[referenceCategory] || [referenceUnit];
    options.push({
      label: referenceCategory,
      options: categoryUnits
        .filter((unit) => allUnits.includes(unit))
        .map((unit) => {
          usedUnits.add(unit);
          return { value: unit, label: getUnitDisplayLabel(unit) };
        }),
    });
  }

  Object.entries(unitCategories).forEach(([label, units]) => {
    if (options.some((option) => option.label === label)) return;
    const groupOptions = units
      .filter((unit) => allUnits.includes(unit) && !usedUnits.has(unit))
      .map((unit) => {
        usedUnits.add(unit);
        return { value: unit, label: getUnitDisplayLabel(unit) };
      });
    if (groupOptions.length > 0) options.push({ label, options: groupOptions });
  });

  const otherOptions = allUnits
    .filter(
      (unit) =>
        !usedUnits.has(unit) && !["%", "ppm", "dB", "ppb"].includes(unit),
    )
    .map((unit) => ({ value: unit, label: getUnitDisplayLabel(unit) }));
  if (otherOptions.length > 0) {
    options.push({ label: "Other", options: otherOptions });
  }
  return options;
};

const selectStyles = {
  menuPortal: (base) => ({ ...base, zIndex: 99999 }),
  menu: (base) => ({ ...base, zIndex: 99999 }),
};

export const calculateRepeatabilityStats = (values = []) => {
  if (values.length < 2) return { mean: values[0] || 0, stdDev: 0, dof: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return { mean, stdDev: Math.sqrt(variance), dof: values.length - 1 };
};

const formatStat = (value, digits = 6) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(Number(numeric.toPrecision(digits))) : "—";
};

const RepeatabilityModal = ({
  isOpen,
  onClose,
  onSave,
  uutNominal,
  existingData,
}) => {
  const [readings, setReadings] = useState([]);
  const [currentInput, setCurrentInput] = useState("");
  const [selectedUnit, setSelectedUnit] = useState(uutNominal?.unit || "V");
  const inputRef = useRef(null);
  const { position, handleMouseDown } = useFloatingWindow({
    isOpen,
    defaultWidth: 640,
    defaultHeight: 430,
  });

  useEffect(() => {
    if (!isOpen) return;
    if (existingData?.savedInputs) {
      setReadings(existingData.savedInputs.readings || []);
      setSelectedUnit(existingData.savedInputs.unit || uutNominal?.unit || "V");
    } else {
      setReadings([]);
      setCurrentInput("");
      setSelectedUnit(uutNominal?.unit || "V");
    }
  }, [isOpen, existingData, uutNominal]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const allUnits = useMemo(() => Object.keys(unitSystem.units), []);
  const unitOptions = useMemo(
    () =>
      getCategorizedUnitOptions(
        allUnits,
        uutNominal?.unit || selectedUnit,
      ),
    [allUnits, uutNominal?.unit, selectedUnit],
  );
  const selectedUnitOption =
    unitOptions
      .flatMap((group) => group.options || group)
      .find((option) => option.value === selectedUnit) || {
      value: selectedUnit,
      label: getUnitDisplayLabel(selectedUnit),
    };
  const stats = useMemo(() => calculateRepeatabilityStats(readings), [readings]);
  const range = readings.length
    ? Math.max(...readings) - Math.min(...readings)
    : null;

  const addReading = () => {
    const value = Number(currentInput);
    if (!Number.isFinite(value)) return;
    setReadings((current) => [...current, value]);
    setCurrentInput("");
    inputRef.current?.focus();
  };

  const save = () => {
    if (readings.length < 2) return;
    onSave({
      stdDev: stats.stdDev,
      mean: stats.mean,
      dof: stats.dof,
      unit: selectedUnit,
      count: readings.length,
      readings,
    });
    onClose();
  };

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div
      className="modal-content floating-window-content correlation-matrix-modal repeatability-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Repeatability"
      style={{
        width: "640px",
        maxWidth: "95vw",
        maxHeight: "90vh",
        position: "fixed",
        top: position.y,
        left: position.x,
        margin: 0,
        zIndex: 9999,
      }}
    >
      <div className="correlation-modal-toolbar" onMouseDown={handleMouseDown}>
        <span className="correlation-modal-title">Repeatability</span>
        <button
          type="button"
          className="correlation-modal-icon-button"
          title="Close"
          aria-label="Close repeatability"
          onClick={onClose}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <FontAwesomeIcon icon={faTimes} />
        </button>
      </div>

      <div className="repeatability-modal-body">
        <p className="correlation-modal-hint">
          Enter at least two repeated measurements to calculate the sample standard deviation.
        </p>

        <div className="repeatability-workspace">
          <section className="repeatability-readings-panel">
            <label className="repeatability-input-label" htmlFor="repeatability-reading">
              Measurement
            </label>
            <div className="repeatability-input-row">
              <input
                id="repeatability-reading"
                ref={inputRef}
                type="number"
                step="any"
                value={currentInput}
                onChange={(event) => setCurrentInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addReading();
                  }
                }}
                placeholder="10.001"
              />
              <Select
                value={selectedUnitOption}
                onChange={(option) => setSelectedUnit(option?.value || "")}
                options={unitOptions}
                filterOption={unitFilterOption}
                className="react-select-container repeatability-unit-select"
                classNamePrefix="react-select"
                aria-label="Repeatability unit"
                isSearchable
                menuPortalTarget={document.body}
                menuPosition="fixed"
                styles={selectStyles}
              />
              <button
                type="button"
                className="correlation-modal-icon-button is-primary"
                title="Add measurement"
                aria-label="Add measurement"
                onClick={addReading}
              >
                <FontAwesomeIcon icon={faPlus} />
              </button>
            </div>

            <div className="repeatability-reading-list" aria-label="Repeatability measurements">
              {readings.length === 0 ? (
                <span className="repeatability-empty">No measurements added</span>
              ) : (
                readings.map((value, index) => (
                  <div className="repeatability-reading" key={`${index}-${value}`}>
                    <span><small>{index + 1}</small>{value}</span>
                    <button
                      type="button"
                      className="correlation-modal-icon-button"
                      title="Remove measurement"
                      aria-label={`Remove measurement ${index + 1}`}
                      onClick={() =>
                        setReadings((current) =>
                          current.filter((_, readingIndex) => readingIndex !== index),
                        )
                      }
                    >
                      <FontAwesomeIcon icon={faTrashAlt} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="repeatability-results" aria-label="Repeatability results">
            <div className="repeatability-primary-result">
              <span>Standard deviation</span>
              <strong>{readings.length > 1 ? formatStat(stats.stdDev) : "—"}</strong>
              <small>{getUnitDisplayLabel(selectedUnit)}</small>
            </div>
            <dl className="repeatability-stat-grid">
              <div><dt>Mean</dt><dd>{readings.length ? formatStat(stats.mean) : "—"}</dd></div>
              <div><dt>DOF</dt><dd>{stats.dof || "—"}</dd></div>
              <div><dt>Count</dt><dd>{readings.length}</dd></div>
              <div><dt>Range</dt><dd>{range === null ? "—" : formatStat(range)}</dd></div>
            </dl>
          </section>
        </div>

        <div className="correlation-modal-actions">
          <button
            type="button"
            className="correlation-modal-icon-button"
            title="Clear measurements"
            aria-label="Clear measurements"
            disabled={readings.length === 0}
            onClick={() => setReadings([])}
          >
            <FontAwesomeIcon icon={faRotateLeft} />
          </button>
          <button
            type="button"
            className="correlation-modal-icon-button is-primary"
            title="Add repeatability"
            aria-label="Add repeatability"
            disabled={readings.length < 2}
            onClick={save}
          >
            <FontAwesomeIcon icon={faCheck} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default RepeatabilityModal;
