# Risk calculation audit — Excel v8.00 Beta.7

Updated 2026-09-16, including the native-unit bias workflow audit. This supersedes
the earlier Beta.4 cutover notes.

## Reference and scope

The supplied `Tasking.docx` requests parity with `Unc Tool v8.00-Beta.7.xlsm`,
including single-sided 50% limits, impossible reliability/TUR combinations,
translated biased/asymmetric cases, mitigation, and user-facing derivations.

Reference workbook SHA-256:
`29A044C33581B8E5118DCC858B466830D92A6ACA7CA06C95D36A0611095B97DE`.

The VBA project and populated/formula cells were extracted read-only. The
calculation authority is `modRiskBackend`; `frmUUTTolerance`, the uncertainty
budget and equation forms, and the MAIN/RISK bridge establish input semantics.
The workbook's normal approximation and adaptive integration are retained.
These are parity checks against that workbook, not a claim that every possible
physical uncertainty model is independently validated.

## Mathematical changes

| Workbook procedure | App implementation | Beta.7 behavior |
| --- | --- | --- |
| `ComputeOneRow` | `computeOneRow8.js` | An assumed REOP above `maxREOP_solve + EPS` stops core risk and mitigation. Preserve the actual-TUR maximum; do not publish zero-risk or stale results. |
| `SolveSigmaObsSingle`, `Min/MaxAchievableSinglePass` | `riskEngine8.js` | Feasible one-sided reliability lies between the calibration-floor pass probability and 50%. The exact 50% asymptote has no finite spread unless the observed mean is at the active limit. The existing solver already implemented this boundary behavior; it is now covered by the matrix. |
| `ComputeOneRow` mitigation gate | `computeOneRow8.js` | Type 3/4 mitigation requires a reliability target above 50%, while feasible core calculations below 50% remain distinct from mitigation. |
| `GuardbandFromRatio`, `WritePhysicalGBFromMultiplier` | `riskEngine8.js`, `toleranceTypes8.js` | Two-sided bands contract about the tolerance midpoint: `GB = midpoint ± g × half-width`. Nominal remains the normalization origin. |
| `PFAHundredthsOfPercent`, `PFAPassesAtDisplayedPrecision` | `riskEngine8.js` | Compare `floor(max(PFA,0) × 10000 + 0.5000000001)`. This is half-up rounding to 0.01 percentage points, used only for target acceptance. Outputs retain full precision. |
| `RecommendMitigation_DS/SS` | `riskEngine8.js` | Recommendation searches use 32 iterations and the displayed-PFA comparison. Sigma bracketing and integration keep their own original iteration limits. |
| `RecommendREOPOnly_DS/SS` | `riskEngine8.js` | First find the lowest reference reliability meeting observed reliability; search upward for PFA only if necessary. A currently compliant point may receive a longer interval. Current interval is marked retained only within 0.0000005 of the reference reliability. |
| `BuildRecommendationCandidate_DS_FromLimits`, `_SS_FromLimit` | `riskEngine8.js` | Solve reliability for explicit acceptance limits, including a grid-induced midpoint shift. |
| `ApplyResolutionToMitigation_DS/SS` | `resolutionMitigation8.js` | Round physical limits inward, normalize, solve again at the required observed reliability, and recheck PFA. Update multiplier, reference reliability, observed reliability, PFA, PFR, and subsequent interval together. A collapsed or infeasible rounded band produces no recommendation. |
| `GetRPairForInterval` | `riskEngine8.js` | E1/W1 use observed reliability; E2/W2 use true reliability. Type 3/4 transform either to `q = 2R − 1`. Two-sided cases use `q = R`. Both logarithm arguments must lie in (0,1). |
| `WriteIntervalFromFinalRisk` | `riskEngine8.js`, `computeOneRow8.js` | Exponential: `Inew = I0 × ln(qnew)/ln(q0)`. Weibull: raise the ratio to `1/beta`. Diffusion: use the UUT variance ratio. All aging states retain the original acceptance limits, even for guardband mitigation. |
| `WritePhysicalGBForUnknownMeasuredValue` | `toleranceTypes8.js` | Types 5/6 use `sigmaCal = Ucal/1.96`, an inverse-normal PFA boundary, inward rounding, then the actual normal tail probability at the final boundary. Achieved PFA is no longer an echo of the target. |

`mitObs` and `intObs` mirror scratch columns BA/BB and map to
`Observed_REOP_With_GB` and `Observed_REOP_Interval_Only`.

## App wiring and presentation

