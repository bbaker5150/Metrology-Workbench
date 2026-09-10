import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";

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
        placeholder="Area name"
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
      <button type="button" onClick={addArea} title="Add Measurement Area" aria-label={`Add Measurement Area from ${label} table`} disabled={!name.trim()}>
        <FontAwesomeIcon icon={faPlus} />
      </button>
    </div>
  );
}
