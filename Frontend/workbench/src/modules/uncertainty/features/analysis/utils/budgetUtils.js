/**
 * * This utility file contains helper functions for breaking down tolerance objects
 * * into individual uncertainty budget components.
 */

import {
  unitSystem,
  convertToPPM,
  convertPpmToUnit,
  calculateUncertaintyFromToleranceObject,
  errorDistributions,
  DISTRIBUTION_NOT_SET,
  distributionDivisorValue,
  effectiveFloorTerm,
} from "../../../utils/uncertaintyMath";

export const oldErrorDistributions = [
  { value: "1.732", label: "Rectangular" },
  { value: "3.464", label: "Rectangular (Resolution)" },
  { value: "2.449", label: "Triangular" },
  { value: "1.414", label: "U Shaped" },
  { value: "1.645", label: "Normal (90%, k=1.645)" },
  { value: "1.960", label: "Normal (95%, k=1.960)" },
  { value: "2.000", label: "Normal (95.45%, k=2)" },
  { value: "2.576", label: "Normal (99%, k=2.576)" },
  { value: "3.000", label: "Normal (99.73%, k=3)" },
  { value: "4.179", label: "Rayleigh" },
  { value: "1.000", label: "Normal (k=1)" },
];

/**
 * Resolve the instrument-level associated Type B components carried by a TMDE
 * instance. The instrument definition rides on a TMDE under different keys
 * depending on how the instance was assembled (`instrument` for the inline /
 * builder flow, `sourceInstrument` for some derived/legacy instances), so check
 * both, plus a direct `typeBComponents` on the instance itself.
 */
export const resolveInstrumentTypeB = (tmdeLike = {}) => {
  const candidates = [
    tmdeLike?.instrument?.typeBComponents,
    tmdeLike?.sourceInstrument?.typeBComponents,
    tmdeLike?.typeBComponents,
  ];
  const found = candidates.find((c) => Array.isArray(c) && c.length > 0);
  return found || [];
};

const normalizeScopeText = (value) => String(value || "").trim().toLowerCase();

const typeBScopeMatches = (component, scopeContext) => {
  const scope = normalizeScopeText(component?.scope || "instrument");
  if (scope === "instrument" || scope === "entire instrument") return true;
  // A picker can resolve a Type B directly before it has a range context. In
  // that case preserve the explicit selection and let the user add it once;
  // automatic range inclusion below is strict whenever context is available.
  if (!scopeContext) return true;

  const sameFunction = () => {
    if (component.functionId && scopeContext.functionId) {
      return String(component.functionId) === String(scopeContext.functionId);
    }
    if (component.functionName && scopeContext.functionName) {
      return normalizeScopeText(component.functionName) ===
        normalizeScopeText(scopeContext.functionName);
    }
    return false;
  };

  if (scope === "function" || scope === "entire function") {
    return sameFunction();
  }
  if (scope === "range" || scope === "range specific") {
    return sameFunction() &&
      component.rangeId &&
      scopeContext.rangeId &&
      String(component.rangeId) === String(scopeContext.rangeId);
  }
  return true;
};

