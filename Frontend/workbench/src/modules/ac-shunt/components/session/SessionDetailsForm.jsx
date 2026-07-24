// src/components/session/SessionDetailsForm.js
/**
 * @file SessionDetailsForm.js
 * @brief A form for creating and editing calibration session details.
 * Field suggestions combine local history (localStorage) with serial numbers
 * from the AC shunt and TVC corrections database — see SessionSetup.
 * Suggestion lists are custom (portaled, fixed) so they stay aligned with
 * the field when the page or a parent scrolls.
 */
import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useLayoutEffect,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { FaSave, FaEdit, FaCheck } from "react-icons/fa";
import { useInstruments } from "../../contexts/InstrumentContext";
import { API_BASE_URL } from "../../constants/constants";
import {
  getHistoryForField,
  mergeSuggestions,
  recordSessionFormHistory,
} from "../../utils/sessionFieldHistory";

const initialFormData = {
  sessionName: `Calibration Session - ${new Date().toLocaleString()}`,
  testInstrument: "",
  testInstrumentSerial: "",
  standardInstrumentModel: "",
  standardInstrumentSerial: "",
  standardTvcSerial: "",
  testTvcSerial: "",
  temperature: "23.0",
  humidity: "45.0",
  notes: "",
};

const SUGGEST_MAX_SHOWN = 50;

/**
 * Suggestions as a portaled, fixed list — avoids native <datalist> popups
 * that detach from the field when a parent scrolls.
 */
