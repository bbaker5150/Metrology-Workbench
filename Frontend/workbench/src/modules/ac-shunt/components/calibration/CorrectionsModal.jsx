import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import axios from "axios";
import { useInstruments } from "../../contexts/InstrumentContext";
import {
  FaTimes,
  FaSave,
  FaArrowLeft,
  FaPlus,
  FaEdit,
  FaTrash,
  FaCheck,
  FaThumbtack,
  FaHistory,
  FaCheckCircle,
} from "react-icons/fa";
import { AMPLIFIER_RANGES_A, API_BASE_URL } from "../../constants/constants";
import AnimatedModalShell from "../shared/AnimatedModalShell";

// --- Static Initial State ---
const emptyShuntPoint = () => ({ id: null, current: "", frequency: "", val1: "", val2: "" });
const emptyTvcPoint = () => ({ id: null, frequency: "", val1: "", val2: "" });

const initialEditorState = {
  // device identity
  deviceId: null,
  model_name: "",
  serial_number: "",
  range: "",
  test_voltage: "",
  remark: "",
  is_manual: true,
  // report identity + metadata
  reportId: null,
  calibration_date: "",
  report_number: "",
  received_date: "",
  notes: "",
  // correction points
  points: [emptyShuntPoint()],
};

// --- Clean, Minimalist Icon Button Component ---
const IconBtn = ({ icon, onClick, title, variant, disabled, type = "button", active }) => {
  const className =
    "cal-results-excel-icon-btn" +
    (variant === "danger" ? " cal-results-excel-icon-btn--danger" : "") +
    (active ? " is-active" : "");
  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={className}
    >
      {icon}
    </button>
  );
};

