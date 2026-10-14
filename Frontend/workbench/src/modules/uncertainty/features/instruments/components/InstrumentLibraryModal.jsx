import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSearch, faSliders, faPlus, faTimes } from "@fortawesome/free-solid-svg-icons";
import UncertaintyPanel from "../../analysis/components/UncertaintyPanel";
import NotificationModal from "../../../components/modals/NotificationModal";
import { useFloatingWindow } from "../../../hooks/useFloatingWindow";
import { instrumentMatchesSearch } from "../../../utils/functionGrouping";
import { useConfirmRecordDeletes } from "../../../contexts/RecordDeletePolicy";
import "./InstrumentLibraryModal.css";

const libraryEntries = instruments => instruments.filter(item => item.scope !== "session");
const rowFor = instrument => ({ id: instrument.id, description: instrument.description || "", nickname: instrument.nickname || "", instrument,
  customFields: instrument.customFields, rangeCustomFields: instrument.rangeCustomFields });
const definitionFor = row => ({ ...row.instrument, description: row.description || "", nickname: row.nickname || "",
  ...(row.ranges ? { ranges: row.ranges } : {}),
  ...(row.customFields ? { customFields: row.customFields } : {}),
  ...(row.rangeCustomFields ? { rangeCustomFields: row.rangeCustomFields } : {}),
});
const initialSession = instruments => ({ id: "instrument-library", uuts: libraryEntries(instruments).map(rowFor), tmdes: [], testPoints: [], measurementAreas: [], measurementAreaGroups: [] });

