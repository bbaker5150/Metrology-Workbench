# September 11 feedback completion

Source: `Feedback 26-09-11 Rev000.docx`. Reviewed and completed September 13, 2026.

The implementation covers the requested product feedback, including a second pass over previously implemented behavior. The document's collaborator assignment note was not treated as a separate user instruction.

## Instrument tables

- Selected ranges expose their add/delete controls; adding inserts beneath that range.
- Clicking another range selects it across columns, while modified multi-selection remains available.
- Resolution distribution labels wrap so the two rectangular choices remain distinguishable.
- Resizing preserves neighboring column widths, supports narrow columns, and temporarily expands fields during editing. Widths and resets synchronize between instrument views.
- Custom columns have separate values per range. Adjacent equal nonempty values merge; legacy instrument-wide values remain readable.
- Tab advances from range units to tolerance; Ctrl+Enter adds a range from the range editors, including units.
- Text editing protects Backspace from the instrument-delete shortcut and allows text selection.
- TMDE uses “Test, Measurement, and Diagnostic Equipment.”

## Measurement points

- Column visibility and ordering share a menu, and low/high limits are paired.
- Added column headers align left and expose their remove control on hover.
- Limit formatting uses matching instrument resolution, choosing the finer UUT/TMDE resolution where both apply; without resolution it removes unnecessary trailing zeros.
- Values and units have clearer spacing; the unit dropdown arrow appears on hover or keyboard focus.
- Empty measurement areas show an actionable “Click + to add a measurement point” hint beneath their add button.

## Equations and budgets

- Equation menus fit the viewport and open upward when needed.
- Empty equations use the same editable field, and editing preserves the section height.
- Section collapse is limited to the chevron.
- A single-range TMDE can be added through its name or its range, with hover feedback.
- TMDE range warnings use the current master range after edits.
- “Whichever is greater” preserves the authored tolerance alternatives and uses only the greatest applicable term in calculations and budget display. Additive tolerances retain their previous behavior.

## Units and UI controls

- UI Settings provides a default-on scale lock, whole-page Ctrl+scroll, optional scoped scaling, and reset to 100%.
- Instrument add-column controls sit above the resize handles.
- Unit families offer the requested 21 prefix choices, from yotta to yocto, in a prefix/symbol/multiplier table with a gray Base row. Existing conversion factors and legacy unit spellings are preserved. Parentheses distinguish newly prefixed compound units from existing powered units.

## Verification

- Full frontend suite: 142 files, 1,856 tests passed.
- Targeted tests after final reset changes: 25 application tests passed; the preceding shared zoom/application run passed all 28 tests.
- Rendered Electron smoke checks passed for range controls, per-range custom fields, column resizing, all 21 prefix choices, scale lock/reset, equation sizing/menu placement/collapse, single-range TMDE selection, and the empty-area hint.
- Production build passed. The build reports its existing large-chunk advisory.

The rendered smoke fixture uses isolated temporary data and does not alter saved user sessions. Run it from `Frontend/workbench` using Electron and `scripts/smoke-feedback-complete.cjs`.

## Follow-up: resizing and expanded controls

- Narrowing columns now shrinks the complete instrument panel, including its header and lower handle, instead of leaving an empty strip inside it. Neighboring column widths remain fixed; wide tables still scroll horizontally.
- The “Whichever is greater” checkbox sits immediately to the right of DS/SS and uses the same compact styling, with checked, hover, and keyboard-focus states.
- Expanded range and tolerance unit selectors size to their full labels, including `in·ozf` and `lbf·in`.
- Focused regression tests: 84 passed. The dedicated rendered check is `scripts/smoke-feedback-layout.cjs`.

## Follow-up: color and empty-state polish

- The tolerance checkbox follows its measurement-area accent in both states; long alternative summaries wrap inside their column.
- All area-entry placeholders read “Add Measurement Area.”
- Empty equations show only the compact input, f(x), and Library controls. The input matches area-entry typography, and the redundant preview/instruction banner is removed.
- Focused regression tests: 82 passed. Rendered checks cover the green area theme, hover-only point-unit controls, matching field typography, and typing and library access from an empty equation.

## Follow-up: scaling icon and filter menu

