/**
 * src/features/analysis/Analysis.jsx
 *
 * Top-level container for the Analysis workflow.
 *
 * Responsibilities:
 * 1. Manages top-level state for Tabs, Modals, and View Modes (Summary vs Detailed).
 * 2. Coordinates data flow between sub-components and global state (App.jsx).
 * 3. Integrates Calculation Hooks (Uncertainty & Risk) to drive the dashboards.
 * 4. Handles instrument (UUT/TMDE) selection and editing logic.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";

// --- Custom Hooks ---
import { useUncertaintyCalculation } from "./hooks/useUncertaintyCalculation";
import { useRiskCalculation } from "./hooks/useRiskCalculation";

// --- Components ---
import UncertaintyPanel from "./components/UncertaintyPanel";
import RiskAnalysisDashboard from "./components/RiskAnalysisDashboard";
import RiskMitigationDashboard from "./components/RiskMitigationDashboard";

// --- Modals ---
import NotificationModal from "../../components/modals/NotificationModal";
// REMOVED: UniversalInstrumentModal import (Now handled globally in App.jsx)
import ManualComponentModal from "./components/ManualComponentModal";
import DerivedBreakdownModal from "./components/BreakdownModals/DerivedBreakdownModal";
import RiskBreakdownModal from "./components/BreakdownModals/RiskBreakdownModals";
import RepeatabilityModal from "./components/RepeatabilityModal";
import CorrelationMatrixModal from "./components/CorrelationMatrixModal";
import AddTestPointModal from "../testPoints/components/AddTestPointModal";

// --- Utilities ---
import { convertToPPM } from "../../utils/uncertaintyMath";
import { reconcileTmdeInstances } from "../../utils/tmdeReconcile";

/**
 * Analysis Component
 *
 * @param {Object} props - Component properties
 * @param {Object} props.sessionData - Full session state (UUTs, TMDEs, Standards).
 * @param {Object} props.testPointData - Currently active test point data.
 * @param {Function} props.onDataSave - Callback to update the active test point.
 * @param {Function} props.onSessionSave - Callback to update the global session data.
 * @param {Function} props.onSaveTestPoint - Callback to save test point to the list.
 */
