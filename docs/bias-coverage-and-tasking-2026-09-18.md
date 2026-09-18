# Bias coverage and tasking — 18 September 2026

Implemented the 14 items in the supplied BEB0AE1C Tasking document.

## User-facing changes

- Measurement-area selection uses its area color. Instrument-area headers select and copy/cut/paste every instrument in that area. Point and instrument selections have explicit clipboard ownership; selecting either clears the other selection. A single point can be copied after editing an instrument.
- Configured bias reopens beneath the tolerance terms, with its toggle active and its collapsed summary retained.
- Component-picker warnings have more separation from the specification text. Instrument add-column controls sit above the header, with a working first-click target. Custom columns delete immediately. Net-bias removal uses the same borderless red action styling as instrument removal.
- Numeric table text is black in light mode and white in dark mode. Point metrics are larger; risk status uses bold, legible text with a colored glow. Mitigation PFA/PFR and reliability use the point's requirements. Calibration intervals show at most two decimal places while retaining unrounded hover values.
- Scientific notation expands to decimal on hover. Calculated budget uncertainty, sensitivity and contribution cells expose their unrounded numeric values; auxiliary cells retain their descriptive tooltip and add decimal expansion.
- Risk and mitigation inputs are optional point-table columns, initially hidden. Existing session defaults are preserved. A point override is stored in `point.riskRequirements`; blank input restores inheritance. Both the inline indicator and point diagnostics flag deviations. Overrides affect point-list and detailed calculations without writing over session defaults.
- Editing instrument bias updates point-list results without reselecting a point. The column menu remains beside its toggle even when many columns are displayed.

## Three-way bias comparison

The independent oracle is the cached, full-precision MAIN results from the supplied **Unc Tool v8.00-Beta.7 Tolerance Type and Bias Testing.xlsm**, SHA-256 `71794f230233b0d9d97802468be98147c5d6548375288d6128df122bc4299fdf`. Expected results were not regenerated from Uncertalytics.

`multiSourceBiasParity.test.js` checks all 12 populated known-measurement workbook rows in both direct and derived budgets: **24 three-way cases**. Each compares two signed TMDE percentage biases, an equivalent manual net bias with the identical two-source budget, and workbook outputs. This includes cancellation to zero and UUT-only bias. Existing unknown-measurement coverage remains; the supplied workbook's unknown rows have no populated numerical oracle, so they are not counted as workbook result matches.

The shipped-HTML browser smoke additionally exercises all four known tolerance shapes (symmetric, asymmetric, lower-only and upper-only) through a derived `a+b` budget:

1. Nominal output is 100 V and the final UUT tolerance scale is 10 V.
2. Reference A contributes +30% of that scale, or +3 V.
3. Reference B contributes −10%, or −1 V.
4. Combined cal bias is +2 V, matching Excel's +20% cal-bias input.
5. Adding a manual net initializes it to +2 V and leaves every available displayed metric unchanged. Removing it restores the two individual biases.

Both independent rectangular components have error limits `2.5 / sqrt(2)` V. Their RSS standard uncertainty equals the workbook's original `2.5 / sqrt(3)` V. Their worst-case limits, however, add: consequently the two-source TAR is `4 / sqrt(2)`, rather than the original one-source TAR of 4. Tests explicitly assert this expected specification-bound difference. Risk, TUR, guardband and interval results match the workbook within `1e-8 + abs(expected) * 1e-8`; switching between source and net modes leaves the same-budget results identical. Unbounded single-sided limits remain unavailable rather than being treated as zero.

## Audit pointers

- `Frontend/workbench/scripts/multi-source-bias-cases.mjs`: independent two-source fixture and uncertainty/TAR derivation.
- `Frontend/workbench/src/modules/uncertainty/utils/risk8/multiSourceBiasParity.test.js`: full numerical matrix and unchanged-budget assertions.
- `Frontend/workbench/scripts/multi-source-bias-checks.mjs`: real built-HTML source/net/workbook comparison, point requirements, live UUT updates, theme contrast and interval display.
- `Frontend/workbench/scripts/measurement-bias-checks.mjs`: native/percentage equivalence, persistence, corrected legacy entries and single-point clipboard regression.
- `Frontend/workbench/scripts/september18-checks.mjs`: area clipboard ownership, column controls, configured bias reopening and layout stability.
- `Frontend/workbench/src/modules/uncertainty/utils/pointRequirements.js`: point-default inheritance and calculation-only session projection; projections must never be passed to session-save handlers.

Validation includes the complete Vitest suite, npm high-severity audit, single-file production build, baseline Forge iframe smoke and the three feature smokes above. Browser fixtures use mocked SharePoint records and do not modify a user's application session.

Final local validation: **2,134 tests / 171 files passed**, zero audit vulnerabilities, successful single-file production build, **54** baseline Forge checks, **153** multi-source bias/tasking checks, **95** bias workflow checks and **75** area/layout tasking checks. Light and dark screenshots were visually inspected.

## Typography follow-up

Subsequent feedback removes the risk glow. Risk metrics now use uniform 13 px bold text with the existing requirement-based colors; value and requirement fields share the point list's font. `PointNumericInput` supplies the same mirror-based sizing for measurement values and all six risk/mitigation inputs. Browser checks cover matching read/edit geometry, growth while typing, compact sizing on cancel, both themes, and reduced UI scale. The column-menu portal also compensates for global CSS zoom so its toggle stays reachable.
