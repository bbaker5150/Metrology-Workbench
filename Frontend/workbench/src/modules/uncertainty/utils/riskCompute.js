// src/modules/uncertainty/utils/riskCompute.js
//
// Pure, side-effect-free risk computation used to keep the sidebar's per-point
// PFA / PFR / TUR / TAR columns always in sync with the latest inputs.
//
// Why this exists (#1): risk metrics used to be calculated only for the
// *selected* point (inside the stateful useUncertaintyCalculation +
// useRiskCalculation hooks). Every other row in the sidebar fell back to a
// stale `point.riskMetrics` snapshot loaded from the backend, so editing the
// uncertainty requirements, a tolerance/distribution, or a point value did not
// refresh the other rows until you clicked each one.
//
// This module mirrors the math of those two hooks but as plain functions, so
// App.jsx can memoize a {pointId -> metrics} map over all test points. It does
// NOT persist anything and makes no network calls — it is purely derived state
// recomputed in memory, so there are no extra database hits.

import {
  unitSystem,
  getKValueFromTDistribution,
  calculateDerivedUncertainty,
  calculateUncertaintyFromToleranceObject,
  combineWithCorrelation,
  normalQuantile,
  snapLimitsToResolution,
  resolveResolutionNative,
  calcTAR,
  calcTUR,
  PFAMgr,
  PFRMgr,
  resDwn,
  resUp,
  gbLowMgr,
  gbUpMgr,
  GBMultMgr,
  PFAwGBMgr,
  PFRwGBMgr,
  CalIntwGBMgr,
  CalIntMgr,
  CalRelMgr,
} from "./uncertaintyMath";
import {
  getBudgetComponentsFromTolerance,
  getUutResolutionComponent,
} from "../features/analysis/utils/budgetUtils";
import { getInstrumentRangeRows } from "./instrumentFunctionSelection";
import { reconcileTmdeInstances } from "./tmdeReconcile";
import { computeEmpiricalRisk, findEmpiricalGuardBand } from "./empiricalRisk";
import {
  normalizeRisk8MonteCarloTrials,
  risk8MonteCarloInputHash,
  runRisk8EquationMonteCarlo,
} from "./risk8/monteCarloEngine8";
import {
  computeUnknownMeasurementBoundary8,
  isUnknownMeasurementTolerance,
  toUnknownMeasurementSummary,
} from "./risk8/unknownMeasurementRisk8";
import {
  computeKnownMeasurementRisk8,
  computeKnownTwoSidedRisk8,
  isKnownTwoSidedTolerance,
  isKnownMeasurementTolerance,
  toKnownMeasurementSummary,
} from "./risk8/knownMeasurementRisk8";

const isFilledNumber = (v) =>
  v !== "" && v !== null && v !== undefined && !isNaN(parseFloat(v));

