import { resolveDynamicComponents } from "./dynamicBudgetComponents";
import { getInstrumentRangeRows } from "./instrumentFunctionSelection";
import { getBudgetComponentsFromTolerance, getUutResolutionComponent, refreshLinkedTypeBComponents } from "../features/analysis/utils/budgetUtils";
import { normalizeInlineManualComponent, getInlineManualDraft } from "../features/analysis/utils/manualComponentUtils";
import { reconcileTmdeInstances, refreshTmdeInstancesFromMasters } from "./tmdeReconcile";

// Resolve the same explicit budget sources for the open view, sidebar and exports.
// A resolution row explicitly added to a budget stays included regardless of
// the instrument's default include-resolution setting.
export function resolvePointBudgetComponents(point, sessionData, instruments = []) {
  const uutNominal = point.testPointInfo?.parameter;
  const uutToleranceData = point.uutTolerance || sessionData.uutTolerance;
  const tmdeTolerancesData = refreshTmdeInstancesFromMasters(reconcileTmdeInstances(point.tmdeTolerances || [], sessionData.tmdes || []), sessionData.tmdes || []);
    const rawComponents = resolveDynamicComponents(point.components, point, sessionData);
    const getReferencePoint = (component) => {
      if (point.measurementType === "derived" && component?.variableType) {
        const symbol = Object.entries(point.variableMappings || {}).find(
          ([, name]) =>
            String(name || "").trim() === String(component.variableType || "").trim(),
        )?.[0];
        return symbol ? point.variableNominals?.[symbol] : null;
      }
      return uutNominal;
    };
    // TMDE error limits added to a derived input budget remain linked to the
    // instrument definition. Re-resolve their selected range on every render so
    // an inline/builder tolerance or distribution edit immediately updates the
    // already-added budget row without reintroducing equation-variable assignment.
    const refreshedTmdeComponents = rawComponents
      .map((component) => {
        if (component?.uutResolutionBudgetSource) {
          const source = Array.isArray(uutToleranceData)
            ? uutToleranceData.map((tolerance, index) =>
                index === 0
                  ? {
                      ...tolerance,
                      includeResolutionInBudget: true,
                      ...(tolerance?.tolerances &&
                      typeof tolerance.tolerances === "object"
                        ? {
                            tolerances: {
                              ...tolerance.tolerances,
                              includeResolutionInBudget: true,
                            },
                          }
                        : {}),
                    }
                  : tolerance,
              )
            : {
                ...uutToleranceData,
                includeResolutionInBudget: true,
                ...(uutToleranceData?.tolerances &&
                typeof uutToleranceData.tolerances === "object"
                  ? {
                      tolerances: {
                        ...uutToleranceData.tolerances,
                        includeResolutionInBudget: true,
                      },
                    }
                  : {}),
              };
          const replacement = getUutResolutionComponent(source, uutNominal);
          return replacement
            ? {
                ...component,
                ...replacement,
                id: component.id,
                componentId: component.componentId || component.id,
                isCore: false,
                isBudgetInstance: true,
                uutResolutionBudgetSource: true,
              }
            : null;
        }
        if (!component?.tmdeBudgetSourceId) return component?.isInlineManual && !component.inlineDraft
          ? normalizeInlineManualComponent({ component, draft: getInlineManualDraft(component), referencePoint: getReferencePoint(component) })
          : component;
        const sourceId = component.tmdeBudgetSourceId;
        const master = (sessionData.tmdes || []).find(
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
        const referencePoint = getReferencePoint(component);
        const resolutionLinked =
          String(component.tmdeBudgetComponentKind || "").toLowerCase() ===
          "resolution";
        const selectedSource = resolutionLinked
          ? {
              ...selectedRange,
              includeResolutionInBudget: true,
              ...(selectedRange?.tolerance &&
              typeof selectedRange.tolerance === "object"
                ? {
                    tolerance: {
                      ...selectedRange.tolerance,
                      includeResolutionInBudget: true,
                    },
                  }
                : {}),
              ...(selectedRange?.tolerances &&
              typeof selectedRange.tolerances === "object"
                ? {
                    tolerances: {
                      ...selectedRange.tolerances,
                      includeResolutionInBudget: true,
                    },
                  }
                : {}),
            }
          : selectedRange;
        const resolved = getBudgetComponentsFromTolerance(
          selectedSource,
          referencePoint,
        );
        const replacement = resolved.find(
          (candidate) =>
            String(candidate.name || "").split(" - ").slice(1).join(" - ") ===
            String(component.tmdeBudgetComponentKind || ""),
        );
        if (!replacement) return null;
        const divisor = replacement.distributionDivisor;
        const numericDivisor = Number(divisor);
        const toleranceLimit =
          replacement.value_native != null && Number.isFinite(numericDivisor) &&
          Number.isFinite(Number(replacement.value_native))
            ? Math.abs(Number(replacement.value_native) * numericDivisor)
            : "";
        return {
          ...component,
          pendingReason: replacement.pendingReason || null,
          authoredTolerance: replacement.authoredTolerance,
          value: replacement.value,
          isBaseUnitValue: replacement.isBaseUnitValue,
          value_native: replacement.value_native,
          unit_native: replacement.unit_native,
          distribution: replacement.distribution,
          distributionDivisor: replacement.distributionDivisor,
          originalInput: {
            ...(component.originalInput || {}),
            toleranceLimit,
            errorDistributionDivisor: divisor,
            unit: replacement.unit_native || component.originalInput?.unit || "",
          },
        };
      })
      .filter(Boolean);

    return refreshLinkedTypeBComponents({
      components: refreshedTmdeComponents,
      tmdeTolerances: tmdeTolerancesData,
      sessionTmdes: sessionData.tmdes || [],
      instruments,
      getReferencePoint,
    });
}
