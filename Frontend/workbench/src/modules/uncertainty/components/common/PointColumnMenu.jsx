import React from "react";

export default function PointColumnMenu({ sections, columns, setColumns, selectedGroups, moveGroup, onReset, onClose }) {
  const toggle = (keys, visible) => setColumns(previous => ({ ...previous, ...Object.fromEntries(keys.map(key => [key, visible])) }));
  return <>
    <header className="sidebar-filter-header"><div><strong>Columns</strong><p>Choose columns and arrange their order.</p></div><button type="button" aria-label="Close columns menu" onClick={onClose}>×</button></header>
    <div className="point-column-menu-body">
      <section className="point-column-selected">
        <div className="sidebar-column-order-heading"><strong>Displayed columns</strong><button type="button" onClick={onReset}>Reset order</button></div>
        <div className="sidebar-column-order-list">
          {selectedGroups.map((group, index) => <div key={group.key} className="point-column-order-row" draggable
            tabIndex={0} aria-label={`Move ${group.label}`} title="Drag to arrange; use arrow keys when focused"
            onDragStart={event => event.dataTransfer.setData("text/plain", group.key)}
            onDragOver={event => event.preventDefault()}
            onDrop={event => { event.preventDefault(); moveGroup(event.dataTransfer.getData("text/plain"), group.key); }}
            onKeyDown={event => { if (event.target !== event.currentTarget || !["ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); const other = selectedGroups[index + (event.key === "ArrowUp" ? -1 : 1)]; if (other) moveGroup(group.key, other.key); }}>
            <span>{group.label}</span><button type="button" aria-label={`Hide ${group.label}`} title={`Hide ${group.label}`}
              onClick={() => toggle(group.keys, false)}>×</button>
          </div>)}
        </div>
      </section>
      <div className="sidebar-filter-sections">
        {sections.map(section => {
          const keys = section.cols.flatMap(col => col.keys || [col.key]);
          const checked = keys.every(key => columns[key]);
          const mixed = !checked && keys.some(key => columns[key]);
          return <section className="filter-option-group" key={section.group}>
            <label className="filter-option-group-title"><input type="checkbox" checked={checked} aria-label={`Toggle all ${section.group} columns`}
              ref={input => { if (input) input.indeterminate = mixed; }} onChange={event => toggle(keys, event.target.checked)} /><span>{section.group}</span></label>
            {section.cols.map(col => <label className="filter-option" key={col.key}><input type="checkbox"
              checked={(col.keys || [col.key]).every(key => columns[key])}
              onChange={event => toggle(col.keys || [col.key], event.target.checked)} /><span>{col.label}</span></label>)}
          </section>;
        })}
        <label className="filter-option"><input type="checkbox" checked={columns.warningIcons !== false} onChange={event => toggle(["warningIcons"], event.target.checked)} /><span>Point indicators</span></label>
      </div>
    </div>
  </>;
}
