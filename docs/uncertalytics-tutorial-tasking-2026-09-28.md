# Tutorial follow-up tasking — September 28, 2026

Source: Tasking.docx attachment F3241D22-2408-48AC-BFD3-E9E630BC3991.

| Requested change | Implementation |
| --- | --- |
| Follow UI scaling/zoom | Watch document-root scale changes and target/menu resizing; compensate the tutorial portal for inherited CSS zoom. |
| Include prefix menus and custom-column + controls | Highlight all visible revealed surfaces and the existing column-insert buttons; button positions remain unchanged. |
| Correct duplicate area creation instructions | TMDE guidance uses the shared Measurement Area already created for the UUT. |
| Add Skip | Skip sits beside Next and works with incomplete actions; jumping, Back and Close remain available. |
| Explain advanced uncertainty sources and distributions | Move the workflow near the end, after point/budget workflows; explain lookup tables and formulas, selected-point prerequisites, and the separate Distribution column. |
| Enter/Escape collapse additional uncertainties | All three source types collapse from their value inputs and preserve the edited values. |
| Clarify Bias location | Identify the primary range row above ADD’L UNCERTAINTY and highlight its uncertainty cell. |
| Account for automatic budget opening | Explain that assigning the UUT opens its budget; the following step reviews that already-open budget. |
| Highlight UUT assignment | Separate point creation, assignment, and nominal entry, with highlights on the active point’s actual UUT and Value cells. |
| Green completion pulse and automatic progression | Completed actions pulse green and advance after a short delay; active text edits finish first. Jumping, skipping or closing cancels pending progression. Reduced motion uses a static green outline. |
| Temperature symbols in calculated/target display | Both use the app’s unit-label formatter (for example, °F). |
| Correlation window must not obstruct next step | Closing it advances automatically. Next or Skip also dismisses it before showing propagation controls. |

Verification includes action/keyboard tests and packaged-browser checks for all tutorial targets, global/section zoom, prefix-menu coverage, custom-column buttons, automatic progression, Skip, correlation cleanup, native popovers, and short viewports.

## Local release verification

- `npm audit --audit-level=high`: zero vulnerabilities.
- Complete `npm test`: 198 files, 2,350 tests passed.
- `npm run build:singlefile`: passed.
- Tutorial and Forge browser verification: 143 checks passed.
- Light/dark tutorial screenshots reviewed; Skip is grouped beside Next.
