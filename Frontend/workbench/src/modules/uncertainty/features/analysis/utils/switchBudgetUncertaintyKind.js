import { createDynamicDefinition } from "../../../utils/dynamicBudgetComponents";
import { getInlineManualDraft, normalizeInlineManualComponent, applyManualToleranceDistribution } from "./manualComponentUtils";

// Switch just this budget row. Fresh definition IDs keep other users of a shared
// table intact; cached authored values allow switching back without data loss.
export function switchBudgetUncertaintyKind(component, kind, referencePoint, currentDraft) {
  const previous = component.dynamicDefinitionId ? component.dynamicDefinition?.kind : "parametric";
  const draft = currentDraft || (previous === "parametric" ? getInlineManualDraft(component) : component.dynamicDefinition);
  const drafts = { ...component.uncertaintyTypeDrafts, [previous]: draft };
  const name = draft.name || "";
  const distribution = previous === "parametric" ? draft.errorDistributionDivisor : draft.distribution;
  const { dynamicDefinitionId, dynamicOutputId, dynamicDefinition, dynamicSummary, dynamicReferencePoint,
    pendingReason, ...base } = component;
  const preserved = { ...base, uncertaintyTypeDrafts: drafts, name };
  if (kind === "parametric") {
    const manual = { ...(drafts.parametric || getInlineManualDraft(preserved)), name,
      errorDistributionDivisor: distribution, inputMode: "tolerance" };
    manual.tolerance = applyManualToleranceDistribution(manual.tolerance, distribution);
    return normalizeInlineManualComponent({ component: preserved, draft: manual, referencePoint });
  }
  const fresh = createDynamicDefinition(kind, referencePoint);
  const definition = { ...fresh, ...drafts[kind], id: fresh.id, kind, name, distribution };
  return { ...preserved, dynamicDefinitionId: definition.id, dynamicOutputId: definition.columns[0].id,
    dynamicDefinition: definition, inlineDraft: false, value: null, value_native: null };
}
