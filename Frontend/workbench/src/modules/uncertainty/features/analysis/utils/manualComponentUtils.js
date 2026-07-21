import {
  calculateUncertaintyFromToleranceObject,
  convertToPPM,
  convertPpmToUnit,
  distributionDivisorValue,
  getUnitDisplayLabel,
} from "../../../utils/uncertaintyMath";
import { oldErrorDistributions } from "./budgetUtils";

const RELATIVE_UNITS = new Set(["%", "ppm", "ppb"]);

const positiveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const distributionLabel = (divisor) =>
  oldErrorDistributions.find(
    (item) => Number(item.value) === Number(divisor),
  )?.label || `k=${divisor}`;

const TOLERANCE_TERM_KEYS = [
  "reading",
  "range",
  "floor",
  "db",
  "singleSided",
];

const toleranceHasMagnitude = (tolerance = {}) =>
  TOLERANCE_TERM_KEYS.some((key) => {
    const term = tolerance?.[key];
    return [term?.value, term?.high, term?.low, term?.limit].some(
      (value) =>
        value !== undefined &&
        value !== null &&
        String(value).trim() !== "" &&
        Number.isFinite(Number(value)),
    );
  });

const toleranceDistributionLabel = (breakdown = [], tolerance = {}) => {
  const labels = Array.from(
    new Set(breakdown.map((item) => item?.distributionLabel).filter(Boolean)),
  );
  if (labels.length === 1) return labels[0];
  if (labels.length > 1) return "Mixed tolerance distributions";

  const authoredDivisors = TOLERANCE_TERM_KEYS.map(
    (key) => tolerance?.[key]?.distribution,
  ).filter(Boolean);
  const authoredLabels = Array.from(
    new Set(
      authoredDivisors.map((divisor) =>
        divisor === "not_set" ? "Not Set" : distributionLabel(divisor),
      ),
    ),
  );
  if (authoredLabels.length === 1) return authoredLabels[0];
  if (authoredLabels.length > 1) return "Mixed tolerance distributions";
  return "Not Set";
};

const nativeStandardUncertainty = ({ ppm, raw, divisor, unit, referencePoint }) => {
  if (!RELATIVE_UNITS.has(unit)) {
    return {
      value: raw / divisor,
      unit,
    };
  }

  const nominal = Number(referencePoint?.value);
  if (!Number.isFinite(nominal) || !referencePoint?.unit) {
    return {
      value: 0,
      unit: referencePoint?.unit || unit,
    };
  }

  return {
    value: (ppm / 1e6) * Math.abs(nominal),
    unit: referencePoint.unit,
  };
};

export const createInlineManualComponent = ({
  id,
  scope = null,
  referencePoint = null,
}) => {
  const nominalPoint = scope?.nominalPoint || referencePoint || {};
  const unit = nominalPoint.unit || "ppm";
  const variableType =
    scope?.kind === "input" && scope.variableType
      ? scope.variableType
      : undefined;

  return {
    id,
    name: "",
    type: "B",
    value: 0,
    value_native: 0,
    unit_native: nominalPoint.unit || unit,
    dof: Infinity,
    distribution: distributionLabel("1.732"),
    distributionDivisor: "1.732",
    isCore: false,
    isManual: true,
    isInlineManual: true,
    inlineDraft: true,
    manualInputMode: "tolerance",
    manualRawValue: "",
    manualUnit: unit,
    ...(variableType
      ? {
          variableType,
          sourcePointLabel: `${scope.label || variableType} - Manual`,
        }
      : { sourcePointLabel: "Manual" }),
    originalInput: {
      inputMode: "tolerance",
      toleranceLimit: "",
      tolerance: {},
      standardUncertainty: "",
      errorDistributionDivisor: "1.732",
      unit,
      useFiniteDof: false,
    },
  };
};

const legacyManualTolerance = (component = {}) => {
  const original = component.originalInput || {};
  const magnitude = positiveNumber(
    original.toleranceLimit ??
      (component.manualInputMode === "tolerance" ? component.manualRawValue : null),
  );
  if (magnitude === null) return {};
  const unit = original.unit || component.manualUnit || component.unit_native || "ppm";
  const distribution = String(
    original.errorDistributionDivisor || component.distributionDivisor || "1.732",
  );
  return {
    floor: {
      high: String(magnitude),
      low: String(-magnitude),
      unit,
      distribution,
      symmetric: true,
    },
  };
};

