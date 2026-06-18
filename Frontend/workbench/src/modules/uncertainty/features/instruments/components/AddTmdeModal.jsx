import React, { useState, useEffect, useMemo, useCallback } from "react";
import ReactDOM from "react-dom";
import Select from "react-select";
import ToleranceForm from "../../../components/common/ToleranceForm";
import {
  findInstrumentTolerance,
  findMatchingTolerances,
  getToleranceSummary,
  getUnitDisplayLabel,
  unitCategories,
  unitSystem,
  unitFilterOption,
} from "../../../utils/uncertaintyMath";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faPlus, faBookOpen, faGripHorizontal } from "@fortawesome/free-solid-svg-icons";
import InstrumentLookupModal from "./InstrumentLookupModal";
import NotificationModal from "../../../components/modals/NotificationModal"; //
import UnresolvedToleranceModal from "../../testPoints/components/UnresolvedToleranceModal";

const getCategorizedUnitOptions = (allUnits, referenceUnit) => {
  const options = [];
  const usedUnits = new Set();

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
      .map((u) => { usedUnits.add(u); return { value: u, label: getUnitDisplayLabel(u) }; });
    options.push({ label: refCategory, options: prioritizedOptions });
  }

  Object.entries(unitCategories).forEach(([label, units]) => {
    if (options.some((opt) => opt.label === label)) return;
    const groupOptions = units
      .filter((u) => allUnits.includes(u) && !usedUnits.has(u))
      .map((u) => { usedUnits.add(u); return { value: u, label: getUnitDisplayLabel(u) }; });
    if (groupOptions.length > 0) options.push({ label, options: groupOptions });
  });

  const leftovers = allUnits
    .filter((u) => !usedUnits.has(u) && !["%", "ppm", "dB", "ppb"].includes(u))
    .map((u) => ({ value: u, label: getUnitDisplayLabel(u) }));
  if (leftovers.length > 0) options.push({ label: "Other", options: leftovers });

  return options;
};

const portalStyle = {
  menuPortal: (base) => ({ ...base, zIndex: 99999 }),
  menu: (base) => ({ ...base, zIndex: 99999 }),
};