function Analysis({
  sessionData,
  testPointData,
  defaultTestPoint,

  // Data Persistance Handlers
  onDataSave,
  onSessionSave,
  onSaveTestPoint,
  onApplyToSessionPoints,

  // Navigation & Actions
  handleOpenSessionEditor,
  onSelectUut,
  onSelectTestPoint,
  onDeleteTmdeDefinition,
  onDecrementTmdeQuantity,
  onDeleteUut,
  onDeleteTestPoint,
  setContextMenu,
  setBreakdownPoint,

  // Global Data Props (Lifted from App.js)
  instruments,
  onSaveInstrument,
  customEquations = [],
  onSaveCustomEquation,
  onDeleteCustomEquation,
  setRiskResults: parentSetRiskResults,

  // Sidebar-driven risk breakdown request (a metric key the user clicked in the
  // measurement-point list). Opened here once this point's riskResults exist.
  pendingRiskBreakdown,
  onConsumePendingRiskBreakdown,

  // Selections
  currentUutSelection = [],
  setCurrentUutSelection,
  selectedTablePointIds = [],
  setSelectedTablePointIds = () => {},
  activeRangeIndices,
  onRangeSelectionChange,
  preferredAnalysisMode = "uncertaintyTool",
  onAnalysisModeChange = () => {},
  preferredShowContribution = false,
  onShowContributionChange = () => {},

  // --- NEW: Handlers passed from App.jsx to control Global Modal ---
  onEditUut,
  onAddTmde,
  onEditTmde,
}) {
  // =========================================================================
  // 1. STATE MANAGEMENT
  // =========================================================================

  // --- UI State ---
  const analysisMode = preferredAnalysisMode;
  const showContribution = preferredShowContribution;
  const setShowContribution = useCallback(
    (nextValue) => {
      onShowContributionChange(
        typeof nextValue === "function"
          ? nextValue(preferredShowContribution)
          : nextValue,
      );
    },
    [onShowContributionChange, preferredShowContribution],
  );
  const [notification, setNotification] = useState(null);

  // --- Modal Visibility State ---
  // REMOVED: activeInstrumentModal state (Handled in App.jsx)
  const [isTestPointModalOpen, setTestPointModalOpen] = useState(false);
  const [modalOverrides, setModalOverrides] = useState(null);
  const [isManualModalOpen, setManualModalOpen] = useState(false);
  const [isRepeatabilityModalOpen, setRepeatabilityModalOpen] = useState(false);
  const [isCorrelationModalOpen, setCorrelationModalOpen] = useState(false);
  const [isDerivedBreakdownOpen, setIsDerivedBreakdownOpen] = useState(false);
  const [activeRiskModals, setActiveRiskModals] = useState([]); // Array of active risk breakdown types

  // --- Modal Data State ---
  const [editingComponent, setEditingComponent] = useState(null);
  const [manualComponentScope, setManualComponentScope] = useState(null);
  const [modalPosition, setModalPosition] = useState(null);
  const [derivedBreakdownData, setDerivedBreakdownData] = useState(null);

  // --- Selection State ---
  const [selectedTmdeIds, setSelectedTmdeIds] = useState([]);

  // =========================================================================
  // 2. MEMOIZED DATA & LOOKUPS
  // =========================================================================

  const viewMode = testPointData.viewMode || "point";
  const isPointView = viewMode === "point";

  // Extract safe values for calculation hooks based on current view mode
  const uutNominal = useMemo(
    () => (isPointView ? testPointData?.testPointInfo?.parameter : {}),
    [isPointView, testPointData],
  );

  const uutToleranceData = useMemo(
    () =>
      isPointView
        ? testPointData.uutTolerance || sessionData.uutTolerance || {}
        : {},
    [isPointView, testPointData.uutTolerance, sessionData.uutTolerance],
  );

  // Referential-integrity guard: only count per-point TMDE instances that still
  // map to a live session master, with no duplicate of the same master. This is
  // the single read-boundary feeding both the table and every calculation, so
  // orphaned/stacked instances can never silently multiply a derived variable.
  const tmdeTolerancesData = useMemo(
    () =>
      isPointView
        ? reconcileTmdeInstances(
            testPointData.tmdeTolerances || [],
            sessionData.tmdes || [],
          )
        : [],
    [isPointView, testPointData.tmdeTolerances, sessionData.tmdes],
  );

  const manualComponents = useMemo(() => {
    return isPointView ? testPointData.components || [] : [];
  }, [isPointView, testPointData.components]);

  // =========================================================================
  // 3. EFFECTS & SYNC
  // =========================================================================

  // Synchronize selection state when the active test point changes
  // We use the "state adjustment during render" pattern to avoid useEffect cascades
  const [prevTestPointId, setPrevTestPointId] = useState(testPointData.id);
  if (testPointData.id !== prevTestPointId) {
    setPrevTestPointId(testPointData.id);
    setSelectedTmdeIds([]);
  }

  // Self-heal: if the loaded point still carries orphaned/stacked TMDE instances
  // in storage (e.g. data created before integrity was enforced), persist the
  // reconciled set once so it is truly removed — not just ignored at read time.
  // Guarded by length + a per-point ref so it fires at most once per point and
  // never loops (the save updates the prop, after which lengths match).
  const healedPointRef = useRef(null);
  useEffect(() => {
    if (!isPointView) return;
    const stored = testPointData.tmdeTolerances || [];
    if (stored.length === tmdeTolerancesData.length) return; // already clean
    if (healedPointRef.current === testPointData.id) return;
    healedPointRef.current = testPointData.id;
    onDataSave({ tmdeTolerances: tmdeTolerancesData });
  }, [
    isPointView,
    testPointData.id,
    testPointData.tmdeTolerances,
    tmdeTolerancesData,
    onDataSave,
  ]);

  // =========================================================================
  // 4. CALCULATION HOOKS
  // =========================================================================

  // Hook 1: Uncertainty Calculation
  const hookTestPointData = isPointView
    ? testPointData
    : { ...defaultTestPoint, id: "dummy-summary" };

  const { calcResults, calculationError } = useUncertaintyCalculation(
    hookTestPointData,
    sessionData,
    tmdeTolerancesData,
    uutToleranceData,
    uutNominal,
    manualComponents,
    onDataSave,
  );

  // Hook 2: Risk Calculation
  const handleRiskResultsChange = useCallback(
    (nextRiskResults) => {
      parentSetRiskResults?.(nextRiskResults);
    },
    [parentSetRiskResults],
  );

  const {
    riskResults,
    riskInputs,
    notification: riskNotification,
  } = useRiskCalculation(
    sessionData,
    hookTestPointData,
    uutToleranceData,
    tmdeTolerancesData,
    uutNominal,
    calcResults,
    analysisMode,
    handleRiskResultsChange,
  );

  // Sync risk notifications to local UI state
  if (riskNotification && !notification) {
    setNotification(riskNotification);
  }

  // =========================================================================
  // 5. EVENT HANDLERS
  // =========================================================================

  // --- Selection Handlers ---
  const handleToggleTmdeSelection = (id) => {
    setSelectedTmdeIds((prev) =>
      prev.includes(id) ? prev.filter((tid) => tid !== id) : [...prev, id],
    );
  };

  const handleToggleAllTmdes = () => {
    const allSelected = selectedTmdeIds.length === tmdeTolerancesData.length;
    setSelectedTmdeIds(allSelected ? [] : tmdeTolerancesData.map((t) => t.id));
  };

  const handleToggleUut = (uutId) => {
    if (!uutId && uutId !== 0) return;
    const isSelected = currentUutSelection.some(
      (id) => String(id) === String(uutId),
    );
    const newIds = isSelected
      ? currentUutSelection.filter((id) => String(id) !== String(uutId))
      : [...currentUutSelection, uutId];

    if (setCurrentUutSelection) setCurrentUutSelection(newIds);
  };

  /**
   * Handles saving a TMDE (Test Measurement & Diagnostic Equipment) configuration.
   * Updates global session data and local test point tolerances.
   * NOTE: This is primarily used for INLINE updates (name, value, unit).
   * Full creation/editing is now handled by the Global Modal in App.jsx.
   */
  const handleSaveTmde = (tmdeToSave) => {
    // 1. Update Session Library
    if (onSessionSave) {
      const currentTmdes = sessionData.tmdes || [];
      const existingSessionIndex = currentTmdes.findIndex(
        (t) => t.id === tmdeToSave.id,
      );

      const updatedSessionTmdes =
        existingSessionIndex > -1
          ? currentTmdes.map((t, i) =>
              i === existingSessionIndex ? { ...t, ...tmdeToSave } : t,
            )
          : [...currentTmdes, tmdeToSave];

      onSessionSave({ ...sessionData, tmdes: updatedSessionTmdes });
    }

    // 2. Update Local Test Point Instances
    const updatedTolerances = tmdeTolerancesData.map((t) => {
      if (t.id === tmdeToSave.id || t.sourceId === tmdeToSave.id) {
        const newInstDef = tmdeToSave.instrument || tmdeToSave;
        let funcName = t.functionName || "";

        // Resolve Function & Range
        let func = null;
        if (newInstDef.functions?.length > 0) {
          if (funcName)
            func = newInstDef.functions.find((f) => f.name === funcName);
          if (!func) func = newInstDef.functions[0];
          funcName = func ? func.name : "";
        }

        const newRanges = func ? func.ranges || [] : newInstDef.ranges || [];
        const activeIndex =
          t._index !== undefined && newRanges[t._index] ? t._index : 0;
        const newActiveRange = newRanges[activeIndex] || {};

        const flattenedSpecs = {
          ...newActiveRange,
          ...(newActiveRange.tolerances || newActiveRange.tolerance || {}),
        };

        /* eslint-disable no-unused-vars */
        const {
          reading,
          floor,
          range,
          tolerance,
          tolerances,
          min,
          max,
          unit,
          resolution,
          ...safeInstanceMeta
        } = t;
        /* eslint-enable no-unused-vars */

        return {
          ...safeInstanceMeta,
          ...tmdeToSave,
          ...flattenedSpecs,
          id: t.id,
          sourceId: tmdeToSave.id,
          functionName: funcName,
          _index: activeIndex,
          measurementPoint: tmdeToSave.measurementPoint || t.measurementPoint,
        };
      }
      return t;
    });

    onDataSave({ tmdeTolerances: updatedTolerances });
  };

  /**
   * Handles inline updates for TMDE rows (Name, Value, Unit).
   */
  const handleInlineTmdeUpdate = (id, field, value) => {
    const tmdeToUpdate = tmdeTolerancesData.find((t) => t.id === id);
    if (!tmdeToUpdate) return;

    const newTmde = { ...tmdeToUpdate };
    const currentMP = newTmde.measurementPoint || { value: "", unit: "" };

    if (field === "name") newTmde.name = value;
    else if (field === "nominal")
      newTmde.measurementPoint = { ...currentMP, value: value }; // Preserves string for typing
    else if (field === "variableType") newTmde.variableType = value;
    else if (field === "unit")
      newTmde.measurementPoint = { ...currentMP, unit: value };

    handleSaveTmde(newTmde);
  };

  // --- Test Point & Manual Component Handlers ---

  const handleSaveTestPointInfo = (updatedData) => {
    if (onSaveTestPoint) {
      let finalData = { ...updatedData };
      // Handle "Copy Selected TMDEs" logic for new test points
      if (!finalData.id) {
        if (selectedTmdeIds.length > 0) {
          const selectedTmdes = tmdeTolerancesData.filter((t) =>
            selectedTmdeIds.includes(t.id),
          );
          finalData.tmdeTolerances = selectedTmdes.map((t) => ({
            ...t,
            id: Date.now() + Math.random(),
            name: t.name || t.description || "Unnamed Device",
            measurementPoint: { ...t.measurementPoint, value: "" },
          }));
          finalData.copyTmdes = false;
        } else {
          finalData.copyTmdes = false;
          finalData.tmdeTolerances = [];
        }
      }
      onSaveTestPoint(finalData);
    } else {
      onDataSave(updatedData);
    }
    setTestPointModalOpen(false);
    if (setCurrentUutSelection) setCurrentUutSelection([]);
  };

  const handleSaveManualComponent = (componentData) => {
    const scopedComponentData =
      manualComponentScope && !editingComponent
        ? {
            ...componentData,
            variableType: manualComponentScope.variableType,
            sourcePointLabel:
              componentData.sourcePointLabel ||
              `${manualComponentScope.label || manualComponentScope.variableType} Manual`,
          }
        : componentData;
    let updatedComponents;
    if (editingComponent) {
      updatedComponents = manualComponents.map((c) =>
        c.id === editingComponent.id ? scopedComponentData : c,
      );
    } else {
      updatedComponents = [
        ...manualComponents,
        { ...scopedComponentData, id: Date.now() },
      ];
    }
    onDataSave({ components: updatedComponents });
    setManualModalOpen(false);
    setEditingComponent(null);
    setManualComponentScope(null);
  };

  const handleEditComponent = (event, component) => {
    setEditingComponent(component);
    setManualComponentScope(null);
    if (
      component.id.toString().includes("repeatability") ||
      component.name === "Repeatability"
    ) {
      const pos =
        event && event.clientY
          ? { top: event.clientY, left: event.clientX }
          : null;
      setModalPosition(pos);
      setRepeatabilityModalOpen(true);
    } else {
      setManualModalOpen(true);
    }
  };

  const handleRemoveComponent = (id) => {
    const updatedComponents = manualComponents.filter((c) => c.id !== id);
    if (updatedComponents.length < manualComponents.length) {
      onDataSave({ components: updatedComponents });
    } else {
      setNotification({
        title: "Action Not Allowed",
        message: "Core budget components cannot be removed here.",
      });
    }
  };

  const handleSaveRepeatability = (data) => {
    // When opened from a derived subbudget header, manualComponentScope carries
    // the variable this Type A component belongs to. Convert relative to that
    // variable's nominal (falling back to the UUT nominal for direct points).
    const scope = manualComponentScope;
    const nominalForConv = scope?.nominalPoint || uutNominal;
    const { value: ppm, warning } = convertToPPM(
      data.stdDev,
      data.unit,
      nominalForConv?.value,
      nominalForConv?.unit,
      null,
      true,
    );
    if (warning) {
      setNotification({ title: "Conversion Error", message: warning });
      return;
    }

    const isEditing =
      editingComponent &&
      editingComponent.id.toString().includes("repeatability");
    const newId = isEditing
      ? editingComponent.id
      : `repeatability_${Date.now()}`;
    // Route into the right subbudget: explicit scope on add, else preserve the
    // existing component's variable on edit.
    const variableType = scope?.variableType ?? editingComponent?.variableType;
    const componentData = {
      id: newId,
      name: "Repeatability",
      sourcePointLabel: scope?.label
        ? `${scope.label} • N=${data.count}`
        : `N=${data.count}, Mean=${data.mean.toPrecision(5)}`,
      type: "A",
      value: ppm,
      value_native: data.stdDev,
      unit_native: data.unit,
      dof: data.dof,
      distribution: "Normal",
      isCore: false,
      savedInputs: data,
      ...(variableType ? { variableType } : {}),
    };

    const updatedComponents = isEditing
      ? manualComponents.map((c) => (c.id === newId ? componentData : c))
      : [...manualComponents, componentData];

    onDataSave({ components: updatedComponents });
    setEditingComponent(null);
    setManualComponentScope(null);
    setRepeatabilityModalOpen(false);
  };

  const handleSaveCorrelations = (nextCorrelations) => {
    onDataSave({ inputCorrelations: nextCorrelations || {} });
    setCorrelationModalOpen(false);
  };

  // Components offered in the correlation editor: the derived input rows + any
  // non-mapped manual rows, identified by the same `componentId` used in the
  // combine. signedContribution is for the informational sign note only.
  const correlationComponents = (calcResults?.calculatedBudgetComponents || [])
    .filter((c) => c.componentId)
    .map((c) => ({
      id: c.componentId,
      label: c.name?.startsWith("Input: ") ? c.name.slice(7) : c.name,
      signedContribution:
        (c.contribution || 0) * (Number(c.sensitivityCoefficient) < 0 ? -1 : 1),
    }));

  // --- Breakdown & Analysis Handlers ---

  const handleBudgetRowContextMenu = (event) => {
    event.preventDefault();
    if (testPointData.measurementType !== "derived" || !calcResults) return;

    setDerivedBreakdownData({
      equationString: testPointData.equationString,
      components: calcResults.calculatedBudgetComponents || [],
      results: calcResults,
      derivedNominalPoint: uutNominal,
      tmdeTolerances: tmdeTolerancesData,
    });
    setIsDerivedBreakdownOpen(true);
  };

  const handleShowRiskBreakdown = (type) => {
    setActiveRiskModals((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  const handleCloseRiskBreakdown = (type) => {
    setActiveRiskModals((prev) => prev.filter((t) => t !== type));
  };

  // Open the requested breakdown when a sidebar metric was clicked, but only
  // once this (now-active) point's riskResults are computed. Then clear the
  // request so it fires once. Uses a direct add (not the toggle) so re-clicking
  // the same metric never closes an already-open modal.
  useEffect(() => {
    if (!pendingRiskBreakdown || !riskResults) return;
    setActiveRiskModals((prev) =>
      prev.includes(pendingRiskBreakdown)
        ? prev
        : [...prev, pendingRiskBreakdown],
    );
    onConsumePendingRiskBreakdown?.();
  }, [pendingRiskBreakdown, riskResults, onConsumePendingRiskBreakdown]);

  const handleInlineUutUpdate = (field, value) => {
    if (field === "description") {
      if (onSessionSave)
        onSessionSave({ ...sessionData, uutDescription: value });
    } else if (field === "nominal") {
      // Allow float parsing updates for nominal value
      const newParam = {
        ...testPointData.testPointInfo?.parameter,
        value: parseFloat(value),
      };
      onDataSave({
        testPointInfo: { ...testPointData.testPointInfo, parameter: newParam },
      });
    }
  };

  /**
   * Prepares the Test Point Definition modal with overrides (e.g., from quick selection).
   */
  const handleDefineTestPoint = (selectedUutIds, resolvedTolerance) => {
    const overrides = {};
    if (selectedUutIds?.length > 0) {
      overrides.associatedUutIds = selectedUutIds;
      // Try to find default Area from UUT
      const firstUut = sessionData.uuts?.find(
        (u) => u.id === selectedUutIds[0],
      );
      if (firstUut) {
        overrides.measurementAreaId =
          firstUut.measurementAreaId ||
          sessionData.measurementAreas?.find(
            (a) => a.name === firstUut.measurementArea,
          )?.id;
      }
    }
    if (resolvedTolerance) overrides.uutTolerance = resolvedTolerance;

    setModalOverrides(overrides);
    setTestPointModalOpen(true);
  };

  // =========================================================================
  // 6. RENDER
  // =========================================================================

  return (
    <div
      className="analysis-container"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      {/* 1. Global Modals */}
      <NotificationModal
        isOpen={!!notification}
        onClose={() => setNotification(null)}
        {...notification}
      />

      {/* REMOVED: UniversalInstrumentModal - Now handled globally in App.jsx */}

      <AddTestPointModal
        isOpen={isTestPointModalOpen}
        onClose={() => {
          setTestPointModalOpen(false);
          setModalOverrides(null);
        }}
        onSave={handleSaveTestPointInfo}
        initialData={modalOverrides}
        previousTestPointData={testPointData}
      />

      <ManualComponentModal
        isOpen={isManualModalOpen}
        onClose={() => {
          setManualModalOpen(false);
          setEditingComponent(null);
          setManualComponentScope(null);
        }}
        onSave={handleSaveManualComponent}
        existingComponent={editingComponent}
        uutNominal={manualComponentScope?.nominalPoint || uutNominal}
        budgetScope={manualComponentScope}
      />

      <RepeatabilityModal
        isOpen={isRepeatabilityModalOpen}
        onClose={() => {
          setRepeatabilityModalOpen(false);
          setEditingComponent(null);
          setManualComponentScope(null);
        }}
        onSave={handleSaveRepeatability}
        uutNominal={manualComponentScope?.nominalPoint || uutNominal}
        existingData={editingComponent}
        position={modalPosition}
      />

      <DerivedBreakdownModal
        isOpen={isDerivedBreakdownOpen}
        onClose={() => setIsDerivedBreakdownOpen(false)}
        breakdownData={derivedBreakdownData}
      />

      <CorrelationMatrixModal
        isOpen={isCorrelationModalOpen}
        onClose={() => setCorrelationModalOpen(false)}
        components={correlationComponents}
        correlations={testPointData.inputCorrelations || {}}
        onSave={handleSaveCorrelations}
      />

      {activeRiskModals.map((type) => (
        <RiskBreakdownModal
          key={type}
          isOpen={true}
          onClose={() => handleCloseRiskBreakdown(type)}
          modalType={type}
          data={{
            results: riskResults,
            inputs: riskResults
              ? {
                  LLow: parseFloat(riskInputs.LLow),
                  LUp: parseFloat(riskInputs.LUp),
                  reliability: parseFloat(sessionData.uncReq.reliability),
                  guardBandMultiplier: parseFloat(
                    sessionData.uncReq.guardBandMultiplier,
                  ),
                  guardBandInputs: riskResults.gbInputs,
                }
              : null,
          }}
        />
      ))}

      {/* 2. Main View Logic: Summary vs Detailed */}
      {!isPointView ? (
        <div
          className="analysis-content"
          style={{ flex: 1, overflowY: "auto", padding: "20px" }}
        >
          <UncertaintyPanel
            // Data
            testPointData={testPointData}
            sessionData={sessionData}
            onSessionSave={onSessionSave}
            instruments={instruments}
            onSaveInstrument={onSaveInstrument}
            setNotification={setNotification}
            currentUutSelection={currentUutSelection}
            selectedTablePointIds={selectedTablePointIds}
            // Actions & Navigation
            onDefineTestPoint={handleDefineTestPoint}
            handleOpenSessionEditor={handleOpenSessionEditor}
            onDeleteTestPoint={onDeleteTestPoint}
            onSaveTestPoint={handleSaveTestPointInfo}
            onSelectUut={onSelectUut}
            onSelectTestPoint={onSelectTestPoint}
            setSelectedTablePointIds={setSelectedTablePointIds}
            setCurrentUutSelection={setCurrentUutSelection}
            // Instrument Management
            onDeleteUut={onDeleteUut}
            onDeleteTmdeDefinition={onDeleteTmdeDefinition}
            onEditUut={onEditUut}
            onEditTmde={onEditTmde}
            onAddTmde={onAddTmde}
            // Defaults/Nulls for irrelevant props in Summary View
            calcResults={null}
            calculationError={null}
            uutNominal={null}
            uutToleranceData={null}
            tmdeTolerancesData={[]}
            riskResults={null}
            manualComponents={[]}
          />
        </div>
      ) : (
        <>
          {/* Detailed View Navigation Tabs */}
          <div className="analysis-tabs">
            {["uncertaintyTool", "risk", "riskmitigation"].map((mode) => (
              <button
                key={mode}
                className={analysisMode === mode ? "active" : ""}
                onClick={() => {
                  if (mode === "riskmitigation") {
                    // Validation override for Risk Mitigation
                    const gbResults = riskResults?.gbResults || {};
                    if (isNaN(gbResults.GBLOW) || isNaN(gbResults.GBUP)) {
                      const inputs = riskResults?.gbInputs || {};
                      setNotification({
                        title: "Math Engine Convergence Failure",
                        isFloating: true,
                        message: `Cannot calculate guard bands. Required TUR: ${inputs.reqTUR || "N/A"}, Achieved: ${inputs.turVal?.toFixed(2) || "N/A"}.`,
                      });
                      // Still allow tab switch or block? Original code allowed it but showed notification.
                    }
                  }
                  onAnalysisModeChange(mode);
                }}
              >
                {mode === "uncertaintyTool"
                  ? "Uncertainty Analysis"
                  : mode === "risk"
                    ? "Risk Analysis"
                    : "Risk Mitigation"}
              </button>
            ))}
          </div>

          <div
            className="analysis-content"
            style={{ flex: 1, overflowY: "auto", padding: "20px" }}
          >
            {analysisMode === "uncertaintyTool" && (
              <UncertaintyPanel
                // Data
                testPointData={testPointData}
                sessionData={sessionData}
                calcResults={calcResults}
                calculationError={calculationError}
                uutNominal={uutNominal}
                uutToleranceData={uutToleranceData}
                tmdeTolerancesData={tmdeTolerancesData}
                riskResults={riskResults}
                onSaveInstrument={onSaveInstrument}
                // UI State
                showContribution={showContribution}
                setShowContribution={setShowContribution}
                // Handlers: Components
                onAddManualComponent={(scope = null) => {
                  setManualComponentScope(scope);
                  setEditingComponent(null);
                  setManualModalOpen(true);
                }}
                onEditManualComponent={handleEditComponent}
                onRemoveComponent={handleRemoveComponent}
                // Handlers: Instruments
                onAddTmde={onAddTmde}
                onEditTmde={onEditTmde}
                onEditUut={onEditUut}
                onDeleteTmdeDefinition={onDeleteTmdeDefinition}
                onDecrementTmdeQuantity={onDecrementTmdeQuantity}
                onDeleteUut={onDeleteUut}
                onInlineUutUpdate={handleInlineUutUpdate}
                onInlineTmdeUpdate={handleInlineTmdeUpdate}
                // Handlers: General
                handleOpenSessionEditor={handleOpenSessionEditor}
                onUpdateTestPoint={onDataSave}
                onApplyToSessionPoints={onApplyToSessionPoints}
                // Custom equation library (global, instrument-library style)
                customEquations={customEquations}
                onSaveCustomEquation={onSaveCustomEquation}
                onDeleteCustomEquation={onDeleteCustomEquation}
                onOpenCorrelation={() => setCorrelationModalOpen(true)}
                onDefineTestPoint={handleDefineTestPoint}
                onDeleteTestPoint={onDeleteTestPoint}
                // Selections
                selectedTmdeIds={selectedTmdeIds}
                onToggleTmdeSelection={handleToggleTmdeSelection}
                onToggleAllTmdes={handleToggleAllTmdes}
                onToggleUut={handleToggleUut}
                currentUutSelection={currentUutSelection}
                // Breakdown & Advanced
                setContextMenu={setContextMenu}
                setBreakdownPoint={setBreakdownPoint}
                onBudgetRowContextMenu={handleBudgetRowContextMenu}
                onShowDerivedBreakdown={() => {
                  if (calcResults)
                    handleBudgetRowContextMenu({ preventDefault: () => {} });
                }}
                onShowRiskBreakdown={handleShowRiskBreakdown}
                onOpenRepeatability={(e, scope = null) => {
                  if (e && e.clientY)
                    setModalPosition({ top: e.clientY, left: e.clientX });
                  setManualComponentScope(scope);
                  setEditingComponent(null);
                  setRepeatabilityModalOpen(true);
                }}
                setNotification={setNotification}
                activeRangeIndices={activeRangeIndices}
                onRangeSelectionChange={onRangeSelectionChange}
              />
            )}

            {analysisMode === "risk" && (
              <div className="risk-analysis-page">
                {!calcResults ? (
                  <div
                    className="form-section-warning"
                    style={{ gridColumn: "1 / -1" }}
                  >
                    <p>Uncertainty budget must be calculated first.</p>
                  </div>
                ) : riskResults ? (
                  <>
                    <RiskAnalysisDashboard
                      results={riskResults}
                      calcResults={calcResults}
                      onShowBreakdown={handleShowRiskBreakdown}
                      activeModals={activeRiskModals}
                    />
                  </>
                ) : (
                  <div
                    className="placeholder-content"
                    style={{ minHeight: "200px", gridColumn: "1 / -1" }}
                  >
                    <p>Calculating risk...</p>
                  </div>
                )}
              </div>
            )}

            {analysisMode === "riskmitigation" && (
              <>
                {!calcResults ? (
                  <div className="form-section-warning">
                    <p>Uncertainty budget must be calculated first.</p>
                  </div>
                ) : riskResults ? (
                  <RiskMitigationDashboard
                    results={riskResults}
                    onShowBreakdown={handleShowRiskBreakdown}
                    activeModals={activeRiskModals}
                  />
                ) : (
                  <div
                    className="placeholder-content"
                    style={{ minHeight: "200px" }}
                  >
                    <p>Calculating risk...</p>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default Analysis;