export const getBudgetComponentsFromTolerance = (
  rawToleranceObject,
  referenceMeasurementPoint,
  // Type B components associated with the whole instrument (e.g. "head pressure"
  // on a pressure gage). These are NOT tied to a single range and are NOT added
  // automatically — the user opts each one in from the budget's "Add to" menu
  // (see addBudgetTypeB). Passing them here resolves them with the same math as
  // the per-range manual components below, against the point's nominal.
  instrumentTypeBComponents = [],
  scopeContext = undefined,
) => {

  const rawScopeSource =
    rawToleranceObject && typeof rawToleranceObject === "object"
      ? rawToleranceObject
      : null;
  const resolvedScopeContext =
    scopeContext !== undefined
      ? scopeContext
      : rawScopeSource &&
          (rawScopeSource.functionId ||
            rawScopeSource.functionName ||
            rawScopeSource.rangeId)
        ? {
            functionId: rawScopeSource.functionId,
            functionName: rawScopeSource.functionName,
            rangeId: rawScopeSource.rangeId,
          }
        : null;

  // --- 1. STRUCTURE NORMALIZATION ---
  let toleranceObject = rawToleranceObject;
  
  if (Array.isArray(toleranceObject)) {
    toleranceObject = toleranceObject[0];
  }

  // NOTE: Automatic resolution handling removed. 
  // Resolution must now be added as a manual component if desired in the budget.

  if (toleranceObject && typeof toleranceObject === 'object') {
     if (toleranceObject.tolerance) {
        toleranceObject = toleranceObject.tolerance;
     } else if (toleranceObject.tolerances) {
        toleranceObject = toleranceObject.tolerances;
     }
  }

  const hasValidValue = referenceMeasurementPoint && 
                        referenceMeasurementPoint.value !== null && 
                        referenceMeasurementPoint.value !== undefined && 
                        referenceMeasurementPoint.value !== "";

  if (
    !toleranceObject ||
    !referenceMeasurementPoint ||
    !hasValidValue ||
    !referenceMeasurementPoint.unit
  ) {
    return [];
  }

  const budgetComponents = [];
  const nominalValue = parseFloat(referenceMeasurementPoint.value);
  const nominalUnit = referenceMeasurementPoint.unit;
  const prefix = toleranceObject.name || "TMDE";

  // --- ACCUMULATORS FOR LINEAR SUM ---
  let totalAccuracyHalfSpan_Base = 0;
  let activeDistributionDivisor = distributionDivisorValue("1.732"); // Rectangular = √3
  let activeDistributionLabel = "Rectangular";
  // Canonical divisor string (matches an errorDistributions value, e.g.
  // "1.960"). The budget-table dropdown round-trips on this exact string.
  let activeDistributionRaw = "1.732";
  // Preserved (instrument-specced) distribution of the accuracy band, captured
  // alongside the active one so the budget table can flag an override.
  let activeSpecDistributionRaw = null;
  let hasAccuracyComponents = false;

  const calculateComponentSpan = (
    tolComp,
    name,
    baseValueForRelative
  ) => {
    // Check for missing data
    if (!tolComp) return 0;
    if (typeof tolComp !== 'object') return 0;

    // Capture distribution from the first valid component we find. Normalize
    // to a canonical errorDistributions entry so the divisor, label, and the
    // round-trip string the dropdown uses all agree.
    if (!hasAccuracyComponents) {
        const rawDistribution =
          tolComp.distribution != null
            ? String(tolComp.distribution)
            : DISTRIBUTION_NOT_SET;
        const distEntry = errorDistributions.find(
          (d) =>
            d.value === rawDistribution ||
            parseFloat(d.value) === parseFloat(rawDistribution)
        );
        activeDistributionRaw = distEntry
          ? distEntry.value
          : rawDistribution;
        activeDistributionDivisor =
          activeDistributionRaw === DISTRIBUTION_NOT_SET
            ? NaN
            : distributionDivisorValue(activeDistributionRaw);
        activeDistributionLabel =
          distEntry?.label ||
          (activeDistributionRaw === DISTRIBUTION_NOT_SET ? "Not Set" : "Rectangular");
        activeSpecDistributionRaw =
          tolComp.specDistribution != null
            ? String(tolComp.specDistribution)
            : null;
    }

    const high = parseFloat(tolComp?.high || 0);
    let low = parseFloat(tolComp?.low || -high);

    // --- FIX: HANDLE POSITIVE LOW VALUES ---
    if (tolComp.symmetric && low > 0) {
        low = -Math.abs(low);
    } else if (low > 0 && high > 0 && Math.abs(high - low) < 1e-9) {
        low = -Math.abs(low);
    }
    
    const halfSpan = (high - low) / 2;
    if (halfSpan === 0) return 0;

    const unit = tolComp.unit;
    let valueInBaseUnits = 0;

    if (["%", "ppm", "ppb"].includes(unit)) {
      let multiplier = 0;
      if (unit === "%") multiplier = 0.01;
      else if (unit === "ppm") multiplier = 1e-6;
      else if (unit === "ppb") multiplier = 1e-9;

      if (isNaN(baseValueForRelative)) return 0;
      
      const absoluteValueInNominalUnit = halfSpan * multiplier * baseValueForRelative;
      valueInBaseUnits = unitSystem.toBaseUnit(absoluteValueInNominalUnit, nominalUnit);
      
    } else {
      valueInBaseUnits = unitSystem.toBaseUnit(halfSpan, unit);
    }

    hasAccuracyComponents = true;
    return valueInBaseUnits;
  };
  
  // --- 1. ACCUMULATE ACCURACY COMPONENTS ---
  // % of Indicated Value
  totalAccuracyHalfSpan_Base += calculateComponentSpan(
      toleranceObject.reading, "% of Indicated Value", nominalValue
  );

  // % Full Scale (relative to Full Scale)
  const rangeFS = parseFloat(toleranceObject.max) || parseFloat(toleranceObject.range?.value);
  totalAccuracyHalfSpan_Base += calculateComponentSpan(
    toleranceObject.range, "% Full Scale", rangeFS
  );

  // ONE effective floor term (floor + its legacy readings_iv alias), value-aware
  // so a blank floor never shadows a real readings_iv (see effectiveFloorTerm).
  totalAccuracyHalfSpan_Base += calculateComponentSpan(
      effectiveFloorTerm(toleranceObject), "Floor Value", nominalValue
  );

  // --- 2. CREATE THE UNIFIED ACCURACY COMPONENT ---
  if (hasAccuracyComponents && totalAccuracyHalfSpan_Base > 0) {
      
      // Calculate Standard Uncertainty (u_i) in Base Units
      const u_i_base = totalAccuracyHalfSpan_Base / activeDistributionDivisor;
      
      // Convert u_i back to Nominal Units for display
      const u_i_native = unitSystem.fromBaseUnit(u_i_base, nominalUnit);
      
      // --- CRITICAL FIX: CONVERT TO PPM FOR CALCULATOR ---
      // The useUncertaintyCalculation hook expects 'value' to be in PPM for Direct Measurements.
      // We calculate PPM here so the RSS summation works correctly.
      
      const nominalBase = unitSystem.toBaseUnit(nominalValue, nominalUnit);
      let finalValuePPM = NaN;
      let isBaseUnitValue = false;

      if (nominalBase !== 0 && !isNaN(nominalBase)) {
          finalValuePPM = (u_i_base / Math.abs(nominalBase)) * 1e6;
          // value is PPM
          isBaseUnitValue = false; 
      } else {
          // Fallback for 0 Nominal (Calculator might struggle, but this keeps data accurate)
          finalValuePPM = u_i_base;
          isBaseUnitValue = true;
      }
      
      const uniqueSuffix = toleranceObject.id ? `_${toleranceObject.id}` : '';
      const componentId = `${prefix}_accuracy${uniqueSuffix}`;

      budgetComponents.push({
        id: componentId,
        name: `${prefix} - Accuracy`,
        type: "B",
        value: finalValuePPM,        // Passing PPM to calculation engine
        isBaseUnitValue: isBaseUnitValue, 
        value_native: u_i_native,    // Passing Absolute to Table Display
        unit_native: nominalUnit,
        dof: Infinity,
        isCore: true,
        distribution: activeDistributionLabel,
        distributionDivisor: activeDistributionRaw,
        specOverride:
          activeSpecDistributionRaw != null &&
          activeSpecDistributionRaw !== activeDistributionRaw,
        specBaseline: {
          distributionOverridden:
            activeSpecDistributionRaw != null &&
            activeSpecDistributionRaw !== activeDistributionRaw,
          distributionLabel:
            errorDistributions.find(
              (d) => d.value === activeSpecDistributionRaw,
            )?.label || activeSpecDistributionRaw,
        },
      });
  }

  // --- 3. HANDLE dB ---
  if (toleranceObject.db && !isNaN(parseFloat(toleranceObject.db.high))) {
      const highDb = parseFloat(toleranceObject.db.high || 0);
      const lowDb = parseFloat(toleranceObject.db.low || -highDb);
      const dbTol = (highDb - lowDb) / 2;

      if (dbTol > 0 && nominalValue > 0) {
        const dbMult = parseFloat(toleranceObject.db.multiplier) || 20;
        const dbRef = parseFloat(toleranceObject.db.ref) || 1;
        
        const dbNominal = dbMult * Math.log10(nominalValue / dbRef);
        const centerDb = (highDb + lowDb) / 2;
        const nominalAtCenterTol = dbRef * Math.pow(10, (dbNominal + centerDb) / dbMult);
        const upperValue = dbRef * Math.pow(10, (dbNominal + highDb) / dbMult);
        const absoluteDeviation = Math.abs(upperValue - nominalAtCenterTol);
  
        const ppm = convertToPPM(absoluteDeviation, nominalUnit, nominalValue, nominalUnit);

        // Use the dB component's own distribution (falling back to the
        // accumulated accuracy distribution). The prior code referenced
        // undefined `distributionDivisor`/`distributionLabel` and threw.
      const rawDbDistribution =
        toleranceObject.db.distribution != null
          ? String(toleranceObject.db.distribution)
          : activeDistributionRaw;
      const dbDistEntry = errorDistributions.find(
        (d) =>
          d.value === rawDbDistribution ||
          parseFloat(d.value) === parseFloat(rawDbDistribution)
      );
      const dbDistRaw = dbDistEntry ? dbDistEntry.value : activeDistributionRaw;
      const dbDivisor =
        dbDistRaw === DISTRIBUTION_NOT_SET
          ? NaN
          : distributionDivisorValue(dbDistRaw) || activeDistributionDivisor;
      const dbLabel = dbDistEntry?.label || activeDistributionLabel;

        if (!isNaN(ppm)) {
          const u_i = Math.abs(ppm / dbDivisor);

          budgetComponents.push({
            id: `${prefix}_db_${toleranceObject.id || "manual"}`,
            name: `${prefix} - dB`,
            type: "B",
            value: u_i,
            value_native: absoluteDeviation / dbDivisor,
            unit_native: nominalUnit,
            dof: Infinity,
            isCore: true,
            distribution: dbLabel,
            distributionDivisor: dbDistRaw,
          });
        }
     }
  }

  // --- 4. OPTIONAL: RESOLUTION COMPONENT ---
  // Only included when the instrument/UUT explicitly opted in (#10). The
  // selected resolution distribution spans one least-significant-digit.
  // The LSD lives under `measuringResolution` (instrument-range tolerances) or
  // `resolution` (inline tables / derived equation tolerances); read both, and
  // mirror the unit/distribution fallbacks the same way.
  const resVal = parseFloat(
    toleranceObject.measuringResolution ?? toleranceObject.resolution,
  );
  if (
    toleranceObject.includeResolutionInBudget &&
    !isNaN(resVal) &&
    resVal > 0
  ) {
    const resUnit =
      toleranceObject.measuringResolutionUnit ||
      toleranceObject.resolutionUnit ||
      nominalUnit;
    const resBase = unitSystem.toBaseUnit(resVal, resUnit);
    if (!isNaN(resBase) && resBase > 0) {
      // Standard distributions apply to the half-LSD error limit. The
      // resolution-specific divisors already incorporate the full LSD.
      const resDistEntry = errorDistributions.find(
        (d) =>
          parseFloat(d.value) ===
          parseFloat(
            toleranceObject.measuringResolutionDistribution ??
              toleranceObject.resolutionDistribution,
          ),
      );
      const resDistRaw = resDistEntry ? resDistEntry.value : "3.464";
      const resDivisor =
        distributionDivisorValue(resDistRaw) || distributionDivisorValue("3.464");
      const resDistLabel = resDistEntry?.label || "Rectangular (resolution)";

      const usesFullLsdDivisor = ["3.464", "4.899"].includes(resDistRaw);
      const u_i_base =
        resBase / (usesFullLsdDivisor ? resDivisor : 2 * resDivisor);
      const u_i_native = unitSystem.fromBaseUnit(u_i_base, nominalUnit);
      const nominalBase = unitSystem.toBaseUnit(nominalValue, nominalUnit);

      let finalValuePPM = NaN;
      let isBaseUnitValue = false;
      if (nominalBase !== 0 && !isNaN(nominalBase)) {
        finalValuePPM = (u_i_base / Math.abs(nominalBase)) * 1e6;
      } else {
        finalValuePPM = u_i_base;
        isBaseUnitValue = true;
      }

      budgetComponents.push({
        id: `${prefix}_resolution${toleranceObject.id ? `_${toleranceObject.id}` : ""}`,
        name: `${prefix} - Resolution`,
        type: "B",
        value: finalValuePPM,
        isBaseUnitValue,
        value_native: u_i_native,
        unit_native: nominalUnit,
        dof: Infinity,
        isCore: true,
        distribution: resDistLabel,
        distributionDivisor: resDistRaw,
        isResolution: true,
      });
    }
  }

  // --- 5. MANUAL / INSTRUMENT-LEVEL TYPE B COMPONENTS ---
  // User-authored Type B components. Stored as raw inputs so they resolve
  // against whichever measurement point the range is used at, just like the
  // accuracy components above. Each is either a tolerance limit (with a
  // distribution divisor) or a directly-entered standard uncertainty.
  //
  // Shared resolver for a "manual-like" Type B component, used for both the
  // per-range manual components (tolerance.manualComponents, authored in the
  // ToleranceForm) and the instrument-level associated components
  // (instrumentTypeBComponents). The `fromInstrument` flag only affects the id
  // namespace + a marker flag so the budget table can route edits to the right
  // source.
  const buildManualLikeComponent = (mc, idx, { fromInstrument = false } = {}) => {
    if (!mc || typeof mc !== "object") return null;

    const isStandard = mc.inputMode === "standard";
    const structuredTolerance =
      !isStandard && mc.tolerance && typeof mc.tolerance === "object" &&
      Object.keys(mc.tolerance).some((key) => mc.tolerance[key]);

    if (structuredTolerance) {
      const resolved = calculateUncertaintyFromToleranceObject(
        mc.tolerance,
        referenceMeasurementPoint,
      );
      if (!Number.isFinite(resolved.standardUncertainty) || resolved.standardUncertainty <= 0) {
        return null;
      }
      const firstBreakdown = resolved.breakdown?.[0];
      const distRaw = firstBreakdown?.divisor
        ? String(firstBreakdown.divisor)
        : DISTRIBUTION_NOT_SET;
      const distLabel = firstBreakdown?.distributionLabel || "Tolerance / Error limits";
      const label = (mc.name && String(mc.name).trim()) || "Manual";
      const valueNative = convertPpmToUnit(
        resolved.standardUncertainty,
        nominalUnit,
        referenceMeasurementPoint,
      );
      const nominalBase = unitSystem.toBaseUnit(nominalValue, nominalUnit);
      return {
        id: `${prefix}_${fromInstrument ? "instrTypeB" : "manual"}_${mc.id || idx}${toleranceObject.id ? `_${toleranceObject.id}` : ""}`,
        name: `${prefix} - ${label}`,
        type: "B",
        value: resolved.standardUncertainty,
        isBaseUnitValue: nominalBase === 0 || !Number.isFinite(nominalBase),
        value_native: valueNative,
        unit_native: nominalUnit,
        dof: Infinity,
        isCore: true,
        distribution: distLabel,
        distributionDivisor: distRaw,
        isManual: true,
        fromInstrument,
        manualSourceId: mc.id ?? idx,
        manualInputMode: "tolerance",
        manualRawValue: mc.tolerance,
        manualUnit: nominalUnit,
        specOverride: false,
        specBaseline: {
          value: mc.tolerance,
          unit: nominalUnit,
          distributionLabel: distLabel,
          valueOverridden: false,
          distributionOverridden: false,
        },
      };
    }

    const rawMagnitude = parseFloat(
      isStandard ? mc.standardUncertainty : mc.toleranceLimit,
    );
    if (isNaN(rawMagnitude) || rawMagnitude <= 0) return null;

    const unit = mc.unit;

    // A directly-entered standard uncertainty is already u_i (divisor 1); a
    // tolerance limit is divided by the selected distribution's divisor.
    let distRaw = "1.000";
    let distLabel = "Standard Uncertainty (Input is uᵢ)";
    let divisor = 1;
    if (!isStandard) {
      const rawManualDistribution =
        mc.distribution != null ? String(mc.distribution) : DISTRIBUTION_NOT_SET;
      const distEntry = errorDistributions.find(
        (d) =>
          d.value === rawManualDistribution ||
          parseFloat(d.value) === parseFloat(rawManualDistribution),
      );
      distRaw = distEntry
        ? distEntry.value
        : rawManualDistribution;
      divisor =
        distRaw === DISTRIBUTION_NOT_SET
          ? NaN
          : distributionDivisorValue(distRaw);
      distLabel =
        distEntry?.label ||
        (distRaw === DISTRIBUTION_NOT_SET ? "Not Set" : "Rectangular");
    }

    // Convert the raw magnitude into SI base units. Relative units (%/ppm/ppb)
    // scale with the point's nominal; absolute units convert directly.
    let magnitudeBase;
    if (["%", "ppm", "ppb"].includes(unit)) {
      const multiplier = unit === "%" ? 0.01 : unit === "ppm" ? 1e-6 : 1e-9;
      if (isNaN(nominalValue)) return null;
      const inNominalUnit = rawMagnitude * multiplier * nominalValue;
      magnitudeBase = unitSystem.toBaseUnit(inNominalUnit, nominalUnit);
    } else {
      magnitudeBase = unitSystem.toBaseUnit(rawMagnitude, unit);
    }
    if (isNaN(magnitudeBase)) return null;

    const u_i_base = Math.abs(magnitudeBase) / divisor;
    const u_i_native = unitSystem.fromBaseUnit(u_i_base, nominalUnit);
    const nominalBase = unitSystem.toBaseUnit(nominalValue, nominalUnit);

    let finalValuePPM = NaN;
    let isBaseUnitValue = false;
    if (nominalBase !== 0 && !isNaN(nominalBase)) {
      finalValuePPM = (u_i_base / Math.abs(nominalBase)) * 1e6;
    } else {
      finalValuePPM = u_i_base;
      isBaseUnitValue = true;
    }

    const label = (mc.name && String(mc.name).trim()) || "Manual";

    // Deviation tracking for the budget-table "!" indicator. When the user
    // tweaks the value or distribution away from the instrument spec, the
    // originally-specced figures are preserved on the component as `spec*`
    // snapshots (see handleComponentUpdate). Compare against them so the row can
    // flag that it no longer matches the found spec.
    const specMagnitude = isStandard
      ? mc.specStandardUncertainty
      : mc.specToleranceLimit;
    const valueOverridden =
      specMagnitude != null &&
      Number(specMagnitude) !== Number(isStandard ? mc.standardUncertainty : mc.toleranceLimit);
    const distributionOverridden =
      !isStandard &&
      mc.specDistribution != null &&
      String(mc.specDistribution) !== String(mc.distribution);
    const specDistLabel =
      errorDistributions.find((d) => parseFloat(d.value) === parseFloat(mc.specDistribution))
        ?.label || mc.specDistribution;

    const idNamespace = fromInstrument ? "instrTypeB" : "manual";

    return {
      id: `${prefix}_${idNamespace}_${mc.id || idx}${toleranceObject.id ? `_${toleranceObject.id}` : ""}`,
      name: `${prefix} - ${label}`,
      type: "B",
      value: finalValuePPM,
      isBaseUnitValue,
      value_native: u_i_native,
      unit_native: nominalUnit,
      dof: Infinity,
      isCore: true,
      distribution: distLabel,
      distributionDivisor: distRaw,
      isManual: true,
      // Marks an instrument-associated Type B (vs a per-range manual component)
      // so the budget table / breakdown can label its origin.
      fromInstrument,
      // Source linkage + raw spec inputs so the budget table can show/edit the
      // entered value and route changes back to this exact manual component.
      manualSourceId: mc.id ?? idx,
      manualInputMode: isStandard ? "standard" : "tolerance",
      manualRawValue: isStandard ? mc.standardUncertainty : mc.toleranceLimit,
      manualUnit: unit,
      specOverride: valueOverridden || distributionOverridden,
      specBaseline: {
        value: specMagnitude,
        unit,
        distributionLabel: specDistLabel,
        valueOverridden,
        distributionOverridden,
      },
    };
  };

  // Per-range manual Type B components authored on the tolerance itself.
  const manualComponents = Array.isArray(toleranceObject.manualComponents)
    ? toleranceObject.manualComponents
    : [];
  manualComponents.forEach((mc, idx) => {
    const comp = buildManualLikeComponent(mc, idx, { fromInstrument: false });
    if (comp) budgetComponents.push(comp);
  });

  // Instrument-level associated Type B components (e.g. head pressure) — added
  // whenever this instrument's accuracy contributes to the budget.
  (Array.isArray(instrumentTypeBComponents) ? instrumentTypeBComponents : []).forEach(
    (mc, idx) => {
      if (!typeBScopeMatches(mc, resolvedScopeContext)) return;
      const comp = buildManualLikeComponent(mc, idx, { fromInstrument: true });
      if (comp) budgetComponents.push(comp);
    },
  );

  return budgetComponents;
};

