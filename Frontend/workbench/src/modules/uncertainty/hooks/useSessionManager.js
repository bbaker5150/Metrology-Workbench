import { getInstrumentRangeRows } from "../utils/instrumentFunctionSelection";
import { readRecovery, journalSession, acknowledgeSession, recoverSessions, saveNavigation } from "../utils/sessionRecovery";
import { syncPointTolerances } from "../utils/pointToleranceSync";
import { trackInstrumentOnboarding } from "../utils/instrumentOnboarding";
import { inheritMissingPointUnits } from "../utils/pointUnits";
import { migrateMeasurementAreas } from "../utils/measurementAreaGrouping";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import axios from "axios";
import { UNCERTAINTY_API } from "../constants/constants";
import { getDeviceKey, instrumentRequestConfig } from "../utils/deviceKey";
import { reconcileImportedInstruments } from "../utils/importedInstrumentLibrary";
import { instrumentForRole } from "../utils/acShuntInstrumentRole";
import { buildValidatedSnapshot, diffFromSnapshot } from "../utils/instrumentSync";
import { formatInstrumentSyncError } from "../utils/instrumentSyncError";
import { syncInstrumentBudgetComponents } from "../utils/instrumentBudgetComponents";

const MAX_UNDO_STEPS = 50;
const UNDO_COALESCE_MS = 800;

const cloneSession = (session) => {
  if (typeof structuredClone === "function") return structuredClone(session);
  return JSON.parse(JSON.stringify(session));
};

function normalizeLegacySharedScopes(session) {
  let result = session;
  for (const key of ["uuts", "tmdes"]) {
    if (session[key]?.some(row => row.instrument?.scope === "shared")) {
      result = { ...result, [key]: session[key].map(row => row.instrument?.scope === "shared"
        ? { ...row, instrument: { ...row.instrument, scope: "validated" } } : row) };
    }
  }
  return result;
}

const SESSION_ONLY_LINK = {
  scope: "session", owner: "", libraryInstrumentId: null, sourceId: "",
  formerPublicationId: undefined, reviewVersion: undefined,
  validatedSnapshot: null, localOverride: true,
};

function detachLocalInstrument(session, instrument) {
  const ids = new Set([instrument.id, instrument.legacyLocalId].filter(id => id != null).map(String));
  let result = session;
  for (const key of ["uuts", "tmdes"]) {
    let changed = false;
    const rows = (session[key] || []).map(row => {
      const definition = row.instrument;
      // sourceId identifies a shared origin, which other local copies may use.
      // Only the removed private record's own IDs identify its session copies.
      if (definition?.scope !== "local" || ![definition.id, definition.libraryInstrumentId, row.libraryInstrumentId]
        .some(id => id != null && ids.has(String(id)))) return row;
      changed = true;
      return { ...row, libraryInstrumentId: null, instrument: { ...definition, ...SESSION_ONLY_LINK } };
    });
    if (changed) result = { ...result, [key]: rows };
  }
  return result;
}

function sessionImageUploads(session, imageData) {
  return (session.noteImages || []).flatMap(({ id, fileName, fileObject }) => {
    const data = imageData.get(id) || imageData.get(String(id)) || fileObject;
    return data ? [{ id, fileName, fileObject: data }] : [];
  });
}

// Undo can be followed immediately by redo. Serialize writes to the same
// record so a slow DELETE cannot overtake the subsequent restoring POST.
function queueRecordWrite(queues, key, write) {
  const pending = (queues.get(key) || Promise.resolve()).catch(() => {}).then(write);
  queues.set(key, pending);
  const release = () => { if (queues.get(key) === pending) queues.delete(key); };
  pending.then(release, release);
  return pending;
}

// Session collections share unchanged rows. Compare only replacement rows so a
// point edit does not serialize every other point and its instrument snapshots.
const sameSessionValue = (before, after) => {
  if (before === after) return true;
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) return false;
    for (let index = 0; index < before.length; index += 1) {
      if (before[index] !== after[index] &&
          JSON.stringify([before[index]]) !== JSON.stringify([after[index]])) return false;
    }
    return true;
  }
  return JSON.stringify(before) === JSON.stringify(after);
};

export const getSessionChangeGroup = (previousSession, updatedSession) => {
  const keys = new Set([
    ...Object.keys(previousSession || {}),
    ...Object.keys(updatedSession || {}),
  ]);
  const changedKeys = [...keys]
    .filter(
      (key) =>
        !sameSessionValue(previousSession?.[key], updatedSession?.[key]),
    )
    .sort();

  return changedKeys.length > 0 ? `session:${changedKeys.join(",")}` : null;
};

export const prepareImportedSession = (
  loadedSession,
  existingSessions,
  idSeed = Date.now(),
) => {
  const existingIds = new Set(
    (existingSessions || []).map((session) => String(session.id)),
  );
  let importedId = Number(idSeed);
  while (existingIds.has(String(importedId))) importedId += 1;

  const baseName = loadedSession.name || "Imported Session";
  const existingNames = new Set(
    (existingSessions || []).map((session) => session.name),
  );
  let importedName = baseName;
  if (existingNames.has(importedName)) {
    importedName = `${baseName} (Imported)`;
    let copyNumber = 2;
    while (existingNames.has(importedName)) {
      importedName = `${baseName} (Imported ${copyNumber})`;
      copyNumber += 1;
    }
  }

  return {
    ...inheritMissingPointUnits(migrateMeasurementAreas(loadedSession)),
    id: importedId,
    name: importedName,
  };
};

