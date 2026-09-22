import React, { useEffect, useRef, useState } from "react";

export default function PointColumnMenu({ sections, columns, setColumns, selectedGroups, moveGroup, onReset, onSetDefault }) {
  const menuRef = useRef(null);
  const draggedKey = useRef(null);
  const pointerCleanup = useRef(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const toggle = (keys, visible) => setColumns(previous => ({ ...previous, ...Object.fromEntries(keys.map(key => [key, visible])) }));
  const finishDrag = () => { draggedKey.current = null; setDragging(null); setDropTarget(null); };
  useEffect(() => () => pointerCleanup.current?.(), []);
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
  // Pointer dragging keeps the original row in place and avoids the browser's
  // floating drag snapshot. Only a boundary marker moves; order changes on drop.
  // The existing keyboard arrow behavior remains available without a mouse.
  const startPointerDrag = (event, key) => {
    if (event.button !== 0 || (event.target.closest('button') && event.target.closest('button') !== event.currentTarget)) return;
    pointerCleanup.current?.();
    const startY = event.clientY, startX = event.clientX;
    let moved = false, destination = null;
    const move = next => {
      if (!moved && Math.hypot(next.clientX - startX, next.clientY - startY) < 4) return;
      next.preventDefault();
      if (!moved) {
        moved = true;
        draggedKey.current = key;
        setDragging(key);
        document.body.classList.add('point-columns-dragging');
      }
      const row = document.elementFromPoint(next.clientX, next.clientY)?.closest('[data-column-key]');
      destination = row && menuRef.current?.contains(row) ? { key: row.dataset.columnKey,
        position: next.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2 ? 'before' : 'after' } : null;
      // Pointer moves within one insertion zone should not repaint the menu.
      // CSS also suspends hover fills/buttons until release; only the boundary
      // marker changes as the pointer crosses a different insertion zone.
      setDropTarget(previous => previous?.key === destination?.key && previous?.position === destination?.position ? previous : destination);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape);
      document.body.classList.remove('point-columns-dragging');
      pointerCleanup.current = null;
    };
    const cancel = () => { cleanup(); finishDrag(); };
    const escape = next => { if (next.key === 'Escape') { next.preventDefault(); cancel(); } };
    const up = () => {
      suppressClick.current = moved;
      if (moved && destination && destination.key !== key) {
        const added = allColumns.find(col => col.key === key);
        const newKeys = !selectedGroups.some(group => group.key === key) && added ? added.keys || [added.key] : undefined;
        if (newKeys) toggle(newKeys, true);
        moveGroup(key, destination.key, newKeys, destination.position);
      }
      cancel();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape);
    pointerCleanup.current = cleanup;
  };
  const available = sections.map(section => ({ ...section, cols: section.cols.filter(col => !(col.keys || [col.key]).every(key => columns[key])) })).filter(section => section.cols.length);
  return <div ref={menuRef} className="point-column-menu-body">
    <div className="point-column-menu-actions">
      <button type="button" onClick={() => { finishDrag(); onReset(); }}>Reset Columns</button>
      <button type="button" onClick={onSetDefault}>Set as Default</button>
    </div>
    <div className="point-column-lists">
    <section className="point-column-selected">
      <div className="sidebar-column-order-heading"><strong>Displayed columns</strong></div>
      <div className="sidebar-column-order-list" onDragOver={event => { if (draggedKey.current) event.preventDefault(); }} onDrop={event => dropColumn(event, null)}>
        {selectedGroups.map((group, index) => <React.Fragment key={group.key}>
          {(index === 0 || sections.find(section => section.cols.some(col => (col.keys || [col.key]).includes(selectedGroups[index-1].key)))?.group !== sections.find(section => section.cols.some(col => (col.keys || [col.key]).includes(group.key)))?.group) &&
            <div className="filter-option-group-title">{sections.find(section => section.cols.some(col => (col.keys || [col.key]).includes(group.key)))?.group}</div>}
          <div
          className={`point-column-order-row${dragging === group.key ? " is-dragging" : ""}${(dropTarget?.key || dropTarget) === group.key && dragging !== group.key ? ` is-drop-target drop-${dropTarget?.position || "before"}` : ""}`}
          data-column-key={group.key} onPointerDown={event => startPointerDrag(event, group.key)}
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
          {section.cols.map(col => <button type="button" className={`point-column-add${dragging === col.key ? " is-dragging" : ""}`} key={col.key} aria-label={`Add ${col.label} column`}
            onPointerDown={event => { suppressClick.current = false; startPointerDrag(event, col.key); }}
            onDragStart={event => beginDrag(event, col.key)} onDragEnd={finishDrag}
            onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } toggle(col.keys || [col.key], true); }}><span>{col.label}</span><span aria-hidden="true">+</span></button>)}
        </section>)}
      </div>
    </section>
    </div>
  </div>;
}
