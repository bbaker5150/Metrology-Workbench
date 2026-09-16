# September 16 tasking: budget display and numeric input sizing

Source: `C1C3B0DD-5FDC-400C-8638-5755E0047721/1-Tasking.docx`.

## Behavior

- Contribution charts default on for sessions without a saved visibility
  preference. Explicit saved on/off choices remain respected. The final support
  row, its padding, and its separator exist only when there is a chart to show.
- Bias settings stay hidden for points with no configured UUT or budget-source
  bias. Explicit zero, corrected/cancelling source biases, and point/manual
  overrides remain editable. Instrument range editors still expose Bias as the
  entry point. This is display logic only; bias/risk calculations are unchanged.
- The UUT grid uses one full workspace column, and the detailed workspace fills
  its parent. Instrument defaults fill that width; saved manual column widths
  still control resizing and panel shrinkage without stretching other columns.
- Numeric editors share `GrowingNumericInput`, preserving native inputs, refs,
  controlled values, and uncontrolled blur commits. Their minimum width tracks
  the draft text with room for signs, decimals, padding, and spinners. Native
  content sizing supplements the character-width fallback. Focus does not change
  geometry. Range/tolerance/resolution, measurement nominals, dynamic components,
  manual components, bias, and numeric dialogs use the shared control. Existing
  mirrored measurement-point value inputs retain their own content sizing.

## Validation

- Dependency audit: zero vulnerabilities.
- Complete Vitest suite: 2,052 tests passed in 162 files.
- Single-file production build: passed.
- `GROWING_INPUTS_SMOKE=1 node scripts/smoke-forge-srcdoc.mjs`: 63 checks passed,
  including the standard 54-check release smoke and nine task-specific checks.
  Browser measurements verified both cards at the full 792 px budget workspace
  width, graph visibility/divider behavior, hidden unused bias settings, long
  signed-decimal nominals, tabular values, and uncontrolled range bounds. The
  captured nominal editor was also inspected visually.
- `FIELD_STABILITY_SMOKE=1 node scripts/smoke-forge-srcdoc.mjs`: all 110 checks
  passed, including focus geometry in light/dark themes, source-name editing,
  session metadata, tabular/equation controls, instrument range/tolerance/
  resolution/distribution, table hover stability, and persistence/archival.
