import { getMitigationDiagnostics } from "./mitigationDiagnostics";
import {
  calculateDerivedUncertainty,
  calculateUncertaintyFromToleranceObject,
  getUnitDisplayLabel,
  resolveResolutionNative,
  snapLimitsToResolution,
  unitSystem,
} from "./uncertaintyMath";
import { getInstrumentRangeRows } from "./instrumentFunctionSelection";
import { assessRangeCompatibility } from "./tmdeCompatibility";
import { formatRangeLabel } from "./rangeFormatting";
import { reconcileTmdeInstances } from "./tmdeReconcile";
import {
  getBudgetComponentsFromTolerance,
  getUutResolutionComponent,
} from "../features/analysis/utils/budgetUtils";
import {
  isUnknownMeasurementTolerance,
  getSingleSidedTolerance,
} from "./risk8/unknownMeasurementRisk8";
import {
  isKnownMeasurementTolerance,
  validateKnownSingleSidedGeometry,
} from "./risk8/knownMeasurementRisk8";

const filled = (v) => v !== "" && v != null && Number.isFinite(Number(v));
const label = (nominal) =>
  `${nominal.value} ${getUnitDisplayLabel(nominal.unit)}`;

export function getBudgetRangeWarnings({
  components = [],
  measurementType = "direct",
  directNominal,
  groups = [],
  tmdes = [],
} = {}) {
  const nominals = new Map(
    groups
      .filter((g) => g.kind === "input")
      .map((g) => [
        String(g.variableType || g.variable || ""),
        g.nominalPoint || { value: g.nominalValue, unit: g.unit },
      ]),
  );
  const warnings = {};
  for (const component of components) {
    if (!component?.isBudgetInstance || !component.tmdeBudgetRangeId) continue;
    const key =
      measurementType === "derived"
        ? String(component.variableType || "")
        : "final";
    const nominal =
      measurementType === "derived" ? nominals.get(key) : directNominal;
    if (!key || !filled(nominal?.value) || !nominal?.unit) continue;
    const sourceId = component.tmdeBudgetSourceId ?? component.sourceTmdeId;
    const source = tmdes.find((t) =>
      [t.id, t.sourceId, t.instrument?.id].some(
        (id) => id != null && String(id) === String(sourceId),
      ),
    );
    const rawRange =
      component.tmdeBudgetRange ||
      (source &&
        getInstrumentRangeRows(source, { flattenTolerances: true }).find(
          (r) =>
            String(r.rangeId ?? r.id) === String(component.tmdeBudgetRangeId),
        ));
    if (!rawRange) continue;
    const range = {
      ...rawRange,
      min: rawRange.min ?? rawRange.value,
      max: rawRange.max ?? rawRange.value,
      unit: rawRange.unit || rawRange.functionUnit || "",
    };
    const compatibility = assessRangeCompatibility(
      range,
      nominal,
      "error source range",
    );
    if (compatibility.compatible) continue;
    const subject =
      measurementType === "derived"
        ? `Equation input ${key}`
        : "Measurement Point";
    (warnings[key] ||= []).push({
      componentId: component.id || component.componentId,
      name: component.name || "TMDE component",
      reason: `${subject} ${label(nominal)} does not fall within error source range: ${formatRangeLabel(range, { preferBounds: true })}. Choose a range that includes this value and has compatible units.`,
    });
  }
  return warnings;
}