Both the selected-point hook and the all-points/sidebar calculator already use
this model for valid known two-sided and single-sided tolerances. Invalid
geometry now cannot fall through to retired probability managers. Impossible
assumptions publish unavailable risk values with a usable maximum, replacing
previous results rather than retaining them.

Diagnostics use the exact rounded physical acceptance limits. Distribution
views use the corresponding core or recommended population spread and physical
biases. PFA colors use the same displayed-precision acceptance rule as mitigation.
Required and achieved boundary PFA are presented separately.

Breakdowns show probability integrals, uncertainty deconvolution, midpoint
contraction, resolution, PFA comparison precision, interval substitutions, and
the single-sided floor. User-facing version labels and internal status codes
were removed. Invalid cases explain the mathematical/input constraint. Types
5/6 have a dedicated boundary derivation rather than full-risk equations.

The app's existing default interval model remains E1. The pure contract supports
E1, E2, D, W1, and W2; all five are included in the comparison matrix.

## Retained bridge correction for Types 5/6

Beta.7 still has the earlier contradictory MAIN gate:
`RB_RowHasMinimumRiskInputs` requires numeric TUR for all six types, while the
unknown-measurement handler requires TUR to be blank. Literal MAIN routing thus
cannot produce Types 5/6 results. The app retains its previously accepted
correction: use the dedicated unknown-measurement backend with a physical limit,
positive expanded uncertainty, blank TUR, and PFA strictly between 0 and 50%.
Reliability, PFR, and interval results remain unavailable. This bridge correction
and the nonzero unknown-value bias extension below are explicitly outside literal
MAIN input/output parity; neither is hidden by the parity harness.

## Native-unit bias ownership and parity boundary

`measurementBias.js` resolves the app's range defaults and point/source overrides
in physical units. It is an app workflow extension, not a port of an Excel source
aggregation routine. UUT bias shifts the modeled true-population mean; system
bias shifts the observed mean relative to truth. `riskAdapter8` maps these to
scratch K/L as `mu = bUUT/h`, `XCAL = bSystem/h`, where `h` is tolerance half-span
or nominal-to-limit distance. The physical measurement used for TUR/TAR remains
separate from the modeled population mean. This mapping preserves the workbook's
distinction between the two biases even when their observed means are equal.

System source contributions use `sum(quantity × signed sensitivity × residual
bias)`, converting each bias to the sensitivity's input unit before multiplication.
This is first-order propagation, not an exact nonlinear correction. Marking a
source corrected removes its residual bias but retains its uncertainty. A manual
net bias replaces the source sum. Explicit zero overrides inheritance. Budget
copying reevaluates the model at destination inputs and preserves destination
UUT ownership. These semantics, temperature interval conversion, error handling,
and the absence-of-bias fast path are explained beside the production code.

As of the September 17 UI simplification, users author biases only in UUT
tolerance and TMDE error-limit cells. The former point bias menu is removed.
Stored overrides retain the audited calculation semantics above; only affected
points show a compact notice and an explicit reset to instrument inheritance.
No risk equations or captured workbook expectations change with this UI update.

**Unknown-value exception:** Beta.7's dedicated Types 5/6 boundary routine ignores
K/L. The app shifts the physical limit into observed-reading coordinates by adding
system bias before inward resolution rounding. Zero bias matches the workbook's
dedicated backend; nonzero bias is an intentional extension and does **not** give
literal parity for unchanged physical workbook inputs. UUT bias, PFR, TUR,
reliability and intervals are unavailable for unknown-value boundaries.

The 48-row `biasWorkflowVectors.json` was captured directly from the workbook on
2026-09-16 at 19:07:52 UTC. `scripts/risk-bias-cases.mjs` independently specifies
32 known-value rows: eight workflows across symmetric, asymmetric, lower-only,
and upper-only tolerances. They cover live range percentages, negative and zero
point overrides, corrected sources, manual net/corrected net, copied budgets,
and later edits. The hand-derived V/R source sum and normalized K/L values are
asserted before comparing **every captured risk output** to Excel.

The other 16 rows are eight pairs of original and translated unknown boundaries
(both directions, both signs, blank/fine resolution). Tests prove the workbook
ignores bias at the original physical limit, and that the app extension matches
Excel only with the explicitly translated limit. They also assert that original
and translated acceptance boundaries differ. This prevents a future audit from
mislabeling the extension as unconditional 1:1 workbook parity.

## Reproducible verification

`beta7Vectors.json` contains 786 synthetic input/output cases captured from an
isolated Excel instance executing the reference workbook's own private
`modRiskBackend.ComputeOneRow` on scratch row 7. Excel events are disabled;
the workbook is opened read-only and closed without saving. Every written input
is read back and verified before execution, including numeric zeros. Outputs
are read with `Value2`, never copied from formatted percentage text.