const sameId = (left, right) =>
  left !== undefined &&
  left !== null &&
  right !== undefined &&
  right !== null &&
  String(left) === String(right);

const instrumentIdentityMatches = (left = {}, right = {}) =>
  Boolean(left.manufacturer || left.model) &&
  String(left.manufacturer || "") === String(right.manufacturer || "") &&
  String(left.model || "") === String(right.model || "");

const normalizeTypeBText = (value) =>
  String(value || "").trim().toLowerCase();

const sameLooseValue = (left, right) => {
  if (left === undefined || left === null || left === "") return false;
  if (right === undefined || right === null || right === "") return false;
  const leftNum = Number(left);
  const rightNum = Number(right);
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
    return Math.abs(leftNum - rightNum) <= Math.max(1e-12, Math.abs(rightNum) * 1e-9);
  }
  return String(left) === String(right);
};

const componentNameMatchesTypeB = (component, typeB) => {
  const typeBName = normalizeTypeBText(typeB?.name);
  if (!typeBName) return false;
  const names = [
    component?.name,
    component?.sourcePointLabel,
    String(component?.sourcePointLabel || "").split(" - ").pop(),
  ].map(normalizeTypeBText);
  return names.includes(typeBName);
};

const storedComponentMatchesTypeB = (component, typeB) => {
  if (!componentNameMatchesTypeB(component, typeB)) return false;
  const original = component?.originalInput || {};
  const mode = original.inputMode === "standard" ? "standard" : "tolerance";
  const typeBMode = typeB?.inputMode === "standard" ? "standard" : "tolerance";
  if (mode !== typeBMode) return false;

  const originalMagnitude =
    mode === "standard"
      ? original.standardUncertainty ?? component.manualRawValue
      : original.toleranceLimit ?? component.manualRawValue;
  const typeBMagnitude =
    mode === "standard" ? typeB?.standardUncertainty : typeB?.toleranceLimit;
  if (!sameLooseValue(originalMagnitude, typeBMagnitude)) return false;

  if (
    original.unit &&
    typeB?.unit &&
    String(original.unit) !== String(typeB.unit)
  ) {
    return false;
  }

  if (
    mode !== "standard" &&
    original.errorDistributionDivisor &&
    typeB?.distribution &&
    !sameLooseValue(original.errorDistributionDivisor, typeB.distribution)
  ) {
    return false;
  }

  return true;
};

