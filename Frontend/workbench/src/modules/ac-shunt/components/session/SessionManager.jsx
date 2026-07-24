// src/components/session/SessionManager.js
/**
 * @file SessionManager.js
 * @brief Component for selecting, viewing, and resetting calibration sessions.
 * Session *details* (create/edit) live in SessionDetailsForm; that form and
 * SessionSetup together add local history + corrections-database serial
 * suggestions for the session fields — see `sessionFieldHistory` and
 * `SessionDetailsForm` / `SessionSetup`.
 */
import React, { useState, useMemo } from "react";
import axios from "axios";
import { useInstruments } from "../../contexts/InstrumentContext";
import { FaPlus, FaTrashAlt, FaTimes, FaCheck } from "react-icons/fa";
import { API_BASE_URL } from "../../constants/constants";

const ConfirmationModal = ({
  isOpen,
  title,
  children,
  onConfirm,
  onCancel,
  confirmText = "Confirm Delete",
  confirmClassName = "button button-danger",
  eyebrow,
}) => {
  if (!isOpen) return null;
  const isDanger = /danger/.test(confirmClassName);
  const eyebrowText = eyebrow ?? (isDanger ? "Warning" : "Confirm");
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-confirm-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="confirm-modal-header">
          <div className="confirm-modal-header-text">
            <span className="confirm-modal-eyebrow">{eyebrowText}</span>
            <h3 id="session-confirm-modal-title" className="confirm-modal-title">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="cal-results-excel-icon-btn"
            title="Cancel"
            aria-label="Cancel"
          >
            <FaTimes aria-hidden />
          </button>
        </header>
        <div className="confirm-modal-body">
          <div className="confirm-modal-message">{children}</div>
        </div>
        <footer className="confirm-modal-footer confirm-modal-footer--icon">
          <button
            type="button"
            onClick={onConfirm}
            className={`cal-results-excel-icon-btn${isDanger ? " cal-results-excel-icon-btn--danger" : ""}`}
            title={confirmText}
            aria-label={confirmText}
          >
            <FaCheck aria-hidden />
          </button>
        </footer>
      </div>
    </div>
  );
};

