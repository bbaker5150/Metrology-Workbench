import React, { forwardRef, useEffect, useState } from "react";
import "./GrowingNumericInput.css";

/** Preserve the native input contract (including refs, uncontrolled blur
 * commits, and intermediate decimal drafts). Only its horizontal footprint
 * changes as the text grows; focus itself never changes sizing or typography.
 * A character-based minimum works in older embedded browsers too. Native
 * content sizing improves precision where supported, without clipping signs,
 * exponents, decimals, or the number-input spinner. Containers own scrolling.
 */
const GrowingNumericInput = forwardRef(function GrowingNumericInput(
  { value, defaultValue, onChange, style, className = "", ...props }, ref,
) {
  const [draft, setDraft] = useState(defaultValue ?? "");
  useEffect(() => setDraft(defaultValue ?? ""), [defaultValue]);
  const text = String(value ?? draft ?? "");
  const characters = Math.max(5, text.length, text ? 0 : String(props.placeholder || "").length);
  return <input {...props} ref={ref} value={value} defaultValue={defaultValue}
    className={`${className} growing-numeric-input`}
    style={{ ...style, "--numeric-content-width": `calc(${characters}ch + ${props.type === "number" ? 28 : 16}px)` }}
    onChange={event => { setDraft(event.target.value); onChange?.(event); }} />;
});

export default GrowingNumericInput;
