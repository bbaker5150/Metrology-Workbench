import React, { useState, useEffect, useRef, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes, faMinus, faExchangeAlt, faCopy, faRightLeft } from "@fortawesome/free-solid-svg-icons";
import { getUnitDisplayLabel, unitSystem } from "../../utils/uncertaintyMath";

const UnitConverter = ({ isOpen, onClose }) => {
  const [position, setPosition] = useState({ x: 420, y: 150 });
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const nodeRef = useRef(null);

  // Converter Logic
  const categories = useMemo(() => {
    const cats = new Set();
    Object.values(unitSystem.units).forEach(u => {
        if(u.quantity && u.quantity !== "Ratio") cats.add(u.quantity);
    });
    return Array.from(cats).sort();
  }, []);

  const [category, setCategory] = useState(categories[0] || "Voltage");
  const [fromUnit, setFromUnit] = useState("");
  const [toUnit, setToUnit] = useState("");
  const [inputValue, setInputValue] = useState("");
  
  const activeUnits = useMemo(() => {
    return Object.keys(unitSystem.units)
        .filter(key => unitSystem.units[key].quantity === category)
        .sort();
  }, [category]);

  useEffect(() => {
      if (activeUnits.length > 0) {
          setFromUnit(activeUnits[0]);
          setToUnit(activeUnits.length > 1 ? activeUnits[1] : activeUnits[0]);
      }
  }, [activeUnits]);

  // Dragging Logic
  const handleMouseDown = (e) => {
    if (e.target.closest('.conv-body') || e.target.closest('select') || e.target.closest('input')) return;
    setIsDragging(true);
    const rect = nodeRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
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

  const convertedValue = useMemo(() => {
      if (!inputValue || isNaN(parseFloat(inputValue))) return "---";
      const fromFactor = unitSystem.units[fromUnit]?.to_si || 1;
      const toFactor = unitSystem.units[toUnit]?.to_si || 1;
      const valBase = parseFloat(inputValue) * fromFactor;
      const valTarget = valBase / toFactor;
      return valTarget.toPrecision(7); 
  }, [inputValue, fromUnit, toUnit]);

  const handleSwap = () => {
      setFromUnit(toUnit);
      setToUnit(fromUnit);
  };

  const handleCopy = () => {
      if(convertedValue !== "---") {
          navigator.clipboard.writeText(convertedValue);
      }
  };

  if (!isOpen) return null;

  if (isMinimized) {
    return (
      <div 
        className="floating-tool-min"
        style={{ left: position.x, top: position.y }}
        onMouseDown={handleMouseDown}
        ref={nodeRef}
      >
        <FontAwesomeIcon icon={faRightLeft} />
        <span>Units</span>
        <div className="tool-controls">
          <button onClick={() => setIsMinimized(false)}><FontAwesomeIcon icon={faExchangeAlt} /></button>
          <button onClick={onClose}><FontAwesomeIcon icon={faTimes} /></button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="floating-tool converter-window"
      style={{ left: position.x, top: position.y }}
      ref={nodeRef}
    >
      <div className="tool-header" onMouseDown={handleMouseDown}>
        <span>Unit Converter</span>
        <div className="tool-controls">
          <button onClick={() => setIsMinimized(true)}><FontAwesomeIcon icon={faMinus} /></button>
          <button onClick={onClose}><FontAwesomeIcon icon={faTimes} /></button>
        </div>
      </div>

      <div className="conv-body">
        <label>Category</label>
        <select 
            value={category} 
            onChange={(e) => setCategory(e.target.value)}
            className="full-width-select"
        >
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <div className="conv-grid">
            <div className="conv-side">
                <label>From</label>
                <input 
                    type="number" 
                    value={inputValue} 
                    onChange={(e) => setInputValue(e.target.value)} 
                    placeholder="Value"
                />
                <select value={fromUnit} onChange={(e) => setFromUnit(e.target.value)}>
                    {activeUnits.map(u => (
                      <option key={u} value={u}>
                        {getUnitDisplayLabel(u)}
                      </option>
                    ))}
                </select>
            </div>

            <div className="conv-middle">
                <button className="icon-btn-round" onClick={handleSwap} title="Swap Units">
                    <FontAwesomeIcon icon={faExchangeAlt} />
                </button>
            </div>

            <div className="conv-side">
                <label>To</label>
                <div className="result-display">
                    {convertedValue}
                    <button className="copy-btn-mini" onClick={handleCopy} title="Copy Result">
                        <FontAwesomeIcon icon={faCopy} />
                    </button>
                </div>
                <select value={toUnit} onChange={(e) => setToUnit(e.target.value)}>
                    {activeUnits.map(u => (
                      <option key={u} value={u}>
                        {getUnitDisplayLabel(u)}
                      </option>
                    ))}
                </select>
            </div>
        </div>
      </div>
    </div>
  );
};

export default UnitConverter;
