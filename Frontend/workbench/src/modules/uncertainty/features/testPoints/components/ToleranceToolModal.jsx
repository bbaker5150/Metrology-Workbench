import SymbolButton from "../../../components/common/SymbolButton";
import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import ToleranceForm from "../../../components/common/ToleranceForm";
import ContextMenu from "../../../components/common/ContextMenu";
import NotificationModal from '../../../components/modals/NotificationModal';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTrashAlt,
  faCheck,
} from "@fortawesome/free-solid-svg-icons";

const ToleranceToolModal = ({ isOpen, onClose, onSave, testPointData }) => {
  const [activeTab, setActiveTab] = useState("UUT");
  const [uutTolerance, setUutTolerance] = useState({});
  const [tmdeTolerances, setTmdeTolerances] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);

  // Floating Window State
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    return {
      x: Math.max(0, (window.innerWidth - 600) / 2),
      y: Math.max(0, (window.innerHeight - 700) / 2)
    };
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (isOpen && testPointData) {
      const cleanObject = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([_, v]) => v !== undefined && v !== null));

      let initialUut = cleanObject(testPointData.uutTolerance);

      if (initialUut.floor && !initialUut.floor.unit && testPointData.testPointInfo?.parameter?.unit) {
        initialUut = {
          ...initialUut,
          floor: { ...initialUut.floor, unit: testPointData.testPointInfo.parameter.unit }
        };
      }

      if (initialUut.readings_iv && !initialUut.readings_iv.unit && testPointData.testPointInfo?.parameter?.unit) {
        initialUut = {
          ...initialUut,
          readings_iv: { ...initialUut.readings_iv, unit: testPointData.testPointInfo.parameter.unit }
        };
      }

      setUutTolerance(initialUut);
      setTmdeTolerances((testPointData.tmdeTolerances || []).map(t => cleanObject(t)));
      setActiveTab("UUT");
    }
  }, [isOpen, testPointData]);

  const handleMouseDown = (e) => {
    // Prevent drag if clicking buttons or inputs
    if (e.target.closest('button') || e.target.closest('input')) return;

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

  const handleRemoveTmde = (idToRemove) => {
    setTmdeTolerances((prev) => prev.filter((t) => t.id !== idToRemove));
    if (activeTab === idToRemove) setActiveTab("UUT");
  };

  const handleTmdeToleranceChange = React.useCallback((id, setter) => {
    setTmdeTolerances((prev) => prev.map((t) => (t.id === id ? setter(t) : t)));
  }, []);

  const onActiveTmdeChange = React.useCallback((updater) => {
    handleTmdeToleranceChange(activeTab, updater);
  }, [activeTab, handleTmdeToleranceChange]);

  if (!isOpen) return null;

  const handleSave = () => {
    const cleanupTolerance = (tol, isUut = false) => {
      const cleaned = { ...tol };

      const componentKeys = ["reading", "readings_iv", "range", "floor", "db"];

      componentKeys.forEach((key) => {
        if (cleaned[key] && (cleaned[key].high === "" || isNaN(parseFloat(cleaned[key].high)))) {
          delete cleaned[key];
        }
      });

      if (isUut) {
        if (!parseFloat(cleaned.measuringResolution)) {
          delete cleaned.measuringResolution;
          delete cleaned.measuringResolutionUnit;
        }
      }
      return cleaned;
    };

    onSave({
      uutTolerance: cleanupTolerance(uutTolerance, true),
      tmdeTolerances: tmdeTolerances.map((t) => cleanupTolerance(t)),
    });
    onClose();
  };

  const activeTmde = tmdeTolerances.find((t) => t.id === activeTab);



  return ReactDOM.createPortal(
    <>
      {contextMenu && (<ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />)}

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
          zIndex: 2000,
          overflow: 'hidden'
        }}
      >

        {/* Modal Header - Draggable */}
        <div
          className="modal-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '15px',
            cursor: 'move',
            userSelect: 'none'
          }}
          onMouseDown={handleMouseDown}
        >
          <h3 style={{ margin: 0 }}>Tolerance Editor</h3>
          <SymbolButton
            onClick={onClose}
            className="modal-close-button"
            title="Close"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.2rem',
              cursor: 'pointer',
              color: 'var(--text-color)',
              position: 'static'
            }}
           />
        </div>

        <div className="modal-tabs">
          <button className={`modal-tab ${activeTab === "UUT" ? "active" : ""}`} onClick={() => setActiveTab("UUT")}>
            {testPointData.uutDescription || "UUT"}
          </button>
          {tmdeTolerances.map((tmde) => (
            <button key={tmde.id} className={`modal-tab ${activeTab === tmde.id ? "active" : ""}`} onClick={() => setActiveTab(tmde.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.pageX, y: e.pageY, items: [{ label: `Delete "${tmde.name}"`, action: () => handleRemoveTmde(tmde.id), icon: faTrashAlt, className: "destructive" }] });
              }}>
              {tmde.name}
            </button>
          ))}
        </div>

        <div className="modal-body-scrollable" style={{ flex: 1, overflowY: 'auto' }}>
          {activeTab === "UUT" && (
            <ToleranceForm tolerance={uutTolerance} setTolerance={setUutTolerance} isUUT={true} referencePoint={testPointData.testPointInfo.parameter} />
          )}
          {activeTmde && (
            <ToleranceForm tolerance={activeTmde} setTolerance={onActiveTmdeChange} isUUT={false} referencePoint={activeTmde.measurementPoint} />
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-actions" style={{ marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '15px', justifyContent: 'flex-end' }}>
          <button
            className="modal-icon-button primary"
            onClick={handleSave}
            title="Save Changes"
          >
            <FontAwesomeIcon icon={faCheck} />
          </button>
        </div>

      </div>
    </>,
    document.body
  );
};

export default ToleranceToolModal;