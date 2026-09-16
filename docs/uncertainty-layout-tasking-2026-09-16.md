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
