# Uncertalytics performance scrub — October 30, 2026

This change removes repeated work in session editing, point calculations, table measurement and backend loading. It preserves the existing calculation models, rendered tables, save format and synchronous crash-recovery journal.

## Changes

- Sidebar diagnostics, limits, precision and requirements reuse unchanged point evaluations. Editing a point invalidates that point; shared session changes invalidate every dependent entry. Removed points are evicted.
- Linked instrument calculations normalize selected specification rows instead of copying every specification. Resolution lookup still searches other ranges when the nominal leaves the selected range.
- Derived equations reuse parsed expressions, compiled programs and symbolic derivatives. The cache is bounded to 64 expressions; values, uncertainties and units are evaluated afresh.
- Instrument selection reuses the table's cell grid and updates affected cells without remeasuring all columns. Structural changes rebuild the grid.
- Sidebar width probes are measured in one batch with independent containing blocks. Observer subscriptions survive unrelated renders. Editing, content, theme, fonts, visibility and zoom still invalidate measurements; hover and selection paint do not.
- Moving vertically within a point column keeps its hover highlight without clearing and rebuilding it for every row. Multi-point selection shares ID indexes across rows.
- Session change detection compares changed records rather than serializing unchanged collections. Undo snapshots are cloned only when retained. Unchanged sessions and instrument definitions skip normalization/synchronization work.
- Session responses reuse prefetched point/component data and fetch image metadata without base64 image bodies.

## Focused evidence

Baseline: commit `5ef2c077`. These are synthetic fixtures and isolated operations, not a claim about every workload or end-to-end application speed.

| Check | Before | After |
| --- | ---: | ---: |
| 300 nonlinear equation evaluations, changing nominal inputs | 1,193.3 ms | 21.94 ms |
| Change detection in a 2,000-point, 4,000-range session (median) | 12.46 ms | 0.021 ms |
| Synchronizing unchanged instruments in the same session (median) | 7.56 ms | less than 0.001 ms |
| Editor opening: browser layouts, 60 points and 240 instrument rows | 871 | 35 |
| Editor opening: browser layouts, 300 points and 240 instrument rows | 3,426 | 36 |
| Hover across 50 point rows: browser style recalculations | 51 | 2 |
| Loading three sessions, nine points and eighteen components | 13 SQL queries | 7 SQL queries |

The equation benchmark compared all 300 full result objects against the baseline and found exact equality. Allocation tests compare 2,000-range and one-range instruments and verify that unrelated specification rows are not normalized. A 2,000-point cache test verifies that a single-point edit evaluates only one point.

Browser measurements use local Vite development pages, Chromium's DevTools Performance counters and React's profiler at a 1600 × 1000 viewport. Wall-clock timings were affected by machine contention, so the browser comparison reports operation counts. The 60-point before/after check matched all 18 measured point-cell widths, grid sizing and displayed text exactly, with no browser page errors. The larger 300-point fixture also exercised editor opening and value changes.

Focused frontend checks cover calculation/risk/equation behavior, selected-range fallback, cache invalidation, point editing, grouped cells, column measurement, instrument selection, unit inheritance, synchronization, recovery and undo. Eleven focused Django tests cover query counts, partially prefetched/direct serializer callers, payload ordering, image preservation and whole-session round trips.

## Hands-on testing handoff

Exercise a large session: select and edit points, change an equation input and a linked instrument specification, switch table views, scroll/resize columns, use grouped selections, undo edits, and save/reopen. Full tests, builds, release gates, pipeline inspection and release verification remain deferred until the user's explicit go-ahead, per `AGENTS.md`.
