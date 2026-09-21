# Uncertalytics tasking — September 21 follow-up

Source: `A997EFD2-E59F-4774-924A-4B5C7F2877E3/1-Tasking.docx`, including both screenshots. This checklist follows the document's 14 text items in order.

| Item | Implementation and required verification |
| --- | --- |
| 1. Measurement Inputs bias | Keep the + visible (disabled after adding one net bias); make × visibly painted without hover. Show the Bias column only when a net bias is added here. Preserve the three display modes. The output row permits Name/Bias editing; its symbol/nominal are read from the equation/point. Verify persisted add/edit/remove and actual opacity, not only DOM existence. |
| 2. Results scaling | Compact Results geometry is the 100% baseline. Separate logical zoom from physical scaling; migrate old saved scales once to preserve their actual sizes. Verify default, zoom, reset and saved state. |
| 3. First UUT unit | A point created before any UUT unit inherits the first unambiguous UUT unit. A later explicit Units selection remains available. Verify point → UUT → unit creation order and persistence. |
| 4. Incompatible UUT units | Include legacy functionUnit metadata in dimensional validation. Verify absolute and percentage specifications reject incompatible limits, uncertainty and risk; exercise actual point unit selection. |
| 5. Variable-heading case | Preserve the authored symbol's case while retaining uppercase styling on the Uncertainty Budget suffix. Verify lowercase π and uppercase E. |
| 6. Deleted variable names | A committed variable deletion prunes its remembered name; invalid intermediate expressions preserve the current inputs. Explicit clears also remain authoritative when selecting a library equation. Verify deletion/re-addition with and without clearing first. |
| 7. Known/unknown wording | Instrument summaries already use “known value” / “unknown value”; retain coverage for both. Breakdown method descriptions remain explanatory text. |
| 8. Custom-column Tab editing | Focus opens and selects custom cells so Tab immediately permits typing; Enter/blur saves. Verify two adjacent custom fields in the built HTML. |
| 9. Normal label | Display k=1 as Normal (Std. Unc.), preserving the stored divisor and calculations. |
| 10. Expanded distribution | Show the selected distribution name immediately while the editor remains focused; keep k metadata in the choices. |
| 11. TMDE column heading | Rename the instrument-table Error Limit heading to Uncertainty; preserve the budget's error-limit semantics and data keys. |
| 12. Unit choices | Browse and search base units only. Apply SI prefixes with the separate prefix control, including the instrument builder. Verify volts search, saved prefixed units and prefix edits. |
| 13. Risk defaults | Restore Risk Inputs and Mitigation Inputs under Session Info. Defaults remain session-owned; point overrides remain point-owned. Use muted italic inherited values and regular explicit values, including focus/edit states. Clearing an override restores inheritance. |
| 14. Column menu | Grow beside the trigger up to the viewport height with one outer scroll surface; narrow-screen fallback also uses the full height. Verify long lists and viewport bounds. |

## Audit boundaries

No workbook risk formula or bias percentage basis is changed. Net bias still replaces the combined source bias and removal restores source contributions. Unit mismatch remains a calculation gate rather than a conversion assumption. Output Name is presentation metadata copied with derived budgets and never changes the measurement area or variable mappings.

The Name/Bias-only editing rule applies to the output row. Equation-input rows retain their variable and nominal editors, which are required to define the derived measurement.

Combined workflow testing also exposed a modal bias warning while a source-biased equation input was temporarily incomplete. The bias resolver now preserves the evaluator's `missingInputs` state. Risk remains unavailable until the input is complete, while inline editing proceeds without a modal. A regression checks invalidation and subsequent restoration of the original risk result.

## Verification record

- `npm audit --audit-level=high`: zero vulnerabilities.
- Complete `npm test -- --maxWorkers=2`: 180 files, 2,193 tests passed.
- `npm run build:singlefile`: passed.
- Measurement-bias HTML smoke: 96 checks passed, including absolute/percentage equivalence, replacement/removal, copied points, and adapter persistence.
- Input-tasking HTML smoke: 75 checks passed, including incompatible point units suppressing limits, uncertainty and risk, and compatible units restoring calculation.
- Results/highlight HTML smoke: 75 checks passed, including the new 100% baseline and independent, shared scaling of Results, budget tables, and decision cards.
- Final baseline Forge HTML smoke: 54 checks passed.
- Final follow-up HTML smoke: 114 checks passed, including the previous sheet's regressions, builder base/prefix geometry and interaction, and a true 800×600 iframe viewport for the columns menu.
- Reviewed rendered screenshots of Measurement Inputs, session defaults, the narrow columns menu, and builder unit controls. The review caught and corrected legacy builder width rules that overlapped the range + action. The full suite, build, baseline and follow-up HTML checks were repeated after that correction.

These are the pre-push results. The exact-commit GitHub Actions run and its published HTML asset must also succeed before the release is reported complete.