// The library is an adapter around the actual overview instrument table. Range
// rendering, editors, selection, clipboard and creation all stay in that table.
export default function InstrumentLibraryModal({ isOpen, onClose, instruments = [], onSaveToLibrary, onDelete, onBatchAdd, onInstrumentSynced }) {
  const [session, setSession] = useState(() => initialSession(instruments));
  const current = useRef(session);
  const [selection, setSelection] = useState([]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [sort, setSort] = useState("description");
  const [descending, setDescending] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [notification, setNotification] = useState(null);
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState("");
  const queue = useRef(Promise.resolve());
  const failed = useRef(new Map());
  const lastLibrary = useRef(instruments);
  const confirmDeletes = useConfirmRecordDeletes();
  const { position, handleMouseDown } = useFloatingWindow({ isOpen, defaultWidth: 1180, defaultHeight: 720 });
  const replace = next => { current.current = next; setSession(next); };
  useEffect(() => {
    if (saving || error || lastLibrary.current === instruments) return;
    lastLibrary.current = instruments;
    // Keep row identities while a shared edit becomes a new local definition.
    const old = current.current.uuts;
    replace({ ...current.current, uuts: libraryEntries(instruments).map(instrument => {
      const prior = old.find(row => String(row.instrument.id) === String(instrument.id));
      const collision = prior && libraryEntries(instruments).some(other => String(other.id) === String(prior.id) && String(other.id) !== String(instrument.id));
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
    const previous = current.current;
    replace({ ...next, uuts: next.uuts.filter(row => row.instrument?.scope !== "session") });
    for (const row of next.uuts) {
      if (["session", "validated", "shared"].includes(row.instrument?.scope)) continue;
      const old = previous.uuts.find(item => item.id === row.id);
      const definition = definitionFor(row);
      if (!old || JSON.stringify(definitionFor(old)) !== JSON.stringify(definition)) enqueue(definition);
    }
  };
  const visibleIds = useMemo(() => session.uuts.filter(row => {
    const instrument = definitionFor(row);
    return (!query || instrumentMatchesSearch(instrument, query)) && (source === "all" ||
      (source === "shared" ? ["shared", "validated"].includes(instrument.scope) : !["shared", "validated"].includes(instrument.scope)));
  }).sort((a, b) => String(definitionFor(a)[sort] || "").localeCompare(String(definitionFor(b)[sort] || ""), undefined, { numeric: true, sensitivity: "base" }) * (descending ? -1 : 1)).map(row => row.id), [session, query, source, sort, descending]);
  useEffect(() => {
    setSelection(previous => {
      const next = previous.filter(id => visibleIds.includes(id));
      return next.length === previous.length ? previous : next;
    });
  }, [visibleIds]);
  useEffect(() => {
    if (!optionsOpen) return;
    const dismiss = event => { if (!event.target.closest?.(".instrument-library-search")) setOptionsOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [optionsOpen]);
  const remove = async ids => {
    const rows = current.current.uuts.filter(row => ids.includes(row.id));
    const perform = async () => {
      try {
        // Complete queued edits before removing records so a late save cannot
        // recreate an archived instrument.
        await queue.current;
        for (const row of rows) {
          await onDelete(row.instrument.id);
          failed.current.delete(row.instrument.id);
          replace({ ...current.current, uuts: current.current.uuts.filter(item => item.id !== row.id) });
        }
        setSelection(previous => previous.filter(id => !ids.includes(id)));
        if (!failed.current.size) setError("");
      } catch (failure) { setNotification({ title: "Could not remove instrument", message: failure.message || "Please try again." }); }
    };
    if (confirmDeletes) setNotification({ title: "Remove instruments", message: `Remove ${rows.length} selected instrument${rows.length === 1 ? "" : "s"} from the library?`, confirmText: "Remove", onConfirm: perform });
    else await perform();
  };
  const close = () => {
    if (saving || failed.current.size) { setNotification({ title: "Changes have not been saved", message: saving ? "Wait for saving to finish before closing the library." : "Retry the failed save before closing the library." }); return; }
    onClose();
  };
  const addToSession = async role => {
    await queue.current;
    if (failed.current.size) return;
    const rows = current.current.uuts.filter(row => selection.includes(row.id));
    await onBatchAdd?.(rows.map(definitionFor), role);
    onClose();
  };
  if (!isOpen) return null;
  return ReactDOM.createPortal(<div className="instrument-library-window modal-content floating-window-content" role="dialog" aria-label="Instrument library"
    style={{ left: position.x, top: position.y }}>
    <div className="modal-header" onMouseDown={handleMouseDown}>
      <h3>Instrument library</h3>
      <button className="modal-close-button" aria-label="Close instrument library" onClick={close}><FontAwesomeIcon icon={faTimes} /></button>
    </div>
    <UncertaintyPanel libraryMode testPointData={{ id: "instrument-library", viewMode: "session" }} sessionData={session}
      libraryVisibleIds={visibleIds} onSessionSave={updateSession} instruments={instruments}
      onSaveInstrument={onSaveToLibrary} onDeleteLibraryInstrument={onDelete} onInstrumentSynced={onInstrumentSynced}
      setNotification={setNotification} currentUutSelection={selection} setCurrentUutSelection={setSelection}
      onDeleteUut={remove} keyboardShortcutsEnabled
      libraryToolbar={add => <div className="instrument-library-toolbar">
        <div className="instrument-library-search">
          <FontAwesomeIcon icon={faSearch} />
          <input aria-label="Search instruments" placeholder="Search instruments" value={query} onChange={event => setQuery(event.target.value)} />
          {query && <button aria-label="Clear instrument search" onClick={() => setQuery("")}><FontAwesomeIcon icon={faTimes} /></button>}
          <button aria-label="Filter and sort instruments" aria-expanded={optionsOpen} className={source !== "all" ? "is-active" : ""} onClick={() => setOptionsOpen(open => !open)}><FontAwesomeIcon icon={faSliders} /></button>
          {optionsOpen && <div className="instrument-library-search-options" onKeyDown={event => { if (event.key === "Escape") setOptionsOpen(false); }}>
            <span>Source</span><div>{["all", "local", "shared"].map(value => <button key={value} aria-pressed={source === value} onClick={() => setSource(value)}>{value === "all" ? "All sources" : value === "local" ? "Local" : "Shared"}</button>)}</div>
            <span>Sort by</span><div>{["description", "manufacturer", "model"].map(value => <button key={value} aria-pressed={sort === value} onClick={() => setSort(value)}>{value === "description" ? "Description" : value === "manufacturer" ? "Manufacturer" : "Model"}</button>)}</div>
            <button aria-pressed={descending} onClick={() => setDescending(value => !value)}>{descending ? "Descending" : "Ascending"}</button>
            <button onClick={() => setOptionsOpen(false)}>Done</button>
          </div>}
        </div>
        <span className="instrument-library-count">{visibleIds.length} of {session.uuts.length}</span>
        <button className="icon-btn-ghost" aria-label="Add instrument" title="Add instrument" onClick={() => { setQuery(""); setSource("all"); add(); }}><FontAwesomeIcon icon={faPlus} /></button>
      </div>} />
    <div className="instrument-library-footer">
      <span role="status">{saving ? "Saving changes…" : error ? "Changes not saved" : "All changes saved"}</span>
      {error && <><span role="alert">{error}</span><button className="lib-pill-btn" onClick={() => [...failed.current.values()].forEach(enqueue)}>Retry save</button></>}
      {selection.length > 0 && <><span>{selection.length} selected</span><button className="lib-pill-btn" onClick={() => remove(selection)}>Remove selected</button>
        {onBatchAdd && <><button className="lib-pill-btn" disabled={!!saving || !!error} onClick={() => addToSession("uut")}>Use as UUT</button><button className="lib-pill-btn" disabled={!!saving || !!error} onClick={() => addToSession("tmde")}>Use as TMDE</button></>}
      </>}
    </div>
    <NotificationModal {...notification} isOpen={!!notification} onClose={() => setNotification(null)} />
  </div>, document.body);
}
