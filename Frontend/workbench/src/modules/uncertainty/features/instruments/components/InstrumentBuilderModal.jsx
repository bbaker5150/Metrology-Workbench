import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import Select from "react-select";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck, faTimes, faPlus, faTrashAlt, faEdit, faRadio,
  faLayerGroup, faArrowLeft, faSearch, faChevronDown, faChevronUp, faInfoCircle,
  faCalculator, faCube, faIndustry, faTag, faFingerprint
} from "@fortawesome/free-solid-svg-icons";
import {
  getUnitDisplayLabel,
  unitCategories,
  unitSystem,
  unitFilterOption,
} from "../../../utils/uncertaintyMath";
import ToleranceForm from "../../../components/common/ToleranceForm";
import { useFloatingWindow } from "../../../hooks/useFloatingWindow";
import "./InstrumentBuilderModal.css";

const getCategorizedUnitOptions = (allUnits, referenceUnit) => {
  const options = [];
  const usedUnits = new Set();
  
  // Prioritize current unit's category
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

  // Add remaining categories
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

  // Leftovers
  const leftovers = allUnits
    .filter((u) => !usedUnits.has(u) && !["%", "ppm", "dB", "ppb"].includes(u))
    .map((u) => ({ value: u, label: getUnitDisplayLabel(u) }));
  if (leftovers.length > 0) {
    options.push({ label: "Other", options: leftovers });
  }
  return options;
};

// Styles for React Select
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

const hasValidatedSnapshot = (instrument = {}) =>
  instrument.validatedSnapshot != null &&
  typeof instrument.validatedSnapshot === "object" &&
  Object.keys(instrument.validatedSnapshot).length > 0;

const getInstrumentSourceStatus = (instrument = {}) => {
  if (instrument?.scope === "validated") {
    return {
      label: "Shared",
      tone: "shared",
      title: "Shared library instrument"
    };
  }

  const isLinkedLocal =
    Boolean(instrument?.sourceId) ||
    hasValidatedSnapshot(instrument);

  return {
    label: "Local",
    tone: "local",
    title: isLinkedLocal
      ? "Local instrument linked to a shared origin"
      : "Local instrument"
  };
};

const InstrumentSourceBadge = ({ instrument }) => {
  const status = getInstrumentSourceStatus(instrument);
  return (
    <span
      className={`instrument-source-badge instrument-source-badge--${status.tone}`}
      title={status.title}
      aria-label={`Instrument source: ${status.label}`}
    >
      {status.label}
    </span>
  );
};

