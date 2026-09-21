# Input units and bias verification â€” September 18, 2026

Source: Tasking.docx, attachment A591F0C0-151E-4D28-BA10-6FA1EBA48BF0.

## Changes

1. Measurement Inputs omits its Bias header, column, and cells when there is no authored input-source or net bias. An explicit zero still counts as authored; opposite offsets must not hide the column by cancelling. UUT bias alone belongs to the output, not an input column. The existing Bias / Bias % / Nominal + Bias display remains available when applicable.
2. Newly created points with no available unit no longer claim an explicit blank selection. They inherit a unique unit from their assigned UUT, or from UUTs in their measurement area before assignment. Other areas and TMDEs cannot supply that default. Selecting Units explicitly remains supported and prevents automatic reassignment; multiple possible UUT units remain unassigned.
3. A shared dimensional-compatibility guard runs before UUT limit evaluation, sidebar uncertainty/risk, and active budget/risk calculations. It examines the range frame and authored tolerance terms, including single-sided limits. Incompatible quantities return unavailable limits and suppress totals/risk, including cached sidebar uncertainty. Compatible prefixes/aliases and coherent unitless frames remain supported. Relative tolerance terms are allowed, but a range measured in % is a physical frame and is not interchangeable with V.
4. Confirmed existing Results heading logic: input budgets, including unnamed equation variables, use Results; only the final measurement-point result uses Final Results.
5. Add-column buttons prevent mousedown from blurring a focused expanded editor before click. The intended action is captured before blur-driven column resizing can move its target. Keyboard click behavior remains intact.

## Bias factor-of-ten regression

Workbook authority: supplied Beta.7 workbook cached MAIN outputs in `suppliedBiasParityVectors.json`, plus the normalized UUT/Cal input contract documented in `measurementBias.js` and `riskAdapter8`.

For nominal 100 V and acceptance limits 90â€“110 V, h = (110 - 90) / 2 = 10 V:

| Entered bias | Native offset (percent / 100 Ã— h) | Workbook normalized input |
| --- | --- | --- |
| 2% | 0.2 V | 0.02 |
| 4.2% | 0.42 V | 0.042 |
| -2% | -0.2 V | -0.02 |
| -4.2% | -0.42 V | -0.042 |

This applies to both UUT bias and calibration-source bias. Using the 100 V nominal instead of the 10 V tolerance frame produces the reported 10Ã— error. The existing corrected calculation uses h. New regressions verify the four entries above through native bias conversion, the risk input contract, and equivalent absolute-bias risk results. Existing direct/derived tests also compare two individual TMDE percentages, equivalent net bias, and all supplied workbook risk/mitigation outputs. Unknown-measurement tolerance types 5/6 retain the workbook behavior of ignoring biases.

## Verification

- Complete Vitest suite and targeted unit, hook, and percentage-bias regressions.
- Audit, production single-file build, and Forge iframe baseline smoke.
- INPUT_TASKING_SMOKE: absent/zero/net bias column visibility; incompatible units and restoration; unnamed input Results; first-unit inheritance and explicit Units; actual pointer down/up creating columns from focused expanded Range and Tolerance editors.
- MULTI_SOURCE_BIAS_SMOKE: actual rendered point/detailed metrics against cached workbook vectors; individual source sum versus equivalent manual net.

The browser fixtures use mocked SharePoint storage and do not modify live sessions. The workbook numeric oracle is the supplied workbook's cached outputs, not a newly recalculated Excel session.

## September 21 presentation follow-up

The later Tasking.docx requested a uniform full-cell hover and a clearer blank
point target. The row gradient now paints the full hovered band, including row
padding, without a second text-height background. The old hover reset changes
only the base color so it cannot erase that gradient. Merged cells retain their
existing full-height fill and the selection perimeter remains unchanged. Browser
checks cover the uncertainty/risk columns in both light and dark themes.

Blank point values now display **Value** in read and edit modes. The intrinsic
input mirror uses the same placeholder, preserving width when focus changes.
The input smoke verifies the actual blank editor and committed display.
