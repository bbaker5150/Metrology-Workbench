import React, { useState, useEffect, useLayoutEffect, useMemo } from "react";
import ReactDOM from "react-dom";
import Select from "react-select";
import ToleranceForm from "../../../components/common/ToleranceForm";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { 
    faCheck, 
    faBookOpen, 
    faPlus, 
    faTrashAlt, 
    faEdit,
    faLayerGroup,
    faCube,
    faTimes,
    faCalculator
} from "@fortawesome/free-solid-svg-icons";
import InstrumentLookupModal from "./InstrumentLookupModal";
import NotificationModal from "../../../components/modals/NotificationModal";
import { useFloatingWindow } from "../../../hooks/useFloatingWindow";
import {
  getUnitDisplayLabel,
  unitCategories,
  unitSystem,
  unitFilterOption,
} from "../../../utils/uncertaintyMath";
import { v4 as uuidv4 } from "uuid";

// Reuse the builder styles for consistency
import "./InstrumentBuilderModal.css";

// Styles for React Select (matching InstrumentBuilder)
const portalStyle = {
  menuPortal: (base) => ({ ...base, zIndex: 99999 }),
  menu: (base) => ({ ...base, zIndex: 99999, backgroundColor: 'var(--input-background)', color: 'var(--text-color)' }),
  control: (base) => ({
    ...base,
    backgroundColor: 'var(--input-background)',
    borderColor: 'var(--border-color)',
    color: 'var(--text-color)',
  }),
  singleValue: (base) => ({ ...base, color: 'var(--text-color)' }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused ? 'var(--primary-color)' : 'transparent',
    color: state.isFocused ? '#fff' : 'var(--text-color)',
  })
};

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
      .map((u) => {
        usedUnits.add(u);
        return { value: u, label: getUnitDisplayLabel(u) };
      });
    options.push({ label: refCategory, options: prioritizedOptions });
  }

  Object.entries(unitCategories).forEach(([label, units]) => {
    if (options.some((opt) => opt.label === label)) return;
    const groupOptions = units
      .filter((u) => allUnits.includes(u) && !usedUnits.has(u))
      .map((u) => {
        usedUnits.add(u);
        return { value: u, label: getUnitDisplayLabel(u) };
      });
    if (groupOptions.length > 0) options.push({ label, options: groupOptions });
  });

  const leftovers = allUnits
    .filter((u) => !usedUnits.has(u) && !["%", "ppm", "dB", "ppb"].includes(u))
    .map((u) => ({ value: u, label: getUnitDisplayLabel(u) }));
  if (leftovers.length > 0) options.push({ label: "Other", options: leftovers });

  return options;
};

