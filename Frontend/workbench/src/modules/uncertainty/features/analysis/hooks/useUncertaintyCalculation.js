import { useState, useEffect } from "react";
import {
  unitSystem,
  getKValueFromTDistribution,
  calculateDerivedUncertainty,
  combineWithCorrelation,
  normalQuantile
} from "../../../utils/uncertaintyMath";
import { getBudgetComponentsFromTolerance, getUutResolutionComponent } from "../utils/budgetUtils";
import {
  normalizeRisk8MonteCarloTrials,
  risk8MonteCarloInputHash,
  runRisk8EquationMonteCarlo,
} from "../../../utils/risk8/monteCarloEngine8";

const normalizeDof = (dof) => {
  const parsed = parseFloat(dof);
  return dof === Infinity || dof == null || isNaN(parsed) ? Infinity : parsed;
};

const finiteNumberOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const numericResultChanged = (previous, next, tolerance = 1e-9) => {
  const prevValue = finiteNumberOrNull(previous);
  const nextValue = finiteNumberOrNull(next);
  if (prevValue === null || nextValue === null) return prevValue !== nextValue;
  return Math.abs(prevValue - nextValue) > tolerance;
};

const getTmdeIdentity = (tmde, fallbackIndex = 0) => {
  const instanceName = String(tmde?.name || "").trim();
  const instrumentName = [
    tmde?.instrument?.manufacturer || tmde?.manufacturer,
    tmde?.instrument?.model || tmde?.model,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (
    instanceName &&
    instrumentName &&
    !instanceName.toLowerCase().includes(instrumentName.toLowerCase())
  ) {
    return `${instanceName} (${instrumentName})`;
  }
  return instanceName || instrumentName || `TMDE ${fallbackIndex + 1}`;
};

const getTmdeDisplayName = (tmde, fallbackIndex = 0) => {
  const instrument = tmde?.instrument || tmde || {};
  const manufacturer = instrument.manufacturer || tmde?.manufacturer || "";
  const make =
    instrument.description ||
    instrument.name ||
    tmde?.description ||
    tmde?.name ||
    "";
  const model = instrument.model || tmde?.model || "";
  const parts = [];

  [manufacturer, make, model].forEach((part) => {
    const value = String(part || "").trim();
    if (!value) return;
    if (!parts.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      parts.push(value);
    }
  });

  return parts.join(" ") || getTmdeIdentity(tmde, fallbackIndex);
};

const qualifyTmdeComponent = (component, tmde, fallbackIndex = 0) => {
  const identity = getTmdeIdentity(tmde, fallbackIndex);
  const displayName = getTmdeDisplayName(tmde, fallbackIndex);
  const rawName = String(component?.name || "Uncertainty component");
  const separatorIndex = rawName.lastIndexOf(" - ");
  const componentType =
    separatorIndex >= 0 ? rawName.slice(separatorIndex + 3) : rawName;
  const point = `${tmde?.measurementPoint?.value ?? ""} ${
    tmde?.measurementPoint?.unit ?? ""
  }`.trim();
  const rangeContext = [
    tmde?.functionName,
    tmde?.range && typeof tmde.range !== "object" ? tmde.range : null,
  ]
    .filter(Boolean)
    .join(" / ");

  return {
    ...component,
    name: `${identity} - ${componentType}`,
    sourceDisplayName: displayName,
    tmdeIdentity: identity,
    sourcePointLabel: [point, rangeContext].filter(Boolean).join(" - "),
  };
};

const createMissingTmdeComponent = (
  tmde,
  fallbackIndex = 0,
  suffix = "budget",
) => {
  const identity = getTmdeIdentity(tmde, fallbackIndex);
  const displayName = getTmdeDisplayName(tmde, fallbackIndex);
  const point = `${tmde?.measurementPoint?.value ?? ""} ${
    tmde?.measurementPoint?.unit ?? ""
  }`.trim();
  const rangeContext = [
    tmde?.functionName,
    tmde?.range && typeof tmde.range !== "object" ? tmde.range : null,
  ]
    .filter(Boolean)
    .join(" / ");

  return {
    id: `missing_tmde_${tmde?.id ?? fallbackIndex}_${suffix}`,
    name: `${identity} - Set tolerance`,
    sourceDisplayName: displayName,
    type: "B",
    value: NaN,
    value_native: NaN,
    unit_native: tmde?.measurementPoint?.unit || tmde?.unit || "",
    dof: Infinity,
    distribution: "Set tolerance...",
    sourceTmdeId: tmde?.id,
    tmdeIdentity: identity,
    sourcePointLabel: [point, rangeContext].filter(Boolean).join(" - "),
    quantity: tmde?.quantity || 1,
    missingTolerance: true,
  };
};

const calculateBudgetResults = (
  components,
  confidencePercent,
  valueSelector = (component) => component.value,
  coverageFactorOverride = null,
  applyEffectiveDof = true
) => {
  const validComponents = (components || [])
    .map((component) => ({
      ...component,
      _stdUncertainty: Number(valueSelector(component)),
      _quantity: Number(component.quantity || 1),
    }))
    .filter(
      (component) =>
        Number.isFinite(component._stdUncertainty) &&
        component._stdUncertainty !== 0
    );

  const variance = validComponents.reduce(
    (sum, component) =>
      sum + component._stdUncertainty ** 2 * component._quantity,
    0
  );
  const combined = Math.sqrt(Math.max(0, variance));
  const denominator = validComponents.reduce((sum, component) => {
    const dof = normalizeDof(component.dof);
    return dof === Infinity || dof <= 0
      ? sum
      : sum + Math.pow(component._stdUncertainty, 4) / dof;
  }, 0);
  const effectiveDof = denominator > 0 ? Math.pow(combined, 4) / denominator : Infinity;
  const probability = 1 - (1 - confidencePercent / 100) / 2;
  const override = Number(coverageFactorOverride);
  const kValue =
    Number.isFinite(override) && override > 0
      ? override
      : !applyEffectiveDof || effectiveDof === Infinity || isNaN(effectiveDof)
      ? normalQuantile(probability)
      : getKValueFromTDistribution(effectiveDof, probability);

  return {
    combined,
    effective_dof: effectiveDof,
    k_value: kValue,
    expanded: combined * kValue,
  };
};

const componentStandardUncertaintyBase = (
  component,
  fallbackUnit,
  nominalValue,
  nominalUnit
) => {
  if (
    component.value_native !== undefined &&
    component.value_native !== null &&
    component.unit_native
  ) {
    return unitSystem.toBaseUnit(component.value_native, component.unit_native);
  }

  if (component.isBaseUnitValue && Number.isFinite(Number(component.value))) {
    return Number(component.value);
  }

  const value = Number(component.value);
  if (!Number.isFinite(value)) return NaN;

  const unit = component.unit || fallbackUnit;
  if (unit && unitSystem.units[unit]?.to_si && unit !== "ppm") {
    return unitSystem.toBaseUnit(value, unit);
  }

  const nominalBase = unitSystem.toBaseUnit(nominalValue, nominalUnit);
  return Number.isFinite(nominalBase) ? (value / 1e6) * Math.abs(nominalBase) : NaN;
};

export const useUncertaintyCalculation = (
  testPointData,
  sessionData,
  tmdeTolerancesData,
  uutToleranceData,
  uutNominal,
  manualComponents,
  onDataSave
) => {
  const [calcResults, setCalcResults] = useState(null);
  const [calculationError, setCalculationError] = useState(null);

  useEffect(() => {
    let combinedUncertaintyPPM = NaN;
    let combinedUncertaintyAbsoluteBase = NaN;
    let effectiveDof = Infinity;
    const componentsForBudgetTable = [];
    let calculatedNominalResult = NaN;
    let derivedSecondOrder = null;
    let derivedUcInputs_Native = 0;
    let derivedUcInputs_Base = 0;
    let calculatedBudgetGroups = [];
    let monteCarloResult = null;

    try {
      setCalculationError(null);

      // --- 1. EARLY EXIT: EMPTY STATE ---
      if (!uutNominal || 
          uutNominal.value === "" || 
          uutNominal.value === null || 
          uutNominal.value === undefined || 
          !uutNominal.unit) {
            
        setCalcResults(null);
        
        if (testPointData.is_detailed_uncertainty_calculated) {
          onDataSave({
            combined_uncertainty: null,
            effective_dof: null,
            k_value: null,
            expanded_uncertainty: null,
            is_detailed_uncertainty_calculated: false,
            calculatedBudgetComponents: [],
            calculatedBudgetGroups: [],
            calculatedNominalValue: null,
          });
        }
        return; 
      }

      const hasVariables =
        testPointData.variableMappings &&
        Object.keys(testPointData.variableMappings).length > 0;
      const noTmdes = !tmdeTolerancesData || tmdeTolerancesData.length === 0;

      const noManuals = !manualComponents || manualComponents.length === 0;
      const hasVariableNominals = Object.values(
        testPointData.variableNominals || {}
      ).some(
        (nominal) =>
          nominal &&
          nominal.value !== "" &&
          nominal.value !== null &&
          nominal.value !== undefined &&
          nominal.unit
      );

      if (
        testPointData.measurementType === "derived" &&
        hasVariables &&
        noTmdes && 
        noManuals &&
        !hasVariableNominals
      ) {
        setCalcResults(null);
        if (testPointData.is_detailed_uncertainty_calculated) {
          onDataSave({
            combined_uncertainty: null,
            effective_dof: null,
            k_value: null,
            expanded_uncertainty: null,
            is_detailed_uncertainty_calculated: false,
            calculatedBudgetComponents: [],
            calculatedBudgetGroups: [],
            calculatedNominalValue: null,
          });
        }
        return;
      }

      // --- 2. VALIDATION: UNIT COMPATIBILITY ---
      const derivedNominalValue = parseFloat(uutNominal.value);
      const derivedNominalUnit = uutNominal.unit;
      const targetUnitInfo = unitSystem.units[derivedNominalUnit];

      if (!targetUnitInfo || isNaN(targetUnitInfo.to_si)) {
        throw new Error(
          `Derived unit '${derivedNominalUnit}' is not valid or has no SI conversion.`
        );
      }

      const confidencePercent =
        parseFloat(sessionData.uncReq.uncertaintyConfidence) || 95;
      // One-sided upper probability for a two-sided coverage interval. Drives
      // both the normal quantile (ν = ∞) and the Student-t quantile (finite ν).
      const probability = 1 - (1 - confidencePercent / 100) / 2;
      // Effective DOF is toggled independently per (sub)budget. The flag map is
      // keyed by a stable group key: the variableType for input subbudgets,
      // "equation" for the measurement-equation budget, and "final" for the
      // final budget (also used by direct measurements, which have only it).
      // Default ON — a no-op for pure Type-B budgets (ν_eff = ∞ ⇒ k = z).
      const dofGroupFlags = testPointData.useEffectiveDofByGroup || {};
      const applyDofForGroup = (key) => dofGroupFlags[key] !== false;
      const manualCoverageFactor =
        testPointData.coverageFactorMode === "manual"
          ? parseFloat(testPointData.coverageFactorOverride)
          : null;
      const normalCoverageFactor = normalQuantile(probability);
      // Derived equations expose the workbook's Taylor/Monte Carlo choices.
      // Direct budgets are RSS-only; normalize any legacy direct Monte Carlo
      // state back to "linear" so old sessions follow the workbook workflow.
      const propagationMethod =
        testPointData.measurementType === "derived" &&
        testPointData.budgetPropagationMethod === "montecarlo"
          ? "montecarlo"
          : testPointData.measurementType === "derived"
            ? "equation"
            : "linear";
      const monteCarloTrials =
        propagationMethod === "montecarlo"
          ? normalizeRisk8MonteCarloTrials(testPointData.monteCarloTrials)
          : 10000;

      if (testPointData.measurementType === "derived") {

        // NOTE: we intentionally do NOT bail when an individual mapped TMDE has
        // an empty value. With additive composition a variable can carry several
        // sources (e.g. stacked deadweights), and one being mid-entry must not
        // blank the whole budget. calculateDerivedUncertainty skips empty-valued
        // sources, and a variable left with NO valued source comes back as
        // `missingInputs` (handled below) — the proper "user is still typing"
        // signal — instead of an all-or-nothing guard on every source.

        const derivedCalculationResult = calculateDerivedUncertainty(
          testPointData.equationString,
          testPointData.variableMappings,
          tmdeTolerancesData,
          { ...uutNominal, variableNominals: testPointData.variableNominals || {} },
          manualComponents,
          {
            strictUnitValidation: true,
            allowFiniteDifference:
              propagationMethod === "montecarlo",
          },
        );

        if (derivedCalculationResult.missingInputs) {
          setCalcResults(null);
          setCalculationError(null); 
          
          if (testPointData.is_detailed_uncertainty_calculated) {
            onDataSave({
              combined_uncertainty: null,
              effective_dof: null,
              k_value: null,
              expanded_uncertainty: null,
              is_detailed_uncertainty_calculated: false,
              calculatedBudgetComponents: [],
              calculatedBudgetGroups: [],
              calculatedNominalValue: null,
            });
          }
          return;
        }

        const {
          combinedUncertaintyNative,
          breakdown: derivedBreakdown,
          nominalResult,
          error: calcError,
        } = derivedCalculationResult;
        
        const monteCarloCanReplaceDegenerateTaylor =
          propagationMethod === "montecarlo" &&
          derivedCalculationResult.degenerate &&
          Array.isArray(derivedBreakdown) &&
          derivedBreakdown.length > 0;
        if (calcError && !monteCarloCanReplaceDegenerateTaylor) {
          throw new Error(calcError);
        }
        if (isNaN(combinedUncertaintyNative) && !monteCarloCanReplaceDegenerateTaylor) {
          throw new Error(
            "Derived uncertainty calculation (inputs) resulted in NaN."
          );
        }
        derivedUcInputs_Native = monteCarloCanReplaceDegenerateTaylor
          ? 0
          : combinedUncertaintyNative;
        derivedUcInputs_Base = derivedUcInputs_Native * targetUnitInfo.to_si;

        calculatedNominalResult = nominalResult;
        // Second-order Taylor summary (u including ½f″u² terms + mean shift)
        // for the derived breakdown modal. Display-only diagnostics — the
        // budget itself stays first-order (Monte Carlo mode is the
        // authoritative correction path).
        derivedSecondOrder = derivedCalculationResult.secondOrder || null;

        // Unified list of SIGNED contributions in base SI units (equation inputs
        // + non-mapped manual components). combineWithCorrelation applies the
        // optional correlation matrix; an empty map yields the prior RSS.
        const inputCorrelations = testPointData.inputCorrelations || {};
        const mappedVariableTypes = new Set(
          Object.values(testPointData.variableMappings || {}).filter(Boolean)
        );
        const signedContribsBase = [];
        // Just the measurement-equation inputs (no manual / UUT-resolution
        // components), so the equation budget's combined uncertainty can be
        // combined with the SAME correlation matrix the final budget uses.
        const equationSignedContribsBase = [];
        const additionalSignedContribsBase = [];

        const inputBudgetGroups = [];

        derivedBreakdown.forEach((item, index) => {
            signedContribsBase.push({
                id: item.componentId,
                contribution: item.contribution_base_signed,
            });
            equationSignedContribsBase.push({
                id: item.componentId,
                contribution: item.contribution_base_signed,
            });

            const contributingTmde = tmdeTolerancesData.find(
                (tmde) => tmde.variableType === item.type
            );
            
            const contributingManual = !contributingTmde 
                ? manualComponents.find(m => (m.variableType || m.name) === item.type) 
                : null;

            let distributionLabel = "N/A";
            let distributionDivisor;
            if (contributingTmde) {
                // Capture both the display label AND the canonical divisor so the
                // budget-table distribution dropdown can round-trip and write the
                // change back to this TMDE (mirrors the direct path).
                const tmdeBudgetComp = getBudgetComponentsFromTolerance(
                    contributingTmde,
                    contributingTmde.measurementPoint
                )[0];
                distributionLabel = tmdeBudgetComp?.distribution || "N/A";
                distributionDivisor = tmdeBudgetComp?.distributionDivisor;
            } else if (contributingManual) {
                distributionLabel = contributingManual.distribution || "Normal (k=2)";
            }

            const allContributingTmdes = tmdeTolerancesData.filter(
                (tmde) => tmde.variableType === item.type
            );
            const inputBudgetComponents = allContributingTmdes.flatMap(
                (tmde, tmdeIndex) => {
                    const components = getBudgetComponentsFromTolerance(
                        tmde,
                        tmde.measurementPoint
                    );
                    const baseComponents = components.length === 0
                        ? [
                            createMissingTmdeComponent(
                                tmde,
                                tmdeIndex,
                                item.variable,
                            ),
                        ]
                        : components.map((component) =>
                            qualifyTmdeComponent(component, tmde, tmdeIndex)
                        );
                    const quantity = Math.max(
                        1,
                        Math.floor(Number(tmde.quantity) || 1),
                    );
                    return Array.from({ length: quantity }, (_, useIndex) =>
                        baseComponents.map((component, compIndex) => ({
                            ...component,
                            id: `${component.id}_${item.variable}_${tmdeIndex}_${compIndex}_${useIndex}`,
                            sourceTmdeId: tmde.id,
                            quantity: 1,
                            budgetUseIndex: useIndex,
                        }))
                    ).flat();
                }
            );
            const mappedManualComponents = (manualComponents || [])
              .filter((comp) => (comp.variableType || "") === item.type)
              .map((comp, compIndex) => ({
                ...comp,
                id: comp.id || `manual_${item.variable}_${compIndex}`,
                sourcePointLabel: comp.sourcePointLabel || "Manual",
                quantity: comp.quantity || 1,
              }));
            const inputBudgetResults = calculateBudgetResults(
                [...inputBudgetComponents, ...mappedManualComponents],
                confidencePercent,
                (component) =>
                    component.value_native !== undefined
                        ? component.value_native
                        : component.value,
                manualCoverageFactor,
                applyDofForGroup(item.type)
            );
            inputBudgetGroups.push({
                id: `input_${item.variable}_${index}`,
                kind: "input",
                label: `${item.type} Uncertainty Budget`,
                variable: item.variable,
                variableType: item.type,
                unit: item.unit,
                nominalValue: item.nominal,
                nominalPoint: { value: item.nominal, unit: item.unit },
                components: [...inputBudgetComponents, ...mappedManualComponents],
                results: inputBudgetResults,
            });

            componentsForBudgetTable.push({
                id: `derived_${item.variable}_${index}`,
                componentId: item.componentId, // correlation-map identity
                variable: item.variable,
                variableType: item.type,
                name: `Input: ${item.type} (${item.variable})`,
                type: "B",
                value: item.ui_absolute_base,
                unit: item.unit,
                isBaseUnitValue: true,
                sensitivityCoefficient: item.ci,
                derivativeString: item.derivativeString,
                contribution: item.contribution_native,
                nonlinearityWarning: item.nonlinearityWarning || null,
                // Second-order Taylor diagnostics for the breakdown modal
                // (null for inputs the equation is effectively linear in).
                secondDerivativeString: item.secondDerivativeString || null,
                secondDerivativeValue: item.secondDerivative_display ?? null,
                secondOrderContribution: item.secondOrderTerm_native ?? null,
                secondOrderShift: item.secondOrderShift_native ?? null,
                dof: inputBudgetResults.effective_dof,
                isCore: true,
                distribution: distributionLabel,
                distributionDivisor: distributionDivisor,
                // Link back to the contributing TMDE so a distribution change in
                // the budget table recalculates this derived input row too (#6).
                sourceTmdeId: contributingTmde?.id,
                sourcePointLabel: `${item.nominal} ${item.unit || ""}`,
                // This is one propagation summary. Repeated physical sources
                // are already materialized as individual input-budget rows.
                quantity: 1,
            });
        });

        if (manualComponents && manualComponents.length > 0) {
            manualComponents.forEach((comp, idx) => {
                const varType = comp.variableType || comp.name;
                const isMappedVariable = mappedVariableTypes.has(varType);

                if (!isMappedVariable) {
                    const absUncNative = (comp.value / 1e6) * Math.abs(derivedNominalValue);
                    const absUncBase = absUncNative * targetUnitInfo.to_si;

                    if (!isNaN(absUncNative)) {
                        signedContribsBase.push({
                            id: varType,
                            contribution: absUncBase,
                        });
                        additionalSignedContribsBase.push({
                            id: varType,
                            contribution: absUncBase,
                        });

                        componentsForBudgetTable.push({
                            ...comp,
                            id: comp.id || `manual_derived_${idx}`,
                            componentId: varType, // correlation-map identity
                            sourcePointLabel: "Manual",
                            value: absUncBase, 
                            unit: derivedNominalUnit,
                            isBaseUnitValue: true,
                            sensitivityCoefficient: 1, 
                            contribution: absUncNative,
                            dof: comp.dof || Infinity,
                            isCore: false
                        });
                    }
                }
            });
        }

        // The UUT's own measuring resolution, when opted in, joins the budget as
        // a standalone component (replaces the old manual "TI Resolution").
        const uutResComp = getUutResolutionComponent(uutToleranceData, uutNominal);
        if (uutResComp) {
            const absUncNative = (uutResComp.value / 1e6) * Math.abs(derivedNominalValue);
            const absUncBase = absUncNative * targetUnitInfo.to_si;
            if (!isNaN(absUncBase)) {
                signedContribsBase.push({
                    id: uutResComp.componentId,
                    contribution: absUncBase,
                });
                additionalSignedContribsBase.push({
                    id: uutResComp.componentId,
                    contribution: absUncBase,
                });
                componentsForBudgetTable.push({
                    ...uutResComp,
                    value: absUncBase,
                    unit: derivedNominalUnit,
                    isBaseUnitValue: true,
                    sensitivityCoefficient: 1,
                    contribution: absUncNative,
                });
            }
        }

        // The measurement-equation uncertainty IS the correlated combination of
        // its input contributions. Previously it reported the plain RSS while
        // the final budget (and therefore the risk metrics) used the correlated
        // value — so adding a correlation moved the risk numbers without any
        // visible change in the equation table. Recompute it here with the same
        // matrix (an empty map reduces to the prior RSS, so uncorrelated budgets
        // are unaffected) and keep the RSS around to surface the delta.
        const uncorrelatedEquationInputsBase = derivedUcInputs_Base;
        const correlatedEquationInputsBase = combineWithCorrelation(
          equationSignedContribsBase,
          inputCorrelations
        );
        derivedUcInputs_Base = correlatedEquationInputsBase;
        derivedUcInputs_Native = correlatedEquationInputsBase / targetUnitInfo.to_si;
        const correlationAffectsEquation =
          Number.isFinite(uncorrelatedEquationInputsBase) &&
          uncorrelatedEquationInputsBase > 0 &&
          Math.abs(
            correlatedEquationInputsBase - uncorrelatedEquationInputsBase
          ) /
            uncorrelatedEquationInputsBase >
            1e-9;

        let equationRows = componentsForBudgetTable
          .filter((component) => component.name.startsWith("Input:"))
          .map((component) => ({
            id: component.id,
            variable: component.variable,
            variableType: component.variableType,
            name: component.name.replace(/^Input:\s*/, ""),
            nominalValue: component.sourcePointLabel,
            dof: component.dof,
            standardUncertainty: component.value,
            unit: component.unit,
            sensitivityCoefficient: component.sensitivityCoefficient,
            contribution: component.contribution,
            contributionSignedBase: signedContribsBase.find(
              (signed) => signed.id === component.componentId
            )?.contribution,
          }));

        const equationDenominator = equationRows.reduce((sum, row) => {
          const dof = normalizeDof(row.dof);
          const signedBase = Number(row.contributionSignedBase);
          return dof === Infinity || dof <= 0 || !Number.isFinite(signedBase)
            ? sum
            : sum + Math.pow(Math.abs(signedBase), 4) / dof;
        }, 0);

        // Risk 8.0 Monte Carlo replaces ONLY the calculated measurement-
        // equation contribution.  Additional final-budget sources (for example
        // UUT resolution) remain separate rows and are combined afterwards.
        // Every equation input is sampled as one correlated Normal parameter
        // using its input budget's combined standard uncertainty, exactly as
        // frmCalEquationUncertainty does in the workbook.
        let equationContributionBase = correlatedEquationInputsBase;
        if (propagationMethod === "montecarlo") {
          const monteCarloInputs = derivedBreakdown.map((item) => ({
              symbol: item.variable,
              componentId: item.componentId,
              meanBase: unitSystem.toBaseUnit(item.nominal, item.unit),
              standardUncertaintyBase: item.ui_absolute_base,
          }));
          const monteCarloHash = risk8MonteCarloInputHash({
            equationString: testPointData.equationString,
            inputs: monteCarloInputs,
            correlations: inputCorrelations,
            trials: monteCarloTrials,
          });
          const cachedMonteCarlo = testPointData.risk8MonteCarloResult;
          monteCarloResult =
            cachedMonteCarlo?.hash === monteCarloHash &&
            Array.isArray(cachedMonteCarlo?.correlationMatrix) &&
            Array.isArray(cachedMonteCarlo?.choleskyMatrix)
              ? cachedMonteCarlo
              : {
                  ...runRisk8EquationMonteCarlo({
                    equationString: testPointData.equationString,
                    inputs: monteCarloInputs,
                    correlations: inputCorrelations,
                    trials: monteCarloTrials,
                  }),
                  hash: monteCarloHash,
                };
          equationContributionBase = monteCarloResult.standardUncertaintyBase;
          calculatedNominalResult = unitSystem.fromBaseUnit(
            monteCarloResult.nominalResultBase,
            derivedNominalUnit,
          );
          derivedUcInputs_Base = equationContributionBase;
          derivedUcInputs_Native = equationContributionBase / targetUnitInfo.to_si;
          equationRows = equationRows.map((row, index) => ({
            ...row,
            influence: monteCarloResult.influenceFractions[index],
          }));
        }

        const equationEffectiveDof =
          equationDenominator > 0 && equationContributionBase > 0
            ? Math.pow(equationContributionBase, 4) / equationDenominator
            : Infinity;
        effectiveDof = equationEffectiveDof;
        const equationK =
          Number.isFinite(manualCoverageFactor) && manualCoverageFactor > 0
            ? manualCoverageFactor
            : !applyDofForGroup("equation") || effectiveDof === Infinity || isNaN(effectiveDof)
            ? normalCoverageFactor
            : getKValueFromTDistribution(effectiveDof, probability);

        const propagationComponent = {
                id:
                  propagationMethod === "montecarlo"
                    ? "risk8_monte_carlo_uncertainty"
                    : "measurement_equation_uncertainty",
                name:
                  propagationMethod === "montecarlo"
                    ? "Monte Carlo Approximation"
                    : "Taylor Series Approximation",
                type: "B",
                value: equationContributionBase / targetUnitInfo.to_si,
                value_native: equationContributionBase / targetUnitInfo.to_si,
                unit_native: derivedNominalUnit,
                dof: equationEffectiveDof,
                isCore: true,
                isPropagationSummary: true,
                propagationMethod,
                trials:
                  propagationMethod === "montecarlo"
                    ? monteCarloResult.trials
                    : undefined,
                // The approximation is already a standard uncertainty.  Its
                // budget tolerance is therefore the same number (k = 1).
                distribution: "Standard uncertainty (k=1)",
                distributionDivisor: 1,
                sourcePointLabel: "Measurement Equation",
              };

        if (propagationMethod === "equation") {
          // Preserve the established linear-budget correlation behavior.
          combinedUncertaintyAbsoluteBase = combineWithCorrelation(
            signedContribsBase,
            inputCorrelations,
          );
        } else {
          const finalContributions = [...additionalSignedContribsBase];
          finalContributions.unshift({
            id: propagationComponent.id,
            contribution: equationContributionBase,
          });
          combinedUncertaintyAbsoluteBase = combineWithCorrelation(
            finalContributions,
            inputCorrelations,
          );
        }

        if (
          !isNaN(derivedNominalValue) &&
          derivedNominalUnit &&
          derivedNominalValue !== 0
        ) {
          const derivedNominalInBase = unitSystem.toBaseUnit(
            derivedNominalValue,
            derivedNominalUnit,
          );
          if (!isNaN(derivedNominalInBase) && derivedNominalInBase !== 0) {
            combinedUncertaintyPPM =
              (combinedUncertaintyAbsoluteBase /
                Math.abs(derivedNominalInBase)) *
              1e6;
          }
        }

        const finalBudgetComponents = [
          propagationComponent,
          ...componentsForBudgetTable.filter(
            (component) =>
              !component.name.startsWith("Input:") &&
              !mappedVariableTypes.has(component.variableType)
          ),
        ];
        const finalDofDenominator = finalBudgetComponents.reduce((sum, comp) => {
          const dof = normalizeDof(comp.dof);
          const stdBase = componentStandardUncertaintyBase(
            comp,
            derivedNominalUnit,
            derivedNominalValue,
            derivedNominalUnit
          );
          return dof === Infinity || dof <= 0 || !Number.isFinite(stdBase)
            ? sum
            : sum + Math.pow(stdBase, 4) / dof;
        }, 0);
        const finalEffectiveDof =
          finalDofDenominator > 0
            ? Math.pow(combinedUncertaintyAbsoluteBase, 4) / finalDofDenominator
            : Infinity;
        const finalK =
          Number.isFinite(manualCoverageFactor) && manualCoverageFactor > 0
            ? manualCoverageFactor
            : !applyDofForGroup("final") || finalEffectiveDof === Infinity || isNaN(finalEffectiveDof)
            ? normalCoverageFactor
            : getKValueFromTDistribution(finalEffectiveDof, probability);
        effectiveDof = finalEffectiveDof;
        calculatedBudgetGroups = [
          ...inputBudgetGroups,
          {
            id: "measurement_equation",
            kind: "equation",
            label:
              propagationMethod === "montecarlo"
                ? "Monte Carlo Approximation"
                : "Taylor Series Approximation",
            unit: derivedNominalUnit,
            rows: equationRows,
            method: propagationMethod,
            trials: monteCarloResult?.trials,
            // Surface the correlation effect: whether the combined value below
            // includes off-diagonal terms, and the plain RSS for comparison.
            correlationApplied: correlationAffectsEquation,
            uncorrelatedCombined:
              uncorrelatedEquationInputsBase / targetUnitInfo.to_si,
            results: {
              combined: derivedUcInputs_Native,
              effective_dof: equationEffectiveDof,
              k_value: equationK,
              expanded: derivedUcInputs_Native * equationK,
            },
          },
          {
            id: "final_budget",
            kind: "final",
            label: `${uutNominal.name || "Final"} Uncertainty Budget`,
            unit: derivedNominalUnit,
            components: finalBudgetComponents,
            results: {
              combined: combinedUncertaintyAbsoluteBase / targetUnitInfo.to_si,
              effective_dof: finalEffectiveDof,
              k_value: finalK,
              expanded:
                (combinedUncertaintyAbsoluteBase / targetUnitInfo.to_si) * finalK,
            },
          },
        ];
      } else {
        // --- DIRECT MEASUREMENT LOGIC ---
        
        let totalVariancePPM = 0;
        let totalVarianceBase = 0;

        tmdeTolerancesData.forEach((tmde, tmdeIndex) => {
          if (
            uutNominal &&
            uutNominal.value !== "" &&
            uutNominal.value !== null &&
            uutNominal.value !== undefined
          ) {
            const quantity = Math.max(
              1,
              Math.floor(Number(tmde.quantity) || 1),
            );
            const components = getBudgetComponentsFromTolerance(
              tmde,
              uutNominal
            );
            const baseQualifiedComponents =
              components.length === 0
                ? [createMissingTmdeComponent(tmde, tmdeIndex, "direct")]
                : components.map((c, compIndex) => ({
                    ...qualifyTmdeComponent(c, tmde, tmdeIndex),
                    id: `${c.id}_${tmdeIndex}_${compIndex}`,
                    // Keep a link back to the originating TMDE instance so the budget
                    // table's distribution dropdown can write the divisor back to the
                    // tolerance and trigger a recalculation (#6).
                    sourceTmdeId: tmde.id,
                    sourcePointLabel: [
                      `${uutNominal.value} ${uutNominal.unit}`,
                      tmde.functionName,
                    ]
                      .filter(Boolean)
                      .join(" - "),
                    quantity: 1,
                  }));
            // Legacy sessions represented repeated uses as `quantity` on one
            // TMDE instance. Materialize those uses as individual calculated
            // rows so they remain independently visible in the table/chart.
            const qualifiedComponents = Array.from(
              { length: quantity },
              (_, useIndex) =>
                baseQualifiedComponents.map((component, compIndex) => ({
                  ...component,
                  id: `${component.id}_${compIndex}_${useIndex}`,
                  quantity: 1,
                  budgetUseIndex: useIndex,
                })),
            ).flat();

            componentsForBudgetTable.push(...qualifiedComponents);

            qualifiedComponents.forEach((comp) => {
              const compValue = Number(comp.value);
              if (Number.isFinite(compValue)) {
                if (!comp.isBaseUnitValue) totalVariancePPM += compValue ** 2;
              }
              const compBase = componentStandardUncertaintyBase(
                comp,
                derivedNominalUnit,
                derivedNominalValue,
                derivedNominalUnit,
              );
              if (Number.isFinite(compBase)) {
                totalVarianceBase += compBase ** 2;
              }
            });
          }
        });

        const manual = manualComponents.map((c) => ({
          ...c,
          sourcePointLabel: "Manual",
        }));
        manual.forEach((comp) => {
          if (!comp.isBaseUnitValue) totalVariancePPM += comp.value ** 2;
          const compBase = componentStandardUncertaintyBase(
            comp,
            derivedNominalUnit,
            derivedNominalValue,
            derivedNominalUnit,
          );
          if (Number.isFinite(compBase)) totalVarianceBase += compBase ** 2;
          componentsForBudgetTable.push(comp);
        });

        // The UUT's own measuring resolution, when opted in, joins the budget.
        const uutResComp = getUutResolutionComponent(uutToleranceData, uutNominal);
        if (uutResComp) {
          if (!uutResComp.isBaseUnitValue) {
            totalVariancePPM += uutResComp.value ** 2;
          }
          const compBase = componentStandardUncertaintyBase(
            uutResComp,
            derivedNominalUnit,
            derivedNominalValue,
            derivedNominalUnit,
          );
          if (Number.isFinite(compBase)) totalVarianceBase += compBase ** 2;
          componentsForBudgetTable.push({ ...uutResComp, quantity: 1 });
        }

        combinedUncertaintyPPM = Math.sqrt(totalVariancePPM);
        combinedUncertaintyAbsoluteBase = Math.sqrt(totalVarianceBase);

        const numerator = Math.pow(combinedUncertaintyAbsoluteBase, 4);
        const denominator = componentsForBudgetTable.reduce((sum, comp) => {
          const dof =
            comp.dof === Infinity ||
            comp.dof == null ||
            isNaN(parseFloat(comp.dof))
              ? Infinity
              : parseFloat(comp.dof);
          const compBase = componentStandardUncertaintyBase(
            comp,
            derivedNominalUnit,
            derivedNominalValue,
            derivedNominalUnit,
          );
          return dof === Infinity ||
            dof <= 0 ||
            !Number.isFinite(compBase) ||
            compBase === 0
            ? sum
            : sum + Math.pow(compBase, 4) / dof;
        }, 0);
        effectiveDof = denominator > 0 ? numerator / denominator : Infinity;

        if (!isNaN(derivedNominalValue) && derivedNominalUnit) {
          const derivedNominalInBase = unitSystem.toBaseUnit(
            derivedNominalValue,
            derivedNominalUnit
          );
          if (!isNaN(derivedNominalInBase) && derivedNominalInBase !== 0) {
            combinedUncertaintyPPM =
              (combinedUncertaintyAbsoluteBase /
                Math.abs(derivedNominalInBase)) *
              1e6;
          }
          componentsForBudgetTable.forEach((comp) => {
            const compBase = componentStandardUncertaintyBase(
              comp,
              derivedNominalUnit,
              derivedNominalValue,
              derivedNominalUnit,
            );
            comp.contribution = Number.isFinite(compBase)
              ? compBase / targetUnitInfo.to_si
              : NaN;
          });
        }

        // A direct budget is already expressed by its physical source rows.
        // Risk 8.0 exposes Monte Carlo only for calculation equations, so a
        // direct point always combines these sources using the workbook's RSS
        // uncertainty-budget workflow.
        calculatedBudgetGroups = [
          {
            id: "final_budget",
            kind: "final",
            label: `${uutNominal.name || "Final"} Uncertainty Budget`,
            unit: derivedNominalUnit,
            components: componentsForBudgetTable,
            results: null,
          },
        ];
      }

      if (
        (isNaN(combinedUncertaintyPPM) &&
          isNaN(combinedUncertaintyAbsoluteBase)) ||
        (componentsForBudgetTable.length === 0 &&
          !(
            testPointData.measurementType === "derived" &&
            calculatedBudgetGroups.length > 0
          ))
      ) {
        setCalcResults(null);
        if (testPointData.is_detailed_uncertainty_calculated) {
          onDataSave({
            combined_uncertainty: null,
            effective_dof: null,
            k_value: null,
            expanded_uncertainty: null,
            is_detailed_uncertainty_calculated: false,
            calculatedBudgetComponents: [],
            calculatedBudgetGroups: [],
            calculatedNominalValue: null,
          });
        }
        return;
      }

      const kValue =
        Number.isFinite(manualCoverageFactor) && manualCoverageFactor > 0
          ? manualCoverageFactor
          : !applyDofForGroup("final") || effectiveDof === Infinity || isNaN(effectiveDof)
          ? normalQuantile(probability)
          : getKValueFromTDistribution(effectiveDof, probability);

      const expandedUncertaintyPPM = !isNaN(combinedUncertaintyPPM)
        ? kValue * combinedUncertaintyPPM
        : NaN;
      const expandedUncertaintyAbsoluteBase = !isNaN(
        combinedUncertaintyAbsoluteBase
      )
        ? kValue * combinedUncertaintyAbsoluteBase
        : NaN;

      const newResults = {
        combined_uncertainty: combinedUncertaintyPPM,
        combined_uncertainty_absolute_base: combinedUncertaintyAbsoluteBase,
        combined_uncertainty_inputs_native: derivedUcInputs_Native,
        combined_uncertainty_inputs_base: derivedUcInputs_Base,
        effective_dof: effectiveDof,
        k_value: kValue,
        expanded_uncertainty: expandedUncertaintyPPM,
        expanded_uncertainty_absolute_base: expandedUncertaintyAbsoluteBase,
        is_detailed_uncertainty_calculated: true,
        coverageFactorMode: testPointData.coverageFactorMode || "auto",
        coverageFactorOverride:
          testPointData.coverageFactorMode === "manual"
            ? testPointData.coverageFactorOverride
            : null,
        calculatedBudgetComponents: componentsForBudgetTable,
        calculatedBudgetGroups: calculatedBudgetGroups.map((group) =>
          group.id === "final_budget"
            ? {
                ...group,
                results: {
                  combined: !isNaN(combinedUncertaintyAbsoluteBase)
                    ? combinedUncertaintyAbsoluteBase / targetUnitInfo.to_si
                    : combinedUncertaintyPPM,
                  effective_dof: effectiveDof,
                  k_value: kValue,
                  expanded: !isNaN(expandedUncertaintyAbsoluteBase)
                    ? expandedUncertaintyAbsoluteBase / targetUnitInfo.to_si
                    : expandedUncertaintyPPM,
                },
              }
            : group
        ),
        calculatedNominalValue: finiteNumberOrNull(calculatedNominalResult),
        secondOrder: derivedSecondOrder,
        propagationMethod,
        monteCarlo:
          monteCarloResult && propagationMethod === "montecarlo"
            ? {
                method: monteCarloResult.method,
                trials: monteCarloResult.trials,
                meanBase: monteCarloResult.meanBase,
                nominalResultBase: monteCarloResult.nominalResultBase,
                influenceFractions: monteCarloResult.influenceFractions,
                inputs: monteCarloResult.inputs,
                correlationMatrix: monteCarloResult.correlationMatrix,
                choleskyMatrix: monteCarloResult.choleskyMatrix,
                standardUncertaintyBase:
                  monteCarloResult.standardUncertaintyBase,
                hash: monteCarloResult.hash,
              }
            : null,
      };

      setCalcResults(newResults);

      const resultsHaveChanged =
        !testPointData.is_detailed_uncertainty_calculated ||
        testPointData.budgetPropagationMethod !== propagationMethod ||
        (propagationMethod !== "montecarlo" &&
          testPointData.risk8MonteCarloResult != null) ||
        Math.abs(
          (testPointData.expanded_uncertainty || 0) -
            (newResults.expanded_uncertainty || 0)
        ) > 1e-9 ||
        Math.abs(
          (testPointData.expanded_uncertainty_absolute_base || 0) -
            (newResults.expanded_uncertainty_absolute_base || 0)
        ) > 1e-9 ||
        JSON.stringify(testPointData.calculatedBudgetComponents) !==
          JSON.stringify(newResults.calculatedBudgetComponents) ||
        JSON.stringify(testPointData.calculatedBudgetGroups) !==
          JSON.stringify(newResults.calculatedBudgetGroups) ||
        numericResultChanged(
          testPointData.calculatedNominalValue,
          newResults.calculatedNominalValue
        );

      if (resultsHaveChanged) {
        onDataSave({
          combined_uncertainty: newResults.combined_uncertainty,
          combined_uncertainty_absolute_base:
            newResults.combined_uncertainty_absolute_base,
          combined_uncertainty_inputs_native:
            newResults.combined_uncertainty_inputs_native,
          combined_uncertainty_inputs_base:
            newResults.combined_uncertainty_inputs_base,
          effective_dof: newResults.effective_dof,
          k_value: newResults.k_value,
          expanded_uncertainty: newResults.expanded_uncertainty,
          expanded_uncertainty_absolute_base:
            newResults.expanded_uncertainty_absolute_base,
          is_detailed_uncertainty_calculated:
            newResults.is_detailed_uncertainty_calculated,
          calculatedBudgetComponents: newResults.calculatedBudgetComponents,
          calculatedBudgetGroups: newResults.calculatedBudgetGroups,
          calculatedNominalValue: newResults.calculatedNominalValue,
          budgetPropagationMethod: propagationMethod,
          risk8MonteCarloResult: newResults.monteCarlo,
        });
      }
    } catch (error) {
      console.error("Error during uncertainty calculation useEffect:", error);
      setCalculationError(error.message);
      setCalcResults(null);
      if (testPointData.is_detailed_uncertainty_calculated) {
        onDataSave({
          combined_uncertainty: null,
          effective_dof: null,
          k_value: null,
          expanded_uncertainty: null,
          is_detailed_uncertainty_calculated: false,
          calculatedBudgetComponents: [],
          calculatedBudgetGroups: [],
          calculatedNominalValue: null,
        });
      }
    }
  }, [
    testPointData.id,
    testPointData.measurementType,
    testPointData.equationString,
    testPointData.variableMappings,
    testPointData.variableNominals,
    testPointData.inputCorrelations,
    tmdeTolerancesData,
    uutToleranceData,
    uutNominal,
    manualComponents,
    sessionData.uncReq.uncertaintyConfidence,
    testPointData.coverageFactorMode,
    testPointData.coverageFactorOverride,
    testPointData.useEffectiveDofByGroup,
    testPointData.budgetPropagationMethod,
    testPointData.monteCarloTrials,
    onDataSave,
    // NOTE: the computed OUTPUT fields this effect persists via onDataSave —
    // is_detailed_uncertainty_calculated, expanded_uncertainty(_absolute_base),
    // calculatedBudgetComponents, calculatedBudgetGroups — are intentionally
    // NOT dependencies. They are only read for the change-detection guard
    // (`resultsHaveChanged`), and listing them caused a save→re-run→save
    // feedback loop ("Maximum update depth exceeded") whenever that JSON
    // comparison flapped instead of converging. The effect already re-runs on
    // every relevant INPUT change (and onDataSave is a stable useCallback), so
    // the stored outputs read here are always current.
  ]);

  return { calcResults, calculationError };
};
