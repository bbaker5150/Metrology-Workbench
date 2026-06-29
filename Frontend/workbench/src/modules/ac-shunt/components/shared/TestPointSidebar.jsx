import React, { useCallback, useState, useEffect, useRef } from "react";
import { gsap } from "gsap";
import { DndContext, closestCenter, MeasuringStrategy } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  FaGripVertical,
  FaEraser,
  FaCheckSquare,
  FaMinusSquare,
  FaTrashAlt,
  FaPlus,
  FaEye,
  FaExclamationCircle,
} from "react-icons/fa";
import { IoDocumentText } from "react-icons/io5";
import { FaRegSquare } from "react-icons/fa6";
import {
  AVAILABLE_FREQUENCIES,
  AVAILABLE_CURRENTS,
} from "../../constants/constants";
import { useInstruments } from "../../contexts/InstrumentContext";
import DirectionToggle from '../shared/DirectionToggle';
import { resolveSessionNCycles } from "../../utils/resolveSessionNCycles";

// Corrections live under dated Reports of Calibration; read the active
// report (latest-dated or operator-pinned) to mirror live calibration math.
const getActiveReport = (device) => {
  const reports = device?.reports || [];
  if (reports.length === 0) return null;
  return reports.find((r) => r.is_active) || reports[0];
};

// Helper functions (getShuntCorrectionForPoint, getTVCCorrectionForPoint, etc.)
const getShuntCorrectionForPoint = (point, shuntRangeInAmps, shuntSn, shuntsData) => {
  if (!point || !shuntRangeInAmps || !shuntsData || shuntsData.length === 0 || !shuntSn) {
    return { correction: "N/A", uncertainty: "N/A" };
  }
  const pointCurrent = parseFloat(point.current);
  const epsilon = 1e-9;
  const shunt = [...shuntsData]
    .filter(
      (s) =>
        String(s.serial_number) === String(shuntSn) &&
        Math.abs(parseFloat(s.range) - shuntRangeInAmps) < epsilon
    )
    .sort((a, b) => (b.is_manual ? 1 : 0) - (a.is_manual ? 1 : 0))[0];
  const activeReport = getActiveReport(shunt);
  if (activeReport && Array.isArray(activeReport.corrections)) {
    const correction = activeReport.corrections.find(
      (c) =>
        Math.abs(parseFloat(c.current) - pointCurrent) < epsilon &&
        parseFloat(c.frequency) === point.frequency
    );
    return correction
      ? { correction: correction.correction, uncertainty: correction.uncertainty }
      : { correction: "N/A", uncertainty: "N/A" };
  }
  return { correction: "N/A", uncertainty: "N/A" };
};

const getTVCCorrectionForPoint = (point, tvcSn, tvcsData) => {
  if (!point || !tvcsData || tvcsData.length === 0 || !tvcSn) return null;
  const tvc = tvcsData.find((t) => String(t.serial_number) === String(tvcSn));
  const activeReport = getActiveReport(tvc);
  if (!activeReport || !Array.isArray(activeReport.corrections) || activeReport.corrections.length === 0) {
    return null;
  }
  const targetFreq = point.frequency;
  const sorted = [...activeReport.corrections].sort((a, b) => a.frequency - b.frequency);
  const exactMatch = sorted.find((m) => m.frequency === targetFreq);
  if (exactMatch) return exactMatch.ac_dc_difference;
  if (targetFreq < 1000) {
    const next = sorted.find((m) => m.frequency > targetFreq);
    return next ? next.ac_dc_difference : null;
  }
  let lower = null;
  let upper = null;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (
      sorted[i].frequency < targetFreq &&
      sorted[i + 1].frequency > targetFreq
    ) {
      lower = sorted[i];
      upper = sorted[i + 1];
      break;
    }
  }
  if (lower && upper) {
    const { frequency: f1, ac_dc_difference: d1 } = lower;
    const { frequency: f2, ac_dc_difference: d2 } = upper;
    return d1 + ((targetFreq - f1) * (d2 - d1)) / (f2 - f1);
  }
  return null;
};

const formatFrequency = (value) =>
  (AVAILABLE_FREQUENCIES.find((f) => f.value === value) || {
    text: `${value} Hz`,
  }).text;

const formatCurrent = (value) => {
  const numValue = parseFloat(value);
  const epsilon = 1e-9;
  const found = AVAILABLE_CURRENTS.find(
    (c) => Math.abs(c.value - numValue) < epsilon
  );
  return found ? found.text : `${numValue}A`;
};

