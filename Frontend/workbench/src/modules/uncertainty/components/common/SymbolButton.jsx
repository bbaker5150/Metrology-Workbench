import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTimes } from "@fortawesome/free-solid-svg-icons";

export default function SymbolButton({ add = false, className = "", title, ...props }) {
  return <button type="button" title={title} aria-label={title || (add ? "Add" : "Close")}
    {...props} className={`uncertainty-symbol-button ${className}`.trim()}>
    <FontAwesomeIcon icon={add ? faPlus : faTimes} />
  </button>;
}
