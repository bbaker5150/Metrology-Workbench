# Uncertalytics tasking — September 21, 2026

Source: the Tasking.docx attached to the September 21 continuation request.

## Changes and coverage

| Task | Result | Coverage |
| --- | --- | --- |
| Area selection and Escape | Paint UUT/TMDE area selection on the header cell; clear shared UUT and local instrument/range selections on Escape. | Selection component tests; September 21 and point-polish HTML checks. |
| Custom-column + | Retain the existing deferred-dismiss behavior so the first pointer press reaches the button while an editor is focused. | Input-tasking HTML checks exercise dirty range and tolerance editors. |
| Missing/mismatched TMDE units | Missing limits display Not Set; incompatible sources retain their authored error-limit text and units. Clear obsolete cached limits when the source becomes incomplete. Recognize persistent links in older imported TMDE rows so valid limits remain visible and instrument-owned. | Linked-source resolution and imported-row regressions; actual HTML unitless, ohm-reference and valid imported-reference cases. |
| Whichever is greater | Collapsed instrument summaries retain all authored alternatives and the full wording, independent of the selected point. Calculation still selects the applicable limit. | Summary regressions at positive/negative/missing nominals and mismatched units; HTML summary check. |
| Bias toggle | Turning Bias off deletes the range-owned bias while preserving the tolerance; reopening remains off. | UUT/TMDE component tests and persisted HTML session check. |
| Equation editing | Capital E is an input; lowercase e remains Euler’s constant. Preserve symbol case, remember explicit blank names, expand/select fields on focus, and remove the old completion banner. | Validation, linear/Monte Carlo propagation, Unicode rename, reconciliation, focus tests; HTML keyboard/case/cache checks. |
| Measurement output row | First row shows the output quantity and point nominal. Optional Unicode symbol is stored only as the equation LHS. The existing net override editor now belongs to this row. | Output edit/component identity test; HTML first-row, symbol, alignment and saved-state checks. |
| Dropdowns | Shared ownership dismisses the previous portaled menu when another opens, including unit/prefix, library/symbol, budget, column, context and area menus. | Selector component test and HTML unit/prefix switching. |
| Sticky table headers | Opaque header stacking and fractional-pixel edge coverage hide underlying rows and Add Instrument controls. | HTML hit-testing at scrolled UUT/TMDE headers; screenshot inspection. |
| Known/unknown wording | Compact tolerance descriptions use known value and unknown value. | Single-sided summary tests. |
| Clipboard | One synchronous clipboard owner prevents stale point/budget/instrument/range payloads from being pasted. Cut instrument snapshots remain reusable; subsequent pastes create fresh identities. | Clipboard-owner and repeated mixed-selection tests; HTML point→cut instrument→paste twice→point paste sequence. |
| Reorder Columns | Prefer side placement with full viewport height and one outer scroll surface. Lists grow naturally. | HTML all-columns growth, viewport and overflow checks. |
| Unit inheritance, compatibility and Value | Preserve the prior first-UUT inheritance and explicit Units choice, incompatible-UUT suppression, and blank Value placeholder. Output-unit edits also record an explicit choice. | Input-tasking HTML checks and the complete existing risk/unit suites. |

## Calculation contract

The output-row bias uses the existing audited manual-net replacement. It replaces the signed source sum, never adds another source, never changes UUT bias, and never becomes an uncertainty component or RHS variable. Removing the override restores saved source settings. Merely enabling it starts from the current source total and preserves risk.

The error-limit presentation change does not make mismatched dimensions calculable. Such rows keep pending uncertainty and block a completed budget. No tolerance, bias-percentage basis, distribution, risk integration, or workbook-parity formula was changed.

## Validation

The complete test suite, high-severity dependency audit, single-file build, baseline Forge/srcdoc smoke, and feature HTML checks are required before push. The published commit's GitHub Actions run and HTML release asset are verified afterward.

The walkthrough integration test flushes pending React effects before its real pointer sequence, avoiding a synthetic click racing the async dialog's document listener. Its session-creation and automatic-advance assertions remain unchanged.

Local release results: 178 test files / 2,183 tests passed; dependency audit reported zero vulnerabilities; single-file build passed. The final built HTML passed baseline Forge checks (54), September 21 tasking checks (87), and measurement-bias checks (96). Input-tasking checks also passed (75). Screenshots of the output row, column menu and instrument headers were reviewed. The bias smoke now waits for the persisted Bias-off deletion, then explicitly restores the absolute offset before comparing it with percentage bias.
