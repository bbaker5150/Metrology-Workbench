# Final V8.00 mathematical audit

Audit date: 2026-11-13. Baseline: repository commit `1732ef8`.
This is the current release-reference audit. [MIGRATION_AUDIT.md](MIGRATION_AUDIT.md)
remains the historical Beta.7 record; its Excel execution counts and release
checks are not new final-release executions.

## Reference and strength of evidence

The supplied workbook identifies itself as V8.00 in `MAIN!A1`. Its SHA-256 is:

`8410cc4812276aff5973c1ac50abd6ef3a6d13ecd114240f418e3b80121d223d`

The workbook was inspected read-only: literal saved cells, hidden data tables,
formats, and extracted VBA. It was not modified or executed in desktop Excel in
this audit. The repository contains only the minimal numerical fixtures and cell
mappings needed for review, not the workbook, analyst/device records, or its VBA
project. Procedure names below refer to the supplied workbook's extracted source.

Evidence is deliberately separated:

1. **Final saved outputs:** `finalRelease8Vectors.json` contains six populated
   Type 1 / E1 rows (`MAIN` rows 5–9 and 11), five distinct inputs and one duplicate.
   All 120 numeric outputs are compared, together with the corresponding bridge
   fields. The extractor also verifies the hidden `RISK_DATA` values; saved
   scratch status strings are asserted only for the matching last-calculated row.
2. **Source review:** normal probabilities, integration, variance inference,
   tolerance types, mitigation, intervals, budget coverage, equation propagation,
   Monte Carlo, and app input/output routing were compared to final VBA procedures.
   New source/algebraic regressions are identified as such, not called Excel captures.
3. **Historical Excel captures:** the 786 Beta.7 vectors and 48 bias-workflow vectors
   remain unchanged. They provide broad regression coverage for six tolerance
   types and all five interval models. They were not recaptured against final V8.00
   here and must not be relabeled as final native-Excel executions.

The untouched baseline already matched all six final saved cases: maximum absolute
numerical difference was approximately `7.845e-13`. The flowmeter guardband change
was already incorporated during the Beta.7 migration. This audit preserves it,
adds final-release evidence, and corrects surrounding gaps described below.

## The Cal Int regression to preserve

For the saved 160-point case:

| Quantity | Final release |
| --- | ---: |
| UUT lower / upper limits | 159.6 / 160.4 |
| Resolution | 0.1 |
| Actual / reference TUR | 1.2852881174149715 / 4 |
| Initial assumed REOP; required observed REOP | 0.85; 0.85 |
| Required PFA; original interval | 0.02; 18 |
| Rounded GB lower / upper limits | 159.7 / 160.3 |
| Final GB multiplier | 0.75 |
| Reference REOP target after rounding | 0.9944290447016071 |
| Observed REOP at the rounded limits | 0.8500000000003678 |
| PFA / PFR at the rounded limits | 0.0006006333430993438 / 0.14755835482980795 |
| Cal Int (GB+Int) | 4.421331946491825 |

The necessary order is: continuous candidate → round physical limits inward →
normalize those exact limits → solve the reference REOP again → check achieved
PFA → publish the revised risk and compute its interval. Replacing only the
physical limits after solving reproduces the Beta.4 defect.

For E1 the aging curve keeps the **original** acceptance limits. Its observed
reliabilities are `R0 = 0.7945059868655642` and `R1 = 0.9450633330825517`:

`Inew = 18 × ln(R1) / ln(R0) = 4.421331946491825`

Do not substitute the reference target `0.994429...` or the guardbanded acceptance
`0.85` into this ratio. In the older Beta.4 result, applying its modeled distribution
to the displayed rounded limits gives about 73.2535% acceptance rather than 85%.
`finalReleaseCore8.test.js` exercises that counterexample explicitly.

## Procedure crosswalk

