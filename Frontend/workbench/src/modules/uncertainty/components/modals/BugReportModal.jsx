import React, { useState } from "react";
import ReactDOM from "react-dom";
import { useFloatingWindow } from '../../hooks/useFloatingWindow';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faBug,
    faLightbulb,
    faCheck,
    faTimes,
    faList,
    faPlus,
    faCommentDots,
    faUser,
    faCalendarAlt,
    faPen,
    faTrash
} from "@fortawesome/free-solid-svg-icons";

const BugReportModal = ({ isOpen, onClose, reports = [], onSave, onDelete }) => {
    const [activeTab, setActiveTab] = useState("new"); // 'new' | 'list'

    const getTodayString = () => new Date().toISOString().split('T')[0];

    const [formData, setFormData] = useState({
        id: null, // Track ID for editing
        title: "",
        type: "Bug",
        priority: "Normal",
        description: "",
        steps: "",
        reporter: "",
        date: getTodayString()
    });

    const [notification, setNotification] = useState(null);

    const { position, handleMouseDown } = useFloatingWindow({
        isOpen,
        defaultWidth: 600,
        defaultHeight: 750
    });

    if (!isOpen) return null;

    // --- Actions ---

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.title || !formData.description) {
            setNotification({ type: "error", message: "Please fill in the title and description." });
            return;
        }

        const reportId = formData.id || Date.now().toString();

        const newReport = {
            ...formData,
            id: reportId,
            timestamp: formData.id ? undefined : new Date().toISOString(),
            status: formData.status || "Open",
        };

        if (!newReport.timestamp) newReport.timestamp = new Date().toISOString();

        try {
            if (onSave) {
                await onSave(newReport);
                setNotification({ type: "success", message: formData.id ? "Report updated." : "Report submitted." });

                // Reset Form
                setFormData({
                    id: null,
                    title: "",
                    type: "Bug",
                    priority: "Normal",
                    description: "",
                    steps: "",
                    reporter: formData.reporter,
                    date: getTodayString(),
                    status: "Open"
                });

                setTimeout(() => setNotification(null), 3000);

                if (formData.id) setActiveTab("list");
            }
        } catch (err) {
            setNotification({ type: "error", message: "Failed to save report." });
        }
    };

    const handleEdit = (report) => {
        setFormData({
            id: report.id,
            title: report.title,
            type: report.type,
            priority: report.priority,
            description: report.description,
            steps: report.steps || "",
            reporter: report.reporter || "",
            date: report.date || getTodayString(),
            status: report.status || "Open"
        });
        setActiveTab("new"); // Switch to form view
    };

    const handleMarkComplete = async (report) => {
        const updated = { ...report, status: "Complete" };
        if (onSave) await onSave(updated);
    };

    const handleDelete = async (reportId) => {
        // Simply delegate to parent (App.jsx), which triggers notification
        if (onDelete) await onDelete(reportId);
    };

    const getPriorityColor = (p) => {
        switch (p) {
            case "Critical": return "var(--status-bad)";
            case "High": return "var(--orbital-gold)";
            case "Normal": return "var(--primary-color)";
            case "Low": return "var(--text-color-muted)";
            default: return "var(--text-color)";
        }
    };

    const getTypeIcon = (t) => {
        return t === "Bug" ? faBug : faLightbulb;
    };

    return ReactDOM.createPortal(
        <div
            className="bug-report-window floating-window-content"
            style={{
                position: 'fixed',
                top: position.y,
                left: position.x,
                width: '600px',
                height: '750px',
                maxWidth: '95vw',
                maxHeight: '90vh',
                zIndex: 3000,
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            {/* --- Draggable Header --- */}
            <div
                className="window-header"
                onMouseDown={handleMouseDown}
                style={{
                    padding: '12px 20px',
                    borderBottom: '1px solid var(--border-color)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'move',
                    backgroundColor: 'var(--background-secondary)',
                    userSelect: 'none'
                }}
            >
                <h3 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <FontAwesomeIcon icon={faCommentDots} style={{ color: 'var(--primary-color)' }} />
                    Feedback & Issues
                </h3>
                <button
                    onClick={onClose}
                    className="modal-close-button"
                    style={{ position: 'static', fontSize: '1.2rem' }}
                >
                    &times;
                </button>
            </div>

            {/* --- Body --- */}
            <div className="bug-window-body" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

                {/* Tabs */}
                <div className="analysis-tabs" style={{ padding: '0 20px', marginTop: '15px', flexShrink: 0 }}>
                    <button
                        className={activeTab === 'new' ? 'active' : ''}
                        onClick={() => {
                            if (activeTab === 'list') {
                                setFormData({
                                    id: null, title: "", type: "Bug", priority: "Normal", description: "", steps: "",
                                    reporter: formData.reporter, date: getTodayString(), status: "Open"
                                });
                            }
                            setActiveTab('new');
                        }}
                    >
                        <FontAwesomeIcon icon={faPlus} style={{ marginRight: '6px' }} /> {formData.id ? 'Edit Report' : 'New Report'}
                    </button>
                    <button
                        className={activeTab === 'list' ? 'active' : ''}
                        onClick={() => setActiveTab('list')}
                    >
                        <FontAwesomeIcon icon={faList} style={{ marginRight: '6px' }} /> History ({reports.length})
                    </button>
                </div>

                <div className="modal-body-scrollable" style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>

                    {notification && (
                        <div className={`form-section-warning`} style={{
                            backgroundColor: notification.type === 'success' ? 'var(--status-good-bg)' : 'var(--status-bad-bg)',
                            color: notification.type === 'success' ? 'var(--status-good)' : 'var(--status-bad)',
                            borderColor: notification.type === 'success' ? 'var(--status-good)' : 'var(--status-bad)',
                            display: 'flex', alignItems: 'center', gap: '10px', marginTop: '0', marginBottom: '20px',
                            padding: '10px 15px', fontSize: '0.9rem'
                        }}>
                            <FontAwesomeIcon icon={notification.type === 'success' ? faCheck : faTimes} />
                            {notification.message}
                        </div>
                    )}

                    {activeTab === "new" && (
                        <form onSubmit={handleSubmit} className="bug-report-form">

                            {/* Row 1: Reporter & Date */}
                            <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
                                <div className="form-group">
                                    <label><FontAwesomeIcon icon={faUser} style={{ marginRight: '5px', fontSize: '0.8em' }} /> Reporter</label>
                                    <input
                                        type="text"
                                        value={formData.reporter}
                                        onChange={e => setFormData({ ...formData, reporter: e.target.value })}
                                        placeholder="Your Name..."
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div className="form-group">
                                    <label><FontAwesomeIcon icon={faCalendarAlt} style={{ marginRight: '5px', fontSize: '0.8em' }} /> Date</label>
                                    <input
                                        type="date"
                                        value={formData.date}
                                        onChange={e => setFormData({ ...formData, date: e.target.value })}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                            </div>

                            {/* Row 2: Title */}
                            <div className="form-group" style={{ marginBottom: '15px' }}>
                                <label>Summary / Title</label>
                                <input
                                    type="text"
                                    value={formData.title}
                                    onChange={e => setFormData({ ...formData, title: e.target.value })}
                                    placeholder="Brief summary..."
                                    autoFocus
                                    style={{ width: '100%' }}
                                />
                            </div>

                            {/* Row 3: Type & Priority */}
                            <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
                                <div className="form-group">
                                    <label>Type</label>
                                    <select value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value })} style={{ width: '100%' }}>
                                        <option value="Bug">Bug Report</option>
                                        <option value="Feature">Feature Request</option>
                                        <option value="Question">Question</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Priority</label>
                                    <select value={formData.priority} onChange={e => setFormData({ ...formData, priority: e.target.value })} style={{ width: '100%' }}>
                                        <option value="Low">Low</option>
                                        <option value="Normal">Normal</option>
                                        <option value="High">High</option>
                                        <option value="Critical">Critical</option>
                                    </select>
                                </div>
                            </div>

                            {/* Row 4: Description */}
                            <div className="form-group" style={{ marginBottom: '15px' }}>
                                <label>Description</label>
                                <textarea
                                    rows={5}
                                    value={formData.description}
                                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="Describe the issue..."
                                    style={{ resize: 'vertical', width: '100%' }}
                                />
                            </div>

                            {/* Row 5: Steps */}
                            {formData.type === 'Bug' && (
                                <div className="form-group" style={{ marginBottom: '20px' }}>
                                    <label>Steps to Reproduce</label>
                                    <textarea
                                        rows={3}
                                        value={formData.steps}
                                        onChange={e => setFormData({ ...formData, steps: e.target.value })}
                                        placeholder="1. ..."
                                        style={{ resize: 'vertical', width: '100%' }}
                                    />
                                </div>
                            )}

                            {/* Footer Actions */}
                            <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px', paddingTop: '15px', borderTop: '1px solid var(--border-color)' }}>
                                {/* Driven by onClick rather than implicit form
                                    submission: the SharePoint build runs inside
                                    a host that blocks native submits, and a
                                    button that has to reach the browser's form
                                    machinery to work would silently do nothing
                                    there. The surrounding form is kept for Enter
                                    to submit where that is allowed. */}
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    className="nav-btn primary"
                                    style={{ padding: '10px 25px' }}
                                >
                                    <FontAwesomeIcon icon={faCheck} style={{ marginLeft: '8px' }} />
                                </button>
                            </div>
                        </form>
                    )}

                    {activeTab === "list" && (
                        <div className="bug-list-container">
                            {reports.length === 0 ? (
                                <div className="placeholder-content" style={{ minHeight: '200px', border: 'none' }}>
                                    <FontAwesomeIcon icon={faList} style={{ fontSize: '2rem', marginBottom: '10px', opacity: 0.3 }} />
                                    <p>No reports submitted yet.</p>
                                </div>
                            ) : (
                                <div className="bug-cards-grid" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {reports.map(report => (
                                        <div key={report.id} className="bug-card" style={{
                                            background: 'var(--input-background)',
                                            border: '1px solid var(--border-color)',
                                            borderRadius: '8px',
                                            padding: '15px',
                                            position: 'relative',
                                            opacity: report.status === 'Complete' ? 0.7 : 1
                                        }}>

                                            {/* --- CARD HEADER --- */}
                                            <div className="bug-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    <span className={`status-pill ${report.type === 'Bug' ? 'bad' : 'good'}`} style={{
                                                        background: report.type === 'Bug' ? 'rgba(220, 53, 69, 0.1)' : 'rgba(25, 135, 84, 0.1)',
                                                        color: report.type === 'Bug' ? 'var(--status-bad)' : 'var(--status-good)',
                                                        padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold', border: '1px solid currentColor',
                                                        height: 'auto'
                                                    }}>
                                                        <FontAwesomeIcon icon={getTypeIcon(report.type)} style={{ marginRight: '4px' }} />
                                                        {report.type.toUpperCase()}
                                                    </span>
                                                    <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-color)', textDecoration: report.status === 'Complete' ? 'line-through' : 'none' }}>
                                                        {report.title}
                                                    </h4>
                                                </div>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-color-muted)' }}>
                                                    {report.date ? new Date(report.date).toLocaleDateString() : new Date(report.timestamp).toLocaleDateString()}
                                                </span>
                                            </div>

                                            {/* --- META INFO --- */}
                                            <div className="bug-card-meta" style={{ display: 'flex', gap: '15px', fontSize: '0.75rem', color: 'var(--text-color-muted)', marginBottom: '10px', flexWrap: 'wrap' }}>
                                                <span>Priority: <strong style={{ color: getPriorityColor(report.priority) }}>{report.priority}</strong></span>
                                                {report.reporter && (
                                                    <span>Reporter: <strong>{report.reporter}</strong></span>
                                                )}
                                                <span style={{
                                                    color: report.status === 'Complete' ? 'var(--status-good)' : 'var(--text-color)',
                                                    fontWeight: 'bold'
                                                }}>
                                                    Status: {report.status}
                                                </span>
                                            </div>

                                            {/* --- FULL DESCRIPTION --- */}
                                            <p style={{ fontSize: '0.9rem', color: 'var(--text-color)', lineHeight: '1.5', whiteSpace: 'pre-wrap', margin: '0 0 10px 0' }}>
                                                {report.description}
                                            </p>

                                            {/* --- STEPS (If any) --- */}
                                            {report.steps && (
                                                <div style={{ padding: '8px', background: 'var(--background-color)', borderRadius: '4px', marginBottom: '10px' }}>
                                                    <strong style={{ fontSize: '0.75rem', color: 'var(--text-color-muted)', display: 'block', marginBottom: '4px' }}>Steps to Reproduce:</strong>
                                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-color)', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                                                        {report.steps}
                                                    </p>
                                                </div>
                                            )}

                                            {/* --- ACTION BAR --- */}
                                            <div className="bug-card-actions" style={{
                                                display: 'flex',
                                                justifyContent: 'flex-end',
                                                gap: '8px',
                                                paddingTop: '10px',
                                                borderTop: '1px solid var(--border-color)'
                                            }}>
                                                {report.status !== 'Complete' && (
                                                    <button
                                                        className="icon-btn-round"
                                                        onClick={() => handleMarkComplete(report)}
                                                        title="Mark Complete"
                                                        style={{ color: 'var(--status-good)', borderColor: 'var(--status-good)' }}
                                                    >
                                                        <FontAwesomeIcon icon={faCheck} />
                                                    </button>
                                                )}

                                                <button
                                                    className="icon-btn-round"
                                                    onClick={() => handleEdit(report)}
                                                    title="Edit Report"
                                                >
                                                    <FontAwesomeIcon icon={faPen} />
                                                </button>

                                                <button
                                                    className="icon-btn-round"
                                                    onClick={() => handleDelete(report.id)}
                                                    title="Delete Report"
                                                    style={{ color: 'var(--status-bad)', borderColor: 'var(--status-bad)' }}
                                                >
                                                    <FontAwesomeIcon icon={faTrash} />
                                                </button>
                                            </div>

                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default BugReportModal;