// Context Menu Component
const ContextMenu = ({
  menuState,
  onClose,
  onDelete,
  onClearReadings,
  onViewCorrections,
  isRemoteViewer // Added prop
}) => {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  if (!menuState.isOpen) return null;

  const { x, y, point, hasCorrections } = menuState;
  const hasReadingsForward = onClearReadings.hasAnyReadings(point.forward);
  const hasReadingsReverse = onClearReadings.hasAnyReadings(point.reverse);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ top: `${y}px`, left: `${x}px` }}
    >
      <button
        className="context-menu-item"
        disabled={!hasCorrections}
        onClick={() => {
          onViewCorrections(point);
          onClose();
        }}
      >
        <FaEye /> View Corrections
      </button>

      {!isRemoteViewer && (
        <>
          <div className="context-menu-separator" />
          {(hasReadingsForward || hasReadingsReverse) && (
            <>
              <button
                className="context-menu-item"
                disabled={!hasReadingsForward}
                onClick={() => {
                  onClearReadings.prompt("Forward", point);
                  onClose();
                }}
              >
                Clear Forward Cycles
              </button>
              <button
                className="context-menu-item"
                disabled={!hasReadingsReverse}
                onClick={() => {
                  onClearReadings.prompt("Reverse", point);
                  onClose();
                }}
              >
                Clear Reverse Cycles
              </button>
              <div className="context-menu-separator" />
            </>
          )}
          <button
            className="context-menu-item danger"
            onClick={() => {
              onDelete(point);
              onClose();
            }}
          >
            <FaTrashAlt /> Delete Test Point
          </button>
        </>
      )}
    </div>
  );
};

// Per-direction cycle completion state. The cycle count is a single source
// of truth shared across both directions, so callers pass the resolved
// session value as `targetOverride`; both directions are then judged against
// the same target and a complete Forward point never turns yellow just
// because the opposite direction stored a different (e.g. default) count.
// Falls back to this row's own setting, then 3 (the backend default), when no
// session value is established yet. Treat done >= target as complete so
// over-runs don't regress the indicator.
const getDirectionCycleState = (directionRow, targetOverride = null) => {
  if (!directionRow) return { state: "idle", done: 0, target: 0 };
  const done = directionRow.results?.cycles?.length ?? 0;
  const resolved =
    targetOverride != null
      ? targetOverride
      : parseInt(directionRow.settings?.n_cycles, 10) || 3;
  const target = Math.max(1, resolved);
  if (done <= 0) return { state: "idle", done, target };
  if (done >= target) return { state: "complete", done, target };
  return { state: "partial", done, target };
};

// Roll the two per-direction states up to the four overall cases the
// sidebar surfaces (idle, running, half, done). Failed is checked
// separately and overrides this in the renderer.
const getOverallCycleStatus = (fwd, rev) => {
  const completeCount =
    (fwd.state === "complete" ? 1 : 0) + (rev.state === "complete" ? 1 : 0);
  if (completeCount === 2) return "done";
  if (completeCount === 1) return "half";
  if (fwd.state === "partial" || rev.state === "partial") return "running";
  return "idle";
};

