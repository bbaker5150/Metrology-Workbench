import SymbolButton from "../../../components/common/SymbolButton";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import axios from "axios";
import { UNCERTAINTY_API } from "../../../constants/constants";
import { buildValidatedSnapshot } from "../../../utils/instrumentSync";
import { instrumentRequestConfig } from "../../../utils/deviceKey";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSearch, faTools, faPlus, faBookOpen, faInbox, faLink } from "@fortawesome/free-solid-svg-icons";
import { LIBRARY_INSTRUMENT_MIME } from "../../../utils/libraryInstrumentDrag";
import UncertaintyPanel from "../../analysis/components/UncertaintyPanel";
import NotificationModal from "../../../components/modals/NotificationModal";
import { useFloatingWindow } from "../../../hooks/useFloatingWindow";
import { instrumentMatchesSearch } from "../../../utils/functionGrouping";
import { formatInstrumentIdentity } from "../../../utils/instrumentIdentity";
import { journalSession, acknowledgeSession } from "../../../utils/sessionRecovery";
import "./InstrumentLibraryModal.css";
import InstrumentSpecificationsButton from "./InstrumentSpecificationsButton";
import { claimWorkspaceSelection, WORKSPACE_SELECTION_EVENT } from "../../../utils/workspaceSelection";

function ReviewSpecifications({ value }) {
  if (value == null || typeof value !== "object") return String(value ?? "—");
  return <dl className="instrument-review-spec">{Object.entries(value).filter(([key, child]) =>
    key !== "id" && child != null && child !== "" && (typeof child !== "object" || Object.keys(child).length > 0)
  ).map(([key, child]) => <div key={key}><dt>{Array.isArray(value) ? child?.name || Number(key) + 1 : key.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt>
    <dd><ReviewSpecifications value={child} /></dd></div>)}</dl>;
}

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
export default function InstrumentLibraryModal({ isOpen, onClose, instruments = [], onSaveToLibrary, onDelete, onInstrumentSynced, flushLibraryRef, libraryDraftRows, onChangeDrafts, zoom = 1 }) {
  const [reviewState, setReviewState] = useState({ canValidate: false, reviews: [] });
  const [inboxOpen, setInboxOpen] = useState(false);
  const [reviewAttempt, setReviewAttempt] = useState(0);
  const validating = useRef(false);
  useEffect(() => {
    if (!isOpen) { setInboxOpen(false); return; }
    let active = true;
    axios.get(`${UNCERTAINTY_API}/instrument-reviews/`, instrumentRequestConfig()).then(({ data }) => {
      if (active) setReviewState({ canValidate: data?.canValidate === true, reviews: data?.reviews || [] });
    }).catch(() => { if (active) setReviewState({ canValidate: false, reviews: [], error: "Could not load validation access." }); });
    return () => { active = false; };
  }, [isOpen, inboxOpen, reviewAttempt]);
  const dragSelection = useRef(null);
  const [session, setSession] = useState(() => initialSession(instruments));
  const current = useRef(session);
  // A blank created by Add is local to this window until its first committed
  // edit. Existing empty library records and pasted records are ordinary rows.
  const newRows = useRef(new Set());
  const [selection, setSelection] = useState([]);
  const [expandedIds, setExpandedIds] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [query, setQuery] = useState("");
  const [notification, setNotification] = useState(null);
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState("");
  const queue = useRef(null);
  const latestQueuedEdit = useRef(new Map());
  const failed = useRef(new Map());
  const lastLibrary = useRef(instruments);
  const lastDrafts = useRef(null);
  const removing = useRef(false);
  const windowRef = useRef(null);
  const hasOpened = useRef(false);
  useLayoutEffect(() => {
    if (!flushLibraryRef) return;
    flushLibraryRef.current = () => queue.current?.then(saved => saved && !failed.current.size);
    return () => { flushLibraryRef.current = null; };
  }, [flushLibraryRef]);
  const queueWrite = write => {
    const pending = (queue.current || Promise.resolve()).then(write);
    queue.current = pending;
    const release = () => { if (queue.current === pending) queue.current = null; };
    pending.then(release, release);
    return pending;
  };
  const { position, setPosition, handleMouseDown } = useFloatingWindow({ isOpen, defaultWidth: 560, defaultHeight: 440, retainPosition: true });
  useLayoutEffect(() => {
    if (!isOpen) return;
    const collapse = event => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      if (!expandedIds.length && !selection.some(id => newRows.current.has(id))) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const active = document.activeElement;
      if (windowRef.current?.contains(active)) active.blur?.();
      const discardIds = new Set([...selection, ...expandedIds].filter(id => newRows.current.has(id)));
      if (discardIds.size) {
        onChangeDrafts?.(current.current.tmdes.filter(row => discardIds.has(row.id)), false);
        discardIds.forEach(id => newRows.current.delete(id));
        replace({ ...current.current, tmdes: current.current.tmdes.filter(row => !discardIds.has(row.id)) });
      }
      setExpandedIds([]);
      setSelection([]);
    };
    window.addEventListener("keydown", collapse, true);
    return () => window.removeEventListener("keydown", collapse, true);
  }, [isOpen, expandedIds, selection, onChangeDrafts]);
  useEffect(() => {
    if (!isOpen) return;
    const release = event => {
      if (event.detail?.owner !== "library") setSelection([]);
    };
    window.addEventListener(WORKSPACE_SELECTION_EVENT, release);
    return () => window.removeEventListener(WORKSPACE_SELECTION_EVENT, release);
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
    if (saving || error || (lastLibrary.current === instruments && lastDrafts.current === libraryDraftRows)) return;
    lastLibrary.current = instruments;
    lastDrafts.current = libraryDraftRows;
    // Keep row identities while a shared edit becomes a new local definition.
    const old = new Map(current.current.tmdes.map(row => [String(row.instrument.id), row]));
    const entries = libraryEntries(instruments);
    const ids = new Set(entries.map(item => String(item.id)));
    const drafts = libraryDraftRows ?? current.current.tmdes.filter(row => newRows.current.has(row.id));
    const restored = drafts.filter(row => !newRows.current.has(row.id));
    newRows.current = new Set(drafts.map(row => row.id));
    if (restored.length) {
      const restoredIds = restored.map(row => row.id);
      setExpandedIds(previous => [...new Set([...previous, ...restoredIds])]);
      setSelection(restoredIds);
      setActiveId(restoredIds.at(-1));
    }
    replace({ ...current.current, tmdes: [...entries.map(instrument => {
      const prior = old.get(String(instrument.id));
      const collision = prior && ids.has(String(prior.id)) && String(prior.id) !== String(instrument.id);
      return { ...rowFor(instrument), id: !collision && prior?.id || instrument.id };
    }), ...drafts] });
  }, [instruments, libraryDraftRows, saving, error]);
  const enqueue = definition => {
    const token = journalSession("libraryEdits", String(definition.id), { instrument: definition });
    latestQueuedEdit.current.set(definition.id, token);
    setSaving(count => count + 1);
    queueWrite(async () => {
      try {
        // Coalesce typing that is still queued behind a slower network save.
        if (latestQueuedEdit.current.get(definition.id) !== token) return;
        await onSaveToLibrary(definition, { requireSaved: true });
        acknowledgeSession("libraryEdits", String(definition.id), token);
        failed.current.delete(definition.id);
        if (!failed.current.size) setError("");
        return true;
      } catch (failure) {
        failed.current.set(definition.id, definition);
        setError(failure.message || "Could not save changes.");
        return false;
      } finally { setSaving(count => count - 1); }
    });
  };
  const updateSession = (next, { newLibraryRowId } = {}) => {
    const previous = new Map(current.current.tmdes.map(row => [row.id, row]));
    replace({ ...next, tmdes: next.tmdes.filter(row => row.instrument?.scope !== "session") });
    for (const row of next.tmdes) {
      if (row.id === newLibraryRowId) {
        newRows.current.add(row.id);
        onChangeDrafts?.([row], true);
        continue;
      }
      if (["session", "validated", "shared", "pending"].includes(row.instrument?.scope)) continue;
      const old = previous.get(row.id);
      if (old === row) continue;
      const definition = definitionFor(row);
      if (!old || JSON.stringify(definitionFor(old)) !== JSON.stringify(definition)) {
        newRows.current.delete(row.id);
        enqueue(definition);
      }
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
    if (!rows.length || removing.current) return;
    const isShared = row => ["validated", "shared"].includes(row.instrument.scope);
    const requiresPassword = rows.some(isShared);
    const perform = async password => {
      if (removing.current) return;
      removing.current = true;
      return queueWrite(async () => {
        try {
          // Complete queued edits before removing records so a late save cannot
          // recreate an archived instrument.
          // Check the password at the shared storage boundary before deleting
          // local rows from a mixed selection.
          for (const row of [...rows].sort((a, b) => Number(isShared(b)) - Number(isShared(a)))) {
            if (newRows.current.delete(row.id)) onChangeDrafts?.([row], false);
            else await onDelete(row.instrument.id, isShared(row) ? { password } : undefined);
            failed.current.delete(row.instrument.id);
            replace({ ...current.current, tmdes: current.current.tmdes.filter(item => item.id !== row.id) });
          }
          setSelection(previous => previous.filter(id => !ids.includes(id)));
          if (!failed.current.size) setError("");
          return true;
        } catch (failure) { setNotification({ title: "Could not remove instrument", message: failure.response?.data?.detail || failure.message || "Please try again." }); return false; }
        finally { removing.current = false; }
      });
    };
    setNotification({ title: "Remove instruments", message: `Remove ${rows.length} selected instrument${rows.length === 1 ? "" : "s"} from the library?${requiresPassword ? " Enter the shared-library password to remove shared instruments." : ""}`,
      confirmText: "Remove", ...(requiresPassword ? { inputLabel: "Shared library password", inputType: "password", validateInput: value => value.trim() ? "" : "Enter the shared-library password." } : {}),
      onConfirm: password => { setNotification(null); return perform(password); } });
  };
  const requestValidation = review => {
    const label = formatInstrumentIdentity(review);
    const id = review.reviewId || review.id;
    setNotification({ title: "Validate instrument", message: `Validate ${label} and publish these specifications to the shared library?`,
      confirmText: "Validate", secondaryText: "Cancel", onSecondary: () => setNotification(null),
      onConfirm: async () => {
        if (validating.current) return;
        validating.current = true;
        try {
          const { data } = await axios.post(`${UNCERTAINTY_API}/instrument-reviews/${encodeURIComponent(id)}/validate/`,
            { reviewVersion: review.reviewVersion }, instrumentRequestConfig());
          onInstrumentSynced?.(data, review.id);
          setReviewState(previous => ({ ...previous, reviews: previous.reviews.filter(item => (item.reviewId || item.id) !== id) }));
          setNotification({ title: "Instrument validated", message: `${label} is now shared.` });
        } catch (failure) {
          setNotification({ title: "Validation failed", message: failure.response?.data?.detail || "Could not validate this instrument. Try again." });
        } finally { validating.current = false; }
      } });
  };
  const reviewFromLibrary = async instrument => {
    try {
      const { data } = await axios.get(`${UNCERTAINTY_API}/instrument-reviews/`, instrumentRequestConfig());
      const current = data?.reviews?.find(review => String(review.id) === String(instrument.id) && review.owner === instrument.owner);
      if (current) requestValidation(current);
      else setNotification({title: "Submission unavailable", message: "This instrument is no longer pending in your validation inbox."});
    } catch (failure) {
      setNotification({title: "Could not load submission", message: failure.response?.data?.detail || "Reopen the inbox and try again."});
    }
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
  return ReactDOM.createPortal(<div ref={windowRef} data-specifications-expanded={isOpen && expandedIds.length > 0 || undefined} className={`uncertainty-module instrument-library-window modal-content floating-window-content${!expandedIds.length ? " is-names-only" : ""}`} role="dialog" aria-label="Instrument library"
    onPointerDownCapture={event => {
      const id = event.target.closest?.('tr[data-instrument-id]')?.dataset.instrumentId;
      const row = current.current.tmdes.find(item => String(item.id) === id);
      if (row) {
        claimWorkspaceSelection("library");
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
    {reviewState.error && <div className="instrument-library-save-error"><span role="status">{reviewState.error}</span><button onClick={() => setReviewAttempt(count => count + 1)}>Retry</button></div>}
    {error && <div className="instrument-library-save-error"><span role="alert">{error}</span><button onClick={() => [...failed.current.values()].forEach(enqueue)}>Retry save</button></div>}
    <UncertaintyPanel libraryMode testPointData={libraryPoint} sessionData={session}
      libraryExpandedIds={expandedIds} libraryActiveId={activeId} onLibraryExpand={id => { setActiveId(id); setExpandedIds(previous => previous.includes(id) ? previous : [...previous, id]); }}
      libraryRenderSpecifications={id => {
        const expanded = expandedIds.includes(id);
        const row = session.tmdes.find(item => item.id === id);
        const name = formatInstrumentIdentity(row, "Untitled instrument");
        return <InstrumentSpecificationsButton name={name} expanded={expanded}
          onClick={event => {
            event.stopPropagation(); document.activeElement?.blur?.();
            claimWorkspaceSelection("library");
            setActiveId(id);
            if (!selection.includes(id)) setSelection([id]);
            setExpandedIds(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
          }} />;
      }}
      onLibraryDragStart={startLibraryDrag}
      onReviewSubmission={reviewState.canValidate ? reviewFromLibrary : undefined}
      libraryVisibleIds={visibleIds} onSessionSave={updateSession} instruments={instruments}
      onSaveInstrument={onSaveToLibrary} onDeleteLibraryInstrument={onDelete} onInstrumentSynced={onInstrumentSynced}
      setNotification={setNotification} currentTmdeSelection={selection} setCurrentTmdeSelection={setSelection}
      onDeleteTmdeDefinition={remove} keyboardShortcutsEnabled={isOpen && !inboxOpen}
      libraryToolbar={add => <><div className="panel-card-header instrument-panel-card-header instrument-library-header" onMouseDown={event => {
        // Keep the focused draft and editor geometry intact throughout a drag.
        if (!event.target.closest("button, input, .no-drag")) event.preventDefault();
        handleMouseDown(event);
      }}>
        <div className="panel-card-title" role="heading" aria-level={3}><FontAwesomeIcon icon={faBookOpen} /><span>Instrument Library</span></div>
        <div className="panel-card-actions">
        {reviewState.canValidate && <button type="button" className="icon-btn-ghost" title="Validation inbox"
          aria-label="Validation inbox" aria-pressed={inboxOpen} onClick={() => setInboxOpen(open => !open)}><FontAwesomeIcon icon={faInbox} /></button>}
        <div className="instrument-library-search">
          <FontAwesomeIcon icon={faSearch} />
          <input aria-label="Search instruments" placeholder="Search instruments" value={query} onChange={event => setQuery(event.target.value)} />
          {query && <SymbolButton aria-label="Clear instrument search" onClick={() => setQuery("")} />}
          {!inboxOpen && <button type="button" className="btn-add-item btn-add-column function-header-action-btn" aria-label="Add instrument" title="Add instrument" onClick={() => { setQuery(""); add(); }}><FontAwesomeIcon icon={faPlus} /><FontAwesomeIcon icon={faTools} /></button>}
        </div>
        <SymbolButton className="icon-btn-ghost" aria-label="Close instrument library" onClick={close} />
        </div>
      </div>{inboxOpen && reviewState.canValidate && <section className="instrument-review-inbox" aria-label="Pending instrument validations">
        <h4>Pending validation</h4>
        {!reviewState.reviews.length && <p>No instruments are awaiting validation.</p>}
        {reviewState.reviews.filter(review => !query || instrumentMatchesSearch(review, query)).map(review => {
          const label = formatInstrumentIdentity(review);
          const target = instruments.find(item => item.scope === "validated" && String(item.id) === String(review.sourceId));
          return <div className="instrument-review-row" key={review.reviewId || review.id}>
            <details><summary>{label}</summary>
              {target && <p>Updates {formatInstrumentIdentity(target)}</p>}
              <ReviewSpecifications value={{ ...buildValidatedSnapshot(review), customFields: review.customFields,
                rangeCustomFields: review.rangeCustomFields, acShuntIdentity: review.acShuntIdentity }} />
            </details>
            <button type="button" className="inline-sync-badge inline-sync-badge--yellow" aria-label={`Validate ${label}`}
              title={`Validate ${label}`} onClick={() => requestValidation(review)}><FontAwesomeIcon icon={faLink} /></button>
          </div>;
        })}
      </section>}</>} />
    </div>
    <NotificationModal {...notification} isOpen={!!notification} onClose={() => setNotification(null)} />
  </div>, document.body);
}
