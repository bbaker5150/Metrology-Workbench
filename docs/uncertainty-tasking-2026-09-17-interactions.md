# Instrument ordering, column sorting and live risk results

The September 17 tasking reports three interaction regressions.

## Instrument ordering

The in-document pointer adapter already delivered drops, but both overview and
point-detail handlers filtered out every instrument whose source area matched
the destination. That made a same-area drop a no-op while cross-table transfers
continued to work.

Same-area drops now use a dedicated reorder operation. The upper/lower half of
the destination instrument determines before/after; expanded range rows share
one destination rectangle. Dropping on an area header appends within that area.
Selected instruments move as a stable block. Existing instrument objects, IDs,
range definitions and budget links are retained, including shared memberships.
Other area-only rows retain their array slots. Cross-area/cross-table transfers
continue through the existing membership transfer path. No native OS drag is
introduced.

## Column sorting

Normal hover/focus fills and remove-button reveals competed with the pointer
drag's insertion marker. During a column drag those transient effects are
suspended; the source remains highlighted and the two-pixel insertion line
continues to track before/after. Repeated pointer events in one insertion zone
reuse the existing target state. Hit testing is scoped to the active menu.
Normal hover and keyboard focus styles resume on release or cancellation.

## Empty budget risk results

The risk effect only recalculated when `calcResults` was truthy. Removing the
last component sets that input to null, so the previous risk state survived.
The effect now processes null inputs and publishes null through the same
deduplicated update path. Its cache is cleared too, allowing the identical
budget to produce the same valid results again without navigating away.
Missing tolerance geometry and invalid units also clear obsolete risk results.

## Regression checks

- Unit coverage for UUT/TMDE moves in both directions, multi-selection, shared
  memberships, unchanged drops, and expanded-row destination geometry.
- Hook coverage for populated/empty/restored budgets and leaving/reentering the
  risk view without changing the selected point.
- `SEPTEMBER17_INTERACTION_SMOKE=1 node scripts/smoke-forge-srcdoc.mjs` runs actual
  mouse gestures in the built SharePoint iframe. It covers overview/detail
  ordering for both instrument kinds, column insertion feedback/order, final
  component removal, and the existing cross-area/cancellation/native-drag checks.
- The standard audit, complete unit suite, production build and iframe smoke
  remain required release gates.

Local release verification completed with zero audit vulnerabilities, all 2,062
tests passing across 164 files, a successful single-file production build, and
all 87 combined baseline/interaction browser smoke checks passing.
