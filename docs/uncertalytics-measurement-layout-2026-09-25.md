# Measurement-point layout follow-up — September 25, 2026

Source: the latest Desktop `Tasking.docx` and subsequent user clarifications.

- Center all measurement-point column headers.
- Center numeric data; left-align Section and UUT data; right-align Info/Warnings.
- Size the UUT assignment picker from its options so the unassigned and assigned states share the same readable structure.
- Cycle divider double-click/Enter through point-column auto-fit, full-width measurement points, and instrument-table auto-fit.
- Collapse Session Info and Risk & Mitigation on entering full-width points.
- Distribute the full viewport width evenly across point columns in full-width mode without horizontal scrolling. Wrap or stack controls inside their cells and keep row and header tracks aligned.
- Enter Section editing with one click, including an unselected point.
- Preserve the selected fit mode across reload; dragging or Escape returns to manual split view.

The preceding column-organizer batch (`ad80a54`) passed GitHub Actions run `36184568834` and published release `build-ad80a54` with HTML and checksum assets.

## Verification

- `npm audit --audit-level=high`: 0 vulnerabilities.
- Complete `npm test`: 196 files, 2,326 tests passed.
- `npm run build:singlefile`: passed.
- Forge browser smoke with workspace checks: 123 passed, including viewport fit, readable Value menus, first-click Section editing and persistence, header/data alignment, UUT menu widths, all three divider states, and refresh persistence.
- Sidebar/column organizer browser smoke: 102 passed.
- Reusable Type B component browser smoke: 79 passed.
- Each browser suite includes the base single-file srcdoc loading and instrument-table checks.