const AddTmdeModal = ({
  isOpen,
  onClose,
  onSave,
  testPointData,
  initialTmdeData = null,
  hasParentOverlay = false,
  instruments = []
}) => {
  const [isLookupOpen, setIsLookupOpen] = useState(false);
  const [selectedInstrument, setSelectedInstrument] = useState(null);
  const [notification, setNotification] = useState(null); // Local notification state
  const [unresolvedToleranceModal, setUnresolvedToleranceModal] = useState(null);

  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    return {
      x: Math.max(0, (window.innerWidth - 600) / 2),
      y: Math.max(0, (window.innerHeight - 700) / 2)
    };
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y
        });
      }
    };
    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);


  const uutMeasurementPoint = useMemo(
    () => testPointData?.testPointInfo?.parameter || { value: "", unit: "" },
    [testPointData?.testPointInfo?.parameter]
  );

  const isDerived = testPointData?.measurementType === "derived";
  const variableMappings = useMemo(
    () => testPointData?.variableMappings || {},
    [testPointData?.variableMappings]
  );
  const availableTypes = useMemo(
    () => Object.values(variableMappings),
    [variableMappings]
  );

  const getInitialState = useCallback(() => {
    const defaultState = {
      id: Date.now(),
      name: "New TMDE",
      measurementPoint: isDerived ? { value: "", unit: "" } : { ...uutMeasurementPoint },
      variableType: isDerived && availableTypes.length > 0 ? availableTypes[0] : "",
      quantity: 1,
    };

    if (initialTmdeData) {
      const existingData = JSON.parse(JSON.stringify(initialTmdeData));
      if (!existingData.measurementPoint) {
        existingData.measurementPoint = isDerived ? { value: "", unit: "" } : { ...uutMeasurementPoint };
      }
      if (!existingData.hasOwnProperty("variableType")) {
        existingData.variableType = isDerived && availableTypes.length > 0 ? availableTypes[0] : "";
      }
      if (!existingData.id) {
        existingData.id = Date.now() + Math.random();
      }
      return { ...defaultState, ...existingData };
    }
    return defaultState;
  }, [uutMeasurementPoint, initialTmdeData, isDerived, availableTypes]);

  const [tmde, setTmde] = useState(getInitialState());

  const allUnits = useMemo(() => Object.keys(unitSystem.units), []);

  const physicalUnitOptions = useMemo(() => {
    return getCategorizedUnitOptions(allUnits, tmde.measurementPoint?.unit);
  }, [allUnits, tmde.measurementPoint?.unit]);

  useEffect(() => {
    if (isOpen) {
      setTmde(getInitialState());
      if (initialTmdeData && initialTmdeData.sourceInstrument) {
        setSelectedInstrument(initialTmdeData.sourceInstrument);
      } else {
        setSelectedInstrument(null);
      }
      setIsLookupOpen(false);
      setNotification(null);
    }
  }, [isOpen, getInitialState]);

  useEffect(() => {
    if (!isDerived && uutMeasurementPoint) {
      setTmde((prev) => ({
        ...prev,
        measurementPoint: { ...uutMeasurementPoint },
      }));
    }
  }, [uutMeasurementPoint, isDerived]);

  const handleInstrumentImport = (instrument) => {
    setSelectedInstrument(instrument);

    const currentVal = tmde.measurementPoint?.value;
    const currentUnit = tmde.measurementPoint?.unit;

    if (!currentVal || !currentUnit) {
      setNotification({
          title: "Missing Measurement Point",
          message: "Please ensure the Measurement Point has a value and unit before importing specifications."
      });
      return;
    }

    const numericVal = parseFloat(currentVal);
    if (isNaN(numericVal)) {
      setNotification({
          title: "Invalid Value",
          message: "Invalid measurement value. Please enter a number."
      });
      return;
    }

    // Helper to apply specs once resolved
    const applySpecs = (matchedData) => {
        const specs = JSON.parse(JSON.stringify(matchedData.tolerances || matchedData.tolerance || {}));
        let calculatedRangeMax = matchedData.rangeMax;
        if (!calculatedRangeMax) {
          calculatedRangeMax = numericVal;
        }
  
        const compKeys = ['reading', 'range', 'floor', 'readings_iv', 'db'];
        compKeys.forEach(key => {
          if (specs[key]) {
            if (!specs[key].unit) {
              if (key === 'reading' || key === 'range') specs[key].unit = '%';
              else if (key === 'floor' || key === 'readings_iv') specs[key].unit = currentUnit;
            }
            if (key === 'range') {
              specs[key].value = calculatedRangeMax;
            }
            if (specs[key].high) {
              const highVal = parseFloat(specs[key].high);
              if (!isNaN(highVal)) {
                specs[key].low = String(-Math.abs(highVal));
              }
              specs[key].symmetric = true;
            }
          }
        });
  
        // Use Custom Notification Modal
        const summary = getToleranceSummary(specs);
        setNotification({
          title: "Confirm Specifications",
          message: `Found specifications for ${instrument.model}:\n\n` +
            `Range: ${matchedData.rangeMin ?? 'N/A'} to ${matchedData.rangeMax ?? 'N/A'} ${matchedData.unit || ""}\n` +
            `Tolerance: ${summary}\n\n` +
            `Do you want to apply these tolerances?`,
          confirmText: "Apply Specs",
          cancelText: "Cancel",
          onConfirm: () => {
            setTmde(prev => ({
              ...prev,
              name: `${instrument.manufacturer} ${instrument.model}`,
              ...specs,
              measuringResolution: matchedData.resolution ?? "",
              measuringResolutionUnit: matchedData.unit || currentUnit,
            }));
            setNotification(null);
          }
        });
    };

    // Find Matches
    const matches = findMatchingTolerances(instrument, numericVal, currentUnit);

    if (matches && matches.length > 1) {
        setUnresolvedToleranceModal({
            instrumentName: instrument.model,
            matches: matches,
            onSelect: (selected) => {
                applySpecs(selected);
                setUnresolvedToleranceModal(null);
            }
        });
    } else if (matches && matches.length === 1) {
        applySpecs(matches[0]);
    } else {
        setNotification({
            title: "No Match Found",
            message: `Could not find a matching range in ${instrument.model} for ${currentVal} ${currentUnit}.`
        });
    }
  };

  const handleSave = (andClose = true) => {
    const cleanupTolerance = (tol) => {
      const cleaned = { ...tol };
      if (selectedInstrument) {
        cleaned.sourceInstrument = selectedInstrument;
      }

      const componentKeys = ["reading", "readings_iv", "range", "floor", "db"];
      componentKeys.forEach((key) => {
        const comp = cleaned[key];
        if (comp) {
          const highVal = parseFloat(comp.high);
          if (comp.high === "" || comp.high === null || isNaN(highVal)) {
            delete cleaned[key];
          }
        }
      });

      if (!isDerived && cleaned.hasOwnProperty("variableType")) {
        delete cleaned.variableType;
      }
      return cleaned;
    };

    onSave(cleanupTolerance(tmde), andClose);

    if (!andClose) {
      setTmde(getInitialState());
      setSelectedInstrument(null);
    }
  };

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <>
      <InstrumentLookupModal
        isOpen={isLookupOpen}
        onClose={() => setIsLookupOpen(false)}
        instruments={instruments}
        onSelect={handleInstrumentImport}
      />

      <NotificationModal
        isOpen={!!notification}
        onClose={() => setNotification(null)}
        title={notification?.title}
        message={notification?.message}
        onConfirm={notification?.onConfirm}
        confirmText={notification?.confirmText}
        cancelText={notification?.cancelText}
      />

      <UnresolvedToleranceModal
        isOpen={!!unresolvedToleranceModal}
        matches={unresolvedToleranceModal?.matches}
        instrumentName={unresolvedToleranceModal?.instrumentName}
        onSelect={unresolvedToleranceModal?.onSelect}
        onClose={() => setUnresolvedToleranceModal(null)}
      />

      <div
        className="modal-content floating-window-content"
        style={{
          position: 'fixed',
          top: position.y,
          left: position.x,
          margin: 0,
          width: '600px',
          maxWidth: '90vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          zIndex: hasParentOverlay ? 2005 : 2000,
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingBottom: '10px',
            marginBottom: '10px',
            borderBottom: '1px solid var(--border-color)',
            cursor: 'move',
            userSelect: 'none'
          }}
          onMouseDown={handleMouseDown}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '1.2rem' }}>
              {initialTmdeData ? (tmde.name || "Edit TMDE") : "Add New TMDE"}
            </h3>
          </div>
          <button onClick={onClose} className="modal-close-button" style={{ position: 'static' }}>&times;</button>
        </div>

        <div className="modal-body-scrollable" style={{ flex: 1, paddingRight: '5px' }}>
          <div className="tmde-header">
            <div className="details-grid">
              <div className="form-section">
                <label>TMDE Name</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    type="text"
                    value={tmde.name || ""}
                    onChange={(e) => setTmde({ ...tmde, name: e.target.value })}
                    placeholder="e.g., Standard DMM"
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn-icon-only"
                    onClick={() => setIsLookupOpen(true)}
                    title="Import from Instrument Library"
                    style={{ width: '42px', height: '42px', fontSize: '1rem', flexShrink: 0 }}
                  >
                    <FontAwesomeIcon icon={faBookOpen} />
                  </button>
                </div>
              </div>

              <div className="form-section">
                <label>Quantity</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={tmde.quantity || 1}
                  onChange={(e) =>
                    setTmde({
                      ...tmde,
                      quantity: parseInt(e.target.value, 10) || 1,
                    })
                  }
                />
              </div>
            </div>

            {isDerived && availableTypes.length > 0 && (
              <div className="form-section">
                <label>Variable Type (Input to Equation)</label>
                <select
                  value={tmde.variableType || ""}
                  onChange={(e) =>
                    setTmde({ ...tmde, variableType: e.target.value })
                  }
                >
                  <option value="">-- Select Type --</option>
                  {availableTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-section">
              <label>Measurement Point</label>

              {!isDerived ? (
                <div style={{
                  padding: '10px 12px',
                  backgroundColor: 'var(--primary-color-light)',
                  color: 'var(--primary-color-dark)',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  {uutMeasurementPoint.value} {uutMeasurementPoint.unit}
                </div>
              ) : (
                <div className="manual-input-container" style={{ marginTop: '5px', borderTop: 'none', paddingTop: 0 }}>
                  <div
                    className="input-with-unit"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 120px",
                      gap: "10px",
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Value"
                      value={tmde.measurementPoint?.value || ""}
                      onChange={(e) =>
                        setTmde({
                          ...tmde,
                          measurementPoint: {
                            ...(tmde.measurementPoint || {}),
                            value: e.target.value,
                          },
                        })
                      }
                      style={{ width: '100%' }}
                    />

                    <Select
                      value={
                        physicalUnitOptions
                          .flatMap(g => g.options ? g.options : g)
                          .find(opt => opt.value === tmde.measurementPoint?.unit) || null
                      }
                      onChange={(option) =>
                        setTmde({
                          ...tmde,
                          measurementPoint: {
                            ...(tmde.measurementPoint || {}),
                            unit: option ? option.value : "",
                          },
                        })
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
                </div>
              )}
            </div>
          </div>
          <ToleranceForm
            tolerance={tmde}
            setTolerance={setTmde}
            isUUT={false}
            referencePoint={tmde.measurementPoint}
            showResolution={true}
            showManualComponents={true}
          />
        </div>

        <div
          className="modal-actions"
          style={{ justifyContent: "flex-end", alignItems: "center" }}
        >
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {!initialTmdeData && (
              <button
                className="modal-icon-button primary"
                onClick={() => handleSave(false)}
                title="Save this TMDE and add another"
              >
                <FontAwesomeIcon icon={faPlus} />
              </button>
            )}

            <button
              className="modal-icon-button primary"
              onClick={() => handleSave(true)}
              title={initialTmdeData ? "Save Changes" : "Save and Close"}
            >
              <FontAwesomeIcon icon={faCheck} />
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
};

export default AddTmdeModal;
