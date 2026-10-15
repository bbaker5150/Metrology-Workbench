import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSearch, faTools, faPlus, faTimes, faBookOpen } from "@fortawesome/free-solid-svg-icons";
import { LIBRARY_INSTRUMENT_MIME } from "../../../utils/libraryInstrumentDrag";
import UncertaintyPanel from "../../analysis/components/UncertaintyPanel";
import NotificationModal from "../../../components/modals/NotificationModal";
import { useFloatingWindow } from "../../../hooks/useFloatingWindow";
import { instrumentMatchesSearch } from "../../../utils/functionGrouping";
import { formatInstrumentIdentity } from "../../../utils/instrumentIdentity";
import { useConfirmRecordDeletes } from "../../../contexts/RecordDeletePolicy";
import { journalSession, acknowledgeSession } from "../../../utils/sessionRecovery";
import "./InstrumentLibraryModal.css";

const libraryEntries = instruments => instruments.filter(item => item.scope !== "session");
const rowFor = instrument => ({ id: instrument.id, name: instrument.description || "", nickname: instrument.nickname || "", instrument,
  customFields: instrument.customFields, rangeCustomFields: instrument.rangeCustomFields });
const definitionFor = row => ({ ...row.instrument, description: row.name || "", nickname: row.nickname || "",
  ...(row.ranges ? { ranges: row.ranges } : {}),
  ...(row.customFields ? { customFields: row.customFields } : {}),
  ...(row.rangeCustomFields ? { rangeCustomFields: row.rangeCustomFields } : {}),
});
const initialSession = instruments => ({ id: "instrument-library", tmdes: libraryEntries(instruments).map(rowFor), uuts: [], testPoints: [], measurementAreas: [], measurementAreaGroups: [] });
const libraryPoint = { id: "instrument-library", viewMode: "session" };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// Document, checklist and gear match the specifications control reference.
const InstrumentSpecificationsIcon = () => <svg viewBox="0 0 32 32" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <path d="M17 4h7l5 5v21H9V17M24 4v6h5M20 17h5M20 22h5M20 27h5M12 17l1.5 1.5L16 16M12 22l1.5 1.5L16 21M12 27l1.5 1.5L16 26" />
  <path d="m8 2 3-.1.5 2 1.5.7 1.8-1 2 2-1 1.8.7 1.6 2 .5v2.8l-2 .5-.7 1.6 1 1.8-2 2-1.8-1-1.5.7-.5 2H8l-.5-2-1.6-.7-1.8 1-2-2 1-1.8-.7-1.6-2-.5V8.6l2-.5.7-1.6-1-1.8 2-2 1.8 1 1.6-.7Z" transform="translate(2 1) scale(.8)" />
  <circle cx="9.6" cy="9" r="2.6" />
</svg>;

