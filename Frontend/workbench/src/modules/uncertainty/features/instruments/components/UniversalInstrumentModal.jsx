import SymbolButton from "../../../components/common/SymbolButton";
import { DEFAULT_MEASUREMENT_AREA_COLOR } from "../../../utils/measurementAreaColors";
import { historyShortcut } from "../../../utils/historyShortcut";
import LibraryInstrumentRow from "./LibraryInstrumentRow";
import { instrumentForRole } from "../../../utils/acShuntInstrumentRole";
import { instrumentDeleteTarget } from "../../../utils/instrumentIdentity";
import { patchInstrumentRange } from "../../../utils/instrumentFullScale";
import { normalizeInstrumentTypeBComponents } from "../../../utils/instrumentBudgetComponents";
import { withInstrumentEditorDrafts } from "../../../utils/instrumentBudgetComponents";
import { readEditorDraft, saveEditorDraft, clearEditorDraft } from "../../../utils/editorRecovery";
import { useConfirmRecordDeletes } from "../../../contexts/RecordDeletePolicy";
import { validateInstrumentSpecifications } from "../../../utils/instrumentValidation";
import BuilderSpecificationRow from "./BuilderSpecificationRow";
import { applyToleranceCaseChange as applySharedToleranceCaseChange, localizeSharedInstrumentEdit } from "../../analysis/components/UncertaintyPanel";
import { instrumentMatchesSearch } from "../../../utils/functionGrouping";
/**
 * src/features/instruments/components/UniversalInstrumentModal.jsx
 */
import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faPlus,
  faTrashAlt,
  faSearch,
  faChevronDown,
  faChevronUp,
  faCube,
  faBookOpen,
  faMicroscope,
  faTools,
  faTag,
  faIndustry,
  faFingerprint,
  faSyncAlt
} from "@fortawesome/free-solid-svg-icons";
import { v4 as uuidv4 } from "uuid";
import {
  getUnitDisplayLabel,
  unitCategories,
  unitSystem,
} from "../../../utils/uncertaintyMath";
import TypeBComponentsEditor from "./TypeBComponentsEditor";
import { TypeBAddMenu } from "./ReusableTypeBEditor";
import { createInstrumentBudgetComponent } from "../../../utils/instrumentBudgetComponents";
import BuilderUnitSelect from "./BuilderUnitSelect";
import NotificationModal from "../../../components/modals/NotificationModal";
import { useFloatingWindow } from "../../../hooks/useFloatingWindow";
import useInstrumentSync from "../../../hooks/useInstrumentSync";
import {
  buildValidatedSnapshot,
  computeSyncState,
  diffFromSnapshot,
} from "../../../utils/instrumentSync";

import "./UniversalInstrumentModal.css";

// --- Helpers ---
const getCategorizedUnitOptions = (allUnits, referenceUnit) => {
  const options = [];
  const usedUnits = new Set();
  
  if (referenceUnit && allUnits.includes(referenceUnit)) {
    let refCategory = "Suggested";
    for (const [cat, units] of Object.entries(unitCategories)) {
      if (units.includes(referenceUnit)) {
        refCategory = cat;
        break;
      }
    }
    const categoryUnits = unitCategories[refCategory] || [referenceUnit];
    const prioritizedOptions = categoryUnits
      .filter((u) => allUnits.includes(u))
      .map((u) => { usedUnits.add(u); return { value: u, label: getUnitDisplayLabel(u) }; });
    options.push({ label: refCategory, options: prioritizedOptions });
  }

  Object.entries(unitCategories).forEach(([label, units]) => {
    if (options.some((opt) => opt.label === label)) return;
    const groupOptions = units
      .filter((u) => allUnits.includes(u) && !usedUnits.has(u))
      .map((u) => { usedUnits.add(u); return { value: u, label: getUnitDisplayLabel(u) }; });
    if (groupOptions.length > 0) options.push({ label, options: groupOptions });
  });

  const leftovers = allUnits
    .filter((u) => !usedUnits.has(u) && !["%", "ppm", "dB", "ppb"].includes(u))
    .map((u) => ({ value: u, label: getUnitDisplayLabel(u) }));
  if (leftovers.length > 0) options.push({ label: "Other", options: leftovers });

  return options;
};

const TOLERANCE_DIST_DEFAULT = "1.732";
const RESOLUTION_DIST_DEFAULT = "3.464";
const MAX_BUILDER_UNDO_STEPS = 50;
const BAND_KEYS = ["reading", "readings_iv", "range", "floor"];

const getBandDistribution = (tolerances = {}) => {
    const key = BAND_KEYS.find((k) => tolerances?.[k]);
    if (key) return tolerances[key].distribution || TOLERANCE_DIST_DEFAULT;
    return tolerances?.bandDistribution || null;
};

const applyBandDistribution = (tolerances = {}, value) => {
    const next = { ...(tolerances || {}) };
    let touched = false;
    BAND_KEYS.forEach((key) => {
        if (next[key] && typeof next[key] === "object") {
            next[key] = { ...next[key], distribution: value };
            touched = true;
        }
    });
    if (!touched) next.bandDistribution = value;
    return next;
};

// A unit-bearing row with no lower/upper bounds is the persisted form of an
// all-values specification. It lets an instrument carry a tolerance before (or
// without) a finite range and remains compatible with every point in that unit.
const createUnboundedBuilderRange = (unit = "") => ({
    id: uuidv4(),
    min: "",
    max: "",
    unit,
    resolution: "",
    resolutionUnit: unit,
    resolutionDistribution: RESOLUTION_DIST_DEFAULT,
    tolerances: {},
});

// A function is identified by its name. Range units are independent choices,
// so legacy data that stored one function per unit is folded into one builder
// section while retaining every range and unit.
const normalizeBuilderFunctions = (functions = []) => {
    const byName = new Map();
    (Array.isArray(functions) ? functions : []).forEach((sourceFn) => {
        const name = String(sourceFn?.name || "Measurement").trim() || "Measurement";
        const key = name.toLowerCase();
        const ranges = (Array.isArray(sourceFn?.ranges) ? sourceFn.ranges : []).map((range) => ({
            ...range,
            id: range?.id || uuidv4(),
        }));
        const rangeUnits = Array.from(
            new Set(
                ranges
                    .flatMap((range) => [range.unit, range.functionUnit])
                    .filter(Boolean)
                    .map((unit) => String(unit).trim())
                    .filter(Boolean),
            ),
        );
        const declaredUnits = Array.from(
            new Set([
                ...(Array.isArray(sourceFn?.units) ? sourceFn.units : []),
                sourceFn?.unit,
            ].filter(Boolean).map((unit) => String(unit).trim()).filter(Boolean)),
        );
        const units = rangeUnits.length ? rangeUnits : declaredUnits;
        const existing = byName.get(key);
        if (existing) {
            existing.ranges.push(...ranges);
            existing.units = Array.from(new Set([...existing.units, ...units]));
            existing.unit = existing.units[0] || existing.unit || "";
            return;
        }
        byName.set(key, {
            ...sourceFn,
            id: sourceFn?.id || uuidv4(),
            name,
            unit: units[0] || "",
            units,
            ranges,
        });
    });
    return Array.from(byName.values()).map((fn) =>
        fn.ranges.length > 0
            ? fn
            : { ...fn, ranges: [createUnboundedBuilderRange(fn.unit)] },
    );
};

const DEFAULT_MEASUREMENT_AREA_NAME = "Unassigned";

