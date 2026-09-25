import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCog } from "@fortawesome/free-solid-svg-icons";

export default function UncertaintyTypeMenu({ value = "parametric", onChange }) {
  const [open, setOpen] = useState(false);
  return <div className="uncertainty-type-menu">
    <button type="button" aria-label="Change uncertainty type" title="Change uncertainty type" aria-expanded={open}
      onClick={event => { event.stopPropagation(); setOpen(!open); }}><FontAwesomeIcon icon={faCog}/></button>
    {open && <div className="instrument-source-settings" role="group" aria-label="Uncertainty type">
      {[["parametric", "Manual"], ["table", "Table"], ["equation", "Equation"]].map(([kind, label]) =>
        <button key={kind} type="button" aria-pressed={value === kind} onClick={event => {
          event.stopPropagation(); setOpen(false); if (kind !== value) onChange(kind);
        }}>{label}</button>)}
    </div>}
  </div>;
}