// --- Standardized Confirmation Modal ---
const ConfirmationModal = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = "Confirm",
  confirmButtonClass = "",
  eyebrow,
  overlayClassName = "modal-overlay modal-overlay--nested",
}) => {
  if (!isOpen) return null;
  const isDanger = /danger/.test(confirmButtonClass);
  const eyebrowText = eyebrow ?? (isDanger ? "Warning" : "Confirm");
  return (
    <div className={overlayClassName} onClick={onCancel}>
      <div
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="corrections-confirm-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="confirm-modal-header">
          <div className="confirm-modal-header-text">
            <span className="confirm-modal-eyebrow">{eyebrowText}</span>
            <h3 id="corrections-confirm-modal-title" className="confirm-modal-title">
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
          <p className="confirm-modal-message">{message}</p>
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

// --- Electron-Friendly Password Protected Modal ---
const PasswordModal = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  overlayClassName = "modal-overlay modal-overlay--nested",
}) => {
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!isOpen) setPassword("");
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onConfirm(password);
  };

  return (
    <div className={overlayClassName} onClick={onCancel}>
      <div
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="confirm-modal-header">
          <div className="confirm-modal-header-text">
            <span className="confirm-modal-eyebrow">Security Verification</span>
            <h3 className="confirm-modal-title">{title}</h3>
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
        <form onSubmit={handleSubmit}>
          <div className="confirm-modal-body" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <p className="confirm-modal-message">{message}</p>
            <input
              type="password"
              className="corrections-points-input"
              style={{ width: "100%", padding: "10px", boxSizing: "border-box" }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter authorization password"
              autoFocus
            />
          </div>
          <footer className="confirm-modal-footer confirm-modal-footer--icon">
            <button
              type="submit"
              className="cal-results-excel-icon-btn"
              title="Verify"
              aria-label="Verify"
            >
              <FaCheck aria-hidden />
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};

// --- Helpers -----------------------------------------------------------
const makeDeviceKey = (serial, range, isManual) =>
  `${serial}|${range}|${isManual ? "M" : "I"}`;

const formatReportDate = (iso) => {
  if (!iso) return "Undated";
  // iso is "YYYY-MM-DD" from DRF; render without timezone drift.
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
};

const reportSortValue = (report) =>
  report?.calibration_date ? Date.parse(report.calibration_date) : -Infinity;

const sortReports = (reports = []) =>
  [...reports].sort((a, b) => {
    const byDate = reportSortValue(b) - reportSortValue(a);
    if (byDate !== 0) return byDate;
    // Newest created first as a stable tiebreak for undated reports.
    return (b.id || 0) - (a.id || 0);
  });

const pickActiveReport = (reports = []) => {
  if (reports.length === 0) return null;
  return reports.find((r) => r.is_active) || sortReports(reports)[0];
};

function CorrectionsModal({ isOpen, onClose, showNotification, onUpdate, uniqueTestPoints }) {
  const {
    standardInstrumentSerial,
    testInstrumentSerial,
    standardTvcSn,
    testTvcSn,
    selectedSessionId,
    isCollecting,
    isBulkRunning,
    isRemoteViewer,
  } = useInstruments();
  const isCalibrationActive = isCollecting || isBulkRunning;
  const isReadOnly = Boolean(isRemoteViewer);

  const isFirstFetch = useRef(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [shuntsData, setShuntsData] = useState([]);
  const [tvcsData, setTvcsData] = useState([]);

  const [primaryTab, setPrimaryTab] = useState("AC Shunt");
  const [shuntView, setShuntView] = useState("Corrections");

  // Device + report selection (per tab).
  const [selectedShuntKey, setSelectedShuntKey] = useState("");
  const [selectedShuntReportId, setSelectedShuntReportId] = useState(null);
  const [auxiliaryTvcSn, setAuxiliaryTvcSn] = useState("");
  const [selectedTvcReportId, setSelectedTvcReportId] = useState(null);

  // Editor (add / edit a Report of Calibration).
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorType, setEditorType] = useState("shunt");
  const [editorMode, setEditorMode] = useState("device-new"); // device-new | report-new | report-edit
  const [editorForm, setEditorForm] = useState(initialEditorState);

  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, kind: null, payload: null });
  const [addPointsConfirm, setAddPointsConfirm] = useState({ isOpen: false, row: null, headers: null, isMismatch: false });
  const [passwordGate, setPasswordGate] = useState({ isOpen: false, action: null });

  const notify = useCallback((msg, type = "info") => {
    if (showNotification) showNotification(msg, type);
    else alert(msg);
  }, [showNotification]);

  const fetchData = useCallback(async () => {
    if (isFirstFetch.current) setIsLoading(true);
    try {
      const timestamp = new Date().getTime();
      const [shuntsRes, tvcsRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/shunts/?t=${timestamp}`),
        axios.get(`${API_BASE_URL}/tvcs/?t=${timestamp}`),
      ]);
      setShuntsData(shuntsRes.data || []);
      setTvcsData(tvcsRes.data || []);
      isFirstFetch.current = false;
    } catch (error) {
      console.error("Failed to fetch correction data:", error);
      notify("Failed to load instrument database.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (isOpen) {
      setShuntView("Corrections");
      setIsEditorOpen(false);
      fetchData();
    }
  }, [isOpen, fetchData]);

  useEffect(() => {
    setIsEditorOpen(false);
  }, [primaryTab]);

  // Close the whole modal and reset any transient sub-state so a later
  // reopen starts clean (no stale editor / password prompt left behind).
  const handleShellClose = useCallback(() => {
    setPasswordGate({ isOpen: false, action: null });
    setDeleteConfirm({ isOpen: false, kind: null, payload: null });
    setAddPointsConfirm({ isOpen: false, row: null, headers: null, isMismatch: false });
    setIsEditorOpen(false);
    onClose();
  }, [onClose]);

  // Escape closes the topmost open layer: an open sub-prompt first, then
  // the editor, then the whole modal — so there is always a keyboard way out.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      if (passwordGate.isOpen) {
        setPasswordGate({ isOpen: false, action: null });
      } else if (deleteConfirm.isOpen) {
        setDeleteConfirm({ isOpen: false, kind: null, payload: null });
      } else if (addPointsConfirm.isOpen) {
        setAddPointsConfirm({ isOpen: false, row: null, headers: null, isMismatch: false });
      } else if (isEditorOpen) {
        setIsEditorOpen(false);
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, passwordGate.isOpen, deleteConfirm.isOpen, addPointsConfirm.isOpen, isEditorOpen, onClose]);

  // ----- Derived: shunt devices -----
  const shuntDevices = useMemo(() => {
    return [...shuntsData]
      .filter((s) => s.serial_number != null)
      .map((s) => ({
        ...s,
        key: makeDeviceKey(String(s.serial_number), s.range, s.is_manual),
      }))
      .sort((a, b) => {
        const bySerial = String(a.serial_number).localeCompare(String(b.serial_number));
        if (bySerial !== 0) return bySerial;
        const byRange = (Number(a.range) || 0) - (Number(b.range) || 0);
        if (byRange !== 0) return byRange;
        return (b.is_manual ? 1 : 0) - (a.is_manual ? 1 : 0);
      });
  }, [shuntsData]);

  const shuntOptions = useMemo(
    () =>
      shuntDevices.map((info) => {
        const sizeLabel = info.size || (info.range != null ? `${info.range}A` : null);
        const displayModel = info.model_name === "Shunt" || !info.model_name ? "A40B" : info.model_name;
        const hasRangeInName = displayModel.includes("-");
        const base = sizeLabel && !hasRangeInName
          ? `[${displayModel}] ${info.serial_number} (${sizeLabel})`
          : `[${displayModel}] ${info.serial_number}`;
        return { value: info.key, label: info.is_manual ? `${base} — Manual` : base };
      }),
    [shuntDevices]
  );

  // Auto-select a sensible shunt device when the list loads / tab opens.
  useEffect(() => {
    if (shuntDevices.length === 0) return;
    setSelectedShuntKey((prev) => {
      if (prev && shuntDevices.some((d) => d.key === prev)) return prev;
      const preferSerial = (serial) => {
        if (!serial) return null;
        const matches = shuntDevices.filter((d) => String(d.serial_number) === String(serial));
        if (matches.length === 0) return null;
        matches.sort((a, b) => (b.is_manual ? 1 : 0) - (a.is_manual ? 1 : 0));
        return matches[0].key;
      };
      return preferSerial(standardInstrumentSerial) || preferSerial(testInstrumentSerial) || shuntDevices[0].key;
    });
  }, [shuntDevices, standardInstrumentSerial, testInstrumentSerial]);

  const selectedShuntDevice = useMemo(
    () => shuntDevices.find((d) => d.key === selectedShuntKey) || null,
    [shuntDevices, selectedShuntKey]
  );

  const shuntReports = useMemo(
    () => sortReports(selectedShuntDevice?.reports || []),
    [selectedShuntDevice]
  );

  // Keep the report selection valid; default to the active report.
  useEffect(() => {
    if (!selectedShuntDevice) {
      setSelectedShuntReportId(null);
      return;
    }
    setSelectedShuntReportId((prev) => {
      if (prev && shuntReports.some((r) => r.id === prev)) return prev;
      const active = pickActiveReport(shuntReports);
      return active ? active.id : null;
    });
  }, [selectedShuntDevice, shuntReports]);

  const selectedShuntReport = useMemo(
    () => shuntReports.find((r) => r.id === selectedShuntReportId) || pickActiveReport(shuntReports),
    [shuntReports, selectedShuntReportId]
  );

  // ----- Derived: TVC devices -----
  const tvcOptions = useMemo(() => {
    return [...tvcsData]
      .filter((t) => t.serial_number != null)
      .sort((a, b) => String(a.serial_number).localeCompare(String(b.serial_number)))
      .map((tvc) => ({
        value: String(tvc.serial_number),
        label: tvc.is_manual ? `${tvc.serial_number} — Manual` : String(tvc.serial_number),
      }));
  }, [tvcsData]);

  const selectedTvc = useMemo(
    () => tvcsData.find((t) => String(t.serial_number) === String(auxiliaryTvcSn)) || null,
    [tvcsData, auxiliaryTvcSn]
  );

  const tvcReports = useMemo(
    () => sortReports(selectedTvc?.reports || []),
    [selectedTvc]
  );

  useEffect(() => {
    if (!selectedTvc) {
      setSelectedTvcReportId(null);
      return;
    }
    setSelectedTvcReportId((prev) => {
      if (prev && tvcReports.some((r) => r.id === prev)) return prev;
      const active = pickActiveReport(tvcReports);
      return active ? active.id : null;
    });
  }, [selectedTvc, tvcReports]);

  const selectedTvcReport = useMemo(
    () => tvcReports.find((r) => r.id === selectedTvcReportId) || pickActiveReport(tvcReports),
    [tvcReports, selectedTvcReportId]
  );

  // ----- Pivot a shunt report into a current × frequency table -----
  const pivotedShuntData = useMemo(() => {
    if (!selectedShuntDevice || !selectedShuntReport) return { headers: [], rows: [] };
    const corrs = selectedShuntReport.corrections || [];
    const valueKey = shuntView === "Corrections" ? "correction" : "uncertainty";
    const headers = [...new Set(corrs.map((c) => Number(c.frequency)))].sort((a, b) => a - b);
    const byCurrent = new Map();
    corrs.forEach((c) => {
      const cur = Number(c.current);
      if (!byCurrent.has(cur)) {
        byCurrent.set(cur, { current: cur, range: selectedShuntDevice.range, values: {} });
      }
      byCurrent.get(cur).values[Number(c.frequency)] = c[valueKey];
    });
    return {
      headers,
      rows: [...byCurrent.values()].sort((a, b) => a.current - b.current),
    };
  }, [selectedShuntDevice, selectedShuntReport, shuntView]);

  // =====================================================================
  //  Editor open helpers
  // =====================================================================
  const buildShuntPointsFromReport = (report) =>
    (report?.corrections || [])
      .slice()
      .sort((a, b) => a.current - b.current || a.frequency - b.frequency)
      .map((c) => ({
        id: null, // new report → fresh points
        current: c.current ?? "",
        frequency: c.frequency ?? "",
        val1: c.correction ?? "",
        val2: c.uncertainty ?? "",
      }));

  const buildTvcPointsFromReport = (report) =>
    (report?.corrections || [])
      .slice()
      .sort((a, b) => a.frequency - b.frequency)
      .map((c) => ({
        id: null,
        frequency: c.frequency ?? "",
        val1: c.ac_dc_difference ?? "",
        val2: c.expanded_uncertainty ?? "",
      }));

  const openNewDevice = (type) => {
    setEditorType(type);
    setEditorMode("device-new");
    setEditorForm({
      ...initialEditorState,
      is_manual: true,
      points: type === "shunt" ? [emptyShuntPoint()] : [emptyTvcPoint()],
    });
    setIsEditorOpen(true);
  };

  const openNewReport = (type) => {
    const device = type === "shunt" ? selectedShuntDevice : selectedTvc;
    if (!device) return;
    const templateReport = type === "shunt" ? selectedShuntReport : selectedTvcReport;
    const points =
      type === "shunt"
        ? (templateReport ? buildShuntPointsFromReport(templateReport) : [emptyShuntPoint()])
        : (templateReport ? buildTvcPointsFromReport(templateReport) : [emptyTvcPoint()]);
    setEditorType(type);
    setEditorMode("report-new");
    setEditorForm({
      ...initialEditorState,
      deviceId: device.id,
      model_name: device.model_name || "",
      serial_number: String(device.serial_number),
      range: device.range ?? "",
      test_voltage: device.test_voltage ?? "",
      remark: device.remark || "",
      is_manual: device.is_manual,
      reportId: null,
      calibration_date: "",
      report_number: "",
      received_date: "",
      notes: "",
      points: points.length ? points : (type === "shunt" ? [emptyShuntPoint()] : [emptyTvcPoint()]),
    });
    setIsEditorOpen(true);
  };

  const proceedEditReport = (type, device, report) => {
    setEditorType(type);
    setEditorMode("report-edit");
    setEditorForm({
      ...initialEditorState,
      deviceId: device.id,
      model_name: device.model_name || "",
      serial_number: String(device.serial_number),
      range: device.range ?? "",
      test_voltage: device.test_voltage ?? "",
      remark: device.remark || "",
      is_manual: device.is_manual,
      reportId: report.id,
      calibration_date: report.calibration_date || "",
      report_number: report.report_number || "",
      received_date: report.received_date || "",
      notes: report.notes || "",
      points:
        type === "shunt"
          ? (report.corrections || []).map((c) => ({
              id: c.id || null,
              current: c.current ?? "",
              frequency: c.frequency ?? "",
              val1: c.correction ?? "",
              val2: c.uncertainty ?? "",
            }))
          : (report.corrections || []).map((c) => ({
              id: c.id || null,
              frequency: c.frequency ?? "",
              val1: c.ac_dc_difference ?? "",
              val2: c.expanded_uncertainty ?? "",
            })),
    });
    setIsEditorOpen(true);
  };

  const requestEditReport = (type) => {
    const device = type === "shunt" ? selectedShuntDevice : selectedTvc;
    const report = type === "shunt" ? selectedShuntReport : selectedTvcReport;
    if (!device || !report) return;
    // Editing imported (system) reports is gated behind the admin password.
    if (!device.is_manual) {
      setPasswordGate({ isOpen: true, action: () => proceedEditReport(type, device, report) });
      return;
    }
    proceedEditReport(type, device, report);
  };

  const handlePasswordVerify = (password) => {
    if (password === "admin123") {
      const action = passwordGate.action;
      setPasswordGate({ isOpen: false, action: null });
      if (typeof action === "function") action();
    } else {
      notify("Incorrect password. Access denied.", "error");
    }
  };

  // =====================================================================
  //  Save / delete / pin
  // =====================================================================
  const handleSaveEditor = async () => {
    const isShunt = editorType === "shunt";

    const validPoints = editorForm.points.filter(
      (p) => p.frequency !== "" && p.frequency !== null && (!isShunt || (p.current !== "" && p.current !== null))
    );
    if (validPoints.length === 0) {
      notify(`Please add at least one valid correction point${isShunt ? " (current + frequency)" : ""}.`, "error");
      return;
    }

    const corrections = validPoints.map((p) => {
      const base = { frequency: parseFloat(p.frequency) };
      if (p.id) base.id = p.id;
      if (isShunt) {
        base.current = parseFloat(p.current);
        base.correction = parseFloat(p.val1 || 0);
        base.uncertainty = parseFloat(p.val2 || 0);
      } else {
        base.ac_dc_difference = parseFloat(p.val1 || 0);
        base.expanded_uncertainty = parseFloat(p.val2 || 0);
      }
      return base;
    });

    const reportPayload = {
      calibration_date: editorForm.calibration_date || null,
      report_number: editorForm.report_number || "",
      received_date: editorForm.received_date || null,
      notes: editorForm.notes || "",
      corrections,
    };

    try {
      setIsSaving(true);

      if (editorMode === "device-new") {
        const devicePayload = isShunt
          ? {
              model_name: editorForm.model_name || "A40B",
              serial_number: String(editorForm.serial_number),
              range: parseFloat(editorForm.range || 0),
              remark: editorForm.remark || "Manually added",
              is_manual: true,
              reports: [reportPayload],
            }
          : {
              serial_number: String(editorForm.serial_number),
              test_voltage: parseFloat(editorForm.test_voltage || 0),
              is_manual: true,
              reports: [reportPayload],
            };
        const res = await axios.post(`${API_BASE_URL}/${isShunt ? "shunts" : "tvcs"}/`, devicePayload);
        await fetchData();
        if (isShunt) {
          setSelectedShuntKey(makeDeviceKey(String(editorForm.serial_number), parseFloat(editorForm.range || 0), true));
          setSelectedShuntReportId(res.data?.reports?.[0]?.id ?? null);
        } else {
          setAuxiliaryTvcSn(String(editorForm.serial_number));
          setSelectedTvcReportId(res.data?.reports?.[0]?.id ?? null);
        }
      } else if (editorMode === "report-new") {
        const base = `${API_BASE_URL}/${isShunt ? "shunts" : "tvcs"}/${editorForm.deviceId}/reports/`;
        const res = await axios.post(base, reportPayload);
        await fetchData();
        if (isShunt) setSelectedShuntReportId(res.data?.id ?? null);
        else setSelectedTvcReportId(res.data?.id ?? null);
      } else {
        // report-edit
        const base = `${API_BASE_URL}/${isShunt ? "shunts" : "tvcs"}/${editorForm.deviceId}/reports/${editorForm.reportId}/`;
        await axios.put(base, reportPayload);
        await fetchData();
        if (isShunt) setSelectedShuntReportId(editorForm.reportId);
        else setSelectedTvcReportId(editorForm.reportId);
      }

      notify("Report of Calibration saved.", "success");
      setIsEditorOpen(false);
      setEditorForm(initialEditorState);
    } catch (err) {
      notify(`Error saving: ${extractError(err)}`, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const executeDelete = async () => {
    const { kind, payload } = deleteConfirm;
    try {
      if (kind === "report") {
        const { type, deviceId, reportId } = payload;
        await axios.delete(`${API_BASE_URL}/${type === "shunt" ? "shunts" : "tvcs"}/${deviceId}/reports/${reportId}/`);
        notify("Report of Calibration deleted.", "success");
      } else if (kind === "device") {
        const { type, deviceId } = payload;
        await axios.delete(`${API_BASE_URL}/${type === "shunt" ? "shunts" : "tvcs"}/${deviceId}/`);
        notify(`${type === "shunt" ? "AC Shunt" : "TVC"} entry deleted.`, "success");
        if (type === "shunt") setSelectedShuntKey("");
        else setAuxiliaryTvcSn("");
      }
      await fetchData();
    } catch (err) {
      notify(`Error deleting: ${extractError(err)}`, "error");
    } finally {
      setDeleteConfirm({ isOpen: false, kind: null, payload: null });
    }
  };

  const handlePinReport = async (type, device, report, shouldPin) => {
    try {
      await axios.post(
        `${API_BASE_URL}/${type === "shunt" ? "shunts" : "tvcs"}/${device.id}/reports/${report.id}/pin/`,
        { pinned: shouldPin }
      );
      notify(shouldPin ? "Report pinned as active." : "Pin removed — latest-dated report is active.", "success");
      await fetchData();
    } catch (err) {
      notify(`Error updating active report: ${extractError(err)}`, "error");
    }
  };

  const extractError = (err) => {
    const data = err.response?.data;
    if (!data) return err.message;
    if (typeof data === "string") return data;
    if (data.detail) return String(data.detail);
    if (typeof data === "object") {
      const parts = Object.entries(data).map(([field, val]) => {
        const text = Array.isArray(val) ? val.join(" ") : String(val);
        return field === "non_field_errors" ? text : `${field}: ${text}`;
      });
      if (parts.length) return parts.join(" — ");
    }
    return err.message;
  };

  const handlePointChange = (index, field, value) => {
    setEditorForm((prev) => {
      const points = [...prev.points];
      points[index] = { ...points[index], [field]: value };
      return { ...prev, points };
    });
  };

  // =====================================================================
  //  Generate test points (uses the displayed report's table)
  // =====================================================================
  const handleRowClick = (row, headers) => {
    if (isReadOnly) return;
    if (isCalibrationActive) {
      notify("Calibration is currently running. Row actions are disabled until the run finishes.", "warning");
      return;
    }
    if (!selectedSessionId) {
      notify("Please select or create an active Calibration Session first.", "warning");
      return;
    }
    const isMismatch =
      selectedShuntDevice &&
      String(selectedShuntDevice.serial_number) !== String(standardInstrumentSerial);
    setAddPointsConfirm({ isOpen: true, row, headers, isMismatch });
  };

  const executeGenerateTestPoints = async () => {
    const { row, headers } = addPointsConfirm;
    const rowFrequencies = headers
      .filter((freq) => row.values[freq] !== undefined && row.values[freq] !== null && row.values[freq] !== "—")
      .map((f) => parseFloat(f));

    if (rowFrequencies.length === 0) {
      notify("No valid frequencies found in this row.", "warning");
      setAddPointsConfirm({ isOpen: false, row: null, headers: null });
      return;
    }

    const currentVal = parseFloat(row.current);
    const rangeVal = parseFloat(row.range);

    const existingFreqs = new Set(
      (uniqueTestPoints || [])
        .filter((p) => Math.abs(parseFloat(p.current) - currentVal) < 1e-6)
        .map((p) => parseInt(p.frequency, 10))
    );

    const filteredFrequencies = rowFrequencies.filter((f) => !existingFreqs.has(parseInt(f, 10)));

    if (filteredFrequencies.length === 0) {
      notify(`All frequencies for ${currentVal}A already exist in this session.`, "info");
      setAddPointsConfirm({ isOpen: false, row: null, headers: null });
      return;
    }

    const newPoints = filteredFrequencies.flatMap((freq) => [
      { current: currentVal, frequency: freq, direction: "Forward" },
      { current: currentVal, frequency: freq, direction: "Reverse" },
    ]);

    let suitableAmpRange = rangeVal;
    if (typeof AMPLIFIER_RANGES_A !== "undefined") {
      const foundRange = AMPLIFIER_RANGES_A.find((r) => currentVal <= r);
      if (foundRange !== undefined) suitableAmpRange = foundRange;
    }

    try {
      if (!isNaN(rangeVal)) {
        await axios.put(`${API_BASE_URL}/calibration_sessions/${selectedSessionId}/configurations/`, {
          amplifier_range: suitableAmpRange,
          ac_shunt_range: rangeVal,
        });
      }
      const response = await axios.post(
        `${API_BASE_URL}/calibration_sessions/${selectedSessionId}/test_points/append/`,
        { points: newPoints }
      );
      notify(response.data?.message || "Test points generated and Amplifier range configured!", "success");
      if (onUpdate) await onUpdate();
      setTimeout(() => onClose(), 300);
    } catch (error) {
      notify(error.response?.data?.detail || "Error generating test points.", "error");
    } finally {
      setAddPointsConfirm({ isOpen: false, row: null, headers: null });
    }
  };

  // =====================================================================
  //  Render: report timeline bar (shared)
  // =====================================================================
  const renderReportBar = (type, device, reports, selectedReport, onSelectReport) => {
    if (!device) return null;
    const hasReports = reports.length > 0;
    return (
      <div className="corrections-report-bar">
        <div className="corrections-report-bar-main">
          <span className="corrections-card-eyebrow">
            <FaHistory aria-hidden /> Report of Calibration
          </span>
          {hasReports ? (
            <div className="corrections-card-picker">
              <select
                className="corrections-card-select"
                value={selectedReport?.id ?? ""}
                onChange={(e) => onSelectReport(Number(e.target.value))}
                aria-label="Report of Calibration date"
              >
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {formatReportDate(r.calibration_date)}
                    {r.report_number ? ` · ${r.report_number}` : ""}
                    {r.is_pinned ? " (pinned)" : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <span className="corrections-card-subtitle">No reports on file yet.</span>
          )}
        </div>

        {!isReadOnly && (
          <div className="corrections-card-actions">
            <IconBtn
              icon={<FaPlus />}
              onClick={() => openNewReport(type)}
              title="Add a new Report of Calibration"
              disabled={!hasReports && !device}
            />
            {selectedReport && (
              <>
                <IconBtn
                  icon={<FaEdit />}
                  onClick={() => requestEditReport(type)}
                  title={device.is_manual ? "Edit this report" : "Edit this report (admin)"}
                />
                <IconBtn
                  icon={<FaThumbtack />}
                  onClick={() => handlePinReport(type, device, selectedReport, !selectedReport.is_pinned)}
                  title={selectedReport.is_pinned ? "Unpin (revert to latest-dated)" : "Pin as active report"}
                  active={selectedReport.is_pinned}
                />
                {reports.length > 1 && (
                  <IconBtn
                    icon={<FaTrash />}
                    onClick={() =>
                      setDeleteConfirm({
                        isOpen: true,
                        kind: "report",
                        payload: { type, deviceId: device.id, reportId: selectedReport.id },
                      })
                    }
                    title="Delete this report"
                    variant="danger"
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderReportMeta = (report) => {
    if (!report) return null;
    return (
      <div className="corrections-report-meta">
        {report.is_active && (
          <FaCheckCircle
            className="corrections-active-icon"
            title="Active report"
            aria-label="Active report"
          />
        )}
        {report.is_pinned && <span className="corrections-manual-badge">Pinned</span>}
        {report.received_date && (
          <span className="corrections-report-meta-item">Received {formatReportDate(report.received_date)}</span>
        )}
        {report.notes && <span className="corrections-report-meta-note">{report.notes}</span>}
      </div>
    );
  };

  // =====================================================================
  //  Render: shunt table
  // =====================================================================
  const renderShuntTable = () => {
    const { headers, rows } = pivotedShuntData;

    if (isLoading && rows.length === 0) {
      return (
        <div className="corrections-empty-state">
          <span className="corrections-empty-state-title">Loading instrument database…</span>
          <span className="corrections-empty-state-message">Fetching corrections and uncertainties.</span>
        </div>
      );
    }
    if (!selectedShuntDevice) {
      return (
        <div className="corrections-empty-state">
          <span className="corrections-empty-state-title">No shunt selected</span>
          <span className="corrections-empty-state-message">Pick a serial number from the picker above to view its corrections.</span>
        </div>
      );
    }
    if (!selectedShuntReport) {
      return (
        <div className="corrections-empty-state">
          <span className="corrections-empty-state-title">No Report of Calibration</span>
          <span className="corrections-empty-state-message">
            This shunt has no reports yet. Use the <strong>+</strong> button on the report bar to add one.
          </span>
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        <div className="corrections-empty-state">
          <span className="corrections-empty-state-title">No data available</span>
          <span className="corrections-empty-state-message">
            No {shuntView === "Corrections" ? "correction" : "uncertainty"} data in this report.
          </span>
        </div>
      );
    }

    const rowsAreInteractive = !isReadOnly && !isCalibrationActive;
    const hintCopy = isReadOnly
      ? "Read-only view. Test point generation is available to the host."
      : isCalibrationActive
        ? "Calibration is running - row actions are temporarily disabled."
        : "Click any row to generate matching test points in your active session.";

    return (
      <>
        <p className="corrections-card-hint">
          <span className="corrections-card-hint-dot" aria-hidden />
          {hintCopy}
        </p>
        <div className="corrections-workbook-wrapper">
          <div className="corrections-table-container">
            <table className="styled-table styled-table--centered">
              <thead>
                <tr>
                  <th>Range (A)</th>
                  <th>Current (A)</th>
                  {headers.map((freq) => (
                    <th key={freq}>{freq} Hz</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.range}-${row.current}`}
                    className={rowsAreInteractive ? "styled-table-row--clickable" : ""}
                    onClick={rowsAreInteractive ? () => handleRowClick(row, headers) : undefined}
                    title={
                      isReadOnly
                        ? "Read-only: observers can't generate test points"
                        : isCalibrationActive
                          ? "Disabled while calibration is running"
                          : `Generate test points for ${row.current}A`
                    }
                  >
                    <td>{row.range}</td>
                    <td>{row.current}</td>
                    {headers.map((freq) => (
                      <td key={freq}>{row.values[freq] ?? "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="corrections-workbook-tabs" role="tablist" aria-label="Shunt data view">
            <button
              type="button"
              role="tab"
              aria-selected={shuntView === "Corrections"}
              className={`corrections-workbook-tab ${shuntView === "Corrections" ? "is-active" : ""}`}
              onClick={() => setShuntView("Corrections")}
            >
              Corrections
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={shuntView === "Uncertainties"}
              className={`corrections-workbook-tab ${shuntView === "Uncertainties" ? "is-active" : ""}`}
              onClick={() => setShuntView("Uncertainties")}
            >
              Uncertainties
            </button>
          </div>
        </div>
      </>
    );
  };

  // =====================================================================
  //  Render: TVC table for a given report
  // =====================================================================
  const renderTvcReportTable = (report, { compact = false } = {}) => {
    if (!report || !(report.corrections || []).length) {
      return (
        <div className={`corrections-empty-state${compact ? " corrections-empty-state--compact" : ""}`}>
          <span className="corrections-empty-state-title">No corrections on file</span>
          <span className="corrections-empty-state-message">This report has no correction data.</span>
        </div>
      );
    }
    const sorted = [...report.corrections].sort((a, b) => a.frequency - b.frequency);
    return (
      <div className="corrections-table-container">
        <table className="styled-table">
          <thead>
            <tr>
              <th>Frequency (Hz)</th>
              <th>AC/DC Difference (ppm)</th>
              <th>Expanded Uncertainty (ppm)</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((corr, index) => (
              <tr key={index}>
                <td>{corr.frequency}</td>
                <td>{corr.ac_dc_difference}</td>
                <td>{corr.expanded_uncertainty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // Read-only session TVC panel: shows the *active* report for an assigned serial.
  const renderSessionTvc = (rowKey, eyebrow, serial) => {
    const record = serial ? tvcsData.find((t) => String(t.serial_number) === String(serial)) : null;
    const activeReport = record ? pickActiveReport(record.reports || []) : null;
    return (
      <section className="corrections-card corrections-session-tvc-card">
        <header className="corrections-card-header corrections-card-header--compact">
          <div className="corrections-card-headline">
            <span className="corrections-card-eyebrow">{eyebrow}</span>
            <div className="corrections-card-title">
              {serial ? (
                <>
                  <span className="corrections-card-identity">S/N&nbsp;{serial}</span>
                  {record?.is_manual && <span className="corrections-manual-badge">Manual</span>}
                  {activeReport?.calibration_date && (
                    <span className="corrections-report-meta-item">
                      {formatReportDate(activeReport.calibration_date)}
                    </span>
                  )}
                </>
              ) : (
                <span className="corrections-card-identity corrections-card-identity--empty">Not assigned</span>
              )}
            </div>
          </div>
        </header>
        <div className="corrections-card-body">
          {serial ? renderTvcReportTable(activeReport, { compact: true }) : (
            <div className="corrections-empty-state corrections-empty-state--compact">
              <span className="corrections-empty-state-title">Not assigned</span>
              <span className="corrections-empty-state-message">No TVC serial assigned for this role.</span>
            </div>
          )}
        </div>
      </section>
    );
  };

  // =====================================================================
  //  Render: editor (add / edit report)
  // =====================================================================
  const renderEditor = () => {
    const isShunt = editorType === "shunt";
    const typeLabel = isShunt ? "AC Shunt" : "TVC";
    const modeLabel =
      editorMode === "device-new" ? "New device" : editorMode === "report-new" ? "New report" : "Editing report";
    const value1Label = isShunt ? "Correction (ppm)" : "AC/DC Diff (ppm)";
    const value2Label = isShunt ? "Uncertainty (ppm)" : "Expanded Unc (ppm)";
    const identityLocked = editorMode !== "device-new";

    return (
      <div className="corrections-manual-form">
        <header className="corrections-manual-header">
          <div className="corrections-manual-toolbar-title">
            <span className="corrections-card-eyebrow">{modeLabel} · {typeLabel}</span>
            <h2 className="corrections-manual-identity">{editorForm.serial_number || "—"}</h2>
          </div>
        </header>

        <div className="corrections-manual-body">
          {/* Identity */}
          <section className="corrections-card">
            <header className="corrections-card-header corrections-card-header--compact">
              <div className="corrections-card-headline">
                <span className="corrections-card-eyebrow">Device identity</span>
                <span className="corrections-card-subtitle">
                  {identityLocked
                    ? "Serial and range are fixed for this device."
                    : isShunt
                      ? "Identify the shunt model, serial, and range."
                      : "Identify the TVC serial and its nominal test voltage."}
                </span>
              </div>
            </header>
            <div className="corrections-card-body">
              <div className="corrections-form-grid">
                {isShunt ? (
                  <>
                    <div className="corrections-form-field">
                      <label>Model name</label>
                      <input
                        type="text"
                        value={editorForm.model_name ?? ""}
                        onChange={(e) => setEditorForm((p) => ({ ...p, model_name: e.target.value }))}
                        placeholder="e.g. A40B"
                      />
                    </div>
                    <div className="corrections-form-field">
                      <label>Serial number</label>
                      <input
                        type="text"
                        disabled={identityLocked}
                        value={editorForm.serial_number ?? ""}
                        onChange={(e) => setEditorForm((p) => ({ ...p, serial_number: e.target.value }))}
                        placeholder="e.g. 450274734"
                      />
                    </div>
                    <div className="corrections-form-field">
                      <label>Range (A)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={identityLocked}
                        value={editorForm.range ?? ""}
                        onChange={(e) => setEditorForm((p) => ({ ...p, range: e.target.value }))}
                        placeholder="e.g. 0.01"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="corrections-form-field">
                      <label>Serial number</label>
                      <input
                        type="text"
                        disabled={identityLocked}
                        value={editorForm.serial_number ?? ""}
                        onChange={(e) => setEditorForm((p) => ({ ...p, serial_number: e.target.value }))}
                        placeholder="e.g. 20877"
                      />
                    </div>
                    <div className="corrections-form-field">
                      <label>Test voltage (V)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={editorForm.test_voltage ?? ""}
                        onChange={(e) => setEditorForm((p) => ({ ...p, test_voltage: e.target.value }))}
                        placeholder="e.g. 1.0"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* Report metadata */}
          <section className="corrections-card">
            <header className="corrections-card-header corrections-card-header--compact">
              <div className="corrections-card-headline">
                <span className="corrections-card-eyebrow">Report of Calibration</span>
                <span className="corrections-card-subtitle">
                  Tie these values to the certificate's date so older calibrations stay on record.
                </span>
              </div>
            </header>
            <div className="corrections-card-body">
              <div className="corrections-form-grid">
                <div className="corrections-form-field">
                  <label>Calibration date</label>
                  <input
                    type="date"
                    value={editorForm.calibration_date ?? ""}
                    onChange={(e) => setEditorForm((p) => ({ ...p, calibration_date: e.target.value }))}
                  />
                </div>
                <div className="corrections-form-field">
                  <label>Report number</label>
                  <input
                    type="text"
                    value={editorForm.report_number ?? ""}
                    onChange={(e) => setEditorForm((p) => ({ ...p, report_number: e.target.value }))}
                    placeholder="e.g. RC-2024-0142"
                  />
                </div>
                <div className="corrections-form-field">
                  <label>Received date</label>
                  <input
                    type="date"
                    value={editorForm.received_date ?? ""}
                    onChange={(e) => setEditorForm((p) => ({ ...p, received_date: e.target.value }))}
                  />
                </div>
                <div className="corrections-form-field corrections-form-field--wide">
                  <label>Notes</label>
                  <input
                    type="text"
                    value={editorForm.notes ?? ""}
                    onChange={(e) => setEditorForm((p) => ({ ...p, notes: e.target.value }))}
                    placeholder="Optional remarks for this report"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Points */}
          <section className="corrections-card">
            <header className="corrections-card-header corrections-card-header--compact">
              <div className="corrections-card-headline">
                <span className="corrections-card-eyebrow">Correction points</span>
                <span className="corrections-card-subtitle">
                  {editorForm.points.length} point{editorForm.points.length === 1 ? "" : "s"} · values in ppm
                </span>
              </div>
              <div className="corrections-card-actions">
                <IconBtn
                  icon={<FaPlus />}
                  onClick={() =>
                    setEditorForm((p) => ({
                      ...p,
                      points: [...p.points, isShunt ? emptyShuntPoint() : emptyTvcPoint()],
                    }))
                  }
                  title="Add correction point"
                />
              </div>
            </header>

            <div className="corrections-card-body corrections-card-body--points">
              {editorForm.points.length > 0 ? (
                <div className={`corrections-points-table${isShunt ? " corrections-points-table--shunt" : ""}`} role="table">
                  <div className="corrections-points-thead" role="row">
                    {isShunt && <span role="columnheader">Current (A)</span>}
                    <span role="columnheader">Frequency (Hz)</span>
                    <span role="columnheader">{value1Label}</span>
                    <span role="columnheader">{value2Label}</span>
                    <span role="columnheader" aria-hidden className="corrections-points-spacer" />
                  </div>

                  {editorForm.points.map((p, i) => (
                    <div key={i} className="corrections-points-row" role="row">
                      {isShunt && (
                        <input
                          type="text"
                          inputMode="decimal"
                          className="corrections-points-input"
                          placeholder="e.g. 0.002"
                          value={p.current ?? ""}
                          onChange={(e) => handlePointChange(i, "current", e.target.value)}
                        />
                      )}
                      <input
                        type="text"
                        inputMode="decimal"
                        className="corrections-points-input"
                        placeholder="e.g. 1000"
                        value={p.frequency ?? ""}
                        onChange={(e) => handlePointChange(i, "frequency", e.target.value)}
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        className="corrections-points-input"
                        placeholder={isShunt ? "Correction" : "AC/DC diff"}
                        value={p.val1 ?? ""}
                        onChange={(e) => handlePointChange(i, "val1", e.target.value)}
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        className="corrections-points-input"
                        placeholder="Uncertainty"
                        value={p.val2 ?? ""}
                        onChange={(e) => handlePointChange(i, "val2", e.target.value)}
                      />
                      <IconBtn
                        icon={<FaTimes />}
                        onClick={() =>
                          setEditorForm((prev) => ({
                            ...prev,
                            points: prev.points.filter((_, idx) => idx !== i),
                          }))
                        }
                        title="Remove point"
                        variant="danger"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="corrections-empty-state corrections-empty-state--compact">
                  <span className="corrections-empty-state-title">No correction points</span>
                  <span className="corrections-empty-state-message">Use the <strong>+</strong> button above to add your first point.</span>
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="corrections-manual-footer">
          <IconBtn
            icon={<FaArrowLeft />}
            onClick={() => setIsEditorOpen(false)}
            disabled={isSaving}
            title="Back to browser"
          />
          <IconBtn
            icon={<FaSave />}
            onClick={handleSaveEditor}
            disabled={isSaving}
            title={isSaving ? "Saving…" : "Save report"}
          />
        </footer>
      </div>
    );
  };

  // =====================================================================
  //  Render: TVC database panels
  // =====================================================================
  const renderTvcDatabasePanels = () => {
    return (
      <div className="corrections-tab-content">
        <div className="corrections-section">
          <div className="corrections-section-heading">
            <span className="corrections-section-eyebrow">Session TVCs</span>
            <span className="corrections-section-subtitle">Active-report corrections for the TVCs assigned to this session.</span>
          </div>
          <div className="corrections-session-tvc-grid">
            {renderSessionTvc("std", "Standard TVC", standardTvcSn)}
            {renderSessionTvc("test", "Test TVC", testTvcSn)}
          </div>
        </div>

        <div className="corrections-section">
          <div className="corrections-section-heading">
            <span className="corrections-section-eyebrow">Auxiliary lookup</span>
            <span className="corrections-section-subtitle">Browse any TVC on file, review its report history, or add manual entries.</span>
          </div>

          <section className="corrections-card">
            <header className="corrections-card-header">
              <div className="corrections-card-headline">
                <span className="corrections-card-eyebrow">Auxiliary TVC</span>
                <div className="corrections-card-picker">
                  <select
                    className="corrections-card-select"
                    value={auxiliaryTvcSn || ""}
                    onChange={(e) => setAuxiliaryTvcSn(e.target.value)}
                    disabled={isLoading}
                    aria-label="Auxiliary TVC serial number"
                  >
                    <option value="">Select a serial number...</option>
                    {tvcOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {selectedTvc?.is_manual && <span className="corrections-manual-badge">Manual</span>}
                </div>
              </div>
              <div className="corrections-card-actions">
                {!isReadOnly && (
                  <>
                    <IconBtn icon={<FaPlus />} onClick={() => openNewDevice("tvc")} title="Add manual TVC entry" />
                    {selectedTvc?.is_manual && (
                      <IconBtn
                        icon={<FaTrash />}
                        onClick={() =>
                          setDeleteConfirm({
                            isOpen: true,
                            kind: "device",
                            payload: { type: "tvc", deviceId: selectedTvc.id },
                          })
                        }
                        title="Delete TVC entry"
                        variant="danger"
                      />
                    )}
                  </>
                )}
              </div>
            </header>

            {selectedTvc && renderReportBar("tvc", selectedTvc, tvcReports, selectedTvcReport, setSelectedTvcReportId)}

            <div className="corrections-card-body">
              {selectedTvc ? (
                <>
                  {renderReportMeta(selectedTvcReport)}
                  {renderTvcReportTable(selectedTvcReport)}
                </>
              ) : (
                <div className="corrections-empty-state">
                  <span className="corrections-empty-state-title">Nothing selected</span>
                  <span className="corrections-empty-state-message">Choose a serial number from the picker above to inspect its corrections.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    );
  };

  // =====================================================================
  //  Render root
  // =====================================================================
  return (
    <AnimatedModalShell
      isOpen={isOpen}
      onClose={handleShellClose}
      panelClassName="corrections-modal-content"
      panelProps={{
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "corrections-modal-title",
      }}
    >
        <header className="corrections-modal-header">
          <div className="corrections-modal-header-text">
            <span className="corrections-modal-eyebrow">Reference data{isReadOnly ? " · Read-only" : ""}</span>
            <h3 id="corrections-modal-title" className="corrections-modal-title">Corrections &amp; Uncertainties</h3>
          </div>
          <div className="corrections-modal-header-actions">
            {!isEditorOpen && (
              <div className="cal-results-tabs corrections-modal-type-toggle" role="tablist" aria-label="Correction data type">
                <button
                  type="button"
                  role="tab"
                  aria-selected={primaryTab === "AC Shunt"}
                  className={`cal-results-tab${primaryTab === "AC Shunt" ? " is-active" : ""}`}
                  onClick={() => setPrimaryTab("AC Shunt")}
                >
                  AC Shunt
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={primaryTab === "TVC"}
                  className={`cal-results-tab${primaryTab === "TVC" ? " is-active" : ""}`}
                  onClick={() => setPrimaryTab("TVC")}
                >
                  TVC
                </button>
              </div>
            )}
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={handleShellClose}
              className="cal-results-excel-icon-btn corrections-modal-close"
              title="Close"
              aria-label="Close"
            >
              <FaTimes aria-hidden />
            </button>
          </div>
        </header>

        <main className="corrections-modal-body">
          {isEditorOpen ? (
            renderEditor()
          ) : primaryTab === "AC Shunt" ? (
            <section className="corrections-card corrections-card--shunt-picker">
              <header className="corrections-card-header">
                <div className="corrections-card-headline">
                  <span className="corrections-card-eyebrow">AC Shunt</span>
                  <div className="corrections-card-picker">
                    <select
                      className="corrections-card-select"
                      value={selectedShuntKey || ""}
                      onChange={(e) => setSelectedShuntKey(e.target.value)}
                      disabled={isLoading}
                      aria-label="AC Shunt serial number"
                    >
                      <option value="">Select a serial number...</option>
                      {shuntOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {selectedShuntDevice?.is_manual && <span className="corrections-manual-badge">Manual</span>}
                  </div>
                </div>

                <div className="corrections-card-actions">
                  {!isReadOnly && (
                    <>
                      <IconBtn icon={<FaPlus />} onClick={() => openNewDevice("shunt")} title="Add manual AC shunt device" />
                      {selectedShuntDevice?.is_manual && (
                        <IconBtn
                          icon={<FaTrash />}
                          onClick={() =>
                            setDeleteConfirm({
                              isOpen: true,
                              kind: "device",
                              payload: { type: "shunt", deviceId: selectedShuntDevice.id },
                            })
                          }
                          title="Delete device"
                          variant="danger"
                        />
                      )}
                    </>
                  )}
                </div>
              </header>

              {selectedShuntDevice &&
                renderReportBar("shunt", selectedShuntDevice, shuntReports, selectedShuntReport, setSelectedShuntReportId)}

              <div className="corrections-card-body">
                {renderReportMeta(selectedShuntReport)}
                {renderShuntTable()}
              </div>
            </section>
          ) : (
            renderTvcDatabasePanels()
          )}
        </main>

        {/* Sub-prompts render as a sheet over the modal body. They sit
            *below* the modal header (see .corrections-subprompt-overlay /
            .corrections-modal-header z-index in App.css) so the main close
            (X) is never covered and always closes the whole modal. */}
        <PasswordModal
          isOpen={passwordGate.isOpen}
          overlayClassName="corrections-subprompt-overlay"
          title="Admin Authentication Required"
          message="You are modifying imported system parameters. Please input your authorization key:"
          onConfirm={handlePasswordVerify}
          onCancel={() => setPasswordGate({ isOpen: false, action: null })}
        />

        <ConfirmationModal
          isOpen={deleteConfirm.isOpen}
          overlayClassName="corrections-subprompt-overlay"
          title={deleteConfirm.kind === "device" ? "Delete Device" : "Delete Report"}
          message={
            deleteConfirm.kind === "device"
              ? "Permanently delete this device and ALL of its calibration history? This cannot be undone."
              : "Permanently delete this Report of Calibration? Older reports for this device will remain. This cannot be undone."
          }
          confirmText="Delete"
          confirmButtonClass="button-danger"
          onConfirm={executeDelete}
          onCancel={() => setDeleteConfirm({ isOpen: false, kind: null, payload: null })}
        />

        <ConfirmationModal
          isOpen={addPointsConfirm.isOpen}
          overlayClassName="corrections-subprompt-overlay"
          title={addPointsConfirm.isMismatch ? "Serial Mismatch Warning" : "Generate Test Points?"}
          message={
            addPointsConfirm.isMismatch
              ? `WARNING: The serial number of this AC Shunt (${selectedShuntDevice?.serial_number}) does not match the Standard Instrument serial assigned to this session (${standardInstrumentSerial || "None"}).\n\nGenerating test points from the wrong correction table may result in incorrect applied currents. Proceed and add test points for ${addPointsConfirm.row?.current}A?`
              : `Add test points for ${addPointsConfirm.row?.current}A at all available frequencies to the current calibration session?`
          }
          confirmText={addPointsConfirm.isMismatch ? "Proceed Anyway" : "Generate Points"}
          confirmButtonClass={addPointsConfirm.isMismatch ? "button-danger" : "button-primary"}
          onConfirm={executeGenerateTestPoints}
          onCancel={() => setAddPointsConfirm({ isOpen: false, row: null, headers: null, isMismatch: false })}
        />
      </AnimatedModalShell>
  );
}

export default CorrectionsModal;