// Sortable Test Point Item Component
const SortableTestPointItem = ({
  point,
  isFocused,
  isSelected,
  fwdCycleState,
  revCycleState,
  overallStatus,
  isCurrentlyExecuting,
  isFailed,
  areControlsDisabled,
  onFocus,
  onToggle,
  onContextMenu,
  isContextMenuTarget,
  isRemoteViewer // Added prop
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: point.key });
  const itemRef = useRef(null);
  const auraRef = useRef(null);
  const auraTweenRef = useRef(null);

  const setCombinedRef = useCallback(
    (node) => {
      setNodeRef(node);
      itemRef.current = node;
    },
    [setNodeRef]
  );

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    auraTweenRef.current?.kill();
    if (!auraRef.current || !itemRef.current) return;

    if (!isFocused) {
      gsap.to(auraRef.current, {
        autoAlpha: 0,
        scale: 0.98,
        duration: reduceMotion ? 0 : 0.2,
        ease: "power2.out",
      });
      return;
    }

    if (!reduceMotion) {
      gsap.fromTo(
        itemRef.current,
        { y: 2, scale: 0.994 },
        { y: 0, scale: 1, duration: 0.24, ease: "power2.out", overwrite: "auto" }
      );
      gsap.set(auraRef.current, { autoAlpha: 0.5, scale: 1 });
      auraTweenRef.current = gsap.to(auraRef.current, {
        autoAlpha: 0.18,
        scale: 1.055,
        duration: 1.45,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
      });
    } else {
      gsap.set(auraRef.current, { autoAlpha: 0.16, scale: 1 });
    }

    return () => auraTweenRef.current?.kill();
  }, [isFocused]);

  // Failed overrides everything; otherwise the four cycle-based cases
  // (idle / running / half / done) drive both the rail and a subtle
  // card tint. `completed` is kept on case 4 so legacy CSS that fades
  // finished rows still applies.
  const statusModifier = isFailed ? "is-tp-failed" : `is-tp-${overallStatus}`;
  const isDone = overallStatus === "done";

  // AC-DC mean (pair-level δ) — surfaced once both directions are complete.
  // The backend mirrors `pair_delta_uut_ppm` onto both direction rows, so
  // either side carries the canonical value.
  const pairMeanRaw =
    point.forward?.results?.pair_delta_uut_ppm ??
    point.reverse?.results?.pair_delta_uut_ppm ??
    null;
  const pairMeanNum =
    pairMeanRaw != null && !isNaN(parseFloat(pairMeanRaw))
      ? parseFloat(pairMeanRaw)
      : null;
  const showPairMean = isDone && !isFailed && pairMeanNum != null;
  const pairMeanFormatted =
    pairMeanNum != null
      ? `${pairMeanNum >= 0 ? "+" : "−"}${Math.abs(pairMeanNum).toFixed(2)}`
      : null;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const classes = [
    "test-point-item-selectable",
    statusModifier,
    isFocused ? "active" : "",
    isDone ? "completed" : "",
    isCurrentlyExecuting ? "is-tp-running-live" : "",
    isDragging ? "dragging" : "",
    isContextMenuTarget ? "context-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const railTitle = isFailed
    ? "Stability failure — review readings"
    : `Forward: ${fwdCycleState.done}/${fwdCycleState.target} cycles · Reverse: ${revCycleState.done}/${revCycleState.target} cycles`;

  return (
    <div
      ref={setCombinedRef}
      style={style}
      className={classes}
      onClick={() => onFocus(point)}
      onContextMenu={(e) => onContextMenu(e, point)}
      {...attributes}
    >
      <span className="tp-active-aura" ref={auraRef} aria-hidden />
      <span
        className="tp-status-rail"
        title={railTitle}
        aria-label={railTitle}
        role="img"
      >
        <span
          className={`tp-status-rail-seg tp-status-rail-seg--fwd is-${fwdCycleState.state}`}
          aria-hidden
        />
        <span
          className={`tp-status-rail-seg tp-status-rail-seg--rev is-${revCycleState.state}`}
          aria-hidden
        />
      </span>

      {!isRemoteViewer && (
        <div
          className="drag-handle"
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
          aria-label="Drag to reorder"
        >
          <FaGripVertical aria-hidden />
        </div>
      )}

      {!isRemoteViewer && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => {
            e.stopPropagation();
            onToggle(point.key);
          }}
          onClick={(e) => e.stopPropagation()}
          disabled={areControlsDisabled}
          className="tp-checkbox"
          aria-label={`Select ${formatCurrent(point.current)} at ${formatFrequency(
            point.frequency
          )}`}
        />
      )}
      <div className="tp-label">
        <span className="test-point-name">
          <span className="tp-current">{formatCurrent(point.current)}</span>
          <span className="tp-sep" aria-hidden>
            ·
          </span>
          <span className="tp-frequency">
            {formatFrequency(point.frequency)}
          </span>
        </span>
        {isFailed && (
          <FaExclamationCircle
            className="tp-failed-icon"
            title="Failed stability check"
            aria-label="Failed stability check"
          />
        )}
        {isCurrentlyExecuting && (
          <span className="status-indicator" aria-label="Running" />
        )}
      </div>
      {showPairMean && (
        <span
          className="tp-acdc-mean"
          title={`AC-DC mean δ (forward + reverse): ${pairMeanFormatted} ppm`}
          aria-label={`AC-DC mean ${pairMeanFormatted} ppm`}
        >
          <span className="tp-acdc-mean-value">{pairMeanFormatted}</span>
          <span className="tp-acdc-mean-unit">ppm</span>
        </span>
      )}
    </div>
  );
};