| Final workbook procedure / location | Application location | Audit conclusion |
| --- | --- | --- |
| `NormalPDF`, `NormalCDF`, `NormalInvCDF`; sigma solvers; adaptive Simpson/PCA integration | `riskEngine8.js` | Existing numerical approximations/constants retained; replacing them with another library could change parity. |
| `EvaluateCase_DS/SS` | `riskEngine8.js` | Existing deconvolution, true/observed probabilities, joint PFA/PFR, feasibility bounds match. |
| `RecommendMitigation_DS/SS`, explicit-limit candidates | `riskEngine8.js` | Existing continuous search and fixed-boundary re-solve match. |
| `ApplyResolutionToMitigation_DS/SS` | `resolutionMitigation8.js`, `computeOneRow8.js` | Already updates multiplier, reference reliability, observed reliability and both risks before interval calculation. |
| `PFAHundredthsOfPercent`, `PFAPassesAtDisplayedPrecision` | `riskEngine8.js`; risk breakdowns | Half-up comparison at 0.01 percentage points retained. Display derivations now use this predicate consistently. |
| `RecommendREOPOnly_DS/SS` | `riskEngine8.js` | Existing two-stage search and 32 iterations retained. |
| `GetRPairForInterval`, `WriteIntervalFromFinalRisk` | `riskEngine8.js`, `computeOneRow8.js` | E1/W1 observed; E2/W2 true; Type 3/4 floor `q=2R−1`; D uses UUT variance ratio. Original acceptance curve retained. |
| `UpdateToleranceOutputs`, physical GB and rounding helpers | `toleranceTypes8.js`; `uncertaintyMath.js` | Shared application rounding now uses the final inward-grid helpers, including negative values and valid zero boundaries. |
| `RB_CopyMainInputsToScratch`, result copy routines | `riskAdapter8.js`, `riskBridge8.js`, known/unknown wrappers | Resolution, native-unit biases, observed REOP and interval mappings checked. Scratch columns distinguished from MAIN columns in comments. |
| `frmUncertaintyBudget.CoverageFactor`; equation form equivalent | `getKValueFromTDistribution` | Coverage calculation now truncates finite DOF as Excel TINV does; reported effective DOF remains unrounded. |
| `CalculateFirstOrderVarianceAndSensitivity`, `TaylorDerivativeStepSize` | `calculateDerivedUncertainty` | Numerical coefficient now uses the workbook central difference; symbolic derivative is audit information only. |
| `CholeskyDecompose` | `correlationMath8.js` | Shared by Taylor and Monte Carlo; invalid matrices rejected before a total is published. |
| `RunMonteCarlo`, `ReadTrials`, `UpdateMonteCarloInfluenceFromSamples` | `monteCarloEngine8.js` | Normal inputs, Cholesky, N−1 sample variance and influence method retained; integer conversion and undefined influence reporting aligned. |

## Corrections made outside the already-aligned risk core

- **Inward tolerance rounding:** a negative lower limit such as −10.54 at resolution
  0.1 must round upward to −10.5, not downward to −10.6. Zero is a valid rounded
  boundary. The shared legacy-named `resDwn/resUp` now delegate to the same final
  helpers as the risk engine, including near-grid floating-point handling.
- **Initial single-sided limits:** convert the authored limit to measurement units
  and round it inward before either the known-value or unknown-value backend,
  matching `frmUUTTolerance.cmdSave_Click`. For example, 9050 mV becomes a 9.1 V
  lower limit at 100 mV resolution. This precedes the later mitigation rounding.
- **Collapsed or inverted bands:** retain the actual rounded geometry and reject
  it for risk. Do not silently widen back to the unsnapped limits. Selected-point
  and sidebar paths must clear unavailable results consistently.
- **Single-sided TUR fallback:** use nominal-to-limit distance, not the biased
  population mean. UUT bias already enters `mu`; moving calibration sigma as well
  would count that displacement twice. The displayed derivation uses the same
  nominal-distance definition.
- **Coverage factor:** Excel's `TInv(1−confidence, veff)` truncates fractional DOF.
  Preserve continuous `veff` for reporting and truncate only the quantile argument.
  Invalid sub-one-DOF TINV results follow the workbook normal fallback. The general
  `studentTQuantile` remains a continuous-DOF statistical function.
- **Equation sensitivities:** use `(f(x+h)−f(x−h))/(2h)` with the workbook step
  `h=max(max(abs(x),abs(u))×1e−6,1e−15)`; the zero-scale fallback is 1 before scaling.
  Apply the step in the authored input unit and convert to the common app evaluation
  frame. A symbolic derivative remains available to explain the expression and
  second-order diagnostics but does not supply the first-order coefficient.
- **Correlation validity:** a positive computed variance does not prove that the
  correlation matrix is physically possible. Validate the complete matrix first.
  Reject invalid matrices; accept singular positive-semidefinite matrices. Permit
  only the workbook's tiny negative-roundoff clamp. The live uncertainty hook clears
  saved totals on rejection and recovers when correlations are corrected.
- **Monte Carlo boundaries:** trial counts use VBA `CLng` rounding (nearest integer,
  ties to even) before the 100-trial minimum. When total influence score is zero,
  report influence as unavailable rather than falsely assigning every source 0%.
- **Audit explanations:** distinguish the continuous optimum from the final snapped
  multiplier, reference reliability from observed acceptance, and the PFA display
  predicate from a strict unrounded ceiling. N−1 makes sample variance unbiased;
  its square root is the sample standard deviation.

## Boundaries reviewers should retain

- The final workbook still has a contradictory MAIN gate for Types 5/6: its generic
  minimum-input check requires numeric TUR, whereas the dedicated unknown-measurement
  handler requires blank TUR. The application intentionally routes directly to that
  handler. Literal MAIN routing is not claimed for these types. Their dedicated
  boundary mathematics is supported; population REOP/PFR/intervals are unavailable.
- The live Types 5/6 bias resolver supplies zero UUT and calibration bias, consistent
  with the final handler ignoring K/L. The older low-level translated-boundary helper
  and historical tests remain provenance of an app extension, not a claim that
  the workbook applies nonzero unknown-value bias.
