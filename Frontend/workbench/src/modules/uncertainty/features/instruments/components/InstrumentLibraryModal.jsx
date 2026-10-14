import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSearch, faSliders, faPlus, faTimes, faBookOpen } from "@fortawesome/free-solid-svg-icons";
import { LIBRARY_INSTRUMENT_MIME } from "../../../utils/libraryInstrumentDrag";
import UncertaintyPanel from "../../analysis/components/UncertaintyPanel";
import NotificationModal from "../../../components/modals/NotificationModal";
import { useFloatingWindow } from "../../../hooks/useFloatingWindow";
import { instrumentMatchesSearch } from "../../../utils/functionGrouping";
import { useConfirmRecordDeletes } from "../../../contexts/RecordDeletePolicy";
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

// The library is an adapter around the actual overview instrument table. Range
// rendering, editors, selection, clipboard and creation all stay in that table.
export default function InstrumentLibraryModal({ isOpen, onClose, instruments = [], onSaveToLibrary, onDelete, onInstrumentSynced }) {
  const [session, setSession] = useState(() => initialSession(instruments));
  const current = useRef(session);
  const [selection, setSelection] = useState([]);
  const [expandedIds, setExpandedIds] = useState([]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [notification, setNotification] = useState(null);
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState("");
  const queue = useRef(Promise.resolve());
  const failed = useRef(new Map());
  const lastLibrary = useRef(instruments);
  const confirmDeletes = useConfirmRecordDeletes();
  const windowRef = useRef(null);
  const filterRef = useRef(null);
  const filterMenuRef = useRef(null);
  const { position, setPosition, handleMouseDown } = useFloatingWindow({ isOpen, defaultWidth: 560, defaultHeight: 440 });
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
    if (!isOpen || !windowRef.current) return;
    const rect = windowRef.current.getBoundingClientRect();
    setPosition({ x: Math.max(16, (window.innerWidth - rect.width) / 2), y: Math.max(16, (window.innerHeight - rect.height) / 2) });
  }, [isOpen, setPosition]);
  useLayoutEffect(() => {
    if (!isOpen || !windowRef.current || typeof ResizeObserver === "undefined") return;
    const keepVisible = () => {
      const rect = windowRef.current.getBoundingClientRect();
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
  }, [isOpen, setPosition]);
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
    setSaving(count => count + 1);
    queue.current = queue.current.then(async () => {
      try {
        await onSaveToLibrary(definition, { requireSaved: true });
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
  const visibleIds = useMemo(() => session.tmdes.map(row => ({ row, instrument: definitionFor(row) })).filter(({ instrument }) => {
    return (!query || instrumentMatchesSearch(instrument, query)) && (source === "all" ||
      (source === "shared" ? ["shared", "validated"].includes(instrument.scope) : !["shared", "validated"].includes(instrument.scope)));
  }).sort((a, b) => collator.compare(a.instrument.description || "", b.instrument.description || "")).map(({ row }) => row.id), [session.tmdes, query, source]);
  useLayoutEffect(() => {
    if (!optionsOpen) return;
    const menu = filterMenuRef.current;
    menu.showPopover?.();
    const positionMenu = () => {
      const anchor = filterRef.current.getBoundingClientRect();
      const width = menu.offsetWidth, height = menu.offsetHeight;
      menu.style.left = `${Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - height - 8))}px`;
    };
    positionMenu();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(positionMenu);
    observer?.observe(windowRef.current);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => { observer?.disconnect(); window.removeEventListener('resize', positionMenu); window.removeEventListener('scroll', positionMenu, true); };
  }, [optionsOpen, position.x, position.y]);
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
      const next = isOpen ? previous.filter(id => visible.has(id)) : [];
      return next.length === previous.length ? previous : next;
    });
  }, [isOpen, visibleIds]);
  useEffect(() => {
    if (!optionsOpen) return;
    const dismiss = event => { if (!event.target.closest?.(".instrument-library-search")) setOptionsOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [optionsOpen]);
  useEffect(() => {
    if (!isOpen || (!selection.length && !expandedIds.length)) return;
    const collapseOutsideLibrary = event => {
      // Keep header dragging, table edits and portaled controls inside the
      // library interaction. Wait until click so blur-driven saves finish first.
      if (windowRef.current?.contains(event.target)) return;
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
    const ids = selection.includes(id) ? selection : [id];
    const rows = current.current.tmdes.filter(row => ids.includes(row.id));
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(LIBRARY_INSTRUMENT_MIME, JSON.stringify(rows.map(definitionFor)));
    event.dataTransfer.setData("application/x-workbench-instruments", JSON.stringify({ source: "library", mode: "copy", items: rows.map(item => ({ kind: "tmde", item })) }));
  };
  if (!isOpen) return null;
  return ReactDOM.createPortal(<div ref={windowRef} className={`uncertainty-module instrument-library-window modal-content floating-window-content${!expandedIds.length ? " is-names-only" : ""}`} role="dialog" aria-label="Instrument library"
    style={{ left: position.x, top: position.y }}>
    {error && <div className="instrument-library-save-error"><span role="alert">{error}</span><button onClick={() => [...failed.current.values()].forEach(enqueue)}>Retry save</button></div>}
    <UncertaintyPanel libraryMode testPointData={libraryPoint} sessionData={session}
      libraryExpandedIds={expandedIds} onLibraryExpand={id => setExpandedIds(previous => previous.includes(id) ? previous : [...previous, id])}
      onLibraryDragStart={startLibraryDrag}
      libraryVisibleIds={visibleIds} onSessionSave={updateSession} instruments={instruments}
      onSaveInstrument={onSaveToLibrary} onDeleteLibraryInstrument={onDelete} onInstrumentSynced={onInstrumentSynced}
      setNotification={setNotification} currentTmdeSelection={selection} setCurrentTmdeSelection={setSelection}
      onDeleteTmdeDefinition={remove} keyboardShortcutsEnabled
      libraryToolbar={add => <div className="panel-card-header instrument-panel-card-header instrument-library-header" onMouseDown={handleMouseDown}>
        <div className="panel-card-title" role="heading" aria-level={3}><FontAwesomeIcon icon={faBookOpen} /><span>Instrument Library</span></div>
        <div className="panel-card-actions">
        <div className="instrument-library-search">
          <FontAwesomeIcon icon={faSearch} />
          <input aria-label="Search instruments" placeholder="Search instruments" value={query} onChange={event => setQuery(event.target.value)} />
          {query && <button aria-label="Clear instrument search" onClick={() => setQuery("")}><FontAwesomeIcon icon={faTimes} /></button>}
          <button ref={filterRef} aria-label="Filter instruments" aria-expanded={optionsOpen} className={source !== "all" ? "is-active" : ""} onClick={() => setOptionsOpen(open => !open)}><FontAwesomeIcon icon={faSliders} /></button>
          {optionsOpen && <div ref={filterMenuRef} popover="manual" className="instrument-library-search-options" onKeyDown={event => { if (event.key === "Escape") { setOptionsOpen(false); filterRef.current.focus(); } }}>
            <span>Source</span><div>{["all", "local", "shared"].map(value => <button key={value} aria-pressed={source === value} onClick={() => setSource(value)}>{value === "all" ? "All sources" : value === "local" ? "Local" : "Shared"}</button>)}</div>
          </div>}
        </div>
        <button className="icon-btn-ghost" aria-label="Add instrument" title="Add instrument" onClick={() => { setQuery(""); setSource("all"); add(); }}><FontAwesomeIcon icon={faPlus} /></button>
        <button className="icon-btn-ghost" aria-label="Close instrument library" onClick={close}><FontAwesomeIcon icon={faTimes} /></button>
        </div>
      </div>} />
    <NotificationModal {...notification} isOpen={!!notification} onClose={() => setNotification(null)} />
  </div>, document.body);
}
