/**
 * src/features/instruments/components/UniversalInstrumentModal.jsx
 */
import React, { useState, useMemo, useEffect, useCallback } from "react";
import ReactDOM from "react-dom";
import Select from "react-select";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faTimes,
  faPlus,
  faTrashAlt,
  faEdit,
  faLayerGroup,
  faArrowLeft,
  faSearch,
  faChevronDown,
  faChevronUp,
  faCalculator,
  faCube,
  faBookOpen,
  faMicroscope,
  faTools,
  faTag,
  faIndustry,
  faFingerprint
} from "@fortawesome/free-solid-svg-icons";
import { v4 as uuidv4 } from "uuid";
import {
  getUnitDisplayLabel,
  unitCategories,
  unitSystem,
  unitFilterOption,
} from "../../../utils/uncertaintyMath";
import ToleranceForm from "../../../components/common/ToleranceForm";
import NotificationModal from "../../../components/modals/NotificationModal";
import { useFloatingWindow } from "../../../hooks/useFloatingWindow";

import "./UniversalInstrumentModal.css";

// --- React Select Styles ---
const portalStyle = {
  menuPortal: (base) => ({ ...base, zIndex: 99999 }),
  menu: (base) => ({ ...base, zIndex: 99999, backgroundColor: 'var(--input-background)', color: 'var(--text-color)' }),
  control: (base) => ({
    ...base,
    backgroundColor: 'var(--input-background)',
    borderColor: 'var(--border-color)',
    color: 'var(--text-color)',
    minHeight: '40px', 
    height: '40px',   
    borderRadius: '4px',
    fontSize: '0.95rem',
    boxShadow: 'none',
    '&:hover': {
        borderColor: 'var(--border-color)'
    }
  }),
  valueContainer: (base) => ({ ...base, padding: '0 8px', height: '38px', display: 'flex', alignItems: 'center' }),
  indicatorsContainer: (base) => ({ ...base, height: '38px' }),
  singleValue: (base) => ({ ...base, color: 'var(--text-color)' }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused ? 'var(--primary-color)' : 'transparent',
    color: state.isFocused ? '#fff' : 'var(--text-color)',
    fontSize: '0.9rem'
  })
};

// --- Helpers ---
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

const formatToleranceSummary = (tolerances) => {
    if (!tolerances) return <span className="tolerance-badge">N/A</span>;
    const parts = [];
    const fmt = (c) => c.symmetric ? `±${c.high}` : `+${c.high}/-${c.low}`;
    if (tolerances.reading?.high) parts.push(`${fmt(tolerances.reading)}% Rdg`);
    if (tolerances.range?.high) parts.push(`${fmt(tolerances.range)}% ${tolerances.range.value ? 'FS' : 'Rng'}`);
    if (tolerances.floor?.high) parts.push(`${fmt(tolerances.floor)} ${getUnitDisplayLabel(tolerances.floor.unit || '')}`);
    return parts.length > 0 ? <span className="tolerance-badge">{parts.join(" + ")}</span> : <span className="tolerance-badge">Custom Spec</span>;
};

const DEFAULT_MEASUREMENT_AREA_NAME = "Unassigned";
const DEFAULT_MEASUREMENT_AREA_COLOR = "#3498db";

const getComparableLibraryInstrument = (instrument) => ({
    manufacturer: instrument?.manufacturer || "",
    model: instrument?.model || "",
    functions: instrument?.functions || []
});

const hasValidatedSnapshot = (instrument = {}) =>
    instrument.validatedSnapshot != null &&
    typeof instrument.validatedSnapshot === "object" &&
    Object.keys(instrument.validatedSnapshot).length > 0;

const getInstrumentSourceStatus = (instrument = {}, linkedInstrument = null) => {
    const explicitScope = instrument?.scope;
    const linkedScope = linkedInstrument?.scope;
    const isShared = explicitScope === "validated" || (!explicitScope && linkedScope === "validated");

    if (isShared) {
        return {
            label: "Shared",
            tone: "shared",
            title: "Shared library instrument"
        };
    }

    const isLinkedLocal =
        Boolean(instrument?.sourceId) ||
        hasValidatedSnapshot(instrument) ||
        Boolean(linkedInstrument?.sourceId) ||
        hasValidatedSnapshot(linkedInstrument || {});

    return {
        label: "Local",
        tone: "local",
        title: isLinkedLocal
            ? "Local instrument linked to a shared origin"
            : "Local instrument"
    };
};

