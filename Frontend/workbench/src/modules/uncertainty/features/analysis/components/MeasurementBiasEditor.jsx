import React, { useMemo } from "react";
import BiasValueEditor from "../../../components/common/BiasValueEditor";
import InlineMenuSelect from "../../../components/common/InlineMenuSelect";
import { resolveMeasurementBias } from "../../../utils/measurementBias";
import { getUnitDisplayLabel } from "../../../utils/uncertaintyMath";
import { isUnknownMeasurementTolerance } from "../../../utils/risk8/unknownMeasurementRisk8";

const display = value => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${Number(value.toPrecision(7))}` : "Not set";

/** Point-owned overrides over live instrument defaults. No computed contribution
 * is persisted: the shared resolver recalculates it at this point's current
 * equation inputs. Deleting an override restores inheritance; writing zero is a
 * deliberate override. Switching to manual net keeps source settings available
 * for restoration but the resolver excludes them from the manual result.
 * Native <details> owns only expansion state; opening it never changes the model.
 */
export default function MeasurementBiasEditor({ point, session, calculatedAverage, onChange }) {
  const result = useMemo(() => resolveMeasurementBias(point, session, calculatedAverage), [point, session, calculatedAverage]);
  const unit = point.testPointInfo?.parameter?.unit || "";
  const unitLabel = getUnitDisplayLabel(unit);
  const settings = point.measurementBias || {};
  const unknown = isUnknownMeasurementTolerance(point.uutTolerance || session.uutTolerance);
  const patch = changes => onChange({ measurementBias: { ...settings, ...changes } });
  return <details className="measurement-bias-panel">
    <summary><span>Bias settings</span><span className="measurement-bias-summary">
      {result.error ? "Check bias settings" : `UUT: ${unknown ? "Not applicable" : `${display(result.uutBias)} ${unitLabel}`} · System: ${display(result.calBias)} ${unitLabel}`}
    </span></summary>
    <div className="measurement-bias-body">
      <div className="measurement-bias-setting"><span className="measurement-bias-label">UUT bias</span>
        {unknown ? <span>Not applicable without a known measurement</span> : <>
          <InlineMenuSelect ariaLabel="UUT bias source" width="auto" showOptionMeta={false} value={point.uutBias?.mode || "inherit"}
            options={[{ value: "inherit", label: "Use UUT range" }, { value: "override", label: "This point" }]}
            onChange={mode => onChange({ uutBias: mode === "inherit" ? undefined : { mode, value: String(result.uutBias || 0), unit } })} />
          {point.uutBias?.mode === "override" ? <BiasValueEditor label="Point UUT bias" unit={unit} value={point.uutBias}
            onChange={uutBias => onChange({ uutBias })} /> : <span>{result.uutOrigin === "assumed" ? "Assumed zero" : `${display(result.uutBias)} ${unitLabel} (${result.uutOrigin === "calculated" ? "calculated mean" : "range default"})`}</span>}
        </>}
      </div>
      <div className="measurement-bias-setting"><span className="measurement-bias-label">Measurement system bias</span>
        <InlineMenuSelect ariaLabel="Measurement system bias source" width="auto" showOptionMeta={false} value={settings.mode || "sources"}
          options={[{ value: "sources", label: "From budget sources" }, { value: "manual", label: "Enter net bias" }]}
          onChange={mode => patch({ mode })} />
        {settings.mode === "manual" ? <BiasValueEditor label="Net measurement system bias" unit={unit} value={settings} onChange={measurementBias => onChange({ measurementBias })} allowCorrection />
          : <span>{result.sources.some(row => row.spec?.value !== undefined && row.spec?.value !== "") ? `${display(result.calBias)} ${unitLabel}` : "Assumed zero"}</span>}
      </div>
      <p className="measurement-bias-help">Enter signed residual errors. Positive system bias makes the evaluated result read high. Mark a source already corrected only when its correction is included in the measurement. Its uncertainty stays in the budget.</p>
      {settings.mode !== "manual" && <div className="measurement-bias-sources">
        {result.sources.map(row => <div className="measurement-bias-source" key={row.key}>
          <span className="measurement-bias-source-name">{row.name}{row.variableType ? ` · ${row.variableType}` : ""}</span>
          <BiasValueEditor label={`Bias for ${row.name}`} unit={row.reference?.unit || unit} value={row.spec} allowCorrection
            onChange={spec => patch({ sources: { ...settings.sources, [row.key]: spec } })} />
          {row.overridden && <button type="button" className="bias-reset" onClick={() => { const sources = { ...settings.sources }; delete sources[row.key]; patch({ sources }); }}>Use source default</button>}
          {row.contribution !== undefined && <span title="Signed contribution in output units">→ {display(row.contribution)} {unitLabel}</span>}
        </div>)}
        {!result.sources.length && <p className="measurement-bias-help">Add a budget source or choose Enter net bias.</p>}
        {point.measurementType === "derived" && <p className="measurement-bias-help">Source biases use the equation’s signed sensitivities at this point. Recheck this approximation for large biases or strongly nonlinear equations.</p>}
      </div>}
      {result.error && <p className="form-section-warning" role="alert">{result.error}</p>}
    </div>
  </details>;
}