// CustomDropdown accepts activeSessionIds to flag live sessions before the
// user chooses whether to observe them.
const CustomDropdown = ({ options, value, onChange, placeholder, disabled, activeSessionIds = [] }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredOptions = useMemo(() =>
    options.filter(opt =>
      opt.session_name.toLowerCase().includes(searchTerm.toLowerCase())
    ), [options, searchTerm]);

  const selectedOption = options.find(opt => opt.id.toString() === value?.toString());
  
  // Create a Set of strings for fast, safe lookup
  const activeIds = new Set((activeSessionIds || []).map(id => id?.toString()));

  return (
    <div className="custom-dropdown-container">
      <button type="button" className="custom-dropdown-trigger" onClick={() => setIsOpen(!isOpen)} disabled={disabled}>
        <span>{selectedOption ? selectedOption.session_name : placeholder}</span>
        <span className={`custom-dropdown-chevron ${isOpen ? 'open' : ''}`}>▼</span>
      </button>
      {isOpen && (
        <div className="custom-dropdown-panel">
          <div className="custom-dropdown-search-wrapper">
            <input
              type="text"
              className="custom-dropdown-search"
              placeholder="Search sessions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus
            />
          </div>
          <ul className="custom-dropdown-options">
            {filteredOptions.length > 0 ? (
              filteredOptions.map(opt => {
                const isInUse = activeIds.has(opt.id.toString());
                const isSelected = opt.id === value;
                
                return (
                  <li 
                    key={opt.id} 
                    className={`${isSelected ? 'active' : ''} ${isInUse ? 'disabled-option' : ''}`} 
                    onClick={() => { 
                      onChange(opt.id); 
                      setIsOpen(false); 
                    }}
                    title={isInUse ? "Live calibration session. Click to observe." : ""}
                    style={isInUse ? { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' } : {}}
                  >
                    {opt.session_name} {isInUse ? "(Active)" : ""}
                  </li>
                );
              })
            ) : (
              <li className="no-options">No sessions found.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

function SessionManager({
  sessionsList,
  isLoadingSessions,
  showNotification,
  fetchSessionsList,
  isRemoteViewer
}) {
  const {
    selectedSessionId,
    setSelectedSessionId,
    setSelectedSessionName,
    setStdInstrumentAddress, setStdReaderModel, setStdReaderSN, setStdReaderInput,
    setTiInstrumentAddress, setTiReaderModel, setTiReaderSN, setTiReaderInput,
    setAcSourceAddress, setAcSourceSN, setDcSourceAddress, setDcSourceSN, setSwitchDriverAddress, setSwitchDriverModel, setSwitchDriverSN,
    setAmplifierAddress, setAmplifierSN, setStandardTvcSn, setTestTvcSn, setStandardInstrumentSerial, setTestInstrumentSerial, setFailedTPKeys,
    activeHostSessionIds,
    observeSession,
    leaveObserverMode,
    clearSessionState,
    hostSyncSynced,
  } = useInstruments();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState(null);
  const [sessionToObserve, setSessionToObserve] = useState(null);

  const activeIds = useMemo(
    () => new Set((activeHostSessionIds || []).map((id) => id?.toString())),
    [activeHostSessionIds]
  );

  const populateSessionState = (session) => {
    setSelectedSessionName(session ? session.session_name : "");
    setFailedTPKeys(new Set());

    if (session) {
      setStdInstrumentAddress(session.standard_reader_address || null);
      setStdReaderModel(session.standard_reader_model || null);
      setStdReaderSN(session.standard_reader_serial || null);
      setStdReaderInput(session.standard_reader_input || "FRONT");
      setTiInstrumentAddress(session.test_reader_address || null);
      setTiReaderModel(session.test_reader_model || null);
      setTiReaderSN(session.test_reader_serial || null);
      setTiReaderInput(session.test_reader_input || "REAR");
      setAcSourceAddress(session.ac_source_address || null);
      setAcSourceSN(session.ac_source_serial || null);
      setDcSourceAddress(session.dc_source_address || null);
      setDcSourceSN(session.dc_source_serial || null);
      setSwitchDriverAddress(session.switch_driver_address || null);
      setSwitchDriverModel(session.switch_driver_model || null);
      setSwitchDriverSN(session.switch_driver_serial || null);
      setAmplifierAddress(session.amplifier_address || null);
      setAmplifierSN(session.amplifier_serial || null);
      setStandardTvcSn(session.standard_tvc_serial || null);
      setTestTvcSn(session.test_tvc_serial || null);
      setStandardInstrumentSerial(session.standard_instrument_serial || null);
      setTestInstrumentSerial(session.test_instrument_serial || null);
    }
  };

  const handleSessionSelectChange = (sessionId) => {
    const session = sessionsList.find((s) => s.id.toString() === sessionId.toString());
    const isSelected = selectedSessionId?.toString() === sessionId?.toString();
    const isActiveElsewhere = activeIds.has(sessionId?.toString()) && !isSelected;

    if (isActiveElsewhere && session) {
      setSessionToObserve(session);
      return;
    }

    if (isRemoteViewer) {
      leaveObserverMode();
    }

    setSelectedSessionId(sessionId || null);
    populateSessionState(session);
  };

  const confirmObserveSession = () => {
    if (!sessionToObserve) return;
    observeSession(sessionToObserve.id);
    populateSessionState(sessionToObserve);
    setSessionToObserve(null);
    showNotification("Observer mode enabled for the live calibration session.", "info");
  };

  const handleNewSession = () => {
    if (isRemoteViewer) {
      leaveObserverMode();
    }
    clearSessionState();
    showNotification("Form cleared for a new session.", "info");
  };

  const handleDeleteSession = () => {
    if (!selectedSessionId) {
      showNotification("No session selected to delete.", "warning");
      return;
    }
    const session = sessionsList.find((s) => s.id.toString() === selectedSessionId.toString());
    setSessionToDelete(session);
    setIsModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!sessionToDelete) return;
    try {
      await axios.delete(`${API_BASE_URL}/calibration_sessions/${sessionToDelete.id}/`);
      showNotification("Session deleted successfully.", "success");
      clearSessionState();
      await fetchSessionsList();
    } catch (error) {
      showNotification("Failed to delete session.", "error");
    } finally {
      setIsModalOpen(false);
      setSessionToDelete(null);
    }
  };

  return (
    <>
      <ConfirmationModal
        isOpen={isModalOpen}
        title="Confirm Deletion"
        onConfirm={confirmDelete}
        onCancel={() => setIsModalOpen(false)}
      >
        <p>Are you sure you want to delete the session: <strong>"{sessionToDelete?.session_name}"</strong>?</p>
        <p>This action cannot be undone.</p>
      </ConfirmationModal>

      {Boolean(sessionToObserve) && (
        <div
          className="modal-overlay"
          onClick={() => setSessionToObserve(null)}
        >
          <div
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-observe-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="confirm-modal-header">
              <div className="confirm-modal-header-text">
                <span className="confirm-modal-eyebrow">Live session</span>
                <h3
                  id="session-observe-modal-title"
                  className="confirm-modal-title"
                >
                  Observe this calibration?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSessionToObserve(null)}
                className="cal-results-excel-icon-btn"
                title="Cancel"
                aria-label="Cancel"
              >
                <FaTimes aria-hidden />
              </button>
            </header>
            <div className="confirm-modal-body">
              <p className="confirm-modal-message">
                <strong>{sessionToObserve?.session_name}</strong> is active in
                another window. Observer mode is read-only. You can leave any
                time from the header.
              </p>
            </div>
            <footer className="confirm-modal-footer confirm-modal-footer--icon">
              <button
                type="button"
                onClick={confirmObserveSession}
                className="cal-results-excel-icon-btn"
                title="Confirm — observe this session"
                aria-label="Confirm — observe this session"
              >
                <FaCheck aria-hidden />
              </button>
            </footer>
          </div>
        </div>
      )}

      <section className="session-panel session-manager-container">
        <header className="session-panel-header">
          <div className="session-panel-header-text">
            <h3 className="session-panel-title">Manage Session</h3>
            <p className="session-panel-subtitle">
              Select an existing session, or start a new one.
            </p>
          </div>
          <div className="session-panel-header-actions">
            <button
              type="button"
              onClick={handleNewSession}
              className="cal-results-excel-icon-btn"
              aria-label="Start a new session"
              title="Start a new session"
            >
              <FaPlus aria-hidden />
            </button>
          </div>
        </header>

        <div className="session-picker-row">
          <label className="session-picker-label" htmlFor="session-picker">
            Active session
          </label>
          <div className="session-picker-controls">
            {/* ``hostSyncSynced`` gates selection on the first
                ``session_changed`` broadcast. Without this, a click that
                beats the host-sync WebSocket by a few tens of ms lands
                with an empty activeHostSessionIds set, bypasses the
                "Observe?" prompt, and silently downgrades the user into
                observer mode on an active session. */}
            <CustomDropdown
              options={sessionsList}
              value={selectedSessionId}
              onChange={handleSessionSelectChange}
              placeholder={
                isLoadingSessions
                  ? "Loading sessions…"
                  : !hostSyncSynced
                    ? "Connecting to host-sync…"
                    : "Select a session…"
              }
              disabled={isLoadingSessions || !hostSyncSynced}
              activeSessionIds={activeHostSessionIds}
            />
            <button
              type="button"
              onClick={handleDeleteSession}
              className="cal-results-excel-icon-btn cal-results-excel-icon-btn--danger"
              aria-label="Delete selected session"
              title="Delete selected session"
              disabled={!selectedSessionId || isRemoteViewer}
            >
              <FaTrashAlt aria-hidden />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

export default SessionManager;
