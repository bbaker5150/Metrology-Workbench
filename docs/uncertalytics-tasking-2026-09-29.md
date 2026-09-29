# September 29 tasking

Source: `Tasking.docx`, attachment `40BDEFAB-A5FD-429E-815E-66D18AF93E44`.

| Request | Change |
| --- | --- |
| Keep calculated values visible when equation units differ from the point | A separate numeric preview remains available during unit setup. The green check requires matching dimensions and value. Invalid unit combinations remain excluded from validated budget/risk results. |
| Expand a single measurement Value field into value, unit and prefix controls | The collapsed field shows its value and unit together. Clicking opens the numeric input and existing searchable unit/prefix menus; Enter or leaving the editor closes it. |
| Fit the selected unit; support prefixes for Units; fix automatic Value width | Unit controls size to the selected label. Units has supported SI prefix conversions and searchable names. Column measurement accounts for the collapsed field and expanded editor; full-width editors wrap within their column. |
| Add ± to repeatability error limits | Repeatability error-limit summaries include the same ± notation as other symmetric errors. |
| Keep manual full-scale units and standard uncertainty current | Unit edits update the manual draft. Unassigned points resolve the component in its current authored unit, including the full-scale reference, instead of a stale previous unit. Assigned points retain their measurement unit as the full-scale frame. |
| Make budget ordering consistent | Arrows reorder the visible contributors within that budget. The order is saved per point, supports mixed source types and survives recalculation/reload. New contributors follow saved rows. |
| Align error-limit and distribution values | Budget cells share vertical alignment and horizontal insets; summary buttons and distribution controls no longer introduce different text offsets. |

Regression coverage includes numerical previews, compatible prefix conversion, value/unit editing, manual full-scale unit changes, mixed-source ordering, light/dark layouts and full-width point columns.


The workspace regression also exposed negative overflow measurements during instrument auto-fit. Those measurements are now clamped and the instrument pane retains its minimum space.

## Local verification

- `npm audit --audit-level=high`: passed (one moderate advisory; no high/critical findings).
- Complete `npm test`: 200 files, 2,358 tests passed.
- `npm run build:singlefile`: passed.
- Tasking and embedded-app browser checks: 68 passed.
- Sidebar/column/unit browser checks: 102 passed.
- Type B/session-recovery browser checks: 79 passed.
- Workspace/layout/repeatability browser checks: 131 passed.
- Reviewed the light/dark editor screenshots and full-width point-list layout.
