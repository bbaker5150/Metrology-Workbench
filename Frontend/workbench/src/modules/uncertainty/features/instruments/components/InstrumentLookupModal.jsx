import React, { useState, useMemo, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSearch,
  faRadio,
  faCheck,
  faChevronDown,
  faChevronUp,
  faInfoCircle,
  faGripHorizontal // Added for drag handle
} from "@fortawesome/free-solid-svg-icons";
import { useFloatingWindow } from "../../../hooks/useFloatingWindow";
import { getUnitDisplayLabel } from "../../../utils/uncertaintyMath";

const InstrumentLookupModal = ({
  isOpen,
  onClose,
  onSelect,
  instruments = [],
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedInst, setSelectedInst] = useState(null);
  const [expandedDetail, setExpandedDetail] = useState(null);

  // Floating Window Logic
  const { position, handleMouseDown } = useFloatingWindow({
    isOpen,
    defaultWidth: 900,
    defaultHeight: 700
  });
  const containerRef = useRef(null);

  // Reset internal state on open (but keep position)
  useEffect(() => {
    if (isOpen) {
      setSearchTerm("");
      setSelectedInst(null);
      setExpandedDetail(null);
    }
  }, [isOpen]);

  // --- Filter Logic ---
  const filteredInstruments = useMemo(() => {
    if (!searchTerm) return instruments;
    const lower = searchTerm.toLowerCase();
    return instruments.filter(
      (i) =>
        (i.manufacturer || "").toLowerCase().includes(lower) ||
        (i.model || "").toLowerCase().includes(lower) ||
        (i.description || "").toLowerCase().includes(lower)
    );
  }, [instruments, searchTerm]);

  const handleConfirm = () => {
    if (selectedInst) {
      onSelect(selectedInst);
      onClose();
    }
  };

  const toggleFunctionDetails = (e, instId, funcId) => {
    e.stopPropagation();
    if (
      expandedDetail &&
      expandedDetail.instId === instId &&
      expandedDetail.funcId === funcId
    ) {
      setExpandedDetail(null);
    } else {
      setExpandedDetail({ instId, funcId });
    }
  };

  const renderToleranceString = (tolerances) => {
    if (!tolerances) return "N/A";
    const parts = [];
    const fmt = (c) => (c.symmetric ? `±${c.high}` : `+${c.high}/-${c.low}`);

    if (tolerances.reading?.high) parts.push(`${fmt(tolerances.reading)}% Rdg`);
    if (tolerances.range?.high)
      parts.push(
        `${fmt(tolerances.range)}% ${tolerances.range.value ? "FS" : "Rng"}`
      );
    if (tolerances.floor?.high)
      parts.push(
        `${fmt(tolerances.floor)} ${getUnitDisplayLabel(tolerances.floor.unit || "")}`
      );

    return parts.length > 0 ? parts.join(" + ") : "Custom";
  };

  if (!isOpen) return null;

  // --- RENDER ---
  return ReactDOM.createPortal(
    <div
      ref={containerRef}
      className="modal-content floating-window-content"
      style={{
        position: 'fixed',
        top: position.y,
        left: position.x,
        margin: 0,
        width: "900px",
        maxWidth: "90vw",
        height: "80vh",
        display: "flex",
        flexDirection: "column",
        zIndex: 3000, /* High Z-Index to float above EditSessionModal */
        overflow: "hidden"
      }}
    >
      {/* Header (Draggable) */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "15px",
          paddingBottom: "10px",
          borderBottom: "1px solid var(--border-color)",
          cursor: "move",
          userSelect: "none"
        }}
      >
        <h3 style={{ margin: 0, fontSize: "1.2rem", display: "flex", alignItems: "center", gap: "10px" }}>
          <span>
            <FontAwesomeIcon icon={faRadio} style={{ marginRight: "10px" }} />
            Select Instrument
          </span>
        </h3>
        <button
          onClick={onClose}
          className="modal-close-button"
          style={{ position: "static" }}
        >
          &times;
        </button>
      </div>

      {/* Search Bar */}
      <div
        className="search-bar"
        style={{ position: "relative", marginBottom: "15px" }}
      >
        <FontAwesomeIcon
          icon={faSearch}
          style={{
            position: "absolute",
            left: "10px",
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-color-muted)",
          }}
        />
        <input
          type="text"
          placeholder="Search Manufacturer, Model, or Description..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: "100%",
            padding: "10px 10px 10px 35px",
            borderRadius: "6px",
            border: "1px solid var(--border-color)",
          }}
          autoFocus
        />
      </div>

      {/* Table View */}
      <div
        className="lookup-table-container"
        style={{
          flex: 1,
          overflowY: "auto",
          border: "1px solid var(--border-color)",
          borderRadius: "6px",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.9rem",
          }}
        >
          <thead
            style={{
              position: "sticky",
              top: 0,
              backgroundColor: "var(--component-header-bg)",
              zIndex: 2,
            }}
          >
            <tr
              style={{
                textAlign: "left",
                borderBottom: "2px solid var(--border-color)",
              }}
            >
              <th style={{ padding: "12px", width: "15%" }}>Manufacturer</th>
              <th style={{ padding: "12px", width: "15%" }}>Model</th>
              <th style={{ padding: "12px", width: "25%" }}>Description</th>
              <th style={{ padding: "12px", width: "35%" }}>
                Functions (Click to View Specs)
              </th>
              <th
                style={{ padding: "12px", width: "10%", textAlign: "center" }}
              >
                Select
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredInstruments.map((inst) => {
              const isSelected = selectedInst?.id === inst.id;
              const isExpanded = expandedDetail?.instId === inst.id;

              return (
                <React.Fragment key={inst.id}>
                  {/* Main Row */}
                  <tr
                    onClick={() => setSelectedInst(inst)}
                    style={{
                      borderBottom: isExpanded
                        ? "none"
                        : "1px solid var(--border-color)",
                      cursor: "pointer",
                      backgroundColor: isSelected
                        ? "var(--primary-color-light)"
                        : "transparent",
                      borderLeft: isSelected
                        ? "4px solid var(--primary-color)"
                        : "4px solid transparent",
                      transition: "background 0.2s",
                    }}
                  >
                    <td style={{ padding: "12px", fontWeight: "600" }}>
                      {inst.manufacturer}
                    </td>
                    <td
                      style={{
                        padding: "12px",
                        color: "var(--primary-color)",
                        fontWeight: "bold",
                      }}
                    >
                      {inst.model}
                    </td>
                    <td
                      style={{
                        padding: "12px",
                        color: "var(--text-color-muted)",
                      }}
                    >
                      {inst.description}
                    </td>
                    <td style={{ padding: "12px" }}>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "5px",
                        }}
                      >
                        {inst.functions.map((f) => {
                          const isFuncActive =
                            isExpanded && expandedDetail.funcId === f.id;
                          return (
                            <button
                              key={f.id}
                              onClick={(e) =>
                                toggleFunctionDetails(e, inst.id, f.id)
                              }
                              className={`status-pill ${isFuncActive ? "active" : ""
                                }`}
                              style={{
                                border: isFuncActive
                                  ? "1px solid var(--primary-color)"
                                  : "1px solid var(--border-color)",
                                backgroundColor: isFuncActive
                                  ? "var(--input-background)"
                                  : "transparent",
                                color: "var(--text-color)",
                                cursor: "pointer",
                                fontSize: "0.75rem",
                                padding: "2px 8px",
                                borderRadius: "12px",
                              }}
                              title="Click to view tolerances"
                            >
                              {f.name}{" "}
                              {isFuncActive ? (
                                <FontAwesomeIcon
                                  icon={faChevronUp}
                                  size="xs"
                                />
                              ) : (
                                <FontAwesomeIcon
                                  icon={faChevronDown}
                                  size="xs"
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td style={{ padding: "12px", textAlign: "center" }}>
                      <div
                        style={{
                          width: "20px",
                          height: "20px",
                          borderRadius: "50%",
                          border: isSelected
                            ? "2px solid var(--primary-color)"
                            : "2px solid var(--text-color-muted)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: isSelected
                            ? "var(--primary-color)"
                            : "transparent",
                          transition: "all 0.2s ease",
                        }}
                      >
                        {isSelected && (
                          <FontAwesomeIcon
                            icon={faCheck}
                            color={isSelected ? "#fff" : "transparent"} // Clean checkmark logic
                            size="xs"
                          />
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Detail Expansion Row */}
                  {isExpanded && (
                    <tr
                      style={{
                        backgroundColor: "var(--background-secondary)",
                        borderBottom: "1px solid var(--border-color)",
                      }}
                    >
                      <td colSpan="5" style={{ padding: "0" }}>
                        <div
                          style={{
                            padding: "15px 20px",
                            borderLeft: "4px solid var(--primary-color-dim)",
                          }}
                        >
                          {(() => {
                            const func = inst.functions.find(
                              (f) => f.id === expandedDetail.funcId
                            );
                            if (!func) return null;
                            return (
                              <div>
                                <h5
                                  style={{
                                    margin: "0 0 10px 0",
                                    color: "var(--text-color)",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                  }}
                                >
                                  <FontAwesomeIcon
                                    icon={faInfoCircle}
                                    color="var(--primary-color)"
                                  />
                                  Specifications: {func.name} (Base Unit:{" "}
                                  {getUnitDisplayLabel(func.unit)})
                                </h5>
                                <table
                                  style={{
                                    width: "100%",
                                    fontSize: "0.85rem",
                                    backgroundColor:
                                      "var(--input-background)",
                                    color: "var(--text-color)",
                                    borderRadius: "4px",
                                    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                                    border: "1px solid var(--border-color)",
                                  }}
                                >
                                  <thead>
                                    <tr
                                      style={{
                                        textAlign: "left",
                                        borderBottom:
                                          "1px solid var(--border-color)",
                                        backgroundColor:
                                          "var(--component-header-bg)",
                                      }}
                                    >
                                      <th
                                        style={{
                                          padding: "8px",
                                          color: "var(--text-color)",
                                          fontWeight: "600",
                                        }}
                                      >
                                        Range Min
                                      </th>
                                      <th
                                        style={{
                                          padding: "8px",
                                          color: "var(--text-color)",
                                          fontWeight: "600",
                                        }}
                                      >
                                        Range Max
                                      </th>
                                      <th
                                        style={{
                                          padding: "8px",
                                          color: "var(--text-color)",
                                          fontWeight: "600",
                                        }}
                                      >
                                        Resolution
                                      </th>
                                      <th
                                        style={{
                                          padding: "8px",
                                          color: "var(--text-color)",
                                          fontWeight: "600",
                                        }}
                                      >
                                        Tolerance
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {func.ranges.map((range, idx) => (
                                      <tr
                                        key={range.id || idx}
                                        style={{
                                          borderBottom:
                                            "1px solid var(--border-color)",
                                        }}
                                      >
                                        <td style={{ padding: "8px" }}>
                                          {range.min}
                                        </td>
                                        <td style={{ padding: "8px" }}>
                                          {range.max}
                                        </td>
                                        <td style={{ padding: "8px" }}>
                                          {range.resolution}
                                        </td>
                                        <td
                                          style={{
                                            padding: "8px",
                                            fontFamily: "monospace",
                                            color:
                                              "var(--primary-color-dark)",
                                          }}
                                        >
                                          {renderToleranceString(
                                            range.tolerances
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {filteredInstruments.length === 0 && (
              <tr>
                <td
                  colSpan="5"
                  style={{
                    textAlign: "center",
                    padding: "30px",
                    color: "var(--text-color-muted)",
                  }}
                >
                  No instruments found matching "{searchTerm}"
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div
        className="modal-actions"
        style={{ marginTop: "15px", justifyContent: "flex-end", gap: "10px" }}
      >
        <div
          style={{
            marginRight: "auto",
            fontSize: "0.85rem",
            color: "var(--text-color-muted)",
          }}
        >
          {selectedInst ? (
            <span>
              Selected:{" "}
              <strong>
                {selectedInst.manufacturer} {selectedInst.model}
              </strong>
            </span>
          ) : (
            "No instrument selected"
          )}
        </div>
        <button
          className="button button-primary"
          onClick={handleConfirm}
          disabled={!selectedInst}
          style={{ opacity: !selectedInst ? 0.6 : 1, padding: "8px 20px" }}
        >
          <FontAwesomeIcon icon={faCheck} style={{ marginRight: "5px" }} />{" "}
          Import Selected
        </button>
      </div>
    </div>,
    document.body
  );
};

export default InstrumentLookupModal;
