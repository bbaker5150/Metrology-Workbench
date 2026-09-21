import React from "react";

// Use the same intrinsic text box in read and edit modes. The invisible mirror
// grows with the draft; the input overlays it, so focus cannot change the row's
// height, text origin or adjacent unit position. Shared by point values and
// requirement columns to keep their sizing and focus treatment identical.
export default function PointNumericInput({ value, className = "", placeholder = "-", ...props }) {
  return <span className="point-value-input-slot">
    <span className="point-value-number" aria-hidden="true">{value || placeholder}</span>
    <input {...props} value={value} placeholder={placeholder} inputMode="decimal"
      size={Math.max(1, String(value ?? "").length)}
      className={`sidebar-inline-input value inline-tolerance-input inline-resolution-input ${className}`} />
  </span>;
}