const EditUutModal = ({
    isOpen,
    onClose,
    onSave,
    initialUut = null, 
    instruments = [],
    hasParentOverlay = false
}) => {
    // --- State ---
    const [description, setDescription] = useState("");
    const [measurementArea, setMeasurementArea] = useState("");
    
    // Instrument Definition State
    const [instrumentDef, setInstrumentDef] = useState({
        manufacturer: "",
        model: "",
        functions: [] 
    });

    const [activeFunctionId, setActiveFunctionId] = useState(null);
    const [editingRange, setEditingRange] = useState(null); // For slide-over

    const [isLookupOpen, setIsLookupOpen] = useState(false);
    const [notification, setNotification] = useState(null);

    // Floating Window Logic
    const { position, handleMouseDown } = useFloatingWindow({
        isOpen,
        defaultWidth: 1000, 
        defaultHeight: 800
    });

    // --- Initialization ---
    useLayoutEffect(() => {
        if (isOpen) {
            setDescription(initialUut?.description || "");
            // Use existing measurementArea or default to empty
            setMeasurementArea(initialUut?.measurementArea || initialUut?.measurementAreaId || ""); // Handle both legacy prop names
            
            if (initialUut?.instrument) {
                setInstrumentDef(JSON.parse(JSON.stringify(initialUut.instrument)));
                if (initialUut.instrument.functions?.length > 0) {
                    setActiveFunctionId(initialUut.instrument.functions[0].id);
                }
            } else {
                setInstrumentDef({ manufacturer: "", model: "", functions: [] });
                setActiveFunctionId(null);
            }
            setEditingRange(null);
            setNotification(null);
        }
    }, [isOpen, initialUut]);

    // --- Helpers ---
    const activeFunction = useMemo(() => 
        instrumentDef.functions.find(f => f.id === activeFunctionId), 
    [instrumentDef.functions, activeFunctionId]);

    const allUnitsRaw = useMemo(() => Object.keys(unitSystem.units), []);
    const categorizedUnitOptions = useMemo(() => {
        return getCategorizedUnitOptions(allUnitsRaw, activeFunction?.unit);
    }, [allUnitsRaw, activeFunction?.unit]);

    const formatToleranceSummary = (tolerances) => {
        if (!tolerances) return "N/A";
        const parts = [];
        const fmt = (c) => c.symmetric ? `±${c.high}` : `+${c.high}/-${c.low}`;
    
        if (tolerances.reading?.high) parts.push(`${fmt(tolerances.reading)}% Rdg`);
        if (tolerances.range?.high) parts.push(`${fmt(tolerances.range)}% ${tolerances.range.value ? 'FS' : 'Rng'}`);
        if (tolerances.floor?.high) parts.push(`${fmt(tolerances.floor)} ${getUnitDisplayLabel(tolerances.floor.unit || '')}`);
        if (tolerances.db?.high) parts.push(`dB: ${fmt(tolerances.db)}`);
    
        return parts.length > 0 ? <span className="tolerance-badge">{parts.join(" + ")}</span> : <span className="tolerance-badge">Custom Spec</span>;
    };

    // --- Handlers ---

    // 1. Import from Library
    const handleInstrumentImport = (importedInstrument) => {
        const newDef = {
            manufacturer: importedInstrument.manufacturer,
            model: importedInstrument.model,
            functions: JSON.parse(JSON.stringify(importedInstrument.functions || [])) 
        };
        setInstrumentDef(newDef);
        
        // Auto-fill description if empty
        if (!description) {
            setDescription(`${importedInstrument.manufacturer} ${importedInstrument.model} ${importedInstrument.description || ""}`);
        }

        if (newDef.functions.length > 0) {
            setActiveFunctionId(newDef.functions[0].id);
        }

        setIsLookupOpen(false);
        setNotification({
            title: "Import Successful",
            message: `Imported ${importedInstrument.functions?.length || 0} functions from ${importedInstrument.model}.`
        });
    };

    // 2. Functions
    const handleAddFunction = () => {
        const newFunc = { id: uuidv4(), name: "New Function", unit: "V", ranges: [] };
        setInstrumentDef(prev => ({ ...prev, functions: [...prev.functions, newFunc] }));
        setActiveFunctionId(newFunc.id);
    };

    const handleDeleteFunction = (id) => {
        setInstrumentDef(prev => ({ ...prev, functions: prev.functions.filter(f => f.id !== id) }));
        if (activeFunctionId === id) setActiveFunctionId(null);
    };

    const updateActiveFunction = (key, value) => {
        setInstrumentDef(prev => ({
            ...prev,
            functions: prev.functions.map(f => f.id === activeFunctionId ? { ...f, [key]: value } : f)
        }));
    };

    // 3. Ranges
    const handleAddRange = () => {
        if (!activeFunction) return;
        const newRange = { id: uuidv4(), min: 0, max: 0, resolution: 0.0001, tolerances: {} };
        const updatedRanges = [...activeFunction.ranges, newRange].sort((a, b) => parseFloat(a.min) - parseFloat(b.min));
        setInstrumentDef(prev => ({
            ...prev,
            functions: prev.functions.map(f => f.id === activeFunctionId ? { ...f, ranges: updatedRanges } : f)
        }));
    };

    const handleDeleteRange = (rangeId) => {
        setInstrumentDef(prev => ({
            ...prev,
            functions: prev.functions.map(f => {
                if (f.id !== activeFunctionId) return f;
                return { ...f, ranges: f.ranges.filter(r => r.id !== rangeId) };
            })
        }));
    };

    const updateRangeBounds = (rangeId, field, value) => {
        setInstrumentDef(prev => ({
            ...prev,
            functions: prev.functions.map(f => {
                if (f.id !== activeFunctionId) return f;
                return { ...f, ranges: f.ranges.map(r => r.id === rangeId ? { ...r, [field]: value } : r) };
            })
        }));
    };

    // 4. Tolerances (Slide Over)
    const handleToleranceUpdate = (updater) => {
        setEditingRange(prev => {
            if (!prev) return null;
            const newVal = typeof updater === 'function' ? updater(prev.tolerances) : updater;
            return { ...prev, tolerances: newVal };
        });
    };

    const saveRangeSpecs = () => {
        if (!editingRange) return;
        setInstrumentDef(prev => ({
            ...prev,
            functions: prev.functions.map(f => {
                if (f.id !== activeFunctionId) return f;
                return { 
                    ...f, 
                    ranges: f.ranges.map(r => r.id === editingRange.id ? { ...r, tolerances: editingRange.tolerances } : r) 
                };
            })
        }));
        setEditingRange(null);
    };


    const handleSave = () => {
        if (!description.trim()) {
            setNotification({ title: "Validation Error", message: "Please enter a UUT Description." });
            return;
        }
        if (!measurementArea.trim()) {
             setNotification({ title: "Validation Error", message: "Please enter a Measurement Area." });
             return;
        }

        onSave({
            description,
            measurementArea, // Saved as string
            instrument: instrumentDef
        });
        onClose();
    };

    if (!isOpen) return null;

    const modalZIndex = hasParentOverlay ? 2100 : 2000;

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
            />

            <div
                className="modal-content floating-window-content instrument-builder-wrapper"
                style={{
                    position: 'fixed',
                    top: position.y,
                    left: position.x,
                    margin: 0,
                    width: '1000px',
                    maxWidth: '95vw',
                    height: '85vh',
                    display: 'flex',
                    flexDirection: 'column',
                    zIndex: modalZIndex,
                    overflow: 'hidden'
                }}
            >
                {/* --- Header --- */}
                <div
                    className="modal-header"
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 15px',
                        borderBottom: '1px solid var(--border-color)',
                        cursor: 'move',
                        userSelect: 'none',
                        backgroundColor: 'var(--header-background)'
                    }}
                    onMouseDown={handleMouseDown}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <h3 style={{ margin: 0, fontSize: '1.2rem' }}>
                            Edit UUT Configuration
                        </h3>
                    </div>
                    <button onClick={onClose} className="modal-close-button" style={{ position: 'static' }}>&times;</button>
                </div>

                {/* --- Body (Copied Layout from Builder) --- */}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                    
                    {/* SUB-MODAL: Range Tolerance Editor (Slide-over) */}
                    {editingRange && (
                        <div className="tolerance-slide-over">
                        <div className="slide-over-header">
                            <div className="slide-over-title">
                            <h3><FontAwesomeIcon icon={faCalculator} /> Edit Tolerances</h3>
                            <div className="slide-over-subtitle">
                                Range: {editingRange.min} - {editingRange.max} {activeFunction?.unit}
                            </div>
                            </div>
                            <button onClick={() => setEditingRange(null)} className="modal-icon-button secondary" title="Close"><FontAwesomeIcon icon={faTimes} size="lg" /></button>
                        </div>
                        
                        <div className="slide-over-body">
                            <ToleranceForm
                                tolerance={editingRange.tolerances || {}}
                                setTolerance={handleToleranceUpdate}
                                isUUT={true}
                                referencePoint={{ unit: activeFunction?.unit }}
                                resolutionInTable={true}
                                showManualComponents={true}
                            />
                        </div>
                        
                        <div className="slide-over-footer">
                            <button className="button primary" onClick={saveRangeSpecs}>
                            <FontAwesomeIcon icon={faCheck} style={{ marginRight: '8px' }} />
                            Save Specs
                            </button>
                        </div>
                        </div>
                    )}

                    {/* TOP: Identity Card */}
                    <div className="instrument-identity-card" style={{ flexShrink: 0 }}>
                        <div className="instrument-field-group" style={{ flex: 2 }}>
                            <label>UUT Description / Model</label>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <input
                                    type="text"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="e.g., Fluke 8588A"
                                    style={{ width: '100%' }}
                                />
                                <button
                                    className="btn-icon-only"
                                    onClick={() => setIsLookupOpen(true)}
                                    title="Import from Library"
                                    style={{ width: '38px', height: '38px', flexShrink: 0 }}
                                >
                                    <FontAwesomeIcon icon={faBookOpen} />
                                </button>
                            </div>
                        </div>
                        <div className="instrument-field-group" style={{ flex: 1 }}>
                             <label><FontAwesomeIcon icon={faLayerGroup} style={{ color: 'var(--primary-color)', marginRight: '5px' }} /> Measurement Area</label>
                             <input
                                type="text"
                                value={measurementArea}
                                onChange={(e) => setMeasurementArea(e.target.value)}
                                placeholder="e.g., DC Voltage"
                             />
                        </div>
                    </div>

                    {/* MIDDLE: Workspace */}
                    <div className="instrument-editor-body">
                         {/* SIDEBAR */}
                        <div className="function-nav-rail">
                            <div className="rail-header">
                                <h5><FontAwesomeIcon icon={faCube} /> Functions</h5>
                                <button className="icon-action-btn" onClick={handleAddFunction} title="Add Function"><FontAwesomeIcon icon={faPlus} /></button>
                            </div>
                            <div className="rail-list">
                                {instrumentDef.functions.map(f => (
                                <div 
                                    key={f.id} 
                                    className={`rail-item ${activeFunctionId === f.id ? 'active' : ''}`}
                                    onClick={() => setActiveFunctionId(f.id)}
                                >
                                    <span>{f.name}</span>
                                    <button 
                                    className="delete-btn"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteFunction(f.id); }}
                                    title="Delete Function"
                                    >
                                    <FontAwesomeIcon icon={faTrashAlt} size="sm" />
                                    </button>
                                </div>
                                ))}
                                {instrumentDef.functions.length === 0 && (
                                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-color-muted)', fontSize: '0.8rem' }}>
                                    No functions defined.<br/>Add one to start.
                                </div>
                                )}
                            </div>
                        </div>

                        {/* WORKSPACE */}
                        <div className="function-workspace">
                            {activeFunction ? (
                                <>
                                <div className="workspace-header">
                                    <div className="instrument-field-group main-input">
                                    <label>Function Name</label>
                                    <input type="text" value={activeFunction.name} onChange={e => updateActiveFunction('name', e.target.value)} />
                                    </div>
                                    <div className="instrument-field-group unit-select">
                                    <label>Base Unit</label>
                                    <Select
                                        value={
                                        categorizedUnitOptions
                                            .flatMap(g => g.options ? g.options : g)
                                            .find(opt => opt.value === activeFunction.unit) || null
                                        }
                                        onChange={opt => updateActiveFunction('unit', opt.value)}
                                        options={categorizedUnitOptions}
                                        filterOption={unitFilterOption}
                                        menuPortalTarget={document.body}
                                        styles={portalStyle}
                                        classNamePrefix="react-select"
                                    />
                                    </div>
                                </div>

                                <div className="ranges-panel">
                                    <div className="panel-toolbar">
                                    <h5><FontAwesomeIcon icon={faLayerGroup} /> Ranges</h5>
                                    <button className="button small" onClick={handleAddRange}>
                                        <FontAwesomeIcon icon={faPlus} /> Add Range
                                    </button>
                                    </div>
                                    <div className="ranges-table-container">
                                    <table className="ranges-table">
                                        <thead>
                                        <tr>
                                            <th style={{width: '20%'}}>Min</th>
                                            <th style={{width: '20%'}}>Max</th>
                                            <th style={{width: '20%'}}>Resolution</th>
                                            <th style={{width: '30%'}}>Tolerance Spec</th>
                                            <th style={{width: '10%'}}>Actions</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {activeFunction.ranges.map(range => (
                                            <tr key={range.id}>
                                            <td>
                                                <input type="number" step="any" value={range.min} onChange={e => updateRangeBounds(range.id, 'min', e.target.value)} />
                                            </td>
                                            <td>
                                                <input type="number" step="any" value={range.max} onChange={e => updateRangeBounds(range.id, 'max', e.target.value)} />
                                            </td>
                                            <td>
                                                <input type="number" step="any" value={range.resolution} onChange={e => updateRangeBounds(range.id, 'resolution', e.target.value)} />
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setEditingRange({ ...range })}>
                                                {formatToleranceSummary(range.tolerances)}
                                                <FontAwesomeIcon icon={faEdit} style={{ color: 'var(--text-color-muted)', fontSize: '0.8rem' }} />
                                                </div>
                                            </td>
                                            <td>
                                                <button className="btn-icon-only danger" onClick={() => handleDeleteRange(range.id)} title="Delete Range">
                                                <FontAwesomeIcon icon={faTrashAlt} />
                                                </button>
                                            </td>
                                            </tr>
                                        ))}
                                        {activeFunction.ranges.length === 0 && (
                                            <tr>
                                            <td colSpan="5" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-color-muted)' }}>
                                                No ranges defined.
                                            </td>
                                            </tr>
                                        )}
                                        </tbody>
                                    </table>
                                    </div>
                                </div>
                                </>
                            ) : (
                                <div className="empty-state">
                                <FontAwesomeIcon icon={faCube} className="empty-state-icon" />
                                <p>Select a function to edit specs.</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="editor-actions" style={{ padding: '15px 20px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--background-color)' }}>
                         <button className="button primary" onClick={handleSave}>
                            <FontAwesomeIcon icon={faCheck} style={{ marginRight: '8px' }} />
                            Save Configuration
                        </button>
                    </div>

                </div>
            </div>
        </>,
        document.body
    );
};

export default EditUutModal;