const findFreshTypeBListForTmde = (
  sourceTmdeId,
  tmdeTolerances = [],
  sessionTmdes = [],
  instruments = [],
) => {
  const pointInstance = (tmdeTolerances || []).find(
    (tmde) => sameId(tmde?.id, sourceTmdeId) || sameId(tmde?.sourceId, sourceTmdeId),
  );
  const masterId = pointInstance?.sourceId ?? sourceTmdeId;
  const sessionMaster = (sessionTmdes || []).find(
    (tmde) => sameId(tmde?.id, masterId) || sameId(tmde?.sourceId, masterId),
  );
  const sourceInstrument =
    sessionMaster?.instrument ||
    pointInstance?.instrument ||
    pointInstance?.sourceInstrument ||
    {};
  const linkId =
    sourceInstrument.libraryInstrumentId ||
    sourceInstrument.sourceId ||
    sourceInstrument.id;
  const libraryInstrument = (instruments || []).find((instrument) => {
    const candidateLink =
      instrument.libraryInstrumentId || instrument.sourceId || instrument.id;
    return (
      (linkId && sameId(candidateLink, linkId)) ||
      (sourceInstrument.sourceId && sameId(instrument.sourceId, sourceInstrument.sourceId)) ||
      instrumentIdentityMatches(instrument, sourceInstrument)
    );
  });

  const lists = [
    sessionMaster?.instrument?.typeBComponents,
    pointInstance?.instrument?.typeBComponents,
    pointInstance?.sourceInstrument?.typeBComponents,
    pointInstance?.typeBComponents,
    libraryInstrument?.typeBComponents,
  ];
  const list = lists.find((candidate) => Array.isArray(candidate));
  return { list: list || [], sourceFound: Array.isArray(list) };
};

