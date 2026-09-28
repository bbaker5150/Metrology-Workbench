# Uncertalytics tasking — September 28, 2026

Source: attached Tasking.docx (8A6C4516-F65D-43A6-AD2E-5149A6D03EF2).

## Changes

- Replace per-row Range N/A / Point Dependent notes with one vertical ADD’L UNCERTAINTY rail spanning an instrument’s additional uncertainty rows. The rail follows editor/row height changes in overview and measurement-point tables, uses theme colors, and preserves the existing table columns and range actions.
- Rename the empty-unit picker option from Unitless to Units in shared instrument, budget, tolerance, and builder controls. Stored empty-unit values and calculation semantics are unchanged.
- Center Type A/B values consistently for ordinary, editable manual, and dynamic budget rows; remove the summary button padding that offset manual Type B values.

## Verification

- Audit: zero vulnerabilities.
- Complete test suite: 196 files / 2,326 tests passed.
- Single-file build passed.
- September 28 browser checks and base Forge smoke: 68 checks passed, including rail geometry in both themes, expanded editors, the Units label, and actual A/B text alignment.
- Existing expanded-TMDE authoring checks passed for primary/secondary editing, distribution, type selection, selection/deletion, and budget addition.

## Additional uncertainty selection follow-up

- Clicking outside an additional uncertainty's Range cell now uses instrument selection, including shared Description and Sync cells, just like ordinary ranges.
- Range selection starts at the right edge of the shared label rail, including continuation rows and browser zoom.
- Compose ADD’L UNCERTAINTY horizontally before rotating the label so the apostrophe retains its normal position.
- Verification: audit clean; 196 test files / 2,327 tests passed; single-file build passed; 95 September 28 and base Forge browser checks passed, including both themes and both instrument-table views.
- Existing expanded-TMDE authoring/selection/deletion checks and its 54-check base Forge run passed.

## Label rail appearance and shared outline follow-up

Source: attached Tasking.docx (82914A7A-197B-4B03-B187-1CFBCC72080B).

- Use a white label-rail background in light mode and add the bottom divider in both themes.
- Instrument selection includes the full shared label rail. The perimeter wraps around it rather than crossing the label when a continuation source is selected. Individual Range selection still excludes the rail.
- Verified first and continuation source selection in both themes and overview/measurement-point tables: 105 feature/base Forge browser checks passed.
- Audit: zero vulnerabilities; complete suite: 196 files / 2,328 tests passed; single-file build passed.
