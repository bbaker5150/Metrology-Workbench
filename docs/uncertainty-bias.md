# Bias settings

The expanded UUT tolerance editor stores a signed range bias. A measurement
point can inherit it or select **This point** under **Budget Tables → Bias
settings**. A point override replaces the range default; zero is a real override.
Positive UUT bias shifts the modeled UUT population toward larger values.

The expanded TMDE error-limit editor stores a shared source bias. Included
budget sources inherit that bias. In **Bias settings**, users can override a
source for that budget, restore its source default, or replace the calculated
total with **Enter net bias**. Positive measurement-system bias makes the
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

**Already corrected** excludes a source's bias from the net offset. It does not
apply a correction to the measurement equation or remove the uncertainty of
that correction. Use it only when the correction is already represented in
the measurement. An entered net bias replaces the source sum; it is not added
to that sum.

Budget copying includes the system-bias model and source overrides, retaining
the destination's UUT bias and input values. Full point/session copying retains
both. Native session persistence and embedded PDF session payloads carry the
settings as ordinary JSON fields. Existing sessions without authored biases
retain their previous risk results, including the calculated derived-mean
fallback (identified as **calculated mean** in the editor).

Known-value risk passes both biases through the Risk 8 adapter and applies them
to PFA/PFR and mitigation calculations. Unknown-value cases have no UUT
population-bias input. Their observed acceptance boundary is translated by
the system bias before inward resolution snapping, with achieved PFA recomputed
on that grid. The underlying true specification limit is unchanged. This
translation extends the app workflow; it is not a new claim of workbook VBA
parity for nonzero bias in unknown-value cases.

Validation covers signed V/R propagation, point/range overrides, corrected
sources, native/relative/temperature units, copy and JSON round trips, public
risk calculations, panel/sidebar agreement, and unknown boundaries. The
production HTML integration check runs with `MEASUREMENT_BIAS_SMOKE=1 node
scripts/smoke-forge-srcdoc.mjs` from `Frontend/workbench` after
`npm run build:singlefile`; it uses an isolated mock SharePoint site.