- The UI scaling toolbar control uses a monitor-and-gear vector icon based on the supplied reference, inheriting the neighboring toolbar buttons' sizing and colors.
- The tolerance checkbox label has no resting background tint in either state and shares input-field hover styling.
- The column menu's title, explanatory header, and close button are removed; its action is labeled “Reset.” The toolbar toggle and outside-click dismissal remain available.

## Follow-up: budget source labels and scaling menu

- TMDE budget rows use the full live instrument identity (nickname, manufacturer, model, and current authored description) and display “Error Limit” in place of “Tolerance.” The budget magnitude column is also labeled “Error Limit.” Long source labels wrap within their cells.
- UI scaling now offers “Whole app” and “Individual sections,” a Ctrl + scroll hint, and “Reset to 100%.” The compact menu uses shared app colors and closes on an outside click or Escape.
- Focused label, calculation, and zoom regressions: 79 tests passed.


### Budget column sizing follow-up
- All source and equation budget tables now fit full headers, instrument descriptions, distributions, and numeric values with units on a single line by default. Wide tables scroll horizontally.
- Header dividers support independent dragging, arrow-key adjustment, and double-click restoration of content-fit sizing. Custom widths persist per budget; the complete panel shrinks when columns are narrowed.
- Global layout reset clears stored budget widths, including hidden groups. Pointer resizing accounts for UI zoom and cleans up interrupted drags.
- Validation: 44 focused tests and production build passed. Electron smoke checks verified full-content defaults, independent drag/keyboard resizing, shrinking panels, and both reset paths.

### Budget measurement-area visibility follow-up
- In the budget's UUT and TMDE instrument panels, Add Measurement Area is shown only while that panel's all-areas view is enabled.
- Each eyeball control stays anchored to the header's top-right corner as the optional area entry appears or the header wraps.
- The instrument overview retains its existing area-entry controls. All 7 measurement-area tests passed.

### Consistent menu and icon states
- Menu triggers and persistent icon toggles share the contribution/filter active treatment: accent color, a subtle tinted background, border, and inset highlight. Inline controls retain their measurement-area accent.
- Added explicit open-state semantics to equation menus, budget add menus, toolbar tools, visibility toggles, saved-equation controls, and floating correlation/calculation windows.
- Budget add menus toggle from their own trigger, switch directly between budgets, and dismiss on outside click or Escape. Equation menus also clear their state on Escape.
- Toolbar tools and calculation/correlation windows toggle closed from their triggers; native scaling-menu state follows the same styling.
- Validation: 104 relevant tests passed. Electron smoke checks confirmed identical active styles, click-to-close behavior, scope-specific budget triggers, outside-click and Escape dismissal, and toolbar/contribution/calculation toggles. Production build passed before the final scroll-dismissal refinement, which was verified in Electron.

### Deleted measurement-area navigation
- Deleting the measurement area currently shown in the budget clears its selection and returns to Instrument Overview. Deleting another area keeps the current budget open.
- Removed both empty-selection placeholder panels. Budget navigation without an available point stays on Instrument Overview, including after deleting the last area.
- Stale point selections from other deletion paths also fall back to the overview.
- Validation: all 34 application/navigation and area-grouping tests passed, including active-area deletion, unrelated-area deletion, and last-area deletion.

### Inline tabular and equation components

- Creating either component opens its editor immediately and focuses the source name. Both use the instrument editor's compact fields, unit/prefix menus, focus styling, and shared dropdowns.
- Tabular columns are named directly in their headers. Spreadsheet paste, row navigation, and Tab-to-add-row remain available, with compact row and column actions.
- Equation variables appear as the expression is entered; descriptions and values survive incomplete edits. Each variable has a consistent link toggle for using the active measurement point, and results preview immediately.
- Enter applies edits, clicking outside applies the latest draft, and Escape discards it. Closing a unit or mode menu keeps the editor open.
- Editors fit the available budget viewport and temporarily expand only their own columns. Saved widths return on close; resizing another column does not persist the temporary expansion. Collapsed names wrap inside manually narrowed columns.
- Validation: 89 focused tests passed, plus a subsequent five-test column-sizing regression run. An isolated Electron smoke test verified creation, real unit/mode menus, equation binding and saving, preserved widths, and light/dark rendering. Production build passed (existing large-chunk warnings).
