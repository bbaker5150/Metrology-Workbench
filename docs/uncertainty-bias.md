# Uncertalytics bias settings

This guide describes bias ownership and editing. Mathematical traceability,
workbook provenance and test evidence are in the
[final V8.00 audit](../Frontend/workbench/src/modules/uncertainty/utils/risk8/FINAL_V8_AUDIT.md).
Implementation comments in
[measurementBias.js](../Frontend/workbench/src/modules/uncertainty/utils/measurementBias.js)
explain source aggregation and its distinction from Excel uncertainty propagation.

## UUT and measurement-system bias

A signed UUT range bias shifts the modeled true UUT population. A positive
measurement-system bias makes the observed result read high. Neither changes the
assigned nominal, the tolerance, or an uncertainty component.

Measurement points inherit the bias on their selected instrument ranges. Included
TMDE sources inherit their source bias; their contributions combine in the final
measurement's units. UUT bias remains independent of that system total.

Enter residual errors after any corrections already applied. Legacy entries saved
as corrected remain excluded until explicitly edited; their uncertainties remain.
Explicit zero is a valid override and is distinct from an absent entry.

## Native and percentage values

Biases can be signed native-unit offsets or workbook-normalized percentages.
For both UUT and cal bias, 100% is one final UUT tolerance scale `h`:

| Tolerance | Scale `h` |
| --- | --- |
| Double-sided, including asymmetric | `(upper − lower) / 2` |
| Known lower-only | `nominal − lower` |
| Known upper-only | `upper − nominal` |

The absolute bias is `entered percent / 100 × h`. This is not a percentage of
nominal or the TMDE's own error limit. With nominal 100 V and limits 90–110 V,
50% UUT bias is +5 V and 20% cal bias is +2 V. The same definition works at zero
and negative nominals with valid tolerance geometry. An incomplete tolerance
blocks nonzero percentage bias instead of substituting another scale.

For a derived equation, an absolute source contributes
`signed sensitivity × residual bias × quantity`, with unit conversion before
multiplication. This app-specific bias aggregation requests symbolic sensitivities,
with a numerical fallback where symbolic differentiation is unavailable. The
uncertainty budget independently uses the workbook's central finite differences.

A source percentage already expresses an output contribution relative to the final
UUT tolerance; it is not multiplied by sensitivity again. Contributions add
algebraically. Resolution rows do not inherit the instrument bias a second time.
Temperature errors use interval conversion rather than coordinate offsets.

## Net bias and display

The net measurement-system bias field displays the current source total. Opening
or focusing its editor does not create an override. An explicit edit creates a
point-owned net replacement. Clearing the value or removing the override restores
automatic source propagation, including any retained source overrides.

The display can show native bias, percent of final UUT tolerance, or nominal plus
bias without changing the authored value. For a percentage source, native input
equivalent is `output contribution / signed sensitivity`. A nonzero output bias
has no finite input equivalent at zero sensitivity; that view is unavailable,
while the percentage/output contribution remains defined. A manual net value is
not allocated among individual input rows.

## Copying and saved sessions

Budget copying carries the system-bias model and source overrides while retaining
the destination's UUT bias and input values. Source percentages are reevaluated
against the destination tolerance. Full point/session copying retains both bias
models. Session JSON and embedded PDF session payloads preserve the settings.

Saved point-level overrides remain effective until explicitly reset to instrument
inheritance. Resetting a separate UUT override does not remove a manual net row.
Sessions without authored bias retain their existing no-bias behavior.

## Unknown measurement values

Types 5/6 ignore both UUT and cal bias, matching the workbook's dedicated boundary
handler. Saved bias entries remain available if the point returns to a known-value
measurement. They do not translate the unknown-value acceptance boundary. The
historical low-level translated-boundary tests are identified separately in the
audit and do not describe the live application flow.

## Verification

Relevant checks include `measurementBias.test.js`, `biasPercentageParity.test.js`,
`biasWorkflowParity.test.js`, `suppliedBiasParity.test.js`, and selected-point/sidebar
integration tests. They cover signed propagation, native/percentage/temperature
units, correction state, zero overrides, copy/persistence, geometry and unknown
boundaries. Captured Excel expected values remain independent of the app calculator.

Production HTML checks are available through `MEASUREMENT_BIAS_SMOKE=1` with
`scripts/smoke-forge-srcdoc.mjs`. Follow [AGENTS.md](../AGENTS.md) for when full
build and browser release gates may run; historical results are not current release
validation.