// The library is an adapter around the actual overview instrument table. Range
// rendering, editors, selection, clipboard and creation all stay in that table.
export default function InstrumentLibraryModal({ isOpen, onClose, instruments = [], onSaveToLibrary, onDelete, onInstrumentSynced, zoom = 1 }) {
  const dragSelection = useRef(null);
  const [session, setSession] = useState(() => initialSession(instruments));
  const current = useRef(session);
  const [selection, setSelection] = useState([]);
  const [expandedIds, setExpandedIds] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [query, setQuery] = useState("");
  const [notification, setNotification] = useState(null);
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState("");
  const queue = useRef(Promise.resolve());
  const latestQueuedEdit = useRef(new Map());
  const failed = useRef(new Map());
  const lastLibrary = useRef(instruments);
  const confirmDeletes = useConfirmRecordDeletes();
  const windowRef = useRef(null);
  const hasOpened = useRef(false);
  const { position, setPosition, handleMouseDown } = useFloatingWindow({ isOpen, defaultWidth: 560, defaultHeight: 440, retainPosition: true });
  useLayoutEffect(() => {
    if (!isOpen) return;
    const collapse = event => {
      if (event.key !== "Escape" || document.querySelector('[role="alertdialog"]')) return;
      const active = document.activeElement;
      if (windowRef.current?.contains(active)) active.blur?.();
      setExpandedIds([]);
    };
    window.addEventListener("keydown", collapse, true);
    return () => window.removeEventListener("keydown", collapse, true);
  }, [isOpen]);
  useLayoutEffect(() => {
    if (!isOpen || !windowRef.current || hasOpened.current) return;
    hasOpened.current = true;
    const rect = windowRef.current.getBoundingClientRect();
    setPosition({ x: Math.max(16, (window.innerWidth - rect.width) / 2), y: Math.max(16, (window.innerHeight - rect.height) / 2) });
  }, [isOpen, setPosition]);
  useLayoutEffect(() => {
    if (!isOpen || !windowRef.current || typeof ResizeObserver === "undefined") return;
    const keepVisible = () => {
      const rect = windowRef.current.getBoundingClientRect();
      const scroller = windowRef.current.querySelector('.instrument-table-scroll');
      if (scroller) {
        const gutter = (scroller.offsetWidth - scroller.clientWidth) / 2;
        windowRef.current.style.setProperty('--instrument-library-bottom-gap', `${gutter}px`);
      }
      setPosition(previous => {
        const x = Math.max(16, Math.min(previous.x, window.innerWidth - rect.width - 16));
        const y = Math.max(16, Math.min(previous.y, window.innerHeight - rect.height - 16));
        return x === previous.x && y === previous.y ? previous : { x, y };
      });
    };
    const observer = new ResizeObserver(keepVisible);
    observer.observe(windowRef.current);
    window.addEventListener("resize", keepVisible);
    return () => { observer.disconnect(); window.removeEventListener("resize", keepVisible); };
  }, [isOpen, setPosition, zoom]);
  const replace = next => { current.current = next; setSession(next); };
  useEffect(() => {
    if (saving || error || lastLibrary.current === instruments) return;
    lastLibrary.current = instruments;
    // Keep row identities while a shared edit becomes a new local definition.
    const old = new Map(current.current.tmdes.map(row => [String(row.instrument.id), row]));
    const entries = libraryEntries(instruments);
    const ids = new Set(entries.map(item => String(item.id)));
    replace({ ...current.current, tmdes: entries.map(instrument => {
      const prior = old.get(String(instrument.id));
      const collision = prior && ids.has(String(prior.id)) && String(prior.id) !== String(instrument.id);
      return { ...rowFor(instrument), id: !collision && prior?.id || instrument.id };
    }) });
  }, [instruments, saving, error]);
  const enqueue = definition => {
    const token = journalSession("libraryEdits", String(definition.id), { instrument: definition });
    latestQueuedEdit.current.set(definition.id, token);
    setSaving(count => count + 1);
    queue.current = queue.current.then(async () => {
      try {
        // Coalesce typing that is still queued behind a slower network save.
        if (latestQueuedEdit.current.get(definition.id) !== token) return;
        await onSaveToLibrary(definition, { requireSaved: true });
        acknowledgeSession("libraryEdits", String(definition.id), token);
        failed.current.delete(definition.id);
        if (!failed.current.size) setError("");
      } catch (failure) {
        failed.current.set(definition.id, definition);
        setError(failure.message || "Could not save changes.");
      } finally { setSaving(count => count - 1); }
    });
  };
  const updateSession = next => {
    const previous = new Map(current.current.tmdes.map(row => [row.id, row]));
    replace({ ...next, tmdes: next.tmdes.filter(row => row.instrument?.scope !== "session") });
    for (const row of next.tmdes) {
      if (["session", "validated", "shared"].includes(row.instrument?.scope)) continue;
      const old = previous.get(row.id);
      if (old === row) continue;
      const definition = definitionFor(row);
      if (!old || JSON.stringify(definitionFor(old)) !== JSON.stringify(definition)) enqueue(definition);
    }
  };
  const visibleIds = useMemo(() => session.tmdes.map(row => ({ row, instrument: definitionFor(row) }))
    .filter(({ instrument }) => !query || instrumentMatchesSearch(instrument, query))
    .sort((a, b) => collator.compare(a.instrument.description || "", b.instrument.description || ""))
    .map(({ row }) => row.id), [session.tmdes, query]);
  useEffect(() => {
    const visible = new Set(visibleIds);
    setSelection(previous => {
      const next = previous.filter(id => visible.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [visibleIds]);
  useEffect(() => {
    const visible = new Set(visibleIds);
    setExpandedIds(previous => {
      const next = previous.filter(id => visible.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [visibleIds]);
  useEffect(() => {
    if (!isOpen || (!selection.length && !expandedIds.length)) return;
    const collapseOutsideLibrary = event => {
      // Keep header dragging, table edits and portaled controls inside the
      // library interaction. Wait until click so blur-driven saves finish first.
      if (windowRef.current?.contains(event.target) || event.target.closest?.("[data-theme-toggle], [data-library-toggle]")) return;
      if (event.target.closest?.(".inline-unit-menu, .inline-tolerance-shape-menu, .inline-tolerance-shape-backdrop, .inline-desc-search, .modal-overlay, [role='alertdialog'], [role='dialog']:not(.instrument-library-window)")) return;
      const active = document.activeElement;
      if (windowRef.current?.contains(active)) active.blur?.();
      setExpandedIds([]);
      setSelection([]);
    };
    document.addEventListener("click", collapseOutsideLibrary, true);
    return () => document.removeEventListener("click", collapseOutsideLibrary, true);
  }, [isOpen, selection.length, expandedIds.length]);
  const remove = async ids => {
    const rows = current.current.tmdes.filter(row => ids.includes(row.id));
    const perform = async () => {
      try {
        // Complete queued edits before removing records so a late save cannot
        // recreate an archived instrument.
        await queue.current;
        for (const row of rows) {
          await onDelete(row.instrument.id);
          failed.current.delete(row.instrument.id);
          replace({ ...current.current, tmdes: current.current.tmdes.filter(item => item.id !== row.id) });
        }
        setSelection(previous => previous.filter(id => !ids.includes(id)));
        if (!failed.current.size) setError("");
      } catch (failure) { setNotification({ title: "Could not remove instrument", message: failure.message || "Please try again." }); }
    };
    if (confirmDeletes) setNotification({ title: "Remove instruments", message: `Remove ${rows.length} selected instrument${rows.length === 1 ? "" : "s"} from the library?`, confirmText: "Remove", onConfirm: () => { setNotification(null); return perform(); } });
    else await perform();
  };
  const close = () => {
    if (saving || failed.current.size) { setNotification({ title: "Changes have not been saved", message: saving ? "Wait for saving to finish before closing the library." : "Retry the failed save before closing the library." }); return; }
    onClose();
  };
  const startLibraryDrag = (event, id) => {
    event.stopPropagation();
    const ids = dragSelection.current?.id === id ? dragSelection.current.ids : selection.includes(id) ? selection : [id];
    dragSelection.current = null;
    const rows = current.current.tmdes.filter(row => ids.includes(row.id));
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(LIBRARY_INSTRUMENT_MIME, JSON.stringify(rows.map(definitionFor)));
    event.dataTransfer.setData("application/x-workbench-instruments", JSON.stringify({ source: "library", mode: "copy", items: rows.map(item => ({ kind: "tmde", item })) }));
  };
  // Keep the table mounted while minimized so its editors, selection and
  // scroll position survive reopening along with the floating position.
  if (!isOpen && !hasOpened.current) return null;
  return ReactDOM.createPortal(<div ref={windowRef} className={`uncertainty-module instrument-library-window modal-content floating-window-content${!expandedIds.length ? " is-names-only" : ""}`} role="dialog" aria-label="Instrument library"
    onPointerDownCapture={event => {
      const id = event.target.closest?.('tr[data-instrument-id]')?.dataset.instrumentId;
      const row = current.current.tmdes.find(item => String(item.id) === id);
      if (row) {
        // Commit a header edit to its original instrument before changing owner.
        const active = document.activeElement;
        if (windowRef.current?.contains(active) && active.matches?.(".instrument-custom-column-name-input")) active.blur();
        setActiveId(row.id);
      }
      dragSelection.current = row ? { id: row.id, ids: selection.includes(row.id) ? [...selection] : [row.id] } : null;
    }}
    data-scoped-zoom-key="instrument-library" data-zoom-level={zoom} hidden={!isOpen} inert={!isOpen}
    style={{ display: isOpen ? undefined : 'none', left: position.x, top: position.y, '--instrument-library-scale': zoom }}>
    <div className="scoped-zoom-content instrument-library-content" style={{ zoom }}>
    {error && <div className="instrument-library-save-error"><span role="alert">{error}</span><button onClick={() => [...failed.current.values()].forEach(enqueue)}>Retry save</button></div>}
    <UncertaintyPanel libraryMode testPointData={libraryPoint} sessionData={session}
      libraryExpandedIds={expandedIds} libraryActiveId={activeId} onLibraryExpand={id => { setActiveId(id); setExpandedIds(previous => previous.includes(id) ? previous : [...previous, id]); }}
      libraryRenderSpecifications={id => {
        const expanded = expandedIds.includes(id);
        const row = session.tmdes.find(item => item.id === id);
        const name = formatInstrumentIdentity(row, "Untitled instrument");
        const label = expanded ? "Hide Instrument Specifications" : "View or Edit Instrument Specifications";
        return <button type="button" className="icon-btn-ghost instrument-library-specifications" title={label} aria-label={`${label} ${name}`} aria-expanded={expanded}
          onClick={event => {
            event.stopPropagation(); document.activeElement?.blur?.();
            setActiveId(id);
            if (!selection.includes(id)) setSelection([id]);
            setExpandedIds(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
          }}><InstrumentSpecificationsIcon /></button>;
      }}
      onLibraryDragStart={startLibraryDrag}
      libraryVisibleIds={visibleIds} onSessionSave={updateSession} instruments={instruments}
      onSaveInstrument={onSaveToLibrary} onDeleteLibraryInstrument={onDelete} onInstrumentSynced={onInstrumentSynced}
      setNotification={setNotification} currentTmdeSelection={selection} setCurrentTmdeSelection={setSelection}
      onDeleteTmdeDefinition={remove} keyboardShortcutsEnabled={isOpen}
      libraryToolbar={add => <div className="panel-card-header instrument-panel-card-header instrument-library-header" onMouseDown={event => {
        // Keep the focused draft and editor geometry intact throughout a drag.
        if (!event.target.closest("button, input, .no-drag")) event.preventDefault();
        handleMouseDown(event);
      }}>
        <div className="panel-card-title" role="heading" aria-level={3}><FontAwesomeIcon icon={faBookOpen} /><span>Instrument Library</span></div>
        <div className="panel-card-actions">
        <div className="instrument-library-search">
          <FontAwesomeIcon icon={faSearch} />
          <input aria-label="Search instruments" placeholder="Search instruments" value={query} onChange={event => setQuery(event.target.value)} />
          {query && <button aria-label="Clear instrument search" onClick={() => setQuery("")}><FontAwesomeIcon icon={faTimes} /></button>}
          <button type="button" className="btn-add-item btn-add-column function-header-action-btn" aria-label="Add instrument" title="Add instrument" onClick={() => { setQuery(""); add(); }}><FontAwesomeIcon icon={faPlus} /><FontAwesomeIcon icon={faTools} /></button>
        </div>
        <button className="icon-btn-ghost" aria-label="Close instrument library" onClick={close}><FontAwesomeIcon icon={faTimes} /></button>
        </div>
      </div>} />
    </div>
    <NotificationModal {...notification} isOpen={!!notification} onClose={() => setNotification(null)} />
  </div>, document.body);
}