export const getInlineManualDraft = (component = {}) => ({
  name: component.name || "",
  type: component.type || "B",
  inputMode:
    component.type === "A"
      ? "standard"
      : component.originalInput?.inputMode ||
        component.manualInputMode ||
        "tolerance",
  toleranceLimit:
    component.originalInput?.toleranceLimit ??
    (component.manualInputMode === "tolerance" ? component.manualRawValue : "") ??
    "",
  tolerance:
    component.originalInput?.tolerance &&
    Object.keys(component.originalInput.tolerance).length > 0
      ? component.originalInput.tolerance
      : component.tolerance && Object.keys(component.tolerance).length > 0
        ? component.tolerance
        : legacyManualTolerance(component),
  standardUncertainty:
    component.originalInput?.standardUncertainty ??
    (component.manualInputMode === "standard" ? component.manualRawValue : "") ??
    "",
  errorDistributionDivisor: String(
    component.originalInput?.errorDistributionDivisor ||
      component.distributionDivisor ||
      "1.732",
  ),
  unit:
    component.originalInput?.unit ||
    component.manualUnit ||
    component.unit_native ||
    "ppm",
});

export const normalizeInlineManualComponent = ({
  component,
  draft,
  referencePoint,
}) => {
  const type = draft.type === "A" ? "A" : "B";
  const inputMode =
    type === "A" || draft.inputMode === "standard"
      ? "standard"
      : "tolerance";
  const unit = draft.unit || referencePoint?.unit || "ppm";
  const toleranceDivisor =
    positiveNumber(draft.errorDistributionDivisor) !== null
      ? String(draft.errorDistributionDivisor)
      : "1.732";
  const divisor =
    inputMode === "standard"
      ? 1
      : distributionDivisorValue(toleranceDivisor);
  const raw = positiveNumber(
    inputMode === "standard"
      ? draft.standardUncertainty
      : draft.toleranceLimit,
  );

  let value = 0;
  let valueNative = 0;
  let unitNative = referencePoint?.unit || unit;
  let validation = null;
  const tolerance =
    draft.tolerance && typeof draft.tolerance === "object"
      ? draft.tolerance
      : {};
  const usesStructuredTolerance =
    inputMode === "tolerance" && toleranceHasMagnitude(tolerance);
  const structuredResult = usesStructuredTolerance
    ? calculateUncertaintyFromToleranceObject(tolerance, referencePoint, true)
    : null;

  if (usesStructuredTolerance) {
    const calculatedPpm = Number(structuredResult?.standardUncertainty);
    if (Number.isFinite(calculatedPpm) && calculatedPpm > 0) {
      value = calculatedPpm;
      const convertedNative = convertPpmToUnit(
        calculatedPpm,
        referencePoint?.unit,
        referencePoint,
      );
      if (Number.isFinite(Number(convertedNative))) {
        valueNative = Number(convertedNative);
        unitNative = referencePoint?.unit || unit;
      } else {
        validation = String(
          convertedNative || "Unable to resolve the tolerance at this nominal.",
        );
      }
    } else {
      validation = tolerance.singleSided
        ? "A single-sided acceptance limit does not define a Type B standard uncertainty by itself."
        : "Set a distribution for each entered tolerance term and provide a valid nominal value.";
    }
  } else if (raw !== null) {
    const converted = convertToPPM(
      raw,
      unit,
      referencePoint?.value,
      referencePoint?.unit,
      null,
      true,
    );
    if (converted.warning || !Number.isFinite(Number(converted.value))) {
      validation =
        converted.warning ||
        `Unable to convert ${raw} ${getUnitDisplayLabel(unit)} at this nominal.`;
    } else {
      value = Number(converted.value) / divisor;
      const native = nativeStandardUncertainty({
        ppm: value,
        raw,
        divisor,
        unit,
        referencePoint,
      });
      valueNative = native.value;
      unitNative = native.unit;
    }
  }

  const label =
    type === "A"
      ? "Normal"
      : inputMode === "standard"
        ? "Standard uncertainty (k=1)"
        : usesStructuredTolerance
          ? toleranceDistributionLabel(
              structuredResult?.breakdown,
              tolerance,
            )
          : distributionLabel(toleranceDivisor);
  const rawValue = raw === null ? "" : raw;

  return {
    ...component,
    name: String(draft.name || "").trim(),
    type,
    value,
    value_native: valueNative,
    unit_native: unitNative,
    dof: type === "A" ? component.dof ?? Infinity : Infinity,
    distribution: label,
    distributionDivisor:
      inputMode === "standard" ? "1" : toleranceDivisor,
    isCore: false,
    isManual: true,
    isInlineManual: true,
    inlineDraft: false,
    inlineValidation: validation,
    manualInputMode: inputMode,
    manualRawValue: rawValue,
    manualUnit: unit,
    originalInput: {
      ...(component.originalInput || {}),
      inputMode,
      toleranceLimit: draft.toleranceLimit ?? "",
      tolerance,
      standardUncertainty: draft.standardUncertainty ?? "",
      // Preserve the user's last tolerance distribution even while direct
      // standard-uncertainty mode is active, so switching back restores the
      // exact custom-select option (including canonical values like "2.000").
      errorDistributionDivisor: toleranceDivisor,
      unit,
      useFiniteDof: type === "A" && Boolean(component.originalInput?.useFiniteDof),
    },
  };
};