const InstrumentSourceBadge = ({ instrument, linkedInstrument = null }) => {
    const status = getInstrumentSourceStatus(instrument, linkedInstrument);
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

const UniversalInstrumentModal = ({
    isOpen,
    onClose,
    onSave,
    onSaveToLibrary,
    onDelete,
    onBatchAdd,
    mode = 'library', // 'uut', 'tmde', 'library'
    initialData = null,
    instruments = [],
    measurementAreas = []
}) => {
    const [viewMode, setViewMode] = useState("edit");
    const [effectiveMode, setEffectiveMode] = useState(mode);

    const [searchTerm, setSearchTerm] = useState("");
    const [expandedDetail, setExpandedDetail] = useState(null);

    // Library list multi-select: ids of checked rows + the anchor for shift-range.
    const [selectedIds, setSelectedIds] = useState([]);
    const [selectionAnchor, setSelectionAnchor] = useState(null);
    // Delete confirmation. Routed through one choke-point so a password gate can
    // be added here later without touching the call sites.
    const [pendingDelete, setPendingDelete] = useState(null); // { ids: [...] }
    const [pendingInstrumentSave, setPendingInstrumentSave] = useState(false);
    const [libraryInstrumentId, setLibraryInstrumentId] = useState(null);
    const [initialInstrumentSignature, setInitialInstrumentSignature] = useState("");

    const [metaData, setMetaData] = useState({
        name: "", 
        measurementArea: DEFAULT_MEASUREMENT_AREA_NAME,
        measurementAreaId: "",
        measurementAreaColor: DEFAULT_MEASUREMENT_AREA_COLOR, 
        quantity: 1, 
        assetId: "" 
    });

    const [instrumentDef, setInstrumentDef] = useState({
        id: uuidv4(),
        manufacturer: "",
        model: "",
        description: "", 
        functions: []
    });

    const [activeFunctionId, setActiveFunctionId] = useState(null);
    const [editingRange, setEditingRange] = useState(null);

    const { position, handleMouseDown } = useFloatingWindow({
        isOpen,
        defaultWidth: 1100,
        defaultHeight: 850
    });

    useEffect(() => {
        if (isOpen) {
            setSearchTerm("");
            setExpandedDetail(null);
            setEditingRange(null);
            setSelectedIds([]);
            setSelectionAnchor(null);
            setPendingDelete(null);
            setPendingInstrumentSave(false);

            if (mode === 'library') {
                setViewMode("list");
            } else {
                setViewMode("edit");
            }
            setEffectiveMode(mode);

            if (initialData) {
                setViewMode("edit");
                const loadedInst = initialData.instrument || (initialData.functions ? initialData : null) || {
                    id: uuidv4(), manufacturer: "", model: "", description: "", functions: []
                };
                const existingLibraryId =
                    initialData.libraryInstrumentId ||
                    loadedInst.libraryInstrumentId ||
                    (instruments.some((instrument) => instrument.id === loadedInst.id)
                        ? loadedInst.id
                        : null);
                setLibraryInstrumentId(existingLibraryId);
                setInitialInstrumentSignature(
                    JSON.stringify(getComparableLibraryInstrument(loadedInst))
                );
                setInstrumentDef(JSON.parse(JSON.stringify(loadedInst)));
                if (loadedInst.functions?.length > 0) setActiveFunctionId(loadedInst.functions[0].id);
                else setActiveFunctionId(null);

                setMetaData({
                    name: initialData.description || initialData.name || "",
                    measurementArea: initialData.measurementArea || DEFAULT_MEASUREMENT_AREA_NAME,
                    measurementAreaId: initialData.measurementAreaId || "",
                    measurementAreaColor: initialData.measurementAreaColor || DEFAULT_MEASUREMENT_AREA_COLOR,
                    quantity: initialData.quantity || 1, 
                    assetId: initialData.assetId || ""
                });
            } else {
                setLibraryInstrumentId(null);
                setInitialInstrumentSignature(
                    JSON.stringify(getComparableLibraryInstrument({
                        manufacturer: "",
                        model: "",
                        functions: []
                    }))
                );
                setMetaData({
                    name: "",
                    measurementArea: DEFAULT_MEASUREMENT_AREA_NAME,
                    measurementAreaId: "",
                    measurementAreaColor: DEFAULT_MEASUREMENT_AREA_COLOR,
                    quantity: 1,
                    assetId: ""
                });
                setInstrumentDef({ id: uuidv4(), manufacturer: "", model: "", description: "", functions: [] });
                setActiveFunctionId(null);
            }
        }
    }, [isOpen, initialData, mode]);

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
        instrumentDef.functions.find(f => f.id === activeFunctionId), 
    [instrumentDef.functions, activeFunctionId]);

    const allUnitsRaw = useMemo(() => Object.keys(unitSystem.units), []);
    const categorizedUnitOptions = useMemo(() => {
        return getCategorizedUnitOptions(allUnitsRaw, activeFunction?.unit);
    }, [allUnitsRaw, activeFunction?.unit]);

    const modalTitle = useMemo(() => {
        if (effectiveMode === 'uut') return initialData ? "Edit UUT" : "Add New UUT";
        if (effectiveMode === 'tmde') return initialData ? "Edit TMDE" : "Add New TMDE";
        return "Instrument Manager";
    }, [effectiveMode, initialData]);

    const modeIcon = effectiveMode === 'uut' ? faMicroscope : (effectiveMode === 'tmde' ? faTools : faBookOpen);

    const isFormValid = useMemo(() => {
        if (!instrumentDef.manufacturer?.trim()) return false;
        if (!instrumentDef.model?.trim()) return false;
        if (!metaData.name?.trim()) return false;
        return true;
    }, [instrumentDef.manufacturer, instrumentDef.model, metaData.name]);

    const isInstrumentInLibrary = useMemo(
        () => instruments.some(
            (instrument) =>
                instrument.id === libraryInstrumentId ||
                instrument.id === instrumentDef.id
        ),
        [instruments, libraryInstrumentId, instrumentDef.id]
    );

    const linkedLibraryInstrument = useMemo(
        () => instruments.find(
            (instrument) =>
                instrument.id === libraryInstrumentId ||
                instrument.id === instrumentDef.id
        ) || null,
        [instruments, libraryInstrumentId, instrumentDef.id]
    );

    const hasLibraryChanges = useMemo(() => {
        if (!linkedLibraryInstrument) return false;
        return JSON.stringify(getComparableLibraryInstrument(instrumentDef)) !==
            initialInstrumentSignature;
    }, [initialInstrumentSignature, instrumentDef, linkedLibraryInstrument]);

    // --- Library list multi-select (ctrl = toggle, shift = range) ---
    const handleRowSelect = (e, instId) => {
        const visibleIds = filteredInstruments.map((i) => i.id);
        const targetIdx = visibleIds.indexOf(instId);

        if (e.shiftKey && selectionAnchor) {
            const anchorIdx = visibleIds.indexOf(selectionAnchor);
            if (anchorIdx !== -1 && targetIdx !== -1) {
                const [lo, hi] =
                    anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
                const run = visibleIds.slice(lo, hi + 1);
                setSelectedIds(
                    e.ctrlKey || e.metaKey
                        ? Array.from(new Set([...selectedIds, ...run]))
                        : run,
                );
                return;
            }
        }
        if (e.ctrlKey || e.metaKey) {
            setSelectedIds((prev) =>
                prev.includes(instId)
                    ? prev.filter((x) => x !== instId)
                    : [...prev, instId],
            );
            setSelectionAnchor(instId);
            return;
        }
        // Plain click toggles a single selection (click again to clear).
        setSelectedIds((prev) =>
            prev.length === 1 && prev[0] === instId ? [] : [instId],
        );
        setSelectionAnchor(instId);
    };

    // Single delete choke-point — a password gate can wrap confirmDelete later.
    const requestDelete = (ids) => {
        const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
        if (list.length) setPendingDelete({ ids: list });
    };

    const confirmDelete = async () => {
        const ids = pendingDelete?.ids || [];
        // NOTE: insert password verification here when that feature lands.
        for (const id of ids) {
            // eslint-disable-next-line no-await-in-loop
            await onDelete?.(id);
        }
        setSelectedIds((prev) => prev.filter((x) => !ids.includes(x)));
        setPendingDelete(null);
    };

    const handleBulkUseAs = (useAs) => {
        const chosen = instruments.filter((i) => selectedIds.includes(i.id));
        if (!chosen.length) return;
        onBatchAdd?.(chosen, useAs);
        onClose();
    };

    const handleEditLibraryItem = (inst) => {
        const newDef = JSON.parse(JSON.stringify(inst));
        
        // --- FIX: Fully populate MetaData from Library Item ---
        setMetaData({
            name: inst.description || "", // Populate description for library edit
            measurementArea: inst.measurementArea || DEFAULT_MEASUREMENT_AREA_NAME, // Restore saved area
            measurementAreaColor: inst.measurementAreaColor || DEFAULT_MEASUREMENT_AREA_COLOR, // Restore saved color
            quantity: 1, 
            assetId: ""
        });

        if (effectiveMode !== 'library') {
            newDef.libraryInstrumentId = inst.id;
            setLibraryInstrumentId(inst.id);
            const autoName = `${inst.manufacturer || ''} ${inst.model || ''}`.trim();
            if (autoName) {
                // If creating UUT/TMDE, default name to Manufacturer + Model
                setMetaData(prev => ({ ...prev, name: autoName }));
            }
        }
        
        setInitialInstrumentSignature(
            JSON.stringify(getComparableLibraryInstrument(newDef))
        );
        setInstrumentDef(newDef);
        if (newDef.functions?.length > 0) setActiveFunctionId(newDef.functions[0].id);
        setViewMode("edit");
    };

    const handleCreateNew = () => {
        const newInstrument = {
            id: uuidv4(),
            manufacturer: "",
            model: "",
            description: "",
            functions: []
        };
        setInstrumentDef(newInstrument);
        setLibraryInstrumentId(null);
        setInitialInstrumentSignature(
            JSON.stringify(getComparableLibraryInstrument(newInstrument))
        );
        setMetaData(prev => ({
            ...prev,
            name: "",
            measurementArea: DEFAULT_MEASUREMENT_AREA_NAME,
            measurementAreaId: "",
            measurementAreaColor: DEFAULT_MEASUREMENT_AREA_COLOR
        }));
        setActiveFunctionId(null);
        setViewMode("edit");
    };

    const handleMetaChange = (field, value) => {
        setMetaData(prev => {
            const patch = { [field]: value };
            if (field === "measurementArea") {
                const cleanName = String(value || "").trim();
                const existingArea = (measurementAreas || []).find(
                    (area) => String(area.name || "").toLowerCase() === cleanName.toLowerCase()
                );
                patch.measurementAreaId = existingArea?.id || "";
                patch.measurementAreaColor =
                    existingArea?.color || prev.measurementAreaColor || DEFAULT_MEASUREMENT_AREA_COLOR;
            }
            return {
                ...prev,
                ...patch
            };
        });
    };

    const handleAddFunction = () => {
        const newFunc = { id: uuidv4(), name: "New Function", unit: "V", ranges: [] };
        setInstrumentDef(prev => ({ ...prev, functions: [...prev.functions, newFunc] }));
        setActiveFunctionId(newFunc.id);
    };

    const updateActiveFunction = (key, value) => {
        setInstrumentDef(prev => ({
            ...prev,
            functions: prev.functions.map(f => f.id === activeFunctionId ? { ...f, [key]: value } : f)
        }));
    };

    const handleDeleteFunction = (id) => {
        setInstrumentDef(prev => ({ ...prev, functions: prev.functions.filter(f => f.id !== id) }));
        if (activeFunctionId === id) setActiveFunctionId(null);
    };

    const handleAddRange = () => {
        if (!activeFunction) return;
        const newRange = {
            id: uuidv4(),
            min: 0,
            max: 0,
            resolution: 0,
            tolerances: {},
        };
        const updatedRanges = [...activeFunction.ranges, newRange];
        setInstrumentDef(prev => ({
            ...prev,
            functions: prev.functions.map(f => f.id === activeFunctionId ? { ...f, ranges: updatedRanges } : f)
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

    // Normalize a range field once the user leaves it. Raw onChange keeps typing
    // fluid (e.g. "0.5"), but on blur we collapse dangerous inputs like "000" or
    // "015" to a canonical numeric value. Non-numeric/blank entries reset to "".
    const normalizeRangeBounds = (rangeId, field, value) => {
        const trimmed = String(value).trim();
        const numeric = parseFloat(trimmed);
        const normalized =
            trimmed === "" || Number.isNaN(numeric) ? "" : String(numeric);
        if (normalized !== value) updateRangeBounds(rangeId, field, normalized);
    };

    const updateRangeResolutionBudget = (rangeId, checked) => {
        setInstrumentDef(prev => ({
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
            })
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

    const handleToleranceUpdate = useCallback((updater) => {
        setEditingRange(prev => {
            if (!prev) return null;
            const newVal = typeof updater === 'function' ? updater(prev.tolerances) : updater;
            return { ...prev, tolerances: newVal };
        });
    }, []);

    const saveRangeSpecs = () => {
        if (!editingRange) return;
        setInstrumentDef(prev => ({
            ...prev,
            functions: prev.functions.map(f => {
                if (f.id !== activeFunctionId) return f;
                return { ...f, ranges: f.ranges.map(r => r.id === editingRange.id ? { ...r, tolerances: editingRange.tolerances } : r) };
            })
        }));
        setEditingRange(null);
    };

    const buildSaveData = (savedLibraryId = libraryInstrumentId) => {
        let finalData = {};
        if (effectiveMode === 'uut' || effectiveMode === 'tmde') {
            const sessionInstrument = {
                ...instrumentDef,
                ...(savedLibraryId ? { libraryInstrumentId: savedLibraryId } : {})
            };
            finalData = {
                id: initialData?.id || uuidv4(),
                description: metaData.name, 
                name: metaData.name,
                measurementArea: metaData.measurementArea,
                measurementAreaId: metaData.measurementAreaId,
                measurementAreaColor: metaData.measurementAreaColor,
                instrument: sessionInstrument,
                ...(savedLibraryId ? { libraryInstrumentId: savedLibraryId } : {}),
                type: effectiveMode
            };
        } else {
            // Library Mode: Sync description with the input field (metaData.name)
            finalData = { 
                ...instrumentDef, 
                description: metaData.name, // Ensure description is updated from UI
                measurementArea: metaData.measurementArea, 
                measurementAreaColor: metaData.measurementAreaColor,
                type: 'library' 
            };
        }

        return finalData;
    };

    const completeSave = (saveToLibrary = false) => {
        const savedLibraryId = saveToLibrary
            ? linkedLibraryInstrument?.id || instrumentDef.id
            : libraryInstrumentId || linkedLibraryInstrument?.id || null;
        const finalData = buildSaveData(savedLibraryId);
        console.log("[UniversalInstrumentModal] Saving Data:", finalData);
        onSave(finalData);

        if (saveToLibrary && onSaveToLibrary) {
            onSaveToLibrary({
                ...instrumentDef,
                id: savedLibraryId,
                description: linkedLibraryInstrument?.description || metaData.name,
                measurementArea:
                    linkedLibraryInstrument?.measurementArea || metaData.measurementArea,
                measurementAreaColor:
                    linkedLibraryInstrument?.measurementAreaColor ||
                    metaData.measurementAreaColor,
                type: 'library'
            });
        }

        setLibraryInstrumentId(savedLibraryId);
        setPendingInstrumentSave(false);
        onClose();
    };

    const handleSave = () => {
        if (!isFormValid) return;

        if (
            (effectiveMode === 'uut' || effectiveMode === 'tmde') &&
            onSaveToLibrary &&
            (!isInstrumentInLibrary || hasLibraryChanges)
        ) {
            setPendingInstrumentSave(true);
            return;
        }

        completeSave(false);
    };

    const toggleFunctionDetails = (e, instId, funcId) => {
        e.stopPropagation();
        if (expandedDetail && expandedDetail.instId === instId && expandedDetail.funcId === funcId) {
            setExpandedDetail(null);
        } else {
            setExpandedDetail({ instId, funcId });
        }
    };

    if (!isOpen) return null;

    return ReactDOM.createPortal(
        <div
            className="modal-content floating-window-content instrument-builder-wrapper"
            style={{
                position: 'fixed',
                top: position.y,
                left: position.x,
                margin: 0,
                width: '1100px',
                maxWidth: '95vw',
                height: '85vh',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 2100,
                overflow: 'hidden'
            }}
        >
            {/* --- Header --- */}
            <div
                className="modal-header"
                onMouseDown={handleMouseDown}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {viewMode === 'list' && (
                        <button className="icon-btn-ghost" onClick={() => setViewMode("edit")} title="Back to Editor">
                            <FontAwesomeIcon icon={faArrowLeft} />
                        </button>
                    )}
                    <h3 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <FontAwesomeIcon icon={modeIcon} style={{ color: 'var(--primary-color)' }} />
                        {viewMode === 'list' ? "Select Instrument from Library" : modalTitle}
                    </h3>
                </div>
                <button onClick={onClose} className="modal-close-button">&times;</button>
            </div>

            {/* --- Body --- */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                
                {/* --- VIEW: LIST --- */}
                {viewMode === "list" && (
                    <div className="list-view-container">
                         <div className="search-toolbar">
                            <div className="search-input-wrapper">
                                <FontAwesomeIcon icon={faSearch} className="search-icon" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    autoFocus
                                />
                            </div>
                            <button className="icon-btn-ghost" onClick={handleCreateNew} title="Create Manual Instrument">
                                <FontAwesomeIcon icon={faPlus} />
                            </button>
                        </div>

                        <div className="list-content">
                            <table className="library-table library-table--selectable">
                                <thead>
                                    <tr>
                                        <th style={{ width: '20%' }}>Manufacturer</th>
                                        <th style={{ width: '18%' }}>Model</th>
                                        <th style={{ width: '30%' }}>Description</th>
                                        <th style={{ width: '12%' }}>Source</th>
                                        <th style={{ width: '20%' }}>Functions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredInstruments.map(inst => {
                                        const isExpanded = expandedDetail?.instId === inst.id;
                                        const isRowSelected = selectedIds.includes(inst.id);
                                        return (
                                            <React.Fragment key={inst.id}>
                                                <tr
                                                    onClick={(e) => handleRowSelect(e, inst.id)}
                                                    onDoubleClick={() => handleEditLibraryItem(inst)}
                                                    className={`hover-row ${isRowSelected ? 'row-selected' : ''}`}
                                                    title="Click to select (Ctrl/Shift for multi); double-click to open"
                                                >
                                                    <td style={{ fontWeight: '600' }}>{inst.manufacturer}</td>
                                                    <td style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>{inst.model}</td>
                                                    <td style={{ color: 'var(--text-color-muted)' }}>{inst.description}</td>
                                                    <td><InstrumentSourceBadge instrument={inst} /></td>
                                                    <td onClick={e => e.stopPropagation()}>
                                                        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                                                            {inst.functions.map(f => (
                                                                <button
                                                                    key={f.id}
                                                                    onClick={(e) => toggleFunctionDetails(e, inst.id, f.id)}
                                                                    className={`status-pill ${isExpanded && expandedDetail.funcId === f.id ? "active" : ""}`}
                                                                >
                                                                    {f.name} <FontAwesomeIcon icon={isExpanded && expandedDetail.funcId === f.id ? faChevronUp : faChevronDown} size="xs" />
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </td>
                                                </tr>
                                                {isExpanded && (
                                                    <tr className="detail-row">
                                                        <td colSpan="5">
                                                            <div style={{padding: '10px', background: 'var(--background-color-secondary)'}}>
                                                                {(() => {
                                                                    const func = inst.functions.find(f => f.id === expandedDetail.funcId);
                                                                    if (!func) return null;
                                                                    return (
                                                                        <table className="ranges-table">
                                                                            <thead><tr><th>Min</th><th>Max</th><th>Resolution</th><th>Spec</th></tr></thead>
                                                                            <tbody>
                                                                                {func.ranges.map((r, i) => (
                                                                                    <tr key={i}>
                                                                                        <td>{r.min}</td>
                                                                                        <td>{r.max}</td>
                                                                                        <td>{r.resolution ?? 0}</td>
                                                                                        <td>{formatToleranceSummary(r.tolerances)}</td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    )
                                                                })()}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Selection action bar — appears once rows are checked. */}
                        {selectedIds.length > 0 && (
                            <div className="library-selection-bar">
                                <div className="library-selection-info">
                                    <span className="library-selection-count">
                                        {selectedIds.length}
                                    </span>
                                    <span className="library-selection-label">
                                        instrument{selectedIds.length > 1 ? 's' : ''} selected
                                    </span>
                                    <button
                                        className="library-selection-clear"
                                        onClick={() => { setSelectedIds([]); setSelectionAnchor(null); }}
                                    >
                                        Clear
                                    </button>
                                </div>
                                <div className="library-selection-actions">
                                    {onDelete && (
                                        <button
                                            className="lib-icon-btn lib-icon-btn--danger"
                                            title={`Delete ${selectedIds.length} from library`}
                                            onClick={() => requestDelete(selectedIds)}
                                        >
                                            <FontAwesomeIcon icon={faTrashAlt} />
                                        </button>
                                    )}
                                    {/* Library manager: choose how to bring the selection into the session. */}
                                    {mode === 'library' ? (
                                        <>
                                            <button
                                                className="lib-pill-btn"
                                                onClick={() => handleBulkUseAs('uut')}
                                            >
                                                <FontAwesomeIcon icon={faMicroscope} /> Use as UUT
                                            </button>
                                            <button
                                                className="lib-pill-btn"
                                                onClick={() => handleBulkUseAs('tmde')}
                                            >
                                                <FontAwesomeIcon icon={faTools} /> Use as TMDE
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            className="lib-pill-btn"
                                            onClick={() => handleBulkUseAs(effectiveMode)}
                                        >
                                            <FontAwesomeIcon icon={faPlus} /> Add {selectedIds.length}{' '}
                                            {effectiveMode === 'uut' ? 'UUT' : 'TMDE'}
                                            {selectedIds.length > 1 ? 's' : ''}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* --- VIEW: EDIT (BUILDER) --- */}
                {viewMode === "edit" && (
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                        
                        {/* Slide Over for Tolerances */}
                        {editingRange && (
                            <div className="tolerance-slide-over">
                                <div className="slide-over-header">
                                    <div className="slide-over-title">
                                        <h3><FontAwesomeIcon icon={faCalculator} /> Edit Tolerances</h3>
                                        <div className="slide-over-subtitle">Range: {editingRange.min} - {editingRange.max} {getUnitDisplayLabel(activeFunction?.unit)}</div>
                                    </div>
                                    <button onClick={() => setEditingRange(null)} className="icon-btn-ghost"><FontAwesomeIcon icon={faTimes} /></button>
                                </div>
                                <div className="slide-over-body">
                                    <ToleranceForm
                                        tolerance={editingRange.tolerances || {}}
                                        setTolerance={handleToleranceUpdate}
                                        isUUT={effectiveMode === 'uut'}
                                        referencePoint={{ unit: activeFunction?.unit }}
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

                        {/* Top: Identity Card */}
                        <div className="identity-container">
                            <div className="identity-header">
                                <div className="identity-title">
                                    <span>Identification</span>
                                    <InstrumentSourceBadge
                                        instrument={instrumentDef}
                                        linkedInstrument={linkedLibraryInstrument}
                                    />
                                </div>
                                <button className="icon-btn-ghost" onClick={() => setViewMode('list')} title="Import from Library">
                                    <FontAwesomeIcon icon={faBookOpen} />
                                </button>
                            </div>
                            
                            <div className="identity-grid">
                                <div className="floating-input-group">
                                    <input 
                                        type="text" 
                                        value={instrumentDef.manufacturer} 
                                        onChange={e => setInstrumentDef({ ...instrumentDef, manufacturer: e.target.value })} 
                                        placeholder=" " 
                                    />
                                    <label>Manufacturer</label>
                                    <FontAwesomeIcon icon={faIndustry} className="input-icon" />
                                </div>

                                <div className="floating-input-group">
                                    <input 
                                        type="text" 
                                        value={instrumentDef.model} 
                                        onChange={e => setInstrumentDef({ ...instrumentDef, model: e.target.value })} 
                                        placeholder=" " 
                                    />
                                    <label>Model</label>
                                    <FontAwesomeIcon icon={faTag} className="input-icon" />
                                </div>

                                <div className="floating-input-group full-width">
                                    <input 
                                        type="text" 
                                        value={metaData.name} 
                                        onChange={e => handleMetaChange('name', e.target.value)} 
                                        placeholder=" " 
                                    />
                                    <label>Description / Name</label>
                                    <FontAwesomeIcon icon={faFingerprint} className="input-icon" />
                                </div>

                                {/* Measurement Area - Always Visible now */}
                                <div className="measurement-area-wrapper" style={{gridColumn: '1 / -1'}}>
                                    <div className="floating-input-group" style={{flex: 1}}>
                                        <input 
                                            type="text" 
                                            value={metaData.measurementArea} 
                                            onChange={e => handleMetaChange('measurementArea', e.target.value)} 
                                            placeholder=" " 
                                            aria-label="Measurement Area"
                                        />
                                        <label>Measurement Area</label>
                                        <FontAwesomeIcon icon={faLayerGroup} className="input-icon" />
                                    </div>
                                    <input 
                                        type="color" 
                                        className="color-picker-input"
                                        value={metaData.measurementAreaColor}
                                        onChange={e => handleMetaChange('measurementAreaColor', e.target.value)}
                                        title="Area Color"
                                        aria-label="Measurement area color"
                                    />
                                    <span className="color-picker-label">Area Color</span>
                                </div>
                            </div>
                        </div>

                        {/* Editor Body */}
                        <div className="instrument-editor-body">
                            {/* Sidebar: Restored Text Labels */}
                            <div className="function-nav-rail">
                                <div className="rail-header">
                                    <h5>Functions</h5>
                                    <button className="icon-btn-ghost" onClick={handleAddFunction} title="Add Function"><FontAwesomeIcon icon={faPlus} /></button>
                                </div>
                                <div className="rail-list">
                                    {instrumentDef.functions.map(f => (
                                        <div key={f.id} className={`rail-item ${activeFunctionId === f.id ? 'active' : ''}`} onClick={() => setActiveFunctionId(f.id)}>
                                            <FontAwesomeIcon icon={faCube} className="rail-item-icon" />
                                            <span className="rail-item-text">{f.name}</span>
                                            <button className="rail-delete-btn" onClick={(e) => { e.stopPropagation(); handleDeleteFunction(f.id); }} title="Delete">
                                                <FontAwesomeIcon icon={faTrashAlt} size="sm" />
                                            </button>
                                        </div>
                                    ))}
                                    {instrumentDef.functions.length === 0 && <div className="empty-rail" style={{writingMode: 'horizontal-tb', transform: 'none', padding: '20px'}}>No Functions</div>}
                                </div>
                            </div>

                            {/* Workspace */}
                            <div className="function-workspace">
                                {activeFunction ? (
                                    <>
                                        <div className="workspace-header">
                                            <div className="workspace-input-group" style={{flex: 1}}>
                                                <label>Function Name</label>
                                                <input type="text" value={activeFunction.name} onChange={e => updateActiveFunction('name', e.target.value)} />
                                            </div>
                                            
                                            <div className="workspace-input-group" style={{width: '120px'}}>
                                                <label>Base Unit</label>
                                                <Select
                                                    value={categorizedUnitOptions.flatMap(g => g.options ? g.options : g).find(opt => opt.value === activeFunction.unit) || null}
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
                                                <h5>Ranges</h5>
                                                <button className="icon-btn-ghost" onClick={handleAddRange} title="Add Range"><FontAwesomeIcon icon={faPlus} /></button>
                                            </div>
                                            <div className="ranges-table-container">
                                                <table className="ranges-table">
                                                    <thead>
                                                        <tr>
                                                            <th style={{width:'25%'}}>
                                                                Min{activeFunction.unit ? ` (${getUnitDisplayLabel(activeFunction.unit)})` : ''}
                                                            </th>
                                                            <th style={{width:'25%'}}>
                                                                Max{activeFunction.unit ? ` (${getUnitDisplayLabel(activeFunction.unit)})` : ''}
                                                            </th>
                                                            <th style={{width:'18%'}}>
                                                                Resolution{activeFunction.unit ? ` (${getUnitDisplayLabel(activeFunction.unit)})` : ''}
                                                            </th>
                                                            <th style={{width:'22%'}}>Tolerance</th>
                                                            <th style={{width:'10%'}}></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {activeFunction.ranges.map(range => (
                                                            <tr key={range.id}>
                                                                <td><input type="number" step="any" value={range.min} onChange={e => updateRangeBounds(range.id, 'min', e.target.value)} onBlur={e => normalizeRangeBounds(range.id, 'min', e.target.value)} /></td>
                                                                <td><input type="number" step="any" value={range.max} onChange={e => updateRangeBounds(range.id, 'max', e.target.value)} onBlur={e => normalizeRangeBounds(range.id, 'max', e.target.value)} /></td>
                                                                <td>
                                                                    <div className="range-resolution-control">
                                                                        <input type="number" step="any" value={range.resolution ?? 0} onChange={e => updateRangeBounds(range.id, 'resolution', e.target.value)} onBlur={e => normalizeRangeBounds(range.id, 'resolution', e.target.value)} />
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
                                                                    <div className="tolerance-cell" onClick={() => setEditingRange({ ...range })}>
                                                                        {formatToleranceSummary(range.tolerances)}
                                                                        <FontAwesomeIcon icon={faEdit} />
                                                                    </div>
                                                                </td>
                                                                <td><button className="icon-btn-ghost" onClick={() => handleDeleteRange(range.id)} title="Delete Range"><FontAwesomeIcon icon={faTrashAlt} /></button></td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-color-muted)' }}>
                                        <FontAwesomeIcon icon={faCube} size="3x" style={{ marginBottom: '15px', opacity: 0.3 }} />
                                        <p>Select or create a function</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="editor-actions">
                            <button 
                                className="icon-btn-ghost editor-save-button"
                                onClick={handleSave} 
                                disabled={!isFormValid}
                                title={!isFormValid ? "Fill Manufacturer, Model, and Description" : "Save Configuration"}
                                aria-label="Save configuration"
                            >
                                <FontAwesomeIcon icon={faCheck} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Delete confirmation — same warning modal as "Delete Measurement
                Point". Single choke-point: a password gate can wrap confirmDelete
                later without touching the call sites. */}
            <NotificationModal
                isOpen={!!pendingDelete}
                onClose={() => setPendingDelete(null)}
                title={
                    pendingDelete && pendingDelete.ids.length > 1
                        ? "Batch Delete"
                        : "Delete Instrument"
                }
                message={
                    pendingDelete && pendingDelete.ids.length > 1
                        ? `Are you sure you want to delete these ${pendingDelete.ids.length} instruments from the library? This affects all sessions.`
                        : "Are you sure you want to delete this instrument from the library? This affects all sessions."
                }
                confirmText="Delete"
                isIconConfirm={true}
                onConfirm={confirmDelete}
            />
            <NotificationModal
                isOpen={pendingInstrumentSave}
                onClose={() => setPendingInstrumentSave(false)}
                title={isInstrumentInLibrary ? "Update Library Instrument" : "Save Instrument"}
                message={
                    isInstrumentInLibrary
                        ? `This ${effectiveMode === 'uut' ? 'UUT' : 'TMDE'} has changes that differ from the library. Do you want to update the library and this session, or only this session?`
                        : `Do you want to save this ${effectiveMode === 'uut' ? 'UUT' : 'TMDE'} to the instrument library for future use?`
                }
                confirmText={
                    isInstrumentInLibrary
                        ? "Update Library & Session"
                        : "Save to Library & Session"
                }
                onConfirm={() => completeSave(true)}
                secondaryText="Session Only"
                onSecondary={() => completeSave(false)}
                secondaryIsPrimary={true}
            />
        </div>,
        document.body
    );
};

export default UniversalInstrumentModal;
