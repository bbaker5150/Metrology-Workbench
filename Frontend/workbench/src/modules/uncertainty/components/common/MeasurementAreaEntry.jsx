import SymbolButton from "./SymbolButton";
import React, { useState } from "react";

export default function MeasurementAreaEntry({ kind, onAdd }) {
  const [name, setName] = useState("");
  const label = kind.toUpperCase();
  const addArea = () => {
    if (!name.trim()) return;
    onAdd({ name: name.trim(), unit: "" });
    setName("");
  };
  return (
    <div className="sidebar-area-entry instrument-area-entry" data-tour={`${kind}-add-function`}>
      <input
        aria-label={`New ${label} measurement area name`}
        placeholder="Add Measurement Area"
        value={name}
        onChange={event => setName(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            addArea();
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            setName("");
          }
        }}
      />
      <SymbolButton add type="button" onClick={addArea} title="Add Measurement Area" aria-label={`Add Measurement Area from ${label} table`} disabled={!name.trim()} />
    </div>
  );
}
