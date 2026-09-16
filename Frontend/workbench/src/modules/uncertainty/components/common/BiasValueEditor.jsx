import React, { useEffect, useState } from "react";
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
export default function BiasValueEditor({ value, unit, onChange, label = "Bias", allowCorrection = false }) {
  const spec = value || {};
  const [draft, setDraft] = useState(spec.value ?? "");
  useEffect(() => setDraft(spec.value ?? ""), [spec.value]);
  const commit = event => {
    const text = String(draft).trim();
    if (text && !Number.isFinite(Number(text))) {
      event.currentTarget.setCustomValidity("Enter a finite signed number.");
      event.currentTarget.reportValidity();
      return;
    }
    event.currentTarget.setCustomValidity("");
    if (text !== String(spec.value ?? "")) onChange({ ...spec, value: text, unit: spec.unit || unit });
  };
  return <span className="bias-value-editor">
    <input aria-label={label} className="bias-value-input" type="text" inputMode="decimal" placeholder="Assumed zero"
      value={draft} onChange={event => { event.target.setCustomValidity(""); setDraft(event.target.value); }} onBlur={commit}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
    <InlineMenuSelect ariaLabel={`${label} units`} value={spec.kind || "absolute"} width="auto" showOptionMeta={false}
      options={[{ value: "absolute", label: getUnitDisplayLabel(spec.unit || unit) || "Native unit" }, { value: "percent", label: "% of value" }]}
      onChange={kind => onChange({ ...spec, kind, unit: unit || spec.unit })} />
    {allowCorrection && <label className="bias-correction"><input type="checkbox" checked={!!spec.corrected}
      onChange={event => onChange({ ...spec, corrected: event.target.checked })} />Already corrected</label>}
  </span>;
}
