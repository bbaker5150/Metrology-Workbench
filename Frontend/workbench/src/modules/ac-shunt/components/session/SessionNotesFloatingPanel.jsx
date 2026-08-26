/**
 * Floating, draggable panel for calibration session notes. Renders outside the
 * main modal stack so users can browse the app while jotting notes.
 * Notes auto-save shortly after typing stops (debounced).
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { FaTimes } from "react-icons/fa";
import { API_BASE_URL } from "../../constants/constants";
import { recordSessionFormHistory } from "../../utils/sessionFieldHistory";

const POSITION_KEY = "acshunt_session_notes_panel_pos_v1";
const PANEL_WIDTH = 400;
/** Pause after last keystroke before PATCH (ms) */
const AUTOSAVE_DEBOUNCE_MS = 900;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function parseSavedPosition(panelW, panelH) {
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (typeof j?.x !== "number" || typeof j?.y !== "number") return null;
    const margin = 12;
    return {
      x: clamp(j.x, margin, window.innerWidth - panelW - margin),
      y: clamp(j.y, margin, window.innerHeight - panelH - margin),
    };
  } catch {
    return null;
  }
}

function defaultPosition(panelW, panelH) {
  const margin = 24;
  return {
    x: clamp(
      window.innerWidth - panelW - margin,
      margin,
      window.innerWidth - panelW - margin
    ),
    y: clamp(margin + 72, margin, window.innerHeight - panelH - margin),
  };
}

