import React, { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrashAlt, faSave } from "@fortawesome/free-solid-svg-icons";
import { equationLibrary } from "../../../utils/equationLibrary";
import submitOnEnter from "../../../utils/submitOnEnter";

/**
 * Popover content for the measurement-equation library.
 *
 * Two sources, one list:
 *  - the curated built-in library (equationLibrary.js), grouped by metrology
 *    field;
 *  - the user's custom equations persisted to the backend (instrument-library
 *    style), grouped by their measurement area and shown first.
 *
 * Selecting an entry hands the full {expression, variables, name} back to the
 * parent, which owns insertion and the overwrite confirmation. A search box
 * filters both sources by name/expression/area, since the combined library is
 * large. Custom entries can be deleted in place; "Save current equation" is
 * offered when the parent says the editor holds a valid, saveable equation.
 */
const EquationLibraryMenu = ({
  onSelect,
  customEquations = [],
  onDeleteCustom,
  onSaveCurrent,
  canSaveCurrent = false,
  saveDisabledReason = "",
  measurementAreas = [],
  defaultMeasurementArea = "",
}) => {
  const [filter, setFilter] = useState("");
  const [isSaveFormOpen, setIsSaveFormOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveArea, setSaveArea] = useState(defaultMeasurementArea);

  const cancelSave = () => {
    setIsSaveFormOpen(false);
    setSaveName("");
    setSaveArea(defaultMeasurementArea);
  };

  const submitSave = (event) => {
    event.preventDefault();
    const name = saveName.trim();
    const measurementArea = saveArea.trim();
    if (!name || !measurementArea || !onSaveCurrent) return;
    const saved = onSaveCurrent({ name, measurementArea });
    if (saved !== false) cancelSave();
  };

  const customGroups = useMemo(() => {
    const byArea = new Map();
    customEquations.forEach((equation) => {
      const area = equation.measurementArea?.trim() || "My Equations";
      if (!byArea.has(area)) byArea.set(area, []);
      byArea.get(area).push(equation);
    });
    return [...byArea.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([area, equations]) => ({
        area,
        equations: [...equations].sort((a, b) =>
          String(a.name).localeCompare(String(b.name)),
        ),
      }));
  }, [customEquations]);

  const needle = filter.trim().toLowerCase();
  const matches = (area, equation) =>
    !needle ||
    `${area} ${equation.name} ${equation.expression} ${equation.description || ""}`
      .toLowerCase()
      .includes(needle);

  const renderEntry = (equation, { custom = false } = {}) => (
    <div key={equation.id || equation.name} className="equation-library-entry">
      <button
        type="button"
        className="equation-library-item"
        title={equation.description}
        onClick={() => onSelect(equation)}
      >
        <span className="equation-library-item-name">{equation.name}</span>
        <code className="equation-library-item-expression">
          {equation.expression}
        </code>
      </button>
      {custom && onDeleteCustom && (
        <button
          type="button"
          className="equation-library-delete-btn"
          aria-label={`Delete custom equation ${equation.name}`}
          title="Delete from your equation library"
          onClick={() => onDeleteCustom(equation)}
        >
          <FontAwesomeIcon icon={faTrashAlt} size="xs" />
        </button>
      )}
    </div>
  );

  const customSections = customGroups
    .map(({ area, equations }) => ({
      area,
      equations: equations.filter((eq) => matches(area, eq)),
    }))
    .filter(({ equations }) => equations.length > 0);

  const builtinSections = equationLibrary
    .map(({ area, equations }) => ({
      area,
      equations: equations.filter((eq) => matches(area, eq)),
    }))
    .filter(({ equations }) => equations.length > 0);

  return (
    <>
      <div className="equation-library-toolbar">
        <input
          type="search"
          className="equation-library-search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search equations…"
          aria-label="Search equation library"
        />
        {onSaveCurrent && (
          <button
            type="button"
            className="equation-library-save-btn"
            aria-label="Save current equation"
            disabled={!canSaveCurrent}
            title={
              canSaveCurrent
                ? "Save current equation"
                : saveDisabledReason ||
                  "Enter a valid equation in the editor to save it"
            }
            onClick={() => setIsSaveFormOpen((open) => !open)}
          >
            <FontAwesomeIcon icon={faSave} />
          </button>
        )}
      </div>

      {isSaveFormOpen && (
        <div className="equation-library-save-form" onKeyDown={submitOnEnter(submitSave)}>
          <div className="equation-library-save-heading">
            Save current equation
          </div>
          <label>
            <span>Equation name</span>
            <input
              type="text"
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              placeholder="e.g. Capacitive reactance"
              autoFocus
            />
          </label>
          <label>
            <span>Measurement area</span>
            <input
              type="text"
              list="equation-library-measurement-areas"
              value={saveArea}
              onChange={(event) => setSaveArea(event.target.value)}
              placeholder="e.g. Electrical"
            />
          </label>
          <datalist id="equation-library-measurement-areas">
            {measurementAreas.map((area) => (
              <option key={area.id || area.name || area} value={area.name || area} />
            ))}
          </datalist>
          <div className="equation-library-save-actions">
            <button type="button" onClick={cancelSave}>Cancel</button>
            {/* Not a form — see BugReportModal. The disabled guard is what
                enforces the two fields, so nothing is lost by giving up the
                browser's `required` validation along with the submit. */}
            <button
              type="button"
              onClick={submitSave}
              className="is-primary"
              disabled={!saveName.trim() || !saveArea.trim()}
            >
              Save equation
            </button>
          </div>
        </div>
      )}

      {customSections.map(({ area, equations }) => (
        <div key={`custom-${area}`} className="add-point-symbol-category">
          <h5>
            {area}{" "}
            <span className="equation-library-custom-label">
              (custom)
            </span>
          </h5>
          <div>{equations.map((eq) => renderEntry(eq, { custom: true }))}</div>
        </div>
      ))}

      {builtinSections.map(({ area, equations }) => (
        <div key={area} className="add-point-symbol-category">
          <h5>{area}</h5>
          <div>{equations.map((eq) => renderEntry(eq))}</div>
        </div>
      ))}

      {customSections.length === 0 && builtinSections.length === 0 && (
        <p className="equation-library-empty">
          No equations match “{filter}”.
        </p>
      )}
    </>
  );
};

export default EquationLibraryMenu;