Coverage includes all six tolerance types; both bias directions and calibration
bias; actual/reference TUR mismatches; all five decay models; blank, fine,
coarse, invalid and nonpositive resolution; 50% and feasibility boundaries;
missing/invalid targets and intervals; equivalent translated physical cases;
seven historical regression inputs recaptured against Beta.7; and the voltage
and coarse-resolution pressure examples.

`beta7Parity.test.js` compares every captured output, with exact strings/blanks
and numeric tolerance `1e-10 + abs(expected) × 1e-8`. It also checks the bridge,
rounded-limit presentation diagnostics, translated-case equivalence, and
unavailable-risk behavior. Expected values are never generated by the app.

From `Frontend/workbench`:

```powershell
node scripts/risk-beta7-cases.mjs "$env:TEMP/beta7-cases.json"
./scripts/capture-risk-beta7.ps1 -WorkbookPath '<reference.xlsm>' -CasesPath "$env:TEMP/beta7-cases.json" -OutputPath "$env:TEMP/beta7-capture.json"
npx vitest run src/modules/uncertainty/utils/risk8
node scripts/smoke-risk-beta7.mjs
npm run build:singlefile
```

To compare a fresh capture without overwriting the committed oracle, set
`$env:RISK_BETA7_CAPTURE = '<absolute beta7-capture.json path>'` before running
`beta7Parity.test.js`, then clear it with `$env:RISK_BETA7_CAPTURE = $null`.
For the additional bias matrix:

```powershell
node scripts/risk-bias-cases.mjs "$env:TEMP/bias-cases.json"
./scripts/capture-risk-beta7.ps1 -WorkbookPath '<reference.xlsm>' -CasesPath "$env:TEMP/bias-cases.json" -OutputPath "$env:TEMP/bias-capture.json"
# Review that capture before replacing biasWorkflowVectors.json; expected values
# must always come from Excel, never from the app calculator under test.
npx vitest run src/modules/uncertainty/utils/risk8/biasWorkflowParity.test.js
$env:MEASUREMENT_BIAS_SMOKE = '1'
node scripts/smoke-forge-srcdoc.mjs
```

The capture JSON is the reviewable source for refreshing `beta7Vectors.json`.
The browser smoke test renders actual React breakdowns for 174 case/metric
combinations in Chromium, checks that KaTeX rendered, checks equation errors and
unavailable-input explanations, and saves representative screenshots in the
reported temporary output folder. It uses synthetic data only and does not
contact the app database or SharePoint.

The signed-bias browser matrix includes infeasible recommendations. In those
cases the captured Excel status requires a clear explanation instead of equations;
the smoke test checks this explicitly rather than treating missing math as success.

### 2026-09-16 verification record

Fresh execution of all 786 baseline rows completed at 19:06:08 UTC; the parity
test ran against that fresh capture and passed. A further 48 bias rows were
captured from Excel, for **834 workbook executions** in this audit. The original
workbook's SHA-256 was rechecked afterward and remained unchanged. Numeric output
tolerance is `1e-10 + abs(expected) × 1e-8`; strings and empty cells must match
exactly. This is numerical parity with the referenced backend, not bitwise equality
or a claim about untested spreadsheet UI/macro behavior.

Final results: **253 unit/integration tests passed across 18 files**, including
the workbook comparisons, selected-point/sidebar consistency, bias controls,
and breakdowns. **174 Chromium breakdown checks** and **63 production HTML /
mock SharePoint checks** passed. The latter covers persistence, range edits,
light/dark control sizing, hover stability, height handles, range add/remove,
and dialog-free archival. Light/dark screenshots were visually reviewed.
The production single-file build succeeded. No user session or source workbook
was modified by these tests.

The 253-test selection is reproducible from `Frontend/workbench`:

```powershell
npx vitest run src/modules/uncertainty/utils/risk8 src/modules/uncertainty/utils/measurementBias.test.js src/modules/uncertainty/features/analysis/components/InstrumentBiasWorkflow.test.jsx src/modules/uncertainty/utils/riskCompute.test.js src/modules/uncertainty/features/analysis/hooks/useRiskCalculation.test.jsx src/modules/uncertainty/features/analysis/components/BreakdownModals/RiskBreakdownModals.test.jsx src/modules/uncertainty/features/analysis/components/UnknownMeasurementRiskDashboard.test.jsx src/modules/uncertainty/App.sidebarRisk.test.jsx
```
