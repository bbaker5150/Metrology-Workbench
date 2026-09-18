# Measurement-point table polish — September 18, 2026

Source: Tasking.docx, attachment AD4AC808-31D1-4921-98C3-2AE5C6D4CA36.

## Behavior

- Paint one vertical divider per visual column boundary across each expanded measurement area. The existing selection overlay supplies measured coordinates, so varying row heights, merged labels, column hiding/reordering, and scoped zoom do not leave short or missing segments. There is no final trailing rule. Header resize targets retain their width while their visible rules align with body boundaries.
- Escape outside an editor or popup clears the active point, multi-selection, area selection, table selection, and selection anchor. Editors retain their own cancel/dismiss behavior. With no selected point, the existing navigation logic returns to Instrument Overview.
- Match instrument-table column hover across point rows. DOM hover classes and a paint-only gradient avoid workspace state updates and changes to row or editor geometry. Shared-cell fills follow the same column highlight.
- Measurement-point area headers list only distinct displayed units used by points in that area. Instrument unit choices remain available when adding/editing points; instrument headers retain their own unit summaries.
- Resolve contribution-chart color from the same canonical measurement-area record as the instrument and point headers. Color changes update chart bars, area headers, point fills, and selection outlines from one session update. Remove differing header/row color-transition delays.
- Remove instrument-table top padding and place add-column controls inside the header so they remain usable without the gap.

No risk mathematics, stored measurement values, or workbook parity definitions changed.

## Validation

- Complete Vitest suite: 172 files, 2,139 tests.
- Dependency audit at high severity and single-file production build.
- Baseline Forge iframe smoke (54 checks), including hover/auto-height stability, range addition/removal, persistence, and no native dialogs or uncaught errors.
- POINT_POLISH_SMOKE covers Escape for single/multiple selections, full-column hover, merged cells, point-only unit labels, divider alignment at 100%/80% scale and after hiding a column, synchronous area/chart recoloring, and gap-free headers with contained add-column controls.
- FIELD_STABILITY_SMOKE checks light/dark editor geometry, text origins, row heights, units, and expanded instrument/component editors.

Run feature checks from Frontend/workbench with the corresponding environment flag and `node scripts/smoke-forge-srcdoc.mjs`. Parallel runs must use separate FORGE_SMOKE_PORT values. Fixtures use mocked SharePoint storage, not live user sessions.