// Readiness is derived from current inputs, never persisted calculation snapshots.
// Range/mismatch warnings are advisory: a user may intentionally explore them.
export function getPointDiagnostics(
  point = {},
  session = {},
  { riskMetrics, riskStatus = {}, visibleColumns = {} } = {},
) {
  const warnings = [];
  const nominal = point.testPointInfo?.parameter || {};
  const tolerance = point.uutTolerance || session.uutTolerance || {};
  const add = (message) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  const validNominal =
    filled(nominal.value) && Boolean(unitSystem.units[nominal.unit]);
  if (!filled(nominal.value)) add("Enter a numeric measurement point value.");
  if (!unitSystem.units[nominal.unit])
    add("Choose a valid measurement point unit.");
  if (
    Array.isArray(point.associatedUutIds) &&
    point.associatedUutIds.length === 0
  )
    add("Assign a UUT using this point's UUT cell, then check its tolerance.");
  const tmdes = reconcileTmdeInstances(
    point.tmdeTolerances || [],
    session.tmdes || [],
  );
  const components = point.components || [];
  const groups = [];
  if (point.measurementType === "derived") {
    if (!point.equationString?.trim())
      add("Enter the measurement equation in Uncertainty Budget.");
    else if (validNominal) {
      const result = calculateDerivedUncertainty(
        point.equationString,
        point.variableMappings || {},
        tmdes,
        { ...nominal, variableNominals: point.variableNominals || {} },
        components,
        {
          strictUnitValidation: true,
          allowFiniteDifference: point.budgetPropagationMethod === "montecarlo",
        },
      );
      if (result.missingInputs)
        add(
          `Enter a nominal value and unit for each equation input: ${(result.missingTypes || []).filter(Boolean).join(", ") || "map the equation variables first"}.`,
        );
      else if (
        result.error &&
        !(result.degenerate && point.budgetPropagationMethod === "montecarlo")
      )
        add(`Check the measurement equation: ${result.error}`);
      if (
        Number.isFinite(result.nominalResult) &&
        Math.abs(result.nominalResult - Number(nominal.value)) >
          Math.max(Math.abs(Number(nominal.value) * 0.0001), 1e-9)
      ) {
        add(
          `Equation result ${Number(result.nominalResult.toPrecision(10))} ${getUnitDisplayLabel(nominal.unit)} does not equal Measurement Point ${label(nominal)}. Review the input nominals or measurement point value.`,
        );
      }
    }
    for (const [symbol, type] of Object.entries(point.variableMappings || {})) {
      const value =
        point.variableNominals?.[symbol] ||
        point.variableNominals?.[type] ||
        tmdes.find((t) => t.variableType === type)?.measurementPoint;
      groups.push({
        kind: "input",
        variableType: type,
        nominalPoint: value || {},
      });
    }
  }
  Object.values(
    getBudgetRangeWarnings({
      components,
      measurementType: point.measurementType,
      directNominal: nominal,
      groups,
      tmdes: session.tmdes || [],
    }),
  )
    .flat()
    .forEach((w) => add(`${w.name}: ${w.reason}`));
  if (validNominal) {
    const sources = [
      ...components,
      ...tmdes.flatMap((t) =>
        getBudgetComponentsFromTolerance(
          t.tolerance || t,
          point.measurementType === "derived"
            ? t.measurementPoint || nominal
            : nominal,
        ),
      ),
    ];
    const resolution = getUutResolutionComponent(tolerance, nominal);
    if (resolution) sources.push(resolution);
    if (!sources.length)
      add(
        "No error sources in this budget. Open Uncertainty Budget and use Add component for a TMDE specification, repeatability result, or manual source.",
      );
    else if (point.measurementType === "derived") {
      for (const group of groups) {
        if (
          group.variableType &&
          ![...components, ...tmdes].some(
            (source) => source.variableType === group.variableType,
          )
        )
          add(
            `Input ${group.variableType} has no error sources. Use Add component in that input's budget to include its uncertainty.`,
          );
      }
    }
    for (const source of sources) {
      if (
        source.missingTolerance ||
        (!filled(source.value) && !filled(source.value_native))
      )
        add(
          `Set a numeric uncertainty or tolerance for ${source.name || "the unfinished error source"}.`,
        );
    }
    if (
      sources.length &&
      sources.every((s) => Number(s.value_native ?? s.value) === 0)
    )
      add(
        "All error sources have zero uncertainty. Enter the applicable source uncertainties to calculate risk.",
      );
    if (isKnownMeasurementTolerance(tolerance)) {
      if (!validateKnownSingleSidedGeometry(tolerance, nominal.value).ok)
        add(
          "Set the UUT single-sided limit below the measurement point for a lower limit, or above it for an upper limit.",
        );
    } else if (isUnknownMeasurementTolerance(tolerance)) {
      if (!filled(getSingleSidedTolerance(tolerance)?.limit))
        add("Enter the UUT single-sided acceptance limit.");
      const pfa = Number(session.uncReq?.reqPFA);
      if (!(pfa > 0 && pfa < 100))
        add(
          "Set PFA Required between 0% and 100% in session mitigation inputs.",
        );
    } else {
      const { breakdown = [] } = calculateUncertaintyFromToleranceObject(
        tolerance,
        nominal,
      );
      const specs = breakdown.filter(
        (c) => c.absoluteHigh !== undefined && c.absoluteLow !== undefined,
      );
      const n = Number(nominal.value);
      const { low, high } = snapLimitsToResolution(
        n + specs.reduce((s, c) => s + c.absoluteLow - n, 0),
        n + specs.reduce((s, c) => s + c.absoluteHigh - n, 0),
        resolveResolutionNative(tolerance, nominal.unit),
      );
      if (
        !specs.length ||
        !Number.isFinite(low) ||
        !Number.isFinite(high) ||
        high <= low
      )
        add(
          "Define a UUT tolerance with distinct lower and upper limits. Check that measuring resolution does not collapse the acceptance band.",
        );
    }
  }
  if (!isUnknownMeasurementTolerance(tolerance)) {
    const reliability = Number(session.uncReq?.reliability);
    if (!(reliability > 0 && reliability < 100))
      add(
        "Set REOP Required between 0% and 100% in session mitigation inputs.",
      );
    const assumed = session.uncReq?.measRelCalcAssumed;
    if (filled(assumed) && !(Number(assumed) > 0 && Number(assumed) < 100))
      add("Set Assumed REOP between 0% and 100% in session risk inputs.");
  }
  if (riskStatus.core === "input exceeds MAX REOP")
    add(
      `Assumed REOP exceeds the maximum achievable REOP${Number.isFinite(riskStatus.maxReop) ? ` (${Number(riskStatus.maxReop.toPrecision(6))}%)` : ""} for this point. Review the assumed REOP, TUR, uncertainty, and tolerance.`,
    );
  if (riskMetrics === null && !warnings.length)
    add(
      "Risk could not be calculated from these inputs. Check the budget values, units, distributions and UUT acceptance limits in Uncertainty Budget.",
    );
  if (riskMetrics?.mcStale)
    add(
      "Monte Carlo results are out of date. Recalculate in Uncertainty Budget to refresh risk metrics.",
    );
  getMitigationDiagnostics({
    metrics: riskMetrics,
    status: riskStatus,
    requirements: session.uncReq,
    visibleColumns,
    tolerance,
  }).forEach(add);
  return warnings;
}
