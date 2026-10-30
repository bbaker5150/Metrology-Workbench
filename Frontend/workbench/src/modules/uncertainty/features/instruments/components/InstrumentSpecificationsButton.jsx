import React from "react";
import "./InstrumentSpecificationsButton.css";

export default function InstrumentSpecificationsButton({ name, expanded, onClick }) {
  const label = expanded ? "Hide Instrument Specifications" : "View or Edit Instrument Specifications";
  return <button type="button" className="icon-btn-ghost instrument-library-specifications" title={label}
    aria-label={`${label} ${name}`} aria-expanded={expanded} onClick={onClick}>
    <svg viewBox="0 0 32 32" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 4h7l5 5v21H9V17M24 4v6h5M20 17h5M20 22h5M20 27h5M12 17l1.5 1.5L16 16M12 22l1.5 1.5L16 21M12 27l1.5 1.5L16 26" />
      <path d="m8 2 3-.1.5 2 1.5.7 1.8-1 2 2-1 1.8.7 1.6 2 .5v2.8l-2 .5-.7 1.6 1 1.8-2 2-1.8-1-1.5.7-.5 2H8l-.5-2-1.6-.7-1.8 1-2-2 1-1.8-.7-1.6-2-.5V8.6l2-.5.7-1.6-1-1.8 2-2 1.8 1 1.6-.7Z" transform="translate(2 1) scale(.8)" />
      <circle cx="9.6" cy="9" r="2.6" />
    </svg>
  </button>;
}