function SessionSuggestInput({
  name,
  value,
  onChange,
  id,
  type = "text",
  required,
  disabled,
  step,
  listOptions,
}) {
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const activeIndexRef = useRef(0);
  const blurCloseTimer = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!listOptions || listOptions.length === 0) return [];
    const v = (value || "").toLowerCase();
    if (!v.trim()) return listOptions.slice(0, SUGGEST_MAX_SHOWN);
    return listOptions
      .filter((o) => String(o).toLowerCase().includes(v))
      .slice(0, SUGGEST_MAX_SHOWN);
  }, [listOptions, value]);

  const hasSuggestions = !disabled && listOptions.length > 0;
  const showPanel = open && hasSuggestions && filtered.length > 0;

  const updatePos = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: r.bottom,
      left: r.left,
      width: Math.max(r.width, 160),
    });
  }, []);

  useLayoutEffect(() => {
    if (!showPanel) return;
    updatePos();
  }, [showPanel, updatePos, value, filtered.length]);

  useLayoutEffect(() => {
    if (!showPanel || !listRef.current) return;
    const li = listRef.current.querySelector(".is-active");
    if (li) {
      li.scrollIntoView({ block: "nearest", behavior: "auto" });
    }
  }, [activeIndex, showPanel]);

  useEffect(() => {
    if (!showPanel) return;
    const onScrollOrResize = () => updatePos();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [showPanel, updatePos]);

  useEffect(
    () => () => {
      if (blurCloseTimer.current != null) clearTimeout(blurCloseTimer.current);
    },
    []
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [value, listOptions, filtered.length]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const clearBlurTimer = useCallback(() => {
    if (blurCloseTimer.current != null) {
      clearTimeout(blurCloseTimer.current);
      blurCloseTimer.current = null;
    }
  }, []);

  const pick = useCallback(
    (opt) => {
      onChange({ target: { name, value: String(opt) } });
      setOpen(false);
    },
    [name, onChange]
  );

  const onKeyDown = (e) => {
    if (!hasSuggestions) return;
    if (e.key === "Escape" && showPanel) {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (!showPanel) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && showPanel) {
      e.preventDefault();
      const idx = activeIndexRef.current;
      if (filtered[idx] != null) pick(filtered[idx]);
    }
  };

  const panel =
    showPanel && typeof document !== "undefined"
      ? createPortal(
        <ul
          ref={listRef}
          className="session-suggest-panel"
          style={{
            top: pos.top,
            left: pos.left,
            width: pos.width,
          }}
          role="listbox"
        >
          {filtered.map((opt, i) => (
            <li
              key={`${id}-${i}-${String(opt).slice(0, 32)}`}
              role="option"
              aria-selected={i === activeIndex}
              className={i === activeIndex ? "is-active" : undefined}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                clearBlurTimer();
                pick(opt);
              }}
            >
              {String(opt)}
            </li>
          ))}
        </ul>,
        document.body
      )
      : null;

  return (
    <>
      <input
        ref={inputRef}
        type={type}
        id={id}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        disabled={disabled}
        step={step}
        autoComplete="off"
        autoCorrect="off"
        onFocus={() => {
          clearBlurTimer();
          if (hasSuggestions) {
            setOpen(true);
            requestAnimationFrame(() => updatePos());
          }
        }}
        onBlur={() => {
          clearBlurTimer();
          blurCloseTimer.current = window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={onKeyDown}
      />
      {panel}
    </>
  );
}

function SessionDetailsForm({
  sessionsList,
  fetchSessionsList,
  showNotification,
  isRemoteViewer,
  shuntSerials = [],
  tvcSerials = [],
}) {
  const {
    selectedSessionId,
    setSelectedSessionId,
    setSelectedSessionName,
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
    switchDriverAddress,
    setSwitchDriverAddress,
    switchDriverModel,
    setSwitchDriverModel,
    switchDriverSN,
    setSwitchDriverSN,
    amplifierAddress,
    setAmplifierAddress,
    amplifierSN,
    setAmplifierSN,
    setStandardTvcSn,
    setTestTvcSn,
    setStandardInstrumentSerial,
    setTestInstrumentSerial,
  } = useInstruments();

  const [formData, setFormData] = useState(() => ({ ...initialFormData }));
  const [isLoading, setIsLoading] = useState(false);
  const [fieldHistoryTick, setFieldHistoryTick] = useState(0);
  const [isEditingName, setIsEditingName] = useState(false);

  const shuntSerialPool = useMemo(
    () => mergeSuggestions([], shuntSerials),
    [shuntSerials]
  );

  const tvcSerialPool = useMemo(
    () => mergeSuggestions([], tvcSerials),
    [tvcSerials]
  );

  const suggestions = useMemo(() => {
    void fieldHistoryTick; // re-run when history updates (localStorage); satisfies exhaustive-deps

    // Determine if an A40B is the active standard
    const isA40BActive = formData.standardInstrumentModel.toUpperCase().includes("A40B");
    const restrictedTvcSerials = ["20873", "20874", "20743"];

    // Filter TVC pool if A40B is active
    const activeTvcPool = isA40BActive
      ? tvcSerialPool.filter(
          (sn) => !restrictedTvcSerials.some((r) => String(sn).includes(r))
        )
      : tvcSerialPool;

    // Accept an optional specific pool to merge with the field's history
    const s = (fieldName, specificPool = []) =>
      mergeSuggestions(getHistoryForField(fieldName), specificPool);

    return {
      sessionName: s("sessionName"),
      testInstrument: s("testInstrument"),
      testInstrumentSerial: s("testInstrumentSerial", shuntSerialPool),
      standardInstrumentModel: s("standardInstrumentModel"),
      standardInstrumentSerial: s("standardInstrumentSerial", shuntSerialPool),
      // Use the filtered activeTvcPool here:
      standardTvcSerial: s("standardTvcSerial", activeTvcPool), 
      testTvcSerial: s("testTvcSerial", activeTvcPool),
      temperature: s("temperature"),
      humidity: s("humidity"),
    };
  }, [fieldHistoryTick, shuntSerialPool, tvcSerialPool, formData.standardInstrumentModel]);

  useEffect(() => {
    setIsEditingName(false); // Reset edit state when switching sessions

    if (selectedSessionId && sessionsList.length > 0) {
      const session = sessionsList.find(s => s.id.toString() === selectedSessionId.toString());
      if (session) {
        setFormData({
          sessionName: session.session_name || "",
          testInstrument: session.test_instrument_model || "",
          testInstrumentSerial: session.test_instrument_serial || "",
          standardInstrumentModel: session.standard_instrument_model || "",
          standardInstrumentSerial: session.standard_instrument_serial || "",
          standardTvcSerial: session.standard_tvc_serial || "",
          testTvcSerial: session.test_tvc_serial || "",
          temperature: session.temperature !== null ? session.temperature.toString() : "",
          humidity: session.humidity !== null ? session.humidity.toString() : "",
          notes: session.notes || "",
        });
      }
    } else {
      setFormData({ ...initialFormData, sessionName: `Calibration Session - ${new Date().toLocaleString()}` });
    }
  }, [selectedSessionId, sessionsList]);

  const handleChange = (e) => {
    let { name, value } = e.target;

    if (name === "testInstrumentSerial" || name === "standardInstrumentSerial") {
      value = value.replace(/\s*\(\s*\d+(?:\.\d+)?\s*m?A\s*\)$/i, "");
    }

    setFormData((prev) => {
      const next = { ...prev, [name]: value };

      // Only auto-enforce if it is a NEW session
      if (name === "testInstrument" && !selectedSessionId) {
        const dateStr = new Intl.DateTimeFormat("en-US", {
          month: "2-digit",
          day: "2-digit",
          year: "numeric",
        })
          .format(new Date())
          .replace(/\//g, "-");

        if (value.trim()) {
          const match = value.match(/(\d+(?:\.\d+)?\s*m?a)/i);
          let currentPart = "";

          if (match) {
            // Remove all spaces first (e.g., "100 mAs" -> "100ma")
            const cleanMatch = match[1].replace(/\s+/g, "");

            // Replace the unit suffix cleanly in one shot
            const formattedMatch = cleanMatch.replace(/(m?)a$/i, (m, milli) => {
              return milli ? "mA" : "A";
            });

            currentPart = ` @ ${formattedMatch}`;
          }

          next.sessionName = `${value.trim()}${currentPart} (${dateStr})`;
        } else {
          next.sessionName = `Calibration Session - ${new Date().toLocaleString()}`;
        }
      }

      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    // --- TVC SAFETY VALIDATION ---
    if (formData.standardInstrumentModel.toUpperCase().includes("A40B")) {
      const restrictedTvcSerials = ["20873", "20874", "20743"];
      if (
        restrictedTvcSerials.includes(formData.standardTvcSerial) ||
        restrictedTvcSerials.includes(formData.testTvcSerial)
      ) {
        showNotification("0.25V TVCs (20873, 20874, 20743) cannot be used with an A40B.", "error");
        setIsLoading(false);
        return; // Abort the save
      }
    }
    // -----------------------------

    let notesPayload = formData.notes ?? "";
    if (selectedSessionId) {
      try {
        const snap = await axios.get(
          `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/`
        );
        notesPayload = snap.data?.notes ?? "";
      } catch {
        notesPayload = formData.notes ?? "";
      }
    }
    
    const payload = {
      session_name: formData.sessionName,
      test_instrument_model: formData.testInstrument,
      test_instrument_serial: formData.testInstrumentSerial,
      standard_instrument_model: formData.standardInstrumentModel,
      standard_instrument_serial: formData.standardInstrumentSerial,
      standard_tvc_serial: formData.standardTvcSerial,
      test_tvc_serial: formData.testTvcSerial,
      temperature: parseFloat(formData.temperature) || null,
      humidity: parseFloat(formData.humidity) || null,
      notes: notesPayload,
      standard_reader_address: stdInstrumentAddress,
      standard_reader_model: stdReaderModel,
      standard_reader_serial: stdReaderSN,
      standard_reader_input: stdReaderModel === "8508A" ? stdReaderInput : null,
      test_reader_address: tiInstrumentAddress,
      test_reader_model: tiReaderModel,
      test_reader_serial: tiReaderSN,
      test_reader_input: tiReaderModel === "8508A" ? tiReaderInput : null,
      ac_source_address: acSourceAddress,
      dc_source_address: dcSourceAddress,
      ac_source_serial: acSourceSN,
      dc_source_serial: dcSourceSN,
      switch_driver_address: switchDriverAddress,
      switch_driver_model: switchDriverModel,
      switch_driver_serial: switchDriverSN,
      amplifier_address: amplifierAddress,
      amplifier_serial: amplifierSN,
    };

    try {
      const response = selectedSessionId
        ? await axios.put(`${API_BASE_URL}/calibration_sessions/${selectedSessionId}/`, payload)
        : await axios.post(`${API_BASE_URL}/calibration_sessions/`, payload);

      showNotification(selectedSessionId ? "Session updated successfully!" : "New session saved successfully!", "success");

      recordSessionFormHistory({ ...formData, notes: notesPayload });
      setFieldHistoryTick((n) => n + 1);

      const savedSession = response.data;
      await fetchSessionsList();

      setSelectedSessionId(savedSession.id);
      setSelectedSessionName(savedSession.session_name);
      setStdInstrumentAddress(savedSession.standard_reader_address || null);
      setStdReaderModel(savedSession.standard_reader_model || null);
      setStdReaderSN(savedSession.standard_reader_serial || null);
      setStdReaderInput(savedSession.standard_reader_input || "FRONT");
      setTiInstrumentAddress(savedSession.test_reader_address || null);
      setTiReaderModel(savedSession.test_reader_model || null);
      setTiReaderSN(savedSession.test_reader_serial || null);
      setTiReaderInput(savedSession.test_reader_input || "REAR");
      setAcSourceAddress(savedSession.ac_source_address || null);
      setAcSourceSN(savedSession.ac_source_serial || null);
      setDcSourceAddress(savedSession.dc_source_address || null);
      setDcSourceSN(savedSession.dc_source_serial || null);
      setSwitchDriverAddress(savedSession.switch_driver_address || null);
      setSwitchDriverModel(savedSession.switch_driver_model || null);
      setSwitchDriverSN(savedSession.switch_driver_serial || null);
      setAmplifierAddress(savedSession.amplifier_address || null);
      setAmplifierSN(savedSession.amplifier_serial || null);
      setStandardTvcSn(savedSession.standard_tvc_serial || null);
      setTestTvcSn(savedSession.test_tvc_serial || null);
      setStandardInstrumentSerial(savedSession.standard_instrument_serial || null);
      setTestInstrumentSerial(savedSession.test_instrument_serial || null);
    } catch (error) {
      console.error("Failed to save session", error);
      showNotification("Failed to save session.", "error");
    } finally {
      setIsLoading(false);
      setIsEditingName(false); // Close edit view on save
    }
  };

  const isEditing = Boolean(selectedSessionId);
  const saveTitle = isLoading
    ? "Saving…"
    : isEditing
      ? "Update session"
      : "Save new session";
  const showSessionName = isEditing || formData.testInstrument.trim() !== "";
  return (
    <section className="session-panel session-details-container">
      <header className="session-panel-header">
        <div className="session-panel-header-text">
          <h3 className="session-panel-title">
            {isEditing ? "Edit Session Details" : "Create New Session"}
          </h3>
        </div>
      </header>

      <form
        id="session-details-form"
        onSubmit={handleSubmit}
        className="session-details-form"
      >
        {showSessionName && (
          <div className="session-form-group">
            <div className="form-section-group">
              <div className="form-section full-width">
                <label htmlFor="sessionName">Session name</label>

                {!isEditingName ? (
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <div
                      style={{
                        flex: 1,
                        color: "var(--text-primary)",
                        fontWeight: 600,
                        fontSize: "1.1rem"
                      }}
                    >
                      {formData.sessionName || "—"}
                    </div>
                    {!isRemoteViewer && (
                      <button
                        type="button"
                        className="cal-results-excel-icon-btn"
                        onClick={() => setIsEditingName(true)}
                        title="Edit Session Name"
                      >
                        <FaEdit />
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <SessionSuggestInput
                        id="sessionName"
                        name="sessionName"
                        value={formData.sessionName}
                        onChange={handleChange}
                        required
                        disabled={isRemoteViewer}
                        listOptions={suggestions.sessionName}
                      />
                    </div>
                    <button
                      type="button"
                      className="cal-results-excel-icon-btn"
                      onClick={() => setIsEditingName(false)}
                      title="Confirm Name"
                    >
                      <FaCheck />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="session-form-group">
          <span className="session-form-group-eyebrow">Instruments</span>
          <div className="form-section-group">
            <div className="form-section">
              <label htmlFor="standardInstrumentModel">Standard instrument</label>
              <SessionSuggestInput
                id="standardInstrumentModel"
                name="standardInstrumentModel"
                value={formData.standardInstrumentModel}
                onChange={handleChange}
                required
                disabled={isRemoteViewer}
                listOptions={suggestions.standardInstrumentModel}
              />
            </div>
            <div className="form-section">
              <label htmlFor="standardInstrumentSerial">Standard serial</label>
              <SessionSuggestInput
                id="standardInstrumentSerial"
                name="standardInstrumentSerial"
                value={formData.standardInstrumentSerial}
                onChange={handleChange}
                required
                disabled={isRemoteViewer}
                listOptions={suggestions.standardInstrumentSerial}
              />
            </div>
            <div className="form-section">
              <label htmlFor="testInstrument">Test instrument</label>
              <SessionSuggestInput
                id="testInstrument"
                name="testInstrument"
                value={formData.testInstrument}
                onChange={handleChange}
                required
                disabled={isRemoteViewer}
                listOptions={suggestions.testInstrument}
              />
            </div>
            <div className="form-section">
              <label htmlFor="testInstrumentSerial">Test serial</label>
              <SessionSuggestInput
                id="testInstrumentSerial"
                name="testInstrumentSerial"
                value={formData.testInstrumentSerial}
                onChange={handleChange}
                required
                disabled={isRemoteViewer}
                listOptions={suggestions.testInstrumentSerial}
              />
            </div>
            <div className="form-section">
              <label htmlFor="standardTvcSerial">Standard TVC serial</label>
              <SessionSuggestInput
                id="standardTvcSerial"
                name="standardTvcSerial"
                value={formData.standardTvcSerial}
                onChange={handleChange}
                disabled={isRemoteViewer}
                listOptions={suggestions.standardTvcSerial}
              />
            </div>
            <div className="form-section">
              <label htmlFor="testTvcSerial">Test TVC serial</label>
              <SessionSuggestInput
                id="testTvcSerial"
                name="testTvcSerial"
                value={formData.testTvcSerial}
                onChange={handleChange}
                disabled={isRemoteViewer}
                listOptions={suggestions.testTvcSerial}
              />
            </div>
          </div>
        </div>

        <div className="session-form-group">
          <span className="session-form-group-eyebrow">Environment</span>
          <div className="form-section-group">
            <div className="form-section">
              <label htmlFor="temperature">Temperature (°C)</label>
              <SessionSuggestInput
                type="number"
                id="temperature"
                name="temperature"
                value={formData.temperature}
                onChange={handleChange}
                step="0.1"
                required
                disabled={isRemoteViewer}
                listOptions={suggestions.temperature}
              />
            </div>
            <div className="form-section">
              <label htmlFor="humidity">Humidity (%RH)</label>
              <SessionSuggestInput
                type="number"
                id="humidity"
                name="humidity"
                value={formData.humidity}
                onChange={handleChange}
                step="0.1"
                required
                disabled={isRemoteViewer}
                listOptions={suggestions.humidity}
              />
            </div>
          </div>
        </div>

        <div className="form-section-action-icons">
          <button
            type="submit"
            className="cal-results-excel-icon-btn"
            disabled={isLoading || isRemoteViewer}
            aria-label={saveTitle}
            title={saveTitle}
          >
            <FaSave />
          </button>
        </div>
      </form>
    </section>
  );
}

export default SessionDetailsForm;
