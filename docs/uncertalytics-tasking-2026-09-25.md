# Uncertalytics tasking — September 25, 2026

Source: the latest Desktop `Tasking.docx`, plus the user's screenshot follow-up.

## Checklist

- [x] Restore the uncertainty type cog beside the add button. Add creates a Manual component immediately; the cog changes the current component's type while preserving its name, distribution, and custom column data. Use the same workflow in budget tables.
- [x] Show the add-instrument hint only in the first visible empty measurement area per table, including saved sessions and areas emptied by deletion. Match the measurement point hint's arrow size.
- [x] Remove the strip above sticky instrument column headers when scrolling.
- [x] Remove the budget error-source range selector border and vertically center its chevron.
- [x] Limit divider double-click cycling to automatic fit and measurement points at full width.
- [x] Update the initial loading screen with the NPSL logo and Uncertalytics branding.
- [x] **Screenshot follow-up: remove the extra space between instrument table titles and column headers.** Apply to both UUT and TMDE tables in light and dark mode. Keep the column-add controls fully visible and preserve sticky header behavior.

## Verification

- 57 focused tests passed across the uncertainty editor, type conversion, dynamic rows, instrument hints, budget picker, and loading screen.
- Browser checks passed for Manual → Table → Equation → Table → Manual using the actual budget panel, including restoration of the entered table value.
- Light and dark browser checks passed for title/header alignment, unclipped column-add controls, and flush sticky headers during internal and page scrolling.
- Loading screen visually inspected; the existing logo loads at the top left.
- Updated the affected workflow smoke scripts for immediate Manual creation and the two-state divider cycle; their syntax checks pass.
- Release audit passed with zero vulnerabilities; the complete suite passed (196 files, 2,324 tests), and the single-file production build passed.
- Browser release checks passed: workspace polish (109), Type B (79), sidebar (94), and expanded TMDE (54). Workspace and Type B checks were rerun against the final build after restricting empty-area hints; both include the base Forge smoke checks.
- Remote pipeline and published release verification follow the push.


## Follow-up refinements

- Compact budget source-name fields that grow with their text.
- Preserve the active distribution across Manual, Table, and Equation switches, including switches back to a cached type.
- Consistent Add Measurement Area hints with arrows aligned to the plus controls in all three surfaces.
- Shared instrument-style fields and transparent nested headers in budget tabular editors; remove the tabular helper footer.
- Compact equation fields that grow as formulas get longer.
- Custom-column add buttons sit above their header dividers without restoring the empty strip. Verify their position and click target in the complete workspace and at multiple zoom levels.
- Choose and save random default colors for new measurement areas, preferring unused palette colors. Preserve existing colors and manual overrides.

- Show the add-point/add-instrument hint only once per surface, in its first empty visible area.
