/**
 * * This utility file contains helper functions for breaking down tolerance objects
 * * into individual uncertainty budget components.
 */

import { 
  unitSystem, 
  convertToPPM, 
  errorDistributions 
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

export const getBudgetComponentsFromTolerance = (
  rawToleranceObject,
  referenceMeasurementPoint
) => {

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
  let activeDistributionDivisor = 1.732; // Default to Rectangular
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
        const distEntry = errorDistributions.find(
          (d) => parseFloat(d.value) === parseFloat(tolComp.distribution)
        );
        activeDistributionRaw = distEntry
          ? distEntry.value
          : tolComp.distribution != null
          ? String(tolComp.distribution)
          : "1.732";
        activeDistributionDivisor = parseFloat(activeDistributionRaw) || 1.732;
        activeDistributionLabel = distEntry?.label || "Rectangular";
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

  // Floor Value
  totalAccuracyHalfSpan_Base += calculateComponentSpan(
      toleranceObject.floor, "Floor Value", nominalValue
  );

  // Legacy "Readings (IV)" == a raw Floor Value
  totalAccuracyHalfSpan_Base += calculateComponentSpan(
      toleranceObject.readings_iv, "Floor Value", nominalValue
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
        const dbDistEntry = errorDistributions.find(
          (d) => parseFloat(d.value) === parseFloat(toleranceObject.db.distribution)
        );
        const dbDistRaw = dbDistEntry ? dbDistEntry.value : activeDistributionRaw;
        const dbDivisor = parseFloat(dbDistRaw) || activeDistributionDivisor;
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
  // Only included when the instrument/UUT explicitly opted in (#10). Modeled as
  // a rectangular distribution spanning one least-significant-digit, i.e.
  // u = LSD / (2*sqrt(3)).
  const resVal = parseFloat(toleranceObject.measuringResolution);
  if (
    toleranceObject.includeResolutionInBudget &&
    !isNaN(resVal) &&
    resVal > 0
  ) {
    const resUnit = toleranceObject.measuringResolutionUnit || nominalUnit;
    const resBase = unitSystem.toBaseUnit(resVal, resUnit);
    if (!isNaN(resBase) && resBase > 0) {
      // Resolution rounding spans one LSD (half-width = LSD/2). The divisor is
      // user-selectable in the budget table (default Rectangular = 1.732, which
      // gives the conventional LSD/(2*sqrt(3))). distributionDivisor + the
      // isResolution flag let handleComponentUpdate route a change to the
      // resolution itself rather than the accuracy sub-components.
      const resDistEntry = errorDistributions.find(
        (d) =>
          parseFloat(d.value) ===
          parseFloat(toleranceObject.measuringResolutionDistribution),
      );
      const resDistRaw = resDistEntry ? resDistEntry.value : "1.732";
      const resDivisor = parseFloat(resDistRaw) || 1.732;
      const resDistLabel = resDistEntry?.label || "Rectangular";

      const u_i_base = resBase / 2 / resDivisor;
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

  // --- 5. MANUAL TYPE B COMPONENTS ---
  // User-authored Type B components attached to the instrument range/tolerance
  // (added via the instrument builder's ToleranceForm). Stored as raw inputs so
  // they resolve against whichever measurement point the range is used at, just
  // like the accuracy components above. Each is either a tolerance limit (with a
  // distribution divisor) or a directly-entered standard uncertainty.
  const manualComponents = Array.isArray(toleranceObject.manualComponents)
    ? toleranceObject.manualComponents
    : [];
  manualComponents.forEach((mc, idx) => {
    if (!mc || typeof mc !== "object") return;

    const isStandard = mc.inputMode === "standard";
    const rawMagnitude = parseFloat(
      isStandard ? mc.standardUncertainty : mc.toleranceLimit,
    );
    if (isNaN(rawMagnitude) || rawMagnitude <= 0) return;

    const unit = mc.unit;

    // A directly-entered standard uncertainty is already u_i (divisor 1); a
    // tolerance limit is divided by the selected distribution's divisor.
    let distRaw = "1.000";
    let distLabel = "Standard Uncertainty (Input is uᵢ)";
    let divisor = 1;
    if (!isStandard) {
      const distEntry = errorDistributions.find(
        (d) => parseFloat(d.value) === parseFloat(mc.distribution),
      );
      distRaw = distEntry
        ? distEntry.value
        : mc.distribution != null
          ? String(mc.distribution)
          : "1.732";
      divisor = parseFloat(distRaw) || 1.732;
      distLabel = distEntry?.label || "Rectangular";
    }

    // Convert the raw magnitude into SI base units. Relative units (%/ppm/ppb)
    // scale with the point's nominal; absolute units convert directly.
    let magnitudeBase;
    if (["%", "ppm", "ppb"].includes(unit)) {
      const multiplier = unit === "%" ? 0.01 : unit === "ppm" ? 1e-6 : 1e-9;
      if (isNaN(nominalValue)) return;
      const inNominalUnit = rawMagnitude * multiplier * nominalValue;
      magnitudeBase = unitSystem.toBaseUnit(inNominalUnit, nominalUnit);
    } else {
      magnitudeBase = unitSystem.toBaseUnit(rawMagnitude, unit);
    }
    if (isNaN(magnitudeBase)) return;

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

    budgetComponents.push({
      id: `${prefix}_manual_${mc.id || idx}${toleranceObject.id ? `_${toleranceObject.id}` : ""}`,
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
    });
  });

  return budgetComponents;
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
 * resolution block of getBudgetComponentsFromTolerance: u = LSD / (2*divisor).
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
  const resDistRaw = resDistEntry ? resDistEntry.value : "1.732";
  const resDivisor = parseFloat(resDistRaw) || 1.732;
  const resDistLabel = resDistEntry?.label || "Rectangular";

  const u_i_base = resBase / 2 / resDivisor;
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
