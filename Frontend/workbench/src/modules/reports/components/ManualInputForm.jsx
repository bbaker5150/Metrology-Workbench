import { useEffect, useState } from "react";
import { fetchAreas } from "../api";

const STATEMENT_LABELS = {
  technical: "Technical / Method",
  results_location: "Results location",
  special: "Special statement",
  uncertainty: "Uncertainty",
  traceability: "Traceability",
  reproduction: "Reproduction",
};

function BufferedInput({ value, onCommit, ...props }) {
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => setLocal(value ?? ""), [value]);
  return (
    <input
      {...props}
      value={local}
      onChange={(event) => setLocal(event.target.value)}
      onBlur={() => { if (local !== (value ?? "")) onCommit(local); }}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
    />
  );
}

function BufferedTextarea({ value, onCommit, ...props }) {
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => setLocal(value ?? ""), [value]);
  return (
    <textarea
      {...props}
      value={local}
      onChange={(event) => setLocal(event.target.value)}
      onBlur={() => { if (local !== (value ?? "")) onCommit(local); }}
    />
  );
}

function FormSection({ title, action, children }) {
  return (
    <section className="roc-section">
      <div className="roc-section-head">
        <p className="roc-title">{title}</p>
        {action}
      </div>
      <div className="roc-section-body">{children}</div>
    </section>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <label className="roc-field">
      <span className="roc-label">{label}</span>
      <BufferedInput className="roc-input" type={type} value={value} onCommit={onChange} placeholder={placeholder} />
    </label>
  );
}

