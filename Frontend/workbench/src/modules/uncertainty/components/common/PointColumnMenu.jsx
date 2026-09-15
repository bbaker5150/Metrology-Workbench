import React, { useRef, useState } from "react";

export default function PointColumnMenu({ sections, columns, setColumns, selectedGroups, moveGroup, onReset }) {
  const draggedKey = useRef(null);
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const toggle = (keys, visible) => setColumns(previous => ({ ...previous, ...Object.fromEntries(keys.map(key => [key, visible])) }));
  const finishDrag = () => { draggedKey.current = null; setDragging(null); setDropTarget(null); };
  const available = sections.map(section => ({ ...section, cols: section.cols.filter(col => !(col.keys || [col.key]).every(key => columns[key])) })).filter(section => section.cols.length);
  return <div className="point-column-menu-body">
    <section className="point-column-selected">
      <div className="sidebar-column-order-heading"><strong>Displayed columns</strong><button type="button" onClick={() => { finishDrag(); onReset(); }}>Reset</button></div>
      <div className="sidebar-column-order-list">
        {selectedGroups.map((group, index) => <div key={group.key}
          className={`point-column-order-row${dragging === group.key ? " is-dragging" : ""}${dropTarget === group.key && dragging !== group.key ? " is-drop-target" : ""}`} draggable
          tabIndex={0} aria-label={`Move ${group.label}`} title="Drag to arrange; use arrow keys when focused"
          onDragStart={event => {
            event.stopPropagation(); draggedKey.current = group.key;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-uncertalytics-column", group.key);
            event.dataTransfer.setData("text/plain", group.key);
            setDragging(group.key);
          }}
          onDragOver={event => { if (!draggedKey.current) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; setDropTarget(group.key); }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); }}
          onDragEnd={finishDrag}
          onDrop={event => {
            event.preventDefault(); event.stopPropagation();
            const source = draggedKey.current || event.dataTransfer.getData("application/x-uncertalytics-column");
            if (selectedGroups.some(item => item.key === source)) moveGroup(source, group.key);
            finishDrag();
          }}
          onKeyDown={event => { if (event.target !== event.currentTarget || !["ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const other = selectedGroups[index + (event.key === "ArrowUp" ? -1 : 1)]; if (other) moveGroup(group.key, other.key); }}>
          <span>{group.label}</span><button type="button" className="point-column-remove" aria-label={`Hide ${group.label}`} title={`Hide ${group.label}`}
            onPointerDown={event => event.stopPropagation()} onClick={() => toggle(group.keys, false)}>×</button>
        </div>)}
      </div>
    </section>
    <section className="point-column-available" aria-label="Add Columns">
      <div className="sidebar-column-order-heading"><strong>Add Columns</strong></div>
      <div className="sidebar-filter-sections">
        {available.map(section => <section className="filter-option-group" key={section.group}>
          <div className="filter-option-group-title">{section.group}</div>
          {section.cols.map(col => <button type="button" className="point-column-add" key={col.key} aria-label={`Add ${col.label} column`}
            onClick={() => toggle(col.keys || [col.key], true)}><span>{col.label}</span><span aria-hidden="true">+</span></button>)}
        </section>)}
      </div>
    </section>
    <button type="button" className="point-column-indicators" aria-pressed={columns.warningIcons !== false}
      onClick={() => toggle(["warningIcons"], columns.warningIcons === false)}><span>Point indicators</span><span aria-hidden="true">{columns.warningIcons !== false ? "−" : "+"}</span></button>
  </div>;
}
