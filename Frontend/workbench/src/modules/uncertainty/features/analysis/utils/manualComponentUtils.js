import {
  convertToPPM,
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
      standardUncertainty: "",
      errorDistributionDivisor: "1.732",
      unit,
      useFiniteDof: false,
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

  if (raw !== null) {
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
