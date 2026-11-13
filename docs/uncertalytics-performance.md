# Uncertalytics performance maintenance

Performance changes must preserve calculation inputs, results, saved-session
semantics, and the synchronous crash-recovery journal. Mathematical authority
and numerical evidence are documented in the [V8.00 audit](../Frontend/workbench/src/modules/uncertainty/utils/risk8/FINAL_V8_AUDIT.md).
This guide describes the reuse and invalidation contracts that keep large
sessions responsive; it does not claim a measured speed for every workload.

## Calculation reuse

`createRiskEvaluationCache` in
`Frontend/workbench/src/modules/uncertainty/utils/riskEvaluationCache.js` keeps
one evaluation per point. An unchanged point object reuses its result. Replacing
a point invalidates that entry; changing a shared session field or the
include-guardband option invalidates every entry. Removed points are evicted.
The pure calculation functions remain uncached.

These rules rely on immutable updates. Editing a nested input in place can
leave an object-identity cache stale. Resolution, tolerance, correlation, units,
bias, and requirements must enter the same invalidation path as other authored
inputs. Invalid calculations must replace old metrics with unavailable results;
restoring valid inputs must allow the point to calculate again.

`derivedEquationCache.js` retains at most 64 expression plans, evicting the least
recently used plan. Parsing, compilation, and optional symbolic derivatives may
be reused because they depend on the expression. Measurement values, units,
uncertainties, and propagated results must be evaluated from the current scope.
The V8.00 uncertainty calculation uses numerical sensitivities; cached symbolic
derivatives remain useful for audit explanations, second-order diagnostics, and
the separately defined source-bias calculation.

Linked instrument calculations normalize the selected specification rows rather
than every row on the instrument. Resolution lookup must still search applicable
ranges when the measurement point moves outside its selected range.

## Rendering and session updates

- Reuse table occupancy information while the structure is unchanged; rebuild it
  after row, column, or span changes. Paint-only hover and selection updates must
  not trigger full geometry measurements.
- Batch width measurements. Content edits, theme/font changes, visible columns,
  and zoom invalidate measurements; unrelated rerenders should not replace
  observers or remeasure every column.
- Compare changed session records instead of serializing unchanged collections.
  Clone undo snapshots only when retained, and skip normalization/synchronization
  for unchanged instrument definitions.
- Preserve the synchronous recovery journal and established persistence format.
  Reducing save or normalization work must not postpone the recovery record.

## Backend session loading

The uncertainty session endpoints prefetch point/component relationships.
Serializers reuse those prefetched objects and support callers that do not
arrive through the optimized endpoints. Note-image metadata travels with the
session; base64 image bodies use a separate endpoint. Metadata-only saves must
preserve existing image bodies.

For database latency diagnosis and controlled connection comparisons, use
[session latency diagnostics](session-latency-diagnostics.md). Do not infer
frontend rendering cost from a database query time, or database latency from
browser layout counts.

## Reviewing a performance change

Use the same synthetic session, inputs, viewport, and environment before and
after a change. Compare numerical results and persistence behavior as well as
elapsed time. Operation counts—point evaluations, layouts, style recalculations,
queries—help distinguish reduced work from machine contention. Report fixture
size, measured operation, and environment; avoid presenting isolated timings as
an end-to-end application guarantee.

Focused coverage includes `riskEvaluationCache.test.js`,
`derivedEquationCache.test.js`, and `riskCompute.release8.test.js`, together with
session recovery, source synchronization, and the affected UI tests. A useful
hands-on check is a large session: edit a point, equation input, linked source,
resolution, and correlation; switch views; scroll and resize; undo; save and
reopen. Verify that dependent results update and unaffected points remain stable.

Follow [AGENTS.md](../AGENTS.md) for the current testing and release sequence.
Historical benchmark values and completion records remain available in Git history.