const updateSourcePointLabel = (component, name) => {
  if (!component.variableType) return name;
  const prefix = String(component.sourcePointLabel || "").split(" - ")[0];
  return prefix && prefix !== component.sourcePointLabel
    ? `${prefix} - ${name}`
    : name;
};

const inferLinkedTypeB = (
  component,
  tmdeTolerances = [],
  sessionTmdes = [],
  instruments = [],
) => {
  if (!component?.originalInput || component?.sourceTmdeId) return null;
  const matches = [];
  const seen = new Set();

  (tmdeTolerances || []).forEach((tmde) => {
    const sourceTmdeId = tmde?.id ?? tmde?.sourceId;
    if (sourceTmdeId === undefined || sourceTmdeId === null) return;
    const freshTypeBList = findFreshTypeBListForTmde(
      sourceTmdeId,
      tmdeTolerances,
      sessionTmdes,
      instruments,
    );
    if (!freshTypeBList.sourceFound) return;
    freshTypeBList.list.forEach((candidate) => {
      if (!storedComponentMatchesTypeB(component, candidate)) return;
      const key = `${String(sourceTmdeId)}::${String(candidate?.id)}`;
      if (seen.has(key)) return;
      seen.add(key);
      matches.push({ sourceTmdeId, typeB: candidate });
    });
  });

  return matches.length === 1 ? matches[0] : null;
};

