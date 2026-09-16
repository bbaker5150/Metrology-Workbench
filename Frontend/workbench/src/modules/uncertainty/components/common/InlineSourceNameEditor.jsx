import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";

/** Keep a wrapped source label's footprint while editing it. The hidden mirror
 * participates in table sizing; the textarea uses exactly the same typography
 * and inset. No measurement/state loop is needed, including at browser zoom.
 * This is a single-line value with visual wrapping, not a multiline data field.
 */
const InlineSourceNameEditor = forwardRef(function InlineSourceNameEditor(
  { value, className = "", onChange, onKeyDown, autoFocus, ...props }, ref,
) {
  const inputRef = useRef(null);
  useImperativeHandle(ref, () => inputRef.current);
  // This replaces a label the user has already brought into view. Browser
  // autofocus must not pan a wide table just because its tag has changed.
  useLayoutEffect(() => { if (autoFocus) inputRef.current?.focus({ preventScroll: true }); }, [autoFocus]);
  return <span className="inline-source-name-slot">
    <span aria-hidden="true" className={`inline-tolerance-summary ${className.includes("dynamic-source-name") ? "dynamic-source-label" : ""}`}>{value || "Not Set"}</span>
    <textarea {...props} ref={inputRef} rows={1} value={value} className={`${className} inline-source-name-input`}
      onChange={event => {
        // Pasting a line break must not change the source-name data model.
        event.target.value = event.target.value.replace(/[\r\n]+/g, " ");
        onChange?.(event);
      }}
      onKeyDown={onKeyDown} />
  </span>;
});
export default InlineSourceNameEditor;
