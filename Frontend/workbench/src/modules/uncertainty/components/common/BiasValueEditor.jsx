import GrowingNumericInput from "./GrowingNumericInput";
import React, { useEffect, useRef, useState } from "react";
import InlineMenuSelect from "./InlineMenuSelect";
import { getUnitDisplayLabel } from "../../utils/uncertaintyMath";
import "./MeasurementBias.css";

/** Shared instrument/budget editor; the persisted spec is the source of truth.
 * Draft text permits intermediate signed decimals without recalculating risk on
 * every keystroke. Blur (including Enter) validates and commits the whole spec,
 * preserving provenance/mode/correction fields; blank and explicit zero differ.
 * Changing the display basis does not perform a hidden numerical conversion:
 * the current number is reinterpreted in native units or percent as selected.
 */
export default function BiasValueEditor({ value, unit, onChange, label = "Bias", allowCorrection = false, commitOnEdit = false, autoFocus = false }) {
  const spec = value || {};
  const [draft, setDraft] = useState(spec.value ?? "");
  const edited = useRef(false);
  useEffect(() => setDraft(spec.value ?? ""), [spec.value]);
  const commit = event => {
    const text = String(draft).trim();
    if (text && !Number.isFinite(Number(text))) {
      event.currentTarget.setCustomValidity("Enter a finite signed number.");
      event.currentTarget.reportValidity();
      return;
    }
    event.currentTarget.setCustomValidity("");
    // An inherited net value is display-only until edited. Deliberately typing
    // its current value (including zero) still creates an explicit override.
    if (text !== String(spec.value ?? "") || (commitOnEdit && edited.current)) onChange({ ...spec, value: text, unit: spec.unit || unit });
    edited.current = false;
  };
  return <span className="bias-value-editor">
    <GrowingNumericInput autoFocus={autoFocus} onFocus={event => autoFocus && event.target.select()} aria-label={label} className="bias-value-input" type="text" inputMode="decimal" placeholder="0"
      value={draft} onChange={event => { edited.current = true; event.target.setCustomValidity(""); setDraft(event.target.value); }} onBlur={commit}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
    <InlineMenuSelect ariaLabel={`${label} units`} title={spec.kind === "percent" ? "Percent of the final UUT tolerance: half-span for two-sided limits, nominal-to-limit distance for known single-sided limits (Excel MUA basis)" : "Signed bias in native units"} value={spec.kind || "absolute"} width="auto" showOptionMeta={false}
      options={[{ value: "absolute", label: getUnitDisplayLabel(spec.unit || unit) || "Native unit" }, { value: "percent", label: "%" }]}
      onChange={kind => onChange({ ...spec, kind, unit: unit || spec.unit })} />
    {allowCorrection && <label className="bias-correction"><input type="checkbox" checked={!!spec.corrected}
      onChange={event => onChange({ ...spec, corrected: event.target.checked })} />Already corrected</label>}
  </span>;
}