- App authoring currently uses E1 by default. The pure engine supports E1/E2/D/W1/W2;
  this audit does not add new interval-model controls. Compare equivalent selected
  confidence, effective-DOF mode, manual k overrides, uncertainty units and inputs.
- Source-bias aggregation remains an app extension with explicitly selected symbolic
  sensitivities for its signed residual-bias sum. Excel receives scalar K/L inputs
  and has no corresponding source aggregation routine. This explicit option does
  not change the numerical sensitivities used by uncertainty budgets or their DOF.
- The existing stationary-point protection remains an explicit application difference:
  when all first-order sensitivities are zero but inputs carry uncertainty, the app
  asks for Monte Carlo/higher-order treatment instead of publishing a zero Taylor
  budget. The workbook can display that zero first-order budget. This protection
  is not represented as literal workbook-output parity.
- The app treats an unset distribution as incomplete input, whereas the workbook
  can default that selection to rectangular. Named distribution divisors match;
  the stricter authoring workflow is intentional and is not a new distribution.
- Unit conversion, source aggregation, independent repeated sources and second-order
  diagnostic views are app features beyond the workbook's row contract. Symbolic
  second-order diagnostics do not replace first-order uncertainty or Monte Carlo.
- Monte Carlo matches the statistical model and propagation algorithm, not individual
  random draws. VBA `Randomize` and JavaScript `Math.random` are different generators.
  Deterministic test RNGs are validation seams, not a new workbook sampling claim.
- PFA is a joint false-accept probability in this model, not the conditional probability
  of a bad unit among accepted units. The release accepts the rounded display criterion;
  e.g. interval-only PFA can be just below 2.005% while displaying 2.00%.

## Reproducing the final saved-result check

From `Frontend/workbench`, with the supplied workbook available locally:

```sh
python scripts/extract-final-release8-fixtures.py --workbook /path/to/final-release.xlsm --output /tmp/final-release8.json
# Compare the extracted JSON to the committed fixture; expected values must
# originate in workbook cells, never the implementation under test.
cmp /tmp/final-release8.json src/modules/uncertainty/utils/risk8/finalRelease8Vectors.json
npx vitest run src/modules/uncertainty/utils/risk8/finalRelease8Parity.test.js src/modules/uncertainty/utils/risk8/finalReleaseCore8.test.js
```

The extractor verifies the workbook hash and fails on a different source. To audit
another release, review the source and update the extraction provenance deliberately.

## Validation record

On 2026-11-13, the final focused selection passed **738 tests in 42 files**.
This includes all final saved-result comparisons, the unchanged historical
Beta.7/bias captures, core/source regressions, tolerance/statistics/equation tests,
selected-point/sidebar routing, cache clearing/recovery, and displayed derivations.
The fixture extractor reproduced the committed JSON byte-for-byte. `git diff
--check` passed. Dependency installation used the unchanged lockfile with
`npm ci --ignore-scripts --no-audit --no-fund`; no dependency changes were made.

Exact focused command, from `Frontend/workbench`:

```sh
npx vitest run \
  src/modules/uncertainty/utils/risk8 \
  src/modules/uncertainty/utils/uncertaintyMath \
  src/modules/uncertainty/utils/riskCompute \
  src/modules/uncertainty/utils/riskDistributionModel.test.js \
  src/modules/uncertainty/utils/riskEvaluationCache.test.js \
  src/modules/uncertainty/utils/measurementBias.test.js \
  src/modules/uncertainty/features/analysis/hooks/useRiskCalculation \
  src/modules/uncertainty/features/analysis/hooks/useUncertaintyCalculation \
  src/modules/uncertainty/features/analysis/components/BreakdownModals \
  src/modules/uncertainty/features/analysis/components/UncertaintyBudgetTable \
  src/modules/uncertainty/App.sidebarRisk.test.jsx
```

These are focused checks, not the repository's complete suite or a desktop-Excel
recapture. Repository `AGENTS.md` requires full-suite, build, browser release-gate
and pipeline validation to wait until the user has tested the pushed changes and
explicitly requests that next phase. No historical release validation is presented
as validation of this commit.

## Suggested hand checks

- Recreate the 160-point case above: 75% multiplier, 159.7–160.3 limits,
  85% observed REOP, and 4.42133194649 interval in both selected and sidebar views.
- Change resolution to a value that collapses the tolerance band: the previous
  risk should clear. Restore the valid resolution: the original result returns.
- Enter a negative lower limit or a single-sided limit expressed in a different
  unit: verify inward rounding and the nominal-distance TUR derivation.
- Enable effective DOF with a fractional value: the reported DOF stays fractional
  while the coverage factor follows the integer-truncated Excel argument.
- Enter an impossible correlation combination: the uncertainty total should be
  unavailable with an explanation, preserving editable source rows; correct the
  coefficients and confirm that uncertainty/risk recover.