const InstrumentBuilderModal = ({ isOpen, onClose, onSave, onDelete, initialData = null, instruments = [] }) => {
  const [viewMode, setViewMode] = useState("list");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedDetail, setExpandedDetail] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState(null);

  // --- Editor State ---
  const [instrument, setInstrument] = useState({
    id: Date.now(),
    manufacturer: "",
    model: "",
    description: "",
    measurementArea: "", // Added
    measurementAreaColor: "#3498db", // Added
    functions: []
  });

  const [activeFunctionId, setActiveFunctionId] = useState(null);
  const [editingRange, setEditingRange] = useState(null);

  const { position, handleMouseDown } = useFloatingWindow({
    isOpen,
    defaultWidth: 1000,
    defaultHeight: 800
  });
  const containerRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setInstrument({
            ...initialData,
            measurementArea: initialData.measurementArea || "",
            measurementAreaColor: initialData.measurementAreaColor || "#3498db"
        });
        setViewMode("edit");
        if (initialData.functions.length > 0) setActiveFunctionId(initialData.functions[0].id);
      } else {
        setViewMode("list");
        setSearchTerm("");
        setExpandedDetail(null);
        setDeleteConfirmation(null);
      }
    }
  }, [isOpen, initialData]);

  // --- Library Filtering ---
  const filteredInstruments = useMemo(() => {
    if (!searchTerm) return instruments;
    const lower = searchTerm.toLowerCase();
    return instruments.filter(i =>
      (i.manufacturer || "").toLowerCase().includes(lower) ||
      (i.model || "").toLowerCase().includes(lower) ||
      (i.description || "").toLowerCase().includes(lower)
    );
  }, [instruments, searchTerm]);

  const activeFunction = useMemo(() =>
    instrument.functions.find(f => f.id === activeFunctionId),
    [instrument.functions, activeFunctionId]);

  const allUnitsRaw = useMemo(() => Object.keys(unitSystem.units), []);
  const categorizedUnitOptions = useMemo(() => {
    return getCategorizedUnitOptions(allUnitsRaw, activeFunction?.unit);
  }, [allUnitsRaw, activeFunction?.unit]);

  const toggleFunctionDetails = (e, instId, funcId) => {
    e.stopPropagation();
    if (expandedDetail && expandedDetail.instId === instId && expandedDetail.funcId === funcId) {
      setExpandedDetail(null);
    } else {
      setExpandedDetail({ instId, funcId });
    }
  };

  const renderToleranceString = (tolerances) => {
    if (!tolerances) return "N/A";
    const parts = [];
    const fmt = (c) => c.symmetric ? `±${c.high}` : `+${c.high}/-${c.low}`;

    if (tolerances.reading?.high) parts.push(`${fmt(tolerances.reading)}% Rdg`);
    if (tolerances.range?.high) parts.push(`${fmt(tolerances.range)}% ${tolerances.range.value ? 'FS' : 'Rng'}`);
    if (tolerances.floor?.high) parts.push(`${fmt(tolerances.floor)} ${getUnitDisplayLabel(tolerances.floor.unit || '')}`);
    if (tolerances.db?.high) parts.push(`dB: ${fmt(tolerances.db)}`);

    return parts.length > 0 ? parts.join(" + ") : "Custom Spec";
  };

  const formatToleranceSummary = (tolerances) => {
    return <span className="tolerance-badge">{renderToleranceString(tolerances)}</span>;
  };

  // --- Actions ---
  const handleCreateNew = () => {
    setInstrument({ 
        id: Date.now(), 
        manufacturer: "", 
        model: "", 
        description: "", 
        measurementArea: "", 
        measurementAreaColor: "#3498db", 
        functions: [] 
    });
    setActiveFunctionId(null);
    setViewMode("edit");
  };

  const handleEditExisting = (e, inst) => {
    e.stopPropagation();
    setInstrument(JSON.parse(JSON.stringify(inst)));
    if (inst.functions.length > 0) setActiveFunctionId(inst.functions[0].id);
    setViewMode("edit");
  };

  const handleDeleteInstrument = (e, id) => {
    e.stopPropagation();
    setDeleteConfirmation({
      id,
      title: "Delete Instrument",
      message: "Are you sure you want to delete this instrument? This cannot be undone."
    });
  };

  const performDelete = () => {
    if (deleteConfirmation && onDelete) {
      onDelete(deleteConfirmation.id);
    }
    setDeleteConfirmation(null);
  };

  const handleSaveAndExit = () => {
    onSave(instrument);
    setViewMode("list");
  }

  // --- Internal Editor Handlers ---
  const handleAddFunction = () => {
    const newFunc = { id: Date.now(), name: "New Function", unit: "V", ranges: [] };
    setInstrument(prev => ({ ...prev, functions: [...prev.functions, newFunc] }));
    setActiveFunctionId(newFunc.id);
  };

  const updateActiveFunction = (key, value) => {
    setInstrument(prev => ({ ...prev, functions: prev.functions.map(f => f.id === activeFunctionId ? { ...f, [key]: value } : f) }));
  };

  const handleDeleteFunction = (id) => {
    setInstrument(prev => ({ ...prev, functions: prev.functions.filter(f => f.id !== id) }));
    if (activeFunctionId === id) setActiveFunctionId(null);
  };

  const handleAddRange = () => {
    if (!activeFunction) return;
    // Resolution is editable in the ranges table (Resolution column) and flows
    // into a UUT's uncertainty budget when "include in budget" is ticked.
    const newRange = { id: Date.now(), min: 0, max: 0, resolution: 0, tolerances: {} };
    const updatedRanges = [...activeFunction.ranges, newRange].sort((a, b) => parseFloat(a.min) - parseFloat(b.min));
    setInstrument(prev => ({ ...prev, functions: prev.functions.map(f => f.id === activeFunctionId ? { ...f, ranges: updatedRanges } : f) }));
  };

  const handleToleranceUpdate = useCallback((updater) => {
    setEditingRange(prev => {
      if (!prev) return null;
      const newVal = typeof updater === 'function' ? updater(prev.tolerances) : updater;
      return { ...prev, tolerances: newVal };
    });
  }, []);

  const saveRangeSpecs = () => {
    if (!editingRange) return;
    setInstrument(prev => ({
      ...prev,
      functions: prev.functions.map(f => {
        if (f.id !== activeFunctionId) return f;
        return { ...f, ranges: f.ranges.map(r => r.id === editingRange.id ? { ...r, tolerances: editingRange.tolerances } : r) };
      })
    }));
    setEditingRange(null);
  };

  const updateRangeBounds = (rangeId, field, value) => {
    setInstrument(prev => ({
      ...prev,
      functions: prev.functions.map(f => {
        if (f.id !== activeFunctionId) return f;
        return { ...f, ranges: f.ranges.map(r => r.id === rangeId ? { ...r, [field]: value } : r) };
      })
    }));
  };

  const updateRangeResolutionBudget = (rangeId, checked) => {
    setInstrument(prev => ({
      ...prev,
      functions: prev.functions.map(f => {
        if (f.id !== activeFunctionId) return f;
        return {
          ...f,
          ranges: f.ranges.map(r =>
            r.id === rangeId
              ? {
                  ...r,
                  tolerances: {
                    ...(r.tolerances || {}),
                    includeResolutionInBudget: checked,
                  },
                }
              : r
          ),
        };
      }),
    }));
  };

  const handleDeleteRange = (rangeId) => {
    setInstrument(prev => ({
      ...prev,
      functions: prev.functions.map(f => {
        if (f.id !== activeFunctionId) return f;
        return { ...f, ranges: f.ranges.filter(r => r.id !== rangeId) };
      })
    }));
  };

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <>
      {deleteConfirmation && (
        <div className="modal-overlay" style={{ zIndex: 3000, backgroundColor: 'var(--modal-overlay-color)' }}>
          <div className="modal-content" style={{ maxWidth: "400px" }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3 style={{ margin: 0 }}>{deleteConfirmation.title}</h3>
              <button onClick={() => setDeleteConfirmation(null)} className="modal-close-button" style={{ position: 'static' }}>&times;</button>
            </div>
            <p>{deleteConfirmation.message}</p>
            <div className="modal-actions" style={{ justifyContent: "flex-end", gap: "10px" }}>
              <button className="button" style={{ backgroundColor: "var(--status-bad)" }} onClick={performDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className="modal-content floating-window-content instrument-builder-wrapper"
        style={{
          position: 'fixed',
          top: position.y,
          left: position.x,
          margin: 0,
          width: '1000px',
          maxWidth: '90vw',
          height: '85vh',
          zIndex: 2000,
        }}
      >
        <div
          className="modal-header"
          style={{
            cursor: 'move',
            userSelect: 'none',
            padding: '10px 15px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--header-background)'
          }}
          onMouseDown={handleMouseDown}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {viewMode === 'edit' && <button className="icon-action-btn" onClick={() => setViewMode("list")} title="Back to Library"><FontAwesomeIcon icon={faArrowLeft} /></button>}
            <h3 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <FontAwesomeIcon icon={faRadio} /> 
              {viewMode === 'list' ? 'Instrument Library' : 'Edit Instrument'}
            </h3>
          </div>
          <button onClick={onClose} className="modal-close-button" style={{ position: 'static' }}>&times;</button>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>

          {/* SUB-MODAL: Range Tolerance Editor */}
          {editingRange && (
            <div className="tolerance-slide-over">
              <div className="slide-over-header">
                <div className="slide-over-title">
                  <h3><FontAwesomeIcon icon={faCalculator} /> Edit Tolerances</h3>
                  <div className="slide-over-subtitle">
                     Range: {editingRange.min} - {editingRange.max} {getUnitDisplayLabel(activeFunction.unit)}
                  </div>
                </div>
                <button onClick={() => setEditingRange(null)} className="modal-icon-button secondary" title="Close"><FontAwesomeIcon icon={faTimes} size="lg" /></button>
              </div>
              
              <div className="slide-over-body">
                {/* An instrument defined here can later be used as a UUT or a
                  TMDE, so it carries a resolution field. It is only added to the
                  uncertainty budget if the user ticks the opt-in checkbox (#10). */}
                <ToleranceForm
                    tolerance={editingRange.tolerances || {}}
                    setTolerance={handleToleranceUpdate}
                    referencePoint={{ unit: activeFunction.unit }}
                    showResolution={true}
                    resolutionInTable={true}
                    showManualComponents={true}
                />
              </div>
              
              <div className="slide-over-footer">
                <button className="btn-large-icon" onClick={saveRangeSpecs} title="Save Specs">
                  <FontAwesomeIcon icon={faCheck} />
                </button>
              </div>
            </div>
          )}

          {viewMode === "list" && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '20px' }}>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <FontAwesomeIcon icon={faSearch} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-color-muted)' }} />
                  <input
                    type="text"
                    placeholder="Search library..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ width: '100%', padding: '10px 10px 10px 35px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--input-background)', color: 'var(--text-color)' }}
                  />
                </div>
                <button className="button" onClick={handleCreateNew} title="Create New Instrument" style={{ padding: '0 15px' }}>
                  <FontAwesomeIcon icon={faPlus} style={{ marginRight: '5px' }} /> New
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--component-header-bg)', zIndex: 1 }}>
                    <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border-color)' }}>
                      <th style={{ padding: '12px', width: '18%', color: 'var(--text-color)' }}>Manufacturer</th>
                      <th style={{ padding: '12px', width: '15%', color: 'var(--text-color)' }}>Model</th>
                      <th style={{ padding: '12px', width: '27%', color: 'var(--text-color)' }}>Description</th>
                      <th style={{ padding: '12px', width: '12%', color: 'var(--text-color)' }}>Source</th>
                      <th style={{ padding: '12px', width: '18%', color: 'var(--text-color)' }}>Functions</th>
                      <th style={{ padding: '12px', width: '10%', textAlign: 'center', color: 'var(--text-color)' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInstruments.map(inst => {
                      const isExpanded = expandedDetail?.instId === inst.id;
                      return (
                        <React.Fragment key={inst.id}>
                          <tr
                            style={{
                              borderBottom: isExpanded ? 'none' : '1px solid var(--border-color)',
                              cursor: 'pointer',
                              backgroundColor: isExpanded ? 'var(--primary-color-light)' : 'transparent',
                              transition: 'background 0.2s',
                              color: 'var(--text-color)'
                            }}
                            onClick={() => setExpandedDetail(prev => prev?.instId === inst.id ? null : { instId: inst.id, funcId: inst.functions[0]?.id })}
                          >
                            <td style={{ padding: '12px', fontWeight: '600' }}>{inst.manufacturer}</td>
                            <td style={{ padding: '12px', color: 'var(--primary-color)', fontWeight: 'bold' }}>{inst.model}</td>
                            <td style={{ padding: '12px', color: 'var(--text-color-muted)' }}>{inst.description}</td>
                            <td style={{ padding: '12px' }}><InstrumentSourceBadge instrument={inst} /></td>
                            <td style={{ padding: '12px' }}>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                                {inst.functions.map(f => {
                                  const isFuncActive = isExpanded && expandedDetail.funcId === f.id;
                                  return (
                                    <button
                                      key={f.id}
                                      onClick={(e) => toggleFunctionDetails(e, inst.id, f.id)}
                                      style={{
                                        marginRight: '0',
                                        fontSize: '0.75rem',
                                        border: isFuncActive ? "1px solid var(--primary-color)" : "1px solid var(--border-color)",
                                        backgroundColor: isFuncActive ? "var(--background-color)" : "transparent",
                                        color: "var(--text-color)",
                                        cursor: 'pointer',
                                        padding: '2px 8px',
                                        borderRadius: '12px'
                                      }}
                                    >
                                      {f.name} {isFuncActive ? <FontAwesomeIcon icon={faChevronUp} size="xs" /> : <FontAwesomeIcon icon={faChevronDown} size="xs" />}
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                            <td style={{ padding: '12px', textAlign: 'center' }}>
                              <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                                <button className="btn-icon-only" onClick={(e) => handleEditExisting(e, inst)} title="Edit Instrument"><FontAwesomeIcon icon={faEdit} /></button>
                                <button className="btn-icon-only danger" onClick={(e) => handleDeleteInstrument(e, inst.id)} title="Delete Instrument"><FontAwesomeIcon icon={faTrashAlt} /></button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr style={{ backgroundColor: "var(--primary-color-light)", borderBottom: "1px solid var(--border-color)" }}>
                              <td colSpan="6" style={{ padding: "0" }}>
                                <div style={{ padding: "15px 20px", borderLeft: "4px solid var(--primary-color)" }}>
                                  {(() => {
                                    const func = inst.functions.find(f => f.id === expandedDetail.funcId);
                                    if (!func) return <div style={{ fontStyle: 'italic', color: 'var(--text-color-muted)' }}>Select a function to view details.</div>;
                                    return (
                                      <div>
                                        <h5 style={{ margin: "0 0 10px 0", color: "var(--text-color)", display: "flex", alignItems: "center", gap: "8px" }}>
                                          <FontAwesomeIcon icon={faInfoCircle} color="var(--primary-color)" />
                                          Specifications: {func.name} (Base Unit: {getUnitDisplayLabel(func.unit)})
                                        </h5>
                                        <table style={{ width: "100%", fontSize: "0.85rem", backgroundColor: "var(--content-background)", color: "var(--text-color)", borderRadius: "4px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", border: "1px solid var(--border-color)" }}>
                                          <thead>
                                            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--component-header-bg)" }}>
                                              <th style={{ padding: "8px", color: "var(--text-color)", fontWeight: "600" }}>Range Min</th>
                                              <th style={{ padding: "8px", color: "var(--text-color)", fontWeight: "600" }}>Range Max</th>
                                              <th style={{ padding: "8px", color: "var(--text-color)", fontWeight: "600" }}>Tolerance</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {func.ranges.map((range, idx) => (
                                              <tr key={range.id || idx} style={{ borderBottom: "1px solid var(--border-color)" }}>
                                                <td style={{ padding: "8px" }}>{range.min}</td>
                                                <td style={{ padding: "8px" }}>{range.max}</td>
                                                <td style={{ padding: "8px", fontFamily: "monospace", color: "var(--primary-color)" }}>{renderToleranceString(range.tolerances)}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {viewMode === "edit" && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              
              {/* TOP IDENTITY CARD */}
              <div className="instrument-identity-card">
                  <div className="identity-card-header">
                    <span>Identification</span>
                    <InstrumentSourceBadge instrument={instrument} />
                  </div>
                  <div className="identity-grid">
                        <div className="floating-input-group">
                            <input type="text" value={instrument.manufacturer} onChange={e => setInstrument({ ...instrument, manufacturer: e.target.value })} placeholder=" " />
                            <label>Manufacturer</label>
                            <FontAwesomeIcon icon={faIndustry} className="input-icon" />
                        </div>
                        <div className="floating-input-group">
                           <input type="text" value={instrument.model} onChange={e => setInstrument({ ...instrument, model: e.target.value })} placeholder=" " />
                           <label>Model</label>
                           <FontAwesomeIcon icon={faTag} className="input-icon" />
                        </div>
                        <div className="floating-input-group full-width">
                           <input type="text" value={instrument.description} onChange={e => setInstrument({ ...instrument, description: e.target.value })} placeholder=" " />
                           <label>Description</label>
                           <FontAwesomeIcon icon={faFingerprint} className="input-icon" />
                        </div>
                        {/* New Measurement Area Inputs */}
                        <div className="measurement-area-wrapper">
                            <div className="floating-input-group" style={{flex: 1}}>
                                <input 
                                    type="text" 
                                    value={instrument.measurementArea} 
                                    onChange={e => setInstrument({ ...instrument, measurementArea: e.target.value })} 
                                    placeholder=" " 
                                />
                                <label>Measurement Area</label>
                                <FontAwesomeIcon icon={faLayerGroup} className="input-icon" />
                            </div>
                            <input 
                                type="color" 
                                className="color-picker-input"
                                value={instrument.measurementAreaColor}
                                onChange={e => setInstrument({ ...instrument, measurementAreaColor: e.target.value })}
                                title="Area Color"
                            />
                        </div>
                  </div>
              </div>

              <div className="instrument-editor-body">
                
                <div className="function-nav-rail">
                  <div className="rail-header">
                    <h5><FontAwesomeIcon icon={faCube} /> Functions</h5>
                    <button className="icon-action-btn" onClick={handleAddFunction} title="Add Function"><FontAwesomeIcon icon={faPlus} /></button>
                  </div>
                  <div className="rail-list">
                    {instrument.functions.map(f => (
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
                    {instrument.functions.length === 0 && (
                      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-color-muted)', fontSize: '0.8rem' }}>
                        No functions added. Click + to start.
                      </div>
                    )}
                  </div>
                </div>

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
                          <h5><FontAwesomeIcon icon={faLayerGroup} /> Measurement Ranges</h5>
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
                                    <div className="range-resolution-control">
                                      <input type="number" step="any" value={range.resolution ?? 0} onChange={e => updateRangeBounds(range.id, 'resolution', e.target.value)} />
                                      <label
                                        className="range-resolution-budget-toggle"
                                        title="Include this range's resolution as a Type B uncertainty component"
                                        aria-label="Include this range's resolution in the uncertainty budget"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={!!(
                                            range.tolerances?.includeResolutionInBudget ??
                                            range.includeResolutionInBudget
                                          )}
                                          onChange={e => updateRangeResolutionBudget(range.id, e.target.checked)}
                                        />
                                      </label>
                                    </div>
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
                                    No ranges defined for this function.
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
                      <p>Select a function from the sidebar<br/>or create a new one to edit specifications.</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="editor-actions">
                 <button className="button primary" onClick={handleSaveAndExit}>
                   <FontAwesomeIcon icon={faCheck} style={{ marginRight: '8px' }} /> 
                   Save Instrument
                 </button>
              </div>

            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
};

export default InstrumentBuilderModal;
