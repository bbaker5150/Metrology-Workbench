# September 21 follow-up: collapsed bias, columns, and assigned units

Source: `E4ECFB07-BDD1-4D4D-B9E0-0ED0A4C179E3/1-Tasking.docx`.

## Changes

1. The output/net bias cell now uses the shared inline summary styling. Clicking
   opens the authored value and basis; valid Enter or outside blur commits and
   collapses. Invalid text remains editable. Moving between the value and its
   portaled basis selector does not close the editor prematurely.
   Both direct and derived tables support Bias, Bias %, and Nominal + Bias.
   The summary uses the resolved output bias; a saved percentage is still a
   percentage of the final UUT tolerance, not nominal. For nominal 5 V and
   tolerance +/-2 V, 5% bias displays 0.1 V, 5%, or 5.1 V respectively.
2. The columns menu uses the full available height beside its trigger. It grows
   naturally while content fits. At the viewport limit, the two lists scroll
   independently as needed; the outer menu does not scroll, and headings,
   Reset Columns, and Set as Default remain visible. This is verified at
   reduced and increased UI zoom as well as tall and short viewports.
3. An unassigned point no longer inherits a unit from other UUTs in its area.
   Both quick-add defaults and session inheritance require an actual UUT
   assignment. Assignment supplies the unit, or the first unit added later to
   that assigned instrument does so. An explicit Units opt-out remains valid.
   Changing the assignment updates activeUutId too, avoiding a stale instrument
   reference. Existing nonblank point units are not silently rewritten.

## Calculation and persistence invariants

Display selection does not change the saved value/basis. Reopening a 5% entry
shows 5%, even when the collapsed summary shows nominal plus bias. Viewing and
focusing do not freeze automatic source inheritance. Removing or clearing a
manual net restores source bias. Output cal bias and UUT bias stay independent;
no risk or bias formulas were changed.

## Validation

- Dependency audit, complete Vitest suite (181 files / 2,198 tests), and
  production single-file build passed.
- Baseline Forge browser smoke passed (54 checks).
- Measurement-bias regression passed (96 checks).
- Multi-source/workbook parity regression passed (153 checks).
- Previous tasking regression passed (115 checks), including unit assignment,
  keyboard editing, clipboard ownership, menu layout, and table stability.
- New tasking browser smoke passed (72 checks), exercising all three display modes, Enter/outside blur,
  authored-basis preservation, invalid edits, removal, direct and derived
  points, an existing unassigned Fahrenheit UUT, assignment, explicit Units,
  menu growth/scrolling, and 75% / 125% zoom.

Browser tests use isolated mocked SharePoint storage. No live user session is
modified. Exact-commit Actions and the published HTML are verified after push.
