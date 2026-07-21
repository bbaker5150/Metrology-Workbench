/**
 * src/hooks/useRiskCalculation.js
 * * This hook manages the Risk Analysis state and logic.
 * It automatically calculates risk metrics (TAR, TUR, PFA, PFR) based on
 * the calculated uncertainty results and the session's risk requirements.
 * * Returns:
 * - riskResults: The calculated metrics object.
 * - riskInputs: State for manual overrides of limits (LLow, LUp).
 * - calculateRiskMetrics: Function to force recalculation.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { 
  unitSystem, 
  calculateUncertaintyFromToleranceObject, 
  calcTAR, 
  calcTUR, 
  PFAMgr,
  PFRMgr,
  resDwn,
  resUp,
  snapLimitsToResolution,
  resolveResolutionNative,
  gbLowMgr,
  gbUpMgr, 
  GBMultMgr, 
  PFAwGBMgr, 
  PFRwGBMgr, 
  CalIntwGBMgr,
  CalIntMgr,
  CalRelMgr
} from "../../../utils/uncertaintyMath";
import {
  computeEmpiricalRisk,
  findEmpiricalGuardBand,
} from "../../../utils/empiricalRisk";
import { toleranceUnboundedSide } from "../../../utils/toleranceShape";
import {
  computeUnknownMeasurementBoundary8,
  isUnknownMeasurementTolerance,
  toUnknownMeasurementSummary,
} from "../../../utils/risk8/unknownMeasurementRisk8";
import {
  computeKnownMeasurementRisk8,
  computeKnownTwoSidedRisk8,
  isKnownTwoSidedTolerance,
  isKnownMeasurementTolerance,
  toKnownMeasurementSummary,
  validateKnownSingleSidedGeometry,
} from "../../../utils/risk8/knownMeasurementRisk8";

export const useRiskCalculation = (
  sessionData,
  testPointData,
  uutToleranceData,
  tmdeTolerancesData,
  uutNominal,
  calcResults, // Must come from useUncertaintyCalculation hook
  analysisMode,
  onRiskResultsChange
) => {
  const [riskInputs, setRiskInputs] = useState({
    LLow: "",
    LUp: "",
  });
  const [riskResults, setRiskResults] = useState(null);
  const [notification, setNotification] = useState(null); 
  
  // Ref to store the last calculated metrics to prevent infinite loops
  const prevRiskMetricsRef = useRef(null);
  const dismissNotification = useCallback(() => setNotification(null), []);

  // --- 1. Auto-Populate Limits from UUT Tolerance ---
  useEffect(() => {
    const singleSided =
      uutToleranceData?.singleSided || uutToleranceData?.tolerances?.singleSided;
    const hasSingleSidedLimit = Number.isFinite(parseFloat(singleSided?.limit));

    if (!uutToleranceData || (!hasSingleSidedLimit && (!uutNominal || !uutNominal.value))) {
      setRiskInputs((prev) => ({ ...prev, LLow: "", LUp: "" }));
      return;
    }

    // Match the workbook's single-sided cases exactly: the stored value is the
    // one physical acceptance limit. A known measurement supplies the nominal
    // (Types 3/4); an unknown measurement deliberately has no nominal (Types
    // 5/6), but the active lower/upper limit is the same.
    if (hasSingleSidedLimit) {
      const limit = singleSided.limit;
      setRiskInputs((prev) => ({
        ...prev,
        LLow: singleSided.direction === "low" ? limit : "",
        LUp: singleSided.direction === "low" ? "" : limit,
      }));
      return;
    }

    const { breakdown } = calculateUncertaintyFromToleranceObject(
      uutToleranceData,
      uutNominal
    );

    const nominalValue = parseFloat(uutNominal.value);

    const specComponents = breakdown.filter(
      (comp) =>
        comp.absoluteHigh !== undefined && comp.absoluteLow !== undefined
    );

    if (specComponents.length === 0) {
      setRiskInputs((prev) => ({ ...prev, LLow: "", LUp: "" }));
      return;
    }

    const totalHighDeviation = specComponents.reduce((sum, comp) => {
      return sum + (comp.absoluteHigh - nominalValue);
    }, 0);

    const totalLowDeviation = specComponents.reduce((sum, comp) => {
      return sum + (comp.absoluteLow - nominalValue);
    }, 0);

    const finalHighLimit = nominalValue + totalHighDeviation;
    const finalLowLimit = nominalValue + totalLowDeviation;

    // Mirror the workbook: snap the acceptance band inward to the UUT's
    // measuring resolution so the limits (and resulting TUR/PFA) match Excel.
    const { low: snappedLow, high: snappedHigh } = snapLimitsToResolution(
      finalLowLimit,
      finalHighLimit,
      resolveResolutionNative(uutToleranceData, uutNominal.unit)
    );

    // Single-sided (threshold) tolerance: leave the unbounded side blank so the
    // downstream risk (both the current threshold path and the 8.0 single-sided
    // types 3/4) sees a one-sided acceptance limit rather than a symmetric band.
    const unbounded = toleranceUnboundedSide(uutToleranceData);

    setRiskInputs((prev) => ({
      ...prev,
      LLow: unbounded === "low" ? "" : snappedLow,
      LUp: unbounded === "high" ? "" : snappedHigh,
    }));
  }, [uutToleranceData, uutNominal]);

  // --- 2. The Heavy Calculation Logic ---
  const calculateRiskMetrics = useCallback(() => {
    const LLow = parseFloat(riskInputs.LLow);
    const LUp = parseFloat(riskInputs.LUp);
    const unknownMeasurement = isUnknownMeasurementTolerance(uutToleranceData);
    const knownSingleSided = isKnownMeasurementTolerance(uutToleranceData);
    const hasLowerLimit = Number.isFinite(LLow);
    const hasUpperLimit = Number.isFinite(LUp);

    const pfaRequired = parseFloat(sessionData.uncReq.reqPFA) / 100;
    const reliability = parseFloat(sessionData.uncReq.reliability) / 100;
    const calInt = parseFloat(sessionData.uncReq.calInt);
    const assumedReliability =
      parseFloat(sessionData.uncReq.measRelCalcAssumed) / 100;
    const measRelCalc = Number.isFinite(assumedReliability)
      ? assumedReliability
      : reliability;
    const turNeeded = parseFloat(sessionData.uncReq.neededTUR);
    const uutName = sessionData.uutDescription || "UUT";

    const publishRiskMetrics = (nextMetrics) => {
      const prevJSON = JSON.stringify(prevRiskMetricsRef.current);
      const nextJSON = JSON.stringify(nextMetrics);
      if (prevJSON === nextJSON) return;
      prevRiskMetricsRef.current = nextMetrics;
      setRiskResults(nextMetrics);
      onRiskResultsChange?.(nextMetrics);
    };

    // Workbook Types 3-6 legitimately have exactly one physical limit. The
    // legacy two-sided path is the only one that requires both limits.
    if (unknownMeasurement) {
      if (hasLowerLimit === hasUpperLimit) return;
    } else if (knownSingleSided) {
      if (hasLowerLimit === hasUpperLimit) return;
      const geometry = validateKnownSingleSidedGeometry(
        uutToleranceData,
        uutNominal?.value,
      );
      if (!geometry.ok) {
        const isLower = geometry.direction === "low";
        setNotification({
          title: "Invalid Single-Sided Tolerance",
          message: isLower
            ? "Single Sided Low is a lower limit (≥), so it must be below the measurement point."
            : "Single Sided High is an upper limit (≤), so it must be above the measurement point.",
        });
        publishRiskMetrics(null);
        return;
      }
      if (isNaN(reliability) || reliability <= 0 || reliability >= 1) return;
    } else {
      if (!hasLowerLimit || !hasUpperLimit || LUp === LLow) return;
      if (isNaN(reliability) || reliability <= 0 || reliability >= 1) return;
    }
    setNotification(null);
    if (!calcResults) {
      return;
    }

    const nominalUnit = uutNominal?.unit;
    const targetUnitInfo = unitSystem.units[nominalUnit];
    let uCal_Native = calcResults.combined_uncertainty_absolute_base / targetUnitInfo?.to_si;
    let U_Native = calcResults.expanded_uncertainty_absolute_base / targetUnitInfo?.to_si;
    const calculatedAverage = parseFloat(calcResults.calculatedNominalValue);
    // Direct points do not have a separately calculated nominal. Their stored
    // test-point value is the measured value; treating the absent derived-only
    // field as zero invalidates otherwise-correct single-sided geometry.
    const nominalValue = parseFloat(uutNominal?.value);
    let riskAverage = Number.isFinite(calculatedAverage)
      ? calculatedAverage
      : nominalValue;

    if (!targetUnitInfo || isNaN(targetUnitInfo.to_si)) {
      setNotification({
        title: "Calculation Error",
        message: `Invalid UUT unit (${nominalUnit}) for risk analysis.`,
      });
      return;
    }

    // --- Layer 3: empirical risk context (MC-mode points, fresh summary) ---
    // Mirrors riskCompute.js so the open panel and the sidebar agree: u_c
    // comes from the MC distribution, the expanded uncertainty from the
    // shortest-95% interval half-width (so TUR is interval-based), and
    // PFA/PFR/guard bands below are quadrant-counted against the empirical
    // measurement-error distribution.
    // Retired empirical MC summaries never override Risk 8.0. The new Monte
    // Carlo component is already reflected in calcResults.u_c and U above.
    const mcSummary = null;
    let mcErrorQuantilesNative = null;
    if (mcSummary) {
      uCal_Native = mcSummary.uBase / targetUnitInfo.to_si;
      U_Native =
        (mcSummary.intervalHighBase - mcSummary.intervalLowBase) /
        2 /
        targetUnitInfo.to_si;
      mcErrorQuantilesNative = mcSummary.quantiles.map(
        (q) => (q - mcSummary.meanBase) / targetUnitInfo.to_si
      );
      // The MC mean is the corrected estimate of the measurand (JCGM 101): at
      // a nonlinear operating point it carries the ½f″u² shift that
      // f(nominals) misses. All risk math below — TUR/TAR centering, PFA/PFR,
      // guard bands — must run on it, not the first-order value.
      const mcMeanNative = unitSystem.fromBaseUnit(
        mcSummary.meanBase,
        nominalUnit
      );
      if (Number.isFinite(mcMeanNative)) riskAverage = mcMeanNative;
    }

    if (unknownMeasurement) {
      const safeRes = resolveResolutionNative(uutToleranceData, nominalUnit);
      const boundary = computeUnknownMeasurementBoundary8({
        tolerance: uutToleranceData,
        // Workbook column J is expanded U_cal for the type-5/6 boundary.
        uCalNative: U_Native,
        reqPFA: pfaRequired,
        resolution: safeRes,
      });
      const summary = toUnknownMeasurementSummary(boundary);
      if (!summary) return;

      const gbInputs = {
        nominal: undefined,
        uutLower: boundary.lowerLimit,
        uutUpper: boundary.upperLimit,
        tmdeLower: undefined,
        tmdeUpper: undefined,
        combUnc: U_Native,
        expandedUncertainty: U_Native,
        uncertaintyKind: "expanded",
        turVal: undefined,
        measRelTarget: undefined,
        calibrationInt: undefined,
        measrelCalcAssumed: undefined,
        initialGB: undefined,
        reqTUR: undefined,
        reqPFA: pfaRequired,
        nominalUnit,
        safeRes,
      };
      const gbResults = {
        GBLOW: summary.gbLow,
        GBLOWMULT: undefined,
        GBUP: summary.gbHigh,
        GBUPMULT: undefined,
        GBMULT: undefined,
        GBPFA: summary.gbPfa,
        GBPFAT1: boundary.direction === "low" ? summary.gbPfa : undefined,
        GBPFAT2: boundary.direction === "high" ? summary.gbPfa : undefined,
        GBPFAUUUT: undefined,
        GBPFAUDEV: undefined,
        GBPFACOR: undefined,
        GBPFR: undefined,
        GBPFRT1: undefined,
        GBPFRT2: undefined,
        GBCALINT: undefined,
        NOGBCALINT: undefined,
        NOGBMEASREL: undefined,
      };

      publishRiskMetrics({
        ...summary,
        LLow: boundary.lowerLimit,
        LUp: boundary.upperLimit,
        ALow: summary.gbLow,
        AUp: summary.gbHigh,
        riskAverage: undefined,
        uCal: U_Native,
        expandedUncertainty: U_Native,
        nativeUnit: nominalUnit,
        gbInputs,
        gbResults,
        risk8: {
          out: boundary.out,
          fields: boundary.fields,
          meta: boundary.meta,
        },
        uutResolution:
          testPointData?.uutTolerance?.measuringResolution?.length || 0,
      });
      return;
    }

    // ... [Logic: UUT Breakdown for TAR] ...
    const uutBreakdownResult = calculateUncertaintyFromToleranceObject(
      uutToleranceData,
      uutNominal
    );
    const uutSpecComponents = uutBreakdownResult.breakdown.filter(
      (comp) =>
        comp.absoluteHigh !== undefined && comp.absoluteLow !== undefined
    );

    const uutBreakdownForTar = uutSpecComponents.map((comp) => {
      const nominalValue = parseFloat(uutNominal.value);
      const highDeviation = comp.absoluteHigh - nominalValue;
      const lowDeviation = comp.absoluteLow - nominalValue;
      const span = highDeviation - lowDeviation;
      return {
        name: `${uutName} - ${comp.name}`,
        span: span,
      };
    });

    // ... [Logic: TMDE Breakdown for TAR] ...
    const tmdeBreakdownForTar = [];
    let missingTmdeRef = false;
    let tmdeToleranceHigh_Native = 0;
    let tmdeToleranceLow_Native = 0;

    if (tmdeTolerancesData.length > 0) {
      const tmdeTotals = tmdeTolerancesData.reduce(
        (acc, tmde) => {
          // Determine the effective reference point: TMDE's own point OR UUT Nominal
          // Must have BOTH value AND unit to be valid
          const hasTmdeMeasurementPoint = tmde.measurementPoint && 
              tmde.measurementPoint.value && 
              tmde.measurementPoint.unit;
          
          const refPoint = hasTmdeMeasurementPoint 
              ? tmde.measurementPoint 
              : uutNominal;

          if (!refPoint || !refPoint.value || !refPoint.unit) {
            missingTmdeRef = true;
            return acc;
          }

          // Handle potential nested tolerance object (same fix as useUncertaintyCalculation)
          const toleranceSource = tmde.tolerance || tmde;

          const { breakdown: tmdeBreakdown } =
            calculateUncertaintyFromToleranceObject(
              toleranceSource,
              refPoint
            );

          const tmdeNominal = parseFloat(refPoint.value);

          const tmdeSpecComponents = tmdeBreakdown.filter(
            (comp) =>
              comp.absoluteHigh !== undefined && comp.absoluteLow !== undefined
          );
          if (tmdeSpecComponents.length === 0) return acc;

          let totalTmdeHighDevInUutNative = 0;
          let totalTmdeLowDevInUutNative = 0;

          // FIX: Use the unit of the effective reference point, not necessarily the TMDE's own unit
          // This ensures that if we fell back to UUT Nominal, we use UUT Nominal's unit.
          const tmdeUnitInfo = unitSystem.units[refPoint.unit];
          if (!tmdeUnitInfo || isNaN(tmdeUnitInfo.to_si)) {
            missingTmdeRef = true;
            return acc;
          }

          tmdeSpecComponents.forEach((comp) => {
            const highDev = comp.absoluteHigh - tmdeNominal;
            const lowDev = comp.absoluteLow - tmdeNominal;
            const compSpan = highDev - lowDev;

            const compSpanInBase = compSpan * tmdeUnitInfo.to_si;
            const compSpanInUutNative = compSpanInBase / targetUnitInfo.to_si;

            if (compSpanInUutNative > 0) {
              tmdeBreakdownForTar.push({
                name: `${tmde.name || "TMDE"} - ${comp.name}`,
                span: compSpanInUutNative,
              });
            }

            const highDevInBase = highDev * tmdeUnitInfo.to_si;
            const highDevInUutNative = highDevInBase / targetUnitInfo.to_si;

            const lowDevInBase = lowDev * tmdeUnitInfo.to_si;
            const lowDevInUutNative = lowDevInBase / targetUnitInfo.to_si;

            totalTmdeHighDevInUutNative += highDevInUutNative;
            totalTmdeLowDevInUutNative += lowDevInUutNative;
          });

          const quantity = parseInt(tmde.quantity, 10) || 1;
          acc.totalHigh += totalTmdeHighDevInUutNative * quantity;
          acc.totalLow += totalTmdeLowDevInUutNative * quantity;

          return acc;
        },
        { totalHigh: 0, totalLow: 0 }
      );

      tmdeToleranceHigh_Native = tmdeTotals.totalHigh;
      tmdeToleranceLow_Native = tmdeTotals.totalLow;
    }

    const tmdeToleranceSpan_Native =
      tmdeToleranceHigh_Native - tmdeToleranceLow_Native;

    if (missingTmdeRef) {
      setNotification({
        title: "Missing Info",
        message: "TMDE missing Reference Point for TAR calculation.",
      });
    }

    // ... [Math Calculations] ...
    let tarResult = calcTAR(
      uutNominal.value,
      riskAverage,
      LLow,
      LUp,
      parseFloat(uutNominal.value) + tmdeToleranceLow_Native,
      parseFloat(uutNominal.value) + tmdeToleranceHigh_Native
    );
    let turResult = calcTUR(
      uutNominal.value,
      riskAverage,
      LLow,
      LUp,
      U_Native
    );

    const knownTwoSided = isKnownTwoSidedTolerance(
      uutNominal.value,
      LLow,
      LUp,
    );

    if (knownSingleSided || knownTwoSided) {
      const safeRes = resolveResolutionNative(uutToleranceData, nominalUnit);
      const sharedRisk8Inputs = {
        nominal: parseFloat(uutNominal.value),
        riskAverage,
        expandedUncertaintyNative: U_Native,
        tur: turResult,
        assumedReop: measRelCalc,
        requiredReop: reliability,
        turNeeded,
        reqPFA: pfaRequired,
        initialGB: parseFloat(sessionData.uncReq.guardBandMultiplier),
        originalInterval: calInt,
        resolution: safeRes,
      };
      const risk8Result = knownSingleSided
        ? computeKnownMeasurementRisk8({
            ...sharedRisk8Inputs,
            tolerance: uutToleranceData,
          })
        : computeKnownTwoSidedRisk8({
            ...sharedRisk8Inputs,
            lowerLimit: LLow,
            upperLimit: LUp,
          });
      const summary = toKnownMeasurementSummary(risk8Result);
      if (!summary) return;

      const gbInputs = {
        nominal: parseFloat(uutNominal.value),
        uutLower: risk8Result.lowerLimit,
        uutUpper: risk8Result.upperLimit,
        tmdeLower: parseFloat(uutNominal.value) + tmdeToleranceLow_Native,
        tmdeUpper: parseFloat(uutNominal.value) + tmdeToleranceHigh_Native,
        combUnc: uCal_Native,
        expandedUncertainty: U_Native,
        turVal: summary.tur,
        measRelTarget: reliability,
        calibrationInt: calInt,
        measrelCalcAssumed: measRelCalc,
        initialGB: parseFloat(sessionData.uncReq.guardBandMultiplier),
        reqTUR: turNeeded,
        reqPFA: pfaRequired,
        nominalUnit,
        safeRes,
      };
      const gbResults = {
        GBLOW: summary.gbLow,
        GBUP: summary.gbHigh,
        GBMULT: summary.gbMult,
        GBPFA: summary.gbPfa,
        GBPFR: summary.gbPfr,
        GBCALINT: summary.gbCalInt,
        NOGBCALINT: summary.noGbCalInt,
        NOGBMEASREL: summary.noGbMeasRel,
      };

      publishRiskMetrics({
        ...summary,
        LLow: risk8Result.lowerLimit,
        LUp: risk8Result.upperLimit,
        ALow: summary.gbLow,
        AUp: summary.gbHigh,
        riskAverage,
        tar: Number.isFinite(Number(tarResult)) ? Number(tarResult) : undefined,
        uCal: uCal_Native,
        expandedUncertainty: U_Native,
        tmdeToleranceSpan: tmdeToleranceSpan_Native,
        tmdeToleranceHigh: tmdeToleranceHigh_Native,
        tmdeToleranceLow: tmdeToleranceLow_Native,
        nominalValue: parseFloat(uutNominal.value),
        uutBreakdownForTar,
        tmdeBreakdownForTar,
        nativeUnit: nominalUnit,
        gbInputs,
        gbResults,
        risk8: {
          out: risk8Result.out,
          fields: risk8Result.fields,
          meta: risk8Result.meta,
          input: risk8Result.input,
          diagnostics: risk8Result.diagnostics,
        },
        uutResolution:
          testPointData?.uutTolerance?.measuringResolution?.length || 0,
      });
      return;
    }

    let [pfaResult, pfa_term1, pfa_term2, uUUT, uDev, cor] = PFAMgr(
      uutNominal.value,
      riskAverage,
      LLow,
      LUp,
      uCal_Native,
      reliability,
      turResult,
      turNeeded
    );
    let [pfrResult, pfr_term1, pfr_term2] = PFRMgr(
      uutNominal.value,
      riskAverage,
      LLow,
      LUp,
      uCal_Native,
      reliability,
      turResult,
      turNeeded
    );

    // Sanitize outputs to prevent UI crashes (empty strings returned on math failure)
    const validateRiskNum = (val) => {
      const num = parseFloat(val);
      return isNaN(num) ? 0 : num;
    };

    pfaResult = validateRiskNum(pfaResult);
    pfa_term1 = validateRiskNum(pfa_term1);
    pfa_term2 = validateRiskNum(pfa_term2);
    uUUT = validateRiskNum(uUUT);
    uDev = validateRiskNum(uDev);
    cor = validateRiskNum(cor);

    pfrResult = validateRiskNum(pfrResult);
    pfr_term1 = validateRiskNum(pfr_term1);
    pfr_term2 = validateRiskNum(pfr_term2);

    // Empirical override: quadrant counts from the MC measurement-error
    // distribution replace the bivariate-normal integrals (per-side terms
    // included, so the breakdown display keeps its low/high split).
    let riskMethod = "closedform";
    if (mcErrorQuantilesNative) {
      const empirical = computeEmpiricalRisk({
        average: riskAverage,
        LLow,
        LUp,
        uCal: uCal_Native,
        errorQuantiles: mcErrorQuantilesNative,
        reliability,
        tur: turResult,
        reqTur: turNeeded,
      });
      if (empirical) {
        pfaResult = empirical.pfa;
        pfa_term1 = empirical.pfaLow;
        pfa_term2 = empirical.pfaHigh;
        pfrResult = empirical.pfr;
        pfr_term1 = empirical.pfrLow;
        pfr_term2 = empirical.pfrHigh;
        uUUT = empirical.uUUT;
        uDev = empirical.uDev;
        cor = empirical.correlation;
        riskMethod = "empirical";
      }
    }

    // Measurement resolution is stored in its own unit; convert it into the
    // native nominal unit so the guard-band rounding grid (resUp/resDwn) matches
    // the unit the limits live in — mirroring Excel's FC, which is already in the
    // limit's unit. Without this the snap-to-resolution step would round on the
    // wrong grid (or be skipped) and the GB Mult would diverge from Excel.
    const safeRes = resolveResolutionNative(uutToleranceData, nominalUnit);

    let gbLow = resDwn(
      gbLowMgr(
        pfaRequired,
        uutNominal.value,
        riskAverage,
        LLow,
        LUp,
        uCal_Native,
        reliability
      )[0],
      safeRes
    );
    let gbLowMult =
      gbLowMgr(
        pfaRequired,
        uutNominal.value,
        riskAverage,
        LLow,
        LUp,
        uCal_Native,
        reliability
      )[1];
    let gbHigh = resUp(
      gbUpMgr(
        pfaRequired,
        uutNominal.value,
        riskAverage,
        LLow,
        LUp,
        uCal_Native,
        reliability
      )[0],
      safeRes
    );
    let gbHighMult =
      gbUpMgr(
        pfaRequired,
        uutNominal.value,
        riskAverage,
        LLow,
        LUp,
        uCal_Native,
        reliability
      )[1];
    let gbMult = GBMultMgr(
      pfaRequired,
      uutNominal.value,
      riskAverage,
      LLow,
      LUp,
      gbLow,
      gbHigh
    );
    let [gbPFA, gbPFAT1, gbPFAT2, gbPFAuUUT, gbPFAuDev, gbPFACor] = PFAwGBMgr(
      uutNominal.value,
      riskAverage,
      LLow,
      LUp,
      uCal_Native,
      reliability,
      gbLow,
      gbHigh
    );
    let [gbPFR, gbPFRT1, gbPFRT2] = PFRwGBMgr(
      uutNominal.value,
      riskAverage,
      LLow,
      LUp,
      uCal_Native,
      reliability,
      gbLow,
      gbHigh
    );

    // Empirical guard band: invert the quadrant-counted PFA instead of the
    // normal closed form. Asymmetric whenever the error distribution is —
    // each limit is guarded in proportion to the error mass that can carry an
    // out-of-tolerance unit past it. Downstream consumers (GB mult, cal
    // interval managers) run on the overridden limits.
    if (riskMethod === "empirical" && mcErrorQuantilesNative && pfaRequired > 0) {
      const empiricalGb = findEmpiricalGuardBand({
        pfaRequired,
        average: riskAverage,
        LLow,
        LUp,
        uCal: uCal_Native,
        errorQuantiles: mcErrorQuantilesNative,
        reliability,
        tur: turResult,
        reqTur: turNeeded,
      });
      if (empiricalGb) {
        gbLow = resDwn(empiricalGb.gbLow, safeRes);
        gbHigh = resUp(empiricalGb.gbUp, safeRes);
        gbLowMult = empiricalGb.mult;
        gbHighMult = empiricalGb.mult;
        gbMult = GBMultMgr(
          pfaRequired,
          uutNominal.value,
          riskAverage,
          LLow,
          LUp,
          gbLow,
          gbHigh
        );
        const empiricalWithGb = computeEmpiricalRisk({
          average: riskAverage,
          LLow,
          LUp,
          accLow: gbLow,
          accUp: gbHigh,
          uCal: uCal_Native,
          errorQuantiles: mcErrorQuantilesNative,
          reliability,
          tur: turResult,
          reqTur: turNeeded,
        });
        if (empiricalWithGb) {
          gbPFA = empiricalWithGb.pfa;
          gbPFAT1 = empiricalWithGb.pfaLow;
          gbPFAT2 = empiricalWithGb.pfaHigh;
          gbPFAuUUT = empiricalWithGb.uUUT;
          gbPFAuDev = empiricalWithGb.uDev;
          gbPFACor = empiricalWithGb.correlation;
          gbPFR = empiricalWithGb.pfr;
          gbPFRT1 = empiricalWithGb.pfrLow;
          gbPFRT2 = empiricalWithGb.pfrHigh;
        }
      }
    }

    let [gbCalInt,gbCalIntObs,gbCalIntPred] = CalIntwGBMgr(
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
      calInt
    );
    let [nogbCalInt,nogbCalIntObs,nogbCalIntPred] = CalIntMgr(
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
      pfaRequired
    );
    let [nogbMeasRel,nogbMeasRelOBS] = CalRelMgr(
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
      pfaRequired
    );
    let gbInputs = {
      nominal: parseFloat(uutNominal.value),
      uutLower: LLow,
      uutUpper: LUp,
      tmdeLower: parseFloat(uutNominal.value) + tmdeToleranceLow_Native,
      tmdeUpper: parseFloat(uutNominal.value) + tmdeToleranceHigh_Native,
      combUnc: uCal_Native,
      turVal: turResult,
      measRelTarget: reliability,
      calibrationInt: calInt,
      measrelCalcAssumed: measRelCalc,
      initialGB: parseFloat(sessionData.uncReq.guardBandMultiplier),
      reqTUR: turNeeded,
      reqPFA: pfaRequired,
      nominalUnit: nominalUnit,
      safeRes: safeRes
    };
    let gbResults = {
      GBLOW: gbLow,
      GBLOWMULT: gbLowMult,
      GBUP: gbHigh,
      GBUPMULT: gbHighMult,
      GBMULT: gbMult * 100,
      GBPFA: gbPFA * 100,
      GBPFAT1: gbPFAT1 * 100,
      GBPFAT2: gbPFAT2 * 100,
      GBPFAUUUT: gbPFAuUUT, 
      GBPFAUDEV: gbPFAuDev, 
      GBPFACOR: gbPFACor,
      GBPFR: gbPFR * 100,
      GBPFRT1: gbPFRT1 * 100,
      GBPFRT2: gbPFRT2 * 100,
      GBCALINT: gbCalInt,
      GBCALINTOBS: gbCalIntObs,
      GBCALINTPRED: gbCalIntPred,
      NOGBCALINT: nogbCalInt,
      NOGBCALINTOBS: nogbCalIntObs,
      NOGBCALINTPRED: nogbCalIntPred,
      NOGBMEASREL: nogbMeasRel * 100,
      NOGBMEASRELOBS: nogbMeasRelOBS * 100,
    };

    const newRiskMetrics = {
      LLow: LLow,
      LUp: LUp,
      // "empirical" = PFA/PFR/guard bands quadrant-counted from the point's
      // Monte Carlo distribution; "closedform" = bivariate-normal workbook
      // math. Lets the UI label the method for auditability.
      riskMethod,
      // Centered measurement-error quantile table (native units) when
      // empirical — the risk visualizer draws its Monte Carlo cloud from this
      // so the plotted quadrants match the reported PFA/PFR.
      errorQuantiles: mcErrorQuantilesNative,
      // The average every risk metric above was computed against (the MC mean
      // for empirical points, else the first-order calculated value). The
      // visualizer centers its truth frame here so plot and numbers agree.
      riskAverage,
      tur: turResult,
      tar: tarResult,
      pfa: pfaResult * 100,
      pfr: pfrResult * 100,
      pfa_term1: (isNaN(pfa_term1) ? 0 : pfa_term1) * 100,
      pfa_term2: (isNaN(pfa_term2) ? 0 : pfa_term2) * 100,
      pfr_term1: (isNaN(pfr_term1) ? 0 : pfr_term1) * 100,
      pfr_term2: (isNaN(pfr_term2) ? 0 : pfr_term2) * 100,
      uCal: uCal_Native,
      uUUT: uUUT,
      uDev: uDev,
      correlation: cor,
      ALow: LLow,
      AUp: LUp,
      expandedUncertainty: U_Native,
      tmdeToleranceSpan: tmdeToleranceSpan_Native,
      tmdeToleranceHigh: tmdeToleranceHigh_Native,
      tmdeToleranceLow: tmdeToleranceLow_Native,
      // Nominal anchor for the TMDE span (matches the value used by calcTAR
      // above). The displayed TMDE absolute limits must be centered on this,
      // NOT on the UUT acceptance-band midpoint, which can be off-nominal when
      // the UUT tolerance is asymmetric or snapped to resolution.
      nominalValue: parseFloat(uutNominal.value),
      uutBreakdownForTar: uutBreakdownForTar,
      tmdeBreakdownForTar: tmdeBreakdownForTar,
      nativeUnit: nominalUnit,
      gbInputs: gbInputs,
      gbResults: gbResults,
      // FIXED: Added safe navigation to prevent crash on deletion
      uutResolution: testPointData?.uutTolerance?.measuringResolution?.length || 0
    };

    // --- INFINITE LOOP FIX ---
    // Compare new results with previous results. Only update state/parent if different.
    publishRiskMetrics(newRiskMetrics);
    
  }, [
    riskInputs.LLow,
    riskInputs.LUp,
    sessionData.uncReq.reqPFA,
    sessionData.uncReq.reliability,
    sessionData.uncReq.calInt,
    sessionData.uncReq.measRelCalcAssumed,
    sessionData.uncReq.neededTUR,
    sessionData.uutDescription,
    uutNominal,
    calcResults,
    uutToleranceData,
    tmdeTolerancesData,
    testPointData?.uutTolerance?.measuringResolution, // FIXED Dependency
    // Risk 8.0 Monte Carlo changes the uncertainty budget, so risk recomputes
    // when its component method or trial count changes.
    testPointData?.budgetPropagationMethod,
    testPointData?.monteCarloTrials,
    onRiskResultsChange,
  ]);

  // --- 3. Trigger Calculation ---
  useEffect(() => {
    const shouldCalculate =
      analysisMode === "risk" ||
      analysisMode === "uncertaintyTool" ||
      analysisMode === "riskmitigation";

    if (shouldCalculate && calcResults) {
      calculateRiskMetrics();
    }

    if (!shouldCalculate) {
      setRiskResults((prevResults) => {
        if (prevResults !== null) {
          onRiskResultsChange?.(null);
          return null;
        }
        return prevResults;
      });
    }
  }, [
    analysisMode,
    calcResults,
    sessionData.uncReq.reliability,
    sessionData.uncReq.guardBandMultiplier,
    sessionData.uncReq.reqPFA,
    sessionData.uncReq.neededTUR,
    sessionData.uncReq.calInt,
    sessionData.uncReq.measRelCalcAssumed,
    riskInputs.LLow,
    riskInputs.LUp,
    calculateRiskMetrics,
    onRiskResultsChange,
  ]);

  return { 
    riskResults, 
    setRiskResults, 
    riskInputs, 
    setRiskInputs, 
    calculateRiskMetrics,
    notification,
    dismissNotification,
  };
};