// Test Point Sidebar Component
function TestPointSidebar({
  orderedTestPoints,
  uniqueTestPoints,
  tooltipData,
  focusedTP,
  selectedTPs,
  isBulkRunning,
  isCollecting,
  activeCollectionDetails,
  bulkRunProgress,
  activeDirection,
  setActiveDirection,
  onFocus,
  onToggleSelect,
  onToggleSelectAll,
  onDragEnd,
  onClearReadings,
  onDeleteTestPoint,
  onDeleteSelected,
  onAddTestPoints,
  onViewCorrections,
  onViewPointCorrections,
  isRemoteViewer // Added prop
}) {
  const {
    selectedSessionId,
    standardTvcSn,
    testTvcSn,
    failedTPKeys,
    standardInstrumentSerial
  } = useInstruments();

  // Single source of truth for the cycle count, shared across both
  // directions, so completion status judges Forward and Reverse against the
  // same target (see getDirectionCycleState).
  const sessionNCycles = resolveSessionNCycles(orderedTestPoints, null);

  const [contextMenu, setContextMenu] = useState({
    isOpen: false,
    x: 0,
    y: 0,
    point: null,
    hasCorrections: false,
  });

  const handleContextMenu = (event, point) => {
    event.preventDefault();
    if (isBulkRunning || isCollecting) return;

    const shuntCorr = getShuntCorrectionForPoint(
      point,
      tooltipData.shuntRangeInAmps,
      standardInstrumentSerial,
      tooltipData.shuntsData
    );
    const stdTvcCorr = getTVCCorrectionForPoint(
      point,
      standardTvcSn,
      tooltipData.tvcsData
    );
    const tiTvcCorr = getTVCCorrectionForPoint(
      point,
      testTvcSn,
      tooltipData.tvcsData
    );
    const hasCorrections =
      shuntCorr.correction !== "N/A" ||
      stdTvcCorr !== null ||
      tiTvcCorr !== null;

    setContextMenu({
      isOpen: true,
      x: event.clientX,
      y: event.clientY,
      point: point,
      hasCorrections: hasCorrections,
    });
  };

  const closeContextMenu = useCallback(() => {
    setContextMenu({ isOpen: false, x: 0, y: 0, point: null, hasCorrections: false });
  }, []);

  const hasAnyReadings = useCallback(
    (point) =>
      point?.readings &&
      Object.values(point.readings).some(
        (arr) => Array.isArray(arr) && arr.length > 0
      ),
    []
  );

  const getSelectAllState = () => {
    const selectedSize = selectedTPs.size;
    const totalSize = uniqueTestPoints.length;
    if (selectedSize === 0) return "none";
    if (selectedSize === totalSize) return "all";
    return "some";
  };

  const selectAllState = getSelectAllState();

  const SelectAllIcon = () => {
    if (selectAllState === "all") return <FaCheckSquare />;
    if (selectAllState === "some") return <FaMinusSquare />;
    return <FaRegSquare />;
  };

  const selectAllTooltip = {
    all: "Deselect All",
    some: "Select All",
    none: "Select All",
  }[selectAllState];

  const totalPoints = uniqueTestPoints.length;
  const selectedCount = selectedTPs.size;

  return (
    <div className="test-point-sidebar-content tp-sidebar">
      <header className="tp-sidebar-header">
        <div className="tp-sidebar-header-text">
          <span className="tp-sidebar-eyebrow">Test points</span>
          <h4 className="tp-sidebar-title">
            {activeDirection === "Forward" ? "Forward" : "Reverse"}
            <span className="tp-sidebar-count" aria-hidden>
              {totalPoints}
            </span>
          </h4>
        </div>
        <DirectionToggle
          activeDirection={activeDirection}
          setActiveDirection={setActiveDirection}
        />
      </header>

      <div className="tp-sidebar-toolbar">
        {!isRemoteViewer && (
          <div className="tp-sidebar-toolbar-group">
            <button
              type="button"
              onClick={onToggleSelectAll}
              className="cal-results-excel-icon-btn"
              disabled={
                isBulkRunning || isCollecting || uniqueTestPoints.length === 0
              }
              aria-label={selectAllTooltip}
              title={selectAllTooltip}
            >
              <SelectAllIcon aria-hidden />
            </button>
            <button
              type="button"
              onClick={onDeleteSelected}
              className="cal-results-excel-icon-btn cal-results-excel-icon-btn--danger"
              disabled={isBulkRunning || isCollecting || selectedTPs.size === 0}
              aria-label="Delete selected test points"
              title="Delete selected"
            >
              <FaTrashAlt aria-hidden />
            </button>
            <button
              type="button"
              onClick={onAddTestPoints}
              className="cal-results-excel-icon-btn"
              disabled={isBulkRunning || isCollecting || !selectedSessionId}
              aria-label="Add new test points"
              title="Add new test points"
            >
              <FaPlus aria-hidden />
            </button>
          </div>
        )}
        <div className="tp-sidebar-toolbar-meta">
          {!isRemoteViewer && selectedCount > 0 && (
            <span className="tp-sidebar-selection-count">
              {selectedCount} selected
            </span>
          )}
          {/*
            The corrections modal is useful analysis context for observers
            too (shunt + TVC correction tables, uncertainty sweeps), so we
            keep the entry point available to remotes. The modal itself
            gates all mutating affordances — add / edit / delete entries
            and the "click a row to generate test points" flow — so remotes
            get a read-only view.
          */}
          <button
            type="button"
            onClick={onViewCorrections}
            className="cal-results-excel-icon-btn"
            disabled={isBulkRunning || isCollecting || !selectedSessionId}
            aria-label="View corrections data"
            title="View corrections data"
          >
            <IoDocumentText aria-hidden />
          </button>
        </div>
      </div>

      {orderedTestPoints.length === 0 && (
        <div className="tp-sidebar-empty" role="status">
          <p className="tp-sidebar-empty-title">No test points yet</p>
          <p className="tp-sidebar-empty-text">
            {isRemoteViewer
              ? "Test points will appear here once the host adds them."
              : "Use the + button above to add a point to this session."}
          </p>
        </div>
      )}

      <DndContext
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        autoScroll={{
          threshold: { x: 0, y: 0.15 },
          layoutShiftCompensation: false,
        }}
        measuring={{
          droppable: { strategy: MeasuringStrategy.WhileDragging },
        }}
      >
        <SortableContext
          items={orderedTestPoints.map((p) => p.key)}
          strategy={verticalListSortingStrategy}
        >
          <div className="test-point-list">
            {orderedTestPoints.map((point) => {
              const fwdCycleState = getDirectionCycleState(
                point.forward,
                sessionNCycles
              );
              const revCycleState = getDirectionCycleState(
                point.reverse,
                sessionNCycles
              );
              const overallStatus = getOverallCycleStatus(
                fwdCycleState,
                revCycleState
              );

              // ``tpId`` arrives from two type-mismatched sources: the host
              // sets it locally (string, matching the API-loaded point ids),
              // while a remote receives it over the wire as a JSON number
              // (Python ``int``). String-coerce both sides so the strict
              // compare matches on observers too — same pattern as
              // ``activeRunningTP`` in App.jsx.
              const activeRowId =
                activeDirection === "Forward"
                  ? point.forward?.id
                  : point.reverse?.id;
              const isPointCurrentlyExecuting =
                (isCollecting &&
                  activeCollectionDetails?.tpId != null &&
                  activeRowId != null &&
                  String(activeCollectionDetails.tpId) === String(activeRowId)) ||
                (isBulkRunning && bulkRunProgress.pointKey === point.key);

              const isFailed =
                failedTPKeys.has(point.key) ||
                point.forward?.is_stability_failed === true ||
                point.reverse?.is_stability_failed === true;

              return (
                <SortableTestPointItem
                  key={point.key}
                  point={point}
                  isFocused={focusedTP?.key === point.key}
                  isSelected={selectedTPs.has(point.key)}
                  fwdCycleState={fwdCycleState}
                  revCycleState={revCycleState}
                  overallStatus={overallStatus}
                  isCurrentlyExecuting={isPointCurrentlyExecuting}
                  isFailed={isFailed}
                  areControlsDisabled={isBulkRunning || isCollecting}
                  onFocus={onFocus}
                  onToggle={onToggleSelect}
                  onContextMenu={handleContextMenu}
                  isContextMenuTarget={
                    contextMenu.isOpen && contextMenu.point?.key === point.key
                  }
                  isRemoteViewer={isRemoteViewer}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      <ContextMenu
        menuState={contextMenu}
        onClose={closeContextMenu}
        onDelete={onDeleteTestPoint}
        onClearReadings={{ ...onClearReadings, hasAnyReadings }}
        onViewCorrections={onViewPointCorrections}
        isRemoteViewer={isRemoteViewer}
      />
    </div>
  );
}

export default TestPointSidebar;