// Session descriptions can differ from the catalog name. Compare every
// specification that would be submitted, independently of that local label.
const getComparableLibraryInstrument = instrument => {
    const { description, ...specifications } = buildValidatedSnapshot(instrument);
    return specifications;
};

const hasValidatedSnapshot = (instrument = {}) =>
    instrument.validatedSnapshot != null &&
    typeof instrument.validatedSnapshot === "object" &&
    Object.keys(instrument.validatedSnapshot).length > 0;

const getInstrumentSourceStatus = (instrument = {}, linkedInstrument = null) => {
    if (instrument.scope === "session") return { label: "Session", tone: "session", title: "Available in this session" };
    if (instrument.scope === "pending") return { label: "Pending", tone: "pending", title: "Submitted for SME validation" };
    const explicitScope = instrument?.scope;
    const linkedShared = ["validated", "shared"].includes(linkedInstrument?.scope);
    const isShared =
        ["validated", "shared"].includes(explicitScope) ||
        (!explicitScope && linkedShared) ||
        (linkedShared && !instrument.localOverride &&
          diffFromSnapshot({ ...instrument, validatedSnapshot: buildValidatedSnapshot(linkedInstrument) }).length === 0);

    if (isShared) {
        return {
            label: "Synced",
            tone: "shared",
            title: "Shared library instrument"
        };
    }

    const isLinkedLocal =
        Boolean(instrument?.sourceId) ||
        hasValidatedSnapshot(instrument) ||
        Boolean(linkedInstrument?.sourceId) ||
        hasValidatedSnapshot(linkedInstrument || {});

    return {
        label: "Local",
        tone: "local",
        title: isLinkedLocal
            ? "Local instrument linked to a shared origin"
            : "Local instrument"
    };
};

const syncDiffSummary = (diffs = []) => {
    if (!diffs.length) return "An Uncertalytics SME will review this instrument.";
    return `Changed shared-library fields: ${diffs.map((diff) => diff.field).join(", ")}.`;
};

const InstrumentSourceBadge = ({ instrument, linkedInstrument = null }) => {
    const status = getInstrumentSourceStatus(instrument, linkedInstrument);
    return (
        <span
            className={`instrument-source-badge instrument-source-badge--${status.tone}`}
            title={status.title}
            aria-label={`Instrument source: ${status.label}`}
        >
            {status.label}
        </span>
    );
};