export const refreshLinkedTypeBComponents = ({
  components = [],
  tmdeTolerances = [],
  sessionTmdes = [],
  instruments = [],
  getReferencePoint = () => null,
} = {}) => {
  if (!Array.isArray(components) || components.length === 0) return [];

  return components.map((component) => {
    const inferred = !component?.typeBSourceId
      ? inferLinkedTypeB(component, tmdeTolerances, sessionTmdes, instruments)
      : null;
    const typeBSourceId = component?.typeBSourceId || inferred?.typeB?.id;
    const typeBSourceTmdeId =
      component?.typeBSourceTmdeId || inferred?.sourceTmdeId;

    if (!typeBSourceId || !typeBSourceTmdeId) {
      return component;
    }

    const freshTypeBList = findFreshTypeBListForTmde(
      typeBSourceTmdeId,
      tmdeTolerances,
      sessionTmdes,
      instruments,
    );
    if (!freshTypeBList.sourceFound) return component;
    const freshTypeB = freshTypeBList.list.find((candidate) =>
      sameId(candidate?.id, typeBSourceId),
    );
    if (!freshTypeB) return null;

    const name =
      (freshTypeB.name && String(freshTypeB.name).trim()) ||
      component.name ||
      "Type B";
    const referencePoint = getReferencePoint(component);
    const [resolved] = getBudgetComponentsFromTolerance(
      { name },
      referencePoint,
      [freshTypeB],
    );
    const isStandard = freshTypeB.inputMode === "standard";
    const divisor = String(
      resolved?.distributionDivisor ||
        freshTypeB.distribution ||
        component.originalInput?.errorDistributionDivisor ||
        "1.732",
    );

    return {
      ...component,
      typeBSourceId,
      typeBSourceTmdeId,
      name,
      ...(resolved
        ? {
            value: resolved.value,
            isBaseUnitValue: resolved.isBaseUnitValue,
            value_native: resolved.value_native,
            unit_native: resolved.unit_native,
            distribution: resolved.distribution,
            distributionDivisor: resolved.distributionDivisor,
          }
        : {}),
      sourcePointLabel: updateSourcePointLabel(component, name),
      originalInput: {
        ...(component.originalInput || {}),
        inputMode: isStandard ? "standard" : "tolerance",
        standardUncertainty: freshTypeB.standardUncertainty || "",
        toleranceLimit: freshTypeB.toleranceLimit || "",
        errorDistributionDivisor: divisor,
        unit: freshTypeB.unit,
        useFiniteDof: false,
      },
    };
  }).filter(Boolean);
};

