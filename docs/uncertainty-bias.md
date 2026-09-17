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

Values are signed native-unit offsets or percentages of the absolute current
input value. Temperature offsets use interval conversions, not temperature
origins. Relative values and equation sensitivities are evaluated again when
point/input values change. Incompatible units or invalid values block risk
results instead of silently using zero.

For a derived equation, each source contributes `sensitivity × residual bias ×
quantity`, using the same signed, unit-aware sensitivities as the uncertainty
budget. Contributions add algebraically. This is a first-order approximation;
large biases and strongly nonlinear equations need a suitable corrected
measurement model. Unmapped output components contribute directly in output
units. Resolution rows do not inherit an instrument's bias a second time.

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
manual net bias so opening a session cannot silently change its risk results.
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
to PFA/PFR and mitigation calculations. Unknown-value cases have no UUT
population-bias input. Their observed acceptance boundary is translated by
the system bias before inward resolution snapping, with achieved PFA recomputed
on that grid. The underlying true specification limit is unchanged. This
translation extends the app workflow; it is not a new claim of workbook VBA
parity for nonzero bias in unknown-value cases.

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
commands, and the explicit unknown-boundary parity exception. The additional
`biasWorkflowParity.test.js` compares native bias ownership/propagation to 48
outputs captured from Excel itself; it does not manufacture expected risk values
using the app's calculator.

September 17 menu-removal validation: all 2,064 tests across 164 files passed,
the high-severity dependency audit found zero vulnerabilities, the single-file
build succeeded, and all 72 baseline/instrument-bias browser checks passed.