// ---------------------------------------------------------------------------
// useSessionManager — backend-backed session store for the Uncertainty module.
//
// Sessions, the instrument library, and bug reports are persisted to the Django
// ``uncertainty`` backend (SQLite/MSSQL via the dedicated alias) under
// ``/api/uncertainty``. The UI still treats a session as one whole document it
// loads and saves at a time, so each ``persistSession`` PUTs the full nested
// session; the backend rebuilds the relational child rows transactionally.
//
// This replaces the original localStorage + Electron-IPC ("poor man's
// database") implementation; the in-memory CRUD helpers below are unchanged —
// they mutate ``sessions`` state and delegate to ``persistSession``.
// ---------------------------------------------------------------------------
const useSessionManager = () => {
  // --- Constants ---
  const defaultTestPoint = useMemo(
    () => ({
      section: "",
      tmdeDescription: "",
      tmdeTolerances: [],
      //  Allow specific UUT tolerance per point
      uutTolerance: null,
      //  Hierarchical Linkage
      measurementAreaId: "",
      associatedUutIds: [], // Array of UUT IDs this point links to
      specifications: {
        mfg: { uncertainty: "", k: 2 },
        navy: { uncertainty: "", k: 2 },
      },
      components: [],
      is_detailed_uncertainty_calculated: false,
      measurementType: "direct",
      equationString: "",
      equationName: "",
      variableMappings: {},
      variableNominals: {},
      testPointInfo: {
        parameter: { name: "", value: "", unit: "" },
        qualifier: null,
      },
    }),
    []
  );

  const createNewSession = useCallback(
    () => ({
      id: Date.now(),
      name: "New Session",
      analyst: "",
      organization: "NPSL",
      document: "",
      // Default the document date to today (local) in YYYY-MM-DD form so the
      // <input type="date"> and the formatted sidebar display both populate.
      documentDate: (() => {
        const now = new Date();
        const offsetMs = now.getTimezoneOffset() * 60000;
        return new Date(now.getTime() - offsetMs).toISOString().split("T")[0];
      })(),
      notes: "",
      noteImages: [],
      //  Master lists for the "Instruments Tab" workflow
      measurementAreaGroups: [],
      measurementAreas: [], // { id, name, color }
      uuts: [],             // { id, name, measurementAreaId, ...specs }
      tmdes: [],            // { id, name, measurementAreaId, ...specs }

      // Legacy/Fallback fields (kept for backward compatibility or simple sessions)
      uutDescription: "",
      uutTolerance: {},
      detailSectionOrder: ["instruments", "equation", "budget"],
      detailCollapsedSections: [],
      testPoints: [],

      uncReq: {
        uncertaintyConfidence: 95,
        reliability: 85,
        calInt: 12,
        measRelCalcAssumed: 85,
        neededTUR: 4,
        reqPFA: 2,
        guardBandMultiplier: 1,
      },
    }),
    []
  );

  // --- State ---
  const [sessions, setSessions] = useState([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [instruments, setInstruments] = useState([]);
  const [libraryDraftRows, setLibraryDraftRows] = useState([]);
  const libraryDraftRowsRef = useRef([]);
  const [instrumentsLoaded, setInstrumentsLoaded] = useState(false);
  const [instrumentLibraryError, setInstrumentLibraryError] = useState("");
  const [customEquations, setCustomEquations] = useState([]);
  const [bugReports, setBugReports] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(() => readRecovery().navigation?.sessionId ?? null);
  const [selectedTestPointId, setSelectedTestPointId] = useState(() => readRecovery().navigation?.pointId ?? null);
  const sessionsRef = useRef([]);
  const selectedSessionIdRef = useRef(null);
  const selectedTestPointIdRef = useRef(null);
  const instrumentsRef = useRef([]);
  const lastListedInstrumentIds = useRef(null);
  const instrumentListRequest = useRef(0);
  const approvedSubmissionIds = useRef(new Set());
  const sharedDataRef = useRef({ equations: [], bug_reports: [] });
  const instrumentSaveQueuesRef = useRef(new Map());
  // One chronological history for the whole uncertainty workspace. Keeping a
  // per-session map made Ctrl+Z depend on whichever session happened to be
  // selected and left add/delete/import outside undo entirely.
  const undoHistoryRef = useRef([]);
  const redoHistoryRef = useRef([]);
  const undoSequenceRef = useRef(0);
  const persistTimersRef = useRef(new Map());
  const pendingPersistRef = useRef(new Map());
  const persistQueuesRef = useRef(new Map());

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    selectedTestPointIdRef.current = selectedTestPointId;
  }, [selectedTestPointId]);

  const replaceInstruments = useCallback((updater) => {
    const nextInstruments =
      typeof updater === "function" ? updater(instrumentsRef.current) : updater;
    instrumentsRef.current = nextInstruments;
    setInstruments(nextInstruments);
    return nextInstruments;
  }, []);

  // Identity is the record id. Copies may legitimately share names and shared
  // lineage while containing independent specifications.
  const dedupeLibraryInstruments = useCallback(items => {
    const byId = new Map((items || []).map(item => [String(item.id), item]));
    return [...byId.values()];
  }, []);

  const replaceSessions = useCallback((updater) => {
    const previousSessions = sessionsRef.current;
    const previousById = new Map();
    for (const session of previousSessions) {
      if (!previousById.has(session.id)) previousById.set(session.id, session);
    }
    const nextSessions = (typeof updater === "function" ? updater(previousSessions) : updater).map(session => {
      const previous = previousById.get(session.id);
      if (session === previous) return session;
      const loaded = previous ? session : normalizeLegacySharedScopes(session);
      const normalized = inheritMissingPointUnits(migrateMeasurementAreas(loaded));
      return trackInstrumentOnboarding(previous ? normalized : syncPointTolerances(normalized), previous);
    });
    if (nextSessions.length === previousSessions.length && nextSessions.every((session, index) => session === previousSessions[index])) return previousSessions;
    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
    return nextSessions;
  }, []);

  const pushUndoEntry = useCallback((entry, groupKey) => {
    if (!entry || !groupKey) return;
    const now = Date.now();
    const history = undoHistoryRef.current;
    const lastEntry = history[history.length - 1];
    const afterUndo = redoHistoryRef.current.length > 0;
    redoHistoryRef.current.length = 0;
    const shouldCoalesce =
      !afterUndo &&
      (entry.kind === "session" || entry.kind === "action") &&
      lastEntry?.kind === entry.kind &&
      lastEntry?.groupKey === groupKey &&
      lastEntry?.scopeKey === entry.scopeKey &&
      now - lastEntry.recordedAt <= UNDO_COALESCE_MS;

    if (!shouldCoalesce) {
      // Capture only when retaining an undo step. Cloning before the coalescing
      // check discarded a full large-session copy on every typing keystroke.
      const snapshot = entry.kind === "session"
        ? { session: cloneSession(entry.session) }
        : entry.kind === "workspace" ? { sessions: cloneSession(entry.sessions) } : {};
      history.push({ ...entry, ...snapshot, groupKey, recordedAt: now });
      if (history.length > MAX_UNDO_STEPS) {
        history.splice(0, history.length - MAX_UNDO_STEPS);
      }
    } else {
      // Preserve the original before-snapshot while extending a typing/editing
      // burst, exactly as a native editor treats it as one undo step.
      lastEntry.recordedAt = now;
      if (entry.kind === "action") lastEntry.after = entry.after;
    }
  }, []);

  const recordHistoryAction = useCallback((before, after, restore, groupKey) => {
    pushUndoEntry({ kind: "action", before, after, restore }, groupKey);
  }, [pushUndoEntry]);

  const setDraftPresence = useCallback((rows, present) => {
    const ids = new Set(rows.map(row => row.id));
    const others = libraryDraftRowsRef.current.filter(row => !ids.has(row.id));
    libraryDraftRowsRef.current = present ? [...others, ...rows] : others;
    setLibraryDraftRows(libraryDraftRowsRef.current);
  }, []);
  const changeLibraryDrafts = useCallback((rows, present) => {
    const ids = new Set(rows.map(row => row.id));
    const before = libraryDraftRowsRef.current.filter(row => ids.has(row.id));
    const after = present ? rows : [];
    if (sameSessionValue(before, after)) return;
    const restore = value => {
      setDraftPresence(rows, false);
      if (value.length) setDraftPresence(value, true);
    };
    recordHistoryAction(before, after, restore, `library-drafts:${++undoSequenceRef.current}`);
    restore(after);
  }, [setDraftPresence, recordHistoryAction]);

  const recordUndoSnapshot = useCallback((session, groupKey) => {
    if (!session || !groupKey) return;
    pushUndoEntry(
      {
        kind: "session",
        scopeKey: `session:${session.id}`,
        session,
        selectedSessionId: selectedSessionIdRef.current,
        selectedTestPointId: selectedTestPointIdRef.current,
      },
      groupKey,
    );
  }, [pushUndoEntry]);

  const recordWorkspaceUndoSnapshot = useCallback((groupKey, imageBackup) => {
    pushUndoEntry(
      {
        kind: "workspace",
        scopeKey: "workspace",
        sessions: sessionsRef.current,
        imageBackup,
        selectedSessionId: selectedSessionIdRef.current,
        selectedTestPointId: selectedTestPointIdRef.current,
      },
      groupKey,
    );
  }, [pushUndoEntry]);

  // --- 1. Load Data (Sessions) ---
  const loadData = useCallback(async () => {
    try {
      const res = await axios.get(`${UNCERTAINTY_API}/sessions/`);
      const loaded = recoverSessions(Array.isArray(res.data) ? res.data : []);
      undoHistoryRef.current.length = 0;
      redoHistoryRef.current.length = 0;
      replaceSessions(loaded);
      if (loaded.length > 0) {
        setSelectedSessionId((prev) =>
          prev && loaded.find((s) => s.id === prev) ? prev : loaded[0].id
        );
        const navigation = readRecovery().navigation;
        const session = loaded.find(s => s.id === navigation?.sessionId) || loaded[0];
        setSelectedTestPointId(session.testPoints?.some(p => p.id === navigation?.pointId) ? navigation.pointId : null);
      }
    } catch (err) {
      console.error("Failed to load sessions from backend", err);
      replaceSessions(recoverSessions([]));
    } finally {
      setSessionsLoaded(true);
    }
  }, [replaceSessions]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // --- 1.1 Load Shared Data (Instruments & Bugs) ---
  const loadSharedData = useCallback(async () => {
    const request = ++instrumentListRequest.current;
    const [instrumentResult, equationResult, bugResult] =
      await Promise.allSettled([
        axios.get(`${UNCERTAINTY_API}/instruments/`, {
          ...instrumentRequestConfig(), params: { owner: getDeviceKey() },
        }),
        axios.get(`${UNCERTAINTY_API}/equations/`),
        axios.get(`${UNCERTAINTY_API}/bug_reports/`),
      ]);

    try {
      // Load the validated (shared) library plus this user's own local
      // instruments — the backend resolves both from the owner key.
      if (instrumentResult.status !== "fulfilled") {
        throw instrumentResult.reason;
      }
      const instRes = instrumentResult.value;
      if (!Array.isArray(instRes.data)) throw new Error("The library returned an incomplete instrument listing.");
      if (request === instrumentListRequest.current) {
        setInstrumentLibraryError("");
        lastListedInstrumentIds.current = new Set(instRes.data.map(item => String(item.id)));
        replaceInstruments(
          dedupeLibraryInstruments([...instRes.data,
            ...Object.values(readRecovery().libraryEdits || {}).map(entry => entry.instrument)]),
        );
      }
    } catch (e) {
      console.error("Failed to load instruments from backend", e);
      if (request === instrumentListRequest.current) {
        setInstrumentLibraryError(formatInstrumentSyncError(e));
        replaceInstruments(previous => dedupeLibraryInstruments([...previous, ...Object.values(readRecovery().libraryEdits || {}).map(entry => entry.instrument)]));
      }
    } finally {
      setInstrumentsLoaded(true);
    }

    try {
      if (equationResult.status !== "fulfilled") {
        throw equationResult.reason;
      }
      const eqRes = equationResult.value;
      sharedDataRef.current.equations = Array.isArray(eqRes.data) ? eqRes.data : [];
      setCustomEquations(sharedDataRef.current.equations);
    } catch (e) {
      console.error("Failed to load custom equations from backend", e);
    }

    try {
      if (bugResult.status !== "fulfilled") {
        throw bugResult.reason;
      }
      const bugRes = bugResult.value;
      const bugs = Array.isArray(bugRes.data) ? bugRes.data : [];
      sharedDataRef.current.bug_reports = bugs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setBugReports(bugs);
    } catch (e) {
      console.error("Failed to load bug reports from backend", e);
    }
  }, [dedupeLibraryInstruments, replaceInstruments]);

  useEffect(() => {
    loadSharedData();
  }, [loadSharedData]);

  // --- 2. Persistence Logic (Sessions) ---
  // PUT upserts the whole nested session; the backend rebuilds child rows.
  const persistSession = useCallback((sessionToSave, newImages = []) => {
    if (!sessionToSave || sessionToSave.id == null) return;

    const key = String(sessionToSave.id);
    clearTimeout(persistTimersRef.current.get(key));
    persistTimersRef.current.delete(key);
    pendingPersistRef.current.delete(key);
    const token = journalSession("saves", key, { session: sessionToSave, images: newImages });
    const imagesToSave = readRecovery().saves?.[key]?.images || newImages;
    const previousSave = persistQueuesRef.current.get(key) || Promise.resolve();

    const queuedSave = previousSave
      .catch(() => {})
      .then(async () => {
        try {
          await axios.put(
            `${UNCERTAINTY_API}/sessions/${sessionToSave.id}/`,
            sessionToSave
          );

          for (const img of imagesToSave) {
            if (img.fileObject) {
              await axios.post(
                `${UNCERTAINTY_API}/sessions/${sessionToSave.id}/images/`,
                {
                  imageId: img.id,
                  dataBase64: img.fileObject,
                  fileName: img.fileName,
                }
              );
            }
          }
          acknowledgeSession("saves", key, token);
          return true;
        } catch (err) {
          console.error("Failed to save session to backend", err);
          return false;
        }
      });

    persistQueuesRef.current.set(key, queuedSave);
    queuedSave.finally(() => {
      if (persistQueuesRef.current.get(key) === queuedSave) {
        persistQueuesRef.current.delete(key);
      }
    });

    return queuedSave;
  }, []);

  // Rich notes autosave independently from the nested session document. The
  // same per-session queue preserves ordering with full saves (including image
  // uploads), while avoiding a relational rebuild for every paragraph edit.
  const persistSessionNotes = useCallback((sessionId, notes) => {
    if (sessionId == null) return Promise.resolve();
    sessionId = String(sessionId);
    const token = journalSession("notes", sessionId, { notes });

    const previousSave =
      persistQueuesRef.current.get(sessionId) || Promise.resolve();
    const queuedSave = previousSave
      .catch(() => {})
      .then(() =>
        axios.patch(`${UNCERTAINTY_API}/sessions/${sessionId}/notes/`, {
          notes,
        }),
      );

    persistQueuesRef.current.set(sessionId, queuedSave);
    const releaseQueue = () => {
      if (persistQueuesRef.current.get(sessionId) === queuedSave) {
        persistQueuesRef.current.delete(sessionId);
      }
    };
    queuedSave.then(() => { acknowledgeSession("notes", sessionId, token); releaseQueue(); }, (error) => {
      releaseQueue();
      console.error("Failed to save session notes", error);
    });
    return queuedSave;
  }, []);

  const persistSessionDebounced = useCallback(
    (sessionToSave, delayMs = 600) => {
      if (!sessionToSave || sessionToSave.id == null) return;

      const key = String(sessionToSave.id);
      journalSession("saves", key, { session: sessionToSave });
      pendingPersistRef.current.set(key, sessionToSave);

      const existingTimer = persistTimersRef.current.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(() => {
        const latestSession = pendingPersistRef.current.get(key);
        pendingPersistRef.current.delete(key);
        persistTimersRef.current.delete(key);
        persistSession(latestSession);
      }, delayMs);

      persistTimersRef.current.set(key, timer);
    },
    [persistSession]
  );

  useEffect(() => {
    return () => {
      persistTimersRef.current.forEach((timer) => clearTimeout(timer));
      persistTimersRef.current.clear();
      pendingPersistRef.current.clear();
      persistQueuesRef.current.clear();
    };
  }, []);

  const commitLibrarySession = useCallback(session => {
    replaceSessions(records => records.map(item => item.id === session.id ? session : item));
    persistSessionDebounced(session);
  }, [persistSessionDebounced, replaceSessions]);

  const recordLibraryChange = useCallback((id, before, after, syncSessionId) => {
    // A matching session instance can have its own Type B collection before a
    // library edit. Retain the actual row values for both sides of this step.
    const session = sessionsRef.current.find(item => item.id === syncSessionId);
    const removingLocal = before?.scope === "local" && !after;
    const changes = (removingLocal ? sessionsRef.current : session && after ? [session] : [])
      .map(previous => ({ previous, next: removingLocal
        ? detachLocalInstrument(previous, before) : syncInstrumentBudgetComponents(previous, after) }))
      .filter(change => change.previous !== change.next);
    const sessionChanged = changes.length > 0;
    for (const change of changes) commitLibrarySession(change.next);
    // Shared writes require a fresh authorization at their storage boundary.
    if ([before, after].some(item => item && (item.password || ["validated", "shared", "pending"].includes(item.scope)))) return;
    if (!sessionChanged && sameSessionValue(before, after)) return;
    const draft = after && !before && libraryDraftRowsRef.current.find(row => row.instrument.id === id);
    if (draft) setDraftPresence([draft], false);
    const snapshot = (record, side) => {
      const linkedSessions = new Map(changes.map(change => {
        const rows = { uuts: new Map(), tmdes: new Map() };
        for (const key of ["uuts", "tmdes"]) {
          (change[side][key] || []).forEach((row, index) => {
            if (change.previous[key][index] === change.next[key][index]) return;
            rows[key].set(row.id, removingLocal
              ? { libraryInstrumentId: row.libraryInstrumentId, instrument: Object.fromEntries(
                Object.keys(SESSION_ONLY_LINK).map(field => [field, row.instrument?.[field]])) }
              : { instrument: { typeBComponents: row.instrument?.typeBComponents } });
          });
        }
        return [change[side].id, rows];
      }));
      return { record, linkedSessions };
    };
    const restore = ({ record: item, linkedSessions }) => {
      // Undoing the first committed edit returns to the exact blank row added
      // in the preceding history step, without saving that blank to disk.
      if (draft) setDraftPresence([draft], !item);
      for (const [sessionId, rows] of linkedSessions) {
        const live = sessionsRef.current.find(value => value.id === sessionId);
        if (!live) continue;
        const restored = { ...live };
        for (const key of ["uuts", "tmdes"]) {
          restored[key] = (live[key] || []).map(row => rows[key].has(row.id)
            ? { ...row, ...rows[key].get(row.id), instrument: { ...row.instrument, ...rows[key].get(row.id).instrument } } : row);
        }
        commitLibrarySession(restored);
      }
      replaceInstruments(records => {
        const other = records.filter(record => String(record.id) !== String(id));
        return item ? [...other, item] : other;
      });
      const url = `${UNCERTAINTY_API}/instruments/`;
      queueRecordWrite(instrumentSaveQueuesRef.current, String(id), () => item
        ? axios.post(url, item, instrumentRequestConfig())
        : axios.delete(`${url}${encodeURIComponent(id)}/`, { ...instrumentRequestConfig(), params: { owner: getDeviceKey() } })
      ).catch(error => console.error("Failed to persist instrument history", error));
    };
    recordHistoryAction(snapshot(before, "previous"), snapshot(after, "next"), restore,
      `library:${id}:${!sessionChanged && before && after ? "edit" : ++undoSequenceRef.current}`);
  }, [commitLibrarySession, recordHistoryAction, replaceInstruments, setDraftPresence]);

  // --- 2.1 Persist Instrument ---
  // Stamp the owner key and default new instruments to the local library.
  // Submission and validation have their own explicit actions.
  const saveInstrument = useCallback(async (instrument, { requireSaved = false, recordHistory = true, syncSessionId } = {}) => {
    let payload = {
      ...instrument,
      owner: instrument.owner || getDeviceKey(),
      scope: instrument.scope || "local",
    };

    if (["shared", "validated", "pending"].includes(payload.scope)) {
      if (requireSaved) throw new Error("Use the instrument submission or SME validation action.");
      return;
    }

    const before = instrumentsRef.current.find(item => String(item.id) === String(payload.id));
    if (recordHistory && !requireSaved) recordLibraryChange(payload.id, before, payload, syncSessionId);
    if (!requireSaved) replaceInstruments(prev => prev.some(item => String(item.id) === String(payload.id))
      ? prev.map(item => String(item.id) === String(payload.id) ? payload : item)
      : [...prev, payload]);

    const key = String(payload.id);
    const request = queueRecordWrite(instrumentSaveQueuesRef.current, key, () => axios.post(`${UNCERTAINTY_API}/instruments/`, payload, instrumentRequestConfig()));
    try {
      const res = await request;
      // Reconcile with the server's canonical record (scope/snapshot resolution).
      const saved = res?.data?.id ? res.data : payload;
      if (requireSaved && recordHistory) {
        const prior = instrumentsRef.current.find(item => String(item.id) === String(saved.id));
        recordLibraryChange(saved.id, prior, saved, syncSessionId);
      }
      if (requireSaved || (res?.data?.id && instrumentSaveQueuesRef.current.get(key) == null)) {
        replaceInstruments(previous => {
          const entries = saved.legacyLocalId ? previous.filter(item => String(item.id) !== String(saved.legacyLocalId)) : previous;
          return entries.some(item => String(item.id) === String(saved.id))
            ? entries.map(item => String(item.id) === String(saved.id) ? saved : item)
            : [...entries, saved];
        });
      }
      return saved;
    } catch (e) {
      console.error("Failed to save instrument to backend", e);
      if (requireSaved) throw e;
    }
  }, [recordLibraryChange, replaceInstruments]);

  // Library edits are journaled before entering the modal's save queue, so an
  // interrupted app can restore even the latest edit that never reached POST.
  useEffect(() => {
    if (!instrumentsLoaded) return;
    const retry = () => {
      for (const [id, entry] of Object.entries(readRecovery().libraryEdits || {})) {
        saveInstrument(entry.instrument, { requireSaved: true, recordHistory: false }).then(() => {
          acknowledgeSession("libraryEdits", id, entry.token);
        }).catch(() => {}); // Keep failed entries for the next reconnect/reopen.
      }
    };
    retry();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [instrumentsLoaded, saveInstrument]);

  const reconcileSyncedInstrument = useCallback((instrument, submittedId) => {
    if (!instrument?.id) return;
    if (instrument.scope === "local" && submittedId != null) {
      const current = instrumentsRef.current.find(item => String(item.id) === String(submittedId));
      if (approvedSubmissionIds.current.has(String(submittedId)) || ["validated", "shared"].includes(current?.scope)) {
        throw new Error("This instrument has already been validated. Refresh the library before changing its status.");
      }
    }
    if (instrument.scope === "validated" && submittedId != null) {
      approvedSubmissionIds.current.add(String(submittedId));
    }
    replaceInstruments((prev) => {
      const syncedId = String(instrument.id);
      const syncedSourceId = String(instrument.sourceId || instrument.id);
      const next = (prev || []).filter((existing) => {
        if ((instrument.legacyLocalId && String(existing.id) === String(instrument.legacyLocalId)) || String(existing.id) === syncedId || (submittedId != null && existing.scope === "pending" && String(existing.id) === String(submittedId))) return false;
        if (
          instrument.scope === "validated" &&
          submittedId == null && existing.scope === "local" &&
          String(existing.sourceId || "") === syncedSourceId
        ) {
          return false;
        }
        return true;
      });
      return dedupeLibraryInstruments([...next, instrument]);
    });
  }, [dedupeLibraryInstruments, replaceInstruments]);

  // Update library status on embedded definitions while retaining the session's
  // own specifications, quantities, and other per-instance values.
  useEffect(() => {
    if (!instrumentsLoaded || !sessionsLoaded) return;
    const byId = new Map(instruments.flatMap(record => record.legacyLocalId
      ? [[String(record.legacyLocalId), record], [String(record.id), record]] : [[String(record.id), record]]));
    const byFormerPublication = new Map(instruments.filter(record => record.formerPublicationId != null)
      .map(record => [String(record.formerPublicationId), record]));
    replaceSessions(previous => previous.map(session => {
      let next = session;
      let persistLinkedStatus = false;
      for (const [key, role] of [["uuts", "uut"], ["tmdes", "tmde"]]) {
        const rows = session[key] || [];
        let changed = false;
        const updated = rows.map(row => {
          const definition = row.instrument;
          if (!definition || !["local", "pending", "validated"].includes(definition.scope)) return row;
          const privateRecord = [definition.id, definition.libraryInstrumentId, row.libraryInstrumentId]
            .filter(id => id != null).map(id => byId.get(String(id))).find(Boolean);
          if (definition.scope === "pending" && privateRecord?.scope === "local") {
            // Withdrawal changes the private submission's status, including
            // instances with independently edited specifications. Its shared
            // source is still the origin, not the private record's identity.
            changed = true;
            persistLinkedStatus = true;
            return { ...row, libraryInstrumentId: privateRecord.id, instrument: { ...definition,
              id: privateRecord.id, libraryInstrumentId: privateRecord.id, scope: "local",
              owner: privateRecord.owner || "", sourceId: privateRecord.sourceId || "",
              reviewVersion: undefined, validatedSnapshot: privateRecord.validatedSnapshot ?? null,
              localOverride: true } };
          }
          if (definition.scope === "pending" && privateRecord?.scope === "pending") {
            // A review token belongs to the stored specifications. Refresh an
            // old/missing token only when this instance still matches them.
            const reviewed = instrumentForRole(privateRecord, role);
            if (reviewed.reviewVersion != null && reviewed.reviewVersion !== definition.reviewVersion &&
              !diffFromSnapshot({ ...definition, validatedSnapshot: buildValidatedSnapshot(reviewed) }).length) {
              changed = true;
              persistLinkedStatus = true;
              return { ...row, instrument: { ...definition, reviewVersion: reviewed.reviewVersion } };
            }
            return row;
          }
          const linkedId = definition.sourceId || definition.libraryInstrumentId || row.libraryInstrumentId;
          const publicId = String(linkedId || definition.id);
          if (definition.scope === "validated" || (definition.scope === "pending" && byId.get(String(definition.id))?.scope !== "pending")) {
            const local = byFormerPublication.get(publicId) || byId.get(publicId);
            const publicationGone = definition.scope === "validated" && linkedId && !local && lastListedInstrumentIds.current?.has(publicId) === false;
            if (local?.scope === "local" || publicationGone) {
              changed = true;
              const id = local?.id ?? definition.id;
              return { ...row, libraryInstrumentId: local?.id ?? null, instrument: { ...definition,
                id, libraryInstrumentId: local?.id ?? null, scope: local ? "local" : "session", owner: local?.owner || "",
                formerPublicationId: local?.formerPublicationId, sourceId: "", reviewVersion: undefined, validatedSnapshot: null, localOverride: true } };
            }
          }
          if (definition.scope === "validated") return row;
          const candidate = byId.get(String(definition.id)) ||
            (definition.scope === "pending" && byId.get(String(definition.sourceId)));
          if (!candidate || !["pending", "validated"].includes(candidate.scope) || candidate.scope === definition.scope) return row;
          const reviewed = instrumentForRole(candidate, role);
          if (diffFromSnapshot({ ...definition, validatedSnapshot: buildValidatedSnapshot(reviewed) }).length) return row;
          changed = true;
          return { ...row, libraryInstrumentId: reviewed.id, instrument: { ...definition,
            id: reviewed.id, libraryInstrumentId: reviewed.id, sourceId: reviewed.sourceId, scope: reviewed.scope,
            reviewVersion: reviewed.reviewVersion, validatedSnapshot: reviewed.validatedSnapshot, localOverride: reviewed.localOverride } };
        });
        if (changed) next = { ...next, [key]: updated };
      }
      if (persistLinkedStatus) persistSessionDebounced(next);
      return next;
    }));
  }, [sessionsLoaded, instrumentsLoaded, instruments, replaceSessions, persistSessionDebounced]);

  const refreshInstrumentLibrary = useCallback(async () => {
    const request = ++instrumentListRequest.current;
    const before = new Map(instrumentsRef.current.map(item => [String(item.id), item]));
    const protectedIds = new Set([...instrumentSaveQueuesRef.current.keys(), ...Object.keys(readRecovery().libraryEdits || {})]);
    try {
      const { data } = await axios.get(`${UNCERTAINTY_API}/instruments/`, {
        ...instrumentRequestConfig(), params: { owner: getDeviceKey() },
      });
      if (request !== instrumentListRequest.current) return;
      if (!Array.isArray(data)) throw new Error("The library returned an incomplete instrument listing.");
      setInstrumentLibraryError("");
      for (const id of [...instrumentSaveQueuesRef.current.keys(), ...Object.keys(readRecovery().libraryEdits || {})]) protectedIds.add(id);
      const byId = new Map(data.map(entry => [String(entry.id), entry]));
      lastListedInstrumentIds.current = new Set(byId.keys());
      const byFormerPublication = new Map(data.filter(entry => entry.scope === "local" && entry.formerPublicationId != null)
        .map(entry => [String(entry.formerPublicationId), entry]));
      replaceInstruments(current => {
        const currentById = new Map(current.map(entry => [String(entry.id), entry]));
        const next = new Map(currentById);
        for (const item of before.values()) {
          if (!["pending", "validated", "shared"].includes(item.scope)) continue;
          const id = String(item.id);
          if (next.get(id) !== item || protectedIds.has(id)) continue;
          const publicId = String(item.sourceId || item.id);
          const latest = byId.get(id) || byId.get(publicId) || byFormerPublication.get(publicId);
          if (latest && (protectedIds.has(String(latest.id)) || currentById.get(String(latest.id)) !== before.get(String(latest.id)))) continue;
          if (latest?.scope === item.scope) {
            if (item.scope !== "pending" || (String(latest.id) === id && latest.reviewVersion != null &&
              latest.reviewVersion !== item.reviewVersion)) next.set(id, latest);
            continue;
          }
          if (!latest && item.scope === "pending") continue;
          if (item.scope === "pending" && latest?.scope === "validated") approvedSubmissionIds.current.add(id);
          next.delete(id);
          if (latest) next.set(String(latest.id), latest);
        }
        // Include newly discovered records, including other users' approvals.
        // A record removed or edited during this read must keep that newer state.
        for (const item of byId.values()) {
          const id = String(item.id);
          if (!before.has(id) && !next.has(id) && !protectedIds.has(id)) next.set(id, item);
        }
        return [...next.values()];
      });
    } catch (error) {
      if (request === instrumentListRequest.current) setInstrumentLibraryError(formatInstrumentSyncError(error));
    }
  }, [replaceInstruments]);

  // --- 2.2 Delete Instrument ---
  const deleteInstrument = useCallback(async (instrumentId, { scope } = {}) => {
    try {
      const before = instrumentsRef.current.find(item => String(item.id) === String(instrumentId));
      const deletingShared = ['shared', 'validated'].includes(scope || before?.scope);
      const response = await queueRecordWrite(instrumentSaveQueuesRef.current, String(instrumentId), () => axios.delete(`${UNCERTAINTY_API}/instruments/${encodeURIComponent(instrumentId)}/`, {
        ...instrumentRequestConfig(), params: { owner: getDeviceKey() },
        ...(deletingShared ? { data: { scope: 'shared' } } : {}),
      }));
      const restored = response?.data?.scope === "local" ? response.data : null;
      // Reinstating a publication requires a new SME approval.
      if (deletingShared) lastListedInstrumentIds.current?.delete(String(instrumentId));
      else if (before) recordLibraryChange(instrumentId, before, undefined);
      const pending = readRecovery().libraryEdits?.[String(instrumentId)];
      if (pending) acknowledgeSession("libraryEdits", String(instrumentId), pending.token);
      replaceInstruments(prev => [...prev.filter(item => String(item.id) !== String(instrumentId) &&
        (!restored || String(item.id) !== String(restored.id))), ...(restored ? [restored] : [])]);
      return restored;
    } catch (e) {
      console.error("Failed to delete instrument from backend", e);
      throw e;
    }
  }, [recordLibraryChange, replaceInstruments]);

  const editSharedRecord = useCallback((collection, id, value) => {
    const previous = sharedDataRef.current[collection].find(item => item.id === id);
    if (sameSessionValue(previous, value)) return;
    const restore = record => {
      const current = sharedDataRef.current[collection];
      const exists = current.some(item => item.id === id);
      const next = record
        ? (exists ? current.map(item => item.id === id ? record : item) : [...current, record])
        : current.filter(item => item.id !== id);
      if (collection === "bug_reports") next.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      sharedDataRef.current[collection] = next;
      (collection === "equations" ? setCustomEquations : setBugReports)(next);
      const url = `${UNCERTAINTY_API}/${collection}/`;
      return queueRecordWrite(instrumentSaveQueuesRef.current, `${collection}:${id}`, () =>
        record ? axios.post(url, record) : axios.delete(`${url}${encodeURIComponent(id)}/`)
      ).catch(error => console.error(`Failed to persist ${collection} change`, error));
    };
    recordHistoryAction(previous, value, restore, `${collection}:${id}:${++undoSequenceRef.current}`);
    return restore(value);
  }, [recordHistoryAction]);
  const saveCustomEquation = useCallback(item => editSharedRecord("equations", item.id, item), [editSharedRecord]);
  const deleteCustomEquation = useCallback(id => editSharedRecord("equations", id, undefined), [editSharedRecord]);
  const saveBugReport = useCallback(item => editSharedRecord("bug_reports", item.id, item), [editSharedRecord]);
  const deleteBugReport = useCallback(id => editSharedRecord("bug_reports", id, undefined), [editSharedRecord]);

  // --- 3. Image Actions ---
  const loadSessionImages = useCallback(async (sessionId) => {
    try {
      const res = await axios.get(
        `${UNCERTAINTY_API}/sessions/${sessionId}/images/`
      );
      return Array.isArray(res.data) ? res.data : [];
    } catch (e) {
      console.error("Failed to load session images", e);
      return [];
    }
  }, []);

  const saveSessionImage = useCallback(async (sessionId, imageId, dataBase64) => {
    try {
      await axios.post(`${UNCERTAINTY_API}/sessions/${sessionId}/images/`, {
        imageId,
        dataBase64,
      });
    } catch (e) {
      console.error("Failed to save session image", e);
    }
  }, []);

  const deleteSessionImage = useCallback(async (sessionId, imageId) => {
    try {
      await axios.delete(
        `${UNCERTAINTY_API}/sessions/${sessionId}/images/${imageId}/`
      );
    } catch (e) {
      console.error("Failed to delete session image", e);
    }

    replaceSessions((prev) => {
      const session = prev.find((s) => s.id === sessionId);
      if (!session) return prev;
      const updatedImages = (session.noteImages || []).filter(
        (img) => img.id !== imageId
      );
      const updatedSession = { ...session, noteImages: updatedImages };
      return prev.map((s) => (s.id === sessionId ? updatedSession : s));
    });
  }, [replaceSessions]);

  const deleteSessionFromDisk = useCallback((sessionId) => {
    sessionId = String(sessionId);
    clearTimeout(persistTimersRef.current.get(sessionId));
    persistTimersRef.current.delete(sessionId);
    pendingPersistRef.current.delete(sessionId);
    const token = journalSession("deletes", sessionId, {});
    // Serialize DELETE with the same per-session queue used by PUT. If the user
    // immediately undoes an Add/Delete, the restoring PUT is guaranteed to run
    // after this DELETE instead of racing it and leaving the backend missing a
    // session that the UI has already restored.
    const previousSave = persistQueuesRef.current.get(sessionId) || Promise.resolve();
    const queuedDelete = previousSave
      .catch(() => {})
      .then(async () => {
        try {
          await axios.delete(`${UNCERTAINTY_API}/sessions/${sessionId}/`);
          acknowledgeSession("deletes", sessionId, token);
        } catch (e) {
          console.error("Failed to delete session from backend", e);
        }
      });

    persistQueuesRef.current.set(sessionId, queuedDelete);
    queuedDelete.finally(() => {
      if (persistQueuesRef.current.get(sessionId) === queuedDelete) {
        persistQueuesRef.current.delete(sessionId);
      }
    });
    return queuedDelete;
  }, []);

  const recoveryReplayed = useRef(false);
  useEffect(() => {
    if (!sessionsLoaded || recoveryReplayed.current) return;
    recoveryReplayed.current = true;
    const retry = () => {
      const recovery = readRecovery();
      for (const entry of Object.values(recovery.saves || {})) persistSession(entry.session, entry.images || []);
      for (const [id, entry] of Object.entries(recovery.notes || {})) persistSessionNotes(id, entry.notes);
      for (const id of Object.keys(recovery.deletes || {})) deleteSessionFromDisk(id);
    };
    retry();
    window.addEventListener("online", retry);
    return () => { window.removeEventListener("online", retry); recoveryReplayed.current = false; };
  }, [sessionsLoaded, persistSession, persistSessionNotes, deleteSessionFromDisk]);
  useEffect(() => {
    if (sessionsLoaded) saveNavigation(selectedSessionId, selectedTestPointId);
  }, [sessionsLoaded, selectedSessionId, selectedTestPointId]);

  // --- 5. CRUD Operations ---
  const updateSession = useCallback(
    (updatedSession, newImages = []) => {
      const previousSession = sessionsRef.current.find(
        (session) => session.id === updatedSession.id,
      );
      updatedSession = inheritMissingPointUnits(migrateMeasurementAreas(updatedSession), previousSession);
      updatedSession = syncPointTolerances(updatedSession, previousSession);
      updatedSession = trackInstrumentOnboarding(updatedSession, previousSession);
      const changeGroup = getSessionChangeGroup(previousSession, updatedSession);
      if (!changeGroup) return;

      const isDiscreteCollectionChange = ["testPoints", "uuts", "tmdes"].some(
        (key) => {
          const before = Array.isArray(previousSession?.[key])
            ? previousSession[key]
            : [];
          const after = Array.isArray(updatedSession?.[key])
            ? updatedSession[key]
            : [];
          if (before.length !== after.length) return true;
          return before.some(
            (item, index) => String(item?.id) !== String(after[index]?.id),
          );
        },
      );
      const rangeStructure = session => ["uuts", "tmdes"].flatMap(key => (session?.[key] || []).map(item => [item.id, getInstrumentRangeRows(item).map(range => [range.rangeId ?? range.id, Boolean(range.qualifier)])]));
      const instrumentsChanged = previousSession?.uuts !== updatedSession.uuts || previousSession?.tmdes !== updatedSession.tmdes;
      const isRangeStructureChange = instrumentsChanged && JSON.stringify(rangeStructure(previousSession)) !== JSON.stringify(rangeStructure(updatedSession));
      const undoGroup = isDiscreteCollectionChange || isRangeStructureChange
        ? `${changeGroup}:discrete:${++undoSequenceRef.current}`
        : changeGroup;

      recordUndoSnapshot(previousSession, undoGroup);
      replaceSessions((prevSessions) =>
        prevSessions.map((session) =>
          session.id === updatedSession.id ? updatedSession : session,
        ),
      );
      if (newImages.length > 0) {
        return persistSession(updatedSession, newImages);
      } else {
        return persistSessionDebounced(updatedSession);
      }
    },
    [
      persistSession,
      persistSessionDebounced,
      recordUndoSnapshot,
      replaceSessions,
    ],
  );

  const applyHistory = useCallback((from, to) => {
    const undoEntry = from.current.pop();
    if (!undoEntry) return false;

    const currentSelection = {
      selectedSessionId: selectedSessionIdRef.current,
      selectedTestPointId: selectedTestPointIdRef.current,
    };
    if (undoEntry.kind === "action") {
      to.current.push({ ...undoEntry, before: undoEntry.after, after: undoEntry.before, recordedAt: -Infinity });
      undoEntry.restore(undoEntry.before);
      return true;
    }
    const inverse = undoEntry.kind === "workspace"
      ? { sessions: sessionsRef.current }
      : { session: sessionsRef.current.find(session => session.id === undoEntry.session.id) };
    to.current.push({ ...undoEntry, ...cloneSession(inverse), ...currentSelection, recordedAt: -Infinity });

    if (undoEntry.kind === "workspace") {
      const currentSessions = sessionsRef.current;
      const restoredSessions = cloneSession(undoEntry.sessions || []).map(session => trackInstrumentOnboarding(session, sessionsRef.current.find(previous => previous.id === session.id)));
      const restoredIds = new Set(restoredSessions.map((session) => String(session.id)));

      // Undoing Add/Import removes the newly persisted session. Undoing Delete
      // re-PUTs the captured session; the backend endpoint is an upsert.
      currentSessions.forEach((session) => {
        if (!restoredIds.has(String(session.id))) deleteSessionFromDisk(session.id);
      });
      restoredSessions.forEach((session) => {
        const backup = undoEntry.imageBackup;
        if (backup?.sessionId === session.id && backup.images.length) {
          persistSession(session, backup.images);
        } else {
          persistSessionDebounced(session, 0);
        }
      });
      replaceSessions(restoredSessions);

      const restoredSessionId = restoredSessions.some(
        (session) => session.id === undoEntry.selectedSessionId,
      )
        ? undoEntry.selectedSessionId
        : restoredSessions[0]?.id ?? null;
      const restoredSession = restoredSessions.find(
        (session) => session.id === restoredSessionId,
      );
      const restoredPointId = restoredSession?.testPoints?.some(
        (point) => point.id === undoEntry.selectedTestPointId,
      )
        ? undoEntry.selectedTestPointId
        : null;
      selectedSessionIdRef.current = restoredSessionId;
      selectedTestPointIdRef.current = restoredPointId;
      setSelectedSessionId(restoredSessionId);
      setSelectedTestPointId(restoredPointId);
      return true;
    }

    const restoredSession = trackInstrumentOnboarding(undoEntry.session, sessionsRef.current.find(previous => previous.id === undoEntry.session.id));
    replaceSessions((prevSessions) =>
      prevSessions.some((session) => session.id === restoredSession.id)
        ? prevSessions.map((session) =>
            session.id === restoredSession.id ? restoredSession : session,
          )
        : [restoredSession, ...prevSessions],
    );

    const selectedSession = sessionsRef.current.find(session => session.id === undoEntry.selectedSessionId) ?? restoredSession;
    const restoredSessionId = selectedSession.id;
    const restoredPointId = selectedSession.testPoints?.some(point => point.id === undoEntry.selectedTestPointId)
      ? undoEntry.selectedTestPointId : null;
    selectedSessionIdRef.current = restoredSessionId;
    selectedTestPointIdRef.current = restoredPointId;
    setSelectedSessionId(restoredSessionId);
    setSelectedTestPointId(restoredPointId);
    persistSessionDebounced(restoredSession, 0);
    return true;
  }, [deleteSessionFromDisk, persistSession, persistSessionDebounced, replaceSessions]);

  const undoLastSessionChange = useCallback(() => applyHistory(undoHistoryRef, redoHistoryRef), [applyHistory]);
  const redoLastSessionChange = useCallback(() => applyHistory(redoHistoryRef, undoHistoryRef), [applyHistory]);

  const addSession = useCallback(() => {
    recordWorkspaceUndoSnapshot("workspace:add-session");
    const newSession = createNewSession();
    replaceSessions((prev) => [newSession, ...prev]);
    setSelectedSessionId(newSession.id);
    setSelectedTestPointId(null);
    persistSession(newSession);
    return newSession;
  }, [createNewSession, persistSession, recordWorkspaceUndoSnapshot, replaceSessions]);

  const deleteSession = useCallback(
    async (sessionId, cachedImages = new Map()) => {
      const session = sessionsRef.current.find(item => item.id === sessionId);
      if (!session) return;
      let imageBackup;
      if (session.noteImages?.length) {
        // A session DELETE cascades its NoteImage rows. Capture their bodies
        // before deleting, including any upload still in the recovery journal.
        const data = new Map(Array.from(cachedImages, ([id, body]) => [String(id), body]));
        for (const image of readRecovery().saves?.[sessionId]?.images || []) {
          data.set(String(image.id), image.fileObject);
        }
        let images = sessionImageUploads(session, data);
        if (images.length !== session.noteImages.length) {
          await persistQueuesRef.current.get(String(sessionId))?.catch(() => {});
          const response = await axios.get(`${UNCERTAINTY_API}/sessions/${sessionId}/images/`);
          for (const image of response.data) {
            if (!data.has(String(image.id))) data.set(String(image.id), image.data);
          }
          images = sessionImageUploads(session, data);
          if (sessionsRef.current.find(item => item.id === sessionId) !== session) {
            throw new Error("The session changed while its note images were loading. Try deleting it again.");
          }
        }
        imageBackup = { sessionId, images };
      }
      recordWorkspaceUndoSnapshot("workspace:delete-session", imageBackup);
      deleteSessionFromDisk(sessionId);
      replaceSessions((prev) => {
        const newSessions = prev.filter((s) => s.id !== sessionId);
        if (selectedSessionIdRef.current === sessionId) {
          if (newSessions.length === 0) {
            setSelectedSessionId(null);
          } else {
            setSelectedSessionId(newSessions[0].id);
          }
          setSelectedTestPointId(null);
        }
        return newSessions;
      });
    },
    [
      deleteSessionFromDisk,
      recordWorkspaceUndoSnapshot,
      replaceSessions,
    ]
  );

  const updateSessionNotes = useCallback(
    (sessionId, notes) => {
      const previousSession = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (!previousSession || previousSession.notes === notes) {
        return Promise.resolve();
      }

      recordUndoSnapshot(previousSession, "session:notes");
      replaceSessions((previousSessions) =>
        previousSessions.map((session) =>
          session.id === sessionId ? { ...session, notes } : session,
        ),
      );
      return persistSessionNotes(sessionId, notes);
    },
    [persistSessionNotes, recordUndoSnapshot, replaceSessions],
  );

  const importSession = useCallback(
    async (loadedSession, importedImages = new Map(), { requireSaved = false, reuseSharedInstruments = false } = {}) => {
      const saves = [];
      const currentSession = sessions.find(
        (session) => session.id === selectedSessionId,
      );
      if (currentSession) saves.push(persistSession(currentSession));

      const prepared = prepareImportedSession(
        loadedSession,
        sessions,
      );
      const { session: importedSession } = reconcileImportedInstruments(prepared, {
        sharedInstruments: reuseSharedInstruments ? instruments : [],
      });
      const imagesToSave = sessionImageUploads(importedSession, importedImages);
      if (requireSaved && !(await persistSession(importedSession, imagesToSave))) {
        throw new Error("The new budget could not be saved to the database. Your current session is unchanged.");
      }
      recordWorkspaceUndoSnapshot("workspace:import-session", { sessionId: importedSession.id, images: imagesToSave });
      replaceSessions((prev) => [importedSession, ...prev]);
      setSelectedSessionId(importedSession.id);
      setSelectedTestPointId(importedSession.testPoints?.[0]?.id || null);

      if (!requireSaved) saves.push(persistSession(importedSession, imagesToSave));
      await Promise.all(saves);
      return importedSession;
    },
    [
      persistSession,
      recordWorkspaceUndoSnapshot,
      replaceSessions,
      replaceInstruments,
      instruments,
      selectedSessionId,
      sessions,
    ]
  );

  // --- 6. Workflow Redesign CRUD (Area, UUT, TMDE) ---

  // Measurement Areas
  const addMeasurementArea = (sessionId, area) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const currentAreas = session.measurementAreas || [];
    updateSession({ ...session, measurementAreas: [...currentAreas, area] });
  };

  const updateMeasurementArea = (sessionId, updatedArea) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const updatedAreas = (session.measurementAreas || []).map((a) =>
      a.id === updatedArea.id ? updatedArea : a
    );
    updateSession({ ...session, measurementAreas: updatedAreas });
  };

  const removeMeasurementArea = (sessionId, areaId) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const updatedAreas = (session.measurementAreas || []).filter(
      (a) => a.id !== areaId
    );
    updateSession({ ...session, measurementAreas: updatedAreas });
  };

  // UUTs (Session Level)
  const addSessionUut = (sessionId, uut) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const currentUuts = session.uuts || [];
    updateSession({ ...session, uuts: [...currentUuts, uut] });
  };

  const updateSessionUut = (sessionId, updatedUut) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const updatedUuts = (session.uuts || []).map((u) =>
      u.id === updatedUut.id ? updatedUut : u
    );
    updateSession({ ...session, uuts: updatedUuts });
  };

  const removeSessionUut = (sessionId, uutId) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const updatedUuts = (session.uuts || []).filter((u) => u.id !== uutId);
    updateSession({ ...session, uuts: updatedUuts });
  };

  // TMDEs (Session Level)
  const addSessionTmde = (sessionId, tmde) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const currentTmdes = session.tmdes || [];
    updateSession({ ...session, tmdes: [...currentTmdes, tmde] });
  };

  const updateSessionTmde = (sessionId, updatedTmde) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const updatedTmdes = (session.tmdes || []).map((t) =>
      t.id === updatedTmde.id ? updatedTmde : t
    );
    updateSession({ ...session, tmdes: updatedTmdes });
  };

  const removeSessionTmde = (sessionId, tmdeId) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const updatedTmdes = (session.tmdes || []).filter((t) => t.id !== tmdeId);
    updateSession({ ...session, tmdes: updatedTmdes });
  };

  // --- 7. Test Point Actions (Batch saving) ---
  const saveTestPoint = (formDataOrArray, sessionUpdates = null) => {
    const session = sessions.find((s) => s.id === selectedSessionId);
    if (!session) return;

    let updatedSession = { ...session, ...sessionUpdates };

    const dataItems = Array.isArray(formDataOrArray)
      ? formDataOrArray
      : [formDataOrArray];

    let currentTestPoints = [...session.testPoints];
    let lastNewId = null;

    const insertionCursors = new Map();
    dataItems.forEach((formData, index) => {
      if (formData.id) {
        // --- UPDATE EXISTING POINT ---
        currentTestPoints = currentTestPoints.map((tp) => {
          if (tp.id === formData.id) {
            return {
              ...tp,
              section: formData.section,
              testPointInfo: { ...tp.testPointInfo, ...formData.testPointInfo },
              measurementType: formData.measurementType,
              equationString: formData.equationString,
              equationName:
                formData.equationName !== undefined
                  ? formData.equationName
                  : tp.equationName || "",
              variableMappings: formData.variableMappings,
              variableNominals:
                formData.variableNominals !== undefined
                  ? formData.variableNominals
                  : tp.variableNominals || {},
              tmdeTolerances: formData.tmdeTolerances || tp.tmdeTolerances,
              uutTolerance:
                formData.uutTolerance !== undefined
                  ? formData.uutTolerance
                  : tp.uutTolerance,
              measurementAreaId:
                formData.measurementAreaId || tp.measurementAreaId || "",
              associatedUutIds:
                formData.associatedUutIds || tp.associatedUutIds || [],
            };
          }
          return tp;
        });
      } else {
        // --- CREATE NEW POINT ---
        const lastTestPoint = session.testPoints.find(
          (tp) => tp.id === selectedTestPointId
        );
        let finalTmdes = formData.tmdeTolerances || [];

        if (finalTmdes.length === 0 && formData.copyTmdes && lastTestPoint) {
          finalTmdes = JSON.parse(
            JSON.stringify(lastTestPoint.tmdeTolerances || [])
          );
          const originalTestPointParameter =
            lastTestPoint.testPointInfo.parameter;
          const newTestPointParameter = formData.testPointInfo.parameter;
          finalTmdes.forEach((tmde) => {
            const wasUsingUutRef =
              tmde.measurementPoint?.value ===
                originalTestPointParameter.value &&
              tmde.measurementPoint?.unit === originalTestPointParameter.unit;
            if (wasUsingUutRef) {
              tmde.measurementPoint = { ...newTestPointParameter };
            }
          });
        }

        let newId = Date.now() + Math.floor(Math.random() * 10000) + index;
        // Random offsets can collide with existing points or earlier entries
        // in the same paste. Preserve numeric IDs while checking the live batch.
        while (currentTestPoints.some(point => String(point.id) === String(newId))) newId += 1;

        const newTestPoint = {
          id: newId,
          ...defaultTestPoint,
          ...formData,
          section: formData.section,
          testPointInfo: formData.testPointInfo,
          tmdeTolerances: finalTmdes,
          uutTolerance: formData.uutTolerance || null,
          measurementType: formData.measurementType,
          equationString: formData.equationString,
          equationName: formData.equationName || "",
          variableMappings: formData.variableMappings,
          variableNominals: formData.variableNominals || {},
          measurementAreaId: formData.measurementAreaId || "",
          associatedUutIds: formData.associatedUutIds || [],
        };

        delete newTestPoint._insertAfterPointId;
        const anchor = formData._insertAfterPointId;
        const cursor = insertionCursors.get(String(anchor)) ?? anchor;
        const insertionIndex = cursor == null ? -1 : currentTestPoints.findIndex(
          point => String(point.id) === String(cursor),
        );
        if (insertionIndex < 0) currentTestPoints.push(newTestPoint);
        else currentTestPoints.splice(insertionIndex + 1, 0, newTestPoint);
        if (anchor != null) insertionCursors.set(String(anchor), newId);
        lastNewId = newId;
      }
    });

    updatedSession.testPoints = currentTestPoints;

    if (lastNewId) {
      setSelectedTestPointId(lastNewId);
    }

    updateSession(updatedSession);
    // Return the id of the last newly-created point (null when only updating), so
    // callers can e.g. drop a freshly added row straight into inline edit.
    return lastNewId;
  };

  const deleteTestPoint = (idToDelete) => {
    const session = sessions.find((s) => s.id === selectedSessionId);
    if (!session) return;
    let nextSelectedTestPointId = selectedTestPointId;
    const filteredTestPoints = session.testPoints.filter(
      (tp) => tp.id !== idToDelete
    );
    if (selectedTestPointId === idToDelete) {
      nextSelectedTestPointId = filteredTestPoints[0]?.id || null;
    }
    const updatedSession = { ...session, testPoints: filteredTestPoints };
    setSelectedTestPointId(nextSelectedTestPointId);
    updateSession(updatedSession);
  };

  const updateTestPointData = useCallback(
    (updatedData, { recordUndo = true } = {}) => {
      const session = sessionsRef.current.find(
        (item) => item.id === selectedSessionId,
      );
      if (!session) return;

      const currentPoint = session.testPoints.find(
        (testPoint) => testPoint.id === selectedTestPointId,
      );
      if (!currentPoint || Object.keys(updatedData).every(key => sameSessionValue(currentPoint[key], updatedData[key]))) return;

      const updatedTestPoints = session.testPoints.map((testPoint) =>
        testPoint.id === selectedTestPointId
          ? { ...testPoint, ...updatedData }
          : testPoint,
      );
      const updatedSession = syncPointTolerances({ ...session, testPoints: updatedTestPoints }, session);

      const updatedKeys = Object.keys(updatedData).sort().join(",");
      const isDiscreteBudgetChange = ["components", "tmdeTolerances"].some(
        (key) => {
          if (!Object.prototype.hasOwnProperty.call(updatedData, key)) return false;
          const before = Array.isArray(currentPoint?.[key]) ? currentPoint[key] : [];
          const after = Array.isArray(updatedData[key]) ? updatedData[key] : [];
          if (before.length !== after.length) return true;
          return before.some(
            (item, index) => String(item?.id) !== String(after[index]?.id),
          );
        },
      );
      // Calculated outputs follow their authored change, not a separate user action.
      const calculatedKeys = new Set([
        "combined_uncertainty", "combined_uncertainty_absolute_base", "combined_uncertainty_inputs_native", "combined_uncertainty_inputs_base",
        "effective_dof", "k_value", "expanded_uncertainty", "expanded_uncertainty_absolute_base", "is_detailed_uncertainty_calculated",
        "calculatedBudgetComponents", "calculatedBudgetGroups", "calculatedNominalValue", "risk8MonteCarloResult",
      ]);
      const keys = Object.keys(updatedData);
      const calculatedOnly = keys.some(key => calculatedKeys.has(key)) && keys.every(key => calculatedKeys.has(key) || key === "budgetPropagationMethod");
      if (recordUndo && !calculatedOnly) recordUndoSnapshot(
        session,
        isDiscreteBudgetChange
          ? `point:${selectedTestPointId}:${updatedKeys}:discrete:${++undoSequenceRef.current}`
          : `point:${selectedTestPointId}:${updatedKeys}`,
      );
      replaceSessions((prevSessions) =>
        prevSessions.map((item) =>
          item.id === selectedSessionId ? updatedSession : item,
        ),
      );
      persistSessionDebounced(updatedSession, 700);
    },
    [
      persistSessionDebounced,
      recordUndoSnapshot,
      replaceSessions,
      selectedSessionId,
      selectedTestPointId,
    ],
  );

  const deleteTmdeDefinition = (tmdeId) => {
    const session = sessions.find((s) => s.id === selectedSessionId);
    if (!session) return;
    const updatedTestPoints = session.testPoints.map((tp) => {
      if (tp.id !== selectedTestPointId) return tp;
      const newTolerances = tp.tmdeTolerances.filter(
        (t) => t.id !== tmdeId && t.sourceId !== tmdeId,
      );
      return { ...tp, tmdeTolerances: newTolerances };
    });
    updateSession({ ...session, testPoints: updatedTestPoints });
  };

  const decrementTmdeQuantity = (tmdeId) => {
    const session = sessions.find((s) => s.id === selectedSessionId);
    if (!session) return;
    const updatedTestPoints = session.testPoints.map((tp) => {
      if (tp.id !== selectedTestPointId) return tp;
      const newTolerances = tp.tmdeTolerances
        .map((t) => {
          if (t.id === tmdeId || t.sourceId === tmdeId) {
            const newQuantity = (t.quantity || 1) - 1;
            return { ...t, quantity: newQuantity };
          }
          return t;
        })
        .filter((t) => t.quantity > 0);
      return { ...tp, tmdeTolerances: newTolerances };
    });
    updateSession({ ...session, testPoints: updatedTestPoints });
  };

  // --- HELPERS ---
  const currentSessionData = sessions.find((s) => s.id === selectedSessionId);
  const currentTestPoints = currentSessionData?.testPoints || [];

  return {
    sessions,
    sessionsLoaded,
    instruments,
    instrumentLibraryError,
    customEquations,
    saveCustomEquation,
    deleteCustomEquation,
    bugReports,
    saveInstrument,
    libraryDraftRows,
    changeLibraryDrafts,
    reconcileSyncedInstrument,
    refreshInstrumentLibrary,
    saveBugReport,
    deleteBugReport,
    deleteInstrument,
    loadInstruments: loadSharedData,
    selectedSessionId,
    setSelectedSessionId,
    selectedTestPointId,
    setSelectedTestPointId,
    currentSessionData,
    currentTestPoints,
    defaultTestPoint,
    createNewSession,
    saveSessionImage,
    loadSessionImages,
    deleteSessionImage,
    addSession,
    deleteSession,
    updateSession,
    updateSessionNotes,
    undoLastSessionChange,
    redoLastSessionChange,
    recordHistoryAction,
    importSession,
    saveTestPoint,
    deleteTestPoint,
    updateTestPointData,
    deleteTmdeDefinition,
    decrementTmdeQuantity,
    setSessions: replaceSessions,

    addMeasurementArea,
    updateMeasurementArea,
    removeMeasurementArea,
    addSessionUut,
    updateSessionUut,
    removeSessionUut,
    addSessionTmde,
    updateSessionTmde,
    removeSessionTmde,
  };
};

export default useSessionManager;
