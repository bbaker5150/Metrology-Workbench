# Uncertainty layout tasking — September 16, 2026

Implements the Tasking.docx attachment identified by `DC760E7A-E477-4A93-8FB5-CE0E119FCA0B`.

## Behavior

- The standalone HTML shell no longer reserves the absent Workbench title bar. The body and uncertainty workspace use the usable viewport height, compensated for CSS zoom. Native Electron zoom is not multiplied by OS display density.
- UI scaling offers **Fit to window**, using a 1440 × 900 reference layout and a 60–100% fit range. Resizing preserves the selected zoom; fitting is an explicit action. This avoids changing a user's scale whenever they move or resize the window.
- The collapsed equation preview has no surrounding border. Instrument column headings have equal vertical padding, and column insertion controls remain on the upper border.
- The point column chooser uses a columns icon. Pointer sorting keeps the source highlighted in its original position, shows a closed hand and a before/after insertion line, and commits ordering only on release. Escape, pointer cancellation, window blur, and unmount clean up the drag. Opening this drag surface fades without translating its targets.
- Both PFA and PFR cards remain present with a neutral dash when unavailable. Numeric zero remains a valid result. Unknown-value boundary calculations still leave PFR unavailable.
- Whole-instrument selection does not expose range actions. Explicitly selected ranges reveal their add/delete controls only on local hover or keyboard focus.
- Enter commits a measurement point value in place. Ctrl/Cmd+Enter advances to the next existing displayed point; it creates a point only at the end.
- Narrow authored columns wrap labels and values before clipping. Automatically sized budget columns retain their content-fit defaults.
- Budget rows and component picker options use consistent hover treatment in light and dark themes, including manual, tabular, equation, and TMDE sources.
- Single-range TMDEs use one combined picker tile with no branch indent. Their identity includes `(Tag) Model Description`, and equal finite range endpoints display once.
- Distribution selection restores focus to its trigger after Arrow/Enter selection; subsequent Tab navigation continues into the next inline column.

## Validation

- 234 targeted tests passed across 14 files, including existing Risk 8 workbook parity suites. A subsequently added pointer-cancellation regression passed with all 5 column-menu tests: **235 distinct tests**. The two layout audit tests were also rerun after strengthening the distribution test to verify actual next-field focus.
- Production single-file build passed.
- **79 HTML/Forge smoke checks passed**, using synthetic sessions and in-memory SharePoint routes. Checks include three viewport sizes (1280 × 720, 1440 × 900, 1920 × 1080), each at 80%, 100%, and 120%; stationary column dragging and exact insertion; keyboard point navigation; narrow budget wrapping; single-range picker identity; light/dark hover; automatic-height stability; range add/delete in overview and point views; and archive/reload persistence with no native dialogs or uncaught errors.
- Risk calculation formulas and workbook fixtures were unchanged. Parity here means regression against the existing captured workbook vectors, not a new Excel capture.

Reproduce the rendered audit from `Frontend/workbench` in PowerShell:

```powershell
npm run build:singlefile
$env:TASKING_LAYOUT_SMOKE = '1'
node scripts/smoke-forge-srcdoc.mjs
```

The new focused tests are `TaskingLayoutAudit.test.jsx`, the pointer-cancellation case in `PointColumnMenu.test.jsx`, and the viewport/fit cases in `ZoomToast.test.jsx`. The rendered audit is `scripts/tasking-layout-checks.mjs`.

## Follow-up: library removal and independent column widths

Source: Tasking.docx attachment `C497CC95-E66C-4F8F-85A1-83E75A873186`.

- Each reusable tabular/equation entry has a separate red × at its right edge. It appears on hover or keyboard focus without moving the add target. A multi-output definition has one removal control for the shared definition.
- Removing a used definition hides it from the picker while preserving all existing budget instances and calculations. The persisted `hiddenFromPicker` flag travels with the shared definition and its portable snapshots, so reloads and later edits do not restore the removed choice. Unused definitions are deleted outright. New creation does not resume removed drafts or reuse names still present in existing budgets.
- Removed trailing-column fill from manually resized instrument and budget tables. Pixel widths now remain independent even when their sum falls below the available workspace. The card, title, and table viewport shrink to that sum; wider content scrolls. Growing a column pushes subsequent columns right without changing their widths. Default content/proportional sizing and temporary local editor expansion remain available.
- Unit regressions cover fixed peer widths, editor expansion, used/unused definition removal, shared calculations after JSON reload, and separate delete/add click targets. **115 distinct targeted tests passed** across eight files. One existing portaled-unit-selector test timed out in the combined run; all 15 tests in that file passed when rerun separately without changes.
- Production single-file build passed. **92 HTML/Forge checks passed**, including large physical drags in UUT, TMDE, input-budget, equation-budget, and final-budget tables; reversing adjustments; zoom; overflow; no trailing strips; light/dark delete visibility; persisted removal; and the existing hover/height/range/archive regressions. Light and dark screenshots were visually inspected.

Reproduce the follow-up rendered checks from `Frontend/workbench`:

