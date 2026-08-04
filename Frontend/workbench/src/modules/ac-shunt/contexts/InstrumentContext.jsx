// src/contexts/InstrumentContext.js
import React, {
  createContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useContext,
} from "react";

import { WS_BASE_URL } from "../constants/constants";

const initialLiveReadings = {
  char_plus1: [],
  char_minus: [],
  char_plus2: [],
  ac_open: [],
  dc_pos: [],
  dc_neg: [],
  ac_close: [],
};

export const InstrumentContext = createContext();

export const InstrumentContextProvider = ({ children }) => {
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [selectedSessionName, setSelectedSessionName] = useState("");
  const [discoveredInstruments, setDiscoveredInstruments] = useState([]);

  // Instrument Role States
  const [stdInstrumentAddress, setStdInstrumentAddress] = useState(null);
  const [stdReaderModel, setStdReaderModel] = useState(null);
  const [stdReaderSN, setStdReaderSN] = useState(null);
  const [stdReaderInput, setStdReaderInput] = useState("FRONT");
  const [tiInstrumentAddress, setTiInstrumentAddress] = useState(null);
  const [tiReaderModel, setTiReaderModel] = useState(null);
  const [tiReaderSN, setTiReaderSN] = useState(null);
  const [tiReaderInput, setTiReaderInput] = useState("REAR");
  const [acSourceAddress, setAcSourceAddress] = useState(null);
  const [acSourceSN, setAcSourceSN] = useState(null);
  const [dcSourceAddress, setDcSourceAddress] = useState(null);
  const [dcSourceSN, setDcSourceSN] = useState(null);
  const [switchDriverAddress, setSwitchDriverAddress] = useState(null);
  const [switchDriverModel, setSwitchDriverModel] = useState(null);
  const [switchDriverSN, setSwitchDriverSN] = useState(null);
  const [readerSwitchDriverAddress, setReaderSwitchDriverAddress] = useState(null);
  const [readerSwitchDriverModel, setReaderSwitchDriverModel] = useState(null);
  const [readerSwitchDriverSN, setReaderSwitchDriverSN] = useState(null);
  const [readerSwitchStandardRoute, setReaderSwitchStandardRoute] = useState("OPEN");
  const [readerSwitchSettlingTime, setReaderSwitchSettlingTime] = useState(1);
  const [amplifierAddress, setAmplifierAddress] = useState(null);
  const [amplifierSN, setAmplifierSN] = useState(null);

  const [standardTvcSn, setStandardTvcSn] = useState(null);
  const [testTvcSn, setTestTvcSn] = useState(null);
  const [standardInstrumentSerial, setStandardInstrumentSerial] = useState(null);
  const [testInstrumentSerial, setTestInstrumentSerial] = useState(null);

  // Status & Zeroing States
  const [instrumentStatuses, setInstrumentStatuses] = useState({});
  const [isFetchingStatuses, setIsFetchingStatuses] = useState({});
  const [zeroingInstruments, setZeroingInstruments] = useState({});
  const statusWs = useRef({});

  // Refs that mirror isFetchingStatuses / zeroingInstruments so getInstrumentStatus
  // can read the latest values without being recreated on every state change.
  const isFetchingStatusesRef = useRef({});
  const zeroingInstrumentsRef = useRef({});

  // Host-side presence: list of connected remote viewers. Populated by
  // viewer_presence messages from HostSyncConsumer. Empty for remotes since
  // the server never broadcasts presence to them.
  const [observers, setObservers] = useState([]);
  // Tracks whether the host-sync WS has delivered an authoritative answer
  // about the host's current session. For remotes this lets us distinguish
  // three states in the UI: (a) still connecting to the host, (b) host
  // confirmed no active session, (c) host has a session. Without this flag
  // we'd confuse (a) and (b) and flash misleading "no test points" copy
  // during the brief window between reload and the first session_changed
  // message from the server.
  const [hostSessionKnown, setHostSessionKnown] = useState(false);

  // Collection States
  const [isCollecting, setIsCollecting] = useState(false);
  // Paired-batch state — the backend's run_paired_batch runs the Forward
  // pass, broadcasts `paired_run_awaiting_flip`, then waits for the user
  // to click "Resume reverse pass" (which the frontend posts as
  // `paired_run_resume`). The pass label drives the modal + status copy.
  const [pairedRun, setPairedRun] = useState({
    inProgress: false,
    awaitingFlip: false,
    pass: null, // 'Forward' | 'Reverse' | null
  });
  const [collectionProgress, setCollectionProgress] = useState({
    count: 0,
    total: 0,
  });
  const [liveReadings, setLiveReadings] = useState(initialLiveReadings);
  const [tiLiveReadings, setTiLiveReadings] = useState(initialLiveReadings);
  const [readingWsState, setReadingWsState] = useState(WebSocket.CLOSED);
  const [collectionStatus, setCollectionStatus] = useState("");
  const [stabilizationStatus, setStabilizationStatus] = useState(null);
  const [slidingWindowStatus, setSlidingWindowStatus] = useState(null);
  const readingWs = useRef(null);
  const readingKeyRef = useRef("");
  const [activeCollectionDetails, setActiveCollectionDetails] = useState(null);
  const reconnectTimeout = useRef(null);
  const [timerState, setTimerState] = useState({
    isActive: false,
    duration: 0,
    label: "",
  });
  const [failedTPKeys, setFailedTPKeys] = useState(new Set());

  const [bulkRunProgress, setBulkRunProgress] = useState({
    current: 0,
    total: 0,
    pointKey: null,
  });
  // True between the backend asking the operator to verify the 8100
  // amplifier range and the operator confirming it. The calibration
  // doesn't *actually* start until that confirmation lands, so UI
  // affordances that signal "calibration is live" (the seal's green
  // glow and spin animation) gate on this flag being false.
  const [awaitingAmplifierConfirmation, setAwaitingAmplifierConfirmation] = useState(false);
  const [focusedTPKey, setFocusedTPKey] = useState(null);

  const switchWs = useRef(null);
  const [switchStatus, setSwitchStatus] = useState({
    status: "Disconnected",
    isConnected: false,
  });

  const [lastMessage, setLastMessage] = useState(null);
  const [dataRefreshTrigger, setDataRefreshTrigger] = useState(0);
  const heartbeatTimeout = useRef(null);
  // Dedupe guard for ``live_state_sync`` snapshots. React StrictMode and the
  // remote's reconnect logic both cause the WS to open twice in quick
  // succession during development, which means we receive the same server
  // snapshot twice and end up dispatching two identical setState cascades
  // (+ two fetchSessionData fires via dataRefreshTrigger). On anything with
  // a non-trivial test-point tree that's enough to trip React's "maximum
  // update depth" guard. A tiny fingerprint + timestamp lets us silently
  // drop the second copy.
  const lastLiveSyncSigRef = useRef({ sig: null, ts: 0 });
  const hostSyncWs = useRef(null);
  const selectedSessionIdRef = useRef(selectedSessionId);
  // Mirror the active cycle (set by calibration_stage_update) so the
  // dual_reading_update handler can tag live points without re-rendering
  // every time `activeCollectionDetails` changes.
  const activeCycleRef = useRef(null);

  const [myClientId] = useState(() => Math.random().toString(36).substring(2, 15));
  const [claimedWorkstations, setClaimedWorkstations] = useState({});
  const [activeHostSessionIds, setActiveHostSessionIds] = useState([]);

  // Observer mode is an explicit per-session choice. A browser can be connected
  // to a remote host over the network and still act as an operator for its own
  // calibration session.
  const [isRemoteViewer, setIsRemoteViewer] = useState(false);
  const [observedSessionId, setObservedSessionId] = useState(null);

  // Tracks whether the host-sync WebSocket has delivered at least one
  // ``session_changed`` message since mount. The SessionManager dropdown
  // gates selection on this flag so a user can't pick a session before the
  // server has told us which (if any) are currently being hosted — that
  // window is how the "silent observer-mode downgrade" race used to hit.
  const [hostSyncSynced, setHostSyncSynced] = useState(false);
  // One-shot notice surfaced when the supervisor forces us into observer
  // mode (e.g. a race where two clients reach the same IDLE session at
  // once and the server elects the other as host). App.js watches this
  // and shows a user-visible toast, then clears the notice.
  const [roleDowngradeNotice, setRoleDowngradeNotice] = useState(null);

  // Keep a ref of the session ID to avoid stale closures in the WebSocket events
  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  // --- Switch Driver WebSocket Logic ---
  useEffect(() => {
    if (switchDriverAddress && switchDriverModel) {
      const socketUrl = `${WS_BASE_URL}/switch/${switchDriverModel}/${encodeURIComponent(
        switchDriverAddress
      )}/`;
      switchWs.current = new WebSocket(socketUrl);

      switchWs.current.onopen = () => {
        setSwitchStatus({ status: "Unknown", isConnected: true });
      };

      switchWs.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (
          data.type === "connection_established" ||
          data.type === "source_changed" ||
          data.type === "status_update"
        ) {
          setSwitchStatus({ status: data.active_source, isConnected: true });
        }
      };

      switchWs.current.onclose = () => {
        setSwitchStatus({ status: "Disconnected", isConnected: false });
      };

      switchWs.current.onerror = () => {
        setSwitchStatus({ status: "Error", isConnected: false });
      };

      return () => {
        if (switchWs.current) switchWs.current.close();
      };
    } else {
      setSwitchStatus({ status: "Disconnected", isConnected: false });
    }
  }, [switchDriverAddress, switchDriverModel]);

  // --- Host Session Auto-Sync Logic ---
  useEffect(() => {
    const connectHostSync = () => {
      hostSyncWs.current = new WebSocket(`${WS_BASE_URL}/host-sync/`);

      hostSyncWs.current.onopen = () => {
        // Announce our role first thing so the server can place us into the
        // presence registry. Host-only broadcasts (e.g. viewer_presence)
        // gate on this, so the identify has to land before anything else.
        hostSyncWs.current.send(JSON.stringify({
          command: "identify",
          role: isRemoteViewer ? "remote" : "host",
        }));

        if (isRemoteViewer) {
          // Belt-and-suspenders pull of the host's active session. The server
          // already pushes ``session_changed`` on connect, but reconnect
          // flurries (reload → WS open, or a flaky network
          // that forces the socket to retry) can race the initial send with
          // the client's onmessage handler. Re-asking here is idempotent
          // because the server unicasts only to us.
          hostSyncWs.current.send(JSON.stringify({
            command: "request_session_state",
          }));
        }

        // If the Host connects, assert their current session to the server
        if (!isRemoteViewer && selectedSessionIdRef.current !== null) {
          hostSyncWs.current.send(JSON.stringify({
            command: "set_session",
            session_id: selectedSessionIdRef.current
          }));
        }
      };

      hostSyncWs.current.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "session_changed") {
          // Flip the sync gate the first time the server tells us who's
          // hosting what. SessionManager uses this to unlock the dropdown,
          // which closes the tiny window where a late click could race an
          // un-populated activeHostSessionIds and land us in observer mode.
          setHostSyncSynced(true);

          // --- Extract active session IDs for the SessionManager dropdown ---
          // This must run for everyone so the UI can mark active sessions in
          // the dropdown before a user chooses whether to observe one.
          if (data.active_sessions) {
            const activeIdsArray = Object.values(data.active_sessions);
            setActiveHostSessionIds(activeIdsArray);
          } else {
            setActiveHostSessionIds([]);
          }

          // Observer mode follows only the session the user explicitly chose.
          // Normal operators still receive active-session metadata for the
          // dropdown, but their selected session is never overwritten.
          if (isRemoteViewer) {
            // ``data.session_id`` is the *legacy* single active session scalar.
            // It is often null on first push or in multi-host maps before the
            // row the observer cares about is the one the scalar picks. Under
            // the old (session_id == null) branch we called
            // setSelectedSessionId(null), which briefly cleared the session
            // the user had just selected to observe — the full UI flicker.
            // Observers keep `selectedSessionId` aligned with `observedSessionId`
            // from `observeSession`; we only nudge the state if the server
            // reports a *matching* id. Never clobber the selection to null here.
            if (data.session_id != null) {
              if (data.session_id.toString() === observedSessionId?.toString()) {
                setSelectedSessionId(data.session_id);
              }
            }
            // Receipt of session_changed is enough to end any "connecting" UI
            // until host-sync drops again.
            setHostSessionKnown(true);
          }
        } else if (data.type === "viewer_presence") {
          // The backend only pushes this to hosts, but guard anyway so a
          // misrouted message can never populate stale state on a remote.
          if (!isRemoteViewer) {
            setObservers(Array.isArray(data.observers) ? data.observers : []);
          }
        } else if (data.type === "workstation_claims_update") {
          // Store the current registry of locked workstations
          setClaimedWorkstations(data.claims || {});
        }
      };

      hostSyncWs.current.onclose = () => {
        // Clear stale presence on disconnect; a reconnect will refill it
        // from the next viewer_presence broadcast the server sends.
        setObservers([]);
        // A remote that loses host-sync no longer has an authoritative view
        // of the host's session, so reset the known flag. The UI falls back
        // to the "connecting…" state until the next session_changed arrives.
        if (isRemoteViewer) setHostSessionKnown(false);
        // Drop the sync gate so SessionManager re-disables the dropdown
        // until the next session_changed arrives — same reasoning as on
        // initial mount: picking a session against stale active_sessions
        // data is how the race silently downgrades us to observer.
        setHostSyncSynced(false);
        setTimeout(connectHostSync, 3000);
      };
    };

    connectHostSync();

    return () => {
      if (hostSyncWs.current) {
        hostSyncWs.current.onclose = null;
        hostSyncWs.current.close();
      }
    };
  }, [isRemoteViewer, observedSessionId]);

  // Broadcast changes whenever the Host clicks a different session
  useEffect(() => {
    if (!isRemoteViewer && hostSyncWs.current?.readyState === WebSocket.OPEN) {
      hostSyncWs.current.send(JSON.stringify({
        command: "set_session",
        session_id: selectedSessionId
      }));
    }
  }, [selectedSessionId, isRemoteViewer]);

  const observeSession = useCallback((sessionId) => {
    if (!sessionId) return;
    setObservedSessionId(sessionId);
    setIsRemoteViewer(true);
    setSelectedSessionId(sessionId);
    setHostSessionKnown(true);
  }, []);

  // Wipe every session- and instrument-scoped field back to its unselected
  // default. Hoisted from SessionManager into the context so the
  // Leave-Observer affordance in the app header can trigger it too
  // without growing a second copy that drifts out of sync.
  const clearSessionState = useCallback(() => {
    setSelectedSessionId(null);
    setSelectedSessionName("");
    setStdInstrumentAddress(null);
    setStdReaderModel(null);
    setStdReaderSN(null);
    setStdReaderInput("FRONT");
    setTiInstrumentAddress(null);
    setTiReaderModel(null);
    setTiReaderSN(null);
    setTiReaderInput("REAR");
    setAcSourceAddress(null);
    setAcSourceSN(null);
    setDcSourceAddress(null);
    setDcSourceSN(null);
    setSwitchDriverAddress(null);
    setSwitchDriverModel(null);
    setSwitchDriverSN(null);
    setReaderSwitchDriverAddress(null);
    setReaderSwitchDriverModel(null);
    setReaderSwitchDriverSN(null);
    setReaderSwitchStandardRoute("OPEN");
    setReaderSwitchSettlingTime(1);
    setAmplifierAddress(null);
    setAmplifierSN(null);
    setStandardTvcSn(null);
    setTestTvcSn(null);
    setStandardInstrumentSerial(null);
    setTestInstrumentSerial(null);
    setFailedTPKeys(new Set());
  }, []);

  const leaveObserverMode = useCallback(() => {
    setIsRemoteViewer(false);
    setObservedSessionId(null);
    setHostSessionKnown(false);
    // Drop the selected session + instrument form along with observer
    // state. Without this, the readingWs effect would re-dial the same
    // active session on the next render, and the supervisor would
    // immediately downgrade us back into observer mode — the bug we just
    // tried to leave. Clearing the form makes the UI land on a clean
    // Session Setup pane, which is what a user expects when they "leave".
    clearSessionState();
  }, [clearSessionState]);

  // Stable callback so the App.js effect that consumes
  // ``roleDowngradeNotice`` doesn't churn on every provider re-render.
  const clearRoleDowngradeNotice = useCallback(() => {
    setRoleDowngradeNotice(null);
  }, []);

  const setSwitchSource = useCallback(
    (source) => {
      return new Promise((resolve, reject) => {
        if (!switchDriverAddress) {
          return resolve();
        }
        if (
          switchWs.current &&
          switchWs.current.readyState === WebSocket.OPEN
        ) {
          switchWs.current.send(
            JSON.stringify({ command: "select_source", source: source })
          );
          resolve();
        } else {
          reject(new Error("Switch is not connected."));
        }
      });
    },
    [switchDriverAddress]
  );

  // --- Workstation Claiming Functions ---
  const sendWorkstationClaim = useCallback((ip) => {
    // Only allow hosts to claim hardware
    if (!isRemoteViewer && hostSyncWs.current?.readyState === WebSocket.OPEN) {
      hostSyncWs.current.send(JSON.stringify({
        command: "claim_workstation",
        ip: ip,
        client_id: myClientId
      }));
    }
  }, [isRemoteViewer, myClientId]);

  const sendWorkstationRelease = useCallback((ip) => {
    if (!isRemoteViewer && hostSyncWs.current?.readyState === WebSocket.OPEN) {
      hostSyncWs.current.send(JSON.stringify({
        command: "release_workstation",
        ip: ip
      }));
    }
  }, [isRemoteViewer]);

  // --- Collection WebSocket Logic ---
  const clearLiveReadings = useCallback(() => {
    setLiveReadings(initialLiveReadings);
    setTiLiveReadings(initialLiveReadings);
  }, []);

  const connectWebSocket = useCallback(() => {
    if (
      !selectedSessionId ||
      (readingWs.current && readingWs.current.readyState < 2)
    )
      return;
    if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
    if (heartbeatTimeout.current) clearTimeout(heartbeatTimeout.current);

    // Append ?role=remote on observer sessions so the backend can defensively
    // reject host-only commands (start/stop/amplifier/etc.) even if a client
    // sidesteps the UI-level gates. Host sockets stay unadorned.
    const socketUrl = `${WS_BASE_URL}/collect-readings/${selectedSessionId}/${
      isRemoteViewer ? "?role=remote" : ""
    }`;

    readingWs.current = new WebSocket(socketUrl);
    setReadingWsState(readingWs.current.readyState);

    readingWs.current.onopen = () => {
      setReadingWsState(readingWs.current.readyState);
      
      // Ask the Host for its live chart data if joining late!
      if (isRemoteViewer) {
        readingWs.current.send(JSON.stringify({ command: "request_live_sync" }));
      }
    };

    readingWs.current.onclose = () => {
      if (heartbeatTimeout.current) clearTimeout(heartbeatTimeout.current);
      setReadingWsState(WebSocket.CLOSED);
      if (selectedSessionId)
        reconnectTimeout.current = setTimeout(connectWebSocket, 3000);
    };

    readingWs.current.onerror = () =>
      setReadingWsState(readingWs.current.readyState);

    readingWs.current.onmessage = (event) => {
      if (heartbeatTimeout.current) clearTimeout(heartbeatTimeout.current);
      heartbeatTimeout.current = setTimeout(() => {
        console.log(
          "Heartbeat timeout: No message received in 75s. Reconnecting."
        );
        if (readingWs.current) {
          readingWs.current.close();
        }
      }, 75000);

      const data = JSON.parse(event.data);

      if (data.type === "role_assigned") {
        // The supervisor can still downgrade a racing client. Reflect that
        // server-side decision in the UI so controls become read-only.
        if (data.role === "remote") {
          const wasAlreadyObserving = isRemoteViewer;
          setObservedSessionId(selectedSessionId);
          setIsRemoteViewer(true);
          setHostSessionKnown(true);
          if (readingWs.current?.readyState === WebSocket.OPEN) {
            readingWs.current.send(JSON.stringify({ command: "request_live_sync" }));
          }
          // Surface a one-shot notice only for the race path: the user
          // thought they were starting as host but the server elected
          // someone else. When the user *already* chose to observe (via
          // SessionManager → observeSession), the "role_assigned: remote"
          // is just confirmation of their deliberate action, and a toast
          // would be noise.
          if (!wasAlreadyObserving) {
            setRoleDowngradeNotice({
              sessionId: selectedSessionId,
              message:
                "Another user is already hosting this session. You have " +
                "joined as an observer — controls are read-only until you " +
                "start your own session or the host leaves.",
              at: Date.now(),
            });
          }
        }
        return;
      }

      if (data.type === "live_state_sync") {
        // Authoritative snapshot from the server-side live buffer. Apply it
        // unconditionally so late-joining remotes see every completed stage,
        // and so a remote joining between runs correctly resets to idle.
        //
        // The server stores ``t`` as an integer millisecond epoch so the
        // payload stays JSON-friendly; every other code path that fills
        // ``liveReadings`` uses ``new Date(...)``. Rehydrate on arrival so
        // the chart tooltip's ``toLocaleTimeString`` call finds the Date
        // shape it expects, regardless of which path produced the point.
        if (isRemoteViewer) {
          // StrictMode + WS reconnects can deliver the same snapshot twice
          // within a few hundred ms. Fingerprint on the fields that actually
          // drive renders so an identical replay is a no-op. We stringify
          // after dropping the Date object keys since those are rebuilt
          // deterministically from the numeric ``t`` the server sent.
          const sig = JSON.stringify({
            c: Boolean(data.isCollecting),
            d: data.activeCollectionDetails || null,
            lr: data.liveReadings || null,
            tr: data.tiLiveReadings || null,
            p: data.collectionProgress || null,
            f: data.focusedTPKey || null,
          });
          const now = Date.now();
          const prev = lastLiveSyncSigRef.current;
          if (prev.sig === sig && now - prev.ts < 2000) {
            return;
          }
          lastLiveSyncSigRef.current = { sig, ts: now };

          const rehydrateStageMap = (stageMap) => {
            if (!stageMap || typeof stageMap !== "object") return {};
            const out = {};
            Object.keys(stageMap).forEach((stage) => {
              const arr = stageMap[stage];
              out[stage] = Array.isArray(arr)
                ? arr.map((p) =>
                    p && typeof p === "object" && typeof p.t === "number"
                      ? { ...p, t: new Date(p.t) }
                      : p
                  )
                : arr;
            });
            return out;
          };

          setIsCollecting(Boolean(data.isCollecting));
          setActiveCollectionDetails(data.activeCollectionDetails || null);

          // Rehydrate a pre-measurement countdown (warm-up / settling) from
          // the snapshot. A remote joining mid-warm-up missed the one-shot
          // ``status_update`` broadcast, so this is the only way it learns the
          // timer is running. ``endsAt`` is a server epoch; convert it to a
          // local ``targetTime`` using the server clock we were sent so the
          // countdown is correct despite client/server skew. An already-
          // expired (or inactive) timer resets to idle.
          const syncedTimer = data.timerState;
          if (syncedTimer && syncedTimer.isActive && data.serverNow != null) {
            const remainingSeconds = syncedTimer.endsAt - data.serverNow;
            if (remainingSeconds > 0) {
              setTimerState({
                isActive: true,
                duration: syncedTimer.duration,
                targetTime: Date.now() + remainingSeconds * 1000,
                label: syncedTimer.label || "Warm-up",
              });
            } else {
              setTimerState({ isActive: false, duration: 0, label: "" });
            }
          } else if (!data.isCollecting) {
            // Snapshot says the run is fully idle — clear any stale timer the
            // remote may have been showing from a previous run.
            setTimerState({ isActive: false, duration: 0, label: "" });
          }
          setLiveReadings({ ...initialLiveReadings, ...rehydrateStageMap(data.liveReadings) });
          setTiLiveReadings({ ...initialLiveReadings, ...rehydrateStageMap(data.tiLiveReadings) });
          if (data.collectionProgress) setCollectionProgress(data.collectionProgress);
          if (data.focusedTPKey) setFocusedTPKey(data.focusedTPKey);
          setDataRefreshTrigger((prev) => prev + 1);
        }
        return;
      }

      if (data.type === "warning" && data.message && data.message.toLowerCase().includes("stability limit")) {
        if (data.tpKey) {
          setFailedTPKeys((prev) => new Set(prev).add(data.tpKey));
        }
      }

      if (data.type === "ping") return;

      if (data.type === "connection_sync") {
        // Dedupe replays (StrictMode double-mount, reconnects) so we don't
        // kick two identical fetchSessionData cascades back-to-back — the
        // second one is pure noise and occasionally lands in the same tick
        // as other setStates, which is what tipped the "maximum update
        // depth" guard on the remote.
        const sig = JSON.stringify({
          c: Boolean(data.is_complete),
          m: data.message || null,
        });
        const now = Date.now();
        const prev = lastLiveSyncSigRef.current;
        if (prev.sig === `cs:${sig}` && now - prev.ts < 2000) {
          return;
        }
        lastLiveSyncSigRef.current = { sig: `cs:${sig}`, ts: now };

        console.log("Received connection sync. Status:", data);

        if (data.is_complete) {
          // It's finished. Let the "collection_finished" block handle the final data refresh.
          setIsCollecting(false);
          setCollectionStatus("collection_finished");
        } else {
          // It's a mid-run sync. Trigger the UI to update.
          setDataRefreshTrigger((prev) => prev + 1);
        }
        return;
      }

      setLastMessage(data);

      // Track the 8100 amplifier-confirmation gate. The backend pauses
      // here until the operator confirms the range on the host. Any
      // message that indicates the run has actually started (a stage
      // change, a reading, batch progress, or an end-of-collection
      // signal) implicitly clears the wait.
      if (data.type === "awaiting_amplifier_confirmation") {
        setAwaitingAmplifierConfirmation(true);
      } else if (
        data.type === "calibration_stage_update" ||
        data.type === "dual_reading_update" ||
        data.type === "batch_progress_update" ||
        data.type === "stabilization_update" ||
        data.type === "sliding_window_update" ||
        data.type === "collection_finished" ||
        data.type === "collection_stopped" ||
        data.type === "error"
      ) {
        setAwaitingAmplifierConfirmation(false);
      }

      if (data.type === "calibration_stage_update") {
        const updates = { stage: data.stage };
        if (data.tpId) updates.tpId = data.tpId;
        // Track the cycle ordinal that's currently mid-flight so live
        // readings can be tagged with it (used by CalibrationChart's
        // cycle-filter and by the cycle statistics view).
        const incomingCycle = data.cycle_index;
        if (incomingCycle != null) {
          updates.cycle_index = incomingCycle;
          activeCycleRef.current = incomingCycle;
        }
        setActiveCollectionDetails((prev) => ({ ...prev, ...updates }));

        setIsCollecting(true);

        if (data.total !== undefined) setCollectionProgress({ count: 0, total: data.total });

        // Drop only the data we're about to overwrite for THIS stage at
        // THIS cycle. Earlier cycles' samples for the same stage stay so
        // the chart's cycle-picker still has them to render after the
        // current cycle takes over. On cycle 1 (or when cycle is null)
        // this collapses to "clear the stage entirely" — same behavior
        // as before the N-cycle workflow existed.
        const dropCurrentCycleForStage = (prev) => {
          const list = prev[data.stage] || [];
          if (incomingCycle == null || incomingCycle <= 1) {
            return { ...prev, [data.stage]: [] };
          }
          const filtered = list.filter((p) => {
            const c = Number.isFinite(p?.cycle) ? Number(p.cycle) : 1;
            return c !== incomingCycle;
          });
          return { ...prev, [data.stage]: filtered };
        };
        setLiveReadings(dropCurrentCycleForStage);
        setTiLiveReadings(dropCurrentCycleForStage);
        setTimerState({ isActive: false, duration: 0, label: "" });
      } else if (data.type === "paired_collection_reset") {
        const key = data.stage;
        if (key) {
          setLiveReadings((prev) => ({ ...prev, [key]: [] }));
          setTiLiveReadings((prev) => ({ ...prev, [key]: [] }));
        }
        setCollectionProgress({ count: 0, total: Number(data.total) || 0 });
      } else if (data.type === "dual_reading_update") {
        setIsCollecting(true);
        const key = data.stage;
        if (key) {
          const stdReadingData = data.std_reading;
          const tiReadingData = data.ti_reading;

          const updateReadings = (prevReadings, point) => {
            const newReadings = [...(prevReadings[key] || [])];
            // Dedupe by (x, cycle) — sample x indices reset every cycle so
            // x alone would let cycle 2's x=1 overwrite cycle 1's x=1, which
            // wipes the older cycle the chart filter needs. `cycle` may be
            // undefined on legacy / pre-cycle data; that case still dedupes
            // by x exactly as it did before this change.
            const pointCycle = point?.cycle;
            const existingIndex = newReadings.findIndex(
              (p) => p.x === point.x && p?.cycle === pointCycle
            );
            if (existingIndex > -1) {
              newReadings[existingIndex] = point;
            } else {
              newReadings.push(point);
            }
            // A live stage represents one active cycle.  Sequential readers
            // can deliver at different wall-clock times, but neither series
            // should ever render more than the operator-requested sample
            // count while the pair is completing.
            const total = Number(data.total);
            if (Number.isFinite(total) && total > 0) {
              const thisCycle = newReadings.filter((candidate) => candidate?.cycle === pointCycle);
              if (thisCycle.length > total) {
                const overflow = thisCycle.length - total;
                const remove = new Set(thisCycle.slice(0, overflow));
                return {
                  ...prevReadings,
                  [key]: newReadings.filter((candidate) => !remove.has(candidate)),
                };
              }
            }
            return { ...prevReadings, [key]: newReadings };
          };

          // Tag each live point with the cycle that's currently in flight
          // (read from the ref so we don't depend on the rendered closure).
          const liveCycle =
            data.cycle_index != null ? data.cycle_index : activeCycleRef.current;

          // ONLY parse and update STD readings if the data is not null
          if (stdReadingData !== null && stdReadingData !== undefined) {
            const stdPoint = {
              x: data.count,
              y: stdReadingData.value,
              t: new Date(stdReadingData.timestamp * 1000),
              is_stable: stdReadingData.is_stable,
              cycle: liveCycle,
            };
            setLiveReadings((readings) => updateReadings(readings, stdPoint));
          }

          // ONLY parse and update TI readings if the data is not null
          if (tiReadingData !== null && tiReadingData !== undefined) {
            const tiPoint = {
              x: data.count,
              y: tiReadingData.value,
              t: new Date(tiReadingData.timestamp * 1000),
              is_stable: tiReadingData.is_stable,
              cycle: liveCycle,
            };
            setTiLiveReadings((readings) => updateReadings(readings, tiPoint));
          }
        }

        // Progress bar should reflect incoming sample flow in real time.
        // ``stable_count`` is intentionally conservative for sliding-window
        // mode and can sit at 0 during the search phase, which makes the
        // UI look frozen. Use ``count`` first so the bar grows per sample.
        const liveCount =
          data.count !== undefined ? data.count : data.stable_count;
        setCollectionProgress({
          count: Number.isFinite(liveCount) ? liveCount : 0,
          total: Number.isFinite(data.total) ? data.total : 0,
        });
        setTimerState({ isActive: false, duration: 0, label: "" });
      } else if (data.type === "stabilization_update") {
        setStabilizationStatus(
          `[${data.count}/${data.max_attempts}] Reading: ${data.reading.toFixed(
            6
          )} V, Stdev: ${data.stdev_ppm} PPM`
        );
        setTimerState({ isActive: false, duration: 0, label: "" });
      } else if (data.type === "sliding_window_update") {
        setStabilizationStatus(null);
        setSlidingWindowStatus(
          data.stdev_ppm === null
            ? null
            : {
              ppm: data.stdev_ppm,
              std_ppm: data.std_stdev_ppm ?? null,
              ti_ppm: data.ti_stdev_ppm ?? null,
              is_stable: data.is_stable,
              instability_events: data.instability_events,
              max_retries: data.max_retries
            }
        );
      } else if (data.type === "batch_progress_update") {
        const { test_point, current, total } = data;
        if (current > 1) clearLiveReadings();
        if (test_point) {
          const pointKey = `${test_point.current}-${test_point.frequency}`;
          setFocusedTPKey(pointKey);
          setBulkRunProgress({ current, total, pointKey });
          setActiveCollectionDetails((prev) => ({
            ...(prev || {}),
            tpId: test_point.id ?? prev?.tpId,
            frequency: test_point.frequency ?? prev?.frequency,
            num_samples: test_point.num_samples ?? prev?.num_samples,
            settling_time: test_point.settling_time ?? prev?.settling_time,
            nplc: test_point.nplc ?? prev?.nplc,
            measurement_params: test_point.measurement_params
              ?? prev?.measurement_params,
          }));

          setIsCollecting(true);
        }
      } else if (data.type === "status_update") {
        const message = data.message;
        let match;

        if ((match = message.match(/Initial warm-up period started for (\d+\.?\d*)s/))) {
          const duration = parseFloat(match[1]);
          const targetTime = Date.now() + (duration * 1000);
          setTimerState({ isActive: true, duration: duration, targetTime: targetTime, label: "Warm-up" });
          // A pre-measurement countdown means the run has moved past the
          // 8100 amplifier-confirm gate (the operator pressed Proceed, but
          // the modal's onConfirm doesn't clear this flag, and only
          // stage/reading messages — which don't flow during warm-up — would
          // otherwise clear it). Without this the host's green glow stays
          // suppressed for the entire warm-up.
          setAwaitingAmplifierConfirmation(false);
          // Mark the run active and pin the warming-up point so observers
          // pulse the same row the host does during warm-up. The host already
          // set both optimistically in startReadingCollection; for a remote
          // this status_update is the only signal until the first
          // calibration_stage_update fires (after warm-up). ``tpId`` is merged
          // (not replaced) so we don't clobber the host's richer details.
          setIsCollecting(true);
          if (data.tpId != null) {
            setActiveCollectionDetails((prev) => ({ ...(prev || {}), tpId: data.tpId }));
          }
        } else if ((match = message.match(/Settling for (\d+\.?\d*)s/))) {
          const duration = parseFloat(match[1]);
          const targetTime = Date.now() + (duration * 1000);
          setTimerState({ isActive: true, duration: duration, targetTime: targetTime, label: "Settling" });
          setAwaitingAmplifierConfirmation(false);
        }
      } else if (
        [
          "collection_finished",
          "collection_stopped",
          "error",
          "warning",
        ].includes(data.type)
      ) {
        if (data.type !== "warning") {
          setCollectionStatus(data.type);
          setIsCollecting(false);
          setActiveCollectionDetails(null);
          readingKeyRef.current = "";
          setBulkRunProgress({ current: 0, total: 0, pointKey: null });
          setFocusedTPKey(null);
          setDataRefreshTrigger((prev) => prev + 1);
          // Clear paired-run state if the run ended (stopped / errored
          // mid-pass). `paired_run_complete` is the happy-path counterpart
          // and is handled below; both routes reset the modal.
          setPairedRun({ inProgress: false, awaitingFlip: false, pass: null });
        }
        setStabilizationStatus(null);
        setSlidingWindowStatus(null);
        setTimerState({ isActive: false, duration: 0, label: "" });
      } else if (data.type === "paired_run_pass_started") {
        setPairedRun({
          inProgress: true,
          awaitingFlip: false,
          pass: data.pass_direction || null,
        });
      } else if (data.type === "paired_run_awaiting_flip") {
        // Forward pass done; show the flip modal and stop expecting
        // sample broadcasts until the operator resumes.
        setPairedRun({ inProgress: true, awaitingFlip: true, pass: 'Forward' });
        setIsCollecting(false);
      } else if (data.type === "paired_run_resuming") {
        setPairedRun({ inProgress: true, awaitingFlip: false, pass: 'Reverse' });
      } else if (data.type === "paired_run_complete") {
        setPairedRun({ inProgress: false, awaitingFlip: false, pass: null });
        setIsCollecting(false);
        // Trigger a final data refresh so the new pair_delta / pair_uA
        // values are rendered (recompute_pair_aggregate has already
        // mirrored them onto both CalibrationResults rows by this point).
        setDataRefreshTrigger((prev) => prev + 1);
      } else if (data.type === "switch_status_update") {
        setSwitchStatus({ status: data.active_source, isConnected: true });
      }
    };
  }, [selectedSessionId, setSwitchStatus, clearLiveReadings, isRemoteViewer]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (
          selectedSessionId &&
          (!readingWs.current ||
            readingWs.current.readyState === WebSocket.CLOSED)
        ) {
          connectWebSocket();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [selectedSessionId, connectWebSocket]);

  useEffect(() => {
    if (selectedSessionId) connectWebSocket();
    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      if (readingWs.current) {
        readingWs.current.onclose = null;
        readingWs.current.close();
      }
    };
  }, [selectedSessionId, connectWebSocket]);

  // --- Reset UI State on Session Change ---
  useEffect(() => {
    setCollectionStatus("");
    setLastMessage(null);
    setCollectionProgress({ count: 0, total: 0 });
    setStabilizationStatus(null);
    setSlidingWindowStatus(null);
    setIsCollecting(false);
    setTimerState({ isActive: false, duration: 0, label: "" });
    setFailedTPKeys(new Set());
  }, [selectedSessionId]);

  // --- Instrument Status & Control Logic ---

  const decodeInstrumentStatus = (model, isrString) => {
    if (!isrString || typeof isrString !== "string")
      return { error: "Invalid ISR string." };
    const bits = isrString
      .padStart(16, "0")
      .split("")
      .map((bit) => bit === "1");
    return {
      OPER: bits[0], EXTGARD: bits[1], EXTSENS: bits[2], BOOST: bits[3],
      RCOMP: bits[4], RLOCK: bits[5], PSHIFT: bits[6], PLOCK: bits[7],
      OFFSET: bits[8], SCALE: bits[9], WBND: bits[10], REMOTE: bits[11],
      SETTLED: bits[12], ZERO_CAL: bits[13], AC_XFER: bits[14], UNUSED_15: bits[15],
    };
  };

  // Keep refs in sync on every render so the stable callback always sees current values.
  isFetchingStatusesRef.current = isFetchingStatuses;
  zeroingInstrumentsRef.current = zeroingInstruments;

  const getInstrumentStatus = useCallback(
    async (instrumentModel, gpibAddress) => {
      if (zeroingInstrumentsRef.current[gpibAddress]) {
        console.log(`Skipping status poll for ${gpibAddress} (Zeroing in progress)`);
        return;
      }

      if (
        !instrumentModel ||
        !gpibAddress ||
        isFetchingStatusesRef.current[gpibAddress] ||
        (statusWs.current[gpibAddress] &&
          statusWs.current[gpibAddress].readyState === WebSocket.CONNECTING)
      )
        return;

      setIsFetchingStatuses((prev) => ({ ...prev, [gpibAddress]: true }));

      // Same role gate as collect-readings: observers get ?role=remote so
      // the backend can reject run_zero_cal even if it arrives on the wire.
      const socketUrl = `${WS_BASE_URL}/status/${instrumentModel}/${encodeURIComponent(
        gpibAddress
      )}/${isRemoteViewer ? "?role=remote" : ""}`;

      if (statusWs.current[gpibAddress] && statusWs.current[gpibAddress].readyState !== WebSocket.OPEN) {
        statusWs.current[gpibAddress].close();
      }

      let ws = statusWs.current[gpibAddress];
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setInstrumentStatuses((prev) => ({
          ...prev,
          [gpibAddress]: { error: null, wsConnectionState: "Connecting..." },
        }));
        ws = new WebSocket(socketUrl);
        statusWs.current[gpibAddress] = ws;
      }

      ws.onopen = () => {
        ws.send(JSON.stringify({ command: "get_instrument_status" }));
      };

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ command: "get_instrument_status" }));
      }

      // [DIAGNOSIS LOGGING ADDED HERE]
      ws.onmessage = (event) => {
        setIsFetchingStatuses((prev) => ({ ...prev, [gpibAddress]: false }));
        const message = JSON.parse(event.data);

        // --- HANDLE ZERO CAL MESSAGES ---
        if (message.type === 'zero_cal_started') {
          setZeroingInstruments(prev => ({ ...prev, [gpibAddress]: true }));
          setInstrumentStatuses((prev) => ({
            ...prev,
            [gpibAddress]: {
              ...prev[gpibAddress],
              wsConnectionState: "Zeroing in Progress...",
            },
          }));
          return;
        }

        if (message.type === 'zero_cal_complete') {
          console.log(`[WebSocket ${gpibAddress}] Zero Cal COMPLETE confirmed.`); // <--- LOGGING
          setZeroingInstruments(prev => ({ ...prev, [gpibAddress]: false }));
          setInstrumentStatuses((prev) => ({
            ...prev,
            [gpibAddress]: {
              ...prev[gpibAddress],
              wsConnectionState: "Status Received",
            },
          }));
          ws.send(JSON.stringify({ command: "get_instrument_status" }));
          return;
        }

        if (message.type === 'error' && message.message_text && message.message_text.includes("Zero")) {
          console.error(`[WebSocket ${gpibAddress}] Zero Cal ERROR:`, message.message_text); // <--- LOGGING
          setZeroingInstruments(prev => ({ ...prev, [gpibAddress]: false }));
        }
        // --------------------------------

        if (message.status_report === "ok") {
          setInstrumentStatuses((prev) => ({
            ...prev,
            [gpibAddress]: {
              raw: message.raw_isr,
              decoded: decodeInstrumentStatus(instrumentModel, message.raw_isr),
              error: null,
              lastCheck: new Date(
                message.timestamp * 1000
              ).toLocaleTimeString(),
              wsConnectionState: "Status Received",
            },
          }));
        } else if (message.status_report === "error") {
          if (!zeroingInstrumentsRef.current[gpibAddress]) {
            setInstrumentStatuses((prev) => ({
              ...prev,
              [gpibAddress]: {
                ...prev[gpibAddress],
                error: message.error_message || "Error fetching status.",
                wsConnectionState: "Error (Fetching)",
              },
            }));
          }
        }
      };

      ws.onerror = (e) => {
        console.error(`[WebSocket ${gpibAddress}] ERROR:`, e);
        setIsFetchingStatuses((prev) => ({ ...prev, [gpibAddress]: false }));
      };

      ws.onclose = (e) => {
        console.warn(`[WebSocket ${gpibAddress}] CLOSED. Code: ${e.code}, Reason: ${e.reason}`);
        setIsFetchingStatuses((prev) => ({ ...prev, [gpibAddress]: false }));
      }
    },
    [isRemoteViewer] // Role feeds the ?role=remote query param on the status URL
  );

  const runZeroCal = useCallback((instrumentModel, gpibAddress) => {
    const ws = statusWs.current[gpibAddress];
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log(`Sending Zero Cal command to ${gpibAddress}`);
      setZeroingInstruments(prev => ({ ...prev, [gpibAddress]: true }));
      setInstrumentStatuses((prev) => ({
        ...prev,
        [gpibAddress]: {
          ...prev[gpibAddress],
          wsConnectionState: "Zeroing in Progress...",
        },
      }));
      ws.send(JSON.stringify({ command: "run_zero_cal" }));
    } else {
      console.error(`Cannot send Zero Cal: WebSocket not open for ${gpibAddress}`);
    }
  }, []);

  const setAmplifierRange = (range) => {
    return new Promise((resolve, reject) => {
      if (readingWs.current?.readyState === WebSocket.OPEN) {
        const timeout = setTimeout(() => {
          readingWs.current.removeEventListener("message", tempHandler);
          reject(new Error("Request to set amplifier range timed out."));
        }, 10000);

        const tempHandler = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === "amplifier_range_set") {
            clearTimeout(timeout);
            readingWs.current.removeEventListener("message", tempHandler);
            resolve(data.message);
          } else if (
            data.type === "error" &&
            data.message.includes("amplifier")
          ) {
            clearTimeout(timeout);
            readingWs.current.removeEventListener("message", tempHandler);
            reject(new Error(data.message));
          }
        };
        readingWs.current.addEventListener("message", tempHandler);

        readingWs.current.send(
          JSON.stringify({
            command: "set_amplifier_range",
            amplifier_range: range,
          })
        );
      } else {
        reject(new Error("WebSocket is not connected."));
      }
    });
  };

  const startReadingCollection = (params) => {
    if (readingWs.current?.readyState === WebSocket.OPEN) {
      clearLiveReadings();
      setCollectionStatus("");
      setStabilizationStatus(null);
      // Start with the amplifier-confirm gate latched closed — the
      // backend will either skip straight to data (and the WS handler
      // will clear it) or open the modal with awaiting_amplifier_confirmation
      // (and the operator's "Proceed" resumes the run, after which the
      // first real progress message clears the flag).
      setAwaitingAmplifierConfirmation(false);
      const readingKey = params.reading_type;
      readingKeyRef.current = readingKey || "";
      setIsCollecting(true);
      setCollectionProgress({ count: 0, total: params.num_samples });

      const initialDetails = {
        tpId: params.test_point_id || params.test_points?.[0]?.id || params.forward_points?.[0]?.id,
        command: params.command,             // <-- ADD THIS
        is_pre_batch: params.is_pre_batch,
        readingKey: readingKey,
        stage: readingKey,
        frequency: params.test_point?.frequency
          ?? params.test_points?.[0]?.frequency
          ?? params.forward_points?.[0]?.frequency,
        nplc: params.nplc,
        num_samples: params.num_samples,
        settling_time: params.settling_time,
        initial_warm_up_time: params.initial_warm_up_time,
        n_cycles: params.n_cycles || params.test_points?.[0]?.n_cycles || params.forward_points?.[0]?.n_cycles,
        measurement_params: params.test_point_id
          ? params.measurement_params
          : params.test_points?.[0]?.measurement_params
            ?? params.forward_points?.[0]?.measurement_params
            ?? params.measurement_params,
      };
      
      setActiveCollectionDetails(initialDetails);

      // --- NEW: Immediately tell the UI we are starting a multi-point batch ---
      if (params.test_points) {
        setBulkRunProgress({ current: 1, total: params.test_points.length, pointKey: null });
      } else if (params.forward_points) {
        setBulkRunProgress({ current: 1, total: params.forward_points.length, pointKey: null });
      } else {
        setBulkRunProgress({ current: 0, total: 0, pointKey: null });
      }
      // -------------------------------------------------------------------------

      readingWs.current.send(JSON.stringify(params));
      return true;
    }
    return false;
  };

  const stopReadingCollection = () => {
    if (readingWs.current?.readyState === WebSocket.OPEN) {
      readingWs.current.send(JSON.stringify({ command: "stop_collection" }));
      return true;
    }
    return false;
  };

  const sendWsCommand = useCallback((payload) => {
    if (readingWs.current?.readyState === WebSocket.OPEN) {
      readingWs.current.send(JSON.stringify(payload));
      return true;
    }
    console.error("Cannot send command, WebSocket is not open.");
    return false;
  }, []);

  const contextValue = {
    selectedSessionId,
    setSelectedSessionId,
    selectedSessionName,
    setSelectedSessionName,
    discoveredInstruments,
    setDiscoveredInstruments,
    stdInstrumentAddress,
    setStdInstrumentAddress,
    stdReaderModel,
    setStdReaderModel,
    stdReaderSN,
    setStdReaderSN,
    stdReaderInput,
    setStdReaderInput,
    tiInstrumentAddress,
    setTiInstrumentAddress,
    tiReaderModel,
    setTiReaderModel,
    tiReaderSN,
    setTiReaderSN,
    tiReaderInput,
    setTiReaderInput,
    acSourceAddress,
    setAcSourceAddress,
    acSourceSN,
    setAcSourceSN,
    dcSourceAddress,
    setDcSourceAddress,
    dcSourceSN,
    setDcSourceSN,
    instrumentStatuses,
    switchDriverAddress,
    setSwitchDriverAddress,
    switchDriverModel,
    setSwitchDriverModel,
    switchDriverSN,
    setSwitchDriverSN,
    readerSwitchDriverAddress,
    setReaderSwitchDriverAddress,
    readerSwitchDriverModel,
    setReaderSwitchDriverModel,
    readerSwitchDriverSN,
    setReaderSwitchDriverSN,
    readerSwitchStandardRoute,
    setReaderSwitchStandardRoute,
    readerSwitchSettlingTime,
    setReaderSwitchSettlingTime,
    amplifierAddress,
    setAmplifierAddress,
    amplifierSN,
    setAmplifierSN,
    isFetchingStatuses,
    getInstrumentStatus,
    runZeroCal,
    zeroingInstruments,
    liveReadings,
    setLiveReadings,
    tiLiveReadings,
    setTiLiveReadings,
    initialLiveReadings,
    isCollecting,
    collectionProgress,
    startReadingCollection,
    stopReadingCollection,
    activeCollectionDetails,
    readingWsState,
    collectionStatus,
    setSwitchSource,
    switchStatus,
    clearLiveReadings,
    setAmplifierRange,
    lastMessage,
    sendWsCommand,
    pairedRun,
    stabilizationStatus,
    slidingWindowStatus,
    timerState,
    bulkRunProgress,
    awaitingAmplifierConfirmation,
    focusedTPKey,
    standardTvcSn,
    setStandardTvcSn,
    testTvcSn,
    setTestTvcSn,
    standardInstrumentSerial,
    setStandardInstrumentSerial,
    testInstrumentSerial,
    setTestInstrumentSerial,
    dataRefreshTrigger,
    failedTPKeys,
    setFailedTPKeys,
    observers,
    isRemoteViewer,
    observedSessionId,
    observeSession,
    leaveObserverMode,
    clearSessionState,
    hostSessionKnown,
    myClientId,
    claimedWorkstations,
    sendWorkstationClaim,
    sendWorkstationRelease,
    activeHostSessionIds,
    hostSyncSynced,
    roleDowngradeNotice,
    clearRoleDowngradeNotice,
  };

  return (
    <InstrumentContext.Provider value={contextValue}>
      {children}
    </InstrumentContext.Provider>
  );
};

export const useInstruments = () => useContext(InstrumentContext);
