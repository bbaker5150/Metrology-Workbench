import SymbolButton from "../common/SymbolButton";
import React, { useState, useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStickyNote, faMinus, faExpand } from "@fortawesome/free-solid-svg-icons";

const FloatingNotepad = ({ notes, onSave, isOpen, onClose }) => {
  const [position, setPosition] = useState({ x: 20, y: 120 });
  const [size, setSize] = useState({ width: 300, height: 400 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isMinimized, setIsMinimized] = useState(false);
  const [localNotes, setLocalNotes] = useState(notes || "");
  const notepadRef = useRef(null);

  useEffect(() => {
    setLocalNotes(notes || "");
  }, [notes]);

  const handleMouseDown = (e) => {
    if (e.target.closest('.notepad-controls') || e.target.closest('textarea')) return;
    setIsDragging(true);
    const rect = notepadRef.current.getBoundingClientRect();
    setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isDragging) {
        setPosition({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
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

  const handleChange = (e) => {
    const val = e.target.value;
    setLocalNotes(val);
    onSave(val);
  };

  if (!isOpen) return null;

  if (isMinimized) {
    return (
      <div 
        ref={notepadRef}
        className="notepad-minimized"
        style={{ left: position.x, top: position.y }}
        onMouseDown={handleMouseDown}
      >
        <div className="notepad-header-min">
          <FontAwesomeIcon icon={faStickyNote} className="notepad-icon" />
          <span className="notepad-title">Notes</span>
          <div className="notepad-controls">
            <button onClick={() => setIsMinimized(false)} title="Expand"><FontAwesomeIcon icon={faExpand} /></button>
            <SymbolButton onClick={onClose} title="Close" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={notepadRef}
      className="floating-notepad"
      style={{ left: position.x, top: position.y, width: size.width, height: size.height }}
    >
      <div className="notepad-header" onMouseDown={handleMouseDown}>
        <div className="header-left">
            <FontAwesomeIcon icon={faStickyNote} className="notepad-icon" />
            <span className="notepad-title">Session Notes</span>
        </div>
        <div className="notepad-controls">
          <button onClick={() => setIsMinimized(true)} title="Minimize"><FontAwesomeIcon icon={faMinus} /></button>
          <SymbolButton onClick={onClose} title="Close" />
        </div>
      </div>
      <div className="notepad-body">
        <textarea
          value={localNotes}
          onChange={handleChange}
          placeholder="Type analysis notes here..."
          spellCheck={false}
        />
      </div>
    </div>
  );
};

export default FloatingNotepad;