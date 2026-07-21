import React, { useMemo } from "react";
import {
  DISTRIBUTION_NOT_SET,
  errorDistributions,
} from "../../../utils/uncertaintyMath";
import {
  InlineToleranceCell,
  applyToleranceCaseChange,
} from "../../analysis/components/UncertaintyPanel";

const TOLERANCE_KEYS = ["reading", "range", "floor", "db", "singleSided"];

const hasNumericValue = (component = {}) =>
  [component.value, component.high, component.low, component.limit].some(
    (value) => value !== undefined && value !== null && String(value).trim() !== "",
  );

/**
 * Convert the pre-inline Type B shape into the canonical tolerance object used
 * by the inline tables and the universal instrument builder.
 */
export const typeBToTolerance = (component = {}, referencePoint = {}) => {
  if (
    component.tolerance &&
    typeof component.tolerance === "object" &&
    Object.keys(component.tolerance).length > 0
  ) {
    return component.tolerance;
  }
  if (component.inputMode === "standard") return {};

  const raw = String(component.toleranceLimit ?? "").trim();
  if (!raw) return {};
  const magnitude = Math.abs(Number(raw));
  if (!Number.isFinite(magnitude) || magnitude <= 0) return {};

  const unit = component.unit || referencePoint.unit || "%";
  return {
    floor: {
      high: String(magnitude),
      low: String(-magnitude),
      unit,
      distribution: component.distribution || DISTRIBUTION_NOT_SET,
      symmetric: true,
    },
  };
};

const firstToleranceTerm = (tolerance = {}) =>
  TOLERANCE_KEYS.map((key) => ({ key, value: tolerance[key] })).find(
    ({ value }) => value && typeof value === "object" && hasNumericValue(value),
  ) || null;

/**
 * Keep the legacy scalar fields populated while the richer tolerance object is
 * authored. Older saved instruments and budget rows can therefore continue to
 * resolve while new records use the canonical inline tolerance format.
 */
export const toleranceToTypeB = (component = {}, tolerance = {}) => {
  const first = firstToleranceTerm(tolerance);
  if (!first) {
    const distribution = TOLERANCE_KEYS.map(
      (key) => tolerance?.[key]?.distribution,
    ).find(Boolean);
    return {
      ...component,
      tolerance,
      toleranceLimit: "",
      distribution: distribution || component.distribution || DISTRIBUTION_NOT_SET,
      standardUncertainty: component.inputMode === "standard" ? component.standardUncertainty : "",
    };
  }

  const term = first.value;
  const raw = term.value ?? term.limit ?? term.high ?? term.low ?? "";
  const numeric = Number(raw);
  const magnitude = Number.isFinite(numeric) ? Math.abs(numeric) : raw;
  return {
    ...component,
    tolerance,
    inputMode: "tolerance",
    toleranceLimit: magnitude === "" ? "" : String(magnitude),
    standardUncertainty: "",
    unit: term.unit || component.unit || "",
    distribution: term.distribution || component.distribution || DISTRIBUTION_NOT_SET,
  };
};

export const getTypeBDistributionValue = (component = {}, tolerance = {}) => {
  const distributionKey = TOLERANCE_KEYS.find(
    (key) => tolerance?.[key] && typeof tolerance[key] === "object",
  );
  return (
    (distributionKey && tolerance[distributionKey]?.distribution) ||
    component.distribution ||
    DISTRIBUTION_NOT_SET
  );
};

export const applyTypeBDistribution = (
  component = {},
  tolerance = {},
  referencePoint = {},
  distribution,
) => {
  const distributionKey = TOLERANCE_KEYS.find(
    (key) => tolerance?.[key] && typeof tolerance[key] === "object",
  );
  const key = distributionKey || "floor";
  const existing = tolerance[key] || {
    high: "",
    low: "",
    unit: component.unit || referencePoint.unit || "",
    symmetric: true,
  };
  return toleranceToTypeB(component, {
    ...tolerance,
    [key]: { ...existing, distribution },
  });
};

export const TypeBDistributionSelect = ({
  component,
  referencePoint = {},
  tolerance: suppliedTolerance,
  onChange,
}) => {
  const tolerance = useMemo(
    () => suppliedTolerance || typeBToTolerance(component, referencePoint),
    [component, referencePoint, suppliedTolerance],
  );
  const distributionValue = getTypeBDistributionValue(component, tolerance);

  return (
    <select
      aria-label="Spec distribution"
      value={String(distributionValue)}
      onChange={(event) =>
        onChange(
          applyTypeBDistribution(
            component,
            tolerance,
            referencePoint,
            event.target.value,
          ),
        )
      }
    >
      {errorDistributions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

const TypeBToleranceEditor = ({
  component,
  referencePoint = {},
  onChange,
  showDistribution = true,
}) => {
  const tolerance = useMemo(
    () => typeBToTolerance(component, referencePoint),
    [component, referencePoint],
  );
  const commitTolerance = (typeKey, nextComponent) => {
    const nextTolerance = applyToleranceCaseChange(
      tolerance,
      typeKey,
      nextComponent,
    );
    onChange(toleranceToTypeB(component, nextTolerance || {}));
  };

  return (
    <div
      className={`typeb-tolerance-editor${
        showDistribution ? "" : " typeb-tolerance-editor--single"
      }`}
    >
      <div className="typeb-tolerance-main">
        <InlineToleranceCell
          tolerance={tolerance}
          activeRange={{
            id: component.id,
            max: referencePoint.value,
            unit: referencePoint.unit || component.unit || "",
          }}
          editable
          onCommit={commitTolerance}
        />
      </div>
      {showDistribution && (
        <label className="typeb-tolerance-distribution">
          <span className="typeb-tolerance-distribution-label">Distribution</span>
          <TypeBDistributionSelect
            component={component}
            referencePoint={referencePoint}
            tolerance={tolerance}
            onChange={onChange}
          />
        </label>
      )}
    </div>
  );
};

export default TypeBToleranceEditor;