function TableEditor({ table, index, onChange, onRemove }) {
  const update = (patch) => onChange(index, { ...table, ...patch });
  const updateColumn = (columnIndex, patch) => update({
    columns: table.columns.map((column, i) => i === columnIndex ? { ...column, ...patch } : column),
  });
  const updateCell = (rowIndex, columnIndex, value) => update({
    rows: table.rows.map((row, i) => i === rowIndex ? row.map((cell, j) => j === columnIndex ? value : cell) : row),
  });
  const addColumn = () => update({
    columns: [...table.columns, { header: "", unit: "" }],
    rows: table.rows.map((row) => [...row, ""]),
  });
  const removeColumn = (columnIndex) => update({
    columns: table.columns.filter((_, i) => i !== columnIndex),
    rows: table.rows.map((row) => row.filter((_, i) => i !== columnIndex)),
  });
  const addRow = () => update({ rows: [...table.rows, table.columns.map(() => "")] });
  const removeRow = (rowIndex) => update({ rows: table.rows.filter((_, i) => i !== rowIndex) });

  return (
    <div className="roc-section" style={{ marginTop: 0 }}>
      <div className="roc-section-head">
        <p className="roc-title">Data Table {index + 1}</p>
        <button className="roc-btn-link" onClick={() => onRemove(index)}>Remove table</button>
      </div>
      <div className="roc-section-body">
        <div className="roc-field">
          <span className="roc-label">Table title</span>
          <BufferedInput className="roc-input" value={table.title} onCommit={(title) => update({ title })} placeholder="e.g. DC Resistance Data" />
        </div>
        <div className="roc-field">
          <span className="roc-label">Intro paragraph (optional)</span>
          <BufferedTextarea className="roc-textarea" value={table.intro_text} onCommit={(intro_text) => update({ intro_text })} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="roc-label">Columns</span>
          <button className="roc-btn-link" onClick={addColumn}>+ Column</button>
        </div>
        <div className="roc-grid-2">
          {table.columns.map((column, columnIndex) => (
            <div className="roc-kv-item" key={columnIndex}>
              <BufferedTextarea className="roc-textarea" value={column.header} onCommit={(header) => updateColumn(columnIndex, { header })} placeholder={"TI\nTest Current"} />
              <BufferedInput className="roc-input" value={column.unit} onCommit={(unit) => updateColumn(columnIndex, { unit })} placeholder="(Amps)" />
              <button className="roc-btn-link" onClick={() => removeColumn(columnIndex)}>Remove</button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="roc-label">Rows</span>
          <button className="roc-btn-link" onClick={addRow}>+ Row</button>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {table.rows.map((row, rowIndex) => (
            <div key={rowIndex} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {row.map((cell, columnIndex) => (
                <BufferedInput key={columnIndex} className="roc-input roc-input-mono" value={cell} onCommit={(value) => updateCell(rowIndex, columnIndex, value)} />
              ))}
              <button className="roc-btn-link" onClick={() => removeRow(rowIndex)}>×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ManualInputForm({ data, onChange }) {
  const [areas, setAreas] = useState([]);

  useEffect(() => { fetchAreas().then(setAreas).catch(() => {}); }, []);

  const set = (key) => (value) => onChange({ ...data, [key]: value });
  const setStatement = (index, text) => onChange({
    ...data,
    statements: data.statements.map((statement, i) => i === index ? { ...statement, text } : statement),
  });
  const setTable = (index, table) => onChange({
    ...data,
    tables: data.tables.map((current, i) => i === index ? table : current),
  });

  const applyArea = (code) => {
    const area = areas.find((item) => item.code === code);
    if (!area) {
      onChange({ ...data, area_code: code });
      return;
    }
    onChange({
      ...data,
      area_code: code,
      nomenclature: data.nomenclature || area.default_nomenclature,
      submitted_label: area.submitted_label || "Submitted by:",
      statements: area.statements.map((statement) => ({ kind: statement.kind, text: statement.text })),
    });
  };

  const setInlineResults = (value) => onChange({
    ...data,
    inline_results: value.split("\n").map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      return [...cells, "", "", "", ""].slice(0, 4);
    }).filter((row) => row.some(Boolean)),
  });

  return (
    <div className="roc-section-body">
      <FormSection title="Measurement Area">
        <p className="roc-subtitle">Selecting an area loads its approved ROC statements. You may edit them for this report.</p>
        <select className="roc-select" value={data.area_code || ""} onChange={(event) => applyArea(event.target.value)}>
          <option value="">Select an area</option>
          {areas.map((area) => <option key={area.code} value={area.code}>{area.name}</option>)}
        </select>
      </FormSection>

      <FormSection title="Instrument">
        <div className="roc-grid-2">
          <Field label="RoC #" value={data.roc_number} onChange={set("roc_number")} placeholder="2026-000000" />
          <Field label="Nomenclature" value={data.nomenclature} onChange={set("nomenclature")} placeholder="Current Shunt" />
          <Field label="Manufacturer" value={data.manufacturer} onChange={set("manufacturer")} />
          <Field label="Model" value={data.model_number} onChange={set("model_number")} />
          <Field label="Serial" value={data.serial_number} onChange={set("serial_number")} />
          <Field label="Procedure Used" value={data.procedure_used} onChange={set("procedure_used")} placeholder="NPSL 17-55XX-XX" />
        </div>
      </FormSection>

      <FormSection title="Customer">
        <div className="roc-grid-2">
          <Field label="Label" value={data.submitted_label} onChange={set("submitted_label")} />
          <Field label="Activity / Ship" value={data.customer_name} onChange={set("customer_name")} />
        </div>
        <Field label="Address" value={data.customer_address} onChange={set("customer_address")} />
      </FormSection>

      <FormSection title="Environment & Dates">
        <div className="roc-grid-2">
          <Field label="Ambient Temperature (°C)" value={data.ambient_temperature} onChange={set("ambient_temperature")} />
          <Field label="Relative Humidity (%)" value={data.relative_humidity} onChange={set("relative_humidity")} />
          <Field label="Calibration Date" type="date" value={data.calibration_date} onChange={set("calibration_date")} />
          <Field label="Due Date" type="date" value={data.due_date} onChange={set("due_date")} />
          <Field label="Issue Date" type="date" value={data.issue_date} onChange={set("issue_date")} />
        </div>
      </FormSection>

      <FormSection title="Personnel">
        <div className="roc-grid-2">
          <Field label="Metrologist" value={data.metrologist_name} onChange={set("metrologist_name")} />
          <Field label="Metrologist Title" value={data.metrologist_title} onChange={set("metrologist_title")} />
          <Field label="Approved By" value={data.approver_name} onChange={set("approver_name")} />
          <Field label="Approver Title" value={data.approver_title} onChange={set("approver_title")} />
        </div>
      </FormSection>

      <FormSection title="Front-Page Statements" action={<button className="roc-btn-link" onClick={() => onChange({ ...data, statements: [...data.statements, { kind: "special", text: "" }] })}>+ Statement</button>}>
        {data.statements.length === 0 && <p className="roc-subtitle">Select a measurement area to load its default statements.</p>}
        {data.statements.map((statement, index) => (
          <div className="roc-field" key={`${statement.kind}-${index}`}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="roc-label">{STATEMENT_LABELS[statement.kind] || statement.kind}</span>
              <button className="roc-btn-link" onClick={() => onChange({ ...data, statements: data.statements.filter((_, i) => i !== index) })}>Remove</button>
            </div>
            <BufferedTextarea className="roc-textarea" value={statement.text} onCommit={(text) => setStatement(index, text)} />
          </div>
        ))}
      </FormSection>

      <FormSection title="Inline Results (optional)">
        <span className="roc-label">One row per line: label | value | label 2 | value 2</span>
        <BufferedTextarea
          className="roc-textarea roc-input-mono"
          value={(data.inline_results || []).map((row) => row.slice(0, 4).join(" | ")).join("\n")}
          onCommit={setInlineResults}
          placeholder={"RTPW (Ω) | 25.49687\na4 | -0.000173 | b4 | +0.000121"}
        />
      </FormSection>

      <FormSection title="Measurement Data Tables (page 2)" action={<button className="roc-btn-link" onClick={() => onChange({ ...data, tables: [...data.tables, { title: "", intro_text: "", columns: [{ header: "", unit: "" }], rows: [[""]] }] })}>+ Add Table</button>}>
        {data.tables.length === 0 && <p className="roc-subtitle">No tables — this ROC will have only a front page.</p>}
        <div style={{ display: "grid", gap: 12 }}>
          {data.tables.map((table, index) => <TableEditor key={index} table={table} index={index} onChange={setTable} onRemove={(tableIndex) => onChange({ ...data, tables: data.tables.filter((_, i) => i !== tableIndex) })} />)}
        </div>
      </FormSection>
    </div>
  );
}
