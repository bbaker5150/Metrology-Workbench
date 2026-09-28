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