const UniversalInstrumentModal = ({
    isOpen,
    onClose,
    onSave,
    onSaveToLibrary,
    onDelete,
    onBatchAdd,
    onInstrumentSynced,
    showToast,
    mode = 'library', // 'uut', 'tmde', 'library'
    initialData = null,
    instruments = []
}) => {
    const confirmRecordDeletes = useConfirmRecordDeletes();
    const [viewMode, setViewMode] = useState("edit");
    const [effectiveMode, setEffectiveMode] = useState(mode);

    const [searchTerm, setSearchTerm] = useState("");
    const [libraryDrafts, setLibraryDrafts] = useState({});
    const [sourceFilter, setSourceFilter] = useState("all");
    const [sortField, setSortField] = useState("manufacturer");
    const [sortDirection, setSortDirection] = useState("asc");

    // Library list multi-select: ids of checked rows + the anchor for shift-range.
    const [selectedIds, setSelectedIds] = useState([]);
    const [selectionAnchor, setSelectionAnchor] = useState(null);
    // Delete confirmation. Routed through one choke-point so a password gate can
    // be added here later without touching the call sites.
    const [pendingDelete, setPendingDelete] = useState(null); // { ids: [...] }
    const [pendingSync, setPendingSync] = useState(null);
    const [syncNotice, setSyncNotice] = useState(null);
    const [validationNotice, setValidationNotice] = useState(false);
    const [pendingInstrumentSave, setPendingInstrumentSave] = useState(false);
    const [submissionError, setSubmissionError] = useState("");
    const submitting = useRef(false);
    const [libraryInstrumentId, setLibraryInstrumentId] = useState(null);
    const [initialInstrumentSignature, setInitialInstrumentSignature] = useState("");
    const [initialInstrumentName, setInitialInstrumentName] = useState("");

    const [metaData, setMetaData] = useState({
        name: "", 
        measurementArea: DEFAULT_MEASUREMENT_AREA_NAME,
        measurementAreaId: "",
        measurementAreaColor: DEFAULT_MEASUREMENT_AREA_COLOR, 
        quantity: 1, 
        assetId: "" 
    });

    const [instrumentDef, setInstrumentDef] = useState({
        id: uuidv4(),
        manufacturer: "",
        model: "",
        description: "",
        scope: "session",
        functions: [],
        typeBComponents: []
    });

    const [activeFunctionId, setActiveFunctionId] = useState(null);
    const [activeTypeBId, setActiveTypeBId] = useState(null);
    const builderUndoHistoryRef = useRef([]);
    const builderRedoHistoryRef = useRef([]);
    const builderUndoSnapshotRef = useRef(null);
    const builderUndoStateRef = useRef(null);
    const builderUndoReadyRef = useRef(false);
    const builderApplyingUndoRef = useRef(false);

    const { position, handleMouseDown } = useFloatingWindow({
        isOpen,
        defaultWidth: Math.min(1100, window.innerWidth * 0.95),
        defaultHeight: Math.min(850, window.innerHeight * 0.85)
    });
    const { syncToShared, getDiff } = useInstrumentSync(onInstrumentSynced);
    const builderDraftKey = `builder:${mode}:${initialData?.id || "new"}`;

    useEffect(() => {
        if (isOpen) {
            setSearchTerm("");
            setSelectedIds([]);
            setSelectionAnchor(null);
            setPendingDelete(null);
            setPendingSync(null);
            setSyncNotice(null);
            setValidationNotice(false);
            setPendingInstrumentSave(false);
            setSubmissionError("");

            if (mode === 'library') {
                setViewMode("list");
            } else {
                setViewMode("edit");
            }
            setEffectiveMode(mode);

            if (initialData) {
                setViewMode("edit");
                const loadedInst = initialData.instrument || (initialData.functions ? initialData : null) || {
                    id: uuidv4(), manufacturer: "", model: "", description: "", scope: "session", functions: [], typeBComponents: []
                };
                const existingLibraryId =
                    initialData.libraryInstrumentId ||
                    loadedInst.libraryInstrumentId ||
                    (instruments.some((instrument) => instrument.id === loadedInst.id)
                        ? loadedInst.id
                        : null);
                const normalizedLoadedInst = {
                    ...loadedInst,
                    functions: normalizeBuilderFunctions(loadedInst.functions),
                };
                setLibraryInstrumentId(existingLibraryId);
                setInitialInstrumentName(initialData.description || initialData.name || "");
                setInitialInstrumentSignature(
                    JSON.stringify(getComparableLibraryInstrument(normalizedLoadedInst))
                );
                setInstrumentDef(JSON.parse(JSON.stringify(normalizedLoadedInst)));
                if (normalizedLoadedInst.functions?.length > 0) setActiveFunctionId(normalizedLoadedInst.functions[0].id);
                else setActiveFunctionId(null);
                setActiveTypeBId(loadedInst.typeBComponents?.[0]?.id || null);

                setMetaData({
                    name: initialData.description || initialData.name || "",
                    measurementArea: initialData.measurementArea || DEFAULT_MEASUREMENT_AREA_NAME,
                    measurementAreaId: initialData.measurementAreaId || "",
                    measurementAreaColor: initialData.measurementAreaColor || DEFAULT_MEASUREMENT_AREA_COLOR,
                    quantity: initialData.quantity || 1,
                    assetId: initialData.assetId || ""
                });
            } else {
                setLibraryInstrumentId(null);
                setInitialInstrumentName("");
                setInitialInstrumentSignature(
                    JSON.stringify(getComparableLibraryInstrument({
                        manufacturer: "",
                        model: "",
                        functions: []
                    }))
                );
                setMetaData({
                    name: "",
                    measurementArea: DEFAULT_MEASUREMENT_AREA_NAME,
                    measurementAreaId: "",
                    measurementAreaColor: DEFAULT_MEASUREMENT_AREA_COLOR,
                    quantity: 1,
                    assetId: ""
                });
                setInstrumentDef({ id: uuidv4(), manufacturer: "", model: "", description: "", scope: "session", functions: [], typeBComponents: [] });
                setActiveFunctionId(null);
                setActiveTypeBId(null);
            }
            const recovered = readEditorDraft(builderDraftKey);
            if (recovered?.instrumentDef) {
                setInstrumentDef(recovered.instrumentDef); setMetaData(recovered.metaData);
                setActiveFunctionId(recovered.activeFunctionId); setActiveTypeBId(recovered.activeTypeBId);
                setViewMode("edit");
            }
        }
    }, [isOpen, initialData, mode]);

    // The app-level shortcut deliberately yields while this editor is open, so
    // the builder owns its own snapshot history. This captures button/menu
    // actions as well as committed field edits without ever undoing the session
    // behind the modal.
    useEffect(() => {
        const snapshot = {
            instrumentDef,
            metaData,
            activeFunctionId,
            activeTypeBId,
        };
        builderUndoStateRef.current = snapshot;
        if (!builderUndoReadyRef.current) return;
        if (isOpen && viewMode === "edit") saveEditorDraft(builderDraftKey, snapshot);

        if (builderApplyingUndoRef.current) {
            builderApplyingUndoRef.current = false;
            builderUndoSnapshotRef.current = JSON.parse(JSON.stringify(snapshot));
            return;
        }

        const previous = builderUndoSnapshotRef.current;
        const dataChanged = previous && (
            JSON.stringify(previous.instrumentDef) !== JSON.stringify(snapshot.instrumentDef) ||
            JSON.stringify(previous.metaData) !== JSON.stringify(snapshot.metaData)
        );
        if (dataChanged) {
            builderRedoHistoryRef.current = [];
            builderUndoHistoryRef.current.push(previous);
            if (builderUndoHistoryRef.current.length > MAX_BUILDER_UNDO_STEPS) {
                builderUndoHistoryRef.current.splice(
                    0,
                    builderUndoHistoryRef.current.length - MAX_BUILDER_UNDO_STEPS,
                );
            }
        }
        builderUndoSnapshotRef.current = JSON.parse(JSON.stringify(snapshot));
    }, [activeFunctionId, activeTypeBId, instrumentDef, metaData]);

    useEffect(() => {
        builderUndoReadyRef.current = false;
        builderUndoHistoryRef.current = [];
        builderRedoHistoryRef.current = [];
        builderUndoSnapshotRef.current = null;
        if (!isOpen) return undefined;

        // Let the modal's initialization effect finish loading initialData
        // before establishing the first (non-undoable) baseline.
        const timer = window.setTimeout(() => {
            const baseline = builderUndoStateRef.current;
            builderUndoSnapshotRef.current = baseline
                ? JSON.parse(JSON.stringify(baseline))
                : null;
            builderUndoReadyRef.current = true;
        }, 0);
        return () => window.clearTimeout(timer);
    }, [initialData, isOpen, mode]);

    useEffect(() => {
        if (!isOpen || viewMode !== "edit") return undefined;
        const handleBuilderUndo = (event) => {
            const direction = historyShortcut(event);
            if (!direction) return;
            const redo = direction === "redo";
            const previous = (redo ? builderRedoHistoryRef : builderUndoHistoryRef).current.pop();
            if (!previous) return;
            event.preventDefault();
            (redo ? builderUndoHistoryRef : builderRedoHistoryRef).current.push(builderUndoSnapshotRef.current);
            builderApplyingUndoRef.current = true;
            builderUndoSnapshotRef.current = JSON.parse(JSON.stringify(previous));
            setInstrumentDef(previous.instrumentDef);
            setMetaData(previous.metaData);
            setActiveFunctionId(previous.activeFunctionId);
            setActiveTypeBId(previous.activeTypeBId);
        };
        window.addEventListener("keydown", handleBuilderUndo);
        return () => window.removeEventListener("keydown", handleBuilderUndo);
    }, [isOpen, viewMode]);

    const filteredInstruments = useMemo(() => {
        return instruments.filter(instrument => (!searchTerm || instrumentMatchesSearch(instrument, searchTerm)) &&
            (sourceFilter === "all" || (sourceFilter === "shared" ? ["shared", "validated"].includes(instrument.scope) : !["shared", "validated"].includes(instrument.scope))))
            .sort((a, b) => String(a[sortField] || "").localeCompare(String(b[sortField] || ""), undefined, { numeric: true, sensitivity: "base" }) * (sortDirection === "asc" ? 1 : -1));
    }, [instruments, searchTerm, sourceFilter, sortField, sortDirection]);

    const selectedInstrument = useMemo(
        () =>
            selectedIds.length === 1
                ? instruments.find((instrument) => instrument.id === selectedIds[0]) || null
                : null,
        [instruments, selectedIds],
    );

    const linkedSharedFor = useCallback(
        (instrument) => {
            const sourceId =
                instrument?.sourceId ||
                instrument?.libraryInstrumentId ||
                (instrument?.scope === "validated" ? instrument.id : null);
            if (!sourceId) return null;
            return instruments.find(
                (candidate) =>
                    candidate.scope === "validated" &&
                    String(candidate.id) === String(sourceId),
            ) || null;
        },
        [instruments],
    );

    const activeFunction = useMemo(() => 
        (instrumentDef.functions || []).find(f => f.id === activeFunctionId), 
    [instrumentDef.functions, activeFunctionId]);

    const typeBComponents = useMemo(
        () => normalizeInstrumentTypeBComponents(instrumentDef.typeBComponents),
        [instrumentDef.typeBComponents],
    );

    const allUnitsRaw = useMemo(() => Object.keys(unitSystem.units), []);
    const categorizedUnitOptions = useMemo(() => {
        return getCategorizedUnitOptions(allUnitsRaw, activeFunction?.unit);
    }, [allUnitsRaw, activeFunction?.unit]);

    const modalTitle = useMemo(() => {
        if (effectiveMode === 'uut') return initialData ? "Edit UUT" : "Add New UUT";
        if (effectiveMode === 'tmde') return initialData ? "Edit TMDE" : "Add New TMDE";
        return "Instrument Manager";
    }, [effectiveMode, initialData]);

    const modeIcon = effectiveMode === 'uut' ? faMicroscope : (effectiveMode === 'tmde' ? faTools : faBookOpen);

    const missingRequiredFields = useMemo(() => [
        !instrumentDef.manufacturer?.trim() ? "Mfr." : null,
        !instrumentDef.model?.trim() ? "Model" : null,
        !metaData.name?.trim() ? "Name" : null,
        ...validateInstrumentSpecifications(instrumentDef),
    ].filter(Boolean), [instrumentDef, metaData.name]);
    const isFormValid = missingRequiredFields.length === 0;

    const isInstrumentInLibrary = useMemo(
        () => instruments.some(
            (instrument) =>
                instrument.id === libraryInstrumentId ||
                instrument.id === instrumentDef.id
        ),
        [instruments, libraryInstrumentId, instrumentDef.id]
    );

    const linkedLibraryInstrument = useMemo(
        () => instruments.find(
            (instrument) =>
                instrument.id === libraryInstrumentId ||
                instrument.id === instrumentDef.id
        ) || null,
        [instruments, libraryInstrumentId, instrumentDef.id]
    );

    const hasSpecificationChanges = useMemo(() =>
        JSON.stringify(getComparableLibraryInstrument({
            ...instrumentDef,
            description: metaData.name,
        })) !== initialInstrumentSignature,
    [initialInstrumentSignature, instrumentDef, metaData.name]);
    const hasLibraryChanges = Boolean(linkedLibraryInstrument && hasSpecificationChanges);
    const sharedSessionEdit = ["uut", "tmde"].includes(effectiveMode) &&
        ["validated", "shared"].includes(instrumentDef.scope || linkedLibraryInstrument?.scope) &&
        (hasSpecificationChanges || metaData.name !== initialInstrumentName);

    const sourceBadgeInstrument = useMemo(() => {
        if (sharedSessionEdit) return { ...instrumentDef, scope: "session", localOverride: true };
        if (!["validated", "shared"].includes(instrumentDef.scope) || !hasLibraryChanges) {
            return instrumentDef;
        }
        return {
            ...instrumentDef,
            scope: "local",
            sourceId: instrumentDef.sourceId || instrumentDef.id,
            validatedSnapshot:
                instrumentDef.validatedSnapshot ||
                buildValidatedSnapshot(linkedLibraryInstrument || instrumentDef),
            localOverride: true,
        };
    }, [hasLibraryChanges, sharedSessionEdit, instrumentDef, linkedLibraryInstrument]);

    // --- Library list multi-select (ctrl = toggle, shift = range) ---
    const handleRowSelect = (e, instId) => {
        // Move keyboard ownership from the auto-focused search box to the row
        // the user just selected. This makes Delete unambiguously target the
        // selected instrument while preserving native Delete inside search.
        e.currentTarget?.focus?.();
        const visibleIds = filteredInstruments.map((i) => i.id);
        const targetIdx = visibleIds.indexOf(instId);

        if (e.shiftKey && selectionAnchor) {
            const anchorIdx = visibleIds.indexOf(selectionAnchor);
            if (anchorIdx !== -1 && targetIdx !== -1) {
                const [lo, hi] =
                    anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
                const run = visibleIds.slice(lo, hi + 1);
                setSelectedIds(
                    e.ctrlKey || e.metaKey
                        ? Array.from(new Set([...selectedIds, ...run]))
                        : run,
                );
                return;
            }
        }
        if (e.ctrlKey || e.metaKey) {
            setSelectedIds((prev) =>
                prev.includes(instId)
                    ? prev.filter((x) => x !== instId)
                    : [...prev, instId],
            );
            setSelectionAnchor(instId);
            return;
        }
        // Plain click toggles a single selection (click again to clear).
        setSelectedIds((prev) =>
            prev.length === 1 && prev[0] === instId ? [] : [instId],
        );
        setSelectionAnchor(instId);
    };

    // Single delete choke-point — a password gate can wrap confirmDelete later.
    const requestDelete = (ids) => {
        const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
        if (!list.length) return;
        if (confirmRecordDeletes) setPendingDelete({ ids: list });
        else void deleteInstruments(list);
    };

    // The modal owns Delete while open. In library-list mode it follows the
    // existing toolbar delete path for the selected instruments; everywhere
    // else it simply prevents a stale analysis selection behind the modal from
    // receiving the key. Native text deletion remains untouched in editors.
    useEffect(() => {
        if (!isOpen) return undefined;
        const handleDeleteKey = (event) => {
            if (event.key !== "Delete") return;
            const active = document.activeElement;
            if (
                active &&
                (active.tagName === "INPUT" ||
                    active.tagName === "TEXTAREA" ||
                    active.isContentEditable)
            ) {
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();
            if (
                viewMode === "list" &&
                selectedIds.length > 0 &&
                onDelete &&
                !pendingDelete
            ) {
                requestDelete([...selectedIds]);
            }
        };

        window.addEventListener("keydown", handleDeleteKey, true);
        return () => window.removeEventListener("keydown", handleDeleteKey, true);
    }, [isOpen, onDelete, pendingDelete, selectedIds, viewMode, confirmRecordDeletes]);

    const deleteInstruments = async (ids) => {
        // NOTE: insert password verification here when that feature lands.
        for (const id of ids) {
            // eslint-disable-next-line no-await-in-loop
            await onDelete?.(id);
        }
        setSelectedIds((prev) => prev.filter((x) => !ids.includes(x)));
        setPendingDelete(null);
    };
    const confirmDelete = () => deleteInstruments(pendingDelete?.ids || []);

    const requestSync = (instrument) => {
        if (!instrument) return;
        const state = computeSyncState(instrument);
        const label = `${instrument.manufacturer || ""} ${instrument.model || ""}`.trim() ||
            instrument.description ||
            "this instrument";
        if (state === "green") {
            setSyncNotice({
                title: "Already Synced",
                message: `${label} already matches the shared library snapshot.`,
            });
            return;
        }
        setPendingSync({ instrument, label });
    };

    const confirmSync = async () => {
        if (!pendingSync?.instrument || submitting.current) return;
        submitting.current = true;
        const result = await syncToShared(pendingSync.instrument);
        submitting.current = false;
        if (result.ok && result.instrument) {
            const synced = instrumentForRole(result.instrument, effectiveMode);
            setSelectedIds([synced.id]);
            setSelectionAnchor(synced.id);
            setLibraryInstrumentId(synced.id);
            setInstrumentDef((prev) => {
                const prevSourceId = prev.sourceId || prev.libraryInstrumentId || prev.id;
                const pendingSourceId =
                    pendingSync.instrument.sourceId ||
                    pendingSync.instrument.libraryInstrumentId ||
                    pendingSync.instrument.id;
                if (
                    String(prev.id) === String(pendingSync.instrument.id) ||
                    String(prevSourceId) === String(pendingSourceId) ||
                    String(prevSourceId) === String(synced.id)
                ) {
                    return {
                        ...synced,
                        measurementArea:
                            prev.measurementArea || synced.measurementArea || "",
                        measurementAreaColor:
                            prev.measurementAreaColor ||
                            synced.measurementAreaColor ||
                            "",
                    };
                }
                return prev;
            });
            setInitialInstrumentSignature(
                JSON.stringify(getComparableLibraryInstrument(synced)),
            );
            setPendingSync(null);
            setSyncNotice({
                title: "Submitted for validation",
                message: `${pendingSync.label} is available to you while an SME reviews it.`,
            });
            return;
        }
        setPendingSync(null);
        setSyncNotice({
            title: "Could not submit instrument for validation",
            message: result.message,
            copyable: true,
        });
    };

    const handleBulkUseAs = (useAs) => {
        const chosen = instruments.filter((i) => selectedIds.includes(i.id));
        if (!chosen.length) return;
        onBatchAdd?.(chosen, useAs);
        onClose();
    };

    const handleEditLibraryItem = (inst) => {
        const newDef = JSON.parse(JSON.stringify(instrumentForRole(inst, effectiveMode)));
        const autoName = `${inst.manufacturer || ''} ${inst.model || ''}`.trim();
        setInitialInstrumentName(effectiveMode !== 'library' && autoName ? autoName : inst.description || "");
        
        // --- FIX: Fully populate MetaData from Library Item ---
        setMetaData({
            name: inst.description || "", // Populate description for library edit
            measurementArea: inst.measurementArea || DEFAULT_MEASUREMENT_AREA_NAME, // Restore saved area
            measurementAreaColor: inst.measurementAreaColor || DEFAULT_MEASUREMENT_AREA_COLOR, // Restore saved color
            quantity: 1, 
            assetId: ""
        });

        if (effectiveMode !== 'library') {
            newDef.libraryInstrumentId = inst.id;
            setLibraryInstrumentId(inst.id);
            if (autoName) {
                // If creating UUT/TMDE, default name to Manufacturer + Model
                setMetaData(prev => ({ ...prev, name: autoName }));
            }
        }
        
        setInitialInstrumentSignature(
            JSON.stringify(getComparableLibraryInstrument(newDef))
        );
        setInstrumentDef(newDef);
        if (newDef.functions?.length > 0) setActiveFunctionId(newDef.functions[0].id);
        else setActiveFunctionId(null);
        setActiveTypeBId(newDef.typeBComponents?.[0]?.id || null);
        setViewMode("edit");
    };

    const handleCreateNew = () => {
        const newInstrument = {
            id: uuidv4(),
            manufacturer: "",
            model: "",
            description: "",
            scope: "session",
            functions: [],
            typeBComponents: []
        };
        setInstrumentDef(newInstrument);
        setLibraryInstrumentId(null);
        setInitialInstrumentName("");
        setInitialInstrumentSignature(
            JSON.stringify(getComparableLibraryInstrument(newInstrument))
        );
        setMetaData(prev => ({
            ...prev,
            name: "",
            measurementArea: DEFAULT_MEASUREMENT_AREA_NAME,
            measurementAreaId: "",
            measurementAreaColor: DEFAULT_MEASUREMENT_AREA_COLOR
        }));
        setActiveFunctionId(null);
        setActiveTypeBId(null);
        setValidationNotice(false);
        setViewMode("edit");
    };

    const handleMetaChange = (field, value) => {
        setMetaData(prev => ({ ...prev, [field]: value }));
    };

    // The Description/Name shown for an instrument is the live composition of its
    // three identity sub-fields — Mfr. (manufacturer), Model, and Name (the free
    // name/label stored as `description`) — exactly like the inline instrument
    // tables.
    const composedDescription = [
        instrumentDef.manufacturer,
        instrumentDef.model,
        metaData.name,
    ]
        .map((part) => (part || "").trim())
        .filter(Boolean)
        .join(" ");

    const updateTypeBComponents = (next) => {
        const normalized = Array.isArray(next) ? next : [];
        setInstrumentDef(prev => ({ ...prev, typeBComponents: normalized }));
        setActiveTypeBId(current =>
            normalized.some(component => component.id === current)
                ? current
                : normalized[0]?.id || null
        );
    };

    const typeBReferenceUnit =
        activeFunction?.unit || instrumentDef.functions?.[0]?.unit || "";

    const handleAddTypeBComponent = (kind) => {
        const component = createInstrumentBudgetComponent(kind, typeBReferenceUnit);
        setActiveTypeBId(component.id);
        setInstrumentDef(prev => ({
            ...prev,
            typeBComponents: [
                ...(Array.isArray(prev.typeBComponents) ? prev.typeBComponents : []),
                component,
            ],
        }));
    };

    const handleDeleteActiveTypeBComponent = () => {
        const targetId =
            activeTypeBId && typeBComponents.some(component => component.id === activeTypeBId)
                ? activeTypeBId
                : typeBComponents[typeBComponents.length - 1]?.id;
        if (!targetId) return;
        updateTypeBComponents(typeBComponents.filter(component => component.id !== targetId));
    };

    const handleAddFunction = () => {
        const defaultUnit = "V";
        const newFunc = {
            id: uuidv4(),
            name: (() => {
                const names = new Set(instrumentDef.functions.map(fn => fn.name?.toLowerCase()));
                let name = "New Function", index = 2;
                while (names.has(name.toLowerCase())) name = `New Function ${index++}`;
                return name;
            })(),
            unit: defaultUnit,
            units: [defaultUnit],
            ranges: [createUnboundedBuilderRange(defaultUnit)],
        };
        setInstrumentDef(prev => ({ ...prev, functions: [...prev.functions, newFunc] }));
        setActiveFunctionId(newFunc.id);
    };

    const updateActiveFunction = (key, value) => {
        setInstrumentDef(prev => ({
            ...prev,
            functions: prev.functions.map(f => f.id === activeFunctionId ? { ...f, [key]: value } : f)
        }));
    };

    const updateFunctionById = (functionId, patch) => {
        setInstrumentDef(prev => ({
            ...prev,
            functions: (prev.functions || []).map(fn =>
                fn.id !== functionId
                    ? fn
                    : {
                        ...fn,
                        ...patch,
                        ...(patch.unit !== undefined ? { ranges: (fn.ranges || []).map(range =>
                            !range.isSingleValue && !String(range.min ?? "").trim() && !String(range.max ?? "").trim()
                              && (!range.unit || range.unit === fn.unit) && !Object.keys(range.tolerances || {}).length
                              ? { ...range, unit: patch.unit, resolutionUnit: patch.unit } : range) } : {}),
                        ...(patch.unit !== undefined
                            ? {
                                units: Array.from(
                                    new Set([...(fn.units || []), fn.unit, patch.unit].filter(Boolean)),
                                ),
                            }
                            : {}),
                    }
            ),
        }));
    };

    const handleDeleteFunction = (id) => {
        const remaining = (instrumentDef.functions || []).filter(f => f.id !== id);
        setInstrumentDef(prev => ({
            ...prev,
            functions: (prev.functions || []).filter(f => f.id !== id),
        }));
        if (activeFunctionId === id || !remaining.some(f => f.id === activeFunctionId)) {
            setActiveFunctionId(remaining[0]?.id || null);
        }
    };

    const handleDeleteActiveFunction = () => {
        const targetId = activeFunctionId || instrumentDef.functions?.[0]?.id;
        if (targetId) handleDeleteFunction(targetId);
    };

    const handleAddRange = (functionId) => {
        const fn = instrumentDef.functions.find((candidate) => candidate.id === functionId);
        if (!fn) return;
        const newRange = {
            id: uuidv4(),
            min: "",
            max: "",
            unit: fn.unit || "",
            resolution: "",
            resolutionUnit: fn.unit || "",
            resolutionDistribution: RESOLUTION_DIST_DEFAULT,
            tolerances: {},
        };
        setInstrumentDef(prev => ({
            ...prev,
            functions: prev.functions.map(f =>
                f.id === functionId
                    ? {
                        ...f,
                        units: Array.from(new Set([...(f.units || []), f.unit, newRange.unit].filter(Boolean))),
                        ranges: [...(f.ranges || []), newRange],
                    }
                    : f
            )
        }));
    };

    const updateRangePatch = (functionId, rangeId, patch) => {
        setInstrumentDef(prev => ({
            ...prev,
            functions: prev.functions.map(f => {
                if (f.id !== functionId) return f;
                return {
                    ...f,
                    ...(patch.unit !== undefined
                        ? {
                            units: Array.from(
                                new Set([...(f.units || []), f.unit, patch.unit].filter(Boolean)),
                            ),
                        }
                        : {}),
                    ranges: (f.ranges || []).map(r =>
                        r.id === rangeId ? patchInstrumentRange(r, patch) : r
                    ),
                };
            })
        }));
    };

    const updateRangeTolerance = (functionId, rangeId, updater) => {
        setInstrumentDef(prev => {
            let functionChanged = false;
            const functions = prev.functions.map(f => {
                if (f.id !== functionId) return f;
                let rangeChanged = false;
                const ranges = (f.ranges || []).map(r => {
                    if (r.id !== rangeId) return r;
                    const currentTolerance = r.tolerances || {};
                    const nextTolerance =
                        typeof updater === "function"
                            ? updater(currentTolerance)
                            : updater;
                    const normalizedTolerance = nextTolerance || {};
                    if (normalizedTolerance === currentTolerance) return r;
                    rangeChanged = true;
                    return { ...r, tolerances: normalizedTolerance };
                });
                if (!rangeChanged) return f;
                functionChanged = true;
                return {
                    ...f,
                    ranges,
                };
            });
            return functionChanged ? { ...prev, functions } : prev;
        });
    };

    const updateRangeBandDistribution = (functionId, rangeId, value) => {
        updateRangeTolerance(functionId, rangeId, (prev) =>
            applyBandDistribution(prev || {}, value),
        );
    };

    const handleDeleteRange = (functionId, rangeId) => {
        setInstrumentDef(prev => ({
            ...prev,
            functions: prev.functions.map(f => {
                if (f.id !== functionId) return f;
                const remaining = (f.ranges || []).filter(r => r.id !== rangeId);
                return {
                    ...f,
                    ranges: remaining.length > 0
                        ? remaining
                        : [createUnboundedBuilderRange(f.unit || f.units?.[0] || "")],
                };
            })
        }));
    };

    const buildSaveData = (savedLibraryId = libraryInstrumentId, submitted = null) => {
        let finalData = {};
        if (effectiveMode === 'uut' || effectiveMode === 'tmde') {
            const linked = !hasLibraryChanges && linkedLibraryInstrument;
            const unchangedShared = !sharedSessionEdit && ["validated", "shared"].includes(instrumentDef.scope);
            const scope = submitted?.scope || (unchangedShared ? instrumentDef.scope : linked ? linked.scope || "local" : "session");
            const sessionInstrument = {
                ...withInstrumentEditorDrafts(instrumentDef),
                ...submitted,
                scope,
                ...(savedLibraryId
                    ? {
                        libraryInstrumentId: savedLibraryId,
                        sourceId: submitted?.sourceId || instrumentDef.sourceId || savedLibraryId,
                    }
                    : {}),
                localOverride: !["validated", "shared"].includes(scope),
            };
            finalData = {
                id: initialData?.id || uuidv4(),
                description: metaData.name, 
                name: metaData.name,
                measurementArea: metaData.measurementArea,
                measurementAreaId: metaData.measurementAreaId,
                measurementAreaColor: metaData.measurementAreaColor,
                instrument: sessionInstrument,
                ...(savedLibraryId ? { libraryInstrumentId: savedLibraryId } : {}),
                type: effectiveMode
            };
            if (sharedSessionEdit && !submitted) {
                // Ordinary edits stay in this session. Give the definition its
                // own identity so future library saves cannot rewrite it.
                finalData = localizeSharedInstrumentEdit({ ...finalData, instrument: {
                    ...sessionInstrument, description: metaData.name,
                    scope: instrumentDef.scope || linkedLibraryInstrument.scope,
                    validatedSnapshot: instrumentDef.validatedSnapshot || buildValidatedSnapshot(
                        linkedLibraryInstrument || initialData?.instrument || instrumentDef),
                } }, instruments);
            }
        } else {
            // Library-mode editing is always local. Editing a shared definition
            // creates a linked local copy and leaves the canonical shared record
            // untouched; the explicit Sync action remains the only path that can
            // write changes back to the shared library.
            const editingSharedInstrument = instrumentDef.scope === "validated";
            const sharedSourceId =
                instrumentDef.sourceId ||
                instrumentDef.libraryInstrumentId ||
                (editingSharedInstrument ? instrumentDef.id : null);
            finalData = {
                ...withInstrumentEditorDrafts(instrumentDef),
                id: editingSharedInstrument ? uuidv4() : instrumentDef.id,
                description: metaData.name,
                measurementArea: metaData.measurementArea, 
                measurementAreaColor: metaData.measurementAreaColor,
                type: 'library',
                scope: "local",
                ...(sharedSourceId ? { sourceId: sharedSourceId } : {}),
                ...(editingSharedInstrument
                    ? {
                        validatedSnapshot:
                            instrumentDef.validatedSnapshot ||
                            buildValidatedSnapshot(linkedLibraryInstrument || instrumentDef),
                    }
                    : {}),
                localOverride: true,
            };
        }

        return finalData;
    };

    const completeSave = () => {
        const savedLibraryId =
            libraryInstrumentId || linkedLibraryInstrument?.id || null;
        const finalData = buildSaveData(savedLibraryId);
        console.log("[UniversalInstrumentModal] Saving Data:", finalData);
        clearEditorDraft(builderDraftKey);
        onSave(finalData);

        setLibraryInstrumentId(savedLibraryId);
        setPendingInstrumentSave(false);
        onClose();
    };

    const completeLibrarySave = async () => {
        if (submitting.current) return;
        submitting.current = true;
        setSubmissionError("");
        const linked = linkedLibraryInstrument;
        const result = await syncToShared({
            ...withInstrumentEditorDrafts(instrumentDef),
            id: linked?.id || instrumentDef.id,
            scope: linked?.scope || instrumentDef.scope || "local",
            sourceId: linked?.sourceId || instrumentDef.sourceId,
            description: metaData.name || instrumentDef.description,
            measurementArea: metaData.measurementArea,
            measurementAreaColor: metaData.measurementAreaColor,
        });
        submitting.current = false;
        if (!result.ok) {
            setSubmissionError(result.message);
            return;
        }
        const submitted = result.instrument;
        clearEditorDraft(builderDraftKey);
        setPendingInstrumentSave(false);
        setLibraryInstrumentId(submitted.id);
        onSave(buildSaveData(submitted.id, submitted));
        showToast?.("Instrument submitted for SME validation.", "success");
        onClose();
    };

    const handleSave = () => {
        if (!isFormValid) {
            setValidationNotice(true);
            return;
        }

        if (
            (effectiveMode === 'uut' || effectiveMode === 'tmde') &&
            onSaveToLibrary &&
            isInstrumentInLibrary &&
            hasLibraryChanges && !sharedSessionEdit
        ) {
            setSubmissionError("");
            setPendingInstrumentSave(true);
            return;
        }

        completeSave();
    };

    if (!isOpen) return null;

    return ReactDOM.createPortal(
        <div
            className="modal-content floating-window-content instrument-builder-wrapper"
            style={{
                position: 'fixed',
                top: position.y,
                left: position.x,
                margin: 0,
                width: '1100px',
                maxWidth: '95vw',
                height: '85vh',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 2100,
                overflow: 'hidden'
            }}
        >
            {/* --- Header --- */}
            <div
                className="modal-header"
                onMouseDown={handleMouseDown}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <FontAwesomeIcon icon={modeIcon} style={{ color: 'var(--primary-color)' }} />
                        {viewMode === 'list' ? "Select Instrument from Library" : modalTitle}
                    </h3>
                </div>
                <SymbolButton onClick={onClose} className="modal-close-button" />
            </div>

            {/* --- Body --- */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                
                {/* --- VIEW: LIST --- */}
                {viewMode === "list" && (
                    <div className="list-view-container">
                         <div className="search-toolbar">
                            <div className="search-input-wrapper">
                                <FontAwesomeIcon icon={faSearch} className="search-icon" />
                                <input
                                    type="text"
                                    aria-label="Search instruments"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    autoFocus
                                />
                            </div>
                            <select aria-label="Filter instrument source" value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}>
                                <option value="all">All sources</option><option value="local">Local</option><option value="shared">Shared</option>
                            </select>
                            <select aria-label="Sort instruments" value={sortField} onChange={event => setSortField(event.target.value)}>
                                <option value="manufacturer">Manufacturer</option><option value="model">Model</option><option value="description">Description</option>
                            </select>
                            <button className="lib-pill-btn" aria-label="Reverse instrument sort" onClick={() => setSortDirection(value => value === "asc" ? "desc" : "asc")}>{sortDirection === "asc" ? "Ascending" : "Descending"}</button>
                            <SymbolButton add className="icon-btn-ghost" onClick={handleCreateNew} title="Create Instrument" />
                        </div>

                        <div className="list-content">
                            <table className="library-table library-table--selectable">
                                <thead>
                                    <tr>
                                        <th style={{ width: '20%' }}>Manufacturer</th>
                                        <th style={{ width: '18%' }}>Model</th>
                                        <th style={{ width: '30%' }}>Description</th>
                                        <th style={{ width: '12%' }}>Source</th>
                                        <th style={{ width: '20%' }}>Functions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredInstruments.map(inst => <LibraryInstrumentRow key={inst.id}
                                        draft={libraryDrafts[inst.id] || null}
                                        setDraft={update => setLibraryDrafts(previous => ({ ...previous, [inst.id]: typeof update === "function" ? update(previous[inst.id]) : update }))}
                                        instrument={inst} selected={selectedIds.includes(inst.id)}
                                        onSelect={event => handleRowSelect(event, inst.id)} onEdit={handleEditLibraryItem}
                                        onSave={onSaveToLibrary}
                                        sourceBadge={<InstrumentSourceBadge instrument={inst} linkedInstrument={linkedSharedFor(inst)} />} />)}
                                    {!filteredInstruments.length && <tr><td colSpan="5">No instruments match your search or filter.</td></tr>}
                                </tbody>
                            </table>
                        </div>

                        {/* Selection action bar — appears once rows are checked. */}
                        {selectedIds.length > 0 && (
                            <div className="library-selection-bar">
                                <div className="library-selection-info">
                                    <span className="library-selection-count">
                                        {selectedIds.length}
                                    </span>
                                    <span className="library-selection-label">
                                        instrument{selectedIds.length > 1 ? 's' : ''} selected
                                    </span>
                                    <button
                                        className="library-selection-clear"
                                        onClick={() => { setSelectedIds([]); setSelectionAnchor(null); }}
                                    >
                                        Clear
                                    </button>
                                </div>
                                <div className="library-selection-actions">
                                    {onDelete && (
                                        <button
                                            className="lib-icon-btn lib-icon-btn--danger"
                                            title={`Delete ${selectedIds.length} from library`}
                                            onClick={() => requestDelete(selectedIds)}
                                        >
                                            <FontAwesomeIcon icon={faTrashAlt} />
                                        </button>
                                    )}
                                    <button
                                        className="lib-pill-btn"
                                        disabled={!selectedInstrument || selectedInstrument.scope === "pending"}
                                        title={
                                            selectedInstrument
                                                ? (selectedInstrument.scope === "pending" ? "Awaiting SME validation" : "Submit selected instrument for SME validation")
                                                : "Select one instrument to sync"
                                        }
                                        onClick={() => requestSync(selectedInstrument)}
                                    >
                                        <FontAwesomeIcon icon={faSyncAlt} /> Sync
                                    </button>
                                    {/* Library manager: choose how to bring the selection into the session. */}
                                    {mode === 'library' ? (
                                        <>
                                            <button
                                                className="lib-pill-btn"
                                                onClick={() => handleBulkUseAs('uut')}
                                            >
                                                <FontAwesomeIcon icon={faMicroscope} /> Use as UUT
                                            </button>
                                            <button
                                                className="lib-pill-btn"
                                                onClick={() => handleBulkUseAs('tmde')}
                                            >
                                                <FontAwesomeIcon icon={faTools} /> Use as TMDE
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            className="lib-pill-btn"
                                            onClick={() => handleBulkUseAs(effectiveMode)}
                                        >
                                            <FontAwesomeIcon icon={faPlus} /> Add {selectedIds.length}{' '}
                                            {effectiveMode === 'uut' ? 'UUT' : 'TMDE'}
                                            {selectedIds.length > 1 ? 's' : ''}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* --- VIEW: EDIT (BUILDER) --- */}
                {viewMode === "edit" && (
                    <div className="instrument-edit-layout">
                        {/* Top: Identity Card */}
                        <div className="identity-container">
                            <div className="identity-header">
                                <div className="identity-title">
                                    <span>Identification</span>
                                    <InstrumentSourceBadge
                                        instrument={sourceBadgeInstrument}
                                        linkedInstrument={linkedLibraryInstrument}
                                    />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <button className="icon-btn-ghost" onClick={() => setViewMode('list')} title="Import from Library">
                                        <FontAwesomeIcon icon={faBookOpen} />
                                    </button>
                                </div>
                            </div>
                            
                            {/* Identity mirrors the inline instrument tables: three
                                sub-fields — Mfr. / Model / Name — that snap together
                                into the Description/Name shown below. */}
                            <div className="identity-grid identity-grid-triple">
                                <div className="floating-input-group">
                                    <input
                                        type="text"
                                        value={instrumentDef.manufacturer}
                                        onChange={e => setInstrumentDef({ ...instrumentDef, manufacturer: e.target.value })}
                                        placeholder=" "
                                    />
                                    <label>Mfr.</label>
                                    <FontAwesomeIcon icon={faIndustry} className="input-icon" />
                                </div>

                                <div className="floating-input-group">
                                    <input
                                        type="text"
                                        value={instrumentDef.model}
                                        onChange={e => setInstrumentDef({ ...instrumentDef, model: e.target.value })}
                                        placeholder=" "
                                    />
                                    <label>Model</label>
                                    <FontAwesomeIcon icon={faTag} className="input-icon" />
                                </div>

                                <div className="floating-input-group">
                                    <input
                                        type="text"
                                        value={metaData.name}
                                        onChange={e => handleMetaChange('name', e.target.value)}
                                        placeholder=" "
                                    />
                                    <label>Name</label>
                                    <FontAwesomeIcon icon={faFingerprint} className="input-icon" />
                                </div>
                            </div>

                            <div className="identity-composed">
                                <span className="identity-composed-label">Description / Name</span>
                                <span
                                    className={`identity-composed-value${composedDescription ? "" : " is-empty"}`}
                                >
                                    {composedDescription || "Mfr. · Model · Name"}
                                </span>
                            </div>
                        </div>

                        <div className="instrument-spec-sheet">
                            <div className="spec-sheet-toolbar">
                                <h5>
                                    <FontAwesomeIcon icon={faCube} /> Functions and specifications
                                </h5>
                                <div className="spec-toolbar-actions">
                                    <button className="lib-pill-btn" onClick={handleAddFunction} title="Add Function">
                                        <FontAwesomeIcon icon={faPlus} /> Add Function
                                    </button>
                                    <SymbolButton
                                        className="builder-x-action builder-toolbar-delete"
                                        onClick={handleDeleteActiveFunction}
                                        title="Delete selected function"
                                        aria-label="Delete selected function"
                                        disabled={(instrumentDef.functions || []).length === 0}
                                     />
                                </div>
                            </div>

                            <div className="spec-sheet-scroll">
                                {(instrumentDef.functions || []).length === 0 && (
                                    <div className="builder-empty-state">
                                        <FontAwesomeIcon icon={faCube} />
                                        <span>No functions yet.</span>
                                    </div>
                                )}

                                {(instrumentDef.functions || []).map((fn) => {
                                    const unitOptions = getCategorizedUnitOptions(allUnitsRaw, fn.unit);
                                    const ranges = Array.isArray(fn.ranges) ? fn.ranges : [];
                                    return (
                                        <section
                                            className={`function-spec-section${activeFunctionId === fn.id ? " is-active" : ""}`}
                                            key={fn.id}
                                            onMouseDown={() => setActiveFunctionId(fn.id)}
                                            onFocusCapture={() => setActiveFunctionId(fn.id)}
                                        >
                                            <div className="function-spec-header">
                                                <div className="function-name-control">
                                                    <FontAwesomeIcon icon={faCube} />
                                                    <input
                                                        type="text"
                                                        value={fn.name || ""}
                                                        onChange={(e) => updateFunctionById(fn.id, { name: e.target.value })}
                                                        aria-label="Function name"
                                                    />
                                                </div>
                                                <div className="function-unit-control">
                                                    <BuilderUnitSelect
                                                        value={fn.unit || ""}
                                                        onChange={(unit) => updateFunctionById(fn.id, { unit })}
                                                        options={unitOptions}
                                                        ariaLabel={`${fn.name || "Function"} unit`}
                                                        width="9ch"
                                                    />
                                                </div>
                                                <SymbolButton add
                                                    className="icon-btn-ghost"
                                                    onClick={() => handleAddRange(fn.id)}
                                                    title={`Add range to ${fn.name || "function"}`}
                                                    aria-label={`Add range to ${fn.name || "function"}`}
                                                 />
                                            </div>

                                            <div className="ranges-table-container builder-ranges-table-container">
                                                <table className="ranges-table builder-spec-table">
                                                    <thead>
                                                        <tr>
                                                            <th style={{ width: "22%" }}>Range</th>
                                                            <th style={{ width: "36%" }}>Tolerance</th>
                                                            <th style={{ width: "15%" }}>Distribution</th>
                                                            <th style={{ width: "21%" }}>Resolution</th>
                                                            <th style={{ width: "40px" }}></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {ranges.map((range) => (
                                                            <BuilderSpecificationRow key={range.id}
                                                                range={range} fn={fn}
                                                                onPatch={(patch) => updateRangePatch(fn.id, range.id, patch)}
                                                                onToleranceCommit={(typeKey, component) => updateRangeTolerance(fn.id, range.id,
                                                                    (prev) => applySharedToleranceCaseChange(prev, typeKey, component))}
                                                                distribution={getBandDistribution(range.tolerances)}
                                                                onDistributionChange={(value) => updateRangeBandDistribution(fn.id, range.id, value)}
                                                                onDelete={() => handleDeleteRange(fn.id, range.id)}
                                                            />
                                                        ))}
                                                        {ranges.length === 0 && (
                                                            <tr>
                                                                <td colSpan="5" className="builder-empty-range-cell">
                                                                    <button
                                                                        className="lib-pill-btn"
                                                                        onClick={() => handleAddRange(fn.id)}
                                                                    >
                                                                        <FontAwesomeIcon icon={faPlus} /> Add Range
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </section>
                                    );
                                })}

                                <section className="typeb-spec-section">
                                    <div className="spec-sheet-toolbar typeb-spec-toolbar">
                                        <h5>
                                            Type B Uncertainties
                                        </h5>
                                        <div className="spec-toolbar-actions">
                                            <TypeBAddMenu onAdd={handleAddTypeBComponent} />
                                            <SymbolButton
                                                className="builder-x-action builder-toolbar-delete"
                                                onClick={handleDeleteActiveTypeBComponent}
                                                title="Delete selected Type B"
                                                aria-label="Delete selected Type B"
                                                disabled={typeBComponents.length === 0}
                                             />
                                        </div>
                                    </div>
                                    <div className="typeb-section-body">
                                        <TypeBComponentsEditor
                                            components={typeBComponents}
                                            onChange={updateTypeBComponents}
                                            referenceUnit={typeBReferenceUnit}
                                            showIntro={false}
                                            showAddButton={false}
                                            showInlineRemove={false}
                                            activeId={activeTypeBId}
                                            onActivate={setActiveTypeBId}
                                            functions={instrumentDef.functions || []}
                                            activeFunctionId={activeFunctionId || ""}
                                        />
                                    </div>
                                </section>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="editor-actions">
                            <button 
                                className="icon-btn-ghost editor-save-button"
                                onClick={handleSave} 
                                title="Save Configuration"
                                aria-label="Save configuration"
                            >
                                <FontAwesomeIcon icon={faCheck} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Delete confirmation — same warning modal as "Delete Measurement
                Point". Single choke-point: a password gate can wrap confirmDelete
                later without touching the call sites. */}
            <NotificationModal
                isOpen={!!pendingDelete}
                onClose={() => setPendingDelete(null)}
                title={
                    pendingDelete && pendingDelete.ids.length > 1
                        ? "Batch Delete"
                        : "Delete Instrument"
                }
                message={
                    `Delete ${instrumentDeleteTarget(pendingDelete?.ids || [], instruments)} from the library? This affects all sessions.`
                }
                confirmText="Delete"
                isIconConfirm={true}
                onConfirm={confirmDelete}
            />
            <NotificationModal
                isOpen={pendingInstrumentSave}
                onClose={() => setPendingInstrumentSave(false)}
                title={submissionError ? "Could not submit instrument for validation" : "Submit instrument changes"}
                message={submissionError || "Submit the edited instrument for SME validation and use it in this session, or save it only in this session."}
                copyable={Boolean(submissionError)}
                confirmText="Submit for validation"
                onConfirm={completeLibrarySave}
                secondaryText="Session Only"
                onSecondary={completeSave}
                secondaryIsPrimary={true}
            />
            <NotificationModal
                isOpen={!!pendingSync}
                onClose={() => setPendingSync(null)}
                title="Submit instrument"
                message={pendingSync ? `Submit ${pendingSync.label} for SME validation? ${syncDiffSummary(getDiff(pendingSync.instrument))}` : ""}
                confirmText="Submit for validation"
                onConfirm={confirmSync}
            />
            <NotificationModal
                isOpen={!!syncNotice}
                onClose={() => setSyncNotice(null)}
                title={syncNotice?.title}
                message={syncNotice?.message}
                copyable={syncNotice?.copyable}
            />
            <NotificationModal
                isOpen={validationNotice}
                onClose={() => setValidationNotice(false)}
                title="Complete required fields"
                message={`Fill in all required fields before saving: ${missingRequiredFields.join(", ")}.`}
            />
        </div>,
        document.body
    );
};

export default UniversalInstrumentModal;
