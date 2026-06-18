import React, { useState, useLayoutEffect, useEffect } from "react";
import ReactDOM from "react-dom";
import { useFloatingWindow } from "../../../hooks/useFloatingWindow";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { v4 as uuidv4 } from "uuid";
import {
  faCheck,
  faPlus,
  faTimes,
  faEdit,
  faTrash,
  faMicroscope,
  faTools,
  faLayerGroup,
  faQuestionCircle
} from "@fortawesome/free-solid-svg-icons";
import NotificationModal from '../../../components/modals/NotificationModal';
import UniversalInstrumentModal from "../../instruments/components/UniversalInstrumentModal";
import { UNCERTAINTY_REQUIREMENT_FIELDS } from "../../../constants/constants";

// Import the new polished CSS
import "./EditSessionModal.css";

// Auto-assign colors for new areas
const PRESET_COLORS = [
    "#3498db", // Blue
    "#e74c3c", // Red
    "#2ecc71", // Green
    "#f1c40f", // Yellow
    "#9b59b6", // Purple
    "#e67e22", // Orange
    "#1abc9c", // Teal
    "#34495e", // Navy
];

const EditSessionModal = ({
  isOpen,
  onClose,
  sessionData,
  onSave,
  onRemoveImageFile,
  initialSection,
  sessionImageCache,
  onImageCacheChange,
  instruments = []
}) => {
  // --- State ---
  const [formData, setFormData] = useState({});
  const [activeSection, setActiveSection] = useState("details");
  const [notification, setNotification] = useState(null);
  const [newlyAddedFiles, setNewlyAddedFiles] = useState([]);
  const [imageSrcCache, setImageSrcCache] = useState(new Map());
  const [viewingImageSrc, setViewingImageSrc] = useState(null);

  // --- Instrument Modal State ---
  const [activeInstrumentModal, setActiveInstrumentModal] = useState(null); 
  // Structure: { mode: 'uut' | 'tmde', data: object | null, index: number | null }

  // Temporary state for manually adding a new measurement area
  const [newAreaName, setNewAreaName] = useState("");
  const [newAreaColor, setNewAreaColor] = useState(PRESET_COLORS[0]);

  // Floating Window Logic
  const { position, handleMouseDown } = useFloatingWindow({
    isOpen,
    defaultWidth: 1000, 
    defaultHeight: 850, 
    initialPosition: typeof window !== 'undefined' ? {
      x: Math.max(0, (window.innerWidth - 1000) / 2),
      y: Math.max(0, (window.innerHeight - (window.innerHeight * 0.85)) / 2)
    } : null
  });

  // --- Initialization ---
  useLayoutEffect(() => {
    if (isOpen && sessionData) {
      setFormData({
        ...sessionData,
        uncReq: sessionData.uncReq || {},
        measurementAreas: sessionData.measurementAreas || [],
        uuts: sessionData.uuts || [],
        tmdes: sessionData.tmdes || []
      });
      setActiveSection(initialSection || "details");
    }
  }, [isOpen, sessionData, initialSection]);

  // --- Image Handling ---
  const getImageSrc = (imageRef) => {
    const src = imageSrcCache.get(imageRef.id);
    return src || null;
  };

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    const newImageRefs = [];
    const newFileObjects = [];

    for (const file of files) {
      const newId = uuidv4();
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      newImageRefs.push({ id: newId, fileName: file.name });
      newFileObjects.push({ id: newId, fileObject: base64 });
    }

    setFormData((prev) => ({
      ...prev,
      noteImages: [...(prev.noteImages || []), ...newImageRefs],
    }));
    setNewlyAddedFiles((prev) => [...prev, ...newFileObjects]);
  };

  const handleRemoveImage = (e, imageIdToRemove) => {
    e.stopPropagation();
    setFormData((prev) => ({
      ...prev,
      noteImages: prev.noteImages.filter((img) => img.id !== imageIdToRemove),
    }));
    setNewlyAddedFiles((prev) => prev.filter((img) => img.id !== imageIdToRemove));
    if (onRemoveImageFile && sessionData && sessionData.id) {
      onRemoveImageFile(sessionData.id, imageIdToRemove);
    }
  };

  useEffect(() => {
    const newImageSrcCache = new Map();
    if (sessionImageCache && sessionData && sessionData.id) {
      const currentSessionImages = sessionImageCache.get(sessionData.id);
      if (currentSessionImages instanceof Map) {
        currentSessionImages.forEach((dataURI, imageId) => {
          newImageSrcCache.set(imageId, dataURI);
        });
      }
    }
    newlyAddedFiles.forEach((file) => {
      newImageSrcCache.set(file.id, file.fileObject);
    });
    setImageSrcCache(newImageSrcCache);
  }, [sessionImageCache, newlyAddedFiles, sessionData]);


  // --- Form Handlers ---
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleReqChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      uncReq: { ...prev.uncReq, [name]: value },
    }));
  };

  // --- Instruments Tab Logic ---

  const findAreaForInstrument = (instrument = {}, source = "session") => {
      const areas = formData.measurementAreas || [];
      const nestedInstrument = instrument.instrument || {};
      const linkedLibraryInstrument = (instruments || []).find((libraryInst) => {
          const candidateIds = [
              instrument.libraryInstrumentId,
              nestedInstrument.libraryInstrumentId,
              nestedInstrument.id,
          ].filter(Boolean);
          return candidateIds.some((id) => String(id) === String(libraryInst.id));
      });

      if (source === "instrument") {
          const areaName =
              nestedInstrument.measurementArea ||
              linkedLibraryInstrument?.measurementArea ||
              instrument.measurementArea ||
              "";
          const areaColor =
              nestedInstrument.measurementAreaColor ||
              linkedLibraryInstrument?.measurementAreaColor ||
              instrument.measurementAreaColor ||
              "var(--text-color-muted)";
          const cleanName = areaName.trim().toLowerCase();
          const matchByName = cleanName
              ? areas.find(a => (a.name || "").trim().toLowerCase() === cleanName)
              : null;

          return {
              id:
                  matchByName?.id ||
                  nestedInstrument.measurementAreaId ||
                  linkedLibraryInstrument?.measurementAreaId ||
                  `instrument:${cleanName || "unassigned"}`,
              name: areaName.trim() || matchByName?.name || "Unassigned",
              color: matchByName?.color || areaColor,
          };
      }

      const areaId = instrument.measurementAreaId;
      const areaName = instrument.measurementArea || "";

      if (areaId) {
          const matchById = areas.find(a => String(a.id) === String(areaId));
          if (matchById) return matchById;
      }

      const cleanName = areaName.trim().toLowerCase();
      if (cleanName) {
          const matchByName = areas.find(a => (a.name || "").trim().toLowerCase() === cleanName);
          if (matchByName) return matchByName;
      }

      if (cleanName || instrument.measurementAreaColor || nestedInstrument.measurementAreaColor) {
          return {
              id: areaId || `ad-hoc:${cleanName || "unassigned"}`,
              name: areaName.trim() || "Unassigned",
              color:
                  instrument.measurementAreaColor ||
                  nestedInstrument.measurementAreaColor ||
                  linkedLibraryInstrument?.measurementAreaColor ||
                  "var(--text-color-muted)",
          };
      }

      return {
          id: "unassigned",
          name: "Unassigned",
          color: "var(--text-color-muted)",
      };
  };

  const getAreaGroups = (items = [], source = "session") => {
      const areaOrder = new Map(
          (formData.measurementAreas || []).map((area, index) => [String(area.id), index])
      );
      const groups = new Map();

      items.forEach((item, index) => {
          const area = findAreaForInstrument(item, source);
          const key = area.id || area.name || "unassigned";
          if (!groups.has(key)) {
              groups.set(key, {
                  area,
                  order:
                      area.id && areaOrder.has(String(area.id))
                          ? areaOrder.get(String(area.id))
                          : Number.MAX_SAFE_INTEGER,
                  items: [],
              });
          }
          groups.get(key).items.push({ item, index });
      });

      return Array.from(groups.values())
          .map(group => ({
              ...group,
              items: group.items.sort((a, b) => {
                  const aLabel = (a.item.description || a.item.name || "").toLowerCase();
                  const bLabel = (b.item.description || b.item.name || "").toLowerCase();
                  return aLabel.localeCompare(bLabel);
              }),
          }))
          .sort((a, b) => {
              if (a.order !== b.order) return a.order - b.order;
              if (a.area.name === "Unassigned") return 1;
              if (b.area.name === "Unassigned") return -1;
              return a.area.name.localeCompare(b.area.name);
          });
  };

  const ensureMeasurementArea = (areas, resultData, { allowCreate = true } = {}) => {
      const assignedAreaName = (resultData.measurementArea || "").trim();
      const assignedAreaId = resultData.measurementAreaId || "";
      let currentAreas = [...areas];
      let finalAreaId = assignedAreaId || null;
      let finalAreaName = assignedAreaName;

      const existingAreaIndex = currentAreas.findIndex((area) => {
          if (assignedAreaId && String(area.id) === String(assignedAreaId)) return true;
          return (
              assignedAreaName &&
              area.name.toLowerCase() === assignedAreaName.toLowerCase()
          );
      });

      if (existingAreaIndex >= 0) {
          const existingArea = currentAreas[existingAreaIndex];
          finalAreaId = existingArea.id;
          finalAreaName = existingArea.name;
          if (resultData.measurementAreaColor) {
              currentAreas[existingAreaIndex] = {
                  ...existingArea,
                  color: resultData.measurementAreaColor,
              };
          }
      } else if (assignedAreaName && allowCreate) {
          finalAreaId = uuidv4();
          const newColor =
              resultData.measurementAreaColor ||
              PRESET_COLORS[currentAreas.length % PRESET_COLORS.length];
          currentAreas.push({
              id: finalAreaId,
              name: assignedAreaName,
              color: newColor,
          });
      }

      if (!allowCreate && existingAreaIndex < 0) {
          finalAreaId = null;
          finalAreaName = "";
      }

      return { currentAreas, finalAreaId, finalAreaName };
  };

  const handleAddArea = () => {
    if (!newAreaName.trim()) return;
    if (formData.measurementAreas.some(a => a.name.toLowerCase() === newAreaName.trim().toLowerCase())) {
        setNotification({ title: "Duplicate Area", message: "This measurement area already exists." });
        return;
    }

    const newArea = {
        id: uuidv4(),
        name: newAreaName.trim(),
        color: newAreaColor
    };
    setFormData(prev => ({
        ...prev,
        measurementAreas: [...prev.measurementAreas, newArea]
    }));
    setNewAreaName("");
    const nextColorIdx = (PRESET_COLORS.indexOf(newAreaColor) + 1) % PRESET_COLORS.length;
    setNewAreaColor(PRESET_COLORS[nextColorIdx]);
  };

  const handleDeleteArea = (id) => {
    setFormData(prev => ({
        ...prev,
        measurementAreas: prev.measurementAreas.filter(a => a.id !== id),
    }));
  };

  // --- Unified Instrument Handler ---

  const openInstrumentModal = (mode, data = null, index = null) => {
      let enhancedData = data;
      
      // FIX: Pre-inject the existing area color so the modal initializes correctly.
      // If we don't do this, the modal defaults to Blue, which overwrites your work on save.
      if (mode === 'uut' && data) {
          const area = findAreaForInstrument(data);
          const color = area.color;
          // Only inject if it's a valid color
          if (color && !color.startsWith('var(--')) {
              enhancedData = {
                  ...data,
                  measurementArea: data.measurementArea || area.name,
                  measurementAreaId: data.measurementAreaId || area.id,
                  measurementAreaColor: color
              };
          }
      } else if (mode === 'tmde' && data) {
          const nestedInstrument = data.instrument || {};
          const linkedLibraryInstrument = (instruments || []).find((libraryInst) => {
              const candidateIds = [
                  data.libraryInstrumentId,
                  nestedInstrument.libraryInstrumentId,
                  nestedInstrument.id,
              ].filter(Boolean);
              return candidateIds.some((id) => String(id) === String(libraryInst.id));
          });
          const ownershipArea = findAreaForInstrument(data);
          const instrumentAreaName =
              nestedInstrument.measurementArea ||
              linkedLibraryInstrument?.measurementArea ||
              data.measurementArea ||
              ownershipArea.name ||
              "";
          const instrumentAreaColor =
              nestedInstrument.measurementAreaColor ||
              linkedLibraryInstrument?.measurementAreaColor ||
              data.measurementAreaColor ||
              ownershipArea.color ||
              "#3498db";

          enhancedData = {
              ...data,
              measurementAreaId: data.measurementAreaId || ownershipArea.id,
              measurementArea: instrumentAreaName,
              measurementAreaColor: instrumentAreaColor,
          };
      }
      
      setActiveInstrumentModal({ mode, data: enhancedData, index });
  };

  const handleSaveInstrument = (resultData) => {
      // --- DEBUG LOGS START ---
      console.group("EditSessionModal: handleSaveInstrument");
      console.log("%c[EditSessionModal] Function CALLED", "background: #000; color: #00ff00; font-weight: bold");
      console.log("1. Full Data Received from Modal:", resultData);
      console.log("2. Color Property Check:", resultData.measurementAreaColor);
      console.log("3. Current Modal State:", activeInstrumentModal);
      // --- DEBUG LOGS END ---

      if (!activeInstrumentModal) {
          console.error("[EditSessionModal] Error: activeInstrumentModal is null. Cannot determine mode.");
          console.groupEnd();
          return;
      }
      const { mode, index } = activeInstrumentModal;

      if (mode === 'uut') {
          console.log(`[EditSessionModal] Processing UUT. Assigned Area Name: "${resultData.measurementArea || ""}"`);

          setFormData(prev => {
              const newUuts = [...prev.uuts];
              const { currentAreas, finalAreaId, finalAreaName } =
                  ensureMeasurementArea(prev.measurementAreas || [], resultData);

              const uutToSave = {
                  ...resultData,
                  measurementArea: finalAreaName,
                  measurementAreaId: finalAreaId,    
                  measurementAreaColor: resultData.measurementAreaColor 
              };

              if (index !== null) {
                  console.log(`[EditSessionModal] Updating existing UUT at index ${index}`);
                  newUuts[index] = { ...newUuts[index], ...uutToSave };
              } else {
                  console.log("[EditSessionModal] Adding new UUT");
                  newUuts.push({ id: uuidv4(), ...uutToSave });
              }
              
              console.log("[EditSessionModal] Final Updated Areas:", currentAreas);
              return { ...prev, uuts: newUuts, measurementAreas: currentAreas };
          });
      } else if (mode === 'tmde') {
          console.log("[EditSessionModal] Processing TMDE save...");
          setFormData(prev => {
              const newTmdes = [...prev.tmdes];
              const { currentAreas, finalAreaId, finalAreaName } =
                  ensureMeasurementArea(prev.measurementAreas || [], resultData, {
                      allowCreate: false,
                  });
              const tmdeToSave = {
                  ...resultData,
                  measurementArea: finalAreaName || "",
                  measurementAreaId: finalAreaId,
                  measurementAreaColor: resultData.measurementAreaColor,
                  instrument: {
                      ...(resultData.instrument || {}),
                      ...(resultData.measurementArea
                          ? { measurementArea: resultData.measurementArea }
                          : {}),
                      ...(resultData.measurementAreaColor
                          ? { measurementAreaColor: resultData.measurementAreaColor }
                          : {}),
                  },
              };
              if (index !== null) {
                  newTmdes[index] = { ...newTmdes[index], ...tmdeToSave };
              } else {
                  newTmdes.push({ id: uuidv4(), ...tmdeToSave });
              }
              return { ...prev, tmdes: newTmdes, measurementAreas: currentAreas };
          });
      }
      
      console.groupEnd();
      setActiveInstrumentModal(null);
  };
  
  const handleDeleteItem = (listName, index) => {
      setFormData(prev => ({
          ...prev,
          [listName]: prev[listName].filter((_, i) => i !== index)
      }));
  };

  // --- Main Save ---
  const handleSave = () => {
    onSave(formData, newlyAddedFiles);
  };

  if (!isOpen) return null;

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

      {/* --- Universal Instrument Modal --- */}
      {activeInstrumentModal && (
          <UniversalInstrumentModal 
            isOpen={true}
            onClose={() => setActiveInstrumentModal(null)}
            onSave={handleSaveInstrument}
            mode={activeInstrumentModal.mode}
            initialData={activeInstrumentModal.data}
            instruments={instruments}
          />
      )}

      {viewingImageSrc && (
        <div className="image-viewer-overlay" onClick={() => setViewingImageSrc(null)} style={{ zIndex: 3000 }}>
          <button className="image-viewer-close" onClick={() => setViewingImageSrc(null)}>&times;</button>
          <img src={viewingImageSrc} alt="Full-size preview" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {/* --- Main Modal Content --- */}
      <div
        className="modal-content floating-window-content"
        style={{
          position: 'fixed',
          top: position.y,
          left: position.x,
          width: '1000px',
          maxWidth: '95vw',
          height: '85vh',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 2000,
          padding: 0,
          backgroundColor: 'var(--background-color-secondary)' // Ensure base background
        }}
      >
        {/* --- Header --- */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '15px 25px',
            borderBottom: '1px solid var(--border-color)',
            cursor: 'move',
            backgroundColor: 'var(--component-header-bg)',
            color: 'var(--text-color)'
          }}
          onMouseDown={handleMouseDown}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
             <FontAwesomeIcon icon={faEdit} style={{ color: 'var(--primary-color)' }} />
             <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Edit Session Configuration</h3>
          </div>
          <button onClick={onClose} className="modal-close-button" style={{ position: 'static' }}>&times;</button>
        </div>

        {/* --- Tabs --- */}
        <div className="edit-session-tabs">
          <button
            className={`edit-session-tab ${activeSection === "details" ? "active" : ""}`}
            onClick={() => setActiveSection("details")}
          >
            Session Details
          </button>
          <button
            className={`edit-session-tab ${activeSection === "requirements" ? "active" : ""}`}
            onClick={() => setActiveSection("requirements")}
          >
            Uncertainty Requirements
          </button>
          <button
            className={`edit-session-tab ${activeSection === "instruments" ? "active" : ""}`}
            onClick={() => setActiveSection("instruments")}
          >
            Instruments & Assets
          </button>
        </div>

        {/* --- Body --- */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '25px', backgroundColor: 'var(--background-color-secondary)' }}>
          
          {/* --- TAB: DETAILS --- */}
          {activeSection === "details" && (
            <div className="details-grid">
              <div className="form-section full-span">
                <label>Session Name</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name || ""}
                  onChange={handleChange}
                  placeholder="e.g., Fluke 8588A Verification"
                />
              </div>
              <div className="form-section">
                <label>Analyst</label>
                <input
                  type="text"
                  name="analyst"
                  value={formData.analyst || ""}
                  onChange={handleChange}
                  placeholder="Your Name"
                />
              </div>
              <div className="form-section">
                <label>Organization</label>
                <input
                  type="text"
                  name="organization"
                  value={formData.organization || ""}
                  onChange={handleChange}
                  placeholder="Your Organization"
                />
              </div>
              <div className="form-section">
                <label>Document</label>
                <input
                  type="text"
                  name="document"
                  value={formData.document || ""}
                  onChange={handleChange}
                  placeholder="Document ID or Name"
                />
              </div>
              <div className="form-section">
                <label>Document Date</label>
                <input
                  type="date"
                  name="documentDate"
                  value={formData.documentDate || ""}
                  onChange={handleChange}
                />
              </div>
              <div className="form-section full-span">
                <label>Analysis Notes</label>
                <textarea
                  name="notes"
                  value={formData.notes || ""}
                  onChange={handleChange}
                  rows="8"
                  placeholder="Record analysis notes here..."
                ></textarea>
              </div>
              <div className="form-section full-span">
                <label>Attached Images</label>
                <div className="image-gallery-container">
                  {(formData.noteImages || []).map((imageRef) => {
                    const src = getImageSrc(imageRef);
                    return (
                      <div
                        key={imageRef.id}
                        className="image-thumbnail"
                        onClick={() => src && setViewingImageSrc(src)}
                        style={{ cursor: src ? 'pointer' : 'default', border: src ? '1px solid #ccc' : '2px dashed red' }}
                      >
                        {src ? (
                          <img src={src} alt={imageRef.fileName} />
                        ) : (
                          <div style={{ color: 'red', fontSize: '10px', padding: '5px' }}>Missing</div>
                        )}
                        <button
                          className="remove-image-btn"
                          onClick={(e) => handleRemoveImage(e, imageRef.id)}
                        >
                          <FontAwesomeIcon icon={faTimes} />
                        </button>
                      </div>
                    );
                  })}
                  <label htmlFor="image-upload-input" className="image-add-button">
                    <FontAwesomeIcon icon={faPlus} />
                  </label>
                  <input
                    id="image-upload-input"
                    type="file"
                    accept="image/png, image/jpeg"
                    multiple
                    onChange={handleImageUpload}
                    style={{ display: "none" }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* --- TAB: REQUIREMENTS --- */}
          {activeSection === "requirements" && (
            <div className="details-grid">
              {UNCERTAINTY_REQUIREMENT_FIELDS.map((field) => (
                <div className="form-section" key={field.name}>
                  <label className="requirement-field-label" title={field.tooltip}>
                    <span>{field.label}</span>
                    <FontAwesomeIcon
                      icon={faQuestionCircle}
                      className="requirement-help-icon"
                      aria-hidden="true"
                    />
                  </label>
                  <input
                    type="number"
                    name={field.name}
                    value={formData.uncReq?.[field.name] || ""}
                    onChange={handleReqChange}
                    placeholder={field.placeholder}
                    aria-label={field.label}
                    title={field.tooltip}
                  />
                </div>
              ))}
            </div>
          )}

          {/* --- TAB: INSTRUMENTS (POLISHED) --- */}
          {activeSection === "instruments" && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                
                {/* 1. Measurement Areas Manager */}
                <div className="session-panel-container">
                    <div className="session-panel-header">
                        <h4 className="session-panel-title">
                            <FontAwesomeIcon icon={faLayerGroup} style={{ color: 'var(--primary-color)' }}/> 
                            Measurement Areas
                        </h4>
                    </div>
                    
                    <div className="session-panel-body">
                        <div className="area-input-group">
                            <input 
                                type="text" 
                                placeholder="Create new area..." 
                                value={newAreaName}
                                onChange={(e) => setNewAreaName(e.target.value)}
                                style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--input-background)', color: 'var(--text-color)' }}
                            />
                            <input 
                                type="color" 
                                value={newAreaColor}
                                onChange={(e) => setNewAreaColor(e.target.value)}
                                style={{ width: '40px', height: '38px', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                            />
                            <button className="button primary small" onClick={handleAddArea} disabled={!newAreaName.trim()}>
                                <FontAwesomeIcon icon={faPlus} /> Add
                            </button>
                        </div>

                        <div className="area-tags-container">
                            {formData.measurementAreas.length === 0 && <span className="empty-text">No areas defined.</span>}
                            {formData.measurementAreas.map(area => (
                                <div key={area.id} className="area-tag" style={{ borderColor: area.color }}>
                                    <div className="area-color-dot" style={{ backgroundColor: area.color }}></div>
                                    <span>{area.name}</span>
                                    <button className="area-tag-close" onClick={() => handleDeleteArea(area.id)}>
                                        <FontAwesomeIcon icon={faTimes} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 2. UUT Manager */}
                <div className="session-panel-container">
                     <div className="session-panel-header">
                        <h4 className="session-panel-title">
                            <FontAwesomeIcon icon={faMicroscope} style={{ color: 'var(--primary-color)' }}/> 
                            Units Under Test (UUTs)
                        </h4>
                        <button className="button secondary small" onClick={() => openInstrumentModal('uut')}>
                            <FontAwesomeIcon icon={faPlus} style={{ marginRight: '5px' }}/> Add UUT
                        </button>
                    </div>

                    <div className="session-panel-body">
                        {formData.uuts.length === 0 ? (
                            <div className="empty-list-placeholder">No UUTs added. Click "Add UUT" to begin.</div>
                        ) : (
                            <div className="resource-list">
                                {getAreaGroups(formData.uuts).map(({ area, items }) => (
                                    <div key={`uut-area-${area.id || area.name}`} className="resource-area-section">
                                        <div className="resource-area-heading" style={{ color: area.color }}>
                                            <span className="resource-area-dot" style={{ backgroundColor: area.color }} />
                                            <span>{area.name}</span>
                                            <span className="resource-area-count">({items.length})</span>
                                        </div>
                                        <div className="resource-area-items">
                                            {items.map(({ item: uut, index: idx }) => (
                                                <div key={uut.id || idx} className="resource-item" style={{ borderLeft: `4px solid ${area.color}` }}>
                                                    <div className="resource-info">
                                                        <span className="resource-main-text">{uut.description}</span>
                                                        <span className="resource-sub-text">
                                                            {uut.instrument ? `${uut.instrument.manufacturer || ""} ${uut.instrument.model || ""}`.trim() : "Manual UUT"}
                                                        </span>
                                                    </div>
                                                    <div className="resource-actions">
                                                        <button className="action-icon-btn" onClick={() => openInstrumentModal('uut', uut, idx)} title="Edit">
                                                            <FontAwesomeIcon icon={faEdit} />
                                                        </button>
                                                        <button className="action-icon-btn danger" onClick={() => handleDeleteItem('uuts', idx)} title="Delete">
                                                            <FontAwesomeIcon icon={faTrash} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* 3. TMDE Manager */}
                <div className="session-panel-container">
                     <div className="session-panel-header">
                        <h4 className="session-panel-title">
                            <FontAwesomeIcon icon={faTools} style={{ color: 'var(--primary-color)' }}/> 
                            Test Equipment (TMDE)
                        </h4>
                        <button className="button secondary small" onClick={() => openInstrumentModal('tmde')}>
                            <FontAwesomeIcon icon={faPlus} style={{ marginRight: '5px' }}/> Add TMDE
                        </button>
                    </div>

                    <div className="session-panel-body">
                        {formData.tmdes.length === 0 ? (
                             <div className="empty-list-placeholder">No TMDEs added.</div>
                        ) : (
                             <div className="resource-list">
                                {getAreaGroups(formData.tmdes, "instrument").map(({ area, items }) => (
                                    <div key={`tmde-area-${area.id || area.name}`} className="resource-area-section">
                                        <div className="resource-area-heading" style={{ color: area.color }}>
                                            <span className="resource-area-dot" style={{ backgroundColor: area.color }} />
                                            <span>{area.name}</span>
                                            <span className="resource-area-count">({items.length})</span>
                                        </div>
                                        <div className="resource-area-items">
                                            {items.map(({ item: tmde, index: idx }) => (
                                                <div key={tmde.id || idx} className="resource-item" style={{ borderLeft: `4px solid ${area.color}` }}>
                                                    <div className="resource-info">
                                                        <span className="resource-main-text">{tmde.name}</span>
                                                        <span className="resource-sub-text">
                                                            ID: {tmde.assetId || "N/A"} | Qty: {tmde.quantity || 1}
                                                            {tmde.instrument && ` | ${tmde.instrument.manufacturer || ""} ${tmde.instrument.model || ""}`}
                                                        </span>
                                                    </div>
                                                    <div className="resource-actions">
                                                        <button className="action-icon-btn" onClick={() => openInstrumentModal('tmde', tmde, idx)} title="Edit">
                                                            <FontAwesomeIcon icon={faEdit} />
                                                        </button>
                                                        <button className="action-icon-btn danger" onClick={() => handleDeleteItem('tmdes', idx)} title="Delete">
                                                            <FontAwesomeIcon icon={faTrash} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

            </div>
          )}
        </div>

        {/* --- Footer --- */}
        <div style={{ 
            padding: '20px 30px', 
            borderTop: '1px solid var(--border-color)', 
            backgroundColor: 'var(--background-color-secondary)',
            display: 'flex', 
            justifyContent: 'flex-end',
            gap: '10px'
        }}>
            <button className="button primary large" onClick={handleSave}>
              <FontAwesomeIcon icon={faCheck} style={{ marginRight: '8px' }} /> Save Configuration
            </button>
        </div>

      </div>
    </>,
    document.body
  );
};

export default EditSessionModal;