// Derived points keep TMDE error sources as linked manual budget components.
// Resolve those links against the live session master before computing sidebar
// risk so a tolerance/range edit updates PFA/PFR immediately, just as it does
// in the open point's Analysis component.
const refreshLinkedDerivedManualComponents = (
  point,
  sessionData,
  uutNominal,
) => {
  const components = point?.components || [];
  if (point?.measurementType !== "derived" || components.length === 0) {
    return components;
  }

  const getReferencePoint = (component) => {
    if (component?.variableType) {
      const symbol = Object.entries(point.variableMappings || {}).find(
        ([, name]) =>
          String(name || "").trim() ===
          String(component.variableType || "").trim(),
      )?.[0];
      return symbol ? point.variableNominals?.[symbol] : null;
    }
    return uutNominal;
  };

  return components
    .map((component) => {
      if (!component?.tmdeBudgetSourceId) return component;

      const sourceId = component.tmdeBudgetSourceId;
      const master = (sessionData?.tmdes || []).find(
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

      const resolved = getBudgetComponentsFromTolerance(
        selectedRange,
        getReferencePoint(component),
      );
      const replacement = resolved.find(
        (candidate) =>
          String(candidate.name || "").split(" - ").slice(1).join(" - ") ===
          String(component.tmdeBudgetComponentKind || ""),
      );
      if (!replacement) return null;

      return {
        ...component,
        value: replacement.value,
        isBaseUnitValue: replacement.isBaseUnitValue,
        value_native: replacement.value_native,
        unit_native: replacement.unit_native,
        distribution: replacement.distribution,
        distributionDivisor: replacement.distributionDivisor,
      };
    })
    .filter(Boolean);
};

// --- Pure uncertainty (mirrors useUncertaintyCalculation, display fields only) ---
// Returns { combined_uncertainty_absolute_base, expanded_uncertainty_absolute_base }
// or null when the point isn't ready to evaluate.
function computeUncertaintyForPoint(point, sessionData) {
  const uutNominal = point.testPointInfo?.parameter;
  if (!uutNominal || !isFilledNumber(uutNominal.value) || !uutNominal.unit) {
    return null;
  }

  // Reconcile against the session masters so the sidebar's per-point metrics use
  // the same orphan-/duplicate-free instance set the open point's budget does.
  const tmdeTolerancesData = reconcileTmdeInstances(
    point.tmdeTolerances || [],
    sessionData?.tmdes || [],
  );
  const manualComponents = refreshLinkedDerivedManualComponents(
    point,
    sessionData,
    uutNominal,
  );
  const derivedNominalValue = parseFloat(uutNominal.value);
  const derivedNominalUnit = uutNominal.unit;
  const targetUnitInfo = unitSystem.units[derivedNominalUnit];
  if (!targetUnitInfo || isNaN(targetUnitInfo.to_si)) return null;

  let combinedUncertaintyPPM = NaN;
  let combinedUncertaintyAbsoluteBase = NaN;
  let effectiveDof = Infinity;
  let calculatedNominalValue;
  const componentsForBudgetTable = [];

  try {
    if (point.measurementType === "derived") {
      const hasVariables =
        point.variableMappings &&
        Object.keys(point.variableMappings).length > 0;
      if (
        hasVariables &&
        tmdeTolerancesData.length === 0 &&
        manualComponents.length === 0
      ) {
        return null;
      }

      // Empty-valued sources are SKIPPED by calculateDerivedUncertainty, and a
      // variable left with no valued source surfaces as `missingInputs` below.
      // So we no longer bail just because ONE of several additive sources on a
      // variable is still being entered — that previously blanked the whole
      // risk row the instant a second TMDE was assigned.
      const derivedCalculationResult = calculateDerivedUncertainty(
        point.equationString,
        point.variableMappings,
        tmdeTolerancesData,
        // Derived points no longer need TMDE assignment rows: their input
        // nominals live on the point while linked TMDE/manual components carry
        // the uncertainty. Keep the nominal-only variable values available to
        // the pure sidebar calculator just like the open-point hook does.
        {
          ...uutNominal,
          variableNominals: point.variableNominals || {},
        },
        manualComponents,
        {
          allowFiniteDifference:
            point.budgetPropagationMethod === "montecarlo",
        },
      );
      const monteCarloCanReplaceDegenerateTaylor =
        point.budgetPropagationMethod === "montecarlo" &&
        derivedCalculationResult.degenerate &&
        Array.isArray(derivedCalculationResult.breakdown) &&
        derivedCalculationResult.breakdown.length > 0;
      if (
        derivedCalculationResult.missingInputs ||
        (derivedCalculationResult.error && !monteCarloCanReplaceDegenerateTaylor)
      ) {
        return null;
      }

      const { combinedUncertaintyNative, breakdown: derivedBreakdown } =
        derivedCalculationResult;
      if (isNaN(combinedUncertaintyNative) && !monteCarloCanReplaceDegenerateTaylor) return null;
      calculatedNominalValue = derivedCalculationResult.nominalResult;

      // Unified SIGNED contributions in base SI (equation inputs + non-mapped
      // manual components), combined with the optional correlation matrix. Must
      // stay identical to useUncertaintyCalculation so sidebar metrics match the
      // open point.
      const inputCorrelations = point.inputCorrelations || {};
      const signedContribsBase = [];
      const additionalSignedContribsBase = [];
      derivedBreakdown.forEach((item) => {
        signedContribsBase.push({
          id: item.componentId,
          contribution: item.contribution_base_signed,
        });
      });
      (manualComponents || []).forEach((comp) => {
        const varType = comp.variableType || comp.name;
        const isMappedVariable = Object.values(
          point.variableMappings || {},
        ).includes(varType);
        if (!isMappedVariable) {
          const absUncBase =
            (comp.value / 1e6) * Math.abs(derivedNominalValue) * targetUnitInfo.to_si;
          if (!isNaN(absUncBase)) {
            signedContribsBase.push({ id: varType, contribution: absUncBase });
            additionalSignedContribsBase.push({
              id: varType,
              contribution: absUncBase,
            });
          }
        }
      });

      const uutResComp = getUutResolutionComponent(
        point.uutTolerance || sessionData.uutTolerance,
        uutNominal,
      );
      if (uutResComp) {
        const absUncBase =
          (uutResComp.value / 1e6) * Math.abs(derivedNominalValue) * targetUnitInfo.to_si;
        if (!isNaN(absUncBase)) {
          signedContribsBase.push({
            id: uutResComp.componentId,
            contribution: absUncBase,
          });
          additionalSignedContribsBase.push({
            id: uutResComp.componentId,
            contribution: absUncBase,
          });
        }
      }

      combinedUncertaintyAbsoluteBase = combineWithCorrelation(
        signedContribsBase,
        inputCorrelations,
      );
      effectiveDof = Infinity;

      // Layer 3: a fresh Monte Carlo summary (hash-matched to the point's
      // CURRENT inputs) supersedes the first-order numbers for MC-mode
      // points. u_c comes from the empirical distribution and the expanded
      // uncertainty from the shortest-95% interval half-width, so TUR — and,
      // below, PFA/PFR — reflect the actual (possibly asymmetric) output
      // distribution. A stale or absent summary falls through to the linear
      // numbers; computePointRiskMetrics flags that as mcStale.
      if (point.budgetPropagationMethod === "montecarlo") {
        const inputs = derivedBreakdown.map((item) => ({
            symbol: item.variable,
            componentId: item.componentId,
            meanBase: unitSystem.toBaseUnit(item.nominal, item.unit),
            standardUncertaintyBase: item.ui_absolute_base,
        }));
        const trials = normalizeRisk8MonteCarloTrials(point.monteCarloTrials);
        const hash = risk8MonteCarloInputHash({
          equationString: point.equationString,
          inputs,
          correlations: inputCorrelations,
          trials,
        });
        const result =
          point.risk8MonteCarloResult?.hash === hash
            ? point.risk8MonteCarloResult
            : runRisk8EquationMonteCarlo({
                equationString: point.equationString,
                inputs,
                correlations: inputCorrelations,
                trials,
              });
        combinedUncertaintyAbsoluteBase = combineWithCorrelation(
          [
            {
              id: "risk8_monte_carlo_uncertainty",
              contribution: result.standardUncertaintyBase,
            },
            ...additionalSignedContribsBase,
          ],
          inputCorrelations,
        );
      }
    } else {
      // Direct measurement.
      let totalVariancePPM = 0;
      tmdeTolerancesData.forEach((tmde) => {
        const quantity = tmde.quantity || 1;
        const toleranceSource = tmde.tolerance || tmde;
        const components = getBudgetComponentsFromTolerance(
          toleranceSource,
          uutNominal,
        );
        components.forEach((comp) => {
          totalVariancePPM += comp.value ** 2 * quantity;
          componentsForBudgetTable.push({ ...comp, quantity });
        });
      });
      manualComponents.forEach((comp) => {
        totalVariancePPM += comp.value ** 2;
        componentsForBudgetTable.push(comp);
      });

      const uutResComp = getUutResolutionComponent(
        point.uutTolerance || sessionData.uutTolerance,
        uutNominal,
      );
      if (uutResComp) {
        totalVariancePPM += uutResComp.value ** 2;
        componentsForBudgetTable.push({ ...uutResComp, quantity: 1 });
      }

      if (componentsForBudgetTable.length === 0) return null;

      combinedUncertaintyPPM = Math.sqrt(totalVariancePPM);

      const numerator = Math.pow(combinedUncertaintyPPM, 4);
      const denominator = componentsForBudgetTable.reduce((sum, comp) => {
        const dof =
          comp.dof === Infinity ||
          comp.dof == null ||
          isNaN(parseFloat(comp.dof))
            ? Infinity
            : parseFloat(comp.dof);
        return dof === Infinity || dof <= 0 || isNaN(comp.value) || comp.value === 0
          ? sum
          : sum + Math.pow(comp.value, 4) / dof;
      }, 0);
      effectiveDof = denominator > 0 ? numerator / denominator : Infinity;

      if (
        !isNaN(combinedUncertaintyPPM) &&
        derivedNominalValue !== 0
      ) {
        const derivedNominalInBase = unitSystem.toBaseUnit(
          derivedNominalValue,
          derivedNominalUnit,
        );
        if (!isNaN(derivedNominalInBase) && derivedNominalInBase !== 0) {
          combinedUncertaintyAbsoluteBase =
            (combinedUncertaintyPPM / 1e6) * Math.abs(derivedNominalInBase);
        }
      }
    }

    if (isNaN(combinedUncertaintyAbsoluteBase)) return null;

    const confidencePercent =
      parseFloat(sessionData.uncReq?.uncertaintyConfidence) || 95;
    const probability = 1 - (1 - confidencePercent / 100) / 2;
    const manualCoverageFactor =
      point.coverageFactorMode === "manual"
        ? parseFloat(point.coverageFactorOverride)
        : null;
    // Risk uses the final budget's coverage factor → the "final" group's flag.
    const applyEffectiveDof =
      (point.useEffectiveDofByGroup || {}).final !== false;
    const kValue =
      Number.isFinite(manualCoverageFactor) && manualCoverageFactor > 0
        ? manualCoverageFactor
        : !applyEffectiveDof || effectiveDof === Infinity || isNaN(effectiveDof)
        ? normalQuantile(probability)
        : getKValueFromTDistribution(effectiveDof, probability);

    // Empirical expanded uncertainty: half-width of the shortest coverage
    // interval (correct for asymmetric outputs); k follows as its ratio to u.
    const expandedBase = kValue * combinedUncertaintyAbsoluteBase;

    return {
      combined_uncertainty_absolute_base: combinedUncertaintyAbsoluteBase,
      expanded_uncertainty_absolute_base: expandedBase,
      calculated_nominal_value: calculatedNominalValue,
      k_value: kValue,
      mcSummary: null,
    };
  } catch {
    return null;
  }
}

// --- Pure risk (mirrors useRiskCalculation limit derivation + core metrics) ---
// Returns { pfa, pfr, tur, tar } (pfa/pfr as percentages) or null.
export function computePointRiskMetrics(point, sessionData, includeGuardband = false) {
  if (!point || !sessionData) return null;
  const uutNominal = point.testPointInfo?.parameter;
  if (!uutNominal || !isFilledNumber(uutNominal.value) || !uutNominal.unit) {
    return null;
  }

  const calcResults = computeUncertaintyForPoint(point, sessionData);
  if (!calcResults) return null;

  const uutToleranceData = point.uutTolerance || sessionData.uutTolerance || {};
  const nominalValue = parseFloat(uutNominal.value);

  // Risk 8.0 types 5/6: without a measured value there is no TUR, REOP, PFR,
  // or TAR calculation. Run the approved PFA-only acceptance-boundary method
  // before the legacy two-sided limit derivation (which requires both limits
  // and would otherwise discard this valid tolerance case).
  if (isUnknownMeasurementTolerance(uutToleranceData)) {
    const targetUnitInfo = unitSystem.units[uutNominal.unit];
    const reqPFA = parseFloat(sessionData.uncReq?.reqPFA) / 100;
    if (!targetUnitInfo || !Number.isFinite(targetUnitInfo.to_si)) return null;

    const expandedUncertaintyNative =
      calcResults.expanded_uncertainty_absolute_base / targetUnitInfo.to_si;
    const boundary = computeUnknownMeasurementBoundary8({
      tolerance: uutToleranceData,
      uCalNative: expandedUncertaintyNative,
      reqPFA,
      resolution: resolveResolutionNative(uutToleranceData, uutNominal.unit),
    });
    const summary = toUnknownMeasurementSummary(boundary);
    return summary ? { ...summary, mcStale: false } : null;
  }

  const knownSingleSided = isKnownMeasurementTolerance(uutToleranceData);

  // Derive acceptance limits from the UUT tolerance + nominal.
  let LLow;
  let LUp;
  try {
    if (knownSingleSided) {
      const singleSided =
        uutToleranceData.singleSided || uutToleranceData.tolerances?.singleSided;
      const limit = Number(singleSided?.limit);
      if (!Number.isFinite(limit)) return null;
      LLow = singleSided.direction === "low" ? limit : NaN;
      LUp = singleSided.direction === "low" ? NaN : limit;
    } else {
      const { breakdown } = calculateUncertaintyFromToleranceObject(
        uutToleranceData,
        uutNominal,
      );
      const specComponents = (breakdown || []).filter(
        (comp) =>
          comp.absoluteHigh !== undefined && comp.absoluteLow !== undefined,
      );
      if (specComponents.length === 0) return null;
      const totalHighDeviation = specComponents.reduce(
        (sum, comp) => sum + (comp.absoluteHigh - nominalValue),
        0,
      );
      const totalLowDeviation = specComponents.reduce(
        (sum, comp) => sum + (comp.absoluteLow - nominalValue),
        0,
      );
      LUp = nominalValue + totalHighDeviation;
      LLow = nominalValue + totalLowDeviation;
      // Mirror the workbook: snap the acceptance band inward to the UUT's
      // measuring resolution before computing risk.
      ({ low: LLow, high: LUp } = snapLimitsToResolution(
        LLow,
        LUp,
        resolveResolutionNative(uutToleranceData, uutNominal.unit),
      ));
    }
  } catch {
    return null;
  }

  if (knownSingleSided) {
    if (Number.isFinite(LLow) === Number.isFinite(LUp)) return null;
  } else if (isNaN(LLow) || isNaN(LUp) || LUp === LLow) {
    return null;
  }

  const reliability = parseFloat(sessionData.uncReq?.reliability) / 100;
  const turNeeded = parseFloat(sessionData.uncReq?.neededTUR);
  const calInt = parseFloat(sessionData.uncReq?.calInt);
  const assumedReliability =
    parseFloat(sessionData.uncReq?.measRelCalcAssumed) / 100;
  const measRelCalc = Number.isFinite(assumedReliability)
    ? assumedReliability
    : reliability;
  if (isNaN(reliability) || reliability <= 0 || reliability >= 1) return null;

  const nominalUnit = uutNominal.unit;
  const targetUnitInfo = unitSystem.units[nominalUnit];
  if (!targetUnitInfo || isNaN(targetUnitInfo.to_si)) return null;

  const uCal_Native =
    calcResults.combined_uncertainty_absolute_base / targetUnitInfo.to_si;
  const U_Native =
    calcResults.expanded_uncertainty_absolute_base / targetUnitInfo.to_si;
  const calculatedAverage = parseFloat(calcResults.calculated_nominal_value);
  // Direct points have no derived calculated nominal. Use the actual test
  // point value instead of silently recentering their risk calculation at 0.
  let riskAverage = Number.isFinite(calculatedAverage)
    ? calculatedAverage
    : nominalValue;
  // Layer 3: for MC-mode points the MC mean is the corrected estimate of the
  // measurand (JCGM 101) — it carries the nonlinear ½f″u² shift that
  // f(nominals) misses. Center every risk metric on it, mirroring
  // useRiskCalculation so the sidebar matches the open panel.
  if (calcResults.mcSummary) {
    const mcMeanNative = unitSystem.fromBaseUnit(
      calcResults.mcSummary.meanBase,
      nominalUnit,
    );
    if (Number.isFinite(mcMeanNative)) riskAverage = mcMeanNative;
  }

  // TMDE tolerance span (for TAR), mirroring useRiskCalculation.
  let tmdeToleranceHigh_Native = 0;
  let tmdeToleranceLow_Native = 0;
  const tmdeTolerancesData = reconcileTmdeInstances(
    point.tmdeTolerances || [],
    sessionData?.tmdes || [],
  );
  if (tmdeTolerancesData.length > 0) {
    const totals = tmdeTolerancesData.reduce(
      (acc, tmde) => {
        const hasTmdeMeasurementPoint =
          tmde.measurementPoint &&
          tmde.measurementPoint.value &&
          tmde.measurementPoint.unit;
        const refPoint = hasTmdeMeasurementPoint
          ? tmde.measurementPoint
          : uutNominal;
        if (!refPoint || !refPoint.value || !refPoint.unit) return acc;

        const toleranceSource = tmde.tolerance || tmde;
        let breakdown;
        try {
          breakdown = calculateUncertaintyFromToleranceObject(
            toleranceSource,
            refPoint,
          ).breakdown;
        } catch {
          return acc;
        }
        const tmdeNominal = parseFloat(refPoint.value);
        const tmdeSpecComponents = (breakdown || []).filter(
          (comp) =>
            comp.absoluteHigh !== undefined && comp.absoluteLow !== undefined,
        );
        if (tmdeSpecComponents.length === 0) return acc;

        const tmdeUnitInfo = unitSystem.units[refPoint.unit];
        if (!tmdeUnitInfo || isNaN(tmdeUnitInfo.to_si)) return acc;

        let totalHighDev = 0;
        let totalLowDev = 0;
        tmdeSpecComponents.forEach((comp) => {
          const highDev = comp.absoluteHigh - tmdeNominal;
          const lowDev = comp.absoluteLow - tmdeNominal;
          totalHighDev +=
            (highDev * tmdeUnitInfo.to_si) / targetUnitInfo.to_si;
          totalLowDev += (lowDev * tmdeUnitInfo.to_si) / targetUnitInfo.to_si;
        });
        const quantity = parseInt(tmde.quantity, 10) || 1;
        acc.totalHigh += totalHighDev * quantity;
        acc.totalLow += totalLowDev * quantity;
        return acc;
      },
      { totalHigh: 0, totalLow: 0 },
    );
    tmdeToleranceHigh_Native = totals.totalHigh;
    tmdeToleranceLow_Native = totals.totalLow;
  }

  const tarResult = calcTAR(
    uutNominal.value,
    riskAverage,
    LLow,
    LUp,
    nominalValue + tmdeToleranceLow_Native,
    nominalValue + tmdeToleranceHigh_Native,
  );
  const turResult = calcTUR(
    uutNominal.value,
    riskAverage,
    LLow,
    LUp,
    U_Native,
  );

  const knownTwoSided = isKnownTwoSidedTolerance(
    nominalValue,
    LLow,
    LUp,
  );
  if (knownSingleSided || knownTwoSided) {
    const sharedRisk8Inputs = {
      nominal: nominalValue,
      riskAverage,
      expandedUncertaintyNative: U_Native,
      tur: turResult,
      assumedReop: measRelCalc,
      requiredReop: reliability,
      turNeeded,
      reqPFA: parseFloat(sessionData.uncReq?.reqPFA) / 100,
      initialGB: parseFloat(sessionData.uncReq?.guardBandMultiplier),
      originalInterval: calInt,
      resolution: resolveResolutionNative(uutToleranceData, nominalUnit),
    };
    const result = knownSingleSided
      ? computeKnownMeasurementRisk8({
          ...sharedRisk8Inputs,
          tolerance: uutToleranceData,
        })
      : computeKnownTwoSidedRisk8({
          ...sharedRisk8Inputs,
          lowerLimit: LLow,
          upperLimit: LUp,
        });
    const summary = toKnownMeasurementSummary(result);
    if (!summary) return null;
    return {
      ...summary,
      tar: Number.isFinite(Number(tarResult)) ? Number(tarResult) : undefined,
      mcStale: false,
    };
  }

  const pfaArr = PFAMgr(
    uutNominal.value,
    riskAverage,
    LLow,
    LUp,
    uCal_Native,
    reliability,
    turResult,
    turNeeded,
  );
  const pfrArr = PFRMgr(
    uutNominal.value,
    riskAverage,
    LLow,
    LUp,
    uCal_Native,
    reliability,
    turResult,
    turNeeded,
  );

  const toNum = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? undefined : n;
  };

  let pfa = toNum(pfaArr?.[0]);
  let pfr = toNum(pfrArr?.[0]);
  const tur = toNum(turResult);
  const tar = toNum(tarResult);

  // --- Layer 3: empirical PFA/PFR for MC-mode points with a fresh summary ---
  // Quadrant counting against the actual measurement-error distribution
  // replaces the bivariate-normal integrals. The UUT bias prior stays normal
  // (same deconvolution), so for a normal error distribution these converge
  // to the closed forms above.
  const mcSummary = calcResults.mcSummary || null;
  let riskMethod = "closedform";
  let errorQuantilesNative = null;
  if (mcSummary) {
    errorQuantilesNative = mcSummary.quantiles.map(
      (q) => (q - mcSummary.meanBase) / targetUnitInfo.to_si,
    );
    const empirical = computeEmpiricalRisk({
      average: riskAverage,
      LLow,
      LUp,
      uCal: uCal_Native,
      errorQuantiles: errorQuantilesNative,
      reliability,
      tur: turResult,
      reqTur: turNeeded,
    });
    if (empirical) {
      pfa = empirical.pfa;
      pfr = empirical.pfr;
      riskMethod = "empirical";
    }
  }
  const mcStale = false;

  // --- Guardband (mirrors useRiskCalculation lines ~315-399) ---
  // Iterative/convergent, so only computed when requested by the caller to keep
  // the sidebar map cheap. Returns the guardbanded limits, multiplier, and the
  // post-guardband PFA/PFR.
  let guardband;
  if (includeGuardband) {
    const pfaRequired = parseFloat(sessionData.uncReq?.reqPFA) / 100;
    if (!isNaN(pfaRequired) && pfaRequired > 0) {
      // Measurement resolution converted into the nominal unit's grid (the unit
      // the limits live in) so the guard-band rounding matches the workbook.
      const safeRes = resolveResolutionNative(uutToleranceData, nominalUnit);

      try {
        let gbLow;
        let gbHigh;
        let gbPfa;
        let gbPfr;
        if (riskMethod === "empirical" && errorQuantilesNative) {
          // Empirical inversion: guard each limit proportionally to the error
          // mass that can push an out-of-tolerance unit past it — asymmetric
          // whenever the error distribution is.
          const gb = findEmpiricalGuardBand({
            pfaRequired,
            average: riskAverage,
            LLow,
            LUp,
            uCal: uCal_Native,
            errorQuantiles: errorQuantilesNative,
            reliability,
            tur: turResult,
            reqTur: turNeeded,
          });
          if (!gb) throw new Error("empirical guard band failed");
          gbLow = resDwn(gb.gbLow, safeRes);
          gbHigh = resUp(gb.gbUp, safeRes);
          const empGb = computeEmpiricalRisk({
            average: riskAverage,
            LLow,
            LUp,
            accLow: gbLow,
            accUp: gbHigh,
            uCal: uCal_Native,
            errorQuantiles: errorQuantilesNative,
            reliability,
            tur: turResult,
            reqTur: turNeeded,
          });
          gbPfa = empGb ? empGb.pfa : undefined;
          gbPfr = empGb ? empGb.pfr : undefined;
        } else {
          const lowMgr = gbLowMgr(
            pfaRequired,
            uutNominal.value,
            riskAverage,
            LLow,
            LUp,
            uCal_Native,
            reliability,
          );
          const upMgr = gbUpMgr(
            pfaRequired,
            uutNominal.value,
            riskAverage,
            LLow,
            LUp,
            uCal_Native,
            reliability,
          );
          gbLow = resDwn(lowMgr[0], safeRes);
          gbHigh = resUp(upMgr[0], safeRes);
          const gbPfaArr = PFAwGBMgr(
            uutNominal.value,
            riskAverage,
            LLow,
            LUp,
            uCal_Native,
            reliability,
            gbLow,
            gbHigh,
          );
          const gbPfrArr = PFRwGBMgr(
            uutNominal.value,
            riskAverage,
            LLow,
            LUp,
            uCal_Native,
            reliability,
            gbLow,
            gbHigh,
          );
          gbPfa = toNum(gbPfaArr?.[0]);
          gbPfr = toNum(gbPfrArr?.[0]);
        }
        const gbMult = GBMultMgr(
          pfaRequired,
          uutNominal.value,
          riskAverage,
          LLow,
          LUp,
          gbLow,
          gbHigh,
        );
        const gbMultNum = toNum(gbMult);
        const [gbCalInt] =
          Number.isFinite(calInt) && Number.isFinite(measRelCalc)
            ? CalIntwGBMgr(
                uutNominal.value,
                riskAverage,
                LLow,
                LUp,
                uCal_Native,
                reliability,
                measRelCalc,
                gbLow,
                gbHigh,
                turResult,
                turNeeded,
                calInt,
              )
            : [];
        const [noGbCalInt] =
          Number.isFinite(calInt) && Number.isFinite(measRelCalc)
            ? CalIntMgr(
                uutNominal.value,
                riskAverage,
                LLow,
                LUp,
                uCal_Native,
                reliability,
                measRelCalc,
                turResult,
                turNeeded,
                calInt,
                pfaRequired,
              )
            : [];
        const [noGbMeasRel] =
          Number.isFinite(calInt) && Number.isFinite(measRelCalc)
            ? CalRelMgr(
                uutNominal.value,
                riskAverage,
                LLow,
                LUp,
                uCal_Native,
                reliability,
                measRelCalc,
                turResult,
                turNeeded,
                calInt,
                pfaRequired,
              )
            : [];
        guardband = {
          gbLow: toNum(gbLow),
          gbHigh: toNum(gbHigh),
          gbMult: gbMultNum !== undefined ? gbMultNum * 100 : undefined,
          gbPfa: gbPfa !== undefined ? gbPfa * 100 : undefined,
          gbPfr: gbPfr !== undefined ? gbPfr * 100 : undefined,
          gbCalInt: toNum(gbCalInt),
          noGbCalInt: toNum(noGbCalInt),
          noGbMeasRel:
            toNum(noGbMeasRel) !== undefined
              ? toNum(noGbMeasRel) * 100
              : undefined,
        };
      } catch {
        guardband = undefined;
      }
    }
  }

  return {
    pfa: pfa !== undefined ? pfa * 100 : undefined,
    pfr: pfr !== undefined ? pfr * 100 : undefined,
    tur,
    tar,
    // "empirical" when an MC-mode point's fresh summary drove PFA/PFR;
    // mcStale marks an MC-mode point falling back to closed-form numbers
    // because its summary is missing or out of date (UI shows a re-simulate
    // hint).
    riskMethod,
    mcStale,
    ...(guardband || {}),
  };
}

// Build a { pointId -> metrics } map for a list of points. Used by App.jsx with
// useMemo so the whole sidebar reflects the latest inputs in one pass.
export function computeRiskMetricsMap(points, sessionData, includeGuardband = false) {
  const map = {};
  (points || []).forEach((p) => {
    map[p.id] = computePointRiskMetrics(p, sessionData, includeGuardband);
  });
  return map;
}
