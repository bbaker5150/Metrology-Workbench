# Bias settings

The expanded UUT tolerance editor stores a signed range bias behind its **Bias**
toggle, styled like DS/SS. **Whichever is greater** sits below the tolerance
terms. The same arrangement applies to the TMDE error-limit editor. Measurement
points inherit the selected range's live bias; there is no separate budget bias menu.
Positive UUT bias shifts the modeled UUT population toward larger values.

The expanded TMDE error-limit editor stores a shared source bias. Included
budget sources inherit that bias, and the app automatically calculates their net
contribution in the final measurement's units. Positive measurement-system bias makes the
evaluated result read high. Neither bias changes the assigned point nominal,
tolerance, or standard uncertainty.

Values are signed native-unit offsets or workbook-normalized percentages.
For BOTH UUT and cal bias, 100% is one final UUT tolerance scale, h:

- Double-sided: h = (upper limit - lower limit) / 2, including asymmetric limits.
- Known lower-only: h = nominal - lower limit.
- Known upper-only: h = upper limit - nominal.

The absolute bias is entered percent / 100 times h. It is not a percentage of
nominal, and cal percentages do not use the TMDE's own error limit. For nominal
100 V and limits 90 to 110 V, 50% UUT means +5 V and 20% cal means +2 V.
The same percentages work at zero and negative nominals with a valid tolerance.
An incomplete tolerance blocks nonzero percentage bias rather than substituting
another denominator. Explicit zero remains valid. Existing saved `kind: percent`
entries adopt this corrected definition; numbers are not silently rescaled.

For derived equations, an absolute source contributes `sensitivity * residual
bias * quantity`, using the same signed, unit-aware sensitivities as the budget.
A source percentage already describes a signed share of the FINAL output UUT
tolerance, per the workbook cal-bias definition; it is not multiplied by the
sensitivity again. Source contributions add algebraically. A shared percentage
is reevaluated against each receiving point's tolerance on copy/paste and edits.
Absolute temperature errors use interval conversion, without coordinate offsets.
Resolution rows do not inherit the instrument bias again.

Measurement Inputs shows native input-equivalent bias, its contribution as a
percentage of final UUT tolerance, or nominal plus input-equivalent bias. For a
percentage source the native equivalent is output contribution / signed
sensitivity. At zero sensitivity a nonzero output bias has no finite input
equivalent, shown as unavailable; the percentage/output contribution remains
defined. A manual net replacement is not allocated among the input rows.

Enter residual errors after any corrections already applied. The former
**Already corrected** checkbox is removed. Previously saved corrected entries
remain excluded until edited, with a short inline explanation; editing that bias
makes the entered residual active. Uncertainty components remain unchanged.

The **+** at the top right of **Measurement Inputs** adds one **Net Bias** row.
It starts at the current combined source bias, in output units, so adding it
alone does not change risk. Its signed value replaces the source total, without
changing UUT bias, the equation, or any uncertainty component. Removing the row
restores automatic source propagation. Source overrides are retained underneath
the manual value for saved-session compatibility. Copying a budget carries this
net setting using the existing audited manual-net contract.

Sessions saved with the former point menu retain their UUT/source overrides or
manual net bias with their existing ownership. The corrected percentage basis above applies to these entries too.
Only these points show a compact notice with the effective UUT/system biases
and **Use instrument biases**. That action explicitly clears the point overrides
and resumes live instrument inheritance without changing any instrument or
uncertainty component. When the Measurement Inputs table is present, manual net
entries appear there; resetting a separate UUT override preserves that net row.

Budget copying includes the system-bias model and source overrides, retaining
the destination's UUT bias and input values. Full point/session copying retains
both. Native session persistence and embedded PDF session payloads carry the
settings as ordinary JSON fields. Existing sessions without authored biases
retain their previous risk results, including the calculated derived-mean fallback.

Known-value risk passes both biases through the Risk 8 adapter and applies them
to PFA/PFR and mitigation calculations. Unknown-value types 5/6 ignore both UUT
and cal bias, matching workbook ComputeOneRow. Saved bias entries remain available
when switching back to known measurement, but do not translate unknown acceptance
boundaries. The previous app-only boundary translation is no longer applied.

Validation covers signed V/R propagation, point/range overrides, corrected
sources, native/relative/temperature units, copy and JSON round trips, public
risk calculations, panel/sidebar agreement, and unknown boundaries. Legacy reset
coverage verifies unchanged results before reset and instrument inheritance after
a JSON round trip. The browser check edits UUT/TMDE biases and the corrected flag
in instrument cells, checks live risk updates, the optional net row, and confirms
there is no extra bias menu. It also checks uniform starting sizes, growth, and
focus stability in Session Info/Risk/Mitigation. The
production HTML integration check runs with `MEASUREMENT_BIAS_SMOKE=1 node
scripts/smoke-forge-srcdoc.mjs` from `Frontend/workbench` after
`npm run build:singlefile`; it uses an isolated mock SharePoint site.

The [Risk 8 audit](../Frontend/workbench/src/modules/uncertainty/utils/risk8/MIGRATION_AUDIT.md)
records the workbook hash, capture procedure, numeric tolerance, reproducible
commands, and the historical unknown-boundary extension, superseded by this parity correction. The additional
`biasWorkflowParity.test.js` compares native bias ownership/propagation to 48
outputs captured from Excel itself; it does not manufacture expected risk values
using the app's calculator.

September 17 menu-removal validation: all 2,064 tests across 164 files passed,
the high-severity dependency audit found zero vulnerabilities, the single-file
build succeeded, and all 72 baseline/instrument-bias browser checks passed.

September 18 percentage parity correction: `biasToleranceFrame.js` reuses the
risk adapter normalization and active acceptance limits; `biasPercentageParity.test.js`
checks signed/zero nominals, geometry, live IV/FS limits, resolution, incomplete
inputs, native temperature conversion, derived source ownership, copying and
unknown-value exclusions. `suppliedBiasParity.test.js` now enters the exact
workbook percentages and compares all populated cached outputs for 12 cases.
The HTML smoke check proves equivalent native, source-percent, UUT-percent and
manual-net-percent entries produce identical rendered risk results.

Final local validation for the percentage correction: 2,104 tests across 168 files;
zero dependency audit vulnerabilities; production single-file build successful.
