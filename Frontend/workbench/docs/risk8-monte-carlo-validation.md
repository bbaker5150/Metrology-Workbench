# Risk 8.0 Monte Carlo implementation and validation note

## Review scope

This implementation ports the calibration-equation Monte Carlo method in
`frmCalEquationUncertainty.RunMonteCarlo` from
`Unc Tool v8.00-Beta.4-Unlocked.xlsm`. It replaces the application's older
GUM-S1 empirical-interval workflow. The Monte Carlo result is an uncertainty
budget contribution; it does not replace the Risk 8.0 PFA/PFR calculation.

Source-code implementation:
`src/modules/uncertainty/utils/risk8/monteCarloEngine8.js`.

## Workbook-to-code traceability

| Workbook operation | Application implementation |
| --- | --- |
| Blank trial count defaults to 10,000 | `RISK8_MC_DEFAULT_TRIALS` |
| Trial count must be at least 100 | `normalizeRisk8MonteCarloTrials` |
| `Randomize` + `Rnd` | `Math.random` in production |
| Box-Muller cosine draw | `risk8StandardNormal` |
| Parameter mean and standard uncertainty | `meanBase`, `standardUncertaintyBase` |
| Correlation through lower Cholesky factor | `risk8Cholesky` |
| Reject non-physical correlation matrices | strict errors in `risk8Cholesky` |
| Evaluate equation once per trial | compiled MathJS expression |
| Monte Carlo mean | arithmetic mean of simulated outputs |
| Combined standard uncertainty | sample SD, denominator `N - 1` |
| Nominal result | equation evaluated at nominal input means |
| Approximate effective DOF | MC `u_c^4` divided by the first-order W-S denominator |
| Coverage factor | existing Risk 8.0 Student-t/Normal quantile path |
| Expanded uncertainty | `U = k u_c` |
| Nonlinear influence | workbook's 5/10/20 equal-count conditional-mean bins |

## Statistical model

For input means \(x_i\), standard uncertainties \(u_i\), and correlation
matrix \(R\), the engine factors

\[
R = L L^T
\]

and generates each trial as

\[
z \sim N(0,I), \qquad x^{(m)} = \bar{x} + \operatorname{diag}(u)Lz.
\]

The equation output is \(y^{(m)} = f(x^{(m)})\). The reported combined
standard uncertainty is

\[
u_c = \sqrt{\frac{1}{N-1}\sum_{m=1}^{N}(y^{(m)}-\bar{y})^2}.
\]

Risk 8.0 does not use an empirical shortest interval here. It retains the
workbook's approximate Welch-Satterthwaite degrees of freedom and coverage
factor:

\[
\nu_{eff} = \frac{u_c^4}{\sum_i (c_i u_i)^4/\nu_i},
\qquad U = t_{(1+p)/2,\nu_{eff}}u_c.
\]

When the denominator is zero, degrees of freedom are infinite and the Normal
quantile is used, matching the workbook.

## Workflow and persistence

- A derived final budget contains either `Equation uncertainty`, `Monte Carlo
  equation uncertainty`, or neither while the user is swapping methods.
- Both choices live in the final budget's Add Component menu.
- Removing the calculated row removes its contribution from final uncertainty.
- Monte Carlo stores the selected trial count (`N`) on the point.
- A run cache records a hash of equation, input means, input standard
  uncertainties, correlations, and trial count. The cached result is reused
  only while that complete input hash is unchanged.
- Risk metrics receive the resulting combined/expanded uncertainty through the
  normal calculation result. No empirical PFA/PFR substitution remains.

## Direct-budget extension

The workbook form is equation-oriented. To meet the application's direct-budget
requirement without inventing a different statistical method, direct budgets
use the identity equation

\[
y=e_1+e_2+\cdots+e_n,
\]

where each budget component error \(e_i\) is Normal with mean zero and standard
deviation equal to that row's standard uncertainty. Cholesky correlation,
sample SD, effective DOF, coverage factor, and expanded uncertainty are then
identical to the equation workflow.

## Automated validation

`monteCarloEngine8.test.js` verifies:

1. workbook trial defaults and minimum validation;
2. a correlated linear equation against its analytic covariance result;
3. a nonlinear stationary-point equation against known Normal moments;
4. rejection of a non-positive-semidefinite correlation matrix;
5. the direct identity-budget extension against analytic RSS.

Tests inject a deterministic pseudo-random source solely so validation is
repeatable. Production does not persist or apply a deterministic seed, matching
the workbook's `Randomize` behavior.

## Reviewer cautions

- All equation inputs are sampled as Normal distributions. This is intentional:
  it matches `frmCalEquationUncertainty`, even when lower-level budget rows were
  originally derived from rectangular or triangular error limits.
- The reported nominal remains \(f(\bar{x})\), not the Monte Carlo output mean.
- The output uncertainty uses sample standard deviation, not empirical
  quantiles or a shortest coverage interval.
- Correlation matrices are rejected when physically invalid; they are not
  silently repaired.
