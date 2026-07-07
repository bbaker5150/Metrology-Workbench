import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import axios from "axios";
import { UNCERTAINTY_API } from "../constants/constants";
import { getDeviceKey } from "../utils/deviceKey";

const MAX_UNDO_STEPS = 50;
const UNDO_COALESCE_MS = 800;

const cloneSession = (session) => {
  if (typeof structuredClone === "function") return structuredClone(session);
  return JSON.parse(JSON.stringify(session));
};

const getSessionChangeGroup = (previousSession, updatedSession) => {
  const keys = new Set([
    ...Object.keys(previousSession || {}),
    ...Object.keys(updatedSession || {}),
  ]);
  const changedKeys = [...keys]
    .filter(
      (key) =>
        JSON.stringify(previousSession?.[key]) !==
        JSON.stringify(updatedSession?.[key]),
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
    ...loadedSession,
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
      measurementAreas: [], // { id, name, color }
      uuts: [],             // { id, name, measurementAreaId, ...specs }
      tmdes: [],            // { id, name, measurementAreaId, ...specs }

      // Legacy/Fallback fields (kept for backward compatibility or simple sessions)
      uutDescription: "",
      uutTolerance: {},
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
  const [instruments, setInstruments] = useState([]);
  const [customEquations, setCustomEquations] = useState([]);
  const [bugReports, setBugReports] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [selectedTestPointId, setSelectedTestPointId] = useState(null);
  const sessionsRef = useRef([]);
  const selectedSessionIdRef = useRef(null);
  const selectedTestPointIdRef = useRef(null);
  const instrumentsRef = useRef([]);
  const undoHistoryRef = useRef(new Map());
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

  const dedupeLibraryInstruments = useCallback((items) => {
    const seenLinkedLocal = new Set();
    return (items || []).filter((instrument) => {
      if (instrument?.scope !== "local" || !instrument.sourceId) return true;
      const owner = instrument.owner || getDeviceKey();
      const key = `${owner}:${instrument.sourceId}`;
      if (seenLinkedLocal.has(key)) return false;
      seenLinkedLocal.add(key);
      return true;
    });
  }, []);

  const replaceSessions = useCallback((updater) => {
    const nextSessions =
      typeof updater === "function" ? updater(sessionsRef.current) : updater;
    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
    return nextSessions;
  }, []);

  const recordUndoSnapshot = useCallback((session, groupKey) => {
    if (!session || !groupKey) return;

    const sessionKey = String(session.id);
    const now = Date.now();
    const history = undoHistoryRef.current.get(sessionKey) || {
      entries: [],
      lastGroupKey: null,
      lastRecordedAt: 0,
    };
    const shouldCoalesce =
      history.lastGroupKey === groupKey &&
      now - history.lastRecordedAt <= UNDO_COALESCE_MS;

    if (!shouldCoalesce) {
      history.entries.push({
        session: cloneSession(session),
        selectedTestPointId: selectedTestPointIdRef.current,
      });
      if (history.entries.length > MAX_UNDO_STEPS) {
        history.entries.splice(0, history.entries.length - MAX_UNDO_STEPS);
      }
    }

    history.lastGroupKey = groupKey;
    history.lastRecordedAt = now;
    undoHistoryRef.current.set(sessionKey, history);
  }, []);

  // --- 1. Load Data (Sessions) ---
  const loadData = useCallback(async () => {
    try {
      const res = await axios.get(`${UNCERTAINTY_API}/sessions/`);
      const loaded = Array.isArray(res.data) ? res.data : [];
      undoHistoryRef.current.clear();
      replaceSessions(loaded);
      if (loaded.length > 0) {
        setSelectedSessionId((prev) =>
          prev && loaded.find((s) => s.id === prev) ? prev : loaded[0].id
        );
        // Default to Session Overview (null), not the first point.
        setSelectedTestPointId(null);
      }
    } catch (err) {
      console.error("Failed to load sessions from backend", err);
    }
  }, [replaceSessions]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // --- 1.1 Load Shared Data (Instruments & Bugs) ---
  const loadSharedData = useCallback(async () => {
    try {
      // Load the validated (shared) library plus this user's own local
      // instruments — the backend resolves both from the owner key.
      const instRes = await axios.get(`${UNCERTAINTY_API}/instruments/`, {
        params: { owner: getDeviceKey() },
      });
      replaceInstruments(
        dedupeLibraryInstruments(Array.isArray(instRes.data) ? instRes.data : []),
      );
    } catch (e) {
      console.error("Failed to load instruments from backend", e);
    }

    try {
      const eqRes = await axios.get(`${UNCERTAINTY_API}/equations/`);
      setCustomEquations(Array.isArray(eqRes.data) ? eqRes.data : []);
    } catch (e) {
      console.error("Failed to load custom equations from backend", e);
    }

    try {
      const bugRes = await axios.get(`${UNCERTAINTY_API}/bug_reports/`);
      const bugs = Array.isArray(bugRes.data) ? bugRes.data : [];
      setBugReports(
        bugs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      );
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

    const key = sessionToSave.id;
    const previousSave = persistQueuesRef.current.get(key) || Promise.resolve();

    const queuedSave = previousSave
      .catch(() => {})
      .then(async () => {
        try {
          await axios.put(
            `${UNCERTAINTY_API}/sessions/${sessionToSave.id}/`,
            sessionToSave
          );

          for (const img of newImages) {
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
        } catch (err) {
          console.error("Failed to save session to backend", err);
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

  const persistSessionDebounced = useCallback(
    (sessionToSave, delayMs = 600) => {
      if (!sessionToSave || sessionToSave.id == null) return;

      const key = sessionToSave.id;
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

  // --- 2.1 Persist Instrument ---
  // Stamp the owner key and default new instruments to the local library.
  // A validated save (scope === "validated") must additionally carry a
  // `password`; that flow is driven by the caller (sync action), not here.
  const saveInstrument = useCallback(async (instrument) => {
    let payload = {
      ...instrument,
      owner: instrument.owner || getDeviceKey(),
      scope: instrument.scope || "local",
    };

    if (payload.scope === "local" && payload.sourceId) {
      const existingLinkedLocal = instrumentsRef.current.find(
        (i) =>
          i.scope === "local" &&
          i.sourceId === payload.sourceId &&
          (i.owner || getDeviceKey()) === payload.owner,
      );
      if (existingLinkedLocal) {
        payload = { ...payload, id: existingLinkedLocal.id };
      }
    } else if (payload.scope === "local") {
      const sameDefinition = instrumentsRef.current.find((i) => {
        if (i.scope !== "local" || i.sourceId) return false;
        if ((i.owner || getDeviceKey()) !== payload.owner) return false;
        return (
          (i.manufacturer || "") === (payload.manufacturer || "") &&
          (i.model || "") === (payload.model || "") &&
          (i.description || "") === (payload.description || "") &&
          JSON.stringify(i.functions || []) === JSON.stringify(payload.functions || [])
        );
      });
      if (sameDefinition) {
        payload = { ...payload, id: sameDefinition.id };
      }
    }

    replaceInstruments((prev) => {
      const existingIdx = prev.findIndex((i) => i.id === payload.id);
      const withoutDuplicateLinkedLocals =
        payload.scope === "local" && payload.sourceId
          ? prev.filter(
              (i) =>
                i.id === payload.id ||
                i.scope !== "local" ||
                i.sourceId !== payload.sourceId ||
                (i.owner || getDeviceKey()) !== payload.owner,
            )
          : prev;
      if (existingIdx > -1) {
        const next = [...withoutDuplicateLinkedLocals];
        const nextIdx = next.findIndex((i) => i.id === payload.id);
        next[nextIdx] = payload;
        return next;
      }
      return [...withoutDuplicateLinkedLocals, payload];
    });

    try {
      const res = await axios.post(`${UNCERTAINTY_API}/instruments/`, payload);
      // Reconcile with the server's canonical record (scope/snapshot resolution).
      if (res?.data?.id) {
        replaceInstruments((prev) =>
          prev.map((i) => (i.id === res.data.id ? res.data : i)),
        );
      }
    } catch (e) {
      console.error("Failed to save instrument to backend", e);
    }
  }, [replaceInstruments]);

  const reconcileSyncedInstrument = useCallback((instrument) => {
    if (!instrument?.id) return;
    replaceInstruments((prev) => {
      const syncedId = String(instrument.id);
      const syncedSourceId = String(instrument.sourceId || instrument.id);
      const next = (prev || []).filter((existing) => {
        if (String(existing.id) === syncedId) return false;
        if (
          instrument.scope === "validated" &&
          existing.scope === "local" &&
          String(existing.sourceId || "") === syncedSourceId
        ) {
          return false;
        }
        return true;
      });
      return dedupeLibraryInstruments([...next, instrument]);
    });
  }, [dedupeLibraryInstruments, replaceInstruments]);

  // --- 2.2 Delete Instrument ---
  const deleteInstrument = useCallback(async (instrumentId) => {
    replaceInstruments((prev) => prev.filter((i) => i.id !== instrumentId));
    try {
      await axios.delete(`${UNCERTAINTY_API}/instruments/${instrumentId}/`);
    } catch (e) {
      console.error("Failed to delete instrument from backend", e);
    }
  }, [replaceInstruments]);

  // --- 2.2.1 Persist Custom Equation (global library, like instruments) ---
  const saveCustomEquation = useCallback(async (equation) => {
    setCustomEquations((prev) => {
      const existingIdx = prev.findIndex((e) => e.id === equation.id);
      if (existingIdx > -1) {
        const next = [...prev];
        next[existingIdx] = equation;
        return next;
      }
      return [...prev, equation];
    });

    try {
      await axios.post(`${UNCERTAINTY_API}/equations/`, equation);
    } catch (e) {
      console.error("Failed to save custom equation to backend", e);
    }
  }, []);

  const deleteCustomEquation = useCallback(async (equationId) => {
    setCustomEquations((prev) => prev.filter((e) => e.id !== equationId));
    try {
      await axios.delete(`${UNCERTAINTY_API}/equations/${equationId}/`);
    } catch (e) {
      console.error("Failed to delete custom equation from backend", e);
    }
  }, []);

  // --- 2.3 Save/Update Bug Report ---
  const saveBugReport = useCallback(async (report) => {
    setBugReports((prev) => {
      const idx = prev.findIndex((r) => r.id === report.id);
      if (idx > -1) {
        const updated = [...prev];
        updated[idx] = report;
        return updated.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      }
      return [report, ...prev].sort(
        (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
      );
    });

    try {
      await axios.post(`${UNCERTAINTY_API}/bug_reports/`, report);
    } catch (e) {
      console.error("Failed to save bug report to backend", e);
    }
  }, []);

  const deleteBugReport = useCallback(async (reportId) => {
    setBugReports((prev) => prev.filter((r) => r.id !== reportId));
    try {
      await axios.delete(`${UNCERTAINTY_API}/bug_reports/${reportId}/`);
    } catch (e) {
      console.error("Failed to delete bug report from backend", e);
    }
  }, []);

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

  const deleteSessionFromDisk = useCallback(async (sessionId) => {
    try {
      await axios.delete(`${UNCERTAINTY_API}/sessions/${sessionId}/`);
    } catch (e) {
      console.error("Failed to delete session from backend", e);
    }
  }, []);

  // --- 5. CRUD Operations ---
  const updateSession = useCallback(
    (updatedSession, newImages = []) => {
      const previousSession = sessionsRef.current.find(
        (session) => session.id === updatedSession.id,
      );
      const changeGroup = getSessionChangeGroup(previousSession, updatedSession);
      if (!changeGroup) return;

      recordUndoSnapshot(previousSession, changeGroup);
      replaceSessions((prevSessions) =>
        prevSessions.map((session) =>
          session.id === updatedSession.id ? updatedSession : session,
        ),
      );
      if (newImages.length > 0) {
        persistSession(updatedSession, newImages);
      } else {
        persistSessionDebounced(updatedSession);
      }
    },
    [
      persistSession,
      persistSessionDebounced,
      recordUndoSnapshot,
      replaceSessions,
    ],
  );

  const undoLastSessionChange = useCallback(() => {
    const sessionId = selectedSessionIdRef.current;
    if (sessionId == null) return false;

    const history = undoHistoryRef.current.get(String(sessionId));
    const undoEntry = history?.entries.pop();
    if (!undoEntry) return false;

    history.lastGroupKey = null;
    history.lastRecordedAt = 0;
    const restoredSession = undoEntry.session;
    replaceSessions((prevSessions) =>
      prevSessions.map((session) =>
        session.id === restoredSession.id ? restoredSession : session,
      ),
    );

    const restoredPointId =
      undoEntry.selectedTestPointId != null &&
      restoredSession.testPoints?.some(
        (point) => point.id === undoEntry.selectedTestPointId,
      )
        ? undoEntry.selectedTestPointId
        : null;
    selectedTestPointIdRef.current = restoredPointId;
    setSelectedTestPointId(restoredPointId);
    persistSessionDebounced(restoredSession, 0);
    return true;
  }, [persistSessionDebounced, replaceSessions]);

  const addSession = useCallback(() => {
    const newSession = createNewSession();
    replaceSessions((prev) => [newSession, ...prev]);
    setSelectedSessionId(newSession.id);
    setSelectedTestPointId(null);
    persistSession(newSession);
    return newSession;
  }, [createNewSession, persistSession, replaceSessions]);

  const deleteSession = useCallback(
    (sessionId) => {
      deleteSessionFromDisk(sessionId);
      replaceSessions((prev) => {
        const newSessions = prev.filter((s) => s.id !== sessionId);
        if (selectedSessionId === sessionId) {
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
    [deleteSessionFromDisk, replaceSessions, selectedSessionId]
  );

  const importSession = useCallback(
    async (loadedSession, importedImages = new Map()) => {
      const saves = [];
      const currentSession = sessions.find(
        (session) => session.id === selectedSessionId,
      );
      if (currentSession) saves.push(persistSession(currentSession));

      const importedSession = prepareImportedSession(
        loadedSession,
        sessions,
      );
      replaceSessions((prev) => [importedSession, ...prev]);
      setSelectedSessionId(importedSession.id);
      setSelectedTestPointId(importedSession.testPoints?.[0]?.id || null);

      const imagesToSave = (importedSession.noteImages || [])
        .filter((image) => importedImages.has(image.id))
        .map((image) => ({
          id: image.id,
          fileObject: importedImages.get(image.id),
          fileName: image.fileName,
        }));

      saves.push(persistSession(importedSession, imagesToSave));
      await Promise.all(saves);
      return importedSession;
    },
    [persistSession, replaceSessions, selectedSessionId, sessions]
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

    dataItems.forEach((formData, index) => {
      if (formData.id) {
        // --- UPDATE EXISTING POINT ---
        currentTestPoints = currentTestPoints.map((tp) => {
          if (tp.id === formData.id) {
            return {
              ...tp,
              section: formData.section,
              testPointInfo: { ...formData.testPointInfo },
              measurementType: formData.measurementType,
              equationString: formData.equationString,
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

        const newId = Date.now() + Math.floor(Math.random() * 10000) + index;

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
          variableMappings: formData.variableMappings,
          variableNominals: formData.variableNominals || {},
          measurementAreaId: formData.measurementAreaId || "",
          associatedUutIds: formData.associatedUutIds || [],
        };

        currentTestPoints.push(newTestPoint);
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
    (updatedData) => {
      const session = sessionsRef.current.find(
        (item) => item.id === selectedSessionId,
      );
      if (!session) return;

      const updatedTestPoints = session.testPoints.map((testPoint) =>
        testPoint.id === selectedTestPointId
          ? { ...testPoint, ...updatedData }
          : testPoint,
      );
      const updatedSession = { ...session, testPoints: updatedTestPoints };
      if (!getSessionChangeGroup(session, updatedSession)) return;

      const updatedKeys = Object.keys(updatedData).sort().join(",");
      recordUndoSnapshot(
        session,
        `point:${selectedTestPointId}:${updatedKeys}`,
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
    instruments,
    customEquations,
    saveCustomEquation,
    deleteCustomEquation,
    bugReports,
    saveInstrument,
    reconcileSyncedInstrument,
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
    undoLastSessionChange,
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
