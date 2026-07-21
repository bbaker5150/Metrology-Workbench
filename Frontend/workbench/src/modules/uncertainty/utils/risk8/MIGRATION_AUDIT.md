# Risk engine 8.0 migration audit

## Sources reviewed

- Legacy baseline available in the attachment set: `Unc Tool v7.09_OPEN.xlsm`.
  The request names 7.07, but no 7.07 workbook was present; this review uses
  7.09 as the legacy implementation.
- Target: `Unc Tool v8.00-Beta.4-Unlocked.xlsm`, especially VBA module
  `modRiskBackend`, `frmUUTTolerance`, and the MAIN/RISK table bridge.
- App implementation: `uncertaintyMath.js` (legacy 7.x path) and this `risk8`
  directory (8.0 port and comparison harness).

## Material calculation changes

| Area | Legacy 7.x | Workbook 8.0 Beta.4 |
| --- | --- | --- |
| Tolerance classification | Threshold vs. non-threshold branches inferred by the risk managers | Six explicit types: symmetric, asymmetric, lower/upper known, and lower/upper unknown |
| Coordinate system | Physical error limits recentered inside individual managers | A normalized tolerance frame (`-1..+1`, shifted by `delta` for type 2) |
| Bias | Average/nominal recentering is embedded in the managers | Explicit normalized UUT bias (`mu`) and calibration bias (`xcal`) |
| Core probability | Bivariate-normal CDF helpers (`PFA`, `PFR`, threshold variants) | Joint correct-accept integration plus explicit PFA/PFR/PCR quadrants |
| Guard band | Separate iterative low/high/multiplier managers | One recommendation solver returning GB, PFA, PFR, and target REOP together |
| Reliability inputs | UI fields are reused by several managers | `Assumed_REOP` (current evaluation) and `REOP_Required` (mitigation target) are distinct |
| Interval model | Primarily logarithmic reliability scaling | E1, E2, diffusion, and two Weibull modes (W1/W2) |
| Unknown measurement | Alternate threshold behavior in the legacy managers | Types 5/6 use a PFA-only worst-case boundary based on expanded `U_cal` |

## App status

- `riskEngine8.js`, `toleranceTypes8.js`, and `computeOneRow8.js` are literal,
  reviewer-oriented ports with the governing VBA quoted beside the JavaScript.
- The comparison panel calls the 8.0 engine for reviewer parity checks. The
  approved type-5/type-6 PFA-only path is also live in both the selected-point
  hook and the all-points/sidebar calculator, because the legacy engine cannot
  represent measurement unknown. The workbook-parity Type 3/4 known
  single-sided path is live in those same entry points. Types 1/2 still use the
  legacy production functions until the remaining cutover gates are complete.
- Full-precision workbook captures now verify types 1-4 in
  `goldenVectors8.js`. The captures were produced by populating MAIN and running
  the public VBA entry point `ComputeRiskForMainTable`, then reading the numeric
  cell values rather than formatted percentages.

## Beta.4 type-5/type-6 bridge correction

`RB_RowHasMinimumRiskInputs` requires `TUR` to be numeric for every tolerance
type. `HandleUnknownMeasuredValue` and `WritePhysicalGBForUnknownMeasuredValue`
require `TUR` to be blank for types 5/6. Therefore:

1. blank TUR: the MAIN bridge clears the row before `ComputeOneRow` runs;
2. numeric TUR: `ComputeOneRow` reaches the unknown-value branch, which returns
   `check inputs` because TUR is not blank.

The product owner confirmed that the dedicated PFA-only backend behavior is the
intended result. The app therefore corrects the bridge gate for types 5/6:

- the active physical limit, expanded `U_cal`, and PFA target must be numeric;
- `TUR` must be blank;
- `Assumed_REOP` and `REOP_Required` are not required because the handler does
  not use them;
- the physical one-sided acceptance limit and `PFA_With_GB` are produced, while
  TUR/REOP/PFR/interval-dependent outputs remain deliberately blank.

This is explicitly tracked as a correction to the unreachable Beta.4 MAIN-table
path. It does not change the formulas in `HandleUnknownMeasuredValue` or
`WritePhysicalGBForUnknownMeasuredValue`.

## Cutover gate

Before making 8.0 the production engine:

1. ~~approve the type-5/type-6 policy above~~ — approved: use the intended
   PFA-only backend path and correct the bridge;
2. confirm the app mapping `Calculated/Assumed Meas. Reliability ->
   Assumed_REOP` and `Measurement Reliability Target -> REOP_Required`;
3. capture at least one full-precision workbook vector for each approved type
   and each interval model used in production;
4. update the user-facing calculation breakdowns so they explain the 8.0
   integrals and mitigation solver rather than the retired 7.x bivariate-CDF
   formulas;
5. switch both the selected-point hook and the all-points/sidebar calculator in
   the same commit, preventing two risk engines from being displayed at once.
