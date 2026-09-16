import React, { useRef, useState } from "react";

export default function PointColumnMenu({ sections, columns, setColumns, selectedGroups, moveGroup, onReset }) {
  const draggedKey = useRef(null);
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const toggle = (keys, visible) => setColumns(previous => ({ ...previous, ...Object.fromEntries(keys.map(key => [key, visible])) }));
  const finishDrag = () => { draggedKey.current = null; setDragging(null); setDropTarget(null); };
  const allColumns = sections.flatMap(section => section.cols);
  const dropColumn = (event, target) => {
    event.preventDefault(); event.stopPropagation();
    const source = draggedKey.current || event.dataTransfer.getData("application/x-uncertalytics-column");
    const added = allColumns.find(col => col.key === source);
    if (!selectedGroups.some(group => group.key === source) && added) toggle(added.keys || [added.key], true);
    if (target && source !== target) {
      if (added && !selectedGroups.some(group => group.key === source)) moveGroup(source, target, added.keys || [added.key]);
      else moveGroup(source, target);
    }
    finishDrag();
  };
  const beginDrag = (event, key) => {
    event.stopPropagation(); draggedKey.current = key;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-uncertalytics-column", key);
    event.dataTransfer.setData("text/plain", key);
    setDragging(key);
  };
  const available = sections.map(section => ({ ...section, cols: section.cols.filter(col => !(col.keys || [col.key]).every(key => columns[key])) })).filter(section => section.cols.length);
  return <div className="point-column-menu-body">
    <button type="button" className="point-column-reset" onClick={() => { finishDrag(); onReset(); }}>Reset</button>
    <section className="point-column-selected">
      <div className="sidebar-column-order-heading"><strong>Displayed columns</strong></div>
      <div className="sidebar-column-order-list" onDragOver={event => { if (draggedKey.current) event.preventDefault(); }} onDrop={event => dropColumn(event, null)}>
        {selectedGroups.map((group, index) => <React.Fragment key={group.key}>
          {(index === 0 || sections.find(section => section.cols.some(col => (col.keys || [col.key]).includes(selectedGroups[index-1].key)))?.group !== sections.find(section => section.cols.some(col => (col.keys || [col.key]).includes(group.key)))?.group) &&
            <div className="filter-option-group-title">{sections.find(section => section.cols.some(col => (col.keys || [col.key]).includes(group.key)))?.group}</div>}
          <div
          className={`point-column-order-row${dragging === group.key ? " is-dragging" : ""}${dropTarget === group.key && dragging !== group.key ? " is-drop-target" : ""}`} draggable
          tabIndex={0} aria-label={`Move ${group.label}`} title="Drag to arrange; use arrow keys when focused"
          onDragStart={event => beginDrag(event, group.key)}
          onDragOver={event => { if (!draggedKey.current) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; setDropTarget(group.key); }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); }}
          onDragEnd={finishDrag}
          onDrop={event => dropColumn(event, group.key)}
          onKeyDown={event => { if (event.target !== event.currentTarget || !["ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const other = selectedGroups[index + (event.key === "ArrowUp" ? -1 : 1)]; if (other) moveGroup(group.key, other.key); }}>
          <span>{group.label}</span><button type="button" className="point-column-remove" aria-label={`Hide ${group.label}`} title={`Hide ${group.label}`}
            onPointerDown={event => event.stopPropagation()} onClick={() => toggle(group.keys, false)}>×</button>
        </div></React.Fragment>)}
      </div>
    </section>
    <section className="point-column-available" aria-label="Add Columns">
      <div className="sidebar-column-order-heading"><strong>Add Columns</strong></div>
      <div className="sidebar-filter-sections">
        {available.map(section => <section className="filter-option-group" key={section.group}>
          <div className="filter-option-group-title">{section.group}</div>
          {section.cols.map(col => <button type="button" className="point-column-add" key={col.key} aria-label={`Add ${col.label} column`}
            draggable onDragStart={event => beginDrag(event, col.key)} onDragEnd={finishDrag}
            onClick={() => toggle(col.keys || [col.key], true)}><span>{col.label}</span><span aria-hidden="true">+</span></button>)}
        </section>)}
      </div>
    </section>
    <button type="button" className="point-column-indicators" aria-pressed={columns.warningIcons !== false}
      onClick={() => toggle(["warningIcons"], columns.warningIcons === false)}><span>Point indicators</span><span aria-hidden="true">{columns.warningIcons !== false ? "−" : "+"}</span></button>

  </div>;
}