```powershell
npm run build:singlefile
$env:INDEPENDENT_COLUMNS_SMOKE = '1'
node scripts/smoke-forge-srcdoc.mjs
```

The helper is `scripts/independent-columns-checks.mjs`. It uses synthetic sessions and the smoke host's in-memory SharePoint routes, preserving real user sessions.

## Follow-up: stable input focus and inline editing

Reported behavior: clicking between fields sometimes shrank a row or indented its text.

- Reproduced in the production HTML: entering a measurement value reduced its row from 42.47px to 38px, changed Consolas 600 to Inter 400, and moved the adjacent unit approximately 38px. Read/edit wrappers now share typography and layout. Hidden, non-accessible text mirrors reserve the same intrinsic field dimensions for Value, Section, and Qualifier; only typing a different value can change that footprint.
- Session metadata had different line boxes and an overriding input rule that inherited the parent 16px font. Read and edit states now share height, inset, weight, size, and line height, including the session title. Transitions affect paint properties only.
- Removed edit-only budget cell padding and source-name centering. Manual, tabular, and equation source names use a wrapped textarea over a matching text mirror, preserving narrow-column wrapping and row height. Enter still commits; Escape/Tab behavior is retained. Pasted line breaks normalize to spaces so the source-name data remains a single-line value.
- Source-name focus preserves table scroll position and restores focus to the source-name trigger. Name editing does not request the temporary column expansion intended for multi-control limit editors.
- Matched distribution labels and triggers, reserved a consistent compact summary line box, and replaced a plot-input focus border with an inset underline that cannot add height. The browser audit additionally caught a narrow TMDE distribution label changing from a wrapped 14.4px label to a 12.48px, 24px-high trigger. Opening that field now captures its CSS-pixel box and typography; both views reserve the same chevron space, and longer newly selected labels can grow naturally.
- Validation: 90 targeted sidebar, budget, layout, and inline-navigation tests passed. All 17 dynamic component tests passed, including new table/equation source-name commit and focus-return regressions. The existing large unit-picker test exceeded its normal 30-second timeout under concurrent browser/build load; the complete file passed with a 90-second limit. Production single-file build passed.
- After the distribution follow-up, 67 tests across `TaskingLayoutAudit`, `GhostRangeRow`, and `UncertaintyPanel.toleranceModes` passed, including portaled selection, focus restoration, and Tab navigation.
- Final production HTML/Forge run: **110 checks passed**, with no uncaught errors or browser dialogs. The previously failing distribution field retained exactly the same 81.75px width, 46.31px height, 14.4px font, text inset, and 75px row height before and after activation.

Rendered regression coverage is in `scripts/field-stability-checks.mjs`, using the existing synthetic SharePoint host. It compares actual row/control rectangles and computed typography in light/dark themes and at different UI scales, including narrow budget source columns and focus changes within UUT/TMDE, tabular, and equation editors. It also runs the existing hover, height-handle, range add/delete, persistence, and archive checks.

```powershell
npm run build:singlefile
$env:FIELD_STABILITY_SMOKE = '1'
node scripts/smoke-forge-srcdoc.mjs
```

## Release-gate correction

The feature-specific validation above did not establish release-pipeline
success. Runs for `e1a5dfc`, `392e7de`, `3aa4c50`, and `305cf55` stopped at the
full Test step. The latest run reported three failures in two integration files:

- The UUT assignment test sent a click without the browser's preceding focus
  and blur sequence, leaving the newly added point's value editor uncommitted.
  It now uses `userEvent` for the UUT trigger and option, retaining the assertion
  that the point displays its newly assigned instrument.
- The range-action test assumed opening a tolerance editor also selected a
  range. It now explicitly selects the expanded range before asserting that
  both add and delete actions exist, as required by the current UI contract.
- The single-range TMDE test expected the old identity-only accessible name.
  It now expects the complete combined instrument/specification tile and still
  verifies that selecting it assigns the exact range. Multiple-range selection
  remains separately covered.

The full local suite also exposed CPU-contention timeouts on this 16-thread
workstation. Vitest now caps concurrency at four workers (or available CPU
parallelism if lower), retaining the existing 30-second timeout and all parity
assertions. `AGENTS.md` records the user's mandatory full pre-push gates and
post-push verification of the exact commit's remote workflow.

Two further test-only timing issues surfaced during full local validation.
The app integration setup now preloads the real lazy Notes module so cold
module transforms do not compete with the one-second DOM assertion deadline.
Dynamic-component unit choices now locate their exact visible labels within
the listbox and verify the resulting options' accessible names, avoiding
expensive accessible-name computation across the entire unit catalog. Neither
change stubs production behavior, removes assertions, or raises timeouts.

Pre-push validation after these corrections:

- `npm audit --audit-level=high`: zero vulnerabilities.
- `npm test`: all 2,049 tests in 161 files passed.
- `npm run build:singlefile`: passed.
- `node scripts/smoke-forge-srcdoc.mjs`: all 54 checks passed, including
  table geometry, range add/delete persistence, and dialog-free archival.

The preceding field-stability change also passed its 110-check HTML smoke run;
this release-gate correction changes only tests, test concurrency, and docs.
