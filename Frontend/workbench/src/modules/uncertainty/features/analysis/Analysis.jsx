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

import {
  lazy,
  Suspense,
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { v4 as uuidv4 } from "uuid";

// --- Custom Hooks ---
import { useUncertaintyCalculation } from "./hooks/useUncertaintyCalculation";
import { useRiskCalculation } from "./hooks/useRiskCalculation";

// --- Components ---
import UncertaintyPanel from "./components/UncertaintyPanel";
import RiskAnalysisDashboard from "./components/RiskAnalysisDashboard";
import RiskMitigationDashboard from "./components/RiskMitigationDashboard";

// The document editor is intentionally loaded only when Notes is opened. This
// keeps the calculation workspace fast while Notes retains its full formatting,
// table, Office-paste, and media toolset.
const SessionNotesWorkspace = lazy(() =>
  import("./components/SessionNotesWorkspace"),
);

// --- Modals ---
import NotificationModal from "../../components/modals/NotificationModal";
// REMOVED: UniversalInstrumentModal import (Now handled globally in App.jsx)
import DerivedBreakdownModal from "./components/BreakdownModals/DerivedBreakdownModal";
import RiskBreakdownModal from "./components/BreakdownModals/RiskBreakdownModals";
import RepeatabilityModal from "./components/RepeatabilityModal";
import CorrelationMatrixModal from "./components/CorrelationMatrixModal";
// The Add-Test-Point modal is gone, but its stylesheet also defines the shared
// `add-point-symbol-*` equation-symbol-menu styles used by the Detailed View's
// equation editor (UncertaintyPanel / EquationLibraryMenu), so keep it loaded.
import "../testPoints/components/AddTestPointModal.css";

// --- Utilities ---
import { convertToPPM } from "../../utils/uncertaintyMath";
import {
  reconcileTmdeInstances,
  refreshTmdeInstancesFromMasters,
  tmdeInstanceMatchesMaster,
} from "../../utils/tmdeReconcile";
import {
  getBudgetComponentsFromTolerance,
  getUutResolutionComponent,
  removeSavedBudgetComponent,
  refreshLinkedTypeBComponents,
} from "./utils/budgetUtils";
import { getInstrumentRangeRows } from "../../utils/instrumentFunctionSelection";
import { createInlineManualComponent } from "./utils/manualComponentUtils";

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
  onNotesSave,
  sessionImageCache,
  onSessionImageCacheChange,
  onLoadSessionImages,

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
  onInstrumentSynced,
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
  collapsedFunctionKeys,
  setCollapsedFunctionKeys,
  keyboardShortcutsEnabled = true,
}) {
  // =========================================================================
  // 1. STATE MANAGEMENT
  // =========================================================================

  // --- UI State ---
  // Risk Analysis and Risk Mitigation tabs are hidden for now — their info is
  // surfaced in the measurement-point sidebar — until the logic and design are
  // refined. The modes and their content stay wired so re-enabling is just a
  // matter of listing them here again.
  const VISIBLE_ANALYSIS_MODES = ["uncertaintyTool", "notes"];
  const analysisMode = VISIBLE_ANALYSIS_MODES.includes(preferredAnalysisMode)
    ? preferredAnalysisMode
    : "uncertaintyTool";
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
    () => {
      if (!isPointView) return [];
      const reconciled = reconcileTmdeInstances(
        testPointData.tmdeTolerances || [],
        sessionData.tmdes || [],
      );
      return refreshTmdeInstancesFromMasters(reconciled, sessionData.tmdes || []);
    },
    [isPointView, testPointData.tmdeTolerances, sessionData.tmdes],
  );

  const manualComponents = useMemo(() => {
    if (!isPointView) return [];
    const rawComponents = testPointData.components || [];
    const getReferencePoint = (component) => {
      if (testPointData.measurementType === "derived" && component?.variableType) {
        const symbol = Object.entries(testPointData.variableMappings || {}).find(
          ([, name]) =>
            String(name || "").trim() === String(component.variableType || "").trim(),
        )?.[0];
        return symbol ? testPointData.variableNominals?.[symbol] : null;
      }
      return uutNominal;
    };
    // TMDE error limits added to a derived input budget remain linked to the
    // instrument definition. Re-resolve their selected range on every render so
    // an inline/builder tolerance or distribution edit immediately updates the
    // already-added budget row without reintroducing equation-variable assignment.
    const refreshedTmdeComponents = rawComponents
      .map((component) => {
        if (component?.uutResolutionBudgetSource) {
          const source = Array.isArray(uutToleranceData)
            ? uutToleranceData.map((tolerance, index) =>
                index === 0
                  ? {
                      ...tolerance,
                      includeResolutionInBudget: true,
                      ...(tolerance?.tolerances &&
                      typeof tolerance.tolerances === "object"
                        ? {
                            tolerances: {
                              ...tolerance.tolerances,
                              includeResolutionInBudget: true,
                            },
                          }
                        : {}),
                    }
                  : tolerance,
              )
            : {
                ...uutToleranceData,
                includeResolutionInBudget: true,
                ...(uutToleranceData?.tolerances &&
                typeof uutToleranceData.tolerances === "object"
                  ? {
                      tolerances: {
                        ...uutToleranceData.tolerances,
                        includeResolutionInBudget: true,
                      },
                    }
                  : {}),
              };
          const replacement = getUutResolutionComponent(source, uutNominal);
          return replacement
            ? {
                ...component,
                ...replacement,
                id: component.id,
                componentId: component.componentId || component.id,
                isCore: false,
                isBudgetInstance: true,
                uutResolutionBudgetSource: true,
              }
            : null;
        }
        if (!component?.tmdeBudgetSourceId) return component;
        const sourceId = component.tmdeBudgetSourceId;
        const master = (sessionData.tmdes || []).find(
          (tmde) =>
            String(tmde.id) === String(sourceId) ||
            String(tmde.sourceId) === String(sourceId),
        );
        if (!master) return null;
        const ranges = getInstrumentRangeRows(master, { flattenTolerances: true });
        const selectedRange =
          ranges.find(
            (range) =>
              component.tmdeBudgetRangeId &&
              String(range.rangeId ?? range.id) ===
                String(component.tmdeBudgetRangeId) &&
              (!component.tmdeBudgetFunctionId ||
                !range.functionId ||
                String(range.functionId) === String(component.tmdeBudgetFunctionId)),
          ) ||
          ranges.find(
            (range) =>
              component.tmdeBudgetFunctionName &&
              String(range.functionName || "").trim() ===
                String(component.tmdeBudgetFunctionName).trim(),
          ) ||
          ranges[0];
        if (!selectedRange) return null;
        const referencePoint = getReferencePoint(component);
        const resolutionLinked =
          String(component.tmdeBudgetComponentKind || "").toLowerCase() ===
          "resolution";
        const selectedSource = resolutionLinked
          ? {
              ...selectedRange,
              includeResolutionInBudget: true,
              ...(selectedRange?.tolerance &&
              typeof selectedRange.tolerance === "object"
                ? {
                    tolerance: {
                      ...selectedRange.tolerance,
                      includeResolutionInBudget: true,
                    },
                  }
                : {}),
              ...(selectedRange?.tolerances &&
              typeof selectedRange.tolerances === "object"
                ? {
                    tolerances: {
                      ...selectedRange.tolerances,
                      includeResolutionInBudget: true,
                    },
                  }
                : {}),
            }
          : selectedRange;
        const resolved = getBudgetComponentsFromTolerance(
          selectedSource,
          referencePoint,
        );
        const replacement = resolved.find(
          (candidate) =>
            String(candidate.name || "").split(" - ").slice(1).join(" - ") ===
            String(component.tmdeBudgetComponentKind || ""),
        );
        if (!replacement) return null;
        const divisor = replacement.distributionDivisor;
        const numericDivisor = Number(divisor);
        const toleranceLimit =
          Number.isFinite(numericDivisor) &&
          Number.isFinite(Number(replacement.value_native))
            ? Math.abs(Number(replacement.value_native) * numericDivisor)
            : "";
        return {
          ...component,
          value: replacement.value,
          isBaseUnitValue: replacement.isBaseUnitValue,
          value_native: replacement.value_native,
          unit_native: replacement.unit_native,
          distribution: replacement.distribution,
          distributionDivisor: replacement.distributionDivisor,
          originalInput: {
            ...(component.originalInput || {}),
            toleranceLimit,
            errorDistributionDivisor: divisor,
            unit: replacement.unit_native || component.originalInput?.unit || "",
          },
        };
      })
      .filter(Boolean);

    return refreshLinkedTypeBComponents({
      components: refreshedTmdeComponents,
      tmdeTolerances: tmdeTolerancesData,
      sessionTmdes: sessionData.tmdes || [],
      instruments,
      getReferencePoint,
    });
  }, [
    isPointView,
    testPointData.components,
    testPointData.measurementType,
    testPointData.variableMappings,
    testPointData.variableNominals,
    tmdeTolerancesData,
    sessionData.tmdes,
    instruments,
    uutNominal,
    uutToleranceData,
  ]);

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
    dismissNotification: dismissRiskNotification,
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

  // Sync risk notifications without setting state during render. Dismissing
  // the modal clears both layers below, so an unchanged validation warning
  // stays closed until a risk input actually changes and validation reruns.
  useEffect(() => {
    if (riskNotification) {
      setNotification((current) => current || riskNotification);
    }
  }, [riskNotification]);

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
      if (tmdeInstanceMatchesMaster(t, tmdeToSave)) {
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
          functionId: func?.id || t.functionId || "",
          rangeId: newActiveRange.id || t.rangeId || "",
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
    if (setCurrentUutSelection) setCurrentUutSelection([]);
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
    }
  };

  const handleAddInlineManualComponent = (scope = null) => {
    const id = `manual_${Date.now()}_${uuidv4()}`;
    const component = createInlineManualComponent({
      id,
      scope,
      referencePoint: scope?.nominalPoint || uutNominal,
    });
    onDataSave({
      components: [...(testPointData.components || []), component],
    });
    setEditingComponent(null);
    setManualComponentScope(null);
  };

  const handleRemoveComponent = (id, component = null) => {
    // Every repeated budget selection is persisted as its own component row.
    // Resolve this against the saved collection rather than trusting the
    // calculated table copy to retain every metadata flag. Remove only that
    // exact instance, regardless of the instrument/source it was copied from.
    const savedRemoval = removeSavedBudgetComponent(
      testPointData.components,
      id,
    );
    if (savedRemoval.removed) {
      onDataSave({ components: savedRemoval.components });
      return;
    }

    // A TMDE resolution is opted in on its own point instance. Clearing that
    // flag must leave the TMDE accuracy row—and the instrument assignment—intact.
    if (component?.isResolution && component?.sourceTmdeId) {
      const sourceId = String(component.sourceTmdeId);
      onDataSave({
        tmdeTolerances: tmdeTolerancesData.map((tmde) => {
          if (
            String(tmde.id) !== sourceId &&
            String(tmde.sourceId) !== sourceId
          ) {
            return tmde;
          }
          return {
            ...tmde,
            includeResolutionInBudget: false,
            ...(tmde.tolerance && typeof tmde.tolerance === "object"
              ? {
                  tolerance: {
                    ...tmde.tolerance,
                    includeResolutionInBudget: false,
                  },
                }
              : {}),
          };
        }),
      });
      return;
    }

    // The UUT resolution is opted into the budget from the add menu, so removing
    // it here simply opts it back out on the point's tolerance.
    if (component?.isResolution || id === "uut_resolution") {
      onDataSave({
        uutTolerance: { ...uutToleranceData, includeResolutionInBudget: false },
      });
      return;
    }

    // Derived TMDE budget rows are standalone, source-linked components. They
    // must not remove a legacy equation assignment that happens to reference
    // the same master TMDE; remove only this component instance.
    if (component?.tmdeBudgetSourceId) {
      const updatedComponents = manualComponents.filter((c) => c.id !== id);
      if (updatedComponents.length < manualComponents.length) {
        onDataSave({ components: updatedComponents });
      }
      return;
    }

    if (component?.sourceTmdeId) {
      const sourceId = String(component.sourceTmdeId);
      const matchIndex = tmdeTolerancesData.findIndex(
        (tmde) =>
          String(tmde.id) === sourceId || String(tmde.sourceId) === sourceId,
      );
      if (matchIndex >= 0) {
        const matched = tmdeTolerancesData[matchIndex];
        const quantity = Number(matched?.quantity);
        const updatedTolerances =
          Number.isFinite(quantity) && quantity > 1
            ? tmdeTolerancesData.map((tmde, index) =>
                index === matchIndex
                  ? { ...tmde, quantity: quantity - 1 }
                  : tmde,
              )
            : tmdeTolerancesData.filter((_, index) => index !== matchIndex);
        onDataSave({ tmdeTolerances: updatedTolerances });
        return;
      }
    }

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
      : `repeatability_${Date.now()}_${uuidv4()}`;
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
      // Preserve the exact variable scope used by the calculator so the
      // breakdown can evaluate derivative strings in base SI units instead
      // of guessing from formatted source labels.
      derivedNominalPoint: {
        ...uutNominal,
        variableNominals: testPointData.variableNominals || {},
        variableMappings: testPointData.variableMappings || {},
      },
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

    // Create the point directly (no modal). It starts blank so the user just
    // types the value inline in the sidebar; the unit/function come from the
    // resolved tolerance/range.
    handleSaveTestPointInfo({
      ...overrides,
      measurementType: "direct",
      testPointInfo: {
        parameter: {
          name: resolvedTolerance?.functionName || "Measurement",
          value: "",
          unit: resolvedTolerance?.unit || "",
        },
      },
    });
  };

  // =========================================================================
  // 6. RENDER
  // =========================================================================

  const analysisTabs = (
    <div className="analysis-tabs">
      {VISIBLE_ANALYSIS_MODES.map((mode) => (
        <button
          key={mode}
          className={analysisMode === mode ? "active" : ""}
          onClick={() => {
            if (mode === "riskmitigation") {
              const gbResults = riskResults?.gbResults || {};
              if (isNaN(gbResults.GBLOW) || isNaN(gbResults.GBUP)) {
                const inputs = riskResults?.gbInputs || {};
                setNotification({
                  title: "Math Engine Convergence Failure",
                  isFloating: true,
                  message: `Cannot calculate guard bands. Required TUR: ${inputs.reqTUR || "N/A"}, Achieved: ${inputs.turVal?.toFixed(2) || "N/A"}.`,
                });
              }
            }
            onAnalysisModeChange(mode);
          }}
        >
          {mode === "uncertaintyTool"
            ? "Uncertainty Budget"
            : mode === "notes"
              ? "Notes"
              : mode === "risk"
                ? "Risk Analysis"
                : "Risk Mitigation"}
        </button>
      ))}
    </div>
  );

  const notesWorkspace = (
    <Suspense
      fallback={(
        <div className="session-notes-loading" role="status" aria-live="polite">
          <span className="session-notes-loading-mark" aria-hidden="true" />
          <span>Preparing editor</span>
        </div>
      )}
    >
      <SessionNotesWorkspace
        sessionData={sessionData}
        sessionImageCache={sessionImageCache}
        onSessionImageCacheChange={onSessionImageCacheChange}
        onLoadSessionImages={onLoadSessionImages}
        onSessionSave={onSessionSave}
        onNotesSave={onNotesSave}
      />
    </Suspense>
  );

  return (
    <div
      className="analysis-container"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      {/* 1. Global Modals */}
      <NotificationModal
        isOpen={!!notification}
        onClose={() => {
          setNotification(null);
          dismissRiskNotification?.();
        }}
        {...notification}
      />

      {/* REMOVED: UniversalInstrumentModal - Now handled globally in App.jsx */}
      {/* REMOVED: AddTestPointModal - points are now created inline on the UUT */}

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
        <>
          {analysisTabs}
          <div
            className="analysis-content"
            style={{ flex: 1, overflowY: "auto", padding: "20px" }}
          >
            {analysisMode === "notes" ? notesWorkspace : (
              <UncertaintyPanel
            // Data
            testPointData={testPointData}
            sessionData={sessionData}
            onSessionSave={onSessionSave}
            instruments={instruments}
            onSaveInstrument={onSaveInstrument}
            onInstrumentSynced={onInstrumentSynced}
            setNotification={setNotification}
            currentUutSelection={currentUutSelection}
            selectedTablePointIds={selectedTablePointIds}
            collapsedFunctionKeys={collapsedFunctionKeys}
            setCollapsedFunctionKeys={setCollapsedFunctionKeys}
            keyboardShortcutsEnabled={keyboardShortcutsEnabled}
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
            // Defaults/Nulls for irrelevant props in Summary View
            calcResults={null}
            calculationError={null}
            uutNominal={null}
            uutToleranceData={null}
            tmdeTolerancesData={[]}
            riskResults={null}
                manualComponents={[]}
              />
            )}
          </div>
        </>
      ) : (
        <>
          {/* Detailed View Navigation Tabs */}
          {analysisTabs}

          <div
            className="analysis-content"
            style={{ flex: 1, overflowY: "auto", padding: "20px" }}
          >
            {analysisMode === "notes" && notesWorkspace}

            {analysisMode === "uncertaintyTool" && (
              <>
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
                onInstrumentSynced={onInstrumentSynced}
                onSessionSave={onSessionSave}
                instruments={instruments}
                // UI State
                showContribution={showContribution}
                setShowContribution={setShowContribution}
                collapsedFunctionKeys={collapsedFunctionKeys}
                setCollapsedFunctionKeys={setCollapsedFunctionKeys}
                keyboardShortcutsEnabled={keyboardShortcutsEnabled}
                // Handlers: Components
                onAddManualComponent={handleAddInlineManualComponent}
                onEditManualComponent={handleEditComponent}
                onRemoveComponent={handleRemoveComponent}
                // Handlers: Instruments
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
              </>
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
                  <>
                    <RiskMitigationDashboard
                      results={riskResults}
                      onShowBreakdown={handleShowRiskBreakdown}
                      activeModals={activeRiskModals}
                    />
                  </>
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