export default function SessionNotesFloatingPanel({
  isOpen,
  onClose,
  selectedSessionId,
  selectedSessionName,
  showNotification,
  fetchSessionsList,
  isRemoteViewer,
}) {
  const panelRef = useRef(null);
  const dragPointerId = useRef(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const draftRef = useRef("");
  const baselineRef = useRef("");
  const autosaveTimerRef = useRef(null);
  const wasOpenRef = useRef(false);

  const [draft, setDraft] = useState("");
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pos, setPos] = useState(() =>
    defaultPosition(PANEL_WIDTH, typeof window !== "undefined" ? 320 : 320)
  );

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    baselineRef.current = baseline;
  }, [baseline]);

  const dirty = useMemo(() => draft !== baseline, [draft, baseline]);

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  const persistNotes = useCallback(async () => {
    const text = draftRef.current;
    const base = baselineRef.current;
    if (!selectedSessionId || isRemoteViewer || text === base) return;

    setSaving(true);
    try {
      await axios.patch(`${API_BASE_URL}/calibration_sessions/${selectedSessionId}/`, {
        notes: text,
      });
      recordSessionFormHistory({ notes: text });
      setBaseline(text);
      await fetchSessionsList?.();
    } catch {
      showNotification?.("Could not save notes.", "error");
    } finally {
      setSaving(false);
    }
  }, [selectedSessionId, isRemoteViewer, fetchSessionsList, showNotification]);

  const flushSave = useCallback(async () => {
    clearAutosaveTimer();
    await persistNotes();
  }, [clearAutosaveTimer, persistNotes]);

  const clampPosToViewport = useCallback(() => {
    const el = panelRef.current;
    const h = el?.offsetHeight ?? 320;
    const w = PANEL_WIDTH;
    const margin = 12;
    setPos((prev) => ({
      x: clamp(prev.x, margin, window.innerWidth - w - margin),
      y: clamp(prev.y, margin, window.innerHeight - h - margin),
    }));
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const w = PANEL_WIDTH;
    const h = panelRef.current?.offsetHeight ?? 280;
    const saved = parseSavedPosition(w, h);
    setPos(saved ?? defaultPosition(w, h));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onResize = () => clampPosToViewport();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isOpen, clampPosToViewport]);

  const loadNotes = useCallback(async () => {
    if (!selectedSessionId) {
      setDraft("");
      setBaseline("");
      return;
    }
    setLoading(true);
    try {
      const res = await axios.get(
        `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/`
      );
      const text = res.data?.notes ?? "";
      setDraft(text);
      setBaseline(text);
    } catch {
      showNotification?.("Could not load session notes.", "error");
      setDraft("");
      setBaseline("");
    } finally {
      setLoading(false);
    }
  }, [selectedSessionId, showNotification]);

  useEffect(() => {
    if (!isOpen) return;
    loadNotes();
  }, [isOpen, selectedSessionId, loadNotes]);

  /** Debounced auto-save while typing */
  useEffect(() => {
    if (!isOpen || !selectedSessionId || isRemoteViewer || loading) {
      clearAutosaveTimer();
      return undefined;
    }
    if (!dirty) {
      clearAutosaveTimer();
      return undefined;
    }

    clearAutosaveTimer();
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      persistNotes();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => clearAutosaveTimer();
  }, [
    draft,
    baseline,
    dirty,
    isOpen,
    selectedSessionId,
    isRemoteViewer,
    loading,
    persistNotes,
    clearAutosaveTimer,
  ]);

  /** Flush pending autosave when panel closes (open → closed only; not on first mount). */
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      return undefined;
    }
    if (!wasOpenRef.current) return undefined;
    wasOpenRef.current = false;

    clearAutosaveTimer();
    let cancelled = false;
    (async () => {
      const text = draftRef.current;
      const base = baselineRef.current;
      if (!selectedSessionId || isRemoteViewer || text === base || cancelled) return;
      setSaving(true);
      try {
        await axios.patch(`${API_BASE_URL}/calibration_sessions/${selectedSessionId}/`, {
          notes: text,
        });
        recordSessionFormHistory({ notes: text });
        setBaseline(text);
        await fetchSessionsList?.();
      } catch {
        if (!cancelled) showNotification?.("Could not save notes.", "error");
      } finally {
        if (!cancelled) setSaving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    selectedSessionId,
    isRemoteViewer,
    fetchSessionsList,
    showNotification,
    clearAutosaveTimer,
  ]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        flushSave().finally(() => onClose?.());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose, flushSave]);

  useEffect(() => {
    const endDrag = () => {
      if (dragPointerId.current !== null) {
        const el = panelRef.current;
        if (el) {
          const r = el.getBoundingClientRect();
          try {
            window.localStorage.setItem(
              POSITION_KEY,
              JSON.stringify({ x: r.left, y: r.top })
            );
          } catch {
            /* ignore */
          }
        }
      }
      dragPointerId.current = null;
    };

    const onMove = (e) => {
      if (dragPointerId.current === null || dragPointerId.current !== e.pointerId)
        return;
      const nx = e.clientX - dragOffsetRef.current.x;
      const ny = e.clientY - dragOffsetRef.current.y;
      const margin = 12;
      const el = panelRef.current;
      const h = el?.offsetHeight ?? 280;
      const w = PANEL_WIDTH;
      setPos({
        x: clamp(nx, margin, window.innerWidth - w - margin),
        y: clamp(ny, margin, window.innerHeight - h - margin),
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  const startDragHeader = (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    dragPointerId.current = e.pointerId;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  if (!isOpen || typeof document === "undefined") return null;

  const subtitle = selectedSessionId
    ? selectedSessionName || `#${selectedSessionId}`
    : "No session selected";

  return createPortal(
    <div
      ref={panelRef}
      className="session-notes-float"
      role="dialog"
      aria-labelledby="session-notes-float-title"
      aria-modal="false"
      aria-busy={saving ? "true" : "false"}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: Math.min(PANEL_WIDTH, typeof window !== "undefined" ? window.innerWidth - 24 : PANEL_WIDTH),
        zIndex: 1355,
      }}
    >
      <header
        className="session-notes-float__header"
        onPointerDown={startDragHeader}
      >
        <div className="session-notes-float__title-wrap">
          <span className="session-notes-float__eyebrow">Session notes</span>
          <h3 id="session-notes-float-title" className="session-notes-float__title">
            Notes
          </h3>
          <span className="session-notes-float__subtitle">{subtitle}</span>
        </div>
        <div className="session-notes-float__actions">
          <button
            type="button"
            className="cal-results-excel-icon-btn"
            onClick={() => {
              flushSave().finally(() => onClose?.());
            }}
            title="Close"
            aria-label="Close notes panel"
          >
            <FaTimes aria-hidden />
          </button>
        </div>
      </header>
      <div className="session-notes-float__body">
        {!selectedSessionId && (
          <p className="session-notes-float__hint">
            Select a calibration session first — then you can attach notes here.
          </p>
        )}
        {isRemoteViewer && selectedSessionId && (
          <p className="session-notes-float__hint session-notes-float__hint--warn">
            Read-only while observing a remote session.
          </p>
        )}
        <textarea
          className="session-notes-float__textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            flushSave();
          }}
          placeholder={
            selectedSessionId
              ? "Measurements, anomalies, ambient observations…"
              : ""
          }
          disabled={!selectedSessionId || loading || isRemoteViewer}
          spellCheck
          aria-label="Session notes"
        />
      </div>
    </div>,
    document.body
  );
}