/**
 * Build the single resolution budget component contributed by the *UUT itself*
 * (its measuring resolution / least-significant digit), when the user has ticked
 * "Include resolution in uncertainty budget". This is what replaces the old
 * manually-added "TI Resolution" component.
 *
 * Tolerant of the several shapes a UUT tolerance can take: the flattened test-
 * point object (measuringResolution at top level), a nested `.tolerances`, or an
 * instrument range that carries the value in its `resolution` column.
 *
 * Returns one component (stable `componentId: "UUT Resolution"`, `isResolution`)
 * or null when not opted in / no usable resolution. The math mirrors the
 * resolution block of getBudgetComponentsFromTolerance. Standard distribution
 * divisors describe the half-LSD error limit, while the resolution-specific
 * divisors (sqrt(12), sqrt(24)) already describe the full LSD.
 */
export const getUutResolutionComponent = (
  uutTolerance,
  referenceMeasurementPoint
) => {
  let tol = uutTolerance;
  if (Array.isArray(tol)) tol = tol[0];
  if (!tol || typeof tol !== "object") return null;

  const nested = tol.tolerances && typeof tol.tolerances === "object" ? tol.tolerances : {};

  const optedIn = tol.includeResolutionInBudget ?? nested.includeResolutionInBudget;
  if (!optedIn) return null;

  const hasValidNominal =
    referenceMeasurementPoint &&
    referenceMeasurementPoint.value !== null &&
    referenceMeasurementPoint.value !== undefined &&
    referenceMeasurementPoint.value !== "" &&
    referenceMeasurementPoint.unit;
  if (!hasValidNominal) return null;

  const resVal = parseFloat(
    tol.measuringResolution ?? tol.resolution ?? nested.measuringResolution
  );
  if (isNaN(resVal) || resVal <= 0) return null;

  const nominalValue = parseFloat(referenceMeasurementPoint.value);
  const nominalUnit = referenceMeasurementPoint.unit;
  const resUnit =
    tol.measuringResolutionUnit || nested.measuringResolutionUnit || nominalUnit;
  const resBase = unitSystem.toBaseUnit(resVal, resUnit);
  if (isNaN(resBase) || resBase <= 0) return null;

  const resDistRawSource =
    tol.measuringResolutionDistribution ?? nested.measuringResolutionDistribution;
  const resDistEntry = errorDistributions.find(
    (d) => parseFloat(d.value) === parseFloat(resDistRawSource)
  );
  const resDistRaw = resDistEntry ? resDistEntry.value : "3.464";
  const resDivisor =
    distributionDivisorValue(resDistRaw) || distributionDivisorValue("3.464");
  const resDistLabel = resDistEntry?.label || "Rectangular (resolution)";

  // Do not halve the resolution twice. "Rectangular (resolution)" uses
  // LSD/sqrt(12), and "Triangular (resolution)" uses LSD/sqrt(24). The regular
  // rectangular/triangular options describe a +/- LSD/2 limit and therefore
  // retain the explicit factor of two.
  const usesFullLsdDivisor = ["3.464", "4.899"].includes(resDistRaw);
  const u_i_base = resBase / (usesFullLsdDivisor ? resDivisor : 2 * resDivisor);
  const u_i_native = unitSystem.fromBaseUnit(u_i_base, nominalUnit);
  const nominalBase = unitSystem.toBaseUnit(nominalValue, nominalUnit);

  let finalValuePPM = NaN;
  let isBaseUnitValue = false;
  if (nominalBase !== 0 && !isNaN(nominalBase)) {
    finalValuePPM = (u_i_base / Math.abs(nominalBase)) * 1e6;
  } else {
    finalValuePPM = u_i_base;
    isBaseUnitValue = true;
  }

  return {
    id: "uut_resolution",
    componentId: "UUT Resolution",
    name: "UUT Resolution",
    type: "B",
    value: finalValuePPM,
    isBaseUnitValue,
    value_native: u_i_native,
    unit_native: nominalUnit,
    dof: Infinity,
    isCore: true,
    distribution: resDistLabel,
    distributionDivisor: resDistRaw,
    isResolution: true,
    sourcePointLabel: `${resVal} ${resUnit} LSD`,
  };
};
