import SymbolButton from "../../../../components/common/SymbolButton";
import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { measurementAreaAccent } from "../../../../utils/measurementAreaColors";
import InstrumentRow from "./InstrumentRow";
import "./inlineTable.css";

/**
 * Inline-editable UUT/TMDE table. Renders a flat list of rows OR, when
 * `areas` is supplied, groups rows into measurement-area subsections with a
 * clickable color dot and a per-area (+). The same component backs both the
 * Session Overview (grouped) and the measurement-point view (flat).
 *
 * Controlled: each row reports edits via onChangeItem(id, updaterFn).
 */
const InstrumentTable = ({
  items = [],
  role = "uut",
  areas = null, // [{id,name,color}] → grouped mode; null → flat
  referencePoint,
  libraryResultsFor, // (id) => results[]
  onSearch,
  onPickLibrary,
  onChangeItem,
  onDeleteItem,
  onAddItem, // (areaId|null) => void
  onSyncClick,
  onAreaColorClick,
}) => {
  const header = (
    <thead>
      <tr>
        <th>Description (mfr. / model / name)</th>
        <th>Asset ID</th>
        <th>Tolerance</th>
        <th>Distribution</th>
        <th>Qty</th>
        <th style={{ width: 40 }}></th>
        <th style={{ width: 40 }}></th>
      </tr>
    </thead>
  );

  const renderRows = (rows, areaColor) =>
    rows.map((it) => (
      <InstrumentRow
        key={it.id}
        item={it}
        role={role}
        areaColor={areaColor}
        referencePoint={referencePoint}
        libraryResults={libraryResultsFor?.(it.id) || []}
        onSearch={(q) => onSearch?.(it.id, q)}
        onPickLibrary={(inst) => onPickLibrary?.(it.id, inst)}
        onChange={(updater) => onChangeItem?.(it.id, updater)}
        onDelete={() => onDeleteItem?.(it.id)}
        onSyncClick={onSyncClick}
      />
    ));

  // --- Flat mode ---
  if (!areas) {
    return (
      <div>
        <table className="inline-instr-table">
          {header}
          <tbody>{renderRows(items)}</tbody>
        </table>
        <button className="inline-area-add" style={{ marginTop: 8 }} onClick={() => onAddItem?.(null)}>
          <FontAwesomeIcon icon={faPlus} /> Add {role.toUpperCase()}
        </button>
      </div>
    );
  }

  // --- Grouped-by-area mode ---
  const byArea = new Map(areas.map((a) => [a.id, []]));
  const unassigned = [];
  items.forEach((it) => {
    if (it.measurementAreaId && byArea.has(it.measurementAreaId)) {
      byArea.get(it.measurementAreaId).push(it);
    } else {
      unassigned.push(it);
    }
  });

  const sections = [
    ...areas.map((a) => ({ area: a, rows: byArea.get(a.id) })),
    ...(unassigned.length
      ? [{ area: { id: null, name: "Unassigned", color: "var(--text-color-muted)" }, rows: unassigned }]
      : []),
  ];

  return (
    <div>
      {sections.map(({ area, rows }) => (
        <div key={area.id || "unassigned"} className="inline-area-section">
          <div className="inline-area-header" style={{ color: measurementAreaAccent(area.color) }}>
            <span
              className="inline-area-dot"
              style={{ backgroundColor: measurementAreaAccent(area.color) }}
              title="Change area color"
              onClick={() => area.id && onAreaColorClick?.(area)}
            />
            <span>{area.name}</span>
            {area.id && (
              <SymbolButton add className="inline-area-add" onClick={() => onAddItem?.(area.id)} title={`Add ${role.toUpperCase()} to ${area.name}`} />
            )}
          </div>
          <table className="inline-instr-table">
            {header}
            <tbody>{renderRows(rows, area.color)}</tbody>
          </table>
        </div>
      ))}
    </div>
  );
};

export default InstrumentTable